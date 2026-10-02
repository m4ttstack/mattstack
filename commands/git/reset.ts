/**
 * rt git reset: safe reset with divergence detection.
 *
 * Three modes:
 *   --origin      Reset to origin/current-branch (after GitLab rebase button)
 *   --head --soft Soft reset to HEAD (unstage)
 *   --head --hard Hard reset to HEAD (discard changes)
 *
 * The --origin flow:
 *   1. Fetch origin
 *   2. Compare local HEAD vs origin/<branch> using patch-id
 *   3. Detect: identical / behind / diverged (same patches) / diverged (extra commits)
 *   4. If extra local commits: offer to reset + cherry-pick
 *   5. Creates backup branch before any destructive operation
 *
 * Programmatic API (used by rt sync):
 *   resetToOrigin(cwd) → ResetResult
 */

import { execFileSync, spawnSync } from "child_process";
import { getCurrentBranch, getRemoteDefaultBranch, hasUncommittedChanges } from "../../lib/git-ops.ts";
import { createBackup } from "../../lib/git-backup.ts";
import { syncLog } from "../../lib/sync-log.ts";
import type { CommandContext } from "../../lib/command-tree.ts";
import * as out from "../../lib/ui/out.ts";
import type { Block } from "../../lib/ui/protocol.ts";
import { asError, asRefusal, drawFailure, errText, NOT_ON_A_BRANCH, plural, uncommittedChanges } from "./shared.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ResetStatus =
  | "in-sync"       // local == origin
  | "fast-forward"  // local is behind, no divergence
  | "local-newer"   // local is the branch rebased onto a newer base: keep local, push
  | "reset"         // diverged, all patches on remote — simple reset
  | "cherry-picked" // diverged, local had extra commits — reset + cherry-pick
  | "error";

export interface ResetResult {
  status: ResetStatus;
  /** Branch that was reset. */
  branch: string;
  /** Commits that were cherry-picked on top of the reset. */
  cherryPicked: string[];
  /** Backup branch created before reset. */
  backupBranch: string | null;
  /** Error message if status is "error": the title of `failure`, or "cancelled by user". */
  error?: string;
  /** What a person reads when status is "error" and they did not cancel. */
  failure?: out.FailureInput;
  /** `failure` is rt's own guard declining, drawn as a refused note. */
  refused?: boolean;
  /** The person said no at the confirm; nothing was changed. */
  cancelled?: boolean;
}

