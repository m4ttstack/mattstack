import { describe, expect, test } from "bun:test";
import type { Discussion } from "../../../packages/rt-client/src/index.ts";
import { EXISTING_MR, findOpenMrForBranch, githubRefusal, mrCompositeToolDefs, refuseGithubTarget, normalizeBody, postedMatch, selfUsername, type MrCompositeDeps } from "../mr-composite-tools.ts";

type Call = { name: string; payload: Record<string, unknown> };

function fake(answers: Record<string, unknown> = {}): { deps: MrCompositeDeps; calls: Call[] } {
  const calls: Call[] = [];
  const deps: MrCompositeDeps = {
    command: (async (name: string, payload: Record<string, unknown>) => {
      calls.push({ name, payload });
      const a = answers[name];
      if (a instanceof Error) return { ok: false, error: a.message };
      return { ok: true, data: a };
    }) as any,
    readMrCache: (async () => { throw new Error("unexpected cache read"); }) as any,
    runTool: async () => { throw new Error("unexpected run tool"); },
    git: async () => { throw new Error("unexpected git"); },
    guard: {} as any,
    status: async () => { throw new Error("unexpected status"); },
    sleep: async () => {},
  };
  return { deps, calls };
}

const tool = (deps: MrCompositeDeps, name: string) => mrCompositeToolDefs(deps).find((t) => t.name === name)!;
const ID = "remote:gitlab.com%2Facme%2Facme-dev";
const GH = "remote:github.com%2Facme%2Fapp";
const ENV = {} as NodeJS.ProcessEnv;
const SINCE = Date.parse("2026-10-16T10:00:00Z");

function note(id: number, opts: { body?: string; by?: string; at?: string; system?: boolean; path?: string; line?: number } = {}) {
  return {
    id, body: opts.body ?? `note ${id}`, author: { username: opts.by ?? "alice" }, createdAt: opts.at ?? "2026-10-16T11:00:00Z",
    system: opts.system ?? false, type: opts.path ? "DiffNote" : null, resolvable: true, resolved: false,
    position: opts.path ? { newPath: opts.path, oldPath: opts.path, newLine: opts.line ?? null, oldLine: null, positionType: "text" } : null,
  };
}
const disc = (id: string, notes: ReturnType<typeof note>[]): Discussion => ({ id, resolvable: true, resolved: false, notes }) as unknown as Discussion;

describe("normalizeBody", () => {
  test("bodies match across CRLF and trailing space", () => {
    expect(normalizeBody("a  \r\nb\r\n")).toBe(normalizeBody("a\nb"));
  });
});

describe("postedMatch on threads", () => {
  const discussions = [
    disc("d1", [note(1, { by: "carol" }), note(2, { body: "Fixed in abc.\r\n", by: "dave", at: "2026-10-01T00:00:00Z" })]),
    disc("d2", [note(3, { by: "carol" }), note(4, { by: "me-bot", at: "2026-10-16T12:00:00Z" })]),
    disc("d3", [note(5, { by: "carol" }), note(6, { by: "me-bot", at: "2026-10-16T09:00:00Z" })]),
  ];

  test("a body-equal note by any author at any time reads via body", () => {
    const r = postedMatch(discussions, { by: "me-bot", since: SINCE, threads: [{ discussionId: "d1", body: "Fixed in abc." }] });
    expect(r.threads).toEqual([{ discussionId: "d1", found: true, posted: true, noteId: 2, via: "body" }]);
  });

  test("otherwise a note by `by` after since reads via author", () => {
    const r = postedMatch(discussions, { by: "me-bot", since: SINCE, threads: [{ discussionId: "d2", body: "something else" }] });
    expect(r.threads).toEqual([{ discussionId: "d2", found: true, posted: true, noteId: 4, via: "author" }]);
  });

  test("a note by `by` before since does not count", () => {
    const r = postedMatch(discussions, { by: "me-bot", since: SINCE, threads: [{ discussionId: "d3" }] });
    expect(r.threads).toEqual([{ discussionId: "d3", found: true, posted: false, noteId: null, via: null }]);
  });

  test("an unknown discussion reads found false", () => {
    const r = postedMatch(discussions, { by: "me-bot", since: SINCE, threads: [{ discussionId: "gone" }] });
    expect(r.threads).toEqual([{ discussionId: "gone", found: false, posted: false, noteId: null, via: null }]);
  });

  test("notes lists every non-system note by `by` after since", () => {
    const r = postedMatch([...discussions, disc("d4", [note(7, { by: "me-bot", system: true })])], { by: "ME-BOT", since: SINCE, threads: [] });
    expect(r.notes).toEqual([{ noteId: 4, discussionId: "d2", createdAt: "2026-10-16T12:00:00Z", path: null, line: null, body: "note 4" }]);
  });

  test("a note body is cut at 2000 characters", () => {
    const r = postedMatch([disc("d", [note(1, { by: "me-bot", body: "x".repeat(3000) })])], { by: "me-bot", since: SINCE });
    expect((r.notes[0]!.body as string).length).toBe(2000);
  });
});

