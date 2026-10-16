import { describe, expect, test } from "bun:test";
import type { Discussion } from "../../../packages/rt-client/src/index.ts";
import { githubRefusal, mrCompositeToolDefs, refuseGithubTarget, normalizeBody, postedMatch, selfUsername, type MrCompositeDeps } from "../mr-composite-tools.ts";

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
