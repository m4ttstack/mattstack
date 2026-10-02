/**
 * rt repos register — add repo paths to the global index, optionally
 * granting background tracking in the same call.
 *
 *   rt repos register <path…> [--track live|poll] [--caches branches,project-mrs] [--json]
 *
 * All-or-nothing: every path is resolved and verified as a real git repo
 * before ANY write happens, so a bad path among several never leaves an
 * earlier one half-registered (indexed but missing the tracking grant the
 * same call asked for).
 *
 * Used standalone and by the apply engine's repos.clone step.
 */

import { execFileSync } from "child_process";
import { realpathSync } from "fs";
import { homedir } from "os";
import { basename } from "path";
import type { CommandContext } from "../lib/command-tree.ts";
import { getKnownRepos, pruneRepoIndex, updateRepoIndexAsync, type PrunedEntry } from "../lib/repo-index.ts";
import { deriveRepoIdentity, serializeIdentity } from "../lib/settings/identity.ts";
import { CACHE_KINDS, loadMachineRepoTrackingRaw, parseCachesArg, saveRepoTrackingRaw, type CacheKind, type TrackingMode } from "../lib/repo-tracking.ts";
import { envelope } from "../lib/setup/contract.ts";
import { UserActionableError, exitUserError } from "../lib/errors.ts";
import { findLocateCandidates, parseRefusalText } from "../lib/repo-locate.ts";
import { locateMovedRepo } from "../lib/repo-locate-dispatch.ts";
import { tryResolveRepoArg } from "../lib/repo-arg.ts";
import { repoLabel, repoLabelQualified } from "../lib/repo-label.ts";
import { daemonQuery } from "../lib/daemon-client.ts";
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import type { RepoStatusRow } from "../packages/rt-client/src/commands.ts";

export interface RegisterDeps {
  /** The --json envelope line only; human text goes through lib/ui/out.ts. */
  print: (s: string) => void;
}

export function realRegisterDeps(): RegisterDeps {
  return { print: (s) => out.payload(`${s}\n`) };
}

const USAGE = "usage: rt repos register <path…> [--track live|poll] [--caches branches,project-mrs] [--json]";

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

/** `jsonMessage` is the envelope's error text and never changes; a person gets the question and the command. */
function refuseUsage(deps: RegisterDeps, json: boolean, verb: string, jsonMessage: string, title: string, usage: string, why?: string): never {
  if (json) exitUserError(new UserActionableError("usage", jsonMessage), true, verb, deps.print);
  out.fail(usageFailure(title, usage, why));
  process.exit(2);
}

/** Strips --track/--caches/--json (and their values); every remaining non-flag token is a path. */
function positionalPaths(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--track" || a === "--caches") {
      i++;
      continue;
    }
    if (a.startsWith("--")) continue;
    result.push(a);
  }
  return result;
}

function resolveRealpath(inputPath: string): string | null {
  try {
    return realpathSync(inputPath);
  } catch {
    return null;
  }
}

