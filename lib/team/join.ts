/**
 * `rt team join` — the joiner side of `rt team invite`: turns a pasted code
 * into a working team clone. `joinDryRun` only validates (decodes the code,
 * opens the sealed pointer, probes forge access) and persists a resumable
 * intent; `joinRedeem` does the real work (clone, redeem the invite,
 * attempt switchboard peering, post a reply blob carrying the joiner's age
 * key back to the inviter).
 *
 * `access`/`peering` are report fields, not exceptions: a denied or
 * unreachable outcome is a normal, successful call (exit 0) — only a code
 * that can never be redeemed (malformed, or the relay has no record of it)
 * throws, since that's the one case with nothing left to retry.
 *
 * The decoded pointer is ATTACKER-CONTROLLED: anyone can POST their own
 * ciphertext to the public relay and hand a victim the resulting code, so a
 * successful decrypt only proves the blob wasn't tampered with in transit —
 * it proves nothing about the CONTENT. `validatePointer` runs immediately
 * after every `open()`/intent-read, before `team`/`remote` reach a path join
 * or a git invocation.
 */

import { join } from "path";
import { type AgeKeySeam, createRealAgeKeySeam, ensureAgeKey } from "../home/age-key.ts";
import { createRealSecretsExecSeam, personalStoreReady, validateSlug, writeSecret } from "../secrets/store.ts";
import type { SecretsSeams } from "../secrets/store.ts";
import { readTeamSecret } from "../secrets/team-store.ts";
import { logFailureDetail, UserActionableError } from "../errors.ts";
import { isValidHttpsUrl } from "../setup/host-validate.ts";
import { clearIntent, readIntent, writeIntent, type InvitePointer } from "../setup/intent.ts";
import type { ExecResult, Probes } from "../setup/probes.ts";
import { forgeFromRemote, parseOriginUrl, readTeamSnapshot, readUserIntegrationOverrides, stripUserinfo, type SettingsReader } from "../setup/team-settings.ts";
import { getSetting } from "../settings/resolve.ts";
import { setSetting } from "../settings/write.ts";
import { forgeLogin } from "./forge.ts";
import { gitWithToken } from "./git-credential.ts";
import { decodeCode, open, sealReply } from "./invite-crypto.ts";
import { AUTH_FAILURE_PATTERN } from "./publish.ts";
import { scrub, withoutUrls } from "./redact.ts";
import { assertNotRealStoreInTest } from "../../packages/rt-client/src/test-isolation.ts";
import type { RelayClient } from "./relay-client.ts";
import { warn as warnLine, type ShownWarning } from "../ui/warn.ts";
import * as out from "../ui/out.ts";
import { storedForgeToken } from "./stored-forge-token.ts";
import { forgeLabel, probeTeamRepoAccess, type RepoAccessVerdict } from "./repo-access.ts";
import { forgeTokenLookupForRemote, mayOfferToken, mayOfferTokenToHost, tokenLookupRemoteForHost } from "./forge-token.ts";
import { assertOnlyTeam } from "./one-team.ts";
import { readTeamLocal, updateTeamLocal } from "./team-local.ts";

export interface JoinResult {
  team: { slug: string; name: string; owner: string };
  access: "ok" | "deferred" | "no-account" | "denied" | "unreachable" | "undetermined";
  peering: "applied" | "idle" | "unavailable";
  /** Present exactly when `peering` is "unavailable": what gets this machine's board peered. */
  peeringFix?: string;
  message: string;
  intent: "written" | "not-written";
}

/** Raised only after the clone and the relay redeem have already succeeded: the join is real, but the local age key could not be read. Not a `UserActionableError`, so `teamJoin` gives it its own code (`age-key-unavailable`, exit 2) and it never reads as a dead invite. */
export class JoinKeyExchangeError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}

/** Raised after the redeem when a board token rt holds could not be stored. The reply is not sent and the intent is kept, so a plain `rt team join` rerun finishes: a sealed token lives nowhere else, and a minted one is minted again. */
export class JoinPeeringStoreError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}

const NO_TEAM: JoinResult["team"] = { slug: "", name: "", owner: "" };

const GIT_ENV = { GIT_TERMINAL_PROMPT: "0", GIT_PROTOCOL_FROM_USER: "0" };

