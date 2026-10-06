/**
 * `rt team peer`: connects this Mac's own board to the switchboard. Only a
 * Mac holding the switchboard admin token can register a board, so this is
 * the team creator's path; everyone else gets their board token sealed into
 * an invite (`rt team invite`, then `rt team join`). The board token lands
 * exactly where `rt team join` stores it: rt's `switchboardToken` secret.
 */

import { switchboardUrl } from "../../packages/rt-client/src/switchboard.ts";
import { UserActionableError } from "../errors.ts";
import { createRealAgeKeySeam } from "../home/age-key.ts";
import { createRealSecretsExecSeam, personalStoreReady, writeSecret } from "../secrets/store.ts";
import { getSetting } from "../settings/resolve.ts";
import type { Probes } from "../setup/probes.ts";
import { forgeFromRemote, readTeamSnapshot } from "../setup/team-settings.ts";
import { canonicalHandle, readAdminToken, realReadLocalSecret, type ReadLocalSecret } from "./board-peers.ts";
import { boardEnvValue, readBoardSwitchboardToken } from "./board-token.ts";
import { forgeLogin } from "./forge.ts";
import { teamRemote } from "./members.ts";
import { scrub } from "./redact.ts";
import { storedForgeToken } from "./stored-forge-token.ts";
import { readTeamLocal } from "./team-local.ts";

export interface PeerSeams {
  readLocalSecret: ReadLocalSecret;
  writeLocalSecret: (key: string, value: string) => Promise<void>;
  /** Whether `writeLocalSecret` can succeed now, asked before anything is registered. */
  localStoreReady: () => Promise<boolean>;
  /** The username this Mac's board peers as, or null when rt cannot tell. */
  boardUsername: (p: Probes, slug: string) => Promise<string | null>;
}

export interface PeerResult {
  outcome: "connected" | "already-connected";
  username: string;
  /** The board's own .env sets SWITCHBOARD_TOKEN, which the board reads before rt's secret. */
  boardEnvOverrides: boolean;
}

/** The board identifies itself by `board.defaultMember`, which setup seeds from the forge login; then the username this Mac recorded for the org, the same handle `rt team join` registers; then the org forge's login. */
async function realBoardUsername(p: Probes, slug: string): Promise<string | null> {
  try {
    const member = getSetting<string>("board.defaultMember").value;
    if (typeof member === "string" && member.trim() && member !== "all") return member;
  } catch {
    /* an unreadable setting falls through to the recorded username */
  }
  const recorded = readTeamLocal(p, slug).forgeUsername;
  if (recorded) return recorded;
  const remote = teamRemote(p, slug);
  const forge = readTeamSnapshot(p, slug).integrations.forge ?? (remote ? forgeFromRemote(remote) : null);
  if (!forge) return null;
  const token = remote ? await storedForgeToken(p, remote) : null;
  return forgeLogin(p, forge.provider, forge.host, token);
}

export function realPeerSeams(): PeerSeams {
  const seams = { ageKeySeam: createRealAgeKeySeam(), execSeam: createRealSecretsExecSeam() };
  return {
    readLocalSecret: realReadLocalSecret,
    writeLocalSecret: (key, value) => writeSecret("rt", key, value, seams),
    localStoreReady: () => personalStoreReady(seams),
    boardUsername: realBoardUsername,
  };
}

const ASK_ADMIN = "Ask your org admin to invite you again, then join with the new invite.";

function switchboardFailure(detail: string): UserActionableError {
  return new UserActionableError("switchboard-refused", "rt could not connect your board to the switchboard", {}, { why: detail });
}

/** Probes answer status 0 when nothing answered at all. */
function answered(status: number, asked: string): string {
  return status === 0 ? "rt could not reach the switchboard." : `The switchboard answered ${status} when asked ${asked}.`;
}

function ok(status: number): boolean {
  return status >= 200 && status < 300;
}

function parsed<T>(body: string): T | null {
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

/** Every token here goes only to `switchboardUrl()`. `rotate` issues a new token even when this Mac's works or the switchboard already knows the username, which stops any board still using the old one. */
export async function peerOwnBoard(p: Probes, slug: string, opts: { rotate: boolean }, seams: PeerSeams = realPeerSeams()): Promise<PeerResult> {
  const admin = await readAdminToken(p, seams.readLocalSecret);
  if (!admin) {
    throw new UserActionableError("peer-needs-admin", "Only the org admin can connect a board from their own Mac", {}, {
      why: `This Mac holds no switchboard admin token. ${ASK_ADMIN}`,
      next: "rt team join",
    });
  }

  const raw = await seams.boardUsername(p, slug);
  if (!raw) {
    throw new UserActionableError("board-username-unknown", "rt could not tell which username your board uses", {}, {
      why: "Set board.defaultMember to your forge username, or sign in to your forge's command line tool.",
      next: "rt settings set board.defaultMember <username> --scope user",
    });
  }
  const username = canonicalHandle(raw);
  const base = switchboardUrl(p.env);
  const boardEnvOverrides = boardEnvValue(p, "SWITCHBOARD_TOKEN") !== null;

  if (!opts.rotate) {
    const stored = await readBoardSwitchboardToken(p, () => seams.readLocalSecret("switchboardToken").catch(() => null));
    if (stored && ok((await p.fetch(`${base}/peers`, { headers: { Authorization: `Bearer ${stored}` } })).status)) {
      return { outcome: "already-connected", username, boardEnvOverrides };
    }

    const res = await p.fetch(`${base}/boards`, { headers: { Authorization: `Bearer ${admin}` } });
    if (!ok(res.status)) throw switchboardFailure(answered(res.status, "which boards it knows"));
    const boards = parsed<{ boards?: unknown }>(res.body)?.boards;
    if (!Array.isArray(boards)) throw switchboardFailure("The switchboard sent a list of boards rt could not read.");
    const enrolled = boards.some((b) => typeof (b as { username?: unknown })?.username === "string" && canonicalHandle((b as { username: string }).username) === username);
    if (enrolled) {
      throw new UserActionableError("board-registered-elsewhere", `The switchboard already has a board for ${username}, but this Mac holds no working token for it`, {}, {
        why: "Issuing a new token stops any other board still using the old one.",
        next: "rt team peer --rotate",
      });
    }
  }

  if (!(await seams.localStoreReady())) {
    throw new UserActionableError("secrets-store-not-ready", "This Mac's secrets are not set up yet, so rt has nowhere to keep your board's token", {}, {
      next: "rt home init",
    });
  }

  const res = await p.fetch(`${base}/boards`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin}` },
    body: JSON.stringify({ username }),
  });
  if (!ok(res.status)) throw switchboardFailure(answered(res.status, `to register ${username}`));
  const token = parsed<{ token?: unknown }>(res.body)?.token;
  if (typeof token !== "string" || !token) throw switchboardFailure("The switchboard registered your board but sent back no token.");

  try {
    await seams.writeLocalSecret("switchboardToken", token);
  } catch (err) {
    throw new UserActionableError("peer-store-failed", "Your board is registered, but rt could not save its token. Issue a new one to finish.", {}, {
      log: scrub(err instanceof Error ? err.message : String(err), token),
      next: "rt team peer --rotate",
    });
  }
  return { outcome: "connected", username, boardEnvOverrides };
}