function isGitRepo(path: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: path, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export async function reposRegister(args: string[], _ctx: CommandContext = {}, deps: RegisterDeps = realRegisterDeps()): Promise<void> {
  const json = args.includes("--json");
  const track = flagValue(args, "--track");
  const cachesArg = flagValue(args, "--caches");
  let paths = positionalPaths(args);

  if (paths.length === 0) {
    const picked =
      process.stdin.isTTY && !json && !process.env.RT_BATCH ? await pickRegisterTarget() : undefined;
    if (picked === undefined) {
      refuseUsage(deps, json, "repos register", USAGE, "Which repo?", USAGE);
    }
    if (picked === null) process.exit(0);
    paths = [picked];
  }
  if (track !== undefined && track !== "live" && track !== "poll") {
    refuseUsage(deps, json, "repos register", `--track must be "live" or "poll" (got "${track}")`, "Tracking is live or poll", USAGE, `You passed "${track}".`);
  }

  let caches: CacheKind[] | null = null;
  if (track) {
    caches = parseCachesArg(cachesArg ?? "branches");
    if (!caches) {
      refuseUsage(
        deps,
        json,
        "repos register",
        `unknown cache name in "${cachesArg}" (valid: ${CACHE_KINDS.join(", ")})`,
        "rt does not know that cache",
        USAGE,
        `"${cachesArg}" is not one of ${CACHE_KINDS.join(", ")}.`,
      );
    }
  }

  // Validation pass FIRST, no writes yet: a bad path later in the list must
  // never leave an earlier one indexed without the tracking grant this same
  // call asked for.
  const resolved: { name: string; real: string; identity: string }[] = [];
  for (const inputPath of paths) {
    const real = resolveRealpath(inputPath);
    if (real === null) {
      exitUserError(new UserActionableError("bad-path", `There is no folder at ${inputPath}`), json, "repos register", deps.print);
    }
    if (!isGitRepo(real)) {
      exitUserError(
        new UserActionableError("not-a-git-repo", `${inputPath} is not a git repo`, {}, { why: "rt can only register a folder that git tracks." }),
        json,
        "repos register",
        deps.print,
      );
    }
    // deriveRepoIdentity only shells out to git for the remote — read-only,
    // so it belongs in the validation pass alongside the other checks.
    const identity = serializeIdentity(await deriveRepoIdentity(real));
    resolved.push({ name: basename(real), real, identity });
  }

  type Registered = { name: string; path: string; tracking: { mode: TrackingMode; caches: CacheKind[] } | null };
  const registered: Registered[] = [];
  // A read-modify-write must start from the RAW machine map, never a merged
  // loadRepoTracking() read — writing that back would erase every other
  // repo's raw entry (a typo'd mode, or an explicit off-marker) that this
  // call never meant to touch.
  const rawTracking = track ? loadMachineRepoTrackingRaw() : null;

  for (const { name, real, identity } of resolved) {
    // A refused move leaves the row naming the gone path, so printing
    // "registered" (or a JSON ok envelope) here would tell a script the repo
    // is indexed at `real` when nothing points there.
    const indexed = await updateRepoIndexAsync(identity, real);
    if (!indexed.ok) {
      exitUserError(
        new UserActionableError("locate-failed", `rt could not move ${name} to ${real}: ${indexed.error}`, {}, {
          why: "rt knows it at a folder that is gone, and moving its records did not finish.",
          ...(indexed.next ? { next: indexed.next } : {}),
        }),
        json,
        "repos register",
        deps.print,
      );
    }

    let tracking: Registered["tracking"] = null;
    if (track && caches && rawTracking) {
      tracking = { mode: track, caches };
      rawTracking[identity] = tracking;
    }
    registered.push({ name, path: real, tracking });
  }

  if (rawTracking) saveRepoTrackingRaw(rawTracking);

  if (json) {
    deps.print(JSON.stringify(envelope({ registered })));
    return;
  }
  out.print(
    ...registered.map((r) => out.line("done", `Registered ${r.name}`, r.tracking ? `${r.path} · tracking ${r.tracking.mode} (${r.tracking.caches.join(", ")})` : r.path)),
  );
}

/**
 * No `<path…>`: offer the git repos discovered under `rt.repoRoots` that are
 * not yet indexed. `undefined` when the scan turns up none (the caller falls
 * through to the usage error, never an empty picker); `null` when cancelled.
 */
async function pickRegisterTarget(): Promise<string | null | undefined> {
  const candidates = getKnownRepos().filter((r) => r.registered === false && r.worktrees[0]);
  if (candidates.length === 0) return undefined;

  const { filterableSelect } = await import("../lib/pick-wrappers.ts");
  return filterableSelect({
    message: "Which repo should rt register?",
    options: candidates.map((r) => ({
      value: r.worktrees[0]!.path,
      label: r.worktrees[0]!.path.replace(homedir(), "~"),
      hint: r.repoName,
    })),
    stderr: true,
  });
}

// ─── prune ───────────────────────────────────────────────────────────────────

const PRUNE_USAGE = "usage: rt repos prune [--dry-run] [--json]";

function describeReason(r: PrunedEntry): string {
  return r.reason === "duplicate" ? `same folder as ${r.keptAs}` : "its folder is gone";
}

/** What the retired name's data did, as a trailing clause. Refusals are named one by one: they are the only outcome that leaves the person something to do. */
function describeDataMove(r: PrunedEntry, dryRun: boolean): string {
  const d = r.data;
  if (!d) return "";
  const carried = d.moved.length + d.merged.length;
  const parts: string[] = [];
  if (carried > 0) parts.push(`${dryRun ? "would carry" : "carried"} ${carried} file${carried === 1 ? "" : "s"} to ${r.keptAs}`);
  if (d.merged.length > 0) parts.push(`merged ${d.merged.join(", ")}`);
  if (d.registry === "moved") parts.push(`${dryRun ? "would move" : "moved"} its worktrees to ${r.keptAs}`);
  if (d.registry === "merged") parts.push(`${dryRun ? "would merge" : "merged"} its worktrees into ${r.keptAs}'s`);
  if (d.registry === "refused") parts.push(`${r.keptAs}'s worktrees could not be written, so both were kept`);
  if (d.refused.length > 0) parts.push(`kept both copies of ${d.refused.join(", ")}`);
  return parts.length > 0 ? `; ${parts.join("; ")}` : "";
}

export function pruneBlocks(removed: PrunedEntry[], dryRun: boolean): Block[] {
  if (removed.length === 0) return [out.line("skipped", "Nothing to prune", "every repo rt knows is still there")];
  const blocks: Block[] = [];
  for (const r of removed) {
    const where = r.path.replace(homedir(), "~");
    const label = repoLabel(r.repoName);
    if (!r.retained) {
      const dropped = r.registry === "dropped" ? `; ${dryRun ? "would drop" : "dropped"} its worktree list, which only named folders that are gone` : "";
      blocks.push(out.line(dryRun ? "pending" : "done", `${dryRun ? "Would remove" : "Removed"} ${label}`, `${where} · ${describeReason(r)}${describeDataMove(r, dryRun)}${dropped}`));
    } else if (r.reason !== "missing") {
      blocks.push(out.line("warn", `Kept ${label}`, `${where} · ${describeReason(r)}, but not all of its data could move${describeDataMove(r, dryRun)}`));
    } else if (r.registry === "busy") {
      blocks.push(out.line("warn", `Kept ${label}`, `${where} · ${describeReason(r)}, and rt was busy and could not clear its worktree list`), out.callout("next", out.cmd("rt repos prune")));
    } else {
      blocks.push(
        out.line("needs-you", `Kept ${label}`, `${where} · ${describeReason(r)}, but it still has worktrees on record`),
        out.callout("next", out.cmd(`${r.hint ?? "rt repos locate"} <new-path> --repo ${r.repoName}`)),
      );
    }
  }
  return blocks;
}

/**
 * rt repos prune — drop index rows that no longer name anything: a path that
 * has stopped existing, and the losing half of every realpath collision left
 * behind by a repo rename.
 *
 * `getKnownRepos` already hides both from the picker; this is the deliberate
 * eviction, kept an explicit verb because it also carries the retired name's
 * data dir onto the surviving name — moving one repo's data onto another is
 * not something to infer from a derived-name change nobody asked about.
 */
export async function reposPrune(args: string[], _ctx: CommandContext = {}, deps: RegisterDeps = realRegisterDeps()): Promise<void> {
  const json = args.includes("--json");
  const dryRun = args.includes("--dry-run");

  for (const a of args) {
    if (a.startsWith("--") && a !== "--json" && a !== "--dry-run") {
      refuseUsage(deps, json, "repos prune", `unknown flag "${a}" — ${PRUNE_USAGE}`, `This command has no option called ${a}`, PRUNE_USAGE);
    }
  }

  const removed = pruneRepoIndex({ dryRun });

  if (json) {
    deps.print(JSON.stringify(envelope({ removed, dryRun })));
    return;
  }
  out.print(...pruneBlocks(removed, dryRun));
}

// ─── locate ──────────────────────────────────────────────────────────────────

const LOCATE_USAGE = "usage: rt repos locate [<new-path>] [--repo <id|name>] [--dry-run] [--json]";
const LOCATE_FLAGS = ["--json", "--dry-run", "--repo"];

/** Every non-flag token that is not `--repo`'s value. */
function locatePositionals(args: string[]): string[] {
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--repo") {
      i++;
      continue;
    }
    if (a.startsWith("--")) continue;
    positionals.push(a);
  }
  return positionals;
}

