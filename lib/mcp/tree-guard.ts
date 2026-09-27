/**
 * Every git MCP tool runs through this before touching git: agents reach
 * these tools with no permission prompt, so the guard is the only thing
 * standing between an arbitrary path and a git invocation there.
 *
 * The registry (`findTreeByPath`) compares paths as exact strings and never
 * realpaths what it stores, so a symlinked record (macOS /tmp vs /private/tmp,
 * /var vs /private/var, a user symlink) would otherwise be refused even
 * though it names the same tree. `findTreeByRealpath` is the fallback that
 * catches that case by realpathing each stored record before comparing.
 *
 * A linked worktree the registry never adopted (the reconciler skips repos
 * with no pool) is found by listing each registered checkout's worktrees
 * with that checkout as git's cwd, never the candidate path: a candidate
 * directory's own .git must not decide whether it is admitted.
 */
import { realpathSync } from "fs";
import { dirname, isAbsolute } from "path";
import { listWorktreeRoots } from "../git-worktrees.ts";
import { loadRepoIndex } from "../repo-index.ts";
import { childEnv } from "../subprocess.ts";
import { findTreeByPath } from "../worktree/registry.ts";
import { listKvValues } from "../state/index.ts";

export interface TreeGuardDeps {
  repoIndex: () => Record<string, string>;
  treeByPath: (p: string) => { repoName: string; tree: string } | null;
  realpath: (p: string) => string;
  worktreeRoots: (checkout: string) => string[];
}

// Each of these outranks cwd, so git would answer for (and push from) a repo
// other than the tree the guard approved. git reads an empty value as a path,
// not as unset, so they are deleted rather than blanked.
const CWD_OVERRIDES = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"];

export function gitChildEnv(base: Record<string, string | undefined>, extra: Record<string, string>): Record<string, string | undefined> {
  const env = { ...base };
  for (const name of CWD_OVERRIDES) delete env[name];
  return { ...env, ...extra };
}

/** Namespace `findTreeByPath` (lib/worktree/registry.ts) and `migrateWorktreeRegistry` (lib/repo-index.ts) also key on; kept here since registry.ts does not export it. */
const WORKTREE_REGISTRY_NS = "worktree-registry";

export function findTreeByRealpath(
  path: string,
  byRepo: Record<string, Array<{ name: string; path: string }>>,
  realpath: (p: string) => string,
): { repoName: string; tree: string } | null {
  for (const [repoName, trees] of Object.entries(byRepo)) {
    for (const t of trees) {
      let real: string;
      try {
        real = realpath(t.path);
      } catch {
        continue;
      }
      if (real === path) return { repoName, tree: t.name };
    }
  }
  return null;
}

export const realTreeGuardDeps: TreeGuardDeps = {
  repoIndex: loadRepoIndex,
  treeByPath: (p) =>
    findTreeByPath(p) ??
    findTreeByRealpath(p, listKvValues<Array<{ name: string; path: string }>>(WORKTREE_REGISTRY_NS), realpathSync),
  realpath: (p) => realpathSync(p),
  // GIT_CEILING_DIRECTORIES stops .git discovery from walking up past the
  // checkout: without it, a stale registered path whose own .git is gone
  // but that still sits inside another repo would resolve to that OUTER
  // repo, listing an unregistered repo's worktrees as if they belonged to
  // the registered checkout.
  worktreeRoots: (checkout) =>
    listWorktreeRoots(checkout, {
      env: gitChildEnv(childEnv(), { GIT_TERMINAL_PROMPT: "0", GIT_CEILING_DIRECTORIES: dirname(checkout) }),
      timeoutMs: 10_000,
    }),
};

export const UNREGISTERED_TREE =
  "tree must be the absolute path of the root of a checkout or worktree of a repo registered with rt, not a directory inside one (rt repos register in its checkout first)";

function tryRealpath(p: string, realpath: (p: string) => string): string | null {
  try {
    return realpath(p);
  } catch {
    return null;
  }
}

export function checkRegisteredTree(
  tree: unknown,
  deps: TreeGuardDeps = realTreeGuardDeps,
): { ok: true; path: string; repoName: string } | { ok: false; error: string } {
  if (typeof tree !== "string" || !isAbsolute(tree)) return { ok: false, error: UNREGISTERED_TREE };
  let path: string;
  try {
    path = deps.realpath(tree);
  } catch {
    return { ok: false, error: `tree ${tree} does not exist` };
  }
  const checkouts = Object.entries(deps.repoIndex());
  for (const [repoName, checkout] of checkouts) {
    if (tryRealpath(checkout, deps.realpath) === path) return { ok: true, path, repoName };
  }
  const hit = deps.treeByPath(path);
  if (hit) return { ok: true, path, repoName: hit.repoName };
  for (const [repoName, checkout] of checkouts) {
    for (const root of deps.worktreeRoots(checkout)) {
      if (tryRealpath(root, deps.realpath) === path) return { ok: true, path, repoName };
    }
  }
  return { ok: false, error: UNREGISTERED_TREE };
}
