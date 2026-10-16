import { describe, expect, test } from "bun:test";
import { joinMrsToWorktrees } from "../mr-map.ts";

const mr = (iid: number, sourceBranch: string, over: Partial<{ title: string; author: string | null; targetBranch: string; draft: boolean; state: string }> = {}) => ({
  iid,
  title: over.title ?? `MR ${iid}`,
  author: over.author === undefined ? "alice" : over.author,
  sourceBranch,
  targetBranch: over.targetBranch ?? "main",
  draft: over.draft ?? false,
  state: over.state ?? "opened",
});
const opts = (over: Partial<{ defaultBranch: string | null; ciStatus: (iid: number) => string | null }> = {}) => ({
  defaultBranch: over.defaultBranch === undefined ? "main" : over.defaultBranch,
  ciStatus: over.ciStatus ?? (() => null),
});

describe("joinMrsToWorktrees", () => {
  test("branches that prefix each other join exactly", () => {
    const trees = [{ path: "/repo/foo-10", branch: "foo-10" }];
    const result = joinMrsToWorktrees([mr(1, "foo-1"), mr(2, "foo-10")], trees, opts());
    expect(result[0]!.worktree).toBeNull();
    expect(result[1]!.worktree).toBe("/repo/foo-10");
  });

  test("with two trees on one branch the last one wins", () => {
    const trees = [
      { path: "/first/shared", branch: "shared" },
      { path: "/second/shared", branch: "shared" },
    ];
    expect(joinMrsToWorktrees([mr(50, "shared")], trees, opts())[0]!.worktree).toBe("/second/shared");
  });

  test("a tree with a null branch never matches", () => {
    expect(joinMrsToWorktrees([mr(40, "some-branch")], [{ path: "/detached", branch: null }], opts())[0]!.worktree).toBeNull();
  });

  test("carries every MR field in input order", () => {
    const result = joinMrsToWorktrees(
      [mr(10, "a", { title: "First", author: "bob", targetBranch: "a-base", draft: true }), mr(20, "b", { author: null })],
      [{ path: "/path/a", branch: "a" }],
      opts({ ciStatus: (iid) => (iid === 10 ? "success" : null) }),
    );
    expect(result).toEqual([
      { ref: "!10", iid: 10, title: "First", author: "bob", sourceBranch: "a", targetBranch: "a-base", draft: true, stacked: true, worktree: "/path/a", mrState: "opened", ciStatus: "success" },
      { ref: "!20", iid: 20, title: "MR 20", author: null, sourceBranch: "b", targetBranch: "main", draft: false, stacked: false, worktree: null, mrState: "opened", ciStatus: null },
    ]);
  });

  test("stacked is null when the default branch is unknown, and false when the target is the default", () => {
    expect(joinMrsToWorktrees([mr(1, "x", { targetBranch: "other" })], [], opts({ defaultBranch: null }))[0]!.stacked).toBeNull();
    expect(joinMrsToWorktrees([mr(1, "x", { targetBranch: "main" })], [], opts())[0]!.stacked).toBe(false);
    expect(joinMrsToWorktrees([mr(1, "x", { targetBranch: "other" })], [], opts())[0]!.stacked).toBe(true);
  });

  test("empty inputs give no rows", () => {
    expect(joinMrsToWorktrees([], [{ path: "/repo", branch: "main" }], opts())).toEqual([]);
  });
});
