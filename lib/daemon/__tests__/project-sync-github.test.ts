import { describe, expect, test } from "bun:test";
import type { FetchMergeRequestIndexOptions, FetchPullRequestsOptions, FetchPullRequestsWarning, MergeRequestIndexRow, PullRequest } from "@mattstack/glance";
import { authorListed, prInScope } from "../scope-authors.ts";
import { githubFetchDelta, githubFetchOpen, githubFetchSingle, type GitHubSyncContext } from "../project-sync-github.ts";
import type { ProjectMREntry, ProjectMRStore } from "../project-mrs-store.ts";

function pr(iid: number, over: Partial<PullRequest> = {}): PullRequest {
  return {
    id: `github:pr:${iid}`, iid, title: `PR ${iid}`, state: "opened",
    sourceBranch: `b${iid}`, targetBranch: "main", webUrl: "",
    updatedAt: "2026-11-11T00:00:00Z", mergedAt: null,
    author: { username: "octo" },
    ...over,
  } as unknown as PullRequest;
}

type Reply = { prs: PullRequest[]; warnings?: FetchPullRequestsWarning[] };

function fakeProvider(
  list: (opts: FetchPullRequestsOptions) => Reply,
  single: (iid: number) => { pr: PullRequest | null; warnings?: FetchPullRequestsWarning[] } = () => ({ pr: null }),
  index: (opts: FetchMergeRequestIndexOptions) => Promise<MergeRequestIndexRow[]> = async () => [],
) {
  const listCalls: FetchPullRequestsOptions[] = [];
  const singleCalls: number[] = [];
  const indexCalls: FetchMergeRequestIndexOptions[] = [];
  const provider = {
    async fetchMergeRequestIndex(opts: FetchMergeRequestIndexOptions) {
      indexCalls.push(opts);
      return index(opts);
    },
    async fetchPullRequests(opts?: FetchPullRequestsOptions) {
      listCalls.push(opts!);
      const reply = list(opts!);
      for (const w of reply.warnings ?? []) opts?.onWarning?.(w);
      return reply.prs;
    },
    async fetchSingleMR(_projectPath: string, iid: number, _user: number | null, onWarning?: (w: FetchPullRequestsWarning) => void) {
      singleCalls.push(iid);
      const reply = single(iid);
      for (const w of reply.warnings ?? []) onWarning?.(w);
      return reply.pr;
    },
  };
  const ctx = { provider, projectPath: "o/r" } as unknown as GitHubSyncContext;
  return { ctx, listCalls, singleCalls, indexCalls };
}

function row(iid: number, over: Partial<MergeRequestIndexRow> = {}): MergeRequestIndexRow {
  return {
    iid, projectPath: "o/r", title: `PR ${iid}`, state: "merged",
    createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-11T00:00:00Z", mergedAt: "2026-11-11T00:00:00Z",
    authorUsername: "octo", sourceBranch: `b${iid}`, labels: [],
    ...over,
  };
}

const warn = (kind: FetchPullRequestsWarning["kind"], source: FetchPullRequestsWarning["source"]): FetchPullRequestsWarning =>
  ({ kind, source, message: `${kind} on ${source}` });

describe("authorListed", () => {
  test("authorListed ignores case on GitHub only", () => {
    expect(authorListed(["Octo"], { id: "github:pr:1", author: { username: "octo" } })).toBe(true);
    expect(authorListed(["Octo"], { id: "gitlab:mr:1", author: { username: "octo" } })).toBe(false);
    expect(authorListed(["Octo"], { id: "github:pr:1", author: null })).toBe(false);
    expect(authorListed(["Octo"], { id: "github:pr:1" })).toBe(false);
  });
});

describe("prInScope", () => {
  const scoped = (mrs: Record<number, ProjectMREntry> = {}) =>
    ({ mrs, scope: { authors: ["Octo"] } }) as unknown as ProjectMRStore;

  test("no record or no scope keeps every PR", () => {
    expect(prInScope(undefined, pr(1, { author: { username: "stranger" } } as Partial<PullRequest>))).toBe(true);
    expect(prInScope({ mrs: {} } as unknown as ProjectMRStore, pr(1, { author: { username: "stranger" } } as Partial<PullRequest>))).toBe(true);
  });

  test("a PR with no author username is kept", () => {
    expect(prInScope(scoped(), pr(1, { author: null } as unknown as Partial<PullRequest>))).toBe(true);
  });

  test("a listed author is in scope, case-insensitively on GitHub", () => {
    expect(prInScope(scoped(), pr(1))).toBe(true);
  });

  test("a stranger is out unless the stored PR is section-tagged", () => {
    const stranger = pr(2, { author: { username: "stranger" } } as Partial<PullRequest>);
    expect(prInScope(scoped(), stranger)).toBe(false);
    expect(prInScope(scoped({ 2: { pr: stranger, fetchedAt: 0, codeownerSections: [] } }), stranger)).toBe(false);
    expect(prInScope(scoped({ 2: { pr: stranger, fetchedAt: 0, codeownerSections: ["api"] } }), stranger)).toBe(true);
  });
});

