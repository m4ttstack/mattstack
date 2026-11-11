/**
 * MR verbs on a GitHub repo context: the provider interface carries every
 * write, squash is refused, rebase is refused when the provider cannot, and
 * nothing is written back into the GitLab-shaped stores.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { RateLimitedError, ReadBackFailedError } from "@mattstack/glance";
import { createMRHandlers } from "../mr.ts";
import { createProjectMRsHandlers } from "../project-mrs.ts";
import { createProjectMRs } from "../../project-mrs-store.ts";
import { openStateDb } from "../../../state/index.ts";
import { fakeStore } from "../../__tests__/fake-cache-store.ts";

const REPO = "remote:github.com%2Fo%2Fr";
const PR_URL = "https://github.com/o/r/pull/7";
const prOf = (iid: number, over: Record<string, unknown> = {}) =>
  ({ iid, webUrl: `https://github.com/o/r/pull/${iid}`, title: "t", sourceBranch: `b${iid}`, state: "opened", ...over }) as any;

function stubProvider(methods: Record<string, (...args: any[]) => any> = {}, canRebase = false) {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const record = (name: string, impl?: (...args: any[]) => any) => async (...args: unknown[]) => {
    calls.push({ name, args });
    return impl ? impl(...args) : undefined;
  };
  const provider: Record<string, unknown> = {
    baseURL: "https://github.com",
    capabilities: { canRebase },
    restRequest: record("restRequest", () => new Response("{}", { status: 200 })),
  };
  for (const name of [
    "mergePullRequest", "rebasePullRequest", "approvePullRequest", "updatePullRequest", "createPullRequest",
    "addPullRequestLabels", "removePullRequestLabels", "fetchSingleMR", "fetchJobDetail", "fetchJobTrace",
  ]) provider[name] = record(name, methods[name]);
  return { provider, calls };
}

function harness(methods: Record<string, (...args: any[]) => any> = {}, canRebase = false) {
  const { provider, calls } = stubProvider(methods, canRebase);
  const writebacks: unknown[] = [];
  const debugs: string[] = [];
  const log = { warn() {}, info() {}, error() {}, debug(_o: unknown, msg: string) { debugs.push(msg); } } as any;
  const handlers = createMRHandlers({ cache: fakeStore({}), repoIndex: () => ({ [REPO]: "/tmp/repo" }), log }, () => {}, {
    getContext: async () => ({ forge: "github", provider, projectPath: "o/r", projectId: null }),
    writeback: (...args) => { writebacks.push(args); },
    retryDelayMs: 1,
  });
  return { handlers, calls, writebacks, debugs, names: () => calls.map((c) => c.name) };
}

describe("mr:action on GitHub", () => {
  test("rebase refuses before any provider call when the provider cannot rebase", async () => {
    const h = harness();
    const res = await h.handlers["mr:action"]({ repoName: REPO, iid: 7, action: "rebase" });
    expect(res).toEqual({ ok: false, error: "GitHub cannot rebase a pull request; rebase the branch with git and push" });
    expect(h.calls).toEqual([]);
    expect(h.writebacks).toEqual([]);
  });

  test("merge calls mergePullRequest and returns ok with no write-back", async () => {
    const h = harness({ mergePullRequest: async () => prOf(7, { state: "merged" }) });
    const res = await h.handlers["mr:action"]({ repoName: REPO, iid: 7, action: "merge", args: [{ squash: true }] });
    expect(res).toEqual({ ok: true });
    expect(h.calls).toEqual([{ name: "mergePullRequest", args: ["o/r", 7, { squash: true }] }]);
    expect(h.writebacks).toEqual([]);
    expect(h.debugs.length).toBe(1);
  });

  test("a merge whose read-back failed after the write landed still returns ok", async () => {
    const h = harness({
      mergePullRequest: async () => { throw new ReadBackFailedError("Merged PR #7 but could not verify it afterward", { operation: "mergePullRequest", projectPath: "o/r", iid: 7, writeApplied: true }); },
    });
    const res = await h.handlers["mr:action"]({ repoName: REPO, iid: 7, action: "merge" });
    expect(res).toEqual({ ok: true });
    expect(h.writebacks).toEqual([]);
  });

  test("a merge whose source branch was not deleted returns ok and passes that sentence on", async () => {
    const note = 'The source branch "b7" was not deleted: it is protected';
    const h = harness({ mergePullRequest: async () => prOf(7, { state: "merged", sourceBranchNotDeleted: note }) });
    const res = await h.handlers["mr:action"]({ repoName: REPO, iid: 7, action: "merge", args: [{ shouldRemoveSourceBranch: true }] });
    expect(res).toEqual({ ok: true, data: { sourceBranchNotDeleted: note } });
    expect(h.writebacks).toEqual([]);
  });

  test("approve runs as today and skips the write-back follow-up", async () => {
    const h = harness();
    const res = await h.handlers["mr:action"]({ repoName: REPO, iid: 7, action: "approve" });
    expect(res).toEqual({ ok: true });
    expect(h.names()).toEqual(["approvePullRequest"]);
    expect(h.writebacks).toEqual([]);
  });
});

describe("mr:update on GitHub", () => {
  test("addLabels and removeLabels call the two label methods and return the PR's webUrl", async () => {
    const h = harness({ fetchSingleMR: async (_pp: string, iid: number) => prOf(iid) });
    const res = await h.handlers["mr:update"]({ repoName: REPO, iid: 7, addLabels: [" a "], removeLabels: ["b"] });
    expect(res).toEqual({ ok: true, data: { iid: 7, url: PR_URL, applied: ["addLabels", "removeLabels"] } });
    expect(h.calls).toEqual([
      { name: "addPullRequestLabels", args: ["o/r", 7, ["a"]] },
      { name: "removePullRequestLabels", args: ["o/r", 7, ["b"]] },
      { name: "fetchSingleMR", args: ["o/r", 7, null] },
    ]);
    expect(h.writebacks).toEqual([]);
  });

  test("a title edit returns the updated PR's webUrl without a second read", async () => {
    const h = harness({ updatePullRequest: async (_pp: string, iid: number) => prOf(iid, { webUrl: "https://github.com/o/r/pull/7#edited" }) });
    const res = await h.handlers["mr:update"]({ repoName: REPO, iid: 7, title: "New" });
    expect(res).toEqual({ ok: true, data: { iid: 7, url: "https://github.com/o/r/pull/7#edited", applied: ["title"] } });
    expect(h.names()).toEqual(["updatePullRequest"]);
    expect(h.writebacks).toEqual([]);
  });

  test("a failed label write names what landed and what did not", async () => {
    const h = harness({ removePullRequestLabels: async () => { throw new Error("GitHub said no"); } });
    const res = await h.handlers["mr:update"]({ repoName: REPO, iid: 7, addLabels: ["a"], removeLabels: ["b"] });
    expect(res).toEqual({ ok: false, error: "addLabels landed; removeLabels did not: Error: GitHub said no; retrying with only the failed fields is safe" });
  });

  test("squash returns an error and makes zero provider calls", async () => {
    const h = harness();
    const res = await h.handlers["mr:update"]({ repoName: REPO, iid: 7, title: "T", squash: true });
    expect(res).toEqual({ ok: false, error: "GitHub picks squash at merge time; leave out squash" });
    expect(h.calls).toEqual([]);
    expect(h.writebacks).toEqual([]);
  });
});

describe("mr:create on GitHub", () => {
  test("labels ride createPullRequest with no second write, and nothing is written back", async () => {
    const h = harness({ createPullRequest: async () => prOf(9) });
    const res = await h.handlers["mr:create"]({ repoName: REPO, sourceBranch: "feat", targetBranch: "main", title: "T", labels: ["a"] });
    expect(res).toEqual({ ok: true, data: { iid: 9, url: "https://github.com/o/r/pull/9" } });
    expect(h.names()).toEqual(["createPullRequest"]);
    expect((h.calls[0]!.args[0] as any).labels).toEqual(["a"]);
    expect(h.writebacks).toEqual([]);
  });

  test("squash returns an error and makes zero provider calls", async () => {
    const h = harness();
    const res = await h.handlers["mr:create"]({ repoName: REPO, sourceBranch: "feat", targetBranch: "main", title: "T", squash: true });
    expect(res).toEqual({ ok: false, error: "GitHub picks squash at merge time; leave out squash" });
    expect(h.calls).toEqual([]);
  });
});

describe("mr:get on GitHub", () => {
  test("a miss says GitHub has no such pull request, with no REST follow-up", async () => {
    const h = harness({ fetchSingleMR: async () => null });
    const res = await h.handlers["mr:get"]({ repoName: REPO, iid: 7 });
    expect(res).toEqual({ ok: false, error: "GitHub has no pull request #7 in o/r, or the token cannot read it" });
    expect(h.calls).toEqual([{ name: "fetchSingleMR", args: ["o/r", 7, null, expect.any(Function)] }]);
  });

  test("a miss whose read failed carries GitHub's reason", async () => {
    const h = harness({
      fetchSingleMR: async (_pp: string, _iid: number, _user: unknown, onWarning: (w: unknown) => void) => {
        onWarning({ kind: "request-failed", source: "fill", status: 502, target: "o/r#7", message: "GitHub could not read o/r#7 (Bad Gateway); it is missing from this result." });
        return null;
      },
    });
    expect(await h.handlers["mr:get"]({ repoName: REPO, iid: 7 })).toEqual({
      ok: false,
      error: "GitHub has no pull request #7 in o/r, or the token cannot read it (GitHub said: 502 GitHub could not read o/r#7 (Bad Gateway); it is missing from this result.)",
    });
  });

  test("a long reason is cut to 200 characters", async () => {
    const h = harness({
      fetchSingleMR: async (_pp: string, _iid: number, _user: unknown, onWarning: (w: unknown) => void) => {
        onWarning({ kind: "request-failed", source: "fill", target: "o/r#7", message: "x".repeat(500) });
        return null;
      },
    });
    const res = await h.handlers["mr:get"]({ repoName: REPO, iid: 7 }) as any;
    expect(res.error).toBe(`GitHub has no pull request #7 in o/r, or the token cannot read it (GitHub said: ${"x".repeat(200)})`);
  });

  test("a refresh read returns the PR and writes nothing back", async () => {
    const h = harness({ fetchSingleMR: async (_pp: string, iid: number) => prOf(iid) });
    const res = await h.handlers["mr:get"]({ repoName: REPO, iid: 7, refresh: true }) as any;
    expect(res.ok).toBe(true);
    expect(res.data.mr.iid).toBe(7);
    expect(h.writebacks).toEqual([]);
  });
});

describe("job detail and trace on GitHub", () => {
  test("mr:fetch-job-detail calls the interface", async () => {
    const h = harness({ fetchJobDetail: async () => ({ kind: "trace", trace: "log" }) });
    const res = await h.handlers["mr:fetch-job-detail"]({ repoName: REPO, iid: 7, jobId: 42, pipelineId: 5 });
    expect(res).toEqual({ ok: true, data: { kind: "trace", trace: "log" } as any });
    expect(h.calls).toEqual([{ name: "fetchJobDetail", args: ["o/r", 42, 5] }]);
  });

  test("mr:fetch-job-trace calls the interface", async () => {
    const h = harness({ fetchJobTrace: async () => "trace text" });
    const res = await h.handlers["mr:fetch-job-trace"]({ repoName: REPO, iid: 7, jobId: 42 });
    expect(res).toEqual({ ok: true, data: "trace text" as any });
    expect(h.calls).toEqual([{ name: "fetchJobTrace", args: ["o/r", 42] }]);
  });
});

describe("a GitHub rate limit in an MR verb", () => {
  const throwLimited = async () => {
    throw new RateLimitedError("GitHub secondary rate limit hit on POST /graphql", { kind: "secondary", resetAt: null, retryAfterMs: 60000, operation: "POST /graphql" });
  };
  const cases: Array<[string, string, Record<string, unknown>]> = [
    ["mr:action", "approvePullRequest", { iid: 7, action: "approve" }],
    ["mr:create", "createPullRequest", { sourceBranch: "feat", targetBranch: "main", title: "T" }],
    ["mr:update", "updatePullRequest", { iid: 7, title: "T" }],
    ["mr:update", "addPullRequestLabels", { iid: 7, addLabels: ["a"] }],
    ["mr:fetch-job-detail", "fetchJobDetail", { iid: 7, jobId: 42 }],
    ["mr:fetch-job-trace", "fetchJobTrace", { iid: 7, jobId: 42 }],
    ["mr:get", "fetchSingleMR", { iid: 7 }],
  ];
  for (const [verb, method, payload] of cases) {
    test(`${verb} (${method}) answers with an error naming the limit and the wait`, async () => {
      const h = harness({ [method]: throwLimited });
      const res = await (h.handlers as any)[verb]({ repoName: REPO, ...payload });
      expect(res.ok).toBe(false);
      expect(res.error).toContain("rate limit");
      expect(res.error).toContain("retry in 60s");
    });
  }
});

describe("project-mrs on GitHub", () => {
  const tmpStore = () => createProjectMRs(openStateDb(join(mkdtempSync(join(tmpdir(), "rt-mrgh-")), "state.db"), "cli"));
  const tracking = () => ({ [REPO]: { mode: "live" as const, caches: ["branches", "project-mrs"] as any } });
  const log = { warn() {}, info() {}, error() {}, debug() {} } as any;

  test("mr:by-branch asks fetchPullRequestByBranch and returns the PR without storing it", async () => {
    const store = tmpStore();
    const asked: unknown[] = [];
    const provider = { fetchPullRequestByBranch: async (...args: unknown[]) => { asked.push(args); return prOf(7, { sourceBranch: "feat" }); } };
    const h = createProjectMRsHandlers({ repoIndex: () => ({ [REPO]: "/tmp/repo" }), log }, () => {}, {
      store, tracking, getContext: async () => ({ forge: "github", provider, projectPath: "o/r", projectId: null }),
    });
    const res = await h["mr:by-branch"]({ repoName: REPO, branches: ["feat", "gone"] }) as any;
    expect(res.ok).toBe(true);
    expect(res.data.byBranch.feat).toEqual({ pr: prOf(7, { sourceBranch: "feat" }), source: "forge" });
    expect(asked).toEqual([["o/r", "feat", "all"], ["o/r", "gone", "all"]]);
    expect(store.read(REPO)).toBeUndefined();
  });

  test("mr:by-branch reports a branch with no PR as absent", async () => {
    const provider = { fetchPullRequestByBranch: async () => null };
    const h = createProjectMRsHandlers({ repoIndex: () => ({ [REPO]: "/tmp/repo" }), log }, () => {}, {
      store: tmpStore(), tracking, getContext: async () => ({ forge: "github", provider, projectPath: "o/r", projectId: null }),
    });
    const res = await h["mr:by-branch"]({ repoName: REPO, branches: ["gone"] }) as any;
    expect(res).toEqual({ ok: true, data: { byBranch: { gone: null }, syncedAt: 0 } });
  });

  const byBranchWith = (over: Record<string, unknown>) =>
    createProjectMRsHandlers({ repoIndex: () => ({ [REPO]: "/tmp/repo" }), log }, () => {}, { store: tmpStore(), tracking, ...over });

  test("mr:by-branch fails the call on a GitHub rate limit, naming the retry time", async () => {
    const limited = new RateLimitedError("GitHub secondary rate limit hit on GET /repos/o/r/pulls", { kind: "secondary", resetAt: null, retryAfterMs: 60000, operation: "GET /repos/o/r/pulls" });
    const provider = { fetchPullRequestByBranch: async () => { throw limited; } };
    const h = byBranchWith({ getContext: async () => ({ forge: "github", provider, projectPath: "o/r", projectId: null }) });
    const res = await h["mr:by-branch"]({ repoName: REPO, branches: ["feat", "other"] }) as any;
    expect(res.ok).toBe(false);
    expect(res.error).toContain("rate limit");
    expect(res.error).toContain("retry in 60s");
  });

  test("mr:by-branch fails the call when a GitHub read throws", async () => {
    const provider = { fetchPullRequestByBranch: async () => { throw new Error("socket hang up"); } };
    const h = byBranchWith({ getContext: async () => ({ forge: "github", provider, projectPath: "o/r", projectId: null }) });
    expect(await h["mr:by-branch"]({ repoName: REPO, branches: ["feat"] })).toEqual({ ok: false, error: "Error: socket hang up" });
  });

  test("mr:by-branch fails the call when a GitHub repo has no context", async () => {
    const h = byBranchWith({
      getContext: async () => { throw new Error("missing GitHub token (run: rt setup github connect)"); },
      isGitHub: async () => true,
    });
    expect(await h["mr:by-branch"]({ repoName: REPO, branches: ["feat"] }))
      .toEqual({ ok: false, error: "Error: missing GitHub token (run: rt setup github connect)" });
  });

  test("mr:by-branch keeps a branch null when a repo off GitHub has no context", async () => {
    const h = byBranchWith({ getContext: async () => { throw new Error("missing gitlabToken"); }, isGitHub: async () => false });
    expect(await h["mr:by-branch"]({ repoName: REPO, branches: ["feat"] })).toEqual({ ok: true, data: { byBranch: { feat: null }, syncedAt: 0 } });
  });

  test("project-mrs:read returns the empty store read for a repo with no synced rows", async () => {
    const h = createProjectMRsHandlers({ repoIndex: () => ({ [REPO]: "/tmp/repo" }), log }, () => {}, {
      store: tmpStore(), tracking, sync: async () => {},
    });
    const res = await h["project-mrs:read"]({ repoName: REPO, maxAgeMs: 0 });
    expect(res).toEqual({ ok: true, data: { mrs: {}, listSyncedAt: 0, source: "poll", syncedAt: 0 } });
  });
});