describe("postedMatch on items", () => {
  const discussions = [
    disc("s1", [note(10, { by: "me-bot", body: "Review summary: 3 findings" })]),
    disc("p1", [note(11, { by: "me-bot", body: "Off by one here", path: "src/a.ts", line: 12 })]),
    disc("sys", [note(12, { by: "me-bot", body: "Review summary: changed the description", system: true })]),
    disc("old", [note(13, { by: "me-bot", body: "Old summary", at: "2026-10-15T00:00:00Z" })]),
  ];

  test("contains matches a summary note by `by` after since", () => {
    const r = postedMatch(discussions, { by: "me-bot", since: SINCE, items: [{ id: "summary", contains: "Review summary" }] });
    expect(r.items).toEqual([{ id: "summary", posted: true, noteId: 10, discussionId: "s1" }]);
  });

  test("path and line must equal the note's new-side position", () => {
    const r = postedMatch(discussions, {
      by: "me-bot", since: SINCE,
      items: [
        { id: "hit", body: "Off by one here", path: "src/a.ts", line: 12 },
        { id: "wrong-line", body: "Off by one here", path: "src/a.ts", line: 13 },
        { id: "wrong-path", body: "Off by one here", path: "src/b.ts" },
      ],
    });
    expect(r.items).toEqual([
      { id: "hit", posted: true, noteId: 11, discussionId: "p1" },
      { id: "wrong-line", posted: false, noteId: null, discussionId: null },
      { id: "wrong-path", posted: false, noteId: null, discussionId: null },
    ]);
  });

  test("a system note never matches", () => {
    const r = postedMatch(discussions, { by: "me-bot", since: SINCE, items: [{ id: "x", contains: "changed the description" }] });
    expect(r.items).toEqual([{ id: "x", posted: false, noteId: null, discussionId: null }]);
  });

  test("a note before since never matches", () => {
    const r = postedMatch(discussions, { by: "me-bot", since: SINCE, items: [{ id: "x", body: "Old summary" }] });
    expect(r.items[0]!.posted).toBe(false);
  });
});

describe("githubRefusal", () => {
  test("refuses a github.com identity and passes a GitLab one", () => {
    expect(githubRefusal(GH, "mr_posted_since", "read threads with gh")).toBe("GitLab only: mr_posted_since does not speak GitHub; read threads with gh");
    expect(githubRefusal(ID, "mr_posted_since", "read threads with gh")).toBeNull();
  });
});

