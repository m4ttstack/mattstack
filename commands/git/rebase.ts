/**
 * rt git rebase: smart rebase with auto-resolve rules and an escalation flow.
 *
 * Rebases the current branch onto origin/master (or origin/main) with:
 *   - Auto-backup before rebase (rt-backup/rebase/<branch>/<timestamp>)
 *   - Auto-resolve rules for known-trivial conflicts (lockfiles, generated files)
 *   - Per-rule postResolve steps (e.g. "pnpm install" after lockfile resolve)
 *   - Conflict escalation to agent on demand (same as rt sync)
 *
 * Usage:
 *   rt git rebase                 rebase onto origin/default-branch
 *   rt git rebase --onto=main     explicit target
 *   rt git rebase --dry-run       show what would happen
 *   rt git rebase --json          on conflict: emit a JSON conflict bundle, exit 3, leave rebase paused
 *   rt git rebase --agent         on conflict: skip the prompt, hand straight to a Claude agent in herdr
 *   rt git rebase --no-agent      never offer agent escalation (abort on conflict, as before)
 *
 * Programmatic API (used by rt sync):
 *   rebaseOnto(cwd, opts) → RebaseResult
 */

import { execFileSync, spawnSync } from "child_process";
import { getRemoteDefaultBranch, getCurrentBranch, hasUncommittedChanges } from "../../lib/git-ops.ts";
import { createBackup } from "../../lib/git-backup.ts";
import { syncLog } from "../../lib/sync-log.ts";
import {
  loadSyncConfig,
  classifyConflicts,
  collectPostResolveSteps,
  ruleGlobs,
  type AutoResolveRule,
} from "../../lib/sync-config.ts";
import { deriveRepoIdentity } from "../../lib/settings/identity.ts";
import type { CommandContext } from "../../lib/command-tree.ts";
import * as out from "../../lib/ui/out.ts";
import type { Block } from "../../lib/ui/protocol.ts";
import { usageFailure } from "../../lib/ui/usage.ts";
import { asError, asRefusal, drawFailure, errText, NOT_ON_A_BRANCH, plural, uncommittedChanges } from "./shared.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RebaseResult {
  status: "ok" | "up-to-date" | "conflict" | "error";
  /** Branch that was rebased. */
  branch: string;
  /** Target that was rebased onto (e.g. "origin/master"). */
  target: string;
  /** Number of commits the branch was behind. */
  commitsBehind: number;
  /** Files that were auto-resolved by rules. */
  resolvedFiles: string[];
  /** Files that couldn't be resolved (caused abort). */
  unresolvedFiles: string[];
  /** Post-resolve steps that were executed. */
  postResolveSteps: string[];
  /** Backup branch created before rebase. */
  backupBranch: string | null;
  /** True when status is "conflict" and the rebase was left paused (onConflict: "pause"). */
  rebaseInProgress?: boolean;
  /** Error message if status is "error": the title of `failure`. */
  error?: string;
  /** What a person reads: set with `error`, and alone for a conflict that was undone. */
  failure?: out.FailureInput;
  /** `failure` is rt's own guard declining, drawn as a refused note. */
  refused?: boolean;
}

