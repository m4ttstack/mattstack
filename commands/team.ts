import { activeTeam, decideActiveTeam, type RosterEntry } from "../packages/rt-client/src/settings/active-team.ts";
import { useTeam, type UseTeamSeams } from "../lib/team/use.ts";
import type { ApplyContext } from "../lib/setup/apply.ts";
import type { SecretsSeams } from "../lib/secrets/store.ts";
import type { SecretPresence } from "../lib/setup/validators/accounts.ts";
import { orgStoreFile } from "../lib/team/org-store.ts";
import { rosterFrom } from "../packages/rt-client/src/settings/active-team.ts";
import { activeTeamFor } from "../lib/team/active-team.ts";
import { roleFor, rolesFor } from "../lib/team/roles.ts";
/**
 * rt team create|publish|rename|invite|join|members|status: the team-repo
 * lifecycle verbs.
 *
 *   rt team create <name> [--first-team <name>] (--remote <url> | --create-repo <owner>) [--others] [--json]
 *   rt team publish [--team <slug>] --remote <url> [--json]
 *   rt team rename <name> [--team <org>] [--json]
 *   rt team invite --handle <h> [--teams <team>[,<team>]] [--team <org>] [--require-peering] [--json]
 *   rt team join [--dry-run] [--json]   (code on stdin as {"code":"..."}, or a prompt on a TTY)
 *   rt team members sync [--team <slug>] [--json]
 *   rt team members remove <handle> [--key <age1...>] [--team <slug>] [--json]
 *   rt team status [--team <slug>] [--json]
 *   rt team peer [--team <slug>] [--rotate] [--json]
 *
 * Every mutating path funnels through one `UserActionableError` → exit-2
 * envelope, via `exitUserError` (lib/errors.ts), including a locked
 * keychain or a `members sync`/`members remove` re-encryption rollback: the
 * user can act on either (unlock, retry), so both get a distinct `code` and
 * exit 2 rather than an envelope-shaped body at exit 1, which the app's
 * decoder (envelope only at exit 2) could never have used.
 */

import { join } from "path";
import type { AgeKeySeam } from "../lib/home/age-key.ts";
import { createRealAgeKeySeam } from "../lib/home/age-key.ts";
import { promptSecret } from "../lib/prompt-secret.ts";
import { orgDirUnder, orgSettingsPath } from "../lib/rt-paths.ts";
import { createRealTeamSecretsSeams } from "../lib/secrets/team-store.ts";
import { getSetting } from "../lib/settings/resolve.ts";
import { listOrgs, parseStoreText, readStore, TEAM_NAME_RE } from "../lib/settings/stores.ts";
import { envelope } from "../lib/setup/contract.ts";
import * as out from "../lib/ui/out.ts";
import type { Block, RenderStatus } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import { warn } from "../lib/ui/warn.ts";
import { UserActionableError, exitUserError, logFailureDetail } from "../lib/errors.ts";
import { createRealProbes, readStdinJson, type Probes } from "../lib/setup/probes.ts";
import { readTeamSnapshot, stripUserinfo, type SettingsReader } from "../lib/setup/team-settings.ts";
import { forgeLogin } from "../lib/team/forge.ts";
import { addTeam, type AddTeamSeams } from "../lib/team/add.ts";
import { setSetting } from "../lib/settings/write.ts";
import { loadStepSource, resolvePluginRoots } from "../lib/skills/sources.ts";
import { createTeam } from "../lib/team/create.ts";
import { extractInviteCode } from "../lib/team/invite-crypto.ts";
import { mintInvite, realMintInviteSeams, type InviteResult, type MintInviteSeams } from "../lib/team/invite.ts";
import { readTeamLocal, updateTeamLocal } from "../lib/team/team-local.ts";
import { JoinKeyExchangeError, JoinPeeringStoreError, joinDryRun, joinRedeem, realJoinRedeemSeams, type JoinRedeemSeams, type JoinResult } from "../lib/team/join.ts";
import { canonicalHandle, readPeeredBoards, realReadLocalSecret, type ReadLocalSecret } from "../lib/team/board-peers.ts";
import { MembersKeyError, MembersSyncAbortedError, membersRemove, membersSetTeams, membersSync, realMembersSeams, teamRemote, type BoardPeeringOutcome, type MembersSeams, type MembersRemoveResult, type MembersSyncResult } from "../lib/team/members.ts";
import { peerOwnBoard, realPeerSeams, type PeerResult, type PeerSeams } from "../lib/team/peer.ts";
import { publishTeam } from "../lib/team/publish.ts";
import { renameOrg, type ConvergeOutcome, type RenameResult, type RenameSeams } from "../lib/team/rename.ts";
import { commitPendingPackShares, droppedShareBlocks, droppedShares, packShareBlocks, rememberPackShare, sharePack } from "../lib/team/share-pack.ts";
import { storedForgeToken } from "../lib/team/stored-forge-token.ts";
import { createRelayClient } from "../lib/team/relay-client.ts";
import { checkedOutBranch } from "../lib/team/org-branch.ts";
import { switchboardUrl } from "../packages/rt-client/src/switchboard.ts";
import type { CommandContext } from "../lib/command-tree.ts";
import { daemonQuery } from "../lib/daemon-client.ts";
import type { TeamSnapshotEntry } from "../lib/daemon/team-snapshots.ts";

