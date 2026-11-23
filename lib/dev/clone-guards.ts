/**
 * Whether a dev clone can be fast-forwarded to origin/main without touching
 * anything the person did in it. Only the fetch writes, and only to the
 * remote-tracking ref.
 */
import { existsSync } from "fs";
import { isAbsolute, join } from "path";
import { runGitOrigin } from "../worktree/fetch-auth.ts";
import { runGit } from "../worktree/git-async.ts";

export type CloneHold = "notOnMain" | "localCommits" | "dirtyTree" | "mergeInProgress" | "fetchFailed";
export type CloneCheck =
  | { ok: true; behind: number }
  | { ok: false; hold: CloneHold; detail: string };

export interface CloneGuardDeps {
  git(cwd: string, args: string[], opts?: { timeoutMs?: number }): Promise<{ stdout: string; exitCode: number }>;
  fetch(cwd: string): Promise<{ exitCode: number }>;
}

const FETCH_TIMEOUT_MS = 120_000;
const IN_PROGRESS_MARKERS = ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"];

export function realCloneGuardDeps(): CloneGuardDeps {
  return {
    git: (cwd, args, opts) => runGit(cwd, args, opts),
    // An explicit refspec moves refs/remotes/origin/main whatever the
    // clone's own fetch config says.
    fetch: (cwd) => runGitOrigin(cwd, ["fetch", "origin", "+refs/heads/main:refs/remotes/origin/main"], { timeoutMs: FETCH_TIMEOUT_MS }),
  };
}

const hold = (h: CloneHold, detail: string): CloneCheck => ({ ok: false, hold: h, detail });

export async function checkClone(deps: CloneGuardDeps, clone: string): Promise<CloneCheck> {
  if ((await deps.fetch(clone)).exitCode !== 0) return hold("fetchFailed", "rt could not fetch origin/main.");

  for (const marker of IN_PROGRESS_MARKERS) {
    const r = await deps.git(clone, ["rev-parse", "--git-path", marker]);
    const rel = r.stdout.trim();
    if (r.exitCode === 0 && rel && existsSync(isAbsolute(rel) ? rel : join(clone, rel))) {
      return hold("mergeInProgress", "Your clone has a merge or rebase in progress.");
    }
  }

  const branch = await deps.git(clone, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const name = branch.exitCode === 0 ? branch.stdout.trim() : "";
  if (!name) return hold("notOnMain", "Your clone is not on a branch.");
  if (name !== "main") return hold("notOnMain", `Your clone is on ${name}, not main.`);

  const status = await deps.git(clone, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status.exitCode !== 0 || status.stdout.trim() !== "") return hold("dirtyTree", "Your clone has uncommitted changes.");

  const counts = await deps.git(clone, ["rev-list", "--left-right", "--count", "refs/remotes/origin/main...HEAD"]);
  const [behind, ahead] = counts.stdout.trim().split(/\s+/).map(Number);
  if (counts.exitCode !== 0 || behind === undefined || ahead === undefined || Number.isNaN(behind) || Number.isNaN(ahead)) {
    return hold("fetchFailed", "rt could not fetch origin/main.");
  }
  if (ahead > 0) return hold("localCommits", `Your clone has ${ahead} commit(s) that are not on origin/main.`);
  return { ok: true, behind };
}

/**
 * `git merge --ff-only refs/remotes/origin/main`, after checking again that
 * the clone is on main: the checks before it take seconds, and a person can
 * switch branches in between.
 */
export async function fastForwardMain(deps: CloneGuardDeps, clone: string): Promise<{ exitCode: number; stderr: string }> {
  const branch = await deps.git(clone, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (branch.exitCode !== 0 || branch.stdout.trim() !== "main") return { exitCode: 1, stderr: "Your clone is not on main any more." };
  const r = await deps.git(clone, ["merge", "--ff-only", "refs/remotes/origin/main"], { timeoutMs: 5 * 60_000 });
  return { exitCode: r.exitCode, stderr: r.exitCode === 0 ? "" : r.stdout };
}