function inviteUnknownError(message = "That invite has expired or is not one rt knows", why = "Ask the team's owner for a new one."): UserActionableError {
  return new UserActionableError("invite-unknown", message, {}, { why });
}

function teamRefFrom(pointer: InvitePointer): JoinResult["team"] {
  return { slug: pointer.team, name: pointer.name, owner: pointer.owner };
}

function deniedResult(pointer: InvitePointer): JoinResult {
  return {
    team: teamRefFrom(pointer),
    access: "denied",
    peering: "idle",
    message: `Ask ${pointer.owner} to let you into ${pointer.name}, since you don't have access yet.`,
    intent: "written",
  };
}

function unreachableResult(team: JoinResult["team"], message: string, intent: JoinResult["intent"] = "written"): JoinResult {
  return { team, access: "unreachable", peering: "idle", message, intent };
}

// A real hostname/IP[:port] — starts and ends alnum, `.`/`-` in between, an
// optional port. Anchoring the CAPTURE (not just the overall pattern) to this
// charset is what keeps a `\n`/`\r`/control-char host from ever reaching a
// message or log built from `remote`. A `.`
// in a non-dotAll regex already excludes literal newlines from the PATH
// portion, so the host class was the only gap.
const HOST = "[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::[0-9]{1,5})?";
const USERINFO = "(?:[^@/\\s]+@)?";

/**
 * Every scp-like/URL remote form git accepts, restricted to the three
 * transports rt ever needs — deliberately excludes `ext::`, `file://`, and
 * anything else git's transport helpers understand, since the pointer this
 * validates is attacker-controlled. Whitespace is rejected outright rather
 * than special-casing flag-shaped substrings like `--upload-pack=`: `p.exec`
 * is `Bun.spawn(argv)` (no shell, no word splitting), so `remote` is always
 * ONE argv element regardless of what it contains — the only reason a
 * flag-shaped tail was ever worth naming was symmetry, so reject the whole
 * class in one rule instead of enumerating flag names.
 */