export interface TeamDeps {
  useTeamSeams?: UseTeamSeams;
  secrets?: SecretsSeams;
  secretPresence?: SecretPresence;
  /** Tests must resolve a fixture executable instead of the installed app. */
  deckPath?: (p: Probes) => string | null;
  selectTeam?: (choices: string[]) => Promise<string | null>;
  mintInvite?: typeof mintInvite;
  addTeamSeams?: AddTeamSeams;
  membersSeams?: MembersSeams;
  probes: Probes;
  /** The --json envelope line only; human text goes through lib/ui/out.ts. */
  print: (s: string) => void;
  exit?: (code: number) => never;
  ageKeySeam?: AgeKeySeam;
  /** `json` gates the interactive TTY prompt: a machine caller must never block waiting on a terminal that isn't there. */
  readCode?: (json: boolean) => Promise<string>;
  /** Overrides `joinRedeem`'s `read`/`readTeamSecret`/`forgeLogin`/`warn` seams, real by default, so a test never has to rely on the isolated test HOME happening to lack a team switchboard admin token. */
  joinRedeemSeams?: Partial<JoinRedeemSeams>;
  /** Overrides `mintInvite`'s seams; real by default. */
  mintInviteSeams?: Partial<MintInviteSeams>;
  /** Overrides `teamStatus`'s `board.title`/`mattstack.roster` reads; real by default, so a test never has to seed a real settings store just to check envelope shape. */
  statusRead?: SettingsReader;
  /** The forge token rt holds for a remote's host, the real store by default. */
  forgeToken?: typeof storedForgeToken;
  /** The daemon round trip `teamPull`/`teamStatus` use for the team-snapshot verbs (`team:pull`, `team:snapshot-status`); real `daemonQuery` by default. */
  daemon?: (cmd: string, payload: unknown, timeoutMs?: number) => Promise<unknown>;
  /** The rt-ui confirm, seamed so a test never spawns the helper. */
  confirm?: (message: string) => Promise<boolean>;
  /** The TTY gate, seamed for the same reason. */
  interactive?: () => boolean;
  /** An rt-scope secret (the switchboard tokens `teamStatus`, `teamPeer` and `members remove` read); real store by default. */
  readLocalSecret?: ReadLocalSecret;
  /** Overrides `peerOwnBoard`'s seams; real by default, with `readLocalSecret` above as its secret reader. */
  peerSeams?: Partial<PeerSeams>;
  /** Overrides `renameOrg`'s seams; real by default. */
  renameSeams?: Partial<RenameSeams>;
}

async function defaultReadCode(json: boolean): Promise<string> {
  if (!json && process.stdin.isTTY) {
    const raw = await promptSecret("Invite code");
    return extractInviteCode(raw) ?? raw;
  }
  const parsed = await readStdinJson<{ code?: string }>();
  if (!parsed?.code) {
    throw new UserActionableError("usage", 'pass the invite code on stdin as {"code": "..."}');
  }
  const raw = parsed.code;
  return extractInviteCode(raw) ?? raw;
}

export function realTeamDeps(): TeamDeps {
  return { probes: createRealProbes(), print: (s) => out.payload(`${s}\n`), exit: process.exit, ageKeySeam: createRealAgeKeySeam(), readCode: defaultReadCode };
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

/**
 * `--key`-only: also accepts `--key=age1...`, unlike every other flag in
 * this file (a repo-wide `flagValue` gap, out of scope to fix generally
 * here). `--key` is the one flag whose wrong fallback has security
 * consequences: an unrecognized `--key=...` token would otherwise vanish
 * silently and `membersRemove` would fall back to whatever key the roster
 * happens to record, which is exactly the substitution an operator typing
 * `--key=` to be explicit is trying to rule out.
 */
function keyFlagValue(args: string[]): string | undefined {
  const inline = args.find((a) => a.startsWith("--key="));
  return inline ? inline.slice("--key=".length) : flagValue(args, "--key");
}

/** Strips every recognized flag (and its value) so what's left is positional, and an unrecognized token stays visible instead of silently vanishing. */
function positional(args: string[], valueFlags: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (valueFlags.includes(a)) {
      i++;
      continue;
    }
    if (a.startsWith("--")) continue;
    result.push(a);
  }
  return result;
}

/** `--json` gets the same exit-2 envelope a real failure gets; a person gets the question and the command. */
function usageError(deps: TeamDeps, json: boolean, title: string, usage: string): never {
  if (json) exitUserError(new UserActionableError("usage", `usage: ${usage}`), true, deps.print);
  out.fail(usageFailure(title, usage));
  process.exit(2);
}

/** rt declining by policy rather than failing: a person reads a refused line, never a failure block. */
const REFUSAL_CODES = new Set([
  "not-on-team",
  "team-pull-only",
  "not-rt-created",
  "team-already-set-up",
  "code-on-argv",
  "own-key-removal-refused",
  "team-exists",
  "team-remote-mismatch",
  "org-first-team-set",
  "invite-off-main",
  "org-detached",
  "peer-needs-admin",
  "board-registered-elsewhere",
  "rename-not-admin",
  "rename-same-name",
  "rename-name-taken",
  "org-not-converged",
  "org-uncommitted",
  "org-behind",
]);

/** `--json` and every non-refusal take exitUserError's route, so the envelope and the exit code never depend on the code. */
function exitTeamError(err: UserActionableError, json: boolean, deps: TeamDeps): never {
  if (json || !REFUSAL_CODES.has(err.code)) exitUserError(err, json, deps.print);
  logFailureDetail(err);
  out.note(
    out.line("refused", err.message),
    ...(err.why ? [out.callout("why", err.why)] : []),
    ...(err.next ? [out.callout("next", out.cmd(err.next))] : []),
  );
  process.exit(2);
}

