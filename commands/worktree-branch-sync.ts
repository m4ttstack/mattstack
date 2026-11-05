import { branchSync, realGitRunner, realSyncRunner } from "../lib/mcp/git-tools.ts";
import * as out from "../lib/ui/out.ts";

/** The daemon cannot import the MCP tools, so `worktree:sync` runs `branch_sync` through this verb. */
export async function branchSyncCommand(): Promise<void> {
  out.payloadOnStdout();
  await out.jsonFlushed(await branchSync(process.cwd(), { git: realGitRunner, sync: realSyncRunner }));
}