function isAllowedRemote(remote: string): boolean {
  if (remote.length === 0 || remote.startsWith("-") || /\s/.test(remote)) return false;
  if (/^ext::/i.test(remote)) return false;
  if (/^file:\/\//i.test(remote)) return false;

  if (new RegExp(`^https:\\/\\/${USERINFO}${HOST}\\/.+$`).test(remote)) return true;
  if (new RegExp(`^ssh:\\/\\/${USERINFO}${HOST}\\/.+$`).test(remote)) return true;
  // scp-like: user@host:path
  if (new RegExp(`^[A-Za-z0-9_][A-Za-z0-9_.-]*@${HOST}:.+$`).test(remote)) return true;

  return false;
}

/** Strips C0 controls and DEL — defangs an ANSI escape (which opens with ESC, 0x1b) and CR/LF line-injection from an attacker-controlled display string before it ever reaches a human-readable message. `--json` needed no such treatment (`JSON.stringify` already escapes C0), but the plain-text `rt team join: <message>` line does not. */
function sanitizeDisplay(s: string): string {
  return [...s]
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join("");
}

/**
 * The one place `team`/`remote`/`name`/`owner` are trusted enough to reach a
 * path join, a git argv, or a human-readable message — every pointer,
 * however obtained (a fresh decode or a saved intent), passes through here
 * first, and every caller uses the RETURNED pointer (name/owner sanitized),
 * never the raw one `open()`/the intent handed back.
 */
function validatePointer(pointer: InvitePointer): InvitePointer {
  try {
    validateSlug(pointer.team);
  } catch {
    throw new UserActionableError("invite-malformed", "rt could not read that invite", {}, { log: "invite pointer names an invalid team slug" });
  }
  if (!isAllowedRemote(pointer.remote)) {
    throw new UserActionableError("invite-malformed", "rt could not read that invite", {}, { log: "invite pointer's remote is not a recognized git URL" });
  }
  return { ...pointer, name: sanitizeDisplay(pointer.name), owner: sanitizeDisplay(pointer.owner) };
}

function isRelayConnectivityError(err: unknown): err is UserActionableError {
  return err instanceof UserActionableError && (err.code === "relay-unreachable" || err.code === "relay-error");
}

/**
 * A "gone" invite and an undecodable blob (wrong key, tampered ciphertext)
 * look identical from the joiner's side — both mean this code no longer
 * opens anything — so both collapse to the same invite-unknown error.
 * Returns null (not a throw) for a relay CONNECTIVITY failure, which is a
 * retryable, exit-0 outcome rather than a dead code. Anything else — a
 * programming error, not a documented relay-client failure mode — propagates
 * unchanged rather than being folded into "check your network".
 */
async function fetchPointer(relay: RelayClient, idHex: string, key: Uint8Array): Promise<InvitePointer | null> {
  let ciphertext: string;
  try {
    const fetched = await relay.fetch(idHex);
    if (fetched === "gone") throw inviteUnknownError();
    ciphertext = fetched.ciphertext;
  } catch (err) {
    if (err instanceof UserActionableError && err.code === "invite-unknown") throw err;
    if (isRelayConnectivityError(err)) return null;
    throw err;
  }
  let pointer: InvitePointer;
  try {
    pointer = await open(ciphertext, key, idHex);
  } catch {
    throw inviteUnknownError();
  }
  return validatePointer(pointer);
}

type GitFailureKind = "denied" | "network" | "missing-binary" | "disk-full" | "exists" | "local";

function classifyGitFailure(result: ExecResult): GitFailureKind {
  if (result.code === 127) return "missing-binary";
  const text = `${result.stdout}\n${result.stderr}`;
  if (AUTH_FAILURE_PATTERN.test(text)) return "denied";
  if (/no space left on device/i.test(text)) return "disk-full";
  if (/already exists and is not an empty directory/i.test(text)) return "exists";
  if (/could not resolve host|connection refused|connection timed out|network is unreachable|couldn't connect to server|ssl connect error|operation timed out|temporary failure in name resolution/i.test(text)) {
    return "network";
  }
  return "local";
}

/** "unreachable" is the only access value left once `denied` is ruled out, so every non-auth failure lands there — but the MESSAGE still says what actually happened; "check your network" is reserved for the one kind that is. */
function gitFailureMessage(kind: Exclude<GitFailureKind, "denied">, result: ExecResult): string {
  switch (kind) {
    case "missing-binary":
      return "This Mac cannot run git. Install it, then try again.";
    case "disk-full":
      return "This Mac is out of disk space. Free some up, then try again.";
    case "exists":
      return "The team's folder is already there and is not empty. Remove it, then try again.";
    case "network":
      return "rt could not reach the team repo, so check your network and try again.";
    case "local":
      return `git could not clone the team repo (exit ${result.code}): ${withoutUrls(`${result.stdout}\n${result.stderr}`.trim())}`;
  }
}

function gitAccessResult(pointer: InvitePointer, result: ExecResult): JoinResult {
  const kind = classifyGitFailure(result);
  if (kind === "denied") return deniedResult(pointer);
  return unreachableResult(teamRefFrom(pointer), gitFailureMessage(kind, result));
}

function accessFromVerdict(v: RepoAccessVerdict, pointer: InvitePointer): { access: JoinResult["access"]; message: string } {
  const joining = `Joining ${pointer.name}, owned by ${pointer.owner}.`;
  const forge = forgeLabel(forgeFromRemote(pointer.remote)?.provider);
  switch (v.kind) {
    case "ok":
      return { access: "ok", message: joining };
    case "no-clt":
      return { access: "deferred", message: `${joining} rt checks your access to the team repo once Apple's Command Line Tools are installed.` };
    case "no-account":
      return { access: "no-account", message: `${joining} Connect your ${forge} account so rt can reach the team repo.` };
    case "denied":
      return { access: "denied", message: `${joining} Your ${forge} account cannot see the team repo yet. Ask ${pointer.owner} or your org admin for read access.` };
    case "unreachable":
      return { access: "unreachable", message: `${joining} rt could not reach the team repo: ${v.detail}. It checks again when you join.` };
    default:
      return { access: "undetermined", message: `${joining} rt could not tell yet whether you can see the team repo: ${v.detail}. It checks again when you join.` };
  }
}

export async function joinDryRun(p: Probes, relay: RelayClient, code: string): Promise<JoinResult> {
  const { idHex, key } = decodeCode(code);

  const pointer = await fetchPointer(relay, idHex, key);
  if (pointer === null) {
    return { ...unreachableResult(NO_TEAM, "rt could not reach the invite service. Check your network, then try again."), intent: "not-written" };
  }

  assertOnlyTeam(p, pointer.team);

  const confirmedHost = readUserIntegrationOverrides().forgeHost ?? null;
  const verdict = await probeTeamRepoAccess(p, pointer.remote, await forgeTokenLookupForRemote(p, pointer.remote, confirmedHost));
  writeIntent(p, { v: 1, at: p.now().toISOString(), mode: "join", join: { id: idHex, keyB64: Buffer.from(key).toString("base64"), pointer } });
  return { team: teamRefFrom(pointer), ...accessFromVerdict(verdict, pointer), peering: "idle", intent: "written" };
}

export interface JoinRedeemOpts {
  code?: string;
}

export type SecretsSeamsFactory = (slug: string) => SecretsSeams;

export interface JoinRedeemSeams {
  ageKeySeam: AgeKeySeam;
  read: SettingsReader;
  readTeamSecret: typeof readTeamSecret;
  forgeLogin: typeof forgeLogin;
  /** The forge token rt holds for `remote`'s host, or null: a fresh machine's git and gh/glab have nothing of their own to offer a private team repo. */
  forgeToken: (p: Probes, remote: string) => Promise<string | null>;
  /** Whether `writeLocalSecret` can succeed now (the home repo's recipients file and the age key both exist). Checked before the redeem whenever the invite carries a board token for the team's switchboard. */
  localStoreReady: () => Promise<boolean>;
  /** Stores a per-member secret in the LOCAL rt domain (never the team store): the switchboard board token belongs to this machine's member alone. */
  writeLocalSecret: (key: string, value: string) => Promise<void>;
  /** Machine-scope settings write. The board reads its switchboard URL only from `board.switchboardUrl`, so a stored token with no URL there peers nothing. */
  writeMachineSetting: (key: string, value: unknown) => void;
  /** User-scope settings write, for the `rt.integrations` latch rt's own setup rows read. */
  writeUserSetting: (key: string, value: unknown) => void;
  /** `message` is the log text; `shown` is what a person reads, and a warning without it shows its message. */
  warn: (message: string, shown?: ShownWarning) => void;
}

/** Degrades to `undefined` on a resolver-layer throw rather than taking the redeem down with it — mirrors invite.ts's own default reader. */
function defaultRead(): SettingsReader {
  return <T>(key: string): T | undefined => {
    try {
      return getSetting<T>(key).value;
    } catch {
      return undefined;
    }
  };
}

function defaultWarn(message: string, shown?: ShownWarning): void {
  warnLine("team", message, { show: shown ?? { title: message } });
}

function sameUrl(a: string, b: string): boolean {
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

/** Writes the URL the stored switchboard token belongs to where the board looks for it. False (with a warning) when the write fails, so peering is never reported applied for a board that cannot reach its switchboard. */
function pointBoardAt(seams: JoinRedeemSeams, url: string): boolean {
  try {
    seams.writeMachineSetting("board.switchboardUrl", url);
    return true;
  } catch (err) {
    seams.warn(`board peering: stored the switchboard token but could not set board.switchboardUrl (${err instanceof Error ? err.message : String(err)})`, { title: "rt could not point your board at the team's switchboard", hint: "the join result says how to set it" });
    return false;
  }
}

/**
 * Confirms the switchboard URL for rt's own setup rows (`account.switchboard`
 * is required whenever the team declares one, and reads unconfirmed until
 * `rt.integrations.switchboardUrl` names it). Redeeming the invite is the
 * user's own act, and a token sealed into it or minted against the declared
 * URL is what `rt setup switchboard connect --host` records by hand; the
 * probe behind the row is unauthenticated either way. A URL the user
 * confirmed to something else is never overwritten, and a failed write only
 * costs that row: the board's own URL and token are already in place.
 */
function confirmSwitchboardForRt(seams: JoinRedeemSeams, url: string): void {
  const remedy = `rt setup switchboard connect --host ${url}`;
  try {
    const overrides = readUserIntegrationOverrides({ read: seams.read, warn: seams.warn });
    // A latch the rows themselves would ignore (empty, not https) is as good as unset.
    const confirmed = overrides.switchboardUrl && isValidHttpsUrl(overrides.switchboardUrl) ? overrides.switchboardUrl : undefined;
    if (confirmed !== undefined && sameUrl(confirmed, url)) return;
    if (confirmed !== undefined) {
      seams.warn(`switchboard: rt's setup rows are confirmed for ${confirmed}, not this team's ${url}; leaving that alone. To switch: ${remedy}`, { title: "rt's setup still points at a different switchboard", hint: "left as it is", next: out.cmd(remedy) });
      return;
    }
    seams.writeUserSetting("rt.integrations", { ...overrides, switchboardUrl: url });
  } catch (err) {
    seams.warn(`switchboard: could not confirm ${url} for rt's setup rows (${err instanceof Error ? err.message : String(err)}); confirm it yourself: ${remedy}`, { title: "rt could not record the team's switchboard for setup", next: out.cmd(remedy) });
  }
}

export function realJoinRedeemSeams(): JoinRedeemSeams {
  const ageKeySeam = createRealAgeKeySeam();
  return {
    ageKeySeam,
    read: defaultRead(),
    readTeamSecret,
    forgeLogin,
    forgeToken: storedForgeToken,
    localStoreReady: () => personalStoreReady({ ageKeySeam, execSeam: createRealSecretsExecSeam() }),
    writeLocalSecret: (key, value) => writeSecret("rt", key, value, { ageKeySeam, execSeam: createRealSecretsExecSeam() }),
    writeMachineSetting: (key, value) => setSetting(key, value, "machine"),
    writeUserSetting: (key, value) => setSetting(key, value, "user"),
    warn: defaultWarn,
  };
}

interface PeeringOutcome {
  peering: JoinResult["peering"];
  peeringFix?: string;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Stores a board token rt now holds and points the board at it. A failed store throws the resumable error rather than finishing without it. */
async function storeBoardToken(seams: JoinRedeemSeams, pointer: InvitePointer, url: string, token: string): Promise<PeeringOutcome> {
  try {
    await seams.writeLocalSecret("switchboardToken", token);
  } catch (err) {
    throw new JoinPeeringStoreError(
      `You joined ${pointer.name}, but rt could not save your board's switchboard token. Join again to finish; you do not need a new code.`,
      scrub(errorText(err), token),
    );
  }
  const outcome: PeeringOutcome = pointBoardAt(seams, url)
    ? { peering: "applied" }
    : { peering: "unavailable", peeringFix: `Point your board at the team's switchboard yourself: rt settings set board.switchboardUrl '"${url}"' --scope machine` };
  confirmSwitchboardForRt(seams, url);
  return outcome;
}

/**
 * Only the team's OWN declared switchboard is ever trusted: the pointer is
 * invite-supplied, so its url must never receive the admin token (SSRF) and
 * its token must never be stored against a different switchboard than the
 * one the board will actually call.
 */
async function peerBoard(
  p: Probes,
  seams: JoinRedeemSeams,
  secrets: SecretsSeamsFactory,
  pointer: InvitePointer,
  declaredUrl: string | undefined,
  handle: string,
): Promise<PeeringOutcome> {
  const reinvite: PeeringOutcome = {
    peering: "unavailable",
    peeringFix: `Ask ${pointer.owner} to invite ${handle} again and join with the new invite, or ask them to invite your board again from the board's members panel.`,
  };

  // Team-declared, so unverified: a non-https URL would carry the admin token
  // in cleartext, and the board refuses to boot on one once it is stored.
  if (declaredUrl && !isValidHttpsUrl(declaredUrl)) {
    seams.warn(`board peering: the team declares switchboard "${declaredUrl}", which is not an https URL; skipping peering`, { title: "The team's switchboard address is not secure", hint: "board peering was skipped; the team owner has to fix it" });
    return { peering: "unavailable", peeringFix: "The team's switchboard address must be https, so the team's owner has to fix it in the team settings." };
  }

  if (pointer.switchboard?.token) {
    // The owner pre-minted this board's token at invite time (a fresh joiner
    // cannot decrypt team secrets yet, so the sealed pointer is the only
    // channel that works on a first join).
    if (declaredUrl && pointer.switchboard.url === declaredUrl) return storeBoardToken(seams, pointer, declaredUrl, pointer.switchboard.token);
    seams.warn("board peering: the invite's switchboard does not match the team's declared one; refusing its token", { title: "This invite's switchboard is not the team's", hint: "its board token was not used" });
    return reinvite;
  }

  if (!declaredUrl) return { peering: "idle" };

  // Fallback for re-joins by members whose age key is already a team-secrets
  // recipient; a first join cannot decrypt the admin token and lands on
  // unavailable.
  let token: unknown;
  try {
    const adminToken = await seams.readTeamSecret(pointer.team, "rt", "switchboardAdminToken", secrets(pointer.team));
    if (!adminToken) return reinvite;
    // The switchboard's admin register route: an upsert that mints (or
    // rotates) this member's board token.
    const res = await p.fetch(`${declaredUrl}/boards`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ username: handle }),
    });
    if (res.status < 200 || res.status >= 300) return reinvite;
    try {
      token = (JSON.parse(res.body) as { token?: unknown })?.token;
    } catch {
      /* an unparsable register reply reads as no token */
    }
  } catch (err) {
    if (err instanceof UserActionableError) logFailureDetail(err);
    seams.warn(`board peering: could not register this board (${errorText(err)})`, {
      title: "rt could not register your board with the team's switchboard",
      hint: errorText(err).split("\n")[0] || undefined,
      ...(err instanceof UserActionableError && err.next ? { next: out.cmd(err.next) } : {}),
    });
    return reinvite;
  }
  if (typeof token !== "string" || !token) return reinvite;
  return storeBoardToken(seams, pointer, declaredUrl, token);
}