export async function teamAdd(args: string[], _ctx: CommandContext = {}, deps: TeamDeps = realTeamDeps()): Promise<void> {
  const json = args.includes("--json");
  const team = positional(args, ["--owner", "--team"])[0];
  const owners = (flagValue(args, "--owner") ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");
  if (!team || owners.length === 0) {
    usageError(deps, json, "Name the new team and who owns it", "rt team add <team> --owner <username>[,<username>] [--json]");
  }
  try {
    const org = resolveTeamSlug(args, "team add");
    const result = addTeam(deps.probes, { org, team, owners }, deps.addTeamSeams ?? realAddTeamSeams());
    const sharePaths = [`mattstack/teams/${team}`, ".claude-plugin/marketplace.json"];
    rememberPackShare(deps.probes, org, team, sharePaths);
    const published = await sharePack(deps.probes, org, team, sharePaths, deps.forgeToken ?? storedForgeToken);
    if (json) {
      deps.print(JSON.stringify(envelope({ ...result, published })));
      return;
    }
    out.print(
      out.line("done", `Added the ${team} team`, `owned by ${owners.join(", ")}`),
      ...packShareBlocks(team, published),
      out.callout("next", [`Put people on it with `, out.cmd(`rt team members set <username> --teams ${team}`)]),
    );
  } catch (err) {
    if (err instanceof UserActionableError) exitTeamError(err, json, deps);
    throw err;
  }
}

function realAddTeamSeams(): AddTeamSeams {
  return {
    writeOrgSetting: (key, value) => setSetting(key, value, "org"),
    engineDescription: (engine) => {
      try { return loadStepSource(engine, resolvePluginRoots()).description; }
      catch { return null; }
    },
  };
}

export async function teamCreate(args: string[], _ctx: CommandContext = {}, deps: TeamDeps = realTeamDeps()): Promise<void> {
  const json = args.includes("--json");
  const others = args.includes("--others");
  const remote = flagValue(args, "--remote") ?? null;
  const createRepoOwner = flagValue(args, "--create-repo");
  const firstTeam = flagValue(args, "--first-team");
  let name = positional(args, ["--remote", "--create-repo", "--first-team"])[0];

  if (!name) {
    if (process.stdin.isTTY && !json && !process.env.RT_BATCH) {
      const { textInput } = await import("../lib/rt-render.ts");
      name = await textInput({ message: "Team name", placeholder: "Platform Team" });
      if (!name) process.exit(0);
    } else {
      usageError(deps, json, "What should the team be called?", "rt team create <name> [--first-team <name>] (--remote <url> | --create-repo <owner>) [--others] [--json]");
    }
  }

  try {
    const result = await createTeam(deps.probes, { name, remote, createRepoOwner, others, firstTeam }, deps.ageKeySeam, { forgeLogin, forgeToken: deps.forgeToken ?? storedForgeToken });
    const peered = result.created ? await autoPeer(deps, result.slug) : null;
    if (json) {
      deps.print(JSON.stringify(envelope(result)));
      return;
    }
    out.print(
      result.created
        ? out.line("done", `Created the ${result.slug} org`, result.remote)
        : out.line("skipped", `The ${result.slug} org is already set up`, result.remote),
      ...(result.rolesDeferred ? [out.callout("next", "Connect your forge account in Setup so rt can make you this org's admin")] : []),
      ...(peered ? peerBlocks(peered) : []),
    );
  } catch (err) {
    if (err instanceof UserActionableError) exitTeamError(err, json, deps);
    throw err;
  }
}

function peerSeamsFor(deps: TeamDeps): PeerSeams {
  return { ...realPeerSeams(), ...(deps.readLocalSecret ? { readLocalSecret: deps.readLocalSecret } : {}), ...deps.peerSeams };
}

/** A creator holding the admin token gets their board connected with the org; anything that goes wrong is a warning, never a failed create. */
async function autoPeer(deps: TeamDeps, slug: string): Promise<PeerResult | null> {
  try {
    return await peerOwnBoard(deps.probes, slug, { rotate: false }, peerSeamsFor(deps));
  } catch (err) {
    if (err instanceof UserActionableError && err.code === "peer-needs-admin") return null;
    const why = err instanceof UserActionableError ? err.why : undefined;
    warn("team", `board peering after create: ${err instanceof Error ? err.message : String(err)}`, {
      show: { title: "The org is ready, but rt could not connect your board", hint: why, next: out.cmd("rt team peer") },
    });
    return null;
  }
}

export function peerBlocks(result: PeerResult): Block[] {
  return [
    result.outcome === "connected"
      ? out.line("done", "Connected your board to the switchboard", result.username)
      : out.line("skipped", "Your board is already connected to the switchboard", result.username),
    ...(result.outcome === "connected" && result.boardEnvOverrides
      ? [out.callout("fix", "Your board's .env sets its own SWITCHBOARD_TOKEN, which the board reads first. Remove that line so the board uses this one.")]
      : []),
  ];
}

export async function teamPeer(args: string[], _ctx: CommandContext = {}, deps: TeamDeps = realTeamDeps()): Promise<void> {
  const json = args.includes("--json");
  try {
    const slug = resolveTeamSlug(args, "team peer");
    const result = await peerOwnBoard(deps.probes, slug, { rotate: args.includes("--rotate") }, peerSeamsFor(deps));
    if (json) {
      deps.print(JSON.stringify(envelope(result)));
      return;
    }
    out.print(...peerBlocks(result));
  } catch (err) {
    if (err instanceof UserActionableError) exitTeamError(err, json, deps);
    throw err;
  }
}

/** `--team` omitted falls back to the one org clone on this Mac. */
function resolveTeamSlug(args: string[], verb: string): string {
  const explicit = flagValue(args, "--team");
  if (explicit) return explicit;

  const orgs = listOrgs();
  if (orgs.length === 0) {
    throw new UserActionableError("no-team", "This Mac has no team yet", {}, { next: "rt team create" });
  }
  if (orgs.length > 1) {
    throw new UserActionableError("ambiguous-team", `This Mac has more than one team: ${orgs.join(", ")}`, {}, { next: `rt ${verb} --team <slug>` });
  }
  return orgs[0]!;
}

const PULL_TIMEOUT_MS = 180_000;

const PULL_COPY: Record<string, { status: RenderStatus; title: (slug: string) => string }> = {
  "up-to-date": { status: "done", title: (slug) => `The ${slug} team is already up to date` },
  "fast-forwarded": { status: "done", title: (slug) => `Pulled the ${slug} team` },
  rebased: { status: "done", title: (slug) => `Pulled the ${slug} team` },
  conflict: { status: "needs-you", title: (slug) => `The ${slug} team has changes that clash with yours` },
  skipped: { status: "skipped", title: (slug) => `Skipped pulling the ${slug} team` },
};

export async function teamPull(args: string[], _ctx: CommandContext = {}, deps: TeamDeps = realTeamDeps()): Promise<void> {
  const json = args.includes("--json");
  try {
    const slug = resolveTeamSlug(args, "team pull");
    const call = deps.daemon ?? daemonQuery;
    // A pull is a network fetch plus a rebase; the client default (2s, sized
    // for status reads) aborts mid-pull and reports an unreachable daemon for
    // a pull that then succeeds.
    const res = (await call("team:pull", { slug }, PULL_TIMEOUT_MS)) as
      | { ok: boolean; data?: { outcome: string; detail: string | null }; error?: string; failure?: { code: string; message: string } }
      | null;
    if (!res) {
      throw new UserActionableError("daemon-unreachable", "The rt daemon is not running", {}, {
        why: "It pulls team changes for you. You can also pull with git in the team's folder.",
        next: "rt daemon start",
      });
    }
    if (!res.ok || !res.data) {
      throw new UserActionableError(res.failure?.code ?? "team-pull-failed", res.failure?.message ?? res.error ?? "team pull failed");
    }
    if (json) {
      deps.print(JSON.stringify(envelope({ slug, outcome: res.data.outcome, detail: res.data.detail })));
      return;
    }
    const outcome = res.data.outcome;
    const copy = PULL_COPY[outcome];
    if (copy) {
      out.print(out.line(copy.status, copy.title(slug), res.data.detail ?? undefined));
    } else {
      const hint = res.data.detail ? `outcome: ${outcome}, ${res.data.detail}` : `outcome: ${outcome}`;
      out.print(out.line("warn", `The ${slug} team pull ended in a way rt does not recognize`, hint));
    }
  } catch (err) {
    if (err instanceof UserActionableError) exitTeamError(err, json, deps);
    throw err;
  }
}

async function applyContextFor(deps: TeamDeps): Promise<ApplyContext> {
  const { createApplyContext } = await import("../lib/setup/apply.ts");
  const { createRealSecretsExecSeam } = await import("../lib/secrets/store.ts");
  const { realSecretPresence } = await import("../lib/setup/plan.ts");
  return createApplyContext({
    probes: deps.probes,
    emit: () => {},
    secrets: deps.secrets ?? { ageKeySeam: deps.ageKeySeam ?? createRealAgeKeySeam(), execSeam: createRealSecretsExecSeam() },
    relay: createRelayClient(deps.probes.fetch, switchboardUrl(deps.probes.env)),
    secretPresence: deps.secretPresence ?? realSecretPresence(),
    flags: { nonInteractive: true, teamOfOne: false, ci: false, update: true },
  });
}

async function convergeHere(deps: TeamDeps): Promise<ConvergeOutcome> {
  const { convergeOrgFolder } = await import("../lib/setup/steps/org-folder.ts");
  return convergeOrgFolder(await applyContextFor(deps));
}

export function renameBlocks(result: RenameResult): Block[] {
  const here = result.converged
    ? [out.line("done", `This Mac's org folder is now ${result.to}`)]
    : [
        result.convergeState === "partial"
          ? out.line("needs-you", "This Mac's org folder moved, with one step left for you", result.convergeDetail)
          : out.line("needs-you", "This Mac's org folder has not moved yet", result.convergeDetail),
        (result.convergeRemedy ? out.callout("fix", result.convergeRemedy) : out.callout("next", out.cmd("rt setup update --force"))),
      ];
  return [
    out.line("done", `Renamed your org to ${result.to}`, `was ${result.from}`),
    ...here,
    out.callout("note", ["Your teammates' Macs follow at their next update, or now with ", out.cmd("rt setup update --force")]),
  ];
}

function realRenameSeams(deps: TeamDeps): RenameSeams {
  return { forgeToken: deps.forgeToken ?? storedForgeToken, converge: () => convergeHere(deps), ...deps.renameSeams };
}

export async function teamRename(args: string[], _ctx: CommandContext = {}, deps: TeamDeps = realTeamDeps()): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const to = positional(args, ["--team"])[0];
  if (!to) usageError(deps, json, "What should your org be called?", "rt team rename <name> [--json]");
  try {
    const from = resolveTeamSlug(args, "team rename");
    const result = await renameOrg(deps.probes, from, to, realRenameSeams(deps));
    if (json) {
      deps.print(JSON.stringify(envelope({ ok: true, from: result.from, to: result.to, converged: result.converged })));
      return;
    }
    out.print(...renameBlocks(result));
  } catch (err) {
    if (err instanceof UserActionableError) exitTeamError(err, json, deps);
    throw err;
  }
}

