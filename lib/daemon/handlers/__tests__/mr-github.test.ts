/**
 * MR verbs on a GitHub repo context: the provider interface carries every
 * write, squash is refused, rebase is refused when the provider cannot, and
 * a successful mutation or refresh writes the PR back into the stores.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MergeReadBackFailedError, PartialCreateError, RateLimitedError, ReadBackFailedError } from "@mattstack/glance";
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

  test("merge writes the returned PR back", async () => {
    const h = harness({ mergePullRequest: async () => prOf(7, { state: "merged" }) });
    const res = await h.handlers["mr:action"]({ repoName: REPO, iid: 7, action: "merge", args: [{ squash: true }] });
    expect(res).toEqual({ ok: true });
    expect(h.calls).toEqual([{ name: "mergePullRequest", args: ["o/r", 7, { squash: true }] }]);
    expect(h.writebacks).toEqual([[REPO, "o/r", prOf(7, { state: "merged" })]]);
    expect(h.debugs.length).toBe(0);
  });

  test("a merge whose read-back failed after the write landed still returns ok", async () => {
    const h = harness({
      mergePullRequest: async () => { throw new ReadBackFailedError("Merged PR #7 but could not verify it afterward", { operation: "mergePullRequest", projectPath: "o/r", iid: 7, writeApplied: true }); },
    });
    const res = await h.handlers["mr:action"]({ repoName: REPO, iid: 7, action: "merge" });
    expect(res).toEqual({ ok: true });
    expect(h.names()).toEqual(["mergePullRequest", "fetchSingleMR"]);
    expect(h.writebacks).toEqual([]);
  });

  test("a merge whose source branch was not deleted returns ok, passes that sentence on and writes the PR back", async () => {
    const note = 'The source branch "b7" was not deleted: it is protected';
    const h = harness({ mergePullRequest: async () => prOf(7, { state: "merged", sourceBranchNotDeleted: note }) });
    const res = await h.handlers["mr:action"]({ repoName: REPO, iid: 7, action: "merge", args: [{ shouldRemoveSourceBranch: true }] });
    expect(res).toEqual({ ok: true, data: { sourceBranchNotDeleted: note } });
    expect(h.writebacks.length).toBe(1);
  });

  test("a merge that entered the merge queue replies with its queue entry and writes the still-open PR back", async () => {
    const queued = { position: 2, state: "QUEUED" };
    const h = harness({ mergePullRequest: async () => prOf(7, { state: "opened", queued }) });
    const res = await h.handlers["mr:action"]({ repoName: REPO, iid: 7, action: "merge" });
    expect(res).toEqual({ ok: true, data: { queued } });
    expect(h.writebacks).toEqual([[REPO, "o/r", prOf(7, { state: "opened", queued })]]);
  });

  test("a landed merge whose read-back failed still passes on why its source branch is left", async () => {
    const note = "The source branch was not deleted: GitHub refused the delete with 422.";
    const h = harness({
      mergePullRequest: async () => {
        throw new MergeReadBackFailedError("Merged PR #7 but could not read it back", { operation: "mergePullRequest", projectPath: "o/r", iid: 7, writeApplied: true, sourceBranchNotDeleted: note });
      },
    });
    const res = await h.handlers["mr:action"]({ repoName: REPO, iid: 7, action: "merge" });
    expect(res).toEqual({ ok: true, data: { sourceBranchNotDeleted: note } });
  });

  test("a PR already queued whose read-back failed replies queued, not failed", async () => {
    const queued = { position: 1, state: "AWAITING_CHECKS" };
    const h = harness({
      mergePullRequest: async () => {
        throw new MergeReadBackFailedError("PR #7 is queued but could not be read back", { operation: "mergePullRequest", projectPath: "o/r", iid: 7, writeApplied: false, queued });
      },
    });
    const res = await h.handlers["mr:action"]({ repoName: REPO, iid: 7, action: "merge" });
    expect(res).toEqual({ ok: true, data: { queued } });
  });

  test("approve schedules the follow-up write-back", async () => {
    const h = harness({ fetchSingleMR: async (_pp: string, iid: number) => prOf(iid) });
    const res = await h.handlers["mr:action"]({ repoName: REPO, iid: 7, action: "approve" });
    expect(res).toEqual({ ok: true });
    expect(h.calls).toEqual([
      { name: "approvePullRequest", args: ["o/r", 7] },
      { name: "fetchSingleMR", args: ["o/r", 7, null] },
    ]);
    expect(h.writebacks).toEqual([[REPO, "o/r", prOf(7)]]);
  });
});

describe("mr:update on GitHub", () => {
  test("addLabels and removeLabels call the two label methods, return the PR's webUrl and write the read PR back", async () => {
    const h = harness({ fetchSingleMR: async (_pp: string, iid: number) => prOf(iid) });
    const res = await h.handlers["mr:update"]({ repoName: REPO, iid: 7, addLabels: [" a "], removeLabels: ["b"] });
    expect(res).toEqual({ ok: true, data: { iid: 7, url: PR_URL, applied: ["addLabels", "removeLabels"] } });
    expect(h.calls).toEqual([
      { name: "addPullRequestLabels", args: ["o/r", 7, ["a"]] },
      { name: "removePullRequestLabels", args: ["o/r", 7, ["b"]] },
      { name: "fetchSingleMR", args: ["o/r", 7, null] },
    ]);
    expect(h.writebacks).toEqual([[REPO, "o/r", prOf(7)]]);
  });

  test("update on GitHub keeps its /pull URL reply and writes the PR back", async () => {
    const h = harness({ fetchSingleMR: async (_pp: string, iid: number) => prOf(iid) });
    const res = await h.handlers["mr:update"]({ repoName: REPO, iid: 7, addLabels: ["a"] }) as any;
    expect(res.data.url).toBe(PR_URL);
    expect(res.data.url).toContain("/pull/");
    expect(h.names()).not.toContain("restRequest");
    expect(h.writebacks.length).toBe(1);
  });

  test("a title edit writes the updated PR back without a second read", async () => {
    const h = harness({ updatePullRequest: async (_pp: string, iid: number) => prOf(iid, { webUrl: "https://github.com/o/r/pull/7#edited" }) });
    const res = await h.handlers["mr:update"]({ repoName: REPO, iid: 7, title: "New" });
    expect(res).toEqual({ ok: true, data: { iid: 7, url: "https://github.com/o/r/pull/7#edited", applied: ["title"] } });
    expect(h.names()).toEqual(["updatePullRequest"]);
    expect(h.writebacks).toEqual([[REPO, "o/r", prOf(7, { webUrl: "https://github.com/o/r/pull/7#edited" })]]);
  });

  test("a failed label write names what landed and what did not", async () => {
    const h = harness({ removePullRequestLabels: async () => { throw new Error("GitHub said no"); } });
    const res = await h.handlers["mr:update"]({ repoName: REPO, iid: 7, addLabels: ["a"], removeLabels: ["b"] });
    expect(res).toEqual({ ok: false, error: "addLabels landed; removeLabels did not: Error: GitHub said no; retrying with only the failed fields is safe" });
    expect(h.writebacks).toEqual([]);
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
  test("labels ride createPullRequest with no second write, and the PR is written back", async () => {
    const h = harness({ createPullRequest: async () => prOf(9) });
    const res = await h.handlers["mr:create"]({ repoName: REPO, sourceBranch: "feat", targetBranch: "main", title: "T", labels: ["a"] });
    expect(res).toEqual({ ok: true, data: { iid: 9, url: "https://github.com/o/r/pull/9" } });
    expect(h.names()).toEqual(["createPullRequest"]);
    expect((h.calls[0]!.args[0] as any).labels).toEqual(["a"]);
    expect(h.writebacks).toEqual([[REPO, "o/r", prOf(9)]]);
  });

  test("a create whose labels step failed replies ok with the PR number, its URL and the failed step, and writes the read-back PR", async () => {
    const h = harness({
      createPullRequest: async () => {
        throw new PartialCreateError("Created PR #9 but its labels step failed", {
          projectPath: "o/r", iid: 9,
          failedSteps: [{ step: "labels", message: "422 label does not exist" }],
          pullRequest: prOf(9),
        });
      },
    });
    const res = await h.handlers["mr:create"]({ repoName: REPO, sourceBranch: "feat", targetBranch: "main", title: "T", labels: ["a"] });
    expect(res).toEqual({
      ok: true,
      data: { iid: 9, url: "https://github.com/o/r/pull/9", failedSteps: [{ step: "labels", message: "422 label does not exist" }] },
    });
    expect(h.names()).toEqual(["createPullRequest"]);
    expect(h.writebacks).toEqual([[REPO, "o/r", prOf(9)]]);
  });

  test("a partial create whose read-back failed too still names the PR's URL", async () => {
    const h = harness({
      createPullRequest: async () => {
        throw new PartialCreateError("Created PR #9 but its labels step failed", {
          projectPath: "o/r", iid: 9,
          failedSteps: [{ step: "labels", message: "boom" }],
          pullRequest: null,
        });
      },
    });
    const res = await h.handlers["mr:create"]({ repoName: REPO, sourceBranch: "feat", targetBranch: "main", title: "T", labels: ["a"] });
    expect(res).toEqual({ ok: true, data: { iid: 9, url: "https://github.com/o/r/pull/9", failedSteps: [{ step: "labels", message: "boom" }] } });
    expect(h.writebacks).toEqual([]);
  });

  test("a plain read-back failure keeps its null URL and names no failed step", async () => {
    const h = harness({
      createPullRequest: async () => {
        throw new ReadBackFailedError("Created PR #9 but could not read it back", { operation: "createPullRequest", projectPath: "o/r", iid: 9, writeApplied: true });
      },
    });
    const res = await h.handlers["mr:create"]({ repoName: REPO, sourceBranch: "feat", targetBranch: "main", title: "T" });
    expect(res).toEqual({ ok: true, data: { iid: 9, url: null } });
  });

  test("squash returns an error and makes zero provider calls", async () => {
    const h = harness();
    const res = await h.handlers["mr:create"]({ repoName: REPO, sourceBranch: "feat", targetBranch: "main", title: "T", squash: true });
    expect(res).toEqual({ ok: false, error: "GitHub picks squash at merge time; leave out squash" });
    expect(h.calls).toEqual([]);
    expect(h.writebacks).toEqual([]);
  });
});

describe("mr:get on GitHub", () => {
  test("a miss says GitHub has no such pull request, with no REST follow-up", async () => {
    const h = harness({ fetchSingleMR: async () => null });
    const res = await h.handlers["mr:get"]({ repoName: REPO, iid: 7 });
    expect(res).toEqual({ ok: false, error: "GitHub has no pull request #7 in o/r, or the token cannot read it" });
    expect(h.calls).toEqual([{ name: "fetchSingleMR", args: ["o/r", 7, null, expect.any(Function)] }]);
    expect(h.writebacks).toEqual([]);
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

  test("a refresh read returns the PR and writes it back", async () => {
    const h = harness({ fetchSingleMR: async (_pp: string, iid: number) => prOf(iid) });
    const res = await h.handlers["mr:get"]({ repoName: REPO, iid: 7, refresh: true }) as any;
    expect(res.ok).toBe(true);
    expect(res.data.mr.iid).toBe(7);
    expect(h.writebacks).toEqual([[REPO, "o/r", prOf(7)]]);
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
      expect(h.writebacks).toEqual([]);
    });
  }
});

describe("project-mrs on GitHub", () => {
  const tmpStore = () => createProjectMRs(openStateDb(join(mkdtempSync(join(tmpdir(), "rt-mrgh-")), "state.db"), "cli"));
  const tracking = () => ({ [REPO]: { mode: "live" as const, caches: ["branches", "project-mrs"] as any } });
  const log = { warn() {}, info() {}, error() {}, debug() {} } as any;

  test("mr:by-branch makes one batched read for every missed branch and stores what it found", async () => {
    const store = tmpStore();
    const asked: unknown[] = [];
    const provider = {
      fetchPullRequestsByBranches: async (...args: unknown[]) => {
        asked.push(args);
        return new Map([["feat", prOf(7, { sourceBranch: "feat" })], ["gone", null], ["other", prOf(8, { sourceBranch: "other" })]]);
      },
      fetchPullRequestByBranch: async () => { throw new Error("per-branch read made"); },
    };
    const h = createProjectMRsHandlers({ repoIndex: () => ({ [REPO]: "/tmp/repo" }), log }, () => {}, {
      store, tracking, getContext: async () => ({ forge: "github", provider, projectPath: "o/r", projectId: null }),
    });
    const res = await h["mr:by-branch"]({ repoName: REPO, branches: ["feat", "gone", "other", "b4", "b5"] }) as any;
    expect(res.ok).toBe(true);
    expect(res.data.byBranch.feat).toEqual({ pr: prOf(7, { sourceBranch: "feat" }), source: "forge" });
    expect(res.data.byBranch.other).toEqual({ pr: prOf(8, { sourceBranch: "other" }), source: "forge" });
    expect(res.data.byBranch.gone).toBeNull();
    expect(res.data.byBranch.b4).toBeNull();
    expect(asked).toEqual([["o/r", ["feat", "gone", "other", "b4", "b5"], "all"]]);
    expect(store.findBySourceBranch(REPO, "feat")?.iid).toBe(7);
    expect(store.findBySourceBranch(REPO, "other")?.iid).toBe(8);
    expect(store.findBySourceBranch(REPO, "gone")).toBeNull();
  });

  test("mr:by-branch reports a branch the batched read maps to null as absent", async () => {
    const provider = { fetchPullRequestsByBranches: async () => new Map([["gone", null]]) };
    const h = createProjectMRsHandlers({ repoIndex: () => ({ [REPO]: "/tmp/repo" }), log }, () => {}, {
      store: tmpStore(), tracking, getContext: async () => ({ forge: "github", provider, projectPath: "o/r", projectId: null }),
    });
    const res = await h["mr:by-branch"]({ repoName: REPO, branches: ["gone"] }) as any;
    expect(res).toEqual({ ok: true, data: { byBranch: { gone: null }, syncedAt: 0 } });
  });

  test("mr:by-branch answers a failed read, not a missing PR, when the batched fill of a branch failed", async () => {
    const store = tmpStore();
    const asked: unknown[] = [];
    const provider = {
      capabilities: { canReportIncompleteBranchReads: true },
      fetchPullRequestsByBranches: async (...args: any[]) => {
        asked.push(args);
        args[3].onWarning({ kind: "request-failed", source: "fill", status: 502, message: "fill failed", target: "o/r#7", branch: "feat" });
        return new Map([["feat", null], ["other", prOf(8, { sourceBranch: "other" })]]);
      },
    };
    const h = createProjectMRsHandlers({ repoIndex: () => ({ [REPO]: "/tmp/repo" }), log }, () => {}, {
      store, tracking, getContext: async () => ({ forge: "github", provider, projectPath: "o/r", projectId: null }),
    });
    const res = await h["mr:by-branch"]({ repoName: REPO, branches: ["feat", "other"] });
    expect(res).toEqual({ ok: false, error: "GitHub could not finish reading the pull request on feat in o/r (502 fill failed); try again" });
    expect(asked.length).toBe(1);
  });

  test("mr:by-branch answers a failed read when a single-branch read hit its scan cap", async () => {
    const provider = {
      capabilities: { canReportIncompleteBranchReads: true },
      fetchPullRequestByBranch: async (_p: string, branch: string, _s: string, options: any) => {
        options.onWarning({ kind: "page-cap", source: "list", message: "GitHub listed 500 PRs without finding it", target: "o/r", branch });
        return null;
      },
    };
    const h = createProjectMRsHandlers({ repoIndex: () => ({ [REPO]: "/tmp/repo" }), log }, () => {}, {
      store: tmpStore(), tracking, getContext: async () => ({ forge: "github", provider, projectPath: "o/r", projectId: null }),
    });
    const res = await h["mr:by-branch"]({ repoName: REPO, branches: ["feat"] });
    expect(res).toEqual({ ok: false, error: "GitHub could not finish reading the pull request on feat in o/r (GitHub listed 500 PRs without finding it); try again" });
  });

  const byBranchWith = (over: Record<string, unknown>) =>
    createProjectMRsHandlers({ repoIndex: () => ({ [REPO]: "/tmp/repo" }), log }, () => {}, { store: tmpStore(), tracking, ...over });

  test("mr:by-branch fails the call on a GitHub rate limit, naming the retry time", async () => {
    const limited = new RateLimitedError("GitHub secondary rate limit hit on GET /repos/o/r/pulls", { kind: "secondary", resetAt: null, retryAfterMs: 60000, operation: "GET /repos/o/r/pulls" });
    const provider = { fetchPullRequestsByBranches: async () => { throw limited; } };
    const h = byBranchWith({ getContext: async () => ({ forge: "github", provider, projectPath: "o/r", projectId: null }) });
    const res = await h["mr:by-branch"]({ repoName: REPO, branches: ["feat", "other"] }) as any;
    expect(res.ok).toBe(false);
    expect(res.error).toContain("rate limit");
    expect(res.error).toContain("retry in 60s");
  });

  test("mr:by-branch fails the call when a GitHub read throws", async () => {
    const provider = { fetchPullRequestsByBranches: async () => { throw new Error("socket hang up"); } };
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