describe("refuseGithubTarget", () => {
  const gh = "read threads with gh";
  const refusal = "GitLab only: mr_posted_since does not speak GitHub; read threads with gh";

  test("refuses a github.com mrUrl", () => {
    expect(refuseGithubTarget({ mrUrl: "https://github.com/acme/app/pull/3" }, "mr_posted_since", gh)).toBe(refusal);
    expect(refuseGithubTarget({ mrUrl: "https://GitHub.com/acme/app/pull/3" }, "mr_posted_since", gh)).toBe(refusal);
  });

  test("refuses a github.com repoName in identity or label form", () => {
    expect(refuseGithubTarget({ repoName: GH }, "mr_posted_since", gh)).toBe(refusal);
    expect(refuseGithubTarget({ repoName: "github.com/acme/app" }, "mr_posted_since", gh)).toBe(refusal);
  });

  test("passes a GitLab target and an empty input", () => {
    expect(refuseGithubTarget({ repoName: ID }, "mr_posted_since", gh)).toBeNull();
    expect(refuseGithubTarget({ mrUrl: "https://gitlab.com/acme/acme-dev/-/merge_requests/7" }, "mr_posted_since", gh)).toBeNull();
    expect(refuseGithubTarget({}, "mr_posted_since", gh)).toBeNull();
    expect(refuseGithubTarget({ mrUrl: "not a url" }, "mr_posted_since", gh)).toBeNull();
  });
});

describe("selfUsername", () => {
  test("reads data.body.username from forge:get user", async () => {
    const { deps, calls } = fake({ "forge:get": { status: 200, body: { username: "me-bot" }, truncated: false, nextPage: null, totalPages: null } });
    expect(await selfUsername(deps, ID)).toEqual({ ok: true, username: "me-bot" });
    expect(calls).toEqual([{ name: "forge:get", payload: { repoName: ID, path: "user" } }]);
  });
});

describe("mr_posted_since", () => {
  const answers = () => ({
    "forge:get": { status: 200, body: { username: "me-bot" }, truncated: false, nextPage: null, totalPages: null },
    "discussions:refresh": { discussions: [disc("d1", [note(1, { by: "carol" }), note(2, { by: "me-bot" })])], fetchedAt: 5 },
  });

  test("with by omitted it reads the token's user, then the discussions", async () => {
    const { deps, calls } = fake(answers());
    const res = await tool(deps, "mr_posted_since").handler({ repoName: ID, iid: 7, since: SINCE, threads: [{ discussionId: "d1" }] }, ENV);
    expect(calls).toEqual([
      { name: "forge:get", payload: { repoName: ID, path: "user" } },
      { name: "discussions:refresh", payload: { repoName: ID, iid: 7 } },
    ]);
    expect(res).toMatchObject({
      ok: true,
      body: { by: "me-bot", since: SINCE, threads: [{ discussionId: "d1", found: true, posted: true, noteId: 2, via: "author" }], items: [] },
    });
  });

  test("an explicit by skips the user read", async () => {
    const { deps, calls } = fake(answers());
    await tool(deps, "mr_posted_since").handler({ repoName: ID, iid: 7, since: SINCE, by: "carol", items: [{ id: "a", contains: "note" }] }, ENV);
    expect(calls.map((c) => c.name)).toEqual(["discussions:refresh"]);
  });

  test("since takes epoch milliseconds or an ISO time and refuses anything else", async () => {
    const { deps } = fake(answers());
    const t = tool(deps, "mr_posted_since");
    expect((await t.handler({ repoName: ID, iid: 7, since: 1792000000000, threads: [] }, ENV)).ok).toBe(true);
    const iso = await t.handler({ repoName: ID, iid: 7, since: "2026-10-16T10:00:00Z", threads: [] }, ENV);
    expect(iso).toMatchObject({ ok: true, body: { since: SINCE } });
    const bad = await t.handler({ repoName: ID, iid: 7, since: "yesterday", threads: [] }, ENV);
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('"since"');
  });

  test("refuses a call with neither threads nor items", async () => {
    const { deps, calls } = fake(answers());
    const res = await tool(deps, "mr_posted_since").handler({ repoName: ID, iid: 7, since: SINCE }, ENV);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("threads");
    expect(calls).toEqual([]);
  });

  test("a GitHub identity is refused before any command", async () => {
    const { deps, calls } = fake(answers());
    const res = await tool(deps, "mr_posted_since").handler({ repoName: GH, iid: 7, since: SINCE, threads: [{ discussionId: "d1" }] }, ENV);
    expect(res.ok).toBe(false);
    expect(res.error).toStartWith("GitLab only: mr_posted_since does not speak GitHub");
    expect(calls).toEqual([]);
  });

  test("a GitHub mrUrl is refused naming the gh move, before any command", async () => {
    const { deps, calls } = fake(answers());
    const res = await tool(deps, "mr_posted_since").handler({ mrUrl: "https://github.com/acme/app/pull/3", since: SINCE, threads: [{ discussionId: "d1" }] }, ENV);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("GitLab only: mr_posted_since does not speak GitHub; read threads with gh");
    expect(calls).toEqual([]);
  });

  test("a discussions:refresh error passes through verbatim", async () => {
    const { deps } = fake({ ...answers(), "discussions:refresh": new Error("GitLab returned 404 Not Found: 404 Merge Request Not Found") });
    const res = await tool(deps, "mr_posted_since").handler({ repoName: ID, iid: 7, since: SINCE, by: "me-bot", threads: [{ discussionId: "d1" }] }, ENV);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("GitLab returned 404 Not Found: 404 Merge Request Not Found");
  });

  test("the description starts GitLab only and names the target rule", () => {
    const { deps } = fake();
    const t = tool(deps, "mr_posted_since");
    expect(t.description).toStartWith("GitLab only.");
    expect(t.description).toContain("Name the target with repoName");
    expect(t.description).not.toContain("by by");
    expect(t.description).not.toContain("since since");
  });
});

