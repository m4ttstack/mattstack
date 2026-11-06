import { describe, expect, test } from "bun:test";
import { createWorktreeSyncHandler, runBranchSync, treeBranch, type SyncResult, type WorktreeSyncDeps } from "../worktree-sync.ts";

const ref = { tree: "elrond", path: "/trees/elrond", branch: "feat", treeKind: "ephemeral" as const };
const synced = (kind: SyncResult["kind"], extra: Partial<SyncResult> = {}): SyncResult =>
  ({ kind, oldHead: "a", newHead: "b", pushed: false, refusal: null, ...extra });

function harness(over: Partial<WorktreeSyncDeps> = {}) {
  const calls = { provisioned: 0, synced: [] as string[], disposed: [] as string[] };
  const deps: WorktreeSyncDeps = {
    check: async () => ({ ok: true, data: { branch: "feat", base: "feat", localBranch: true, attached: [ref], sameTicket: [], sameSlug: [] } }),
    provision: async () => {
      calls.provisioned++;
      return { ok: true, data: { tree: "new-tree", path: "/trees/new", branch: "feat", wasOnDeck: true, readyAt: null, branchState: "tracking-remote" } as any };
    },
    dispose: async (p) => { calls.disposed.push(p.tree); return { ok: true, data: { disposed: [p.tree], refused: [], recoverable: [] } as any }; },
    knownTree: (_repo, path) => path === "/trees/paused",
    treeBranch: async () => "feat",
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

  test("streams its own steps and the sync's lines for the branch", async () => {
    const lines: string[] = [];
    const { run } = harness({
      ...noTree,
      line: (e) => { expect(e).toMatchObject({ repoName: "r", branch: "feat" }); lines.push(e.line); },
      sync: async (_path, onLine) => { onLine?.("[ok] Fetched from origin"); return synced("synced", { pushed: true }); },
    });
    const d = await data(run({ repoName: "r", branch: "feat" }));
    const all = ["[running] Making a worktree for feat", "[ok] Made worktree new-tree", "[ok] Fetched from origin", "[ok] Removed worktree new-tree"];
    expect(lines).toEqual(all);
    expect(d.log).toEqual(all);
  });

  test("a named tree on another branch is refused, not synced", async () => {
    const { run, calls } = harness({ treeBranch: async () => "other" });
    const d = await data(run({ repoName: "r", branch: "feat", tree: "/trees/paused" }));
    expect(d.kind).toBe("no-tree");
    expect(d.refusal).toContain("other");
    expect(calls.synced).toEqual([]);
  });

  test("a cleanup that fails is reported beside the result, never thrown", async () => {
    const { run } = harness({ ...noTree, dispose: async () => { throw new Error("locked"); } });
    const d = await data(run({ repoName: "r", branch: "feat" }));
    expect(d.kind).toBe("synced");
    expect(d.log.at(-1)).toContain("Could not remove worktree new-tree");
  });

  test("a cleanup dispose refuses is reported, not logged as removed", async () => {
    const { run } = harness({ ...noTree, dispose: async () => ({ ok: true, data: { disposed: [], refused: [{ tree: "new-tree", reason: "attended" }], recoverable: [] } as any }) });
    const d = await data(run({ repoName: "r", branch: "feat" }));
    expect(d.log.at(-1)).toBe("[warning] Could not remove worktree new-tree  attended");
    expect(d.log.some((l: string) => l.includes("Removed worktree"))).toBe(false);
  });

  test("the log stops at its cap with one line saying so", async () => {
    const { run } = harness({ sync: async (_p, onLine) => { for (let i = 0; i < 450; i++) onLine?.(`line ${i}`); return synced("synced", { pushed: true }); } });
    const d = await data(run({ repoName: "r", branch: "feat" }));
    expect(d.log.length).toBe(401);
    expect(d.log.at(-1)).toContain("cut off");
  });

  test("a gone branch whose cleanup fails still says the branch is gone", async () => {
    const { run } = harness({
      ...noTree,
      provision: async () => ({ ok: true, data: { tree: "new-tree", path: "/trees/new", branch: "feat", wasOnDeck: true, readyAt: null, branchState: "new" } as any }),
      dispose: async () => { throw new Error("locked"); },
    });
    const d = await data(run({ repoName: "r", branch: "feat" }));
    expect(d.kind).toBe("no-tree");
    expect(d.refusal).toContain("not on origin or this Mac");
    expect(d.refusal).toContain("locked");
  });

  test("a rebase an earlier sync paused comes back as a conflict", async () => {
    const { run } = harness({ sync: async () => synced("error", { refusal: "a rebase is in progress; finish it with git rebase --continue" }) });
    expect(await data(run({ repoName: "r", branch: "feat" }))).toMatchObject({ kind: "conflict", path: "/trees/elrond", refusal: null });
  });

  test("a named tree is synced in place, with no check or provision", async () => {
    let checked = false;
    const { run, calls } = harness({ check: async () => { checked = true; throw new Error("unused"); } });
    const d = await data(run({ repoName: "r", branch: "feat", tree: "/trees/paused" }));
    expect(checked).toBe(false);
    expect(calls.provisioned).toBe(0);
    expect(calls.synced).toEqual(["/trees/paused"]);
    expect(d.path).toBe("/trees/paused");
  });

  test("a named tree the registry does not know is refused", async () => {
    const { run, calls } = harness();
    const d = await data(run({ repoName: "r", branch: "feat", tree: "/elsewhere" }));
    expect(d.kind).toBe("no-tree");
    expect(calls.synced).toEqual([]);
  });

  test("a branch found nowhere is refused, and the tree it cut is disposed", async () => {
    const { run, calls } = harness({
      ...noTree,
      provision: async () => ({ ok: true, data: { tree: "new-tree", path: "/trees/new", branch: "feat", wasOnDeck: true, readyAt: null, branchState: "new" } as any }),
    });
    const d = await data(run({ repoName: "r", branch: "feat" }));
    expect(d).toMatchObject({ kind: "no-tree", refusal: "feat is not on origin or this Mac" });
    expect(calls.synced).toEqual([]);
    expect(calls.disposed).toEqual(["new-tree"]);
  });

  test("names a missing branch", async () => {
    const { run } = harness();
    expect(await run({ repoName: "r" })).toEqual({ ok: false, error: "branch is required" });
  });
});