interface JoinSource {
  idHex: string;
  key: Uint8Array;
  pointer: InvitePointer;
}

function base64ToKey(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function isJoinSource(v: JoinSource | JoinResult): v is JoinSource {
  return "idHex" in v;
}

/** The saved intent as a resume anchor for THIS exact invite — matched on id, not merely on presence, so an unrelated stale intent can never be mistaken for the one currently being redeemed. */
function matchingJoinIntent(p: Probes, idHex: string): JoinSource | undefined {
  const intent = readIntent(p);
  if (intent?.mode !== "join" || !intent.join || intent.join.id !== idHex) return undefined;
  return { idHex, key: base64ToKey(intent.join.keyB64), pointer: intent.join.pointer };
}

async function resolveSource(p: Probes, relay: RelayClient, code: string | undefined): Promise<JoinSource | JoinResult> {
  if (code) {
    const { idHex, key } = decodeCode(code);
    let pointer: InvitePointer | null;
    try {
      pointer = await fetchPointer(relay, idHex, key);
    } catch (err) {
      // The relay already marked this exact invite redeemed on a PRIOR run of
      // this same join (a reply-post or key-exchange failure after redeem
      // succeeded) — re-typing the same code must resume, not dead-end on a
      // code that is only "gone" because it already worked once.
      const resumed = err instanceof UserActionableError && err.code === "invite-unknown" ? matchingJoinIntent(p, idHex) : undefined;
      if (resumed) {
        return { ...resumed, pointer: validatePointer(resumed.pointer) };
      }
      throw err;
    }
    // Returned straight out of joinRedeem, before writeIntent runs, so this
    // one must say plainly that nothing was persisted.
    if (pointer === null) return unreachableResult(NO_TEAM, "rt could not reach the invite service. Check your network, then try again.", "not-written");
    return { idHex, key, pointer };
  }

  const intent = readIntent(p);
  if (intent?.mode !== "join" || !intent.join) {
    throw new UserActionableError("no-join-intent", "There is no invite in progress", {}, { why: "Run the join and paste the invite code when it asks.", next: "rt team join" });
  }
  const pointer = validatePointer(intent.join.pointer);
  return { idHex: intent.join.id, key: base64ToKey(intent.join.keyB64), pointer };
}

function readOrigin(p: Probes, dir: string): string | null {
  const raw = p.readFile(join(dir, ".git", "config"));
  return raw !== null ? parseOriginUrl(raw) : null;
}

export async function joinRedeem(
  p: Probes,
  relay: RelayClient,
  secrets: SecretsSeamsFactory,
  opts: JoinRedeemOpts,
  seams: JoinRedeemSeams = realJoinRedeemSeams(),
): Promise<JoinResult> {
  const resolved = await resolveSource(p, relay, opts.code);
  if (!isJoinSource(resolved)) return resolved;
  const { idHex, key, pointer } = resolved;
  assertNotRealStoreInTest(join(p.home, ".mattstack", "teams", pointer.team, "mattstack", "settings.team.jsonc"));
  assertOnlyTeam(p, pointer.team);

  // Checkpointed BEFORE any clone/redeem attempt (not just on the dry-run
  // path) so a mid-flow failure below — relay unreachable, reply failed, the
  // keychain locked — leaves something a bare `rt team join` (no code) can
  // resume from, since the relay will no longer serve this code once
  // `relay.redeem` succeeds.
  writeIntent(p, { v: 1, at: p.now().toISOString(), mode: "join", join: { id: idHex, keyB64: Buffer.from(key).toString("base64"), pointer } });

  const dir = join(p.home, ".mattstack", "teams", pointer.team);

  // Ordering is the point: the clone creates ~/.mattstack/teams/<slug>, which
  // is what the daemon's teams/ watcher fires on. Recording after the clone
  // races that watcher for the mode of the engine it starts. Every exit below
  // that leaves this call without a usable clone at `dir` restores the value
  // read here rather than hardcoding false: this call's own pointer can name
  // a slug some earlier, genuinely successful join already owns (a stale or
  // mistyped code resolving to the same slug with a different remote), and
  // that prior join must not be flipped back into push mode by a failure that
  // has nothing to do with it.
  const priorLocal = readTeamLocal(p, pointer.team);
  const priorJoined = priorLocal.joinedByRt;
  // A machine that created this team is redeeming a code for its own repo
  // (the `alreadyCloned` branch below, matching origin), so it must stay a
  // pusher, so this stamp is skipped rather than flipping it pull-only.
  if (!priorLocal.createdByRt) updateTeamLocal(p, pointer.team, { joinedByRt: true });

  // The same confirmed-host gate the dry-run applies: `pointer.remote` is
  // attacker-controlled, so the stored token is offered only to an
  // unspoofable forge or the one host the user confirmed themselves — the
  // seam is not even consulted otherwise, so no seam impl can leak it.
  const confirmedHost = readUserIntegrationOverrides({ read: seams.read, warn: seams.warn }).forgeHost ?? null;
  const token = mayOfferToken(pointer.remote, confirmedHost) ? await seams.forgeToken(p, pointer.remote) : null;
  const existingOrigin = p.exists(dir) ? readOrigin(p, dir) : null;
  let alreadyCloned = false;

  if (existingOrigin !== null) {
    if (stripUserinfo(existingOrigin) !== stripUserinfo(pointer.remote)) {
      updateTeamLocal(p, pointer.team, { joinedByRt: priorJoined });
      throw new UserActionableError("team-remote-mismatch", `The ${pointer.team} team is already on this Mac with a different repo`, {}, {
        why: "Remove its folder to join again, or sort it out by hand.",
        log: dir,
      });
    }
    alreadyCloned = true;
  } else {
    p.mkdirp(join(p.home, ".mattstack", "teams"));
    const git = gitWithToken(["clone", pointer.remote, dir], token, GIT_ENV, { remote: pointer.remote });
    const clone = await p.exec(git.argv, { env: git.env });
    if (clone.code !== 0) {
      updateTeamLocal(p, pointer.team, { joinedByRt: priorJoined });
      return gitAccessResult(pointer, clone);
    }
  }

  // Identity resolution runs BEFORE relay.redeem, deliberately: this is the
  // one precondition that can only be checked once the team is cloned
  // (it reads the just-cloned settings file), so it has to happen here rather
  // than earlier — but it must still happen before the invite is consumed.
  // An unresolvable forge login is refused while the code is still redeemable
  // (a genuine pre-flight failure, exit 2 per R-T18-d), never after — that
  // would be the exact half-state R-T18-b exists to prevent.
  const snapshot = readTeamSnapshot(p, pointer.team, { read: seams.read, warn: seams.warn });
  const declaredUrl = snapshot.integrations.switchboard?.url;
  // A sealed board token is stored only in the personal secrets store, and
  // once the redeem runs this code can never be fetched again: refuse while
  // the store cannot take it.
  const sealedToken = declaredUrl && isValidHttpsUrl(declaredUrl) && pointer.switchboard?.token && pointer.switchboard.url === declaredUrl;
  if (sealedToken && !(await seams.localStoreReady())) {
    throw new UserActionableError(
      "secrets-store-not-ready",
      "The team is on this Mac, but this Mac's secrets are not set up yet. Set them up, then join again; you do not need a new code.",
      {},
      { why: "Your board's switchboard token needs somewhere to go.", next: "rt home init" },
    );
  }
  const forge = snapshot.integrations.forge ?? forgeFromRemote(pointer.remote) ?? undefined;
  // The snapshot was just cloned from the inviter's repo, so its declared
  // forge host is as untrusted as the pointer: it gets a token only if the
  // gate would offer one in its own right, and then the FORGE host's own
  // token — the clone credential belongs to pointer.remote's host and is
  // never forwarded across hosts, even between two trusted ones.
  const loginToken = forge && mayOfferTokenToHost(forge.host, confirmedHost)
    ? await seams.forgeToken(p, tokenLookupRemoteForHost(forge.host))
    : null;
  const handle = forge ? await seams.forgeLogin(p, forge.provider, forge.host, loginToken) : null;
  if (!handle) {
    const cli = forge?.provider === "gitlab" ? "glab" : "gh";
    throw new UserActionableError("forge-login-unknown", `rt could not tell who you are on ${cli === "glab" ? "GitLab" : "GitHub"}. The invite has not been used yet.`, {}, {
      why: `Sign in to the ${cli} command line tool, then join again.`,
      next: `${cli} auth login`,
      log: `the team is cloned at ${dir}`,
    });
  }

  let redeemed: "redeemed" | "already";
  try {
    redeemed = await relay.redeem(idHex);
  } catch (err) {
    if (isRelayConnectivityError(err)) {
      return unreachableResult(
        teamRefFrom(pointer),
        "The team is on this Mac, but rt could not reach the invite service to finish. Join again once it is reachable; you do not need a new code.",
      );
    }
    throw err;
  }
  // A resumed run whose clone already landed already won the redeem race on
  // a prior attempt — "already" here is the crash-recovery signal, not a
  // real conflict, so only a FRESH clone treats it as one.
  if (redeemed === "already" && !alreadyCloned) {
    throw inviteUnknownError("That invite was already used", `Ask ${pointer.owner} for a new one.`);
  }

  const { peering, peeringFix } = await peerBoard(p, seams, secrets, pointer, declaredUrl, handle);

  let publicKey: string;
  try {
    ({ publicKey } = await ensureAgeKey(seams.ageKeySeam));
  } catch (err) {
    throw new JoinKeyExchangeError(
      `You joined ${pointer.name}, but rt could not read this Mac's secrets key. Join again to finish; you do not need a new code.`,
      scrub(err instanceof Error ? err.message : String(err)),
    );
  }
  updateTeamLocal(p, pointer.team, { agePublicKey: publicKey });

  const blob = await sealReply({ v: 1, agePublicKey: publicKey, handle }, key, idHex);
  try {
    await relay.reply(idHex, blob);
  } catch (err) {
    if (isRelayConnectivityError(err)) {
      return {
        team: teamRefFrom(pointer),
        access: "ok",
        peering,
        ...(peeringFix !== undefined ? { peeringFix } : {}),
        message: `Joined ${pointer.name}, but rt could not send your key back to ${pointer.owner}. Join again once the invite service is reachable; you do not need a new code.`,
        intent: "written",
      };
    }
    throw err;
  }

  clearIntent(p);
  const peeringHint = peeringFix !== undefined ? ` Your board is not connected yet. ${peeringFix}` : "";
  return {
    team: teamRefFrom(pointer),
    access: "ok",
    peering,
    ...(peeringFix !== undefined ? { peeringFix } : {}),
    message: `Joined ${pointer.name}, owned by ${pointer.owner}.${peeringHint}`,
    intent: "written",
  };
}