describe("mr_resolve_branch", () => {
  const mr = (over: Record<string, unknown> = {}) => ({
    iid: 7, state: "opened", title: "Add x", author: { username: "alice", name: "Alice" },
    sourceBranch: "feat-x", targetBranch: "main", webUrl: "https://gitlab.com/acme/acme-dev/-/merge_requests/7", description: "long", ...over,
  });
  const tree = (name: string, branch: string | null) => ({ name, kind: "worktree", path: `/trees/${name}`, branch, repoName: ID, mr: null });
  const answers = (over: Record<string, unknown> = {}) => ({
    "mr:get": { mr: mr(), fetchedAt: 5 },
    "worktree:list": { trees: [tree("a", "feat-x"), tree("b", "feat-x-2"), tree("main", "main"), tree("c", null)] },
    ...over,
  });

  test("returns the MR fields and only the trees on the exact source branch", async () => {
    const { deps, calls } = fake(answers());
    const res = await tool(deps, "mr_resolve_branch").handler({ repoName: ID, iid: 7 }, ENV);
    expect(res).toMatchObject({
      ok: true,
      body: {
        iid: 7, state: "opened", title: "Add x", author: "alice", sourceBranch: "feat-x", targetBranch: "main",
        webUrl: "https://gitlab.com/acme/acme-dev/-/merge_requests/7", trees: [{ name: "a", path: "/trees/a" }],
      },
    });
    expect(Object.keys((res as any).body.trees[0])).toEqual(["name", "path"]);
    expect(calls).toEqual([
      { name: "mr:get", payload: { repoName: ID, iid: 7 } },
      { name: "worktree:list", payload: { repoName: ID } },
    ]);
  });

  test("two trees on the branch return both", async () => {
    const { deps } = fake(answers({ "worktree:list": { trees: [tree("a", "feat-x"), tree("b", "feat-x")] } }));
    const res = await tool(deps, "mr_resolve_branch").handler({ repoName: ID, iid: 7 }, ENV);
    expect(res).toMatchObject({ ok: true, body: { trees: [{ name: "a", path: "/trees/a" }, { name: "b", path: "/trees/b" }] } });
  });

  test("no tree returns an empty list", async () => {
    const { deps } = fake(answers({ "worktree:list": { trees: [tree("main", "main")] } }));
    const res = await tool(deps, "mr_resolve_branch").handler({ repoName: ID, iid: 7 }, ENV);
    expect(res).toMatchObject({ ok: true, body: { trees: [] } });
  });

  test("a merged MR still resolves", async () => {
    const { deps } = fake(answers({ "mr:get": { mr: mr({ state: "merged" }), fetchedAt: 5 } }));
    const res = await tool(deps, "mr_resolve_branch").handler({ repoName: ID, iid: 7 }, ENV);
    expect(res).toMatchObject({ ok: true, body: { state: "merged", trees: [{ name: "a" }] } });
  });

  test("a GitHub identity is refused naming the gh move, before any command", async () => {
    const { deps, calls } = fake(answers());
    const res = await tool(deps, "mr_resolve_branch").handler({ repoName: GH, iid: 3 }, ENV);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("GitLab only: mr_resolve_branch does not speak GitHub; gh pr view <n> --json headRefName");
    expect(calls).toEqual([]);
  });

  test("a GitHub mrUrl is refused naming the gh move, before any command", async () => {
    const { deps, calls } = fake(answers());
    const res = await tool(deps, "mr_resolve_branch").handler({ mrUrl: "https://github.com/acme/app/pull/3" }, ENV);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("GitLab only: mr_resolve_branch does not speak GitHub; gh pr view <n> --json headRefName");
    expect(calls).toEqual([]);
  });

  test("an mr:get error passes through verbatim and skips the worktree read", async () => {
    const { deps, calls } = fake(answers({ "mr:get": new Error("GitLab returned 404 Not Found: 404 Merge Request Not Found") }));
    const res = await tool(deps, "mr_resolve_branch").handler({ repoName: ID, iid: 7 }, ENV);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("GitLab returned 404 Not Found: 404 Merge Request Not Found");
    expect(calls.map((c) => c.name)).toEqual(["mr:get"]);
  });

  test("a worktree:list error passes through", async () => {
    const { deps } = fake(answers({ "worktree:list": new Error("daemon down") }));
    const res = await tool(deps, "mr_resolve_branch").handler({ repoName: ID, iid: 7 }, ENV);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("daemon down");
  });

  test("the description starts GitLab only and names the target rule", () => {
    const { deps } = fake();
    const t = tool(deps, "mr_resolve_branch");
    expect(t.description).toStartWith("GitLab only.");
    expect(t.description).toContain("Name the target with repoName");
  });
});

