import { branchSync, gitRunnerWith, realGitRunner, realSyncRunner, syncRunnerWith, type BranchSyncResult, type GitToolDeps } from "../lib/mcp/git-tools.ts";
import { isAuthFailure, originFetchAuth, type FetchAuth } from "../lib/worktree/fetch-auth.ts";
import * as out from "../lib/ui/out.ts";

export interface BranchSyncDeps {
  sync: (cwd: string, deps: Pick<GitToolDeps, "git" | "sync">) => Promise<BranchSyncResult>;
  auth: (cwd: string) => Promise<FetchAuth | null>;
}

const realDeps: BranchSyncDeps = { sync: branchSync, auth: (cwd) => originFetchAuth(cwd) };

/** The refusal `branchSyncPreflight` gives when its own fetch fails, before rt sync runs. */
const PREFLIGHT_FETCH_FAILED = "git fetch origin failed: ";

/**
 * rt sync retries a fetch or push that fails on auth through `rt git
 * credential` itself, but branch_sync's preflight fetches before rt sync
 * starts, so only that fetch is retried here, once, through the same helper.
 */
async function syncWithAuth(cwd: string, deps: BranchSyncDeps, onLine?: (line: string) => void): Promise<BranchSyncResult> {
  const r = await deps.sync(cwd, { git: realGitRunner, sync: onLine ? syncRunnerWith({}, onLine) : realSyncRunner });
  const refusal = r.refusal ?? "";
  if (r.kind !== "error" || r.newHead !== r.oldHead || !refusal.startsWith(PREFLIGHT_FETCH_FAILED) || !isAuthFailure(refusal)) return r;
  const auth = await deps.auth(cwd);
  if (!auth) return r;
  onLine?.("[running] Syncing again with rt's token");
  return deps.sync(cwd, { git: gitRunnerWith(auth.env), sync: syncRunnerWith(auth.env, onLine) });
}

/** The daemon cannot import the MCP tools, so `worktree:sync` runs `branch_sync` through this verb. */
export async function branchSyncCommand(args: string[] = [], _ctx?: unknown, deps: BranchSyncDeps = realDeps): Promise<void> {
  out.payloadOnStdout();
  const onLine = args.includes("--progress") ? (line: string) => out.diagnostic(`${line}\n`) : undefined;
  await out.jsonFlushed(await syncWithAuth(process.cwd(), deps, onLine));
}
