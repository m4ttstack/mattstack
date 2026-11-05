import { describe, expect, test } from "bun:test";
import type { BranchSyncResult } from "../../../mcp/git-tools.ts";
import type { TreeHolder } from "../../reconciler/tree-holders.ts";
import { createWorktreeSyncHandler, type WorktreeSyncDeps } from "../worktree-sync.ts";

const ref = { tree: "elrond", path: "/trees/elrond", branch: "feat", treeKind: "ephemeral" as const };
const holder: TreeHolder = { pid: 42, ppid: 7, command: "claude", fullCommand: "claude", elapsedMs: 1000 };
const synced = (kind: BranchSyncResult["kind"], extra: Partial<BranchSyncResult> = {}): BranchSyncResult =>
  ({ kind, branch: "feat", oldHead: "a", newHead: "b", pushed: false, refusal: null, ...extra });

function harness(over: Partial<WorktreeSyncDeps> = {}) {
  const calls = { provisioned: 0, synced: [] as string[], disposed: [] as string[] };
  const deps: WorktreeSyncDeps = {
    check: async () => ({ ok: true, data: { branch: "feat", base: "feat", localBranch: true, attached: [ref], sameTicket: [], sameSlug: [] } }),
    provision: async () => {
      calls.provisioned++;
      return { ok: true, data: { tree: "new-tree", path: "/trees/new", branch: "feat", wasOnDeck: true, readyAt: null, branchState: "tracking-remote" } as any };
    },
    dispose: async (p) => { calls.disposed.push(p.tree); },
    holders: async () => [],
    sync: async (path) => { calls.synced.push(path); return synced("synced", { pushed: true }); },
    ...over,
  };
  return { run: createWorktreeSyncHandler(deps), calls };
}
const noTree = { check: async () => ({ ok: true as const, data: { branch: "feat", base: "feat", localBranch: false, attached: [], sameTicket: [], sameSlug: [] } }) };
const data = async (r: Promise<any>) => { const x = await r; if (!x.ok) throw new Error(x.error); return x.data; };

describe("worktree:sync", () => {
  test("syncs the tree already on the branch", async () => {
    const { run, calls } = harness();
    const d = await data(run({ repoName: "r", branch: "feat" }));
    expect(calls.synced).toEqual(["/trees/elrond"]);
    expect(d).toMatchObject({ kind: "synced", path: "/trees/elrond", provisioned: false, pushed: true });
    expect(calls.disposed).toEqual([]);
  });

  test("a live process in the tree stops the sync", async () => {
    const { run, calls } = harness({ holders: async () => [holder] });
    const d = await data(run({ repoName: "r", branch: "feat" }));
    expect(d.kind).toBe("tree-busy");
    expect(d.refusal).toContain("pid 42 (claude)");
    expect(calls.synced).toEqual([]);
  });

  test("no tree: provisions, syncs, and disposes after a clean result", async () => {
    const { run, calls } = harness(noTree);
    const d = await data(run({ repoName: "r", branch: "feat" }));
    expect(calls.provisioned).toBe(1);
    expect(calls.synced).toEqual(["/trees/new"]);
    expect(d.provisioned).toBe(true);
    expect(calls.disposed).toEqual(["new-tree"]);
  });

  test.each(["conflict", "push-refused"] as const)("a provisioned tree survives %s", async (kind) => {
    const { run, calls } = harness({ ...noTree, sync: async () => synced(kind) });
    const d = await data(run({ repoName: "r", branch: "feat" }));
    expect(d).toMatchObject({ kind, path: "/trees/new", provisioned: true });
    expect(calls.disposed).toEqual([]);
  });

  test("a failed provision reports no-tree", async () => {
    const { run, calls } = harness({ ...noTree, provision: async () => ({ ok: false, error: "busy" }) });
    const d = await data(run({ repoName: "r", branch: "feat" }));
    expect(d.kind).toBe("no-tree");
    expect(d.refusal).toBeTruthy();
    expect(calls.synced).toEqual([]);
  });

  test("two trees on the branch refuses", async () => {
    const { run, calls } = harness({ check: async () => ({ ok: true, data: { branch: "feat", base: "feat", localBranch: true, attached: [ref, { ...ref, tree: "b", path: "/trees/b" }], sameTicket: [], sameSlug: [] } }) });
    expect((await data(run({ repoName: "r", branch: "feat" }))).kind).toBe("no-tree");
    expect(calls.synced).toEqual([]);
  });

  test("names a missing branch", async () => {
    const { run } = harness();
    expect(await run({ repoName: "r" })).toEqual({ ok: false, error: "branch is required" });
  });
});