describe("mr_map", () => {
  const summary = (iid: number, sourceBranch: string, over: Record<string, unknown> = {}) => ({
    iid, title: `MR ${iid}`, state: "opened", draft: false, sourceBranch, targetBranch: "main", author: "alice", webUrl: null, detailedMergeStatus: null, ...over,
  });
  const tree = (name: string, branch: string | null) => ({ name, kind: "worktree", path: `/trees/${name}`, branch, repoName: ID, mr: null });
  const answers = (over: Record<string, unknown> = {}) => ({
    "mr:list-live": { mrs: [summary(1, "feat-a"), summary(2, "feat-b", { targetBranch: "feat-a", draft: true, author: "bob" }), summary(3, "feat-c")], truncated: false },
    "worktree:list": { trees: [tree("a", "feat-a"), tree("b", "feat-b")] },
    "forge:get": { status: 200, body: { default_branch: "main" }, truncated: false, nextPage: null, totalPages: null },
    ...over,
  });
  const cache = (pipelines: Record<number, string>) => (async () => ({
    ok: true,
    data: { mrs: Object.fromEntries(Object.entries(pipelines).map(([iid, status]) => [`k${iid}`, { pr: { iid: Number(iid), pipeline: { status } }, fetchedAt: 0 }])) },
  })) as any;
  const withDeps = (over: Record<string, unknown> = {}, extra: Partial<MrCompositeDeps> = {}) => {
    const f = fake(answers(over));
    f.deps.readMrCache = cache({ 1: "success" });
    f.deps.status = async (path: string) => (path === "/trees/a" ? " M x\n" : "");
    Object.assign(f.deps, extra);
    return f;
  };
  const call = (deps: MrCompositeDeps, input: Record<string, unknown>) => tool(deps, "mr_map").handler(input, ENV);

  test("joins a live open-MR list to the trees with every row field", async () => {
    const { deps, calls } = withDeps();
    const res = await call(deps, { repoName: ID });
    expect(res).toEqual({
      ok: true,
      body: {
        complete: true,
        rows: [
          { ref: "!1", iid: 1, title: "MR 1", author: "alice", sourceBranch: "feat-a", targetBranch: "main", draft: false, stacked: false, worktree: "/trees/a", dirty: true, mrState: "opened", ciStatus: "success" },
          { ref: "!2", iid: 2, title: "MR 2", author: "bob", sourceBranch: "feat-b", targetBranch: "feat-a", draft: true, stacked: true, worktree: "/trees/b", dirty: false, mrState: "opened", ciStatus: null },
          { ref: "!3", iid: 3, title: "MR 3", author: "alice", sourceBranch: "feat-c", targetBranch: "main", draft: false, stacked: false, worktree: null, dirty: null, mrState: "opened", ciStatus: null },
        ],
      },
    } as any);
    expect(calls.find((c) => c.name === "mr:list-live")!.payload).toEqual({ repoName: ID, state: "opened", limit: 200 });
    expect(calls.find((c) => c.name === "forge:get")!.payload).toEqual({ repoName: ID, path: "projects/:id" });
    expect(calls.find((c) => c.name === "worktree:list")!.payload).toEqual({ repoName: ID });
  });

  test("author is passed through to mr:list-live", async () => {
    const { deps, calls } = withDeps();
    await call(deps, { repoName: ID, author: "me" });
    expect(calls.find((c) => c.name === "mr:list-live")!.payload).toEqual({ repoName: ID, state: "opened", limit: 200, author: "me" });
  });

  test("complete is false when the list was truncated", async () => {
    const { deps } = withDeps({ "mr:list-live": { mrs: [], truncated: true } });
    expect(await call(deps, { repoName: ID })).toMatchObject({ ok: true, body: { rows: [], complete: false } });
  });

  test("a failed default-branch read leaves stacked null and the call still succeeds", async () => {
    const { deps } = withDeps({ "forge:get": new Error("403 Forbidden") });
    const res = (await call(deps, { repoName: ID })) as any;
    expect(res.ok).toBe(true);
    expect(res.body.rows.map((r: any) => r.stacked)).toEqual([null, null, null]);
  });

  test("dirty is null when git status throws", async () => {
    const { deps } = withDeps({}, { status: async () => { throw new Error("not a git repo"); } });
    const res = (await call(deps, { repoName: ID })) as any;
    expect(res.body.rows.map((r: any) => r.dirty)).toEqual([null, null, null]);
  });

  test("ciStatus is null on a cache error, thrown or returned", async () => {
    for (const readMrCache of [(async () => { throw new Error("socket"); }) as any, (async () => ({ ok: false, error: "x" })) as any]) {
      const { deps } = withDeps({}, { readMrCache });
      const res = (await call(deps, { repoName: ID })) as any;
      expect(res.ok).toBe(true);
      expect(res.body.rows.map((r: any) => r.ciStatus)).toEqual([null, null, null]);
    }
  });

  test("an mr:list-live error fails the call", async () => {
    const { deps } = withDeps({ "mr:list-live": new Error("GitLab returned 500") });
    const res = await call(deps, { repoName: ID });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("GitLab returned 500");
  });

  test("a worktree:list error fails the call", async () => {
    const { deps } = withDeps({ "worktree:list": new Error("daemon down") });
    const res = await call(deps, { repoName: ID });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("daemon down");
  });

  test("the legacy repo works like repoName", async () => {
    const { deps, calls } = withDeps();
    const res = await call(deps, { repo: ID });
    expect(res.ok).toBe(true);
    expect(calls.find((c) => c.name === "mr:list-live")!.payload.repoName).toBe(ID);
  });

  test("repoName and repo together are refused", async () => {
    const { deps, calls } = withDeps();
    const res = await call(deps, { repoName: ID, repo: ID });
    expect(res).toEqual({ ok: false, error: "pass repoName, not both repoName and repo" } as any);
    expect(calls).toEqual([]);
  });

  test("an empty author is refused", async () => {
    const { deps } = withDeps();
    const res = await call(deps, { repoName: ID, author: " " });
    expect(res.ok).toBe(false);
  });

  test("a GitHub repoName, legacy repo or mrUrl is refused naming the gh move, before any command", async () => {
    for (const input of [{ repoName: GH }, { repo: GH }, { repo: "github.com/acme/app" }, { mrUrl: "https://github.com/acme/app/pull/3" }]) {
      const { deps, calls } = withDeps();
      const res = await call(deps, input);
      expect(res.ok).toBe(false);
      expect(res.error).toStartWith("GitLab only: mr_map does not speak GitHub; ");
      expect(res.error).toContain("gh pr list --author @me");
      expect(calls).toEqual([]);
    }
  });

  test("the description starts GitLab only, says live, and names the target rule", () => {
    const t = tool(fake().deps, "mr_map");
    expect(t.description).toStartWith("GitLab only.");
    expect(t.description).toContain("live");
    expect(t.description).toContain("200");
    expect(t.description).toContain("Name the target with repoName");
    expect(Object.keys((t.inputSchema as any).properties).sort()).toEqual(["author", "mrUrl", "repo", "repoName"]);
  });
});

