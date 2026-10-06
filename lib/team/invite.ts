import { isAbsolute, join, relative } from "path";
import { sameUser } from "../../packages/rt-client/src/settings/active-team.ts";
import { assertTeamFolders } from "./team-names.ts";
import { orgStoreFile } from "./org-store.ts";
import { gitWithToken } from "./git-credential.ts";
import { withoutUrls } from "./redact.ts";
import { publishTeam } from "./publish.ts";
/**
 * `rt team invite` mints an opaque relay invite for a handle: pointer
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
import { currentOrg, readStore } from "../settings/stores.ts";
import { redactCredentials } from "../../packages/rt-client/src/redact.ts";
import { UserActionableError } from "../errors.ts";
import { INVITE_POINTER_VERSION, type InvitePointer } from "../setup/intent.ts";
import type { Probes } from "../setup/probes.ts";
import { forgeFromRemote, readTeamSnapshot, type SettingsReader } from "../setup/team-settings.ts";
import { getSetting } from "../settings/resolve.ts";
import { setSetting } from "../settings/write.ts";
import { forgeLogin, grantRead, membershipSteps, type ForgeAccess } from "./forge.ts";
import { storedForgeToken } from "./stored-forge-token.ts";
import { assertCurrentOrg, readTeamLocal } from "./team-local.ts";
import { encodeCode, generateId, generateKey, seal } from "./invite-crypto.ts";
import { readInviteRecords, upsertInviteRecord } from "./invite-records.ts";
import type { RelayClient } from "./relay-client.ts";
import { orgBranch, shellQuote } from "./org-branch.ts";
import { switchboardUrl } from "../../packages/rt-client/src/switchboard.ts";
import { warn as warnLine, type ShownWarning } from "../ui/warn.ts";

export const INVITE_TTL_DAYS = 7;

/** Forge usernames only (letters, digits, `.`, `_`, `-`; must start alphanumeric). This handle also becomes a `mattstack.roster` entry and a mint-record key, so it is checked before anything downstream trusts it. */
export const HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,38}$/;

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
  teams: string[];
  now: Date;
  /** Refuse, before anything is minted, an invite that will carry no board token, including on a Mac with no admin token. */
  requirePeering?: boolean;
}

export interface MintInviteSeams {
  pullOrg: (p: Probes, slug: string, remote: string, token: string | null) => Promise<void>;
  publishRoster: (p: Probes, slug: string, handle: string, remote: string, token: string | null) => Promise<void>;
  read: SettingsReader;
  /** The org store's own top-level keys, unmerged with the active team's: `addToRoster` read-modify-writes the org layer. */
  readTeamStore: (slug: string) => Record<string, unknown>;
  writeSetting: typeof setSetting;
  /** The org this Mac reads settings from, which is where an org write lands. */
  currentOrg: () => string | null;
  grantRead: typeof grantRead;
  /** Local, per-machine team record that carries the membership permission. Seamed so a test can grant it without writing to a real home. */
  readTeamLocal: typeof readTeamLocal;
  forgeLogin: typeof forgeLogin;
  /** The forge token rt holds for the team remote's host, or null. */
  forgeToken: typeof storedForgeToken;
  /** A secret from the operator's LOCAL rt domain (the switchboard admin token lives there, not in team secrets a not-yet-synced invitee could never read anyway). */
  readLocalSecret: (key: string) => Promise<string | null>;
  /** `message` is the log text; `shown` is what a person reads, and a warning without it shows its message. */
  warn: (message: string, shown?: ShownWarning) => void;
}

/** Degrades to `undefined` on a resolver-layer throw rather than taking the mint down with it, as does team-settings.ts's own default reader. */
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

async function gitPathExists(p: Probes, dir: string, name: string): Promise<boolean> {
  const res = await p.exec(["git", "rev-parse", "--git-path", name], { cwd: dir });
  if (res.code !== 0) return false;
  const path = res.stdout.trim();
  return path !== "" && p.exists(isAbsolute(path) ? path : join(dir, path));
}

async function rebaseStopped(p: Probes, dir: string): Promise<boolean> {
  for (const name of ["rebase-merge", "rebase-apply"]) {
    if (await gitPathExists(p, dir, name)) return true;
  }
  return false;
}

async function refuseIfBusy(p: Probes, dir: string): Promise<void> {
  const state = (await rebaseStopped(p, dir)) ? "rebase" : (await gitPathExists(p, dir, "MERGE_HEAD")) ? "merge" : null;
  if (state === null) return;
  throw new UserActionableError(`org-mid-${state}`, `Your copy of the org is part way through a git ${state}, so rt made no invite`, {}, {
    why: `rt leaves a ${state} it did not start alone. Finish it or undo it, then invite again.`,
    next: `git -C ${shellQuote(dir)} status`,
  });
}

