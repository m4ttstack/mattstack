/**
 * rt sync: daily workflow sync composer.
 *
 * Smart enough to detect the situation and do the right thing:
 *
 *   1. Fetch origin
 *   2. If local diverged from origin/your-branch → resetToOrigin (GitLab rebase scenario)
 *   3. If behind origin/master → rebaseOnto (daily catch-up)
 *   4. Push if anything changed (--force-with-lease)
 *
 * Usage:
 *   rt sync                  sync current worktree
 *   rt sync all              sync all worktrees with open MRs
 *   rt sync --dry-run        show what would happen
 *   rt sync --json           on conflict: emit a JSON conflict bundle, exit 3, leave rebase paused;
 *                            on a stack member: emit a JSON refusal, exit 4, touch nothing
 *   rt sync --agent          on conflict: skip the prompt, hand straight to a Claude agent in herdr
 *   rt sync --no-agent       never offer agent escalation (abort on conflict, as before)
 */

import { exec, execSync, spawnSync } from "child_process";
import * as out from "../lib/ui/out.ts";
import { getCurrentBranch, getRemoteDefaultBranch, hasUncommittedChanges } from "../lib/git-ops.ts";
import { loadSyncConfig } from "../lib/sync-config.ts";
import { deriveRepoIdentity } from "../lib/settings/identity.ts";
import { repoLabel } from "../lib/repo-label.ts";
import { rebaseOnto, type RebaseResult } from "./git/rebase.ts";
import { resetToOrigin, type ResetResult } from "./git/reset.ts";
import { syncLog } from "../lib/sync-log.ts";
import {
  STACK_REFUSAL_EXIT,
  checkStackMembership,
  createStackGuardRunners,
  renderStackRefusal,
  type StackGuardRunners,
  type StackRefusal,
} from "../lib/stack-guard.ts";
import type { CommandContext } from "../lib/command-tree.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { asError, asRefusal, drawFailure, errText, NOT_ON_A_BRANCH, plural, refusalNote, uncommittedChanges } from "./git/shared.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SyncSummary {
  branch: string;
  worktree: string;
  resetResult: ResetResult | null;
  rebaseResult: RebaseResult | null;
  pushed: boolean;
  error?: string;
  /** What a person reads when `error` is set and the stack guard did not refuse. */
  failure?: out.FailureInput;
  /** `failure` is rt's own guard declining (uncommitted changes), drawn as a refused note. */
  refused?: boolean;
  /** Set when the stack guard stopped the sync before any ref moved. */
  refusal?: StackRefusal;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function git(args: string, cwd: string): string {
  return execSync(`git ${args}`, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

/**
 * rt sync only makes sense against a remote: it fetches origin, rebases onto
 * origin/master, and pushes. A local-only repo has nothing to sync, so say so
 * and stop cleanly instead of letting `git fetch origin` fail with git's own
 * "does not appear to be a git repository".
 */
function ensureOriginRemote(cwd: string): boolean {
  const r = spawnSync("git", ["remote", "get-url", "origin"], { cwd, stdio: "pipe" });
  if (r.status === 0) return true;
  out.print(out.line("skipped", "This repo has no origin, so there is nothing to sync"), out.callout("next", ["Add one with ", out.cmd("git remote add origin <url>")]));
  return false;
}

/** Non-blocking git command, so a spinner can animate. */
function gitAsync(args: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(`git ${args}`, { cwd, encoding: "utf8" }, (err, stdout) => {
      if (err) reject(err);
      else resolve((stdout ?? "").trim());
    });
  });
}

/**
 * Check if local and origin/branch have diverged (i.e. neither is an ancestor of the other).
 */
function hasDivergedFromRemote(branch: string, cwd: string): boolean {
  const remoteBranch = `origin/${branch}`;
  try {
    git(`rev-parse --verify ${remoteBranch}`, cwd);
  } catch {
    return false; // remote branch doesn't exist — not diverged
  }

  const localSha = git("rev-parse HEAD", cwd);
  const remoteSha = git(`rev-parse ${remoteBranch}`, cwd);

  if (localSha === remoteSha) return false; // identical

  const mergeBase = git(`merge-base HEAD ${remoteBranch}`, cwd);
  // Diverged if merge-base is neither the local nor the remote SHA
  // (i.e. both sides have commits beyond the common ancestor)
  return mergeBase !== localSha && mergeBase !== remoteSha;
}

// ─── Single-branch sync ─────────────────────────────────────────────────────

export async function syncBranch(
  cwd: string,
  opts: {
    dryRun?: boolean;
    quiet?: boolean;
    onConflict?: "abort" | "pause";
    stackRunners?: StackGuardRunners;
    /** Refuse when stack membership cannot be verified (agent callers); a human run warns and proceeds. */
    strictStackCheck?: boolean;
  },
): Promise<SyncSummary> {
  // Guard: a rebase in progress comes first. getCurrentBranch returns null
  // during a rebase, which would read as a detached HEAD further down.
  try {
    const r = spawnSync("git", ["rebase", "--show-current-patch"], {
      cwd, stdio: "pipe",
    });
    if (r.status === 0) {
      return {
        branch: "HEAD",
        worktree: cwd,
        resetResult: null,
        rebaseResult: null,
        pushed: false,
        ...asError({ title: "A rebase is already in progress here", next: ["Finish it with ", out.cmd("git rebase --continue"), ", or drop it with ", out.cmd("git rebase --abort")] }),
      };
    }
  } catch { /* git too old to support --show-current-patch, ignore */ }

  const branch = getCurrentBranch(cwd);
  if (!branch) {
    return {
      branch: "HEAD",
      worktree: cwd,
      resetResult: null,
      rebaseResult: null,
      pushed: false,
      ...asError(NOT_ON_A_BRANCH),
    };
  }


  const defaultBranch = getRemoteDefaultBranch(cwd, "origin", { preferRemote: true });
  const defaultBranchName = defaultBranch?.replace("origin/", "") ?? "master";

  // Don't sync the default branch itself
  if (branch === defaultBranchName) {
    if (!opts.quiet) out.print(out.line("skipped", `${branch} is the default branch`, "nothing to sync"));
    return {
      branch,
      worktree: cwd,
      resetResult: null,
      rebaseResult: null,
      pushed: false,
    };
  }

  // Guard: refuse to sync with uncommitted changes
  if (hasUncommittedChanges(cwd)) {
    return {
      branch,
      worktree: cwd,
      resetResult: null,
      rebaseResult: null,
      pushed: false,
      ...asRefusal(uncommittedChanges("Syncing rewrites the branch, and a conflict would lose them.")),
    };
  }

  const derivedIdentity = await deriveRepoIdentity(cwd);
  const config = loadSyncConfig(derivedIdentity.kind === "remote" ? derivedIdentity.id : null);
  let resetResult: ResetResult | null = null;
  let rebaseResult: RebaseResult | null = null;
  let needsPush = false;

  syncLog.worktree(cwd, branch);

  const { createStepRunner } = await import("../lib/rt-render.ts");
  const steps = createStepRunner();

  // Stack guard: a stack member rebased alone onto the default branch lands
  // on master and strands its chain, so this runs before the first ref move.
  const stackRunners = opts.stackRunners ?? createStackGuardRunners((await import("../lib/setup/probes.ts")).createRealProbes());
  const stack = await checkStackMembership({ cwd, branch, defaultBranch: defaultBranch ? defaultBranchName : null, runners: stackRunners });
  syncLog.phase("stack-guard", { verdict: stack.verdict, ...(stack.verdict === "clear" ? {} : { kind: stack.refusal.kind, source: stack.refusal.source }) });
  if (stack.verdict === "refuse" || (stack.verdict === "unverified" && opts.strictStackCheck)) {
    const line = renderStackRefusal(stack.refusal, "human");
    syncLog.worktreeEnd(branch, line);
    return { branch, worktree: cwd, resetResult: null, rebaseResult: null, pushed: false, error: line, refusal: stack.refusal };
  }
  if (stack.verdict === "unverified" && !opts.quiet) {
    out.print(out.line("warn", "rt could not check whether this branch is part of a stack", "syncing anyway"), out.callout("why", stack.refusal.hint));
  }

  // 1. Fetch once (rebase/reset will skip their own fetch)
  if (opts.quiet) {
    try {
      await gitAsync("fetch origin", cwd);
    } catch (err) {
      return { branch, worktree: cwd, resetResult: null, rebaseResult: null, pushed: false, ...asError({ title: "Could not fetch from origin", details: errText(err) }) };
    }
  } else {
    try {
      await steps.run("Fetching from origin…", () => gitAsync("fetch origin", cwd), {
        done: "Fetched from origin",
        error: "Could not fetch from origin",
      });
    } catch (err) {
      return {
        branch,
        worktree: cwd,
        resetResult: null,
        rebaseResult: null,
        pushed: false,
        ...asError({ title: "Could not fetch from origin", details: errText(err) }),
      };
    }
  }

  // 2. Check if diverged from origin/your-branch (GitLab rebase scenario)
  if (hasDivergedFromRemote(branch, cwd)) {
    if (!opts.quiet) out.print(out.line("warn", `${branch} and origin/${branch} have diverged`, "matching origin first"));

    if (opts.dryRun) {
      out.print(out.line("skipped", `Would reset ${branch} to origin/${branch}`));
    } else {
      resetResult = await resetToOrigin({
        cwd,
        quiet: opts.quiet,
        autoConfirm: true,
        skipFetch: true,
      });

      syncLog.phase("reset-to-origin", resetResult as unknown as Record<string, unknown>);

      if (resetResult.status === "error") {
        syncLog.worktreeEnd(branch, resetResult.error);
        return {
          branch,
          worktree: cwd,
          resetResult,
          rebaseResult: null,
          pushed: false,
          error: resetResult.error,
          failure: resetResult.failure,
          refused: resetResult.refused,
        };
      }

      if (resetResult.status !== "in-sync") {
        needsPush = true;
      }
    }
  }

  // 3. Behind origin/master: rebase
  rebaseResult = await rebaseOnto({
    cwd,
    autoResolve: config.autoResolve,
    dryRun: opts.dryRun,
    quiet: opts.quiet,
    skipFetch: true,
    onConflict: opts.onConflict ?? "abort",
  });

  syncLog.phase("rebase-onto", rebaseResult as unknown as Record<string, unknown>);

  if (rebaseResult.status === "error" || rebaseResult.status === "conflict") {
    const paused = rebaseResult.status === "conflict" && rebaseResult.rebaseInProgress;
    syncLog.worktreeEnd(
      branch,
      rebaseResult.status === "error" ? rebaseResult.error : paused ? "conflicts (paused for escalation)" : "unresolvable conflicts",
    );
    return {
      branch,
      worktree: cwd,
      resetResult,
      rebaseResult,
      pushed: false,
      error: rebaseResult.status === "error" ? rebaseResult.error : paused ? undefined : (rebaseResult.failure?.title ?? "The rebase stopped on conflicts"),
      failure: paused ? undefined : rebaseResult.failure,
      refused: rebaseResult.refused,
    };
  }

  if (rebaseResult.status === "ok") {
    needsPush = true;
  }

  // 4. Push if anything changed
  let pushed = false;
  let pushFailure: out.FailureInput | undefined;
  if (needsPush && !opts.dryRun) {
    try {
      if (opts.quiet) {
        await gitAsync(`push --force-with-lease origin ${branch}`, cwd);
      } else {
        await steps.run("Pushing…", () =>
          gitAsync(`push --force-with-lease origin ${branch}`, cwd),
          { done: "Pushed", error: "Could not push" },
        );
      }
      pushed = true;
      syncLog.cmd(`push --force-with-lease origin ${branch}`, cwd, 0, "", "");
    } catch (err: any) {
      syncLog.cmd(`push --force-with-lease origin ${branch}`, cwd, 1, "", String(err));
      // The step already painted its failed line; the summary must still
      // count this branch as failed, never as synced.
      pushFailure = { title: `Could not push ${branch}`, details: errText(err) };
    }
  }

  syncLog.worktreeEnd(branch, pushFailure?.title);
  return { branch, worktree: cwd, resetResult, rebaseResult, pushed, ...(pushFailure ? asError(pushFailure) : {}) };
}

// ─── Multi-worktree sync ─────────────────────────────────────────────────────

/** rt declining to sync a stacked branch: never a failure. */
export function refusalBlocks(refusal: StackRefusal): Block[] {
  return [
    out.line("refused", `rt will not sync ${refusal.branch} on its own`),
    out.callout("why", refusal.hint),
    ...(refusal.tool ? [out.callout("next", out.cmd(refusal.tool))] : []),
  ];
}

/**
 * What sync all writes to stderr under a branch's heading once its sync ends.
 * The API under it never prints a failure, so without this a conflicted
 * branch would show its heading and nothing else.
 */
export function branchEnding(s: SyncSummary): Block[] {
  if (s.refusal) return refusalBlocks(s.refusal);
  if (!s.error) return [];
  const failure = s.failure ?? { title: s.error };
  return s.refused ? refusalNote(failure) : [out.failure(failure)];
}

/** Printed alone before a heading: in the same render call as the section, the styled renderer would add a second gap. */
export const BRANCH_GAP: Block = out.table([[""]]);

export function syncAllBlocks(summaries: SyncSummary[]): Block[] {
  const refused = summaries.filter((s) => s.refusal || s.refused);
  const failed = summaries.filter((s) => s.error && !s.refusal && !s.refused);
  const pushed = summaries.filter((s) => s.pushed).length;
  const upToDate = summaries.filter((s) => !s.error && s.rebaseResult?.status === "up-to-date" && !s.resetResult).length;
  const synced = summaries.length - refused.length - failed.length;
  const status = failed.length > 0 ? "failed" : refused.length > 0 ? "refused" : "done";
  return [
    out.summary(status, `${synced} of ${plural(summaries.length, "branch", "branches")} synced`, [
      `${pushed} pushed`,
      `${upToDate} up to date`,
      ...(refused.length > 0 ? [`${refused.length} refused`] : []),
      ...(failed.length > 0 ? [`${failed.length} failed`] : []),
    ]),
    ...(refused.length + failed.length > 0
      ? [
          out.table([
            ...refused.map((s) => [out.key(s.branch), out.dim("refused"), s.refusal ? "it is part of a stack" : (s.failure?.title ?? s.error ?? "")]),
            ...failed.map((s) => [out.key(s.branch), out.dim("failed"), s.failure?.title ?? s.error ?? ""]),
          ]),
        ]
      : []),
  ];
}

async function syncAll(
  repoIdentity: string,
  opts: { dryRun?: boolean },
): Promise<void> {
  const { daemonQuery, isDaemonRunning } = await import("../lib/daemon-client.ts");
  const running = await isDaemonRunning();

  if (!running) {
    out.fail({ title: "The rt daemon is not running", why: "Syncing every worktree needs it to find them.", next: out.cmd("rt daemon start") });
    process.exit(1);
  }

  const reposResult = await daemonQuery("repos");

  if (!reposResult?.ok || !reposResult.data) {
    out.fail({ title: "The rt daemon did not answer", next: out.cmd("rt daemon logs") });
    process.exit(1);
  }

  // daemon "repos" response: { repos: { [name]: { path, worktrees } }, watched: [...] }
  const repoMap = (reposResult.data as any)?.repos as Record<
    string,
    { path: string; worktrees: { path: string; branch: string }[] }
  > | undefined;

  if (!repoMap) {
    out.fail({ title: "The rt daemon gave an answer rt could not read", next: out.cmd("rt daemon logs") });
    process.exit(1);
  }

  const repoEntry = repoMap[repoIdentity];
  if (!repoEntry) {
    out.fail({ title: `The rt daemon does not know ${repoLabel(repoIdentity)} yet`, next: out.cmd("rt repos register") });
    process.exit(1);
  }

  const repoName = repoLabel(repoIdentity);
  const defaultBranches = new Set(["main", "master", "develop"]);
  const syncable = repoEntry.worktrees.filter((wt) => !defaultBranches.has(wt.branch) && wt.branch !== "HEAD");

  if (syncable.length === 0) {
    out.print(out.line("skipped", "There are no feature branches to sync"));
    return;
  }

  const { createRealProbes } = await import("../lib/setup/probes.ts");
  const { getRepoIdentity } = await import("../lib/repo.ts");
  const stackRunners = createStackGuardRunners(createRealProbes());
  const summaries: SyncSummary[] = [];

  for (const [i, wt] of syncable.entries()) {
    if (i > 0) out.print(BRANCH_GAP);
    out.print(out.section(wt.branch, repoName));

    // The daemon's cached path may be gone from disk: a chdir that throws
    // must not end the loop, and the cwd must come back whatever happens.
    const origCwd = process.cwd();
    let identity: ReturnType<typeof getRepoIdentity> = null;
    try {
      process.chdir(wt.path);
      identity = getRepoIdentity();
    } catch { /* counted as a failure below */ }
    finally {
      process.chdir(origCwd);
    }

    const summary: SyncSummary = identity
      ? await syncBranch(wt.path, { dryRun: opts.dryRun, quiet: false, onConflict: "abort", stackRunners })
      : { branch: wt.branch, worktree: wt.path, resetResult: null, rebaseResult: null, pushed: false, ...asError({ title: "rt could not tell which repo this worktree belongs to" }) };
    summaries.push(summary);

    const ending = branchEnding(summary);
    if (ending.length > 0) out.note(...ending);
  }

  out.print(...syncAllBlocks(summaries));
}

// ─── CLI handler ─────────────────────────────────────────────────────────────

/** rt sync all: syncs every worktree of the current repo (repo context only) */
export async function syncAllCommand(
  args: string[],
  ctx: CommandContext,
): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const repoName = ctx.identity!.repoName;
  if (!ensureOriginRemote(ctx.identity!.repoRoot)) return;
  syncLog.start(`rt sync all  repo=${repoName}${dryRun ? "  --dry-run" : ""}`);
  try {
    await syncAll(ctx.identity!.identity, { dryRun });
  } finally {
    syncLog.end();
  }
}

