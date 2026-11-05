import { join } from "path";
import type { Commands, WorktreeSyncData } from "../../../packages/rt-client/src/index.ts";
import { explainError } from "../../explain-error.ts";
import type { BranchSyncResult } from "../../mcp/git-tools.ts";
import { describeHolders, type TreeHolder } from "../reconciler/tree-holders.ts";

/** The daemon's own entry is lib/daemon.ts from source, so Bun.main there is not the CLI. */
export const CLI_ENTRY = join(import.meta.dir, "..", "..", "..", "cli.ts");

type Reply<C extends keyof Commands> = { ok: true; data: Commands[C]["data"] } | { ok: false; error: string };

export interface WorktreeSyncDeps {
  check: (payload: Commands["worktree:provision-check"]["payload"]) => Promise<Reply<"worktree:provision-check">>;
  provision: (payload: Commands["worktree:provision"]["payload"]) => Promise<Reply<"worktree:provision">>;
  dispose: (payload: { repoName: string; tree: string }) => Promise<unknown>;
  holders: (path: string) => Promise<TreeHolder[]>;
  sync: (path: string) => Promise<BranchSyncResult>;
}

const before = (kind: WorktreeSyncData["kind"], path: string | null, refusal: string): WorktreeSyncData =>
  ({ kind, path, provisioned: false, pushed: false, oldHead: null, newHead: null, refusal });

// A paused rebase is what the doctor picks up, and after a failed push the
// rebased commits exist only in this tree.
const KEEPS_TREE = new Set<WorktreeSyncData["kind"]>(["conflict", "push-refused"]);

export function createWorktreeSyncHandler(deps: WorktreeSyncDeps) {
  return async (payload: any): Promise<Reply<"worktree:sync">> => {
    const repoName = payload?.repoName;
    const branch = payload?.branch;
    if (typeof repoName !== "string" || !repoName) return { ok: false, error: "repoName is required" };
    if (typeof branch !== "string" || !branch) return { ok: false, error: "branch is required" };

    const check = await deps.check({ repoName, branch });
    if (!check.ok) return { ok: true, data: before("no-tree", null, explainError(check.error)) };
    const { attached } = check.data;
    if (attached.length > 1) return { ok: true, data: before("no-tree", null, explainError("branch-duplicated")) };

    let path: string;
    let created: string | null = null;
    if (attached[0]) {
      path = attached[0].path;
      const holders = await deps.holders(path);
      if (holders.length > 0) return { ok: true, data: before("tree-busy", path, `${describeHolders(holders)} is working in ${path}`) };
    } else {
      const made = await deps.provision({ repoName, branch, disposal: "merge" });
      if (!made.ok) return { ok: true, data: before("no-tree", null, explainError(made.error)) };
      path = made.data.path;
      created = made.data.tree;
    }

    const r = await deps.sync(path);
    if (created && !KEEPS_TREE.has(r.kind)) await deps.dispose({ repoName, tree: created });
    return {
      ok: true,
      data: { kind: r.kind, path, provisioned: created !== null, pushed: r.pushed, oldHead: r.oldHead, newHead: r.newHead, refusal: r.refusal },
    };
  };
}