/** `rebase --abort` reapplies the pull's autostash, and parks it in the stash list when it no longer applies cleanly, so uncommitted edits survive either way. */
async function abortRebase(p: Probes, dir: string, slug: string, pullOutput: string): Promise<never> {
  const abort = await p.exec(["git", "rebase", "--abort"], { cwd: dir });
  const log = `${pullOutput}\n${withoutUrls(`${abort.stdout}\n${abort.stderr}`.trim())}`.trim();
  if (abort.code !== 0) {
    throw new UserActionableError("org-mid-rebase", "rt could not put your copy of the org back after a failed pull, so it made no invite", {}, {
      why: "Your copy of the org is part way through a git rebase. Undo it, then invite again.",
      next: `git -C ${shellQuote(dir)} rebase --abort`,
      log,
    });
  }
  const stashed = /safe in the stash/i.test(`${abort.stdout}\n${abort.stderr}`);
  throw new UserActionableError("org-changed-concurrently", "Someone else changed the org at the same time, so rt made no invite", {}, {
    why: stashed
      ? `rt put your copy of the org back as it was and kept your unsaved edits there in git's stash. ${SETTLE_THE_CLASH}`
      : `rt put your copy of the org back as it was. ${SETTLE_THE_CLASH}`,
    ...settleTheClash(dir, slug),
    log,
  });
}

function peeringNotEmbedded(log: string): UserActionableError {
  return new UserActionableError("peering-not-embedded", "rt did not make the invite, because it could not connect their board", {}, {
    why: "It could not register their board with the switchboard.",
    log,
  });
}

const SETTLE_THE_CLASH = "Pull their change and settle any clash, publish, then invite again.";

/** The daemon's pull replays the same rebase and stops on the same clash, so the remedy is a pull a person finishes by hand. */
function settleTheClash(dir: string, slug: string): { next: string; thenRun: string } {
  return { next: `git -C ${shellQuote(dir)} pull --rebase --autostash origin main`, thenRun: `rt team publish --team ${slug}` };
}

export function realMintInviteSeams(): MintInviteSeams {
  return {
    read: defaultRead(),
    pullOrg: async (p, slug, remote, token) => {
      const dir = join(p.home, ".mattstack", "teams", slug);
      await refuseIfBusy(p, dir);
      const branch = await orgBranch(p, dir);
      if (branch !== "main") {
        throw new UserActionableError("invite-off-main", `Your copy of the org is on ${branch}, so rt made no invite`, {}, {
          why: "The people you invite clone main, so their roster entry has to land there. Switch back to main to invite.",
          next: `git -C ${shellQuote(dir)} switch main`,
        });
      }
      const known =await p.exec(["git", "rev-parse", "--verify", "-q", "refs/remotes/origin/main"], { cwd: dir });
      if (known.code !== 0) return;
      const pull = gitWithToken(["pull", "--rebase", "--autostash", "origin", "main"], token, { GIT_TERMINAL_PROMPT: "0" }, { remote });
      const res = await p.exec(pull.argv, { cwd: dir, env: pull.env });
      if (res.code === 0) return;
      const output = withoutUrls(`${res.stdout}\n${res.stderr}`.trim());
      if (!(await rebaseStopped(p, dir))) throw new Error(output || `git pull exited ${res.code}`);
      await abortRebase(p, dir, slug, output);
    },
    publishRoster: async (p, slug, handle, remote, token) => {
      const dir = join(p.home, ".mattstack", "teams", slug);
      const file = relative(dir, orgStoreFile(p.home, slug));
      const add = await p.exec(["git", "add", "--", file], { cwd: dir });
      if (add.code !== 0) throw new UserActionableError("git-add-failed", "rt could not stage the roster change", {}, { log: add.stderr });
      const commit = await p.exec(["git", "commit", "-m", `team: invite ${handle}`, "--", file], { cwd: dir });
      if (commit.code !== 0 && !/nothing to commit|no changes added/i.test(`${commit.stdout}\n${commit.stderr}`)) {
        throw new UserActionableError("git-commit-failed", "rt could not commit the roster change", {}, { log: commit.stderr });
      }
      await publishTeam(p, slug, null, { token, tokenRemote: remote });
    },

    readTeamStore: defaultReadTeamStore,
    writeSetting: setSetting,
    currentOrg,
    grantRead,
    readTeamLocal,
    forgeLogin,
    forgeToken: storedForgeToken,
    readLocalSecret: (key) => readSecret("rt", key, { ageKeySeam: createRealAgeKeySeam(), execSeam: createRealSecretsExecSeam() }),
    warn: defaultWarn,
  };
}

