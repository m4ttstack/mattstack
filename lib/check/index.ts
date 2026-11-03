import { identityForRootReadOnly } from "../repo.ts";
import { realGitRunner } from "../mcp/git-tools.ts";
import { runCapture } from "../subprocess.ts";
import { cacheKey, readCached, realCacheDeps, writeCached, type CacheDeps } from "./cache.ts";
import { readConfig, realSetting, runCheck, treeState, type CheckResult, type RunDeps } from "./run.ts";
import { postStatus, realStatusDeps, type StatusDeps, type StatusOutcome } from "./status.ts";

export type CheckRun = { result: CheckResult; status: StatusOutcome | null };

export type CheckDeps = RunDeps &
  CacheDeps &
  StatusDeps & {
    /** Whether a remote-tracking ref already holds the sha, so the forge knows it. */
    onRemote: (tree: string, sha: string) => Promise<boolean>;
    /** The serialized identity the status is posted under. */
    identity: (tree: string) => string;
  };

export const realCheckDeps: CheckDeps = {
  // Resolved at call time: git-tools.ts imports this module, so a by-value capture hits the cycle.
  git: (args, cwd) => realGitRunner(args, cwd),
  exec: runCapture,
  setting: realSetting,
  now: () => Date.now(),
  read: realCacheDeps.read,
  write: realCacheDeps.write,
  hostname: realStatusDeps.hostname,
  identity: identityForRootReadOnly,
  onRemote: async (tree, sha) => {
    const r = await realGitRunner(["branch", "-r", "--contains", sha], tree);
    return r.code === 0 && r.stdout.trim() !== "";
  },
};

export async function checkTree(
  tree: string,
  opts: { full?: boolean; base?: string; post: boolean },
  deps: CheckDeps,
): Promise<CheckRun> {
  const config = readConfig(tree, deps);
  if (!config) return { result: { configured: false }, status: null };

  // A scoped green must not answer a full run or another base.
  const cacheable = !opts.full && !opts.base;
  const { sha, dirty } = await treeState(tree, deps);

  let result: CheckResult | null = null;
  if (cacheable && !dirty) result = readCached(cacheKey(tree, sha, config.command), deps);
  if (!result) {
    result = await runCheck(tree, opts, deps);
    if (cacheable && result.configured) writeCached(cacheKey(tree, result.sha, result.command), result, deps);
  }

  if (!opts.post || !result.configured) return { result, status: null };
  if (result.dirty) return { result, status: { posted: false, reason: "dirty-tree" } };
  if (!(await deps.onRemote(tree, result.sha))) return { result, status: { posted: false, reason: "not-on-remote" } };
  return { result, status: await postStatus(deps.identity(tree), result.sha, result, deps) };
}
