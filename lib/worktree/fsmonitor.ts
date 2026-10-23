/**
 * Per-worktree `core.fsmonitor = false` for rt's pool trees.
 *
 * A repo configured `core.fsmonitor = true` gives every linked worktree its
 * own `git fsmonitor--daemon`; on macOS under build load those daemons stop
 * answering and every index-reading git command in the tree blocks with no
 * timeout. rt's own git already bypasses the daemon (`-c core.fsmonitor=false`
 * in git-async and git-core), but the user's build steps inside a pool tree
 * (turbo and pnpm run `git status`) do not, so the tree itself carries the
 * setting. It lives in the tree's `config.worktree`, which only exists once
 * `extensions.worktreeConfig` is on for the repo.
 */

import { existsSync, readFileSync } from "fs";
import { isAbsolute, join, resolve } from "path";
import type { Logger } from "pino";
import { runGit } from "./git-async.ts";
import type { TreeRecord } from "./registry.ts";

export type FsmonitorResult =
  | { ok: true; enabledExtension: boolean }
  | { ok: false; error: string };

/** The value of `key` inside `[section]` of one git config file; null when the file or key is absent. */
function configFileValue(file: string, section: string, key: string): string | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const block = new RegExp(`^\\[${section}\\]\\s*\\n((?:(?!^\\[)[^\\n]*\\n?)*)`, "m").exec(text);
  const line = block && new RegExp(`^\\s*${key}\\s*=\\s*(\\S+)\\s*$`, "im").exec(block[1] ?? "");
  return line ? line[1]! : null;
}

/**
 * Whether the repo's shared config turns `extensions.worktreeConfig` on, read
 * from the file so the check is free and never stale (a cached answer would
 * let a later manual change route `--worktree` into the shared config).
 * Null when `.git` is not a plain directory; the caller asks git instead.
 */
function worktreeConfigOnFromFile(repoPath: string): boolean | null {
  const file = join(repoPath, ".git", "config");
  if (!existsSync(file)) return null;
  return configFileValue(file, "extensions", "worktreeConfig")?.toLowerCase() === "true";
}

/** `git config --get <key>` at `scope`; null when unset. */
async function configGet(cwd: string, key: string, scope?: "--local"): Promise<string | null> {
  const r = await runGit(cwd, ["config", ...(scope ? [scope] : []), "--get", key]);
  return r.exitCode === 0 ? r.stdout.trim() : null;
}

/**
 * Turn fsmonitor off for one linked worktree without touching the shared
 * config's own value. Enables `extensions.worktreeConfig` when the repo lacks
 * it, except where git-worktree(1) says the shared config must change first
 * (`core.worktree` present, or `core.bare = true`): those repos are refused
 * untouched. The extension check comes before any `--worktree` write because
 * without the extension git silently writes `--worktree` to the shared
 * config, which would flip fsmonitor for the user's whole repo.
 */
export async function disableFsmonitorForTree(repoPath: string, treePath: string): Promise<FsmonitorResult> {
  let enabledExtension = false;
  const extensionOn = worktreeConfigOnFromFile(repoPath) ?? ((await configGet(repoPath, "extensions.worktreeConfig")) === "true");
  if (!extensionOn) {
    if ((await configGet(repoPath, "core.worktree", "--local")) !== null) {
      return { ok: false, error: "worktree-config-blocked:core.worktree" };
    }
    if ((await configGet(repoPath, "core.bare", "--local")) === "true") {
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

/** Repos already warned this daemon life about a blocked shared config, so a reconcile pass does not repeat it every tick. */
const warnedBlocked = new Set<string>();

/**
 * Reconcile step: every pool tree (ephemeral or golden) that exists on disk
 * and does not yet carry the setting gets it. Trees rt did not build (main,
 * unmanaged) are never touched.
 */
export async function ensureFsmonitorOffForTrees(
  repoName: string,
  repoPath: string,
  trees: TreeRecord[],
  log: Pick<Logger, "warn" | "info">,
): Promise<void> {
  for (const rec of trees) {
    if (rec.kind !== "ephemeral" && rec.kind !== "golden") continue;
    if (!existsSync(rec.path) || fsmonitorOffInTree(rec.path)) continue;
    const r = await disableFsmonitorForTree(repoPath, rec.path);
    if (r.ok) {
      if (r.enabledExtension) log.info({ repo: repoName, repoPath }, "reconcile: enabled extensions.worktreeConfig on the repo");
      log.info({ repo: repoName, tree: rec.name }, "reconcile: fsmonitor turned off for the tree");
      continue;
    }
    if (r.error.startsWith("worktree-config-blocked:")) {
      if (warnedBlocked.has(repoName)) return;
      warnedBlocked.add(repoName);
    }
    log.warn({ repo: repoName, tree: rec.name, error: r.error }, "reconcile: fsmonitor stays on for the tree");
  }
}

/**
 * Whether the tree's own `config.worktree` already says `core.fsmonitor =
 * false`. A file read, not a git spawn: the reconciler asks this for every
 * pool tree on every pass.
 */
export function fsmonitorOffInTree(treePath: string): boolean {
  let gitdir: string;
  try {
    const pointer = readFileSync(join(treePath, ".git"), "utf8").trim();
    if (!pointer.startsWith("gitdir:")) return false;
    const raw = pointer.slice("gitdir:".length).trim();
    gitdir = isAbsolute(raw) ? raw : resolve(treePath, raw);
  } catch {
    return false;
  }
  return configFileValue(join(gitdir, "config.worktree"), "core", "fsmonitor")?.toLowerCase() === "false";
}