describe("githubFetchOpen", () => {
  test("githubFetchOpen lists open PRs once and filters authors", async () => {
    const prs = [pr(1, { author: { username: "octo" } } as Partial<PullRequest>), pr(2, { author: { username: "Dev" } } as Partial<PullRequest>), pr(3, { author: { username: "x" } } as Partial<PullRequest>)];
    const { ctx, listCalls } = fakeProvider(() => ({ prs }));
    const out = await githubFetchOpen(ctx, ["OCTO", "dev"]);
    expect(out.map((p) => p.iid)).toEqual([1, 2]);
    expect(listCalls).toHaveLength(1);
    expect(listCalls[0]).toMatchObject({ projectPath: "o/r", state: "opened", listWeight: true });
    expect(listCalls[0]!.authorUsernames).toBeUndefined();
    expect(typeof listCalls[0]!.onWarning).toBe("function");

    const all = await githubFetchOpen(ctx, null);
    expect(all.map((p) => p.iid)).toEqual([1, 2, 3]);
  });

  test("a fill or page-cap warning fails the read; a contexts warning does not", async () => {
    const prs = [pr(1)];
    await expect(githubFetchOpen(fakeProvider(() => ({ prs, warnings: [warn("request-failed", "fill")] })).ctx, null))
      .rejects.toThrow("GitHub read incomplete");
    await expect(githubFetchOpen(fakeProvider(() => ({ prs, warnings: [warn("page-cap", "list")] })).ctx, null))
      .rejects.toThrow("GitHub read incomplete");
    const ok = await githubFetchOpen(fakeProvider(() => ({ prs, warnings: [warn("page-cap", "contexts")] })).ctx, null);
    expect(ok.map((p) => p.iid)).toEqual([1]);
  });
});

describe("githubFetchSingle", () => {
  test("githubFetchSingle throws on a failed fill and returns null for a real miss", async () => {
    const failed = fakeProvider(() => ({ prs: [] }), () => ({ pr: null, warnings: [warn("request-failed", "fill")] }));
    await expect(githubFetchSingle(failed.ctx, 7)).rejects.toThrow("GitHub read incomplete");
    const miss = fakeProvider(() => ({ prs: [] }), () => ({ pr: null }));
    expect(await githubFetchSingle(miss.ctx, 7)).toBeNull();
    expect(miss.singleCalls).toEqual([7]);
  });
});

describe("githubFetchDelta", () => {
  function storeWith(entries: PullRequest[]): ProjectMRStore {
    const mrs: ProjectMRStore["mrs"] = {};
    for (const p of entries) mrs[p.iid] = { pr: p, fetchedAt: 0 };
    return { projectPath: "o/r", mrs, listSyncedAt: 0, source: "poll", scope: { authors: ["octo"], windowDays: 30 } };
  }

  const UA = "2026-11-10T00:00:00Z";

  test("terminal rows follow fetchDeltaFrom's reuse rule", async () => {
    const stored = storeWith([
      pr(5, { sourceBranch: "b" }),
      pr(2, { sourceBranch: "c", state: "merged" }),
      pr(4, { sourceBranch: "e", state: "merged" }),
    ]);
    const rows = [
      row(3, { sourceBranch: "b" }),
      row(8, { sourceBranch: "c", authorUsername: "Octo" }),
      row(9, { sourceBranch: "d", state: "closed", mergedAt: null }),
      row(11, { sourceBranch: "e", authorUsername: "stranger" }),
    ];
    const filled = pr(8, { sourceBranch: "c", state: "merged" });
    const { ctx, singleCalls } = fakeProvider(() => ({ prs: [] }), (iid) => ({ pr: iid === 8 ? filled : null }), async () => rows);
    const out = await githubFetchDelta(ctx, UA, stored);
    expect(out).toEqual([filled]);
    expect(singleCalls).toEqual([8]);
  });

  test("a row authored bob with scope author Bob comes back as Bob", async () => {
    const stored = { ...storeWith([pr(2, { sourceBranch: "c", state: "merged" })]), scope: { authors: ["Bob"], windowDays: 30 } };
    const { ctx, singleCalls } = fakeProvider(() => ({ prs: [] }), (iid) => ({ pr: pr(iid) }), async () => [row(8, { sourceBranch: "c", authorUsername: "bob" })]);
    await githubFetchDelta(ctx, UA, stored);
    expect(singleCalls).toEqual([8]);
  });

  test("a stored terminal row moves its entry with no fill", async () => {
    const stored = storeWith([pr(5, { sourceBranch: "b" })]);
    const { ctx, singleCalls } = fakeProvider(() => ({ prs: [] }), () => ({ pr: null }), async () => [row(5, { sourceBranch: "b", title: "renamed" })]);
    const out = await githubFetchDelta(ctx, UA, stored);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ iid: 5, state: "merged", title: "renamed", mergedAt: "2026-11-11T00:00:00Z" });
    expect(singleCalls).toEqual([]);
  });

  test("one delta cycle costs one listing plus one index call and no terminal fill", async () => {
    const { ctx, listCalls, singleCalls, indexCalls } = fakeProvider(() => ({ prs: [] }));
    await githubFetchDelta(ctx, UA, storeWith([pr(5)]));
    expect(listCalls).toHaveLength(1);
    expect(listCalls[0]).toMatchObject({ projectPath: "o/r", state: "opened", updatedAfter: UA, listWeight: true });
    expect(indexCalls).toEqual([{ projectPaths: ["o/r"], updatedAfter: UA, states: ["merged", "closed"], excludeTargetBranches: [] }]);
    expect(singleCalls).toEqual([]);
  });

  test("a failed index read fails the delta", async () => {
    const { ctx } = fakeProvider(() => ({ prs: [] }), () => ({ pr: null }), async () => { throw new Error("index 502"); });
    await expect(githubFetchDelta(ctx, UA, undefined)).rejects.toThrow("index 502");
  });
});