export async function teamPublish(args: string[], _ctx: CommandContext = {}, deps: TeamDeps = realTeamDeps()): Promise<void> {
  const json = args.includes("--json");
  const remote = flagValue(args, "--remote") ?? null;

  try {
    const slug = resolveTeamSlug(args, "team publish");
    const target = remote ?? teamRemote(deps.probes, slug);
    const pending = await commitPendingPackShares(deps.probes, slug);
    if (!json && pending.skipped.length > 0) out.note(...droppedShareBlocks(pending.skipped));
    const token = target ? await (deps.forgeToken ?? storedForgeToken)(deps.probes, target) : null;
    const result = await publishTeam(deps.probes, slug, remote, { token, tokenRemote: target });
    if (json) {
      deps.print(JSON.stringify(envelope({ ...result, ...droppedShares(pending.skipped) })));
      return;
    }
    out.print(
      out.line("done", `Pushed the ${slug} team`, result.remote),
      ...pending.committed.map((pack) => out.line("done", `Shared the ${pack} pack with your org`)),
    );
  } catch (err) {
    if (err instanceof UserActionableError) exitTeamError(err, json, deps);
    throw err;
  }
}

/**
 * The link and the message are copy blocks: a person pastes them, so they are
 * never wrapped or indented. The paste block is built by rt from the team's
 * own title; nothing an invitee controls reaches it.
 */
export function inviteBlocks(handle: string, result: InviteResult): Block[] {
  const blocks: Block[] = [out.copy(result.link, "invite link"), out.copy(result.pasteBlock, "message to send")];
  if (result.forgeAccess !== "granted") {
    blocks.push(out.line("needs-you", `${handle} cannot see the team repo yet`, `forge access: ${result.forgeAccess}`));
    if (result.manualSteps.length > 0) blocks.push(out.callout("fix", ...result.manualSteps));
  }
  return blocks;
}

function joinStatus(result: JoinResult): RenderStatus {
  if (result.access === "denied" || result.access === "no-account") return "needs-you";
  if (result.access === "deferred") return "pending";
  if (result.access !== "ok" || result.peering === "unavailable") return "warn";
  return "done";
}

export function joinBlocks(result: JoinResult): Block[] {
  return [out.line(joinStatus(result), result.message), ...(result.teams.length > 0 ? [out.kv("teams", result.teams.join(", "))] : [])];
}

export function membersSyncBlocks(result: MembersSyncResult): Block[] {
  const added = result.added.length;
  return [
    added > 0 ? out.line("done", `Added ${added} ${added === 1 ? "key" : "keys"}`) : out.line("skipped", "No new keys to add"),
    ...(result.pending.length > 0 ? [out.line("pending", "Still waiting on a reply", result.pending.join(", "))] : []),
    ...(result.reencrypted.length > 0 ? [out.line("done", "Locked the team's secrets to the new keys", result.reencrypted.join(", "))] : []),
  ];
}

const BOARD_LINES: Record<BoardPeeringOutcome, [RenderStatus, string]> = {
  revoked: ["done", "Disconnected their board"],
  "not-peered": ["skipped", "Their board was not connected"],
  "left-peered": ["needs-you", "Their board is still connected"],
  failed: ["failed", "Could not disconnect their board"],
};

function boardLine(handle: string, outcome: BoardPeeringOutcome): Block {
  const [status, title] = BOARD_LINES[outcome];
  return out.line(status, title, handle);
}

