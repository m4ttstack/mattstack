/**
 * `rt team invite` — mints an opaque relay invite for a handle: pointer
 * (team/name/remote/owner/forge) sealed under a fresh key and a
 * client-generated id, stored on the relay as ciphertext only, and handed
 * back as a short paste-able code.
 *
 * It does NOT grant the invitee access to the team's repo. Membership is a
 * precondition administered by whoever owns that repo (MAT-387); rt touches it
 * only when the operator has explicitly granted `rtMayManageMembership` for
 * this team, which defaults to off.
 */

import { createRealAgeKeySeam } from "../home/age-key.ts";
import { orgSettingsPath } from "../rt-paths.ts";
import { createRealSecretsExecSeam, readSecret } from "../secrets/store.ts";
import { readStore } from "../settings/stores.ts";
import { redactCredentials } from "../../packages/rt-client/src/redact.ts";
import { UserActionableError } from "../errors.ts";
import type { InvitePointer } from "../setup/intent.ts";
import type { Probes } from "../setup/probes.ts";
import { forgeFromRemote, readTeamSnapshot, type SettingsReader } from "../setup/team-settings.ts";
import { getSetting } from "../settings/resolve.ts";
import { setSetting } from "../settings/write.ts";
import { forgeLogin, grantRead, membershipSteps, type ForgeAccess } from "./forge.ts";
import { storedForgeToken } from "./stored-forge-token.ts";
import { readTeamLocal } from "./team-local.ts";
import { encodeCode, generateId, generateKey, seal } from "./invite-crypto.ts";
import { readInviteRecords, upsertInviteRecord } from "./invite-records.ts";
import type { RelayClient } from "./relay-client.ts";
import { switchboardUrl } from "../../packages/rt-client/src/switchboard.ts";
import { warn as warnLine, type ShownWarning } from "../ui/warn.ts";

export const INVITE_TTL_DAYS = 7;

/** Forge usernames only (letters, digits, `.`, `_`, `-`; must start alphanumeric) — this handle also becomes a `board.members` entry and a mint-record key, so it is checked before anything downstream trusts it. */
const HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,38}$/;

export const DEFAULT_JOIN_BASE_URL = "https://mattstack.dev/join";

/**
 * The fragment carries the invite code, so the page that reads it must not be
 * replaceable in transit: plain http is accepted only on loopback, where the
 * harness runs its fixture.
 */
function isSafeJoinBase(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "https:") return true;
  return parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(parsed.hostname);
}

/** Read only by rt, and the VM harness needs to point it elsewhere without a team store. */
export function joinLinkBase(env: Record<string, string | undefined>): string {
  const override = env.RT_JOIN_BASE_URL;
  if (!override) return DEFAULT_JOIN_BASE_URL;
  if (!isSafeJoinBase(override)) {
    throw new UserActionableError("invalid-join-base", "The join link address rt was given must be https, or http on this Mac only", {}, {
      log: `RT_JOIN_BASE_URL must be an https url, or http on loopback: got ${redactCredentials(override)}`,
    });
  }
  return override;
}

/** The code lives in the fragment, so it never reaches the page's server. */
export function joinLink(base: string, code: string): string {
  return `${base}#${code}`;
}

export function pasteBlock(code: string, opts: { link: string; teamName: string; downloadUrl?: string }): string {
  const downloadUrl = opts.downloadUrl ?? "https://github.com/m4ttstack/mattstack/releases/latest";
  return [
    `You have been invited to the ${opts.teamName} mattstack team.`,
    "",
    `  ${opts.link}`,
    "",
    "That page installs mattstack and hands the invite to the app.",
    `Already have mattstack? Open mattstack://join/${code}, or paste this code`,
    "into Setup -> Join a team:",
    "",
    code,
    "",
    `Download by hand: ${downloadUrl}`,
  ].join("\n");
}

export interface InviteResult {
  code: string;
  link: string;
  expiresAt: string;
  pasteBlock: string;
  forgeAccess: ForgeAccess;
  manualSteps: string[];
  /** "none" when this Mac holds no switchboard admin token; "missing" means the joiner's board will not peer from this invite. */
  peering: "embedded" | "missing" | "none";
  /** Present exactly when `peering` is "missing": the reason and the repair, the same sentence the mint warns on stderr. */
  peeringWarning?: string;
}

export interface MintInviteOpts {
  slug: string;
  handle: string;
  now: Date;
  /** Refuse, before anything is minted, an invite that will carry no board token, including on a Mac with no admin token. */
  requirePeering?: boolean;
}

