import { branchSync, realGitRunner, realSyncRunner, syncRunnerWith, type BranchSyncResult, type GitToolDeps } from "../lib/mcp/git-tools.ts";
import * as out from "../lib/ui/out.ts";

export interface BranchSyncDeps {
  sync: (cwd: string, deps: Pick<GitToolDeps, "git" | "sync">) => Promise<BranchSyncResult>;
}

const realDeps: BranchSyncDeps = { sync: branchSync };

/** The daemon cannot import the MCP tools, so `worktree:sync` runs `branch_sync` through this verb. */
export async function branchSyncCommand(args: string[] = [], _ctx?: unknown, deps: BranchSyncDeps = realDeps): Promise<void> {
  out.payloadOnStdout();
  const onLine = args.includes("--progress") ? (line: string) => out.diagnostic(`${line}\n`) : undefined;
  await out.jsonFlushed(await deps.sync(process.cwd(), { git: realGitRunner, sync: onLine ? syncRunnerWith({}, onLine) : realSyncRunner }));
}