export function membersRemoveBlocks(handle: string, slug: string, result: MembersRemoveResult): Block[] {
  return [
    result.rosterRemoved
      ? out.line("done", `Removed ${handle} from the team`, `forge access: ${result.forgeAccess}`)
      : out.line("skipped", `${handle} was not on the team list`, `forge access: ${result.forgeAccess}`),
    boardLine(handle, result.boardPeering),
    ...(result.manualSteps.length > 0 ? [out.callout("fix", ...result.manualSteps)] : []),
    out.callout("note", result.residueNote),
    out.callout("next", out.cmd(`rt secrets rotate --team ${slug} <domain> <key>`)),
  ];
}

export async function teamInvite(args: string[], _ctx: CommandContext = {}, deps: TeamDeps = realTeamDeps()): Promise<void> {
  const json = args.includes("--json");
  const handle = flagValue(args, "--handle");

  if (!handle) {
    usageError(deps, json, "Who is the invite for?", "rt team invite --handle <h> [--teams <team>[,<team>]] [--team <org>] [--require-peering] [--json]");
  }

  try {
    const slug = resolveTeamSlug(args, "team invite");

    const local = readTeamLocal(deps.probes, slug);
    if (roleFor(deps.probes, slug).kind !== "admin") {
      const admins = rolesFor(deps.probes, slug).admins;
      throw new UserActionableError("team-pull-only", "Only an org admin invites", {}, {
        why: admins.length > 0 ? `Ask ${admins.join(" or ")} to invite ${handle}.` : "This org names no admins yet.",
      });
    }
    const named = (flagValue(args, "--teams") ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");
    const own = activeTeamFor(deps.probes, slug).team;
    const teams = named.length > 0 ? named : own ? [own] : [];

    const gate = deps.interactive ?? (await import("../lib/ui/gate.ts")).interactive;
    if (!json && local.createdByRt && !local.rtMayManageMembership && gate()) {
      const ask = deps.confirm ?? (async (message: string) => (await import("../lib/ui/prompts.ts")).confirm({ message }));
      if (await ask(`mattstack created this repo. Let it give ${handle} read access on the forge, and manage access for future invites?`)) {
        updateTeamLocal(deps.probes, slug, { rtMayManageMembership: true });
      }
    }

    const relay = createRelayClient(deps.probes.fetch, switchboardUrl(deps.probes.env));
    const result = await (deps.mintInvite ?? mintInvite)(
      deps.probes,
      relay,
      { slug, handle, teams, now: deps.probes.now(), requirePeering: args.includes("--require-peering") },
      { ...realMintInviteSeams(), ...deps.mintInviteSeams },
    );

    if (json) {
      deps.print(JSON.stringify(envelope(result)));
      return;
    }

    out.print(...inviteBlocks(handle, result));
  } catch (err) {
    if (err instanceof UserActionableError) exitTeamError(err, json, deps);
    throw err;
  }
}

/**
 * The permission is machine-local and never synced, so this is the only
 * non-interactive door to it. `on` is refused rather than ignored where rt did
 * not create the repo: rt does not administer a repo it was pointed at.
 */
export async function teamManageMembership(args: string[], _ctx: CommandContext = {}, deps: TeamDeps = realTeamDeps()): Promise<void> {
  const json = args.includes("--json");
  const state = positional(args, ["--team"])[0];
  if (state !== undefined && state !== "on" && state !== "off") {
    usageError(deps, json, "Choose on or off", "rt team manage-membership [on|off] [--team <slug>] [--json]");
  }

  try {
    const slug = resolveTeamSlug(args, "team manage-membership");
    const before = readTeamLocal(deps.probes, slug);
    if (state === "on" && !before.createdByRt) {
      throw new UserActionableError("not-rt-created", `mattstack did not create the ${slug} team's repo, so it will not manage who can see it`, {}, {
        why: "Whoever runs that repo gives people access.",
      });
    }

    const record = state === undefined ? before : updateTeamLocal(deps.probes, slug, { rtMayManageMembership: state === "on" });

    if (json) {
      deps.print(JSON.stringify(envelope({ slug, mayManage: record.rtMayManageMembership, offerable: record.createdByRt })));
      return;
    }
    out.print(
      ...(record.rtMayManageMembership
        ? [out.line("done", `Invites to ${slug} give read access on the forge`, "membership management is on")]
        : [
            out.line("off", `Invites to ${slug} leave forge access to you`, "membership management is off"),
            record.createdByRt
              ? out.callout("next", out.cmd("rt team manage-membership on"))
              : out.callout("note", "mattstack did not create this repo, so this cannot be turned on"),
          ]),
    );
  } catch (err) {
    if (err instanceof UserActionableError) exitTeamError(err, json, deps);
    throw err;
  }
}

export async function teamJoin(args: string[], _ctx: CommandContext = {}, deps: TeamDeps = realTeamDeps()): Promise<void> {
  const json = args.includes("--json");
  const dryRun = args.includes("--dry-run");
  const extra = positional(args, ["--dry-run", "--json"]);

  try {
    if (extra.length > 0) {
      throw new UserActionableError("code-on-argv", "rt never takes an invite code as an argument", {}, {
        why: "It would land in your shell history. Run the join on its own and paste the code when it asks.",
        next: "rt team join",
      });
    }

    const code = await (deps.readCode ?? defaultReadCode)(json);
    const relay = createRelayClient(deps.probes.fetch, switchboardUrl(deps.probes.env));

    let result: JoinResult;
    if (dryRun) {
      result = await joinDryRun(deps.probes, relay, code);
    } else {
      // ageKeySeam is resolved LAST and always from TeamDeps.ageKeySeam first (the field teamCreate also uses), never
      // from realJoinRedeemSeams' own default, so a test-injected fake never lets a real redeem touch the actual keychain,
      // and never silently loses to a joinRedeemSeams override that didn't set one.
      const seams: JoinRedeemSeams = {
        ...realJoinRedeemSeams(),
        ...deps.joinRedeemSeams,
        ageKeySeam: deps.ageKeySeam ?? deps.joinRedeemSeams?.ageKeySeam ?? createRealAgeKeySeam(),
      };
      result = await joinRedeem(deps.probes, relay, createRealTeamSecretsSeams, { code }, seams);
    }

    if (json) {
      deps.print(JSON.stringify(envelope(result)));
      return;
    }
    out.print(...joinBlocks(result));
  } catch (err) {
    // The exit code must stay 2: the app's envelope decoder reads no other
    // code, so a different one would hide this message.
    if (err instanceof JoinKeyExchangeError) {
      const failure = new UserActionableError("age-key-unavailable", err.message, {}, {
        why: "Check that your keychain is unlocked.",
        next: "rt team join",
        ...(err.detail ? { log: err.detail } : {}),
      });
      return exitUserError(failure, json, deps.print);
    }
    if (err instanceof JoinPeeringStoreError) {
      const failure = new UserActionableError("peering-store-failed", err.message, {}, {
        why: "Set up this Mac's secrets if they are not, then join again.",
        next: "rt home init",
        ...(err.detail ? { log: err.detail } : {}),
      });
      return exitUserError(failure, json, deps.print);
    }
    if (err instanceof UserActionableError) exitTeamError(err, json, deps);
    throw err;
  }
}

/** A non-UserActionableError from the members path (a rollback error from addTeamRecipient/removeTeamRecipient, a keychain failure) already carries a complete, human-readable explanation in its own message: the user can act on it (retry, unlock), so it gets its own code and the same exit-2 envelope every other actionable failure uses, rather than falling through to a raw stack trace or an envelope the app's decoder can't reach at exit 1. */
function reportMembersError(err: unknown, deps: TeamDeps, json: boolean): never {
  if (err instanceof UserActionableError) exitTeamError(err, json, deps);
  if (err instanceof MembersSyncAbortedError) {
    const failure = new UserActionableError("members-error", err.message, {}, { why: "The keys it already added stay. Run the sync again.", next: "rt team members sync", log: err.detail });
    return exitUserError(failure, json, deps.print);
  }
  if (err instanceof MembersKeyError) {
    return exitUserError(new UserActionableError("members-error", err.message, {}, { why: "Check that your keychain is unlocked, then try again.", log: err.detail }), json, deps.print);
  }
  const message = err instanceof Error ? err.message : String(err);
  return exitUserError(new UserActionableError("members-error", message), json, deps.print);
}

export async function teamMembersSync(args: string[], _ctx: CommandContext = {}, deps: TeamDeps = realTeamDeps()): Promise<void> {
  const json = args.includes("--json");

  try {
    const slug = resolveTeamSlug(args, "team members sync");
    const relay = createRelayClient(deps.probes.fetch, switchboardUrl(deps.probes.env));
    const secrets = createRealTeamSecretsSeams(slug);
    const result = await membersSync(deps.probes, relay, secrets, slug);

    if (json) {
      deps.print(JSON.stringify(envelope(result)));
      return;
    }
    out.print(...membersSyncBlocks(result));
  } catch (err) {
    reportMembersError(err, deps, json);
  }
}

/** Removable roster handles for the resolved team, from the same org roster `membersRemove` reads. Empty on an unresolved or ambiguous team or any read failure, so the picker falls through to the usage error an omitted handle always got. */
function rosterHandles(args: string[]): string[] {
  try {
    const members = readStore(orgSettingsPath(resolveTeamSlug(args, "team members remove"))).global["mattstack.roster"];
    if (!Array.isArray(members)) return [];
    return members
      .filter((m): m is { username: string } => m !== null && typeof m === "object" && typeof (m as { username?: unknown }).username === "string")
      .map((m) => m.username);
  } catch {
    return [];
  }
}

function readOrgRosterNames(p: Probes, slug: string): string[] {
  const file = orgStoreFile(p.home, slug);
  const raw = p.readFile(file);
  return raw === null ? [] : rosterFrom(parseStoreText(file, raw)).map((member) => member.username);
}

export async function teamMembersSet(args: string[], _ctx: CommandContext = {}, deps: TeamDeps = realTeamDeps()): Promise<void> {
  const json = args.includes("--json");
  let handle = positional(args, ["--teams", "--team"])[0];
  const teamsFlag = flagValue(args, "--teams");
  try {
    const slug = resolveTeamSlug(args, "team members set");
    if (!handle && process.stdin.isTTY && !json && !process.env.RT_BATCH) {
      const candidates = readOrgRosterNames(deps.probes, slug);
      if (candidates.length > 0) {
        const { filterableSelect } = await import("../lib/pick-wrappers.ts");
        const picked = await filterableSelect({ message: "Whose teams?", options: candidates.map((name) => ({ value: name, label: name })), stderr: true });
        if (!picked) process.exit(0);
        handle = picked;
      }
    }
    if (!handle || teamsFlag === undefined) {
      usageError(deps, json, "Say whose teams, and which", "rt team members set <username> --teams <team>[,<team>] [--team <org>] [--json]");
    }
    const teams = teamsFlag.split(",").map((team) => team.trim()).filter((team) => team !== "");
    const result = membersSetTeams(deps.probes, deps.membersSeams ?? realMembersSeams(), slug, handle, teams);
    if (json) {
      deps.print(JSON.stringify(envelope(result)));
      return;
    }
    out.print(out.line("done", `${result.username} is on ${result.teams.length > 0 ? result.teams.join(", ") : "no team"}`, result.previous.length > 0 ? `was on ${result.previous.join(", ")}` : undefined));
  } catch (err) {
    if (err instanceof UserActionableError) exitTeamError(err, json, deps);
    throw err;
  }
}

export async function teamMembersRemove(args: string[], _ctx: CommandContext = {}, deps: TeamDeps = realTeamDeps()): Promise<void> {
  const json = args.includes("--json");
  let handle = positional(args, ["--team", "--key"])[0];
  const key = keyFlagValue(args);

  if (!handle) {
    const roster = process.stdin.isTTY && !json && !process.env.RT_BATCH ? rosterHandles(args) : [];
    if (roster.length > 0) {
      const { filterableSelect } = await import("../lib/pick-wrappers.ts");
      const picked = await filterableSelect({
        message: "Remove which member?",
        options: roster.map((h) => ({ value: h, label: h })),
        stderr: true,
      });
      if (!picked) process.exit(0);
      handle = picked;
    } else {
      usageError(deps, json, "Which member?", "rt team members remove <handle> [--key <age1...>] [--team <slug>] [--json]");
    }
  }

  try {
    const slug = resolveTeamSlug(args, `team members remove ${handle}`);
    const secrets = createRealTeamSecretsSeams(slug);
    const result = await membersRemove(deps.probes, secrets, slug, handle, key, {
      ...(deps.membersSeams ?? realMembersSeams()),
      ...(deps.readLocalSecret ? { readLocalSecret: deps.readLocalSecret } : {}),
    });

    if (json) {
      deps.print(JSON.stringify(envelope(result)));
      return;
    }
    out.print(...membersRemoveBlocks(handle, slug, result));
  } catch (err) {
    reportMembersError(err, deps, json);
  }
}

function defaultStatusRead(): SettingsReader {
  return <T>(key: string): T | undefined => {
    try {
      return getSetting<T>(key).value;
    } catch {
      return undefined;
    }
  };
}

/**
 * `mattstack.roster` lives in the org's git-synced settings store, writable by
 * any teammate (or a bad merge), never trusted to already be an array of
 * `{username: string}` objects. A non-conforming entry is dropped rather than
 * crashing a contract verb with a raw `TypeError`, or letting a non-string
 * `username` (or an empty `{}`) leak into the envelope unfiltered.
 */
function toRosterMembers(raw: unknown, onSkipped: (skipped: number) => void): { username: string }[] {
  if (!Array.isArray(raw)) return [];

  const members: { username: string }[] = [];
  let skipped = 0;
  for (const entry of raw) {
    if (entry !== null && typeof entry === "object" && !Array.isArray(entry) && typeof (entry as Record<string, unknown>).username === "string") {
      members.push({ username: (entry as { username: string }).username });
    } else {
      skipped += 1;
    }
  }
  if (skipped > 0) onSkipped(skipped);
  return members;
}

interface TeamSyncFields {
  lastPull: string | null;
  lastPushAt: string | null;
  lastPullSkipped: string | null;
  conflicted: { at: string; detail: string } | null;
  /** Carried straight off the snapshot entry so a member can see why their clone never pushes, without a second daemon round trip. `false` for a daemon that predates the field or is unreachable, the same "absent means false" rule as the machine-local record it mirrors. */
  pullOnly: boolean;
  /** True only when the daemon answered `team:snapshot-status` and named this slug; never leaked into the JSON envelope, only used to pick the human line's "ok"/"unknown". */
  reachable: boolean;
  /** Paths the snapshot held back last round; human output only, like `reachable`. */
  heldBack: string[];
}

const NO_SYNC: TeamSyncFields = { lastPull: null, lastPushAt: null, lastPullSkipped: null, conflicted: null, pullOnly: false, reachable: false, heldBack: [] };

/** `deps.daemon?.("team:snapshot-status", {})` round trip, reduced to the five fields `teamStatus` shows for `slug`. Any failure (daemon down, malformed response, slug absent from the list) collapses to `NO_SYNC` rather than throwing; sync state is a nicety on top of the local status, never a reason to fail the whole command. */
async function readTeamSyncFields(deps: TeamDeps, slug: string): Promise<TeamSyncFields> {
  try {
    const call = deps.daemon ?? daemonQuery;
    const res = (await call("team:snapshot-status", {})) as { ok: boolean; data?: TeamSnapshotEntry[] } | null;
    if (!res || !res.ok || !res.data) return NO_SYNC;
    const entry = res.data.find((e) => e.slug === slug);
    if (!entry) return NO_SYNC;
    return {
      lastPull: entry.lastPullAt > 0 ? new Date(entry.lastPullAt).toISOString() : null,
      lastPushAt: entry.lastPushAt > 0 ? new Date(entry.lastPushAt).toISOString() : null,
      lastPullSkipped: entry.lastPullSkipped,
      conflicted: entry.conflicted ? { at: new Date(entry.conflicted.at).toISOString(), detail: entry.conflicted.detail } : null,
      pullOnly: entry.pullOnly === true,
      reachable: true,
      heldBack: entry.heldBack ?? [],
    };
  } catch {
    return NO_SYNC;
  }
}

export async function teamStatus(args: string[], _ctx: CommandContext = {}, deps: TeamDeps = realTeamDeps()): Promise<void> {
  const json = args.includes("--json");

  try {
    if (!flagValue(args, "--team") && listOrgs().length === 0) {
      const result = { mode: "solo" as const, slug: null, name: null, remote: null, lastPush: null, members: [] as never[], role: null, activeTeam: null, teams: [] as never[], orgTeams: [] as never[] };
      if (json) deps.print(JSON.stringify(envelope(result)));
      else out.print(out.line("off", "No team on this Mac", "just you"));
      return;
    }

    const slug = resolveTeamSlug(args, "team status");
    const dir = orgDirUnder(deps.probes.home, slug);
    if (!deps.probes.exists(dir)) {
      throw new UserActionableError("no-team", `The ${slug} team is not on this Mac`, {}, { next: "rt team join" });
    }

    const read = deps.statusRead ?? defaultStatusRead();
    const snapshot = readTeamSnapshot(deps.probes, slug, { read, warn: () => {} });
    const title = read<string>("board.title");
    const name = title && title.length > 0 ? title : slug;
    const active = activeTeamFor(deps.probes, slug);
    const role = roleFor(deps.probes, slug).kind;
    const teamsDir = join(dir, "mattstack", "teams");
    const orgTeams = deps.probes.readDir(teamsDir)
      .filter((team) => TEAM_NAME_RE.test(team) && deps.probes.exists(join(teamsDir, team, "settings.team.jsonc")))
      .sort();
    const rosterValue = read<unknown>("mattstack.roster");
    const everyone = Array.isArray(rosterValue) ? rosterValue : [];
    const onTeam = active.team === null ? everyone : everyone.filter((member) =>
      Array.isArray((member as { teams?: unknown } | null)?.teams) && (member as { teams: unknown[] }).teams.includes(active.team),
    );
    const members = toRosterMembers(onTeam, (skipped) =>
      warn("team", `skipped ${skipped} malformed mattstack.roster entr${skipped === 1 ? "y" : "ies"} (missing or non-string username)`, {
        show: { title: "Some team members could not be read", hint: `${skipped} left out` },
      }),
    );

    const branch = await checkedOutBranch(deps.probes, dir);
    const log = await deps.probes.exec(["git", "-C", dir, "log", "-1", "--format=%cI", `origin/${branch ?? "main"}`]);
    const lastPush = log.code === 0 ? log.stdout.trim() || null : null;

    const remote = snapshot.remote !== null ? stripUserinfo(snapshot.remote) : null;

    const { reachable, heldBack, ...sync } = await readTeamSyncFields(deps, slug);

    // null when nothing on this Mac can ask the switchboard, so "not peered"
    // is only ever said when the switchboard said it.
    const peeredBoards = await readPeeredBoards(deps.probes, deps.readLocalSecret ?? realReadLocalSecret);
    const membersWithPeering = members.map((m) => ({ ...m, peered: peeredBoards ? peeredBoards.has(canonicalHandle(m.username)) : null }));
    const peeredCount = membersWithPeering.filter((m) => m.peered === true).length;

    const result = { slug, name, remote, branch, lastPush, members: membersWithPeering, role, activeTeam: active.team, teams: active.listedOn, orgTeams, ...sync };
    if (json) {
      deps.print(JSON.stringify(envelope(result)));
      return;
    }
    const syncState = sync.conflicted !== null ? "conflict" : reachable ? "ok" : "unknown";
    const syncNotes = [
      sync.lastPullSkipped ? `the last pull was skipped: ${sync.lastPullSkipped}` : "",
      sync.pullOnly ? "this copy only pulls, it never pushes" : "",
    ].filter((note) => note !== "");
    out.print(
      out.section(
        name,
        name === slug ? undefined : slug,
        out.kv("remote", result.remote ?? "none"),
        ...(branch !== null && branch !== "main" ? [out.kv("branch", branch, "this Mac reads and publishes this branch, not main")] : []),
        out.kv("last push", lastPush ?? "never"),
        out.kv("members", String(members.length), peeredBoards ? `${peeredCount} with a connected board` : undefined),
        out.kv("your team", active.team ?? "none"),
        out.kv("your role", role === "admin" ? "org admin" : role === "owner" ? "team owner" : role === "member" ? "member" : "unknown"),
        out.kv("sync", syncState, syncNotes.length > 0 ? syncNotes.join("; ") : undefined),
        ...(sync.conflicted !== null ? [out.line("needs-you", "The team has changes that clash with yours", sync.conflicted.detail)] : []),
      ),
      ...(heldBack.length > 0
        ? [
          out.line("pending", "A new pack is not shared with your org yet", "its marketplace entry stays on this Mac until then"),
          out.callout("next", ["Share it with ", out.cmd(`rt team publish --team ${slug}`)]),
        ]
        : []),
    );
  } catch (err) {
    if (err instanceof UserActionableError) exitTeamError(err, json, deps);
    throw err;
  }
}

export async function realUseTeamSeams(deps: TeamDeps): Promise<UseTeamSeams> {
  const { bundledToolPath, resolveTool } = await import("../lib/deps/resolve.ts");
  const { claudeConfigDirs } = await import("../lib/setup/tools-install.ts");
  const { PACK_EXEC_TIMEOUT_MS } = await import("../lib/setup/pack-cache.ts");
  return {
    activeTeam: () => {
      const before = activeTeam();
      if (before.org === null) return before;
      const decision = decideActiveTeam({
        username: before.username,
        roster: getSetting<RosterEntry[]>("mattstack.roster").value ?? [],
        setting: getSetting<string>("mattstack.activeTeam").value,
        teamFolders: () => deps.probes.readDir(join(orgDirUnder(deps.probes.home, before.org!), "mattstack", "teams")),
      });
      return { ...before, ...decision };
    },
    writeUserSetting: (key, value) => { setSetting(key, value, "user"); },
    installPack: async () => {
      const { installPlugins } = await import("../lib/setup/steps/plugins.ts");
      const { materializeSkills } = await import("../lib/setup/skills-materialize.ts");
      const ctx = await applyContextFor(deps);
      const plugins = await installPlugins(ctx);
      if (plugins.state === "failed") return { ok: false, detail: plugins.detail };
      if (plugins.state === "skipped") await materializeSkills(ctx.p, {});
      return { ok: plugins.state === "done", detail: plugins.detail ?? "The packs are installed" };
    },
    setPackEnabled: async (id, enabled) => {
      const claude = resolveTool(deps.probes, "claude");
      if (claude.exec === null) return false;
      let ok = true;
      for (const dir of claudeConfigDirs(deps.probes, [])) {
        const res = await deps.probes.exec([...claude.exec, "plugin", enabled ? "enable" : "disable", id], { env: { CLAUDE_CONFIG_DIR: dir }, timeoutMs: PACK_EXEC_TIMEOUT_MS });
        if (res.code !== 0 && !(enabled ? /already enabled/i : /already disabled/i).test(res.stderr)) ok = false;
      }
      return ok;
    },
    marketplace: (org) => {
      const raw = deps.probes.readFile(join(orgDirUnder(deps.probes.home, org), ".claude-plugin", "marketplace.json"));
      if (raw !== null) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (parsed !== null && typeof parsed === "object" && "name" in parsed && typeof parsed.name === "string" && parsed.name.length > 0) return parsed.name;
        } catch {}
      }
      return org;
    },
    restartApp: async (app) => {
      const deck = deps.deckPath ? deps.deckPath(deps.probes) : bundledToolPath(deps.probes, "deck");
      return deck !== null && (await deps.probes.exec([deck, "restart", app])).code === 0;
    },
  };
}