export interface MintInviteSeams {
  read: SettingsReader;
  /** The ONE team's own store, unmixed with the resolver's multi-team overlay — `addToRoster` must read-modify-write the team it is about to push a value into, not the union of every locally-cloned team's roster. */
  readTeamStore: (slug: string) => Record<string, unknown>;
  writeSetting: typeof setSetting;
  grantRead: typeof grantRead;
  /** Local, per-machine team record — carries the membership permission. Seamed so a test can grant it without writing to a real home. */
  readTeamLocal: typeof readTeamLocal;
  forgeLogin: typeof forgeLogin;
  /** The forge token rt holds for the team remote's host, or null. */
  forgeToken: typeof storedForgeToken;
  /** A secret from the operator's LOCAL rt domain (the switchboard admin token lives there, not in team secrets a not-yet-synced invitee could never read anyway). */
  readLocalSecret: (key: string) => Promise<string | null>;
  /** `message` is the log text; `shown` is what a person reads, and a warning without it shows its message. */
  warn: (message: string, shown?: ShownWarning) => void;
}

/** Degrades to `undefined` on a resolver-layer throw rather than taking the mint down with it — mirrors team-settings.ts's own default reader. */
function defaultRead(): SettingsReader {
  return <T>(key: string): T | undefined => {
    try {
      return getSetting<T>(key).value;
    } catch {
      return undefined;
    }
  };
}

function defaultReadTeamStore(slug: string): Record<string, unknown> {
  return readStore(orgSettingsPath(slug)).global;
}

function defaultWarn(message: string, shown?: ShownWarning): void {
  warnLine("team", message, { show: shown ?? { title: message } });
}

export function realMintInviteSeams(): MintInviteSeams {
  return {
    read: defaultRead(),
    readTeamStore: defaultReadTeamStore,
    writeSetting: setSetting,
    grantRead,
    readTeamLocal,
    forgeLogin,
    forgeToken: storedForgeToken,
    readLocalSecret: (key) => readSecret("rt", key, { ageKeySeam: createRealAgeKeySeam(), execSeam: createRealSecretsExecSeam() }),
    warn: defaultWarn,
  };
}

interface BoardMember {
  username: string;
  [key: string]: unknown;
}

/** Both roster keys, each judged on its own contents: board.members is the board's own list, mattstack.roster the cross-app successor, and a store can legitimately carry one without the other. */
function addToRoster(seams: MintInviteSeams, slug: string, handle: string): void {
  const store = seams.readTeamStore(slug);
  for (const key of ["board.members", "mattstack.roster"] as const) {
    const existing = Array.isArray(store[key]) ? (store[key] as BoardMember[]) : [];
    if (existing.some((m) => m.username === handle)) continue;
    seams.writeSetting(key, [...existing, { username: handle }], "org");
  }
}

function assertValidHandle(handle: string): void {
  if (!HANDLE_PATTERN.test(handle)) {
    throw new UserActionableError("invalid-handle", `"${handle}" does not look like a forge username`, {}, {
      why: "A username uses letters, digits, dots, dashes and underscores, and starts with a letter or digit.",
    });
  }
}

/**
 * rt administers membership only where it created the repo AND the operator
 * granted the permission (MAT-387). Both, not either: the record is a file, so
 * requiring only the permission would let a hand-edited flag act on a repo rt
 * was merely pointed at.
 */
async function resolveForgeAccess(
  p: Probes,
  seams: MintInviteSeams,
  slug: string,
  remote: string,
  handle: string,
  token: string | null,
): Promise<{ access: ForgeAccess; manualSteps: string[] }> {
  const local = seams.readTeamLocal(p, slug);
  if (local.createdByRt && local.rtMayManageMembership) {
    return seams.grantRead(p, remote, handle, token);
  }
  if (local.createdByRt) {
    return {
      access: "skipped",
      manualSteps: [
        `Let mattstack give ${handle} access, then invite them again: rt team manage-membership on --team ${slug}`,
        ...membershipSteps(remote, handle),
      ],
    };
  }
  // The admin sentence is appended here, never returned by membershipSteps,
  // so a remote that cannot be parsed still leaves the reader one true line.
  return {
    access: "skipped",
    manualSteps: [
      ...membershipSteps(remote, handle),
      `Ask whoever runs the team repo to give ${handle} read access. mattstack did not create it, so they decide.`,
    ],
  };
}

