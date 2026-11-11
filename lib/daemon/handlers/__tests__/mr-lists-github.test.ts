/**
 * The list, label and pipeline verbs on a GitHub repo context: each one goes
 * through glance's forge-neutral read, and a rate limit is an error that says
 * when to retry.
 */
import { describe, expect, test } from "bun:test";
import { ForgeHttpError, RateLimitedError } from "@mattstack/glance";
import { createMRHandlers } from "../mr.ts";
import { fakeStore } from "../../__tests__/fake-cache-store.ts";

const REPO = "remote:github.com%2Fo%2Fr";

const summary = (iid: number, over: Record<string, unknown> = {}) => ({
  iid, title: `t${iid}`, state: "opened", draft: false, sourceBranch: `b${iid}`, targetBranch: "main",
  author: "octo", webUrl: `https://github.com/o/r/pull/${iid}`, detailedMergeStatus: null, mergedAt: null, ...over,
});
const prOf = (iid: number, sourceBranch: string) => ({ iid, sourceBranch, webUrl: `https://github.com/o/r/pull/${iid}` }) as any;

const READS = [
  "fetchPullRequestSummaries", "fetchPullRequestsByBranches", "fetchProjectLabels", "fetchPipelineList",
  "fetchCommitParents", "fetchPipelineFailedJobs", "fetchSingleMR",
] as const;

function harness(methods: Partial<Record<(typeof READS)[number], (...args: any[]) => unknown>> = {}) {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const provider: Record<string, unknown> = { baseURL: "https://github.com" };
  for (const name of READS) {
    provider[name] = async (...args: unknown[]) => {
      calls.push({ name, args });
      const impl = methods[name];
      if (!impl) throw new Error(`unexpected ${name}`);
      return impl(...args);
    };
  }
  const handlers = createMRHandlers({ cache: fakeStore({}), repoIndex: () => ({ [REPO]: "/tmp/repo" }), log: { warn() {}, info() {}, debug() {}, error() {} } as any }, () => {}, {
    getContext: async () => ({ forge: "github", provider, projectPath: "o/r", projectId: null }),
    writeback: () => { throw new Error("a GitHub read must not write the project-MRs store"); },
  });
  return { handlers, calls, names: () => calls.map((c) => c.name) };
}

describe("list reads on GitHub", () => {
  test("mr:list-live returns the summaries, newest update first", async () => {
    const h = harness({ fetchPullRequestSummaries: async () => ({ rows: [summary(3)], truncated: true }) });
    const r = await h.handlers["mr:list-live"]({ repoName: REPO, author: "octo", limit: 1 });
    expect(r).toEqual({ ok: true, data: { mrs: [summary(3)], truncated: true } });
    expect(h.calls).toEqual([{ name: "fetchPullRequestSummaries", args: ["o/r", { state: "opened", sort: "updated_desc", author: "octo", limit: 1 }] }]);
  });

  test("mr:by-target returns every PR targeting the branch", async () => {
    const h = harness({ fetchPullRequestSummaries: async () => ({ rows: [summary(4, { targetBranch: "feat" })], truncated: false }) });
    const r = await h.handlers["mr:by-target"]({ repoName: REPO, targetBranch: "feat", state: "all" });
    expect(r).toEqual({ ok: true, data: { mrs: [summary(4, { targetBranch: "feat" })] } });
    expect(h.calls).toEqual([{ name: "fetchPullRequestSummaries", args: ["o/r", { state: "all", targetBranch: "feat", limit: 2000 }] }]);
  });

  test("project:labels returns the labels, asking for at most 1000", async () => {
    const labels = [{ name: "bug", description: "Something broke", color: "#d73a4a" }];
    const h = harness({ fetchProjectLabels: async () => ({ labels, truncated: false }) });
    expect(await h.handlers["project:labels"]({ repoName: REPO, search: "bu" })).toEqual({ ok: true, data: { labels } });
    expect(h.calls).toEqual([{ name: "fetchProjectLabels", args: ["o/r", { search: "bu", maxRows: 1000 }] }]);
  });

  test("pipeline:list returns the workflow runs", async () => {
    const run = { id: 77, status: "failed", ref: "feat", sha: "abc", source: "push", webUrl: "https://github.com/o/r/actions/runs/77", createdAt: "2026-11-10T00:00:00Z" };
    const h = harness({ fetchPipelineList: async () => [run] });
    expect(await h.handlers["pipeline:list"]({ repoName: REPO, ref: "feat" })).toEqual({ ok: true, data: { pipelines: [run] } });
    expect(h.calls).toEqual([{ name: "fetchPipelineList", args: ["o/r", { ref: "feat", limit: 20 }] }]);
  });

  test("pipeline:list still refuses an iid beside a ref before any request", async () => {
    const h = harness();
    expect(await h.handlers["pipeline:list"]({ repoName: REPO, iid: 4, ref: "feat" })).toEqual({ ok: false, error: '"iid" lists one MR\'s own pipelines and cannot be combined with "ref" or "sha"' });
    expect(h.calls).toEqual([]);
  });

  test("mr:commit-parents returns the commit's parents", async () => {
    const h = harness({ fetchCommitParents: async () => ["p1", "p2"] });
    expect(await h.handlers["mr:commit-parents"]({ repoName: REPO, iid: 4, sha: "abc1234" })).toEqual({ ok: true, data: ["p1", "p2"] });
    expect(h.calls).toEqual([{ name: "fetchCommitParents", args: ["o/r", "abc1234"] }]);
  });

  test("mr:pipeline-failed-jobs returns the run's failed jobs", async () => {
    const job = { id: "github:check:5", name: "unit", stage: "checks", status: "failed", allowFailure: false, duration: 3, webUrl: null, runId: "77" };
    const h = harness({ fetchPipelineFailedJobs: async () => [job] });
    expect(await h.handlers["mr:pipeline-failed-jobs"]({ repoName: REPO, iid: 4, pipelineId: 77 })).toEqual({ ok: true, data: [job] });
    expect(h.calls).toEqual([{ name: "fetchPipelineFailedJobs", args: ["o/r", 77] }]);
  });

  test("a GitHub refusal names GitHub", async () => {
    const h = harness({ fetchProjectLabels: async () => { throw new ForgeHttpError("GitHub returned 404 Not Found: Not Found", 404, "Not Found", "Not Found"); } });
    expect(await h.handlers["project:labels"]({ repoName: REPO })).toEqual({ ok: false, error: "GitHub returned 404 Not Found: Not Found" });
  });
});

