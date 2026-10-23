/**
 * Per-worktree `core.fsmonitor = false` for rt's pool trees.
 *
 * A repo configured `core.fsmonitor = true` gives every linked worktree its
 * own `git fsmonitor--daemon`; on macOS under build load those daemons stop
 * answering and every index-reading git command in the tree blocks with no
 * timeout. rt's worktree git already bypasses the daemon (`-c
 * core.fsmonitor=false` in git-async and git-core), but the user's build
 * steps inside a pool tree (turbo and pnpm run `git status`) do not, so the
 * tree itself carries the setting. It lives in the tree's `config.worktree`,
 * which only exists once `extensions.worktreeConfig` is on for the repo.
 */

import { readFileSync } from "fs";
import { isAbsolute, join, resolve } from "path";
import type { Logger } from "pino";
import { runGit } from "./git-async.ts";
import type { TreeRecord } from "./registry.ts";

export type FsmonitorResult =
  | { ok: true; enabledExtension: boolean }
  | { ok: false; error: string };

/**
 * `git config --local --type=bool --get <key>`; null when unset. `--local`
 * because a global `extensions.worktreeConfig` is not honored for
 * `--worktree`, and `--type=bool` because `core.bare = yes` is true to git.
 */
async function localBool(cwd: string, key: string): Promise<boolean | null> {
  const r = await runGit(cwd, ["config", "--local", "--type=bool", "--get", key]);
  return r.exitCode === 0 ? r.stdout.trim() === "true" : null;
}

/** Whether `key` is set at all in the repo's own config, whatever its value. */
async function localSet(cwd: string, key: string): Promise<boolean> {
  const r = await runGit(cwd, ["config", "--local", "--get", key]);
  return r.exitCode === 0;
}

/**
 * Turn fsmonitor off for one linked worktree without touching the shared
 * config's own value. Enables `extensions.worktreeConfig` when the repo lacks
 * it, except where git-worktree(1) says the shared config must change first
 * (`core.worktree` present, or `core.bare` true): those repos are refused
 * untouched. The extension check comes before any `--worktree` write: git
 * refuses `--worktree` without the extension when the repo has linked
 * worktrees, and would write the shared config when it has none.
 */
export async function disableFsmonitorForTree(repoPath: string, treePath: string): Promise<FsmonitorResult> {
  let enabledExtension = false;
  if ((await localBool(repoPath, "extensions.worktreeConfig")) !== true) {
    if (await localSet(repoPath, "core.worktree")) {
      return { ok: false, error: "worktree-config-blocked:core.worktree" };
    }
    if ((await localBool(repoPath, "core.bare")) === true) {
      return { ok: false, error: "worktree-config-blocked:core.bare" };
    }
    const enabled = await runGit(repoPath, ["config", "extensions.worktreeConfig", "true"]);
    if (enabled.exitCode !== 0) {
      return { ok: false, error: `worktree-config-failed:${(enabled.stderr + enabled.stdout).trim()}` };
    }
    enabledExtension = true;
  }
  const set = await runGit(treePath, ["config", "--worktree", "core.fsmonitor", "false"]);
  if (set.exitCode !== 0) {
    return { ok: false, error: `fsmonitor-config-failed:${(set.stderr + set.stdout).trim()}` };
  }
  return { ok: true, enabledExtension };
}

/**
 * Apply the setting to a tree rt just built or restored. Fail-soft: the tree
 * is usable without it, so a failure is logged and the caller carries on.
 */
export async function applyFsmonitorOff(
  args: { repoName: string; repoPath: string; tree: string; path: string; via: string },
  log: Pick<Logger, "warn" | "info">,
): Promise<void> {
  const r = await disableFsmonitorForTree(args.repoPath, args.path);
  if (!r.ok) {
    log.warn({ repo: args.repoName, tree: args.tree, path: args.path, error: r.error }, `worktree ${args.via}: fsmonitor stays on for the tree`);
    return;
  }
  if (r.enabledExtension) {
    log.info({ repo: args.repoName, repoPath: args.repoPath }, `worktree ${args.via}: enabled extensions.worktreeConfig on the repo`);
  }
}

/** Failures already warned this daemon life (repo, or repo + tree + error), so a pass does not repeat them every tick. */
const warned = new Set<string>();

/**
 * Reconcile step: every pool tree (ephemeral or golden) that is on disk as a
 * linked worktree and does not yet carry the setting gets it. Trees rt did
 * not build (main, unmanaged) are never touched, nor is a `creating` row:
 * its create applies the setting itself, and before the add lands the path
 * has no `.git` pointer, so git would resolve a repo from the parent dirs.
 */
export async function ensureFsmonitorOffForTrees(
  repoName: string,
  repoPath: string,
  trees: TreeRecord[],
  log: Pick<Logger, "warn" | "info">,
): Promise<void> {
  for (const rec of trees) {
    if (rec.kind !== "ephemeral" && rec.kind !== "golden") continue;
    if (rec.state === "creating" || treeGitdir(rec.path) === null || fsmonitorOffInTree(rec.path)) continue;
    const r = await disableFsmonitorForTree(repoPath, rec.path);
    if (r.ok) {
      if (r.enabledExtension) log.info({ repo: repoName, repoPath }, "reconcile: enabled extensions.worktreeConfig on the repo");
      log.info({ repo: repoName, tree: rec.name }, "reconcile: fsmonitor turned off for the tree");
      continue;
    }
    // A blocked shared config fails every tree of the repo the same way:
    // one warning, and the rest of the pass skips the spawns.
    const key = r.error.startsWith("worktree-config-blocked:") ? repoName : `${repoName}\0${rec.path}\0${r.error}`;
    const blocked = key === repoName;
    if (warned.has(key)) {
      if (blocked) return;
      continue;
    }
    warned.add(key);
    log.warn({ repo: repoName, tree: rec.name, error: r.error }, "reconcile: fsmonitor stays on for the tree");
    if (blocked) return;
  }
}

/** The gitdir a linked worktree's `.git` pointer file names; null for anything else (a main checkout, a bare dir). */
function treeGitdir(treePath: string): string | null {
  try {
    const pointer = readFileSync(join(treePath, ".git"), "utf8").trim();
    if (!pointer.startsWith("gitdir:")) return null;
    const raw = pointer.slice("gitdir:".length).trim();
    return isAbsolute(raw) ? raw : resolve(treePath, raw);
  } catch {
    return null;
  }
}

/**
 * Whether the tree's own `config.worktree` already says `core.fsmonitor =
 * false`. A file read, not a git spawn: the reconciler asks this for every
 * pool tree on every pass. Section and key match the way git reads them
 * (case-insensitive, last value wins).
 */
export function fsmonitorOffInTree(treePath: string): boolean {
  const gitdir = treeGitdir(treePath);
  if (gitdir === null) return false;
  let text: string;
  try {
    text = readFileSync(join(gitdir, "config.worktree"), "utf8");
  } catch {
    return false;
  }
  let inCore = false;
  let value: string | null = null;
  for (const line of text.split("\n")) {
    const section = /^\s*\[([^\]]+)\]/.exec(line);
    if (section) {
      inCore = section[1]!.trim().toLowerCase() === "core";
      continue;
    }
    const kv = inCore ? /^\s*fsmonitor\s*=\s*(\S+)/i.exec(line) : null;
    if (kv) value = kv[1]!.toLowerCase();
  }
  return value === "false";
}