export async function mintInvite(p: Probes, relay: RelayClient, opts: MintInviteOpts, seams: MintInviteSeams = realMintInviteSeams()): Promise<InviteResult> {
  assertValidHandle(opts.handle);

  const snapshot = readTeamSnapshot(p, opts.slug, { read: seams.read, warn: seams.warn });
  if (!snapshot.remote) {
    throw new UserActionableError("no-team-remote", `The ${opts.slug} team has no repo yet`, {}, { next: "rt team publish --remote <url>" });
  }
  const remote = snapshot.remote;
  const forge = snapshot.integrations.forge ?? forgeFromRemote(remote) ?? undefined;
  const token = await seams.forgeToken(p, remote);
  const owner = (forge ? await seams.forgeLogin(p, forge.provider, forge.host, token) : null) ?? p.env.USER ?? "unknown";

  const title = seams.read<string>("board.title");
  const pointer: InvitePointer = {
    v: 1,
    team: opts.slug,
    name: title && title.length > 0 ? title : opts.slug,
    remote,
    owner,
    forge: forge?.host ?? "",
    createdAt: opts.now.toISOString(),
  };

  // Board peering rides the invite: the invitee cannot decrypt team secrets
  // at join time (their age key is not yet a recipient), so the per-board
  // token must be minted HERE, where the admin token is readable, and sealed
  // into the pointer. Every failure degrades to an invite without peering
  // plus a warning; the board panel's re-invite remains the repair.
  let peeringWarning: string | undefined;
  let embedFailure: string | null = null;
  let adminToken: string | null = null;
  try {
    adminToken = await seams.readLocalSecret("switchboardAdminToken");
  } catch (err) {
    embedFailure = err instanceof Error ? err.message : String(err);
  }
  if (!adminToken && !embedFailure && opts.requirePeering) {
    throw new UserActionableError("peering-not-embedded", "rt did not make the invite, because it could not connect their board", {}, {
      why: "This Mac holds no switchboard admin token, so it cannot register their board.",
    });
  }
  if (adminToken) {
    try {
      const res = await p.fetch(`${switchboardUrl(p.env)}/boards`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ username: opts.handle }),
      });
      if (res.status < 200 || res.status >= 300) {
        embedFailure = `the switchboard register answered ${res.status}`;
      } else {
        let boardToken: unknown;
        try {
          boardToken = (JSON.parse(res.body) as { token?: unknown })?.token;
        } catch {
          /* an unparsable register reply reads as no token */
        }
        if (typeof boardToken === "string" && boardToken) {
          pointer.switchboard = { token: boardToken };
        } else {
          embedFailure = "the switchboard register returned no token";
        }
      }
    } catch (err) {
      embedFailure = err instanceof Error ? err.message : String(err);
    }
  }
  if (embedFailure) {
    peeringWarning = "This invite will not connect their board. After they join, invite their board again from the board's members panel.";
    if (opts.requirePeering) {
      throw new UserActionableError("peering-not-embedded", "rt did not make the invite, because it could not connect their board", {}, {
        why: "It could not register their board with the switchboard.",
        log: embedFailure,
      });
    }
    seams.warn(`board peering: ${embedFailure}`, { title: "This invite will not connect their board", hint: "invite their board again from the board's members panel after they join" });
  }
  const peering: InviteResult["peering"] = pointer.switchboard ? "embedded" : embedFailure ? "missing" : "none";

  // Captured before this handle's new record is minted — replace-on-mint's revoke of THIS value runs last, after the new invite is safely live (finding: create-before-destroy).
  const priorRecord = readInviteRecords(p, opts.slug)[opts.handle];

  const key = generateKey();
  const idHex = generateId();
  const ciphertext = await seal(pointer, key, idHex);
  const expiresAt = new Date(opts.now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const created = await relay.create(ciphertext, expiresAt, idHex);
  if (created.id !== idHex) {
    throw new UserActionableError("relay-id-mismatch", "rt could not make a safe invite", {}, { why: "The invite service changed the invite's id. Try again." });
  }

  const code = encodeCode(created.id, key);

  // The record is the ONLY copy of creatorSecret (revoke capability) and keyB64 (reply-read capability) — persist it before anything else fallible runs, and if the write itself fails, name the id/code so the invite is still recoverable by hand.
  try {
    upsertInviteRecord(p, opts.slug, opts.handle, {
      id: created.id,
      creatorSecret: created.creatorSecret,
      keyB64: Buffer.from(key).toString("base64"),
      expiresAt,
    });
  } catch (err) {
    throw new UserActionableError("invite-record-write-failed", `rt made the invite but could not save its record. Write its code down now: ${code}`, {}, {
      why: `Without the record rt cannot cancel the invite or add the member later. Saving it failed: ${err instanceof Error ? err.message : String(err)}.`,
    });
  }

  // Repo membership is a precondition, not something rt provisions (MAT-387):
  // you are added to a repo by whoever administers it, before mattstack is in
  // the picture. rt only reaches for the forge where it created the repo AND
  // the operator has explicitly granted membership management on THIS team;
  // neither fact is derivable from the remote URL alone.
  const { access: forgeAccess, manualSteps } = await resolveForgeAccess(p, seams, opts.slug, remote, opts.handle, token);

  addToRoster(seams, opts.slug, opts.handle);

  if (priorRecord) {
    try {
      await relay.delete(priorRecord.id, priorRecord.creatorSecret);
    } catch (err) {
      seams.warn(
        `rt team invite: minted a new invite for "${opts.handle}", but could not revoke the previous one (id ${priorRecord.id}) — ${err instanceof Error ? err.message : String(err)}; it will simply expire on its own.`,
        { title: `The earlier invite for ${opts.handle} is still live`, hint: "it stops working when it expires" },
      );
    }
  }

  const link = joinLink(joinLinkBase(p.env), code);
  return {
    code,
    link,
    expiresAt,
    pasteBlock: pasteBlock(code, { link, teamName: pointer.name }),
    forgeAccess,
    manualSteps,
    peering,
    ...(peeringWarning !== undefined ? { peeringWarning } : {}),
  };
}