describe("mr:live-by-branch on GitHub", () => {
  test("three branches take one batched read and nothing else", async () => {
    const h = harness({
      fetchPullRequestsByBranches: async (_p: string, branches: string[]) => new Map(branches.map((b, i) => [b, prOf(i + 1, b)])),
    });
    const r = await h.handlers["mr:live-by-branch"]({ repoName: REPO, branches: ["a", "b", "c"] });
    expect(r).toEqual({ ok: true, data: { byBranch: { a: prOf(1, "a"), b: prOf(2, "b"), c: prOf(3, "c") } } });
    expect(h.calls).toEqual([{ name: "fetchPullRequestsByBranches", args: ["o/r", ["a", "b", "c"]] }]);
  });

  test("a branch with no open pull request maps to null", async () => {
    const h = harness({
      fetchPullRequestsByBranches: async () => new Map([["a", prOf(1, "a")], ["gone", null]]),
      fetchPullRequestSummaries: async () => ({ rows: [summary(1, { sourceBranch: "a" })], truncated: false }),
    });
    const r = await h.handlers["mr:live-by-branch"]({ repoName: REPO, branches: ["a", "gone"] });
    expect(r).toEqual({ ok: true, data: { byBranch: { a: prOf(1, "a"), gone: null } } });
    expect(h.names()).toEqual(["fetchPullRequestsByBranches", "fetchPullRequestSummaries"]);
    expect(h.calls[1]!.args).toEqual(["o/r", { state: "opened", limit: 2000 }]);
  });

  test("a branch whose pull request the batch could not fill is read on its own", async () => {
    const h = harness({
      fetchPullRequestsByBranches: async () => new Map([["feat", null]]),
      fetchPullRequestSummaries: async () => ({ rows: [summary(9, { sourceBranch: "feat" })], truncated: false }),
      fetchSingleMR: async () => prOf(9, "feat"),
    });
    const r = await h.handlers["mr:live-by-branch"]({ repoName: REPO, branches: ["feat"] });
    expect(r).toEqual({ ok: true, data: { byBranch: { feat: prOf(9, "feat") } } });
    expect(h.calls[2]).toEqual({ name: "fetchSingleMR", args: ["o/r", 9, null] });
  });

  test("an open pull request that still cannot be read is an error, never a null", async () => {
    const h = harness({
      fetchPullRequestsByBranches: async () => new Map([["feat", null]]),
      fetchPullRequestSummaries: async () => ({ rows: [summary(9, { sourceBranch: "feat" })], truncated: false }),
      fetchSingleMR: async () => null,
    });
    expect(await h.handlers["mr:live-by-branch"]({ repoName: REPO, branches: ["feat"] })).toEqual({
      ok: false, error: "GitHub has pull request #9 open on feat in o/r but could not read it; try again",
    });
  });

  test("a branch missing from a cut listing of open pull requests is an error, never a null", async () => {
    const h = harness({
      fetchPullRequestsByBranches: async () => new Map([["feat", null]]),
      fetchPullRequestSummaries: async () => ({ rows: [summary(1)], truncated: true }),
    });
    expect(await h.handlers["mr:live-by-branch"]({ repoName: REPO, branches: ["feat"] })).toEqual({
      ok: false, error: "could not tell whether feat has an open pull request: o/r has more than 2000 open",
    });
  });
});

describe("a GitHub rate limit", () => {
  const limited = () => new RateLimitedError("GitHub secondary rate limit hit on GET /repos/o/r/x", { kind: "secondary", resetAt: null, retryAfterMs: 60000, operation: "GET /repos/o/r/x" });
  const throwLimited = async () => { throw limited(); };
  const cases: Array<[string, Record<string, unknown>]> = [
    ["mr:list-live", {}],
    ["mr:by-target", { targetBranch: "feat" }],
    ["mr:live-by-branch", { branches: ["feat"] }],
    ["project:labels", {}],
    ["pipeline:list", { ref: "feat" }],
    ["mr:commit-parents", { iid: 4, sha: "abc1234" }],
    ["mr:pipeline-failed-jobs", { iid: 4, pipelineId: 77 }],
  ];

  for (const [verb, payload] of cases) {
    test(`${verb} answers with an error naming the limit and the wait`, async () => {
      const h = harness(Object.fromEntries(READS.map((name) => [name, throwLimited])));
      const r = await (h.handlers as any)[verb]({ repoName: REPO, ...payload });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("rate limit");
      expect(r.error).toContain("retry in 60s");
      expect(h.calls).toHaveLength(1);
    });
  }
});
