import { branchSync, gitRunnerWith, realGitRunner, realSyncRunner, syncRunnerWith, type BranchSyncResult, type GitToolDeps } from "../lib/mcp/git-tools.ts";
import { fetchAuthEnv, isAuthFailure, originFetchAuth, runGitOrigin, type FetchAuth } from "../lib/worktree/fetch-auth.ts";
import * as out from "../lib/ui/out.ts";

export interface BranchSyncAuthDeps {
  sync: (cwd: string, deps: Pick<GitToolDeps, "git" | "sync">) => Promise<BranchSyncResult>;
  auth: (cwd: string, push: boolean) => Promise<FetchAuth | null>;
  push: (cwd: string, branch: string) => Promise<{ exitCode: number; stderr: string; stdout: string }>;
}

const realDeps: BranchSyncAuthDeps = {
  sync: branchSync,
  auth: (cwd, push) => originFetchAuth(cwd, undefined, { push }),
  push: (cwd, branch) => runGitOrigin(cwd, ["push", "--force-with-lease", "origin", branch], { push: true }),
};

/**
 * branch_sync with the user's own git setup first and rt's forge token only
 * after an authentication failure, the rule runGitOrigin follows for the
 * pool's own fetches.
 */
export async function branchSyncWithAuth(cwd: string, deps: BranchSyncAuthDeps = realDeps): Promise<BranchSyncResult> {
  const r = await deps.sync(cwd, { git: realGitRunner, sync: realSyncRunner });
  if (!isAuthFailure(r.refusal ?? "")) return r;
  // The rebase landed and only the push failed, so only the push is retried.
  if (r.kind === "push-refused" && r.branch) {
    const pushed = await deps.push(cwd, r.branch);
    if (pushed.exitCode !== 0) return { ...r, refusal: `${r.refusal}; with rt's token: ${(pushed.stderr || pushed.stdout).trim().split("\n").at(-1) ?? ""}` };
    return { ...r, kind: "synced", pushed: true, refusal: null };
  }
  if (r.kind !== "error" || r.newHead !== r.oldHead) return r;
  const auth = await deps.auth(cwd, false);
  if (!auth) return r;
  const env = fetchAuthEnv(auth);
  return deps.sync(cwd, { git: gitRunnerWith(env), sync: syncRunnerWith(env) });
}

/** The daemon cannot import the MCP tools, so `worktree:sync` runs `branch_sync` through this verb. */
export async function branchSyncCommand(): Promise<void> {
  out.payloadOnStdout();
  await out.jsonFlushed(await branchSyncWithAuth(process.cwd()));
}