export interface RebaseOptions {
  /** Target ref to rebase onto (default: auto-detect origin/master or origin/main). */
  target?: string;
  /** Auto-resolve rules (default: loaded from the rt.sync setting for cwd's repo identity). */
  autoResolve?: AutoResolveRule[];
  /** If true, show what would happen without doing it. */
  dryRun?: boolean;
  /** Working directory. */
  cwd: string;
  /** If true, suppress output (used when called from rt sync --all). */
  quiet?: boolean;
  /** If true, skip git fetch (caller already fetched). */
  skipFetch?: boolean;
  /** What to do when conflicts can't be auto-resolved. Default "abort" preserves historic behavior. */
  onConflict?: "abort" | "pause";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function git(args: string[], cwd: string): string {
  let stdout = "";
  try {
    stdout = execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    syncLog.cmd(args, cwd, 0, stdout, "");
    return stdout;
  } catch (err: any) {
    syncLog.cmd(args, cwd, err?.status ?? 1, err?.stdout ?? "", err?.stderr ?? "");
    throw err;
  }
}

function gitSafe(args: string[], cwd: string): { ok: boolean; stdout: string } {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
  syncLog.cmd(args, cwd, result.status, result.stdout ?? "", result.stderr ?? "");
  return { ok: result.status === 0, stdout: (result.stdout ?? "").trim() };
}

function say(quiet: boolean | undefined, ...blocks: Block[]): void {
  if (!quiet) out.print(...blocks);
}

const PUT_BACK = "rt put the branch back the way it was.";

/** The failure for a rebase that stopped on conflicts and was undone. */
export function conflictFailure(result: Pick<RebaseResult, "unresolvedFiles" | "backupBranch">): out.FailureInput {
  return {
    title: `The rebase stopped on conflicts in ${plural(result.unresolvedFiles.length, "file")}`,
    why: PUT_BACK,
    details: [...result.unresolvedFiles, ...(result.backupBranch ? [`A backup is at ${result.backupBranch}`] : [])].join("\n"),
  };
}

/**
 * Get the list of conflicted files during a rebase.
 */
function getConflictedFiles(cwd: string): string[] {
  try {
    const stdout = git(["diff", "--name-only", "--diff-filter=U"], cwd);
    return stdout.split("\n").filter((f) => f.trim());
  } catch {
    return [];
  }
}

/**
 * Count how many commits the current branch is behind a target.
 */
function commitsBehind(target: string, cwd: string): number {
  try {
    const count = git(["rev-list", "--count", `HEAD..${target}`], cwd);
    return parseInt(count, 10) || 0;
  } catch {
    return 0;
  }
}

// ─── Core rebase logic ───────────────────────────────────────────────────────

/**
 * Programmatic rebase API. Used by both the CLI handler and rt sync.
 */
export async function rebaseOnto(opts: RebaseOptions): Promise<RebaseResult> {
  const { cwd, dryRun, quiet } = opts;
  const branch = getCurrentBranch(cwd);

  if (!branch) {
    return {
      status: "error",
      branch: "HEAD",
      target: "",
      commitsBehind: 0,
      resolvedFiles: [],
      unresolvedFiles: [],
      postResolveSteps: [],
      backupBranch: null,
      ...asError(NOT_ON_A_BRANCH),
    };
  }

  // Guard: refuse to rebase with uncommitted changes (they'd be lost on conflict abort)
  if (hasUncommittedChanges(cwd)) {
    return {
      status: "error",
      branch,
      target: "",
      commitsBehind: 0,
      resolvedFiles: [],
      unresolvedFiles: [],
      postResolveSteps: [],
      backupBranch: null,
      ...asRefusal(uncommittedChanges("A rebase that hits a conflict would lose them.")),
    };
  }

  // 1. Fetch (unless caller already did)
  if (!opts.skipFetch) {
    const { withSpinner } = await import("../../lib/rt-render.ts");
    const { execFile } = await import("child_process");
    const gitAsync = (args: string[]) =>
      new Promise<void>((resolve, reject) => {
        execFile("git", args, { cwd }, (err) => (err ? reject(err) : resolve()));
      });
    try {
      await withSpinner("Fetching from origin…", () => gitAsync(["fetch", "origin"]), {
        doneLabel: "Fetched from origin",
        failLabel: "Could not fetch from origin",
        errorHint: "",
      });
    } catch (err) {
      return {
        status: "error",
        branch,
        target: "",
        commitsBehind: 0,
        resolvedFiles: [],
        unresolvedFiles: [],
        postResolveSteps: [],
        backupBranch: null,
        ...asError({ title: "Could not fetch from origin", details: errText(err) }),
      };
    }
  }

  // 2. Detect target
  const target = opts.target ?? getRemoteDefaultBranch(cwd, "origin", { preferRemote: true });
  if (!target) {
    return {
      status: "error",
      branch,
      target: "",
      commitsBehind: 0,
      resolvedFiles: [],
      unresolvedFiles: [],
      postResolveSteps: [],
      backupBranch: null,
      ...asError({ title: "rt could not tell which branch is the default", why: "origin has no main or master branch that it can see." }),
    };
  }

  // Guard: don't rebase the default branch onto itself
  const targetBranchName = target.replace(/^origin\//, "");
  if (branch === targetBranchName) {
    say(quiet, out.line("skipped", `${branch} is the default branch`, "nothing to rebase"));
    return {
      status: "up-to-date",
      branch,
      target,
      commitsBehind: 0,
      resolvedFiles: [],
      unresolvedFiles: [],
      postResolveSteps: [],
      backupBranch: null,
    };
  }

  // 3. Check if behind
  const behind = commitsBehind(target, cwd);
  if (behind === 0) {
    say(quiet, out.line("done", `${branch} is up to date with ${target}`));
    return {
      status: "up-to-date",
      branch,
      target,
      commitsBehind: 0,
      resolvedFiles: [],
      unresolvedFiles: [],
      postResolveSteps: [],
      backupBranch: null,
    };
  }

  // 4. Load auto-resolve rules
  const derivedIdentity = opts.autoResolve ? null : await deriveRepoIdentity(cwd);
  const rules = opts.autoResolve
    ?? loadSyncConfig(derivedIdentity && derivedIdentity.kind === "remote" ? derivedIdentity.id : null).autoResolve;

  // 5. Dry run
  if (dryRun) {
    say(
      quiet,
      out.line("skipped", `Would rebase ${branch} onto ${target}`, `${plural(behind, "commit")} behind`),
      ...(rules.length > 0 ? [out.callout("note", `Conflicts in these files resolve by themselves: ${rules.flatMap(ruleGlobs).join(", ")}`)] : []),
    );
    return {
      status: "ok",
      branch,
      target,
      commitsBehind: behind,
      resolvedFiles: [],
      unresolvedFiles: [],
      postResolveSteps: [],
      backupBranch: null,
    };
  }

  // 6. Create backup. Mandatory: refuse to proceed without one.
  let backupBranch: string | null = null;
  try {
    backupBranch = createBackup("rebase", cwd);
    say(quiet, out.line("done", "Saved a backup", backupBranch));
  } catch (err) {
    return {
      status: "error",
      branch,
      target,
      commitsBehind: behind,
      resolvedFiles: [],
      unresolvedFiles: [],
      postResolveSteps: [],
      backupBranch: null,
      ...asError({ title: "Could not save a backup, so nothing was changed", details: errText(err) }),
    };
  }

  // 7. Rebase
  say(quiet, out.line("running", `Rebasing ${branch} onto ${target}`, `${plural(behind, "commit")} behind`));

  const allResolvedFiles: string[] = [];
  const triggeredRules = new Set<AutoResolveRule>();
  let rebaseActive = true;

  // Start the rebase
  const startResult = spawnSync("git", ["rebase", target], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
  syncLog.cmd(["rebase", target], cwd, startResult.status, startResult.stdout ?? "", startResult.stderr ?? "");

  if (startResult.status === 0) {
    // Clean rebase: no conflicts
    rebaseActive = false;
  }

  // Conflict resolution loop
  while (rebaseActive) {
    const conflicted = getConflictedFiles(cwd);
    if (conflicted.length === 0) {
      // No conflicts at this step: try to continue
      const contResult = spawnSync("git", ["rebase", "--continue"], {
        cwd,
        encoding: "utf8",
        stdio: "pipe",
        env: { ...process.env, GIT_EDITOR: "true" },
      });
      syncLog.cmd(["rebase", "--continue"], cwd, contResult.status, contResult.stdout ?? "", contResult.stderr ?? "");
      if (contResult.status === 0) {
        rebaseActive = false;
        break;
      }
      // If continue failed but no conflicts, something else is wrong
      if (getConflictedFiles(cwd).length === 0) {
        git(["rebase", "--abort"], cwd);
        return {
          status: "error",
          branch,
          target,
          commitsBehind: behind,
          resolvedFiles: allResolvedFiles,
          unresolvedFiles: [],
          postResolveSteps: [],
          backupBranch,
          ...asError({ title: "The rebase stopped for a reason rt does not understand", why: PUT_BACK, ...(backupBranch ? { details: `A backup is at ${backupBranch}` } : {}) }),
        };
      }
      // Otherwise fall through to handle the new conflicts
      continue;
    }

    // Classify conflicts against rules
    const { matched, unmatched } = classifyConflicts(conflicted, rules);

    if (unmatched.length > 0) {
      if (opts.onConflict === "pause") {
        say(
          quiet,
          out.line("needs-you", `${plural(unmatched.length, "file")} ${unmatched.length === 1 ? "has" : "have"} conflicts rt cannot resolve`, "the rebase is paused"),
          out.table(unmatched.map((f) => [f])),
        );
        return {
          status: "conflict",
          branch,
          target,
          commitsBehind: behind,
          resolvedFiles: allResolvedFiles,
          unresolvedFiles: unmatched,
          postResolveSteps: [],
          backupBranch,
          rebaseInProgress: true,
        };
      }
      git(["rebase", "--abort"], cwd);
      return {
        status: "conflict",
        branch,
        target,
        commitsBehind: behind,
        resolvedFiles: allResolvedFiles,
        unresolvedFiles: unmatched,
        postResolveSteps: [],
        backupBranch,
        failure: conflictFailure({ unresolvedFiles: unmatched, backupBranch }),
      };
    }

    // All conflicts matched rules, so resolve them. A failing checkout (a
    // delete/modify conflict where the chosen side has no version of the
    // file, for one) must abort the rebase like every other unresolvable
    // case, not die mid-rebase with the repo left in a conflicted state.
    try {
      for (const { file, rule } of matched) {
        const strategy = rule.strategy ?? "ours";
        const flag = strategy === "theirs" ? "--theirs" : "--ours";
        git(["checkout", flag, "--", file], cwd);
        git(["add", "--", file], cwd);
        allResolvedFiles.push(file);
        triggeredRules.add(rule);
        say(quiet, out.line("done", `Resolved ${file} for you`, `rule: ${strategy}`));
      }
    } catch (err) {
      git(["rebase", "--abort"], cwd);
      return {
        status: "error",
        branch,
        target,
        commitsBehind: behind,
        resolvedFiles: allResolvedFiles,
        unresolvedFiles: matched.map((m) => m.file),
        postResolveSteps: [],
        backupBranch,
        ...asError({ title: "A conflict rt was set to resolve by itself could not be resolved", why: PUT_BACK, details: errText(err) }),
      };
    }

    // Continue the rebase
    const contResult = spawnSync("git", ["rebase", "--continue"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, GIT_EDITOR: "true" },
    });
    syncLog.cmd(["rebase", "--continue"], cwd, contResult.status, contResult.stdout ?? "", contResult.stderr ?? "");

    if (contResult.status === 0) {
      rebaseActive = false;
    }
    // else: more conflicts on the next commit, so the loop continues
  }

  // 8. Run triggered postResolve steps
  const postResolveSteps = collectPostResolveSteps(
    allResolvedFiles.map((file) => {
      const rule = [...triggeredRules].find((r) =>
        ruleGlobs(r).some((g) => {
          try { return new Bun.Glob(g).match(file); } catch { return false; }
        }),
      );
      return { file, rule: rule! };
    }).filter((m) => m.rule),
  );

  // Use the user's login shell so profile-sourced PATH additions (pnpm,
  // corepack, volta, nvm, etc.) are available. Plain `sh -c` inherits only
  // the parent env and misses shell-rc-managed bins.
  const userShell = process.env.SHELL || "/bin/zsh";
  let failedStep: { step: string; status: number | null; signal: NodeJS.Signals | null } | null = null;

  for (const step of postResolveSteps) {
    say(quiet, out.line("running", "Running a follow-up step", step));
    const result = spawnSync(userShell, ["-lc", step], {
      cwd,
      stdio: quiet ? "pipe" : "inherit",
    });
    if (result.status !== 0) {
      failedStep = { step, status: result.status, signal: result.signal };
      break;
    }
  }

  if (failedStep) {
    const how = failedStep.signal ? `was stopped by ${failedStep.signal}` : `exited with ${failedStep.status ?? "an unknown status"}`;
    return {
      status: "error",
      branch,
      target,
      commitsBehind: behind,
      resolvedFiles: allResolvedFiles,
      unresolvedFiles: [],
      postResolveSteps,
      backupBranch,
      ...asError({
        title: "A follow-up step failed after the rebase",
        why: `${failedStep.step} ${how}.`,
        details: ["Your files are as that step left them.", ...(backupBranch ? [`A backup is at ${backupBranch}`] : [])].join("\n"),
      }),
    };
  }

  // 9. Auto-commit regenerated files if any changed
  if (postResolveSteps.length > 0) {
    const { ok: hasDiff } = gitSafe(["diff", "--quiet"], cwd);
    if (!hasDiff) {
      // Tracked files only: an untracked file is never staged here.
      git(["add", "-u"], cwd);
      const stepNames = postResolveSteps.join(", ");
      git(["commit", "-m", `chore: regenerate files after rebase (${stepNames})`], cwd);
      say(quiet, out.line("done", "Committed the regenerated files"));
    }
  }

  say(quiet, out.line("done", `Rebased ${branch} onto ${target}`, allResolvedFiles.length > 0 ? `${plural(allResolvedFiles.length, "conflict")} resolved for you` : undefined));

  return {
    status: "ok",
    branch,
    target,
    commitsBehind: behind,
    resolvedFiles: allResolvedFiles,
    unresolvedFiles: [],
    postResolveSteps,
    backupBranch,
  };
}

// ─── CLI handlers ────────────────────────────────────────────────────────────

/**
 * Shared rebase handler that applies escalation flow on conflict.
 * Exits via process.exit() on error or conflict; returns normally on success.
 */
async function runRebaseWithEscalation(
  args: string[],
  ctx: CommandContext,
  target?: string,
): Promise<void> {
  const cwd = ctx.identity!.repoRoot;
  const dataDir = ctx.identity!.dataDir;
  const dryRun = args.includes("--dry-run");

  const { resolveEscalationMode, runEscalationFlow } = await import("../../lib/rebase-escalation.ts");
  const isTTY = Boolean(process.stdout.isTTY && process.stdin.isTTY);
  const mode = resolveEscalationMode(args, isTTY);
  // Under --json stdout is the conflict bundle and nothing else: the fetch
  // step's plain line, printed off a terminal, moves to stderr with this.
  if (mode === "json") out.payloadOnStdout();

  const result = await rebaseOnto({
    cwd,
    target,
    dryRun,
    quiet: mode === "json",
    onConflict: mode === "off" ? "abort" : "pause",
  });

  if (result.status === "error") {
    drawFailure(result.failure ?? { title: result.error ?? "The rebase failed" }, result.refused);
    process.exit(1);
  }

  if (result.status === "conflict") {
    if (mode === "off" || !result.rebaseInProgress) {
      if (result.failure) out.fail(result.failure);
      process.exit(1);
    }
    const exitCode = await runEscalationFlow({
      cwd,
      dataDir,
      repoName: ctx.identity!.repoName,
      result,
      mode,
      autoYes: args.includes("--agent"),
      push: false,
    });
    process.exit(exitCode);
  }
}

/**
 * Default handler: rt git rebase (no subcommand)
 * Rebases onto auto-detected default branch.
 */
export async function rebaseCommand(
  args: string[],
  ctx: CommandContext,
): Promise<void> {
  await runRebaseWithEscalation(args, ctx);
}

/**
 * Subcommand handler: rt git rebase onto <branch>
 * Rebases onto an explicit target branch.
 */
export async function ontoCommand(
  args: string[],
  ctx: CommandContext,
): Promise<void> {
  let target = args.find((a) => !a.startsWith("-"));
  if (!target) {
    const json = args.includes("--json");
    if (process.stdin.isTTY && !json && !process.env.RT_BATCH) {
      const cwd = ctx.identity!.repoRoot;
      const current = getCurrentBranch(cwd);
      const branches = git(["for-each-ref", "--format=%(refname:short)", "refs/heads"], cwd)
        .split("\n")
        .map((b) => b.trim())
        .filter((b) => b && b !== current);
      if (branches.length > 0) {
        const { filterableSelect } = await import("../../lib/pick-wrappers.ts");
        const picked = await filterableSelect({
          message: "rebase onto which branch?",
          options: branches.map((b) => ({ value: b, label: b })),
          stderr: true,
        });
        if (!picked) process.exit(0);
        target = picked;
      }
    }
  }
  if (!target) {
    out.fail(usageFailure("Which branch?", "rt git rebase onto <branch>", "This needs the branch to rebase onto."));
    process.exit(1);
  }
  await runRebaseWithEscalation(args, ctx, target);
}