describe("findOpenMrForBranch", () => {
  const pr = { iid: 7, title: "T", draft: true, webUrl: "https://gitlab.com/acme/acme-dev/-/merge_requests/7", sourceBranch: "feat", targetBranch: "main", description: "d" };

  test("reads mr:live-by-branch for the branch and trims the MR to the fields it returns", async () => {
    const { deps, calls } = fake({ "mr:live-by-branch": { byBranch: { feat: pr } } });
    const r = await findOpenMrForBranch(deps, ID, "feat");
    expect(r).toEqual({ ok: true, mr: { iid: 7, url: pr.webUrl, targetBranch: "main", draft: true, title: "T" } });
    expect(calls).toEqual([{ name: "mr:live-by-branch", payload: { repoName: ID, branches: ["feat"] } }]);
  });

  test("a branch with no open MR reads mr null", async () => {
    const { deps } = fake({ "mr:live-by-branch": { byBranch: { feat: null } } });
    expect(await findOpenMrForBranch(deps, ID, "feat")).toEqual({ ok: true, mr: null });
  });

  test("a lookup error is returned, never read as no MR", async () => {
    const { deps } = fake({ "mr:live-by-branch": new Error("GitLab returned 403 Forbidden: no") });
    const r = await findOpenMrForBranch(deps, ID, "feat");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("403");
  });
});

describe("EXISTING_MR", () => {
  test("matches GitLab's duplicate-MR 409 text", () => {
    expect(EXISTING_MR.test("Error: createPullRequest failed: 409 Conflict \u2014 Another open merge request already exists for this source branch: !7")).toBe(true);
    expect(EXISTING_MR.test("createPullRequest failed: 403 Forbidden")).toBe(false);
  });
});