/** `--repo`'s value as an identity, or a failure worded for this verb; `resolveRepoArg`'s own messages name the flag and are shared with other verbs. */
async function resolveLocateRepo(arg: string, json: boolean, deps: RegisterDeps): Promise<string> {
  const resolution = await tryResolveRepoArg(arg);
  if (resolution.kind === "resolved") return resolution.identity;
  const err =
    resolution.kind === "ambiguous"
      ? new UserActionableError("repo-unknown", `"${arg}" could be more than one repo`, {}, {
          why: `It matches ${resolution.matches.join(", ")}.`,
          next: "rt repos locate <new-path> --repo <identity>",
        })
      : new UserActionableError("repo-unknown", `rt does not know a repo called "${arg}"`, {}, { why: "Name a repo rt has registered, or run this from inside one." });
  return exitUserError(err, json, "repos locate", deps.print);
}

/**
 * rt repos locate — tell rt where a repo moved to.
 *
 * A folder move keeps the repo identity but leaves every stored path stale.
 * The daemon owns the apply whenever it answers; a local apply only happens
 * when nothing is up to race.
 */
export async function reposLocate(args: string[], _ctx: CommandContext = {}, deps: RegisterDeps = realRegisterDeps()): Promise<void> {
  const json = args.includes("--json");
  const dryRun = args.includes("--dry-run");
  for (const a of args) {
    if (a.startsWith("--") && !LOCATE_FLAGS.includes(a)) {
      refuseUsage(deps, json, "repos locate", `unknown flag "${a}" — ${LOCATE_USAGE}`, `This command has no option called ${a}`, LOCATE_USAGE);
    }
  }

  const repoArg = flagValue(args, "--repo");
  if (args.includes("--repo") && (repoArg === undefined || repoArg.startsWith("--"))) {
    refuseUsage(deps, json, "repos locate", `--repo needs a value — ${LOCATE_USAGE}`, "Which repo moved?", LOCATE_USAGE, "The repo option needs a name.");
  }
  const repo = repoArg ? await resolveLocateRepo(repoArg, json, deps) : undefined;

  const positionals = locatePositionals(args);
  if (positionals.length > 1) {
    refuseUsage(
      deps,
      json,
      "repos locate",
      `locate takes one path, got ${positionals.length} (${positionals.join(", ")}) — ${LOCATE_USAGE}`,
      "One folder at a time",
      LOCATE_USAGE,
      `You passed ${positionals.length}: ${positionals.join(", ")}.`,
    );
  }

  const newPath = positionals[0] ?? (await pickLocateTarget(json, deps));

  const outcome = await locateMovedRepo({ newPath, ...(repo ? { repo } : {}), dryRun });
  if (!outcome.ok) {
    const refusal = parseRefusalText(outcome.error);
    if (refusal && !json) {
      out.note(out.line("refused", refusal.message));
      process.exit(2);
    }
    exitUserError(new UserActionableError("refused", outcome.error, {}, { why: outcome.why, next: outcome.next }), json, "repos locate", deps.print);
  }

  if (outcome.dryRun) {
    const p = outcome.plan;
    if (json) {
      deps.print(JSON.stringify(envelope({ plan: p, dryRun: true })));
      return;
    }
    out.print(
      out.line("pending", `Would move ${repoLabel(p.identity)}`, `${p.oldPath} → ${p.newPath}`),
      out.kv("index rows", p.indexKeys.join(", ")),
      out.kv("worktree records", String(p.registryRewrites.reduce((n, r) => n + r.movedPaths.length, 0))),
      out.kv("endpoint claims", String(p.claimRewrites.length)),
      out.kv("worktrees to repair", p.gitRepairPaths.length === 0 ? "the main one only" : p.gitRepairPaths.join(", ")),
    );
    return;
  }

  const r = outcome.result;
  if (json) {
    deps.print(JSON.stringify(envelope({ located: r, via: outcome.via })));
    return;
  }
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  out.print(
    out.line("done", `Moved ${repoLabel(r.identity)}`, `${r.from} → ${r.to}`),
    out.kv("updated", `${count(r.treesRewritten, "worktree record")}, ${count(r.claimsRewritten, "endpoint claim")}, ${count(r.repaired.length, "tree")} repaired`),
    ...r.stalePaths.map((stale) => out.line("stale", "Left an old record for rt to clean up", stale)),
    ...r.legacyRows.map((row) =>
      row.outcome === "collapsed" ? out.line("done", `Folded in the old entry ${row.key}`) : out.line("warn", `Kept the old entry ${row.key}`, row.reason || "not all of its data could move"),
    ),
  );
}

