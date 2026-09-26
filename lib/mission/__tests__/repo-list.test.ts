import { describe, expect, test } from "bun:test";
import type { GitWorktreeBadge, RepoStatusRow } from "../../../packages/rt-client/src/commands.ts";
import type { KnownRepo } from "../../repo-index.ts";
import { loadUnregisteredRepos, mergeRepoRows } from "../repo-list.ts";

function known(path: string, over: Partial<KnownRepo> = {}): KnownRepo {
  return { repoName: path.split("/").pop()!, worktrees: [{ path, branch: "main", isBare: false }], dataDir: "/d", registered: false, ...over } as KnownRepo;
}

const ids: Record<string, string> = { "/r/a": "gh:me/a", "/r/b": "gh:me/b", "/r/reg": "gh:me/reg", "/r/cur": "path:/r/cur" };
const deps = (rows: KnownRepo[]) => ({ readCached: () => rows, identityOf: (root: string) => ids[root] ?? `path:${root}` });

describe("loadUnregisteredRepos", () => {
  test("keeps only unregistered, present rows, with read-only identities", () => {
    const rows = [known("/r/a"), known("/r/reg", { registered: true }), known("/r/gone", { missing: true })];
    expect(loadUnregisteredRepos(deps(rows), new Set(["gh:me/reg"]), [])).toEqual([{ identity: "gh:me/a", path: "/r/a" }]);
  });

  test("registered wins: a scanned row whose identity has a status row is dropped", () => {
    const rows = [known("/r/a"), known("/r/b")];
    expect(loadUnregisteredRepos(deps(rows), new Set(["gh:me/b"]), []).map((r) => r.identity)).toEqual(["gh:me/a"]);
  });

  test("an identityOf that throws skips that row", () => {
    const d = { readCached: () => [known("/r/a"), known("/r/bad")], identityOf: (root: string) => { if (root === "/r/bad") throw new Error("x"); return ids[root]!; } };
    expect(loadUnregisteredRepos(d, new Set(), []).map((r) => r.path)).toEqual(["/r/a"]);
  });

  test("dedupes two paths that resolve to one identity (first wins)", () => {
    const d = { readCached: () => [known("/r/a"), known("/r/a-copy")], identityOf: () => "gh:me/a" };
    expect(loadUnregisteredRepos(d, new Set(), [])).toEqual([{ identity: "gh:me/a", path: "/r/a" }]);
  });

  test("a repo opened this session is always present, even when the cache predates it", () => {
    const got = loadUnregisteredRepos(deps([known("/r/a")]), new Set(), [{ identity: "path:/r/cur", path: "/r/cur" }]);
    expect(got).toContainEqual({ identity: "path:/r/cur", path: "/r/cur" });
  });

  test("registered wins over a repo opened this session", () => {
    const got = loadUnregisteredRepos(deps([]), new Set(["gh:me/reg"]), [{ identity: "gh:me/reg", path: "/r/reg" }]);
    expect(got).toEqual([]);
  });
});

describe("mergeRepoRows", () => {
  const status: RepoStatusRow[] = [{ repo: "gh:me/reg", worktrees: [], error: null }];
  const b = { worktree: "/r/a", ahead: 1 } as GitWorktreeBadge;

  test("unregistered rows join sorted by identity, with their badge when known", () => {
    const merged = mergeRepoRows(status, [{ identity: "gh:me/a", path: "/r/a" }, { identity: "gh:me/z", path: "/r/z" }], new Map([["gh:me/a", b]]));
    expect(merged.map((r) => r.repo)).toEqual(["gh:me/a", "gh:me/reg", "gh:me/z"]);
    expect(merged[0]!.worktrees).toEqual([b]);
    expect(merged[2]!.worktrees).toEqual([]);
  });

  test("a status row with the same identity wins over an unregistered one", () => {
    const merged = mergeRepoRows(status, [{ identity: "gh:me/reg", path: "/r/reg" }], new Map([["gh:me/reg", b]]));
    expect(merged).toEqual(status);
  });
});