interface RosterEntryLike {
  username: string;
  [key: string]: unknown;
}

function addToRoster(seams: MintInviteSeams, slug: string, handle: string, teams: string[]): void {
  const store = seams.readTeamStore(slug);
  const roster = Array.isArray(store["mattstack.roster"]) ? (store["mattstack.roster"] as RosterEntryLike[]) : [];
  const existing = roster.find((m) => typeof m.username === "string" && sameUser(m.username, handle));
  if (!existing) {
    seams.writeSetting("mattstack.roster", [...roster, { username: handle, teams }], "org");
    return;
  }
  const had = Array.isArray(existing.teams) ? (existing.teams as unknown[]).filter((t): t is string => typeof t === "string") : [];
  const next = [...had, ...teams.filter((t) => !had.includes(t))];
  if (next.length === had.length) return;
  seams.writeSetting("mattstack.roster", roster.map((m) => (m === existing ? { ...m, teams: next } : m)), "org");
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
  if (opts.teams.length === 0) {
    throw new UserActionableError("invite-needs-team", "Say which team the invite is for", {}, { next: "rt team invite --handle <username> --teams <team>" });
  }
  assertTeamFolders(p, opts.slug, opts.teams);
  const teams = [...new Set(opts.teams)];
  assertCurrentOrg(opts.slug, seams.currentOrg(), `team invite ${opts.handle}`);

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
    v: INVITE_POINTER_VERSION,
    username: opts.handle,
    teams,
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
  // plus a warning; a fresh invite and a re-join remain the repair. The
  // register runs only once the roster is pushed, so no refusal before it
  // leaves a minted board token unused.
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
  if (embedFailure && opts.requirePeering) throw peeringNotEmbedded(embedFailure);

  // Captured before this handle's new record is minted: replace-on-mint's revoke of THIS value runs last, after the new invite is safely live (finding: create-before-destroy).
  const priorRecord = readInviteRecords(p, opts.slug)[opts.handle];

  try {
    await seams.pullOrg(p, opts.slug, remote, token);
  } catch (err) {
    if (err instanceof UserActionableError) throw err;
    throw new UserActionableError("org-not-current", "rt could not bring the org repo up to date, so it made no invite", {}, {
      why: err instanceof Error ? err.message : String(err),
      next: "rt team status",
    });
  }
  addToRoster(seams, opts.slug, opts.handle, teams);
  try {
    await seams.publishRoster(p, opts.slug, opts.handle, remote, token);
  } catch (err) {
    const reason = (err instanceof Error ? err.message : String(err)).replace(/\.$/, "");
    throw new UserActionableError("roster-not-published", `rt could not push ${opts.handle}'s roster entry, so it made no invite`, {}, {
      why: `${reason}. Pull any change someone else pushed and settle any clash, publish, then invite again.`,
      ...settleTheClash(join(p.home, ".mattstack", "teams", opts.slug), opts.slug),
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
    peeringWarning = "This invite will not connect their board. Once it can, invite them again and have them join with the new invite.";
    if (opts.requirePeering) throw peeringNotEmbedded(embedFailure);
    seams.warn(`board peering: ${embedFailure}`, { title: "This invite will not connect their board", hint: "invite them again later and have them join with the new invite" });
  }
  const peering: InviteResult["peering"] = pointer.switchboard ? "embedded" : embedFailure ? "missing" : "none";

  const key = generateKey();
  const idHex = generateId();
  const ciphertext = await seal(pointer, key, idHex);
  const expiresAt = new Date(opts.now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const created = await relay.create(ciphertext, expiresAt, idHex);
  if (created.id !== idHex) {
    throw new UserActionableError("relay-id-mismatch", "rt could not make a safe invite", {}, { why: "The invite service changed the invite's id. Try again." });
  }

  const code = encodeCode(created.id, key);

  // The record is the ONLY copy of creatorSecret (revoke capability) and keyB64 (reply-read capability): persist it before anything else fallible runs, and if the write itself fails, name the id/code so the invite is still recoverable by hand.
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


  if (priorRecord) {
    try {
      await relay.delete(priorRecord.id, priorRecord.creatorSecret);
    } catch (err) {
      seams.warn(
        `rt team invite: minted a new invite for "${opts.handle}", but could not revoke the previous one (id ${priorRecord.id}): ${err instanceof Error ? err.message : String(err)}; it will simply expire on its own.`,
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
