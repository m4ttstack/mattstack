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

/** The board identifies itself by `board.defaultMember`, which setup seeds from the forge login; the team forge's login is the fallback, the same handle `rt team join` registers. */
async function realBoardUsername(p: Probes, slug: string): Promise<string | null> {
  try {
    const member = getSetting<string>("board.defaultMember").value;
    if (typeof member === "string" && member.trim() && member !== "all") return member;
  } catch {
    /* an unreadable setting falls through to the forge login */
  }
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

const ASK_OWNER = "Ask the team's owner to invite you again (rt team invite), then join with the new invite.";

function switchboardFailure(detail: string): UserActionableError {
  return new UserActionableError("switchboard-refused", "rt could not connect your board to the switchboard", {}, { why: detail });
}

async function tokenWorks(p: Probes, base: string, token: string): Promise<boolean> {
  try {
    const res = await p.fetch(`${base}/peers`, { headers: { Authorization: `Bearer ${token}` } });
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

/** Every token here goes only to `switchboardUrl()`. `rotate` re-registers a username the switchboard already knows, which stops any board still using the old token. */
export async function peerOwnBoard(p: Probes, slug: string, opts: { rotate: boolean }, seams: PeerSeams = realPeerSeams()): Promise<PeerResult> {
  const admin = await readAdminToken(p, seams.readLocalSecret);
  if (!admin) {
    throw new UserActionableError("peer-needs-owner", "Only the team's owner can connect a board from their own Mac", {}, {
      why: `This Mac holds no switchboard admin token. ${ASK_OWNER}`,
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

  const stored = await readBoardSwitchboardToken(p, () => seams.readLocalSecret("switchboardToken").catch(() => null));
  if (stored && (await tokenWorks(p, base, stored))) return { outcome: "already-connected", username, boardEnvOverrides };

  if (!opts.rotate) {
    let enrolled: boolean;
    try {
      const res = await p.fetch(`${base}/boards`, { headers: { Authorization: `Bearer ${admin}` } });
      if (res.status < 200 || res.status >= 300) throw switchboardFailure(`The switchboard answered ${res.status} when asked which boards it knows.`);
      const boards = (JSON.parse(res.body) as { boards?: Array<{ username?: unknown }> }).boards ?? [];
      enrolled = boards.some((b) => typeof b?.username === "string" && canonicalHandle(b.username) === username);
    } catch (err) {
      if (err instanceof UserActionableError) throw err;
      throw switchboardFailure(scrub(err instanceof Error ? err.message : String(err), admin));
    }
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

  let token: unknown;
  try {
    const res = await p.fetch(`${base}/boards`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin}` },
      body: JSON.stringify({ username }),
    });
    if (res.status === 409) return { outcome: "already-connected", username, boardEnvOverrides };
    if (res.status < 200 || res.status >= 300) throw switchboardFailure(`The switchboard answered ${res.status} when asked to register ${username}.`);
    try {
      token = (JSON.parse(res.body) as { token?: unknown })?.token;
    } catch {
      /* an unparsable register reply reads as no token */
    }
  } catch (err) {
    if (err instanceof UserActionableError) throw err;
    throw switchboardFailure(scrub(err instanceof Error ? err.message : String(err), admin));
  }
  if (typeof token !== "string" || !token) throw switchboardFailure("The switchboard registered your board but sent back no token.");

  try {
    await seams.writeLocalSecret("switchboardToken", token);
  } catch (err) {
    throw new UserActionableError("peer-store-failed", "Your board is registered, but rt could not save its token. Run this again with --rotate to issue a new one.", {}, {
      log: scrub(err instanceof Error ? err.message : String(err), token),
      next: "rt team peer --rotate",
    });
  }
  return { outcome: "connected", username, boardEnvOverrides };
}