/**
 * branch_sync reads the last three stderr lines of a refused sync, so under
 * --json a failure is at most three: the title with git's own line beside
 * it, the why, the next.
 */
export function compactFailure(f: out.FailureInput): out.FailureInput {
  const lines = (f.details ?? "").split("\n").map((l) => l.trim().replace(/\s+/g, " ")).filter(Boolean);
  // A rejected push says why on its "! [rejected] ... (stale info)" line; the
  // "error: failed to push" under it says only that it failed.
  const gist = lines.find((l) => l.startsWith("! [")) ?? lines.find((l) => /^(fatal|error):/.test(l)) ?? lines.at(-1);
  return { title: f.title, ...(gist ? { hint: gist } : {}), ...(f.why ? { why: f.why } : {}), ...(f.next !== undefined ? { next: f.next } : {}) };
}

/** Prints how a sync ended and returns the exit code: 4 for a stack refusal, 1 for a failure, 0 otherwise. */
export function reportSync(summary: SyncSummary, json: boolean): number {
  if (summary.refusal) {
    if (json) out.payload(renderStackRefusal(summary.refusal, "json") + "\n");
    else out.note(...refusalBlocks(summary.refusal));
    return STACK_REFUSAL_EXIT;
  }
  if (summary.error) {
    const failure = summary.failure ?? { title: summary.error };
    drawFailure(json ? compactFailure(failure) : failure, summary.refused);
    return 1;
  }
  return 0;
}