/**
 * No `<new-path>`: propose, never auto-pick. One candidate still asks; several
 * open a picker; none is a hard stop that names what is lost.
 */
async function pickLocateTarget(json: boolean, deps: RegisterDeps): Promise<string> {
  const lost = getKnownRepos({ includeMissing: true }).filter((r) => r.missing);
  if (lost.length === 0) {
    if (json) deps.print(JSON.stringify(envelope({ lost: [], candidates: [] })));
    else out.fail({ title: "No repo is missing", why: "Every repo rt knows is where it should be." });
    process.exit(1);
  }

  const candidates = await findLocateCandidates();
  if (candidates.length === 0 || !process.stdin.isTTY) {
    if (json) {
      deps.print(JSON.stringify(envelope({ lost: lost.map((r) => ({ repo: r.repoName, path: r.worktrees[0]?.path })), candidates })));
    } else {
      out.fail(
        usageFailure(
          "Which folder did it move to?",
          LOCATE_USAGE,
          candidates.length === 0 ? "rt could not find it by itself." : "rt found folders it could be, and cannot ask which one without a terminal.",
        ),
        out.section("Missing repos", undefined, out.table(lost.map((r) => [repoLabel(r.repoName), out.dim(`last seen at ${r.worktrees[0]?.path ?? "an unknown folder"}`)]))),
      );
    }
    process.exit(1);
  }

  if (candidates.length === 1) {
    const only = candidates[0]!;
    const { confirm } = await import("../lib/rt-render.ts");
    const ok = await confirm({ message: `Locate ${only.identity} at ${only.path}?`, stderr: true });
    if (!ok) process.exit(0);
    return only.path;
  }

  const { filterableSelect } = await import("../lib/pick-wrappers.ts");
  const picked = await filterableSelect({
    message: "Which directory did it move to?",
    options: candidates.map((c) => ({ value: c.path, label: c.path, hint: c.identity })),
    stderr: true,
  });
  if (!picked) process.exit(0);
  return picked;
}

