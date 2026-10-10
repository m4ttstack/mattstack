import { describe, expect, test } from "bun:test";

import {
  isPickableWorktree,
  isTrashPath,
  listPickableWorktrees,
  type WorktreeTreeRow,
} from "../src/index.ts";

const all = () => true;

const row = (over: Partial<WorktreeTreeRow>): WorktreeTreeRow => ({
  name: "alpha",
  mr: null,
  path: "/pool/x/alpha",
  branch: "alpha",
  kind: "ephemeral",
  state: "claimed",
  repoName: "gh:o/x",
  lastActiveAt: null,
  ...over,
});

describe("isTrashPath", () => {
  test("matches the retention store and crash leftovers, not look-alikes", () => {
    expect(isTrashPath("/pool/x/.trash/alpha-1725000000000")).toBe(true);
    expect(isTrashPath("/pool/x/.trash-alpha-1725000000000")).toBe(true);
    expect(isTrashPath("/pool/x/.trashcan/alpha")).toBe(false);
    expect(isTrashPath("/pool/x/alpha")).toBe(false);
  });
});

describe("isPickableWorktree", () => {
  test("keeps main, unmanaged and claimed ephemeral registry rows", () => {
    expect(isPickableWorktree(row({ kind: "main", state: null, branch: "main" }), all)).toBe(true);
    expect(isPickableWorktree(row({ kind: "unmanaged", state: null }), all)).toBe(true);
    expect(isPickableWorktree(row({}), all)).toBe(true);
  });

  test("drops golden, spare, creating and disposable registry rows", () => {
    expect(isPickableWorktree(row({ kind: "golden", state: null }), all)).toBe(false);
    expect(isPickableWorktree(row({ state: "on-deck", branch: "on-deck/bravo" }), all)).toBe(false);
    expect(isPickableWorktree(row({ state: "on-deck", branch: "bravo" }), all)).toBe(false);
    expect(isPickableWorktree(row({ state: "creating" }), all)).toBe(false);
    expect(isPickableWorktree(row({ state: "disposable" }), all)).toBe(false);
  });

  test("drops gitq slots, trash and missing folders whatever the kind", () => {
    expect(isPickableWorktree(row({ path: "/u/.cache/gitq/work/abc/gitq-3", kind: "unmanaged" }), all)).toBe(false);
    expect(isPickableWorktree(row({ path: "/pool/x/.trash-x-123", kind: "unmanaged" }), all)).toBe(false);
    expect(isPickableWorktree(row({ path: "/pool/x/gone" }), (p) => p !== "/pool/x/gone")).toBe(false);
  });

  test("a git row without kind gets only the path and branch rules", () => {
    expect(isPickableWorktree({ path: "/r/alpha", branch: "alpha" }, all)).toBe(true);
    expect(isPickableWorktree({ path: "/r/alpha", branch: "" }, all)).toBe(true);
    expect(isPickableWorktree({ path: "/r/luna", branch: "on-deck/luna" }, all)).toBe(false);
    expect(isPickableWorktree({ path: "/golden/gh-o-x", branch: "rt/golden" }, all)).toBe(false);
    expect(isPickableWorktree({ path: "/r/gitq-ish", branch: "x" }, all)).toBe(true);
  });
});

describe("listPickableWorktrees", () => {
  const rows = [
    row({ path: "/pool/x/old", branch: "zulu", lastActiveAt: "2026-10-01T00:00:00Z" }),
    row({ path: "/pool/x/new", branch: "Alpha", lastActiveAt: "2026-10-09T00:00:00Z" }),
    row({ path: "/r/x", branch: "main", kind: "main", state: null }),
    row({ path: "/pool/x/hand", branch: "mike", kind: "unmanaged", state: null }),
    row({ path: "/pool/x/golden", kind: "golden", state: null }),
    row({ path: "/pool/x/spare", branch: "on-deck/spare", state: "on-deck" }),
    row({ path: "/pool/x/fresh", state: "creating" }),
    row({ path: "/pool/x/done", state: "disposable" }),
    row({ path: "/u/.mattstack/gitq/work/abc/gitq-3" }),
    row({ path: "/pool/x/.trash-x-123" }),
    row({ path: "/pool/x/gone" }),
    row({ path: "/pool/y/other", repoName: "gh:o/y" }),
  ];
  const exists = (p: string) => p !== "/pool/x/gone";

  test("asks the daemon for the one repo", async () => {
    const asked: string[] = [];
    await listPickableWorktrees("gh:o/x", { exists, list: async (r) => (asked.push(r), []) });
    expect(asked).toEqual(["gh:o/x"]);
  });

  test("main first, then by last use, newest first, by default", async () => {
    const { trees, error } = await listPickableWorktrees("gh:o/x", { exists, list: async () => rows });
    expect(error).toBeNull();
    expect(trees.map((t) => t.path)).toEqual(["/r/x", "/pool/x/new", "/pool/x/old", "/pool/x/hand"]);
  });

  test("main first, then by branch name when asked", async () => {
    const { trees } = await listPickableWorktrees("gh:o/x", { sort: "name", exists, list: async () => rows });
    expect(trees.map((t) => t.branch)).toEqual(["main", "Alpha", "mike", "zulu"]);
  });

  test("a daemon failure is an empty list and a plain error", async () => {
    const result = await listPickableWorktrees("gh:o/x", {
      list: async () => {
        throw new Error("rt daemon unreachable");
      },
    });
    expect(result).toEqual({ trees: [], error: "rt daemon unreachable" });
  });
});
