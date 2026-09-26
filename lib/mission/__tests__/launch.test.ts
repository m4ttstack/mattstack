import { describe, expect, test } from "bun:test";
import { resolveGlitterStart, type LaunchDeps, type PickResult } from "../launch.ts";

function deps(over: Partial<LaunchDeps> = {}): LaunchDeps & { picks: number } {
  const d = {
    picks: 0,
    repoRoot: () => null,
    identityOf: (root: string) => `path:${root}`,
    readLast: () => null,
    pathExists: () => true,
    pick: async (): Promise<PickResult> => { d.picks++; return { kind: "picked", root: "/picked" }; },
    ...over,
  };
  return d;
}

describe("resolveGlitterStart", () => {
  test("inside a repo: that repo, never the last one or the picker", async () => {
    const d = deps({ repoRoot: () => "/here", readLast: () => ({ identity: "path:/last", worktree: "/last" }) });
    expect(await resolveGlitterStart(d)).toEqual({ kind: "start", repo: "path:/here", worktree: "/here" });
    expect(d.picks).toBe(0);
  });

  test("outside a repo: the last-opened repo when its worktree exists", async () => {
    const d = deps({ readLast: () => ({ identity: "gh:me/a", worktree: "/last" }) });
    expect(await resolveGlitterStart(d)).toEqual({ kind: "start", repo: "gh:me/a", worktree: "/last" });
  });

  test("a stale last repo falls through to the picker", async () => {
    const d = deps({ readLast: () => ({ identity: "gh:me/a", worktree: "/gone" }), pathExists: (p) => p !== "/gone" });
    expect(await resolveGlitterStart(d)).toEqual({ kind: "start", repo: "path:/picked", worktree: "/picked" });
    expect(d.picks).toBe(1);
  });

  test("no last repo: the picker, resolved read-only", async () => {
    const d = deps();
    expect(await resolveGlitterStart(d)).toEqual({ kind: "start", repo: "path:/picked", worktree: "/picked" });
  });

  test("Esc on the picker cancels", async () => {
    expect(await resolveGlitterStart(deps({ pick: async () => ({ kind: "cancelled" }) }))).toEqual({ kind: "cancelled" });
  });

  test("nothing to pick is its own result, distinct from Esc", async () => {
    expect(await resolveGlitterStart(deps({ pick: async () => ({ kind: "no-repos" }) }))).toEqual({ kind: "no-repos" });
  });
});