describe("runBranchSync", () => {
  const reply = (over: Partial<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }>) =>
    async () => ({ exitCode: 0, stdout: "", stderr: "", ...over });

  test("runs the CLI, not the daemon entry, in the tree", async () => {
    let seen: { argv: string[]; cwd: string } | undefined;
    await runBranchSync("/trees/a", undefined, async (argv, opts) => {
      seen = { argv, cwd: opts.cwd };
      return { exitCode: 0, stdout: "{}", stderr: "" };
    });
    expect(seen?.cwd).toBe("/trees/a");
    expect(seen?.argv.slice(-2)).toEqual(["worktree", "branch-sync"]);
    expect(seen?.argv.some((a) => a.endsWith("/cli.ts"))).toBe(true);
    expect(seen?.argv.some((a) => a.endsWith("daemon.ts"))).toBe(false);
  });

  test("with a line listener, asks for progress and hands stderr lines over", async () => {
    let seen: { argv: string[]; onStderrLine?: (l: string) => void } | undefined;
    const lines: string[] = [];
    await runBranchSync("/trees/a", (l) => lines.push(l), async (argv, opts) => {
      seen = { argv, onStderrLine: opts.onStderrLine };
      opts.onStderrLine?.("[ok] Fetched from origin");
      return { exitCode: 0, stdout: "{}", stderr: "" };
    });
    expect(seen?.argv.at(-1)).toBe("--progress");
    expect(lines).toEqual(["[ok] Fetched from origin"]);
  });

  test("passes the verb's result through", async () => {
    const r = await runBranchSync("/t", undefined, reply({ stdout: JSON.stringify(synced("conflict")) }));
    expect(r.kind).toBe("conflict");
  });

  test("no JSON is an error naming the last stderr line", async () => {
    const r = await runBranchSync("/t", undefined, reply({ exitCode: 2, stderr: "first\nlast" }));
    expect(r).toMatchObject({ kind: "error", refusal: "rt sync gave no result (exit 2): last" });
  });

  test("a timeout is an error", async () => {
    expect((await runBranchSync("/t", undefined, reply({ timedOut: true }))).kind).toBe("error");
  });
});

describe("treeBranch", () => {
  test("reads the checked-out branch, then a paused rebase's head-name", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const dir = mkdtempSync(join(tmpdir(), "tree-branch-"));
    mkdirSync(join(dir, "rebase-merge"));
    writeFileSync(join(dir, "rebase-merge", "head-name"), "refs/heads/feat\n");
    const on = await treeBranch(dir, async (argv) =>
      argv[1] === "symbolic-ref"
        ? { exitCode: 1, stdout: "", stderr: "" }
        : { exitCode: 0, stdout: argv[3]!.startsWith("rebase-merge") ? join(dir, "rebase-merge", "head-name") : join(dir, "nope"), stderr: "" });
    expect(on).toBe("feat");
    expect(await treeBranch(dir, async () => ({ exitCode: 0, stdout: "main\n", stderr: "" }))).toBe("main");
  });
});