export async function teamUse(args: string[], _ctx: CommandContext = {}, deps: TeamDeps = realTeamDeps()): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  let team = positional(args, [])[0];
  try {
    const seams = deps.useTeamSeams ?? await realUseTeamSeams(deps);
    if (!team) {
      const choices = seams.activeTeam().listedOn;
      if (choices.length > 0 && (deps.interactive?.() ?? process.stdin.isTTY) && !json && !process.env.RT_BATCH) {
        const { filterableSelect } = await import("../lib/pick-wrappers.ts");
        const picked = deps.selectTeam ? await deps.selectTeam(choices) : await filterableSelect({ message: "Which team?", options: choices.map((name) => ({ value: name, label: name })), stderr: true });
        if (!picked) process.exit(0);
        team = picked;
      } else usageError(deps, json, "Which team do you want to work as?", "rt team use <team> [--json]");
    }
    const result = await useTeam(team, seams);
    if (json) { deps.print(JSON.stringify(envelope(result))); return; }
    out.print(
      out.line("done", `You are working as the ${result.team} team`, result.previous && result.previous !== result.team ? `was ${result.previous}` : undefined),
      result.pack.enabled ? out.line("done", `The ${result.team} pack is on`) : out.line("needs-you", `The ${result.team} pack is not on yet`, result.pack.detail),
      result.pack.enabled ? out.callout("next", "Restart Claude Code sessions to pick up the new pack") : out.callout("next", out.cmd("rt setup pack")),
    );
  } catch (err) {
    if (err instanceof UserActionableError) exitTeamError(err, json, deps);
    throw err;
  }
}