export interface ResetOptions {
  cwd: string;
  /** If true, suppress output. */
  quiet?: boolean;
  /** If true, skip the confirmation prompt for cherry-picks. */
  autoConfirm?: boolean;
  /** If true, skip git fetch (caller already fetched). */
  skipFetch?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function git(args: string[], cwd: string): string {
  let stdout = "";
  let stderr = "";
  try {
    stdout = execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    syncLog.cmd(args, cwd, 0, stdout, "");
    return stdout;
  } catch (err: any) {
    stderr = err?.stderr ?? "";
    stdout = err?.stdout ?? "";
    syncLog.cmd(args, cwd, err?.status ?? 1, stdout, stderr);
    throw err;
  }
}

function say(quiet: boolean | undefined, ...blocks: Block[]): void {
  if (!quiet) out.print(...blocks);
}

// A large commit's diff easily passes the default 1 MiB buffer.
const PATCH_BUFFER = 256 * 1024 * 1024;

/**
 * Get the patch-id set for a range of commits.
 * Returns a Map of patch-id → commit SHA.
 *
 * Patch-IDs are content-based hashes of the diff: two commits with the
 * same code change but different SHAs (e.g. after a rebase) share the
 * same patch-id.
 */
function getPatchIds(revs: string[], cwd: string): Map<string, string> {
  const result = new Map<string, string>();
  let shas: string[];
  try {
    shas = execFileSync("git", ["log", "--format=%H", "--reverse", ...revs], { cwd, encoding: "utf8", stdio: "pipe" })
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return result;
  }
  for (const sha of shas) {
    try {
      const patch = execFileSync("git", ["diff-tree", "-p", sha], { cwd, stdio: "pipe", maxBuffer: PATCH_BUFFER });
      const patchId = execFileSync("git", ["patch-id", "--stable"], { cwd, input: patch, encoding: "utf8", stdio: "pipe", maxBuffer: PATCH_BUFFER })
        .trim()
        .split(" ")[0];
      if (patchId) result.set(patchId, sha);
    } catch { /* a commit with no patch has no patch-id */ }
  }
  return result;
}

/**
 * Get commit info for display.
 */
function getCommitOneliner(sha: string, cwd: string): string {
  try {
    return git(["log", "--oneline", "-1", sha], cwd);
  } catch {
    return sha;
  }
}

// ─── Core reset-to-origin logic ──────────────────────────────────────────────

/**
 * Sync the current branch with its remote counterpart.
 * Used after someone (or GitLab's rebase button) rewrote the remote history.
 */
export async function resetToOrigin(opts: ResetOptions): Promise<ResetResult> {
  const { cwd, quiet, autoConfirm } = opts;
  const branch = getCurrentBranch(cwd);

  if (!branch) {
    return {
      status: "error",
      branch: "HEAD",
      cherryPicked: [],
      backupBranch: null,
      ...asError(NOT_ON_A_BRANCH),
    };
  }

  // Guard: refuse to proceed with uncommitted changes (reset --hard would destroy them)
  if (hasUncommittedChanges(cwd)) {
    return {
      status: "error",
      branch,
      cherryPicked: [],
      backupBranch: null,
      ...asRefusal(uncommittedChanges("Matching origin throws away local changes.")),
    };
  }

  const remoteBranch = `origin/${branch}`;

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
        failSilently: true,
      });
    } catch (err) {
      return {
        status: "error",
        branch,
        cherryPicked: [],
        backupBranch: null,
        ...asError({ title: "Could not fetch from origin", details: errText(err) }),
      };
    }
  }

  // 2. Check if remote branch exists
  try {
    git(["rev-parse", "--verify", remoteBranch], cwd);
  } catch {
    return {
      status: "error",
      branch,
      cherryPicked: [],
      backupBranch: null,
      ...asError({ title: `${branch} is not on origin yet`, why: "There is nothing there to match.", next: out.cmd("rt git push") }),
    };
  }

  // 3. Compare local and remote
  const localSha = git(["rev-parse", "HEAD"], cwd);
  const remoteSha = git(["rev-parse", remoteBranch], cwd);

  // Case A: Identical
  if (localSha === remoteSha) {
    say(quiet, out.line("done", `${branch} already matches ${remoteBranch}`));
    return { status: "in-sync", branch, cherryPicked: [], backupBranch: null };
  }

  // Check merge base to understand relationship
  const mergeBase = git(["merge-base", "HEAD", remoteBranch], cwd);

  // Case B: Local is behind (remote has new commits, local hasn't diverged)
  if (mergeBase === localSha) {
    git(["merge", "--ff-only", remoteBranch], cwd);
    say(quiet, out.line("done", `Caught ${branch} up to ${remoteBranch}`));
    return { status: "fast-forward", branch, cherryPicked: [], backupBranch: null };
  }

  // Diverged: work out which side is the newer rewrite.
  //
  // Both a GitLab rebase (remote rewritten) and a local `git rebase
  // origin/master` (local rewritten) look identical topologically: same
  // branch content, different SHAs, neither tip an ancestor of the other.
  // "Reset to remote" is only correct in the first case. Disambiguate by
  // where each side forks from the default branch: the side sitting on the
  // newer base is the rewrite to keep. Resetting when LOCAL is the fresher
  // rewrite would discard the rebase and misclassify every intervening
  // default-branch commit as "extra local work" to cherry-pick.
  const defaultBranch = getRemoteDefaultBranch(cwd, "origin", { preferRemote: true });
  if (defaultBranch && defaultBranch !== remoteBranch) {
    try {
      const localBase = git(["merge-base", "HEAD", defaultBranch], cwd);
      const remoteBase = git(["merge-base", remoteBranch, defaultBranch], cwd);
      if (localBase !== remoteBase) {
        const r = spawnSync("git", ["merge-base", "--is-ancestor", remoteBase, localBase], {
          cwd, stdio: "pipe",
        });
        if (r.status === 0) {
          say(quiet, out.line("done", `Kept ${branch} as it is`, `it is ${remoteBranch} rebased onto a newer ${defaultBranch}`));
          return { status: "local-newer", branch, cherryPicked: [], backupBranch: null };
        }
      }
    } catch { /* fall through to patch-id comparison */ }
  }

  // 4. Get patch-ids for both sides. Local side excludes anything reachable
  // from the default branch: upstream history baked in by a rebase must never
  // be treated as extra local commits, regardless of patch-id.
  const localPatches = getPatchIds(
    defaultBranch && defaultBranch !== remoteBranch
      ? [`${mergeBase}..HEAD`, `^${defaultBranch}`]
      : [`${mergeBase}..HEAD`],
    cwd,
  );
  const remotePatches = getPatchIds([`${mergeBase}..${remoteBranch}`], cwd);

  // Find local commits whose patch-id is NOT on the remote
  // These are genuinely extra local commits (not just rebased versions)
  const remotePatchIds = new Set(remotePatches.keys());
  const extraCommits: string[] = [];
  for (const [patchId, sha] of localPatches) {
    if (!remotePatchIds.has(patchId)) {
      extraCommits.push(sha);
    }
  }

  // 5. Create backup before any destructive operation (mandatory)
  let backupBranch: string | null = null;
  try {
    backupBranch = createBackup("reset", cwd);
    say(quiet, out.line("done", "Saved a backup", backupBranch));
  } catch (err) {
    return {
      status: "error",
      branch,
      cherryPicked: [],
      backupBranch: null,
      ...asError({ title: "Could not save a backup, so nothing was changed", details: errText(err) }),
    };
  }

  if (extraCommits.length === 0) {
    // Case C: diverged but same content, so a plain reset.
    git(["reset", "--hard", remoteBranch], cwd);
    say(quiet, out.line("done", `Reset ${branch} to ${remoteBranch}`, "origin was rebased"));
    return { status: "reset", branch, cherryPicked: [], backupBranch };
  }

  // Case D: diverged with extra local commits.
  say(
    quiet,
    out.line("warn", `${branch} has ${plural(extraCommits.length, "commit")} that origin does not`),
    out.table(extraCommits.map((sha) => [getCommitOneliner(sha, cwd)])),
    ...(autoConfirm ? [] : [out.callout("note", `rt will reset to ${remoteBranch} and put these back on top.`)]),
  );

  if (!autoConfirm) {
    const { confirm: inkConfirm } = await import("../../lib/rt-render.ts");
    const ok = await inkConfirm({
      message: "Reset + cherry-pick?",
      initialValue: true,
    });

    if (!ok) {
      if (backupBranch) {
        try { git(["branch", "-D", backupBranch], cwd); } catch { /* */ }
      }
      return {
        status: "error",
        branch,
        cherryPicked: [],
        backupBranch: null,
        error: "cancelled by user",
        cancelled: true,
      };
    }
  }

  git(["reset", "--hard", remoteBranch], cwd);

  const pickedShas: string[] = [];
  for (const sha of extraCommits) {
    const result = spawnSync("git", ["cherry-pick", sha], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });
    syncLog.cmd(["cherry-pick", sha], cwd, result.status, result.stdout ?? "", result.stderr ?? "");

    if (result.status !== 0) {
      spawnSync("git", ["cherry-pick", "--abort"], { cwd, stdio: "pipe" });
      return {
        status: "error",
        branch,
        cherryPicked: pickedShas,
        backupBranch,
        ...asError({
          title: "One of your commits could not be put back on top",
          why: `${getCommitOneliner(sha, cwd)} conflicts with what is on origin now.`,
          next: ["Your branch as it was is in a backup. Bring it back with ", out.cmd("rt git restore")],
        }),
      };
    }

    pickedShas.push(sha);
    say(quiet, out.line("done", `Put back ${getCommitOneliner(sha, cwd)}`));
  }

  say(quiet, out.line("done", `${branch} matches ${remoteBranch}`, `${plural(pickedShas.length, "commit")} of yours put back on top`));
  return { status: "cherry-picked", branch, cherryPicked: pickedShas, backupBranch };
}

