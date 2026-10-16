import { describe, test, expect } from "bun:test";
import { admitTree } from "../herd-tree-admission.ts";
import type { TreeRecord } from "../../worktree/registry.ts";

const tree = (over: Partial<TreeRecord>): TreeRecord => ({
  name: "t1", path: "/w/t1", kind: "ephemeral", state: "claimed", branch: "job-a", createdAt: "2026-10-16T00:00:00Z", ...over,
});

describe("admitTree", () => {
  test("admits a claimed ephemeral tree", () => {
    const rec = tree({});
    expect(admitTree(rec, "t1")).toEqual({ ok: true, tree: rec });
  });

  test("refuses unknown, main, golden, unmanaged, and ephemeral creating/on-deck/disposable trees", () => {
    const refusal = (rec: TreeRecord | undefined, name = "t1") => {
      const r = admitTree(rec, name);
      if (r.ok) throw new Error("admitted");
      return r.error;
    };
    expect(refusal(undefined, "nope")).toBe('no registered tree named "nope"; only a claimed ephemeral tree can host a worker');
    expect(refusal(tree({ kind: "main", state: undefined }))).toBe('tree "t1" is main; only a claimed ephemeral tree can host a worker');
    expect(refusal(tree({ kind: "golden", state: "on-deck" }))).toBe('tree "t1" is golden; only a claimed ephemeral tree can host a worker');
    expect(refusal(tree({ kind: "unmanaged", state: undefined }))).toBe('tree "t1" is unmanaged; only a claimed ephemeral tree can host a worker');
    for (const state of ["creating", "on-deck", "disposable"] as const) {
      expect(refusal(tree({ state }))).toBe(`tree "t1" is ephemeral and ${state}; only a claimed ephemeral tree can host a worker`);
    }
  });
});
