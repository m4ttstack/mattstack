import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createWorktreePickerHandlers } from "../worktree-picker.ts";
import { pickerOrder } from "../../../worktree-groups.ts";
import type { KnownRepo } from "../../../repo-index.ts";
import { worktreesPickerRoute } from "../../../../packages/rt-client/src/daemon-api/index.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-19T18:00:00Z");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "wt-picker-"));
  const dir = (name: string) => {
    const p = join(root, name);
    mkdirSync(p);
    return p;
  };
  const main = dir("main");
  const repo: KnownRepo = {
    repoName: "gh:o/x",
    dataDir: root,
    worktrees: [
      { path: main, branch: "main", isBare: false },
      { path: dir("b"), branch: "zeta", isBare: false },
      { path: dir("c"), branch: "alpha", isBare: false },
      { path: dir("d"), branch: "beta", isBare: false },
      { path: dir("e"), branch: "gone-soon", isBare: false },
    ],
  };
  const moved: Record<string, number> = {
    [join(root, "b")]: NOW - 60_000,
    [join(root, "c")]: NOW - 10 * DAY,
    [join(root, "d")]: NOW - 3 * DAY,
    [join(root, "e")]: NOW - 60_000,
  };
  const seams = {
    registry: () => [{ path: join(root, "e"), state: "disposable" }] as any,
    headMovedMs: (p: string) => moved[p] ?? NaN,
    now: () => NOW,
  };
  return { repo, main, seams };
}

describe("worktrees:picker", () => {
  test("serves exactly what rt cd's pickerOrder returns, with groups", async () => {
    const { repo, main, seams } = fixture();
    const order = (r: Parameters<typeof pickerOrder>[0]) => pickerOrder(r, seams);
    const h = createWorktreePickerHandlers({ knownRepos: async () => [repo], order });

    const res = await h["worktrees:picker"]({ path: main });
    if (!res.ok) throw new Error(res.error);

    const expected = order(repo);
    expect(res.data.trees.map((t) => t.path)).toEqual(expected.worktrees.map((w) => w.path));
    expect(res.data.trees.map((t) => [t.branch, t.group])).toEqual([
      ["main", null],
      ["zeta", "today"],
      ["beta", "this week"],
      ["alpha", "idle 7d+"],
    ]);
    expect(res.data.repoName).toBe("gh:o/x");
    expect(worktreesPickerRoute.success.safeParse(res).error).toBeUndefined();
  });

  test("finds the repo from any of its worktrees", async () => {
    const { repo, seams } = fixture();
    const h = createWorktreePickerHandlers({ knownRepos: async () => [repo], order: (r) => pickerOrder(r, seams) });
    const res = await h["worktrees:picker"]({ path: repo.worktrees[2]!.path });
    expect(res.ok).toBe(true);
  });

  test("refuses a missing path and an unknown repo", async () => {
    const { repo } = fixture();
    const h = createWorktreePickerHandlers({ knownRepos: async () => [repo], order: pickerOrder });
    expect(await h["worktrees:picker"]({})).toEqual({ ok: false, error: "path-required" });
    expect(await h["worktrees:picker"]({ path: "/nowhere" })).toEqual({ ok: false, error: "repo-unknown" });
  });
});