export async function syncCommand(
  args: string[],
  ctx: CommandContext,
): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const cwd = ctx.identity!.repoRoot;
  const dataDir = ctx.identity!.dataDir;
  const repoName = ctx.identity!.repoName;

  const { resolveEscalationMode, runEscalationFlow } = await import("../lib/rebase-escalation.ts");
  const isTTY = Boolean(process.stdout.isTTY && process.stdin.isTTY);
  const mode = resolveEscalationMode(args, isTTY);

  // Under --json stdout is the bundle or the refusal and nothing else: every
  // note this verb prints moves to stderr with this.
  if (mode === "json") out.payloadOnStdout();

  if (!ensureOriginRemote(cwd)) return;

  syncLog.start(`rt sync  cwd=${cwd}${dryRun ? "  --dry-run" : ""}${mode !== "off" ? `  escalation=${mode}` : ""}`);
  let summary;
  // Escalation's exit code is captured, not exited on immediately: in Bun,
  // process.exit() inside a try skips its finally, which would leave
  // syncLog.end() unrun and the SESSION block unterminated. Exit only after
  // the try/finally below has fully completed.
  let escalationExit: number | null = null;
  try {
    summary = await syncBranch(cwd, {
      dryRun,
      quiet: mode === "json",
      onConflict: mode === "off" ? "abort" : "pause",
      strictStackCheck: mode === "json",
    });

    const paused =
      summary.rebaseResult?.status === "conflict" && summary.rebaseResult.rebaseInProgress;
    if (paused && mode !== "off") {
      escalationExit = await runEscalationFlow({
        cwd,
        dataDir,
        repoName,
        result: summary.rebaseResult!,
        mode,
        autoYes: args.includes("--agent"),
        push: true,
      });
    }
  } finally {
    syncLog.end();
  }

  if (escalationExit !== null) {
    process.exit(escalationExit);
  }

  const code = reportSync(summary, mode === "json");
  if (code !== 0) process.exit(code);
}