// ─── CLI handlers ────────────────────────────────────────────────────────────

/** rt git reset origin: sync with the remote branch */
export async function originCommand(
  _args: string[],
  ctx: CommandContext,
): Promise<void> {
  const cwd = ctx.identity!.repoRoot;
  const result = await resetToOrigin({ cwd });

  if (result.cancelled) {
    out.print(out.line("skipped", "Nothing was changed"));
    process.exit(1);
  }
  if (result.status === "error") {
    drawFailure(result.failure ?? { title: result.error ?? "The reset failed" }, result.refused);
    process.exit(1);
  }
}

/** rt git reset soft: unstage everything */
export async function softResetCommand(
  _args: string[],
  ctx: CommandContext,
): Promise<void> {
  const cwd = ctx.identity!.repoRoot;
  // `reset --soft HEAD` is a no-op (--soft touches neither index nor
  // worktree); a mixed reset is what actually unstages.
  git(["reset", "HEAD"], cwd);
  out.print(out.line("done", "Unstaged everything", "your edits are untouched"));
}

/** rt git reset hard: discard every uncommitted change */
export async function hardResetCommand(
  _args: string[],
  ctx: CommandContext,
): Promise<void> {
  const cwd = ctx.identity!.repoRoot;

  let backupBranch: string | null = null;
  try {
    backupBranch = createBackup("reset", cwd);
  } catch { /* best-effort */ }

  git(["reset", "--hard", "HEAD"], cwd);
  out.print(
    ...(backupBranch ? [out.line("done", "Saved a backup of the branch", backupBranch)] : []),
    out.line("done", "Threw away every uncommitted change"),
  );
}
