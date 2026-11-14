import { branchSync, realGitRunner, realSyncRunner, syncRunnerWith, type BranchSyncResult, type GitToolDeps } from "../lib/mcp/git-tools.ts";
import * as out from "../lib/ui/out.ts";

export interface BranchSyncDeps {
  sync: (cwd: string, deps: Pick<GitToolDeps, "git" | "sync">) => Promise<BranchSyncResult>;
}

/**
 * The daemon cannot import the MCP tools, so `worktree:sync` runs `branch_sync` through this verb.
 * rt sync retries a fetch or push that fails on auth through `rt git credential` itself.
 */
export async function branchSyncCommand(args: string[] = [], _ctx?: unknown, deps: BranchSyncDeps = { sync: branchSync }): Promise<void> {
  out.payloadOnStdout();
  const onLine = args.includes("--progress") ? (line: string) => out.diagnostic(`${line}\n`) : undefined;
  await out.jsonFlushed(await deps.sync(process.cwd(), { git: realGitRunner, sync: onLine ? syncRunnerWith({}, onLine) : realSyncRunner }));
}
