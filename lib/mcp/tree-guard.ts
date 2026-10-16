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
 *
 * A directory inside an admitted root resolves to the deepest such root, so
 * a subdirectory of a worktree nested in its checkout lands on the worktree.
 * A `.git` entry between the directory and that root marks another repo
 * (a submodule, a vendored clone, an unregistered worktree), which is
 * refused: it can only narrow what is admitted, never widen it.
 */
import { existsSync, realpathSync } from "fs";
import { dirname, isAbsolute, join } from "path";
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
  /** Read from the filesystem, never by running git in dir. */
  hasGitEntry: (dir: string) => boolean;
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
  // A stale checkout whose own .git is gone must not resolve to an enclosing
  // repo, or that unregistered repo's worktrees would be admitted.
  worktreeRoots: (checkout) =>
    listWorktreeRoots(checkout, {
      env: gitChildEnv(childEnv(), { GIT_TERMINAL_PROMPT: "0", GIT_CEILING_DIRECTORIES: dirname(checkout) }),
      timeoutMs: 10_000,
    }),
  hasGitEntry: (dir) => existsSync(join(dir, ".git")),
};

export type TreeCheck =
  | { ok: true; path: string; repoName: string; resolvedFrom?: string }
  | { ok: false; error: string };

const NOT_ABSOLUTE = "tree must be an absolute path";

function unregistered(path: string): TreeCheck {
  return { ok: false, error: `${path} is not in a checkout or worktree of a repo registered with rt; register the repo from its checkout first: rt repos register <checkout path>` };
}

function tryRealpath(p: string, realpath: (p: string) => string): string | null {
  try {
    return realpath(p);
  } catch {
    return null;
  }
}

export function checkRegisteredTree(tree: unknown, deps: TreeGuardDeps = realTreeGuardDeps): TreeCheck {
  if (typeof tree !== "string") return { ok: false, error: NOT_ABSOLUTE };
  if (!isAbsolute(tree)) return { ok: false, error: `${NOT_ABSOLUTE}, not ${JSON.stringify(tree)}` };
  let path: string;
  try {
    path = deps.realpath(tree);
  } catch {
    return { ok: false, error: `tree ${tree} does not exist` };
  }
  const checkouts = Object.entries(deps.repoIndex()).map(([repoName, checkout]) => ({ repoName, checkout, real: tryRealpath(checkout, deps.realpath) }));
  let worktrees: Array<{ repoName: string; real: string | null }> | null = null;
  const rootAt = (dir: string): string | null => {
    const checkout = checkouts.find((c) => c.real === dir);
    if (checkout) return checkout.repoName;
    const hit = deps.treeByPath(dir);
    if (hit) return hit.repoName;
    worktrees ??= checkouts.flatMap((c) => deps.worktreeRoots(c.checkout).map((root) => ({ repoName: c.repoName, real: tryRealpath(root, deps.realpath) })));
    return worktrees.find((w) => w.real === dir)?.repoName ?? null;
  };

  const exact = rootAt(path);
  if (exact !== null) return { ok: true, path, repoName: exact };
  const passed = [path];
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    const repoName = rootAt(dir);
    if (repoName !== null) {
      const inner = passed.find((d) => deps.hasGitEntry(d));
      if (inner !== undefined) {
        return { ok: false, error: `${path} is inside ${dir}, but ${inner} is a separate git repo or worktree that rt has not registered; register it first: rt repos register ${inner}` };
      }
      return { ok: true, path: dir, repoName, resolvedFrom: path };
    }
    if (dirname(dir) === dir) return unregistered(path);
    passed.push(dir);
  }
}