// ─── status ──────────────────────────────────────────────────────────────────

function failPlain(json: boolean, verb: string, message: string): never {
  if (json) console.log(JSON.stringify({ ok: false, error: message }));
  else console.error(`rt ${verb}: ${message}`);
  process.exit(1);
}

/**
 * rt repos status: the mission-control rail feed over the daemon's git
 * badge cache. Uses the plain daemon-RPC envelope ({ ok, repos, sweptAt }),
 * not the setup contract the other verbs in this file use: it is a cache
 * read the mission-control TUI consumes directly, not a mutating action.
 */
export async function reposStatus(
  args: string[],
  deps: { query?: typeof daemonQuery } = {},
): Promise<void> {
  const json = args.includes("--json");
  const refresh = args.includes("--refresh");
  const query = deps.query ?? daemonQuery;
  const res = refresh
    ? await query("repos:status", { refresh: true }, 120_000)
    : await query("repos:status", {});
  if (res === null) failPlain(json, "repos status", "daemon unavailable, the rt daemon must be running for repo status");
  if (!res.ok) failPlain(json, "repos status", res.error ?? "repos:status failed");
  const data = res.data as { repos: RepoStatusRow[]; sweptAt: string | null };
  if (json) {
    console.log(JSON.stringify({ ok: true, repos: data.repos, sweptAt: data.sweptAt }));
    return;
  }
  if (data.repos.length === 0) {
    console.log("no repo badges yet (the sweep runs shortly after daemon boot; try --refresh)");
    return;
  }
  for (const row of data.repos) {
    console.log(repoLabelQualified(row.repo));
    if (row.error) console.log(`  sweep error: ${row.error}`);
    for (const w of row.worktrees) {
      const dirt = w.clean
        ? "clean"
        : [
            w.staged ? `${w.staged} staged` : "",
            w.unstaged ? `${w.unstaged} unstaged` : "",
            w.untracked ? `${w.untracked} untracked` : "",
            w.conflicted ? `${w.conflicted} conflicted` : "",
          ].filter(Boolean).join(", ");
      const pos = [
        w.ahead ? `ahead ${w.ahead}` : "",
        w.behind ? `behind ${w.behind}` : "",
      ].filter(Boolean).join(", ");
      console.log(`  ${w.branch ?? "(detached)"}  ${dirt}${pos ? `  [${pos}]` : ""}  ${w.worktree}`);
    }
  }
}
