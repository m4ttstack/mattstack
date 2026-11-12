import { describe, expect, test } from "bun:test";
import { ForgeHttpError } from "@mattstack/glance";
import { createMRHandlers } from "../handlers/mr.ts";
import { fakeStore } from "./fake-cache-store.ts";

const REPO = "remote:gitlab.com%2Fgrp%2Fproj";
const fakeCtx = () => ({ cache: fakeStore({}), repoIndex: () => ({ [REPO]: "/tmp/repo" }), log: { warn() {}, info() {}, debug() {}, error() {} } as any });

function handlers(provider: Record<string, unknown>) {
  return createMRHandlers(fakeCtx(), () => {}, {
    getContext: async () => ({ provider, projectPath: "grp/proj" }),
    writeback: () => { throw new Error("a live read must not write the project-MRs store"); },
  });
}

describe("mr:commit-parents", () => {
  test("returns the provider's parents", async () => {
    const provider = { fetchCommitParents: async (_p: string, sha: string) => (sha === "abc1234" ? ["t", "h"] : []) };
    const h = handlers(provider);
    expect(await h["mr:commit-parents"]!({ repoName: REPO, iid: 4, sha: "abc1234" })).toEqual({ ok: true, data: ["t", "h"] });
  });

  test("validates sha", async () => {
    const empty = await handlers({})["mr:commit-parents"]!({ repoName: REPO, iid: 4, sha: "" });
    expect(empty).toMatchObject({ ok: false });
    for (const sha of ["m1", "abc; rm"]) {
      const r = await handlers({ fetchCommitParents: async () => ["t"] })["mr:commit-parents"]!({ repoName: REPO, iid: 4, sha });
      expect(r).toMatchObject({ ok: false });
    }
  });

  test("a malformed sha names the rule; a missing one reads as missing", async () => {
    const h = handlers({ fetchCommitParents: async () => ["t"] });
    for (const sha of ["m1", "abc; rm", ""]) {
      expect(await h["mr:commit-parents"]!({ repoName: REPO, iid: 4, sha })).toEqual({ ok: false, error: '"sha" must be 7 to 40 hex characters' });
    }
    expect(await h["mr:commit-parents"]!({ repoName: REPO, iid: 4 })).toEqual({ ok: false, error: "missing repoName/iid/sha" });
  });

  test("refuses a display name instead of failing open", async () => {
    const h = handlers({ fetchCommitParents: async () => ["t"] });
    const r = await h["mr:commit-parents"]!({ repoName: "proj", iid: 4, sha: "abc1234" });
    expect(r).toEqual({ ok: false, error: "repo-unknown" });
  });
});

describe("mr:pipeline-failed-jobs", () => {
  test("returns jobs", async () => {
    const job = { id: "gitlab:job:5", name: "unit", stage: "test", status: "failed", allowFailure: false, duration: 1, webUrl: null };
    const h = handlers({ fetchPipelineFailedJobs: async () => [job] });
    expect(await h["mr:pipeline-failed-jobs"]!({ repoName: REPO, iid: 4, pipelineId: 9 })).toEqual({ ok: true, data: [job] });
  });

  test("validates pipelineId", async () => {
    const r = await handlers({})["mr:pipeline-failed-jobs"]!({ repoName: REPO, iid: 4 });
    expect(r).toMatchObject({ ok: false });
  });

  test("pipelineId must be a positive integer", async () => {
    let called = 0;
    const h = handlers({ fetchPipelineFailedJobs: async () => { called++; return []; } });
    for (const pipelineId of [0, -3, 1.5, Number.NaN]) {
      expect(await h["mr:pipeline-failed-jobs"]!({ repoName: REPO, iid: 4, pipelineId })).toMatchObject({ ok: false });
    }
    expect(called).toBe(0);
  });

  test("refuses a display name instead of failing open", async () => {
    const h = handlers({ fetchPipelineFailedJobs: async () => [] });
    const r = await h["mr:pipeline-failed-jobs"]!({ repoName: "proj", iid: 4, pipelineId: 9 });
    expect(r).toEqual({ ok: false, error: "repo-unknown" });
  });
});

describe("mr:by-target", () => {
  const row = (iid: number, author: string, extra: Record<string, unknown> = {}) => ({
    iid, title: `t${iid}`, state: "opened", draft: false, sourceBranch: `child-${iid}`, targetBranch: "feat",
    author, webUrl: `https://gitlab.com/grp/proj/-/merge_requests/${iid}`, detailedMergeStatus: "mergeable", mergedAt: null, ...extra,
  });

  function summariesProvider(answer: (options: Record<string, unknown>) => unknown) {
    const calls: Array<Record<string, unknown>> = [];
    const provider = {
      fetchPullRequestSummaries: async (_p: string, options: Record<string, unknown>) => {
        calls.push(options);
        const next = answer(options);
        if (next instanceof Error) throw next;
        return next;
      },
    };
    return { provider, calls };
  }

  test("an empty forge answer is an empty list", async () => {
    const { provider, calls } = summariesProvider(() => ({ rows: [], truncated: false }));
    expect(await handlers(provider)["mr:by-target"]!({ repoName: REPO, targetBranch: "feat" })).toEqual({ ok: true, data: { mrs: [] } });
    expect(calls).toEqual([{ state: "opened", targetBranch: "feat", limit: 2000 }]);
  });

  test("returns every author's MR targeting the branch, summarized", async () => {
    const { provider } = summariesProvider(() => ({ rows: [row(7, "bob", { draft: true })], truncated: false }));
    const r = await handlers(provider)["mr:by-target"]!({ repoName: REPO, targetBranch: "feat" });
    expect(r).toEqual({ ok: true, data: { mrs: [{
      iid: 7, title: "t7", state: "opened", draft: true, sourceBranch: "child-7", targetBranch: "feat",
      author: "bob", webUrl: "https://gitlab.com/grp/proj/-/merge_requests/7", detailedMergeStatus: "mergeable", mergedAt: null,
    }] } });
  });

  test("returns every row glance read across pages, in one call", async () => {
    const { provider, calls } = summariesProvider(() => ({ rows: [row(1, "a"), row(2, "b")], truncated: false }));
    const r = await handlers(provider)["mr:by-target"]!({ repoName: REPO, targetBranch: "feat" });
    expect((r as any).data.mrs.map((m: any) => m.iid)).toEqual([1, 2]);
    expect(calls).toHaveLength(1);
  });

  test("a listing past one full page comes back whole", async () => {
    const rows = Array.from({ length: 101 }, (_, i) => row(i + 1, "a"));
    const { provider, calls } = summariesProvider(() => ({ rows, truncated: false }));
    const r = await handlers(provider)["mr:by-target"]!({ repoName: REPO, targetBranch: "feat" });
    expect((r as any).data.mrs).toHaveLength(101);
    expect(calls).toHaveLength(1);
  });

  test("a short listing is the whole answer", async () => {
    const { provider, calls } = summariesProvider(() => ({ rows: [row(1, "a")], truncated: false }));
    const r = await handlers(provider)["mr:by-target"]!({ repoName: REPO, targetBranch: "feat" });
    expect((r as any).data.mrs).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  test("passes a state through and refuses an unknown one", async () => {
    const { provider, calls } = summariesProvider(() => ({ rows: [], truncated: false }));
    const h = handlers(provider);
    await h["mr:by-target"]!({ repoName: REPO, targetBranch: "feat", state: "all" });
    expect(calls[0]!.state).toBe("all");
    expect(await h["mr:by-target"]!({ repoName: REPO, targetBranch: "feat", state: "draft" })).toEqual({ ok: false, error: '"state" must be one of opened, merged, closed, all' });
  });

  test("a forge error is an error, never an empty list", async () => {
    const { provider } = summariesProvider(() => new ForgeHttpError("GitLab returned 502 Bad Gateway: boom", 502, "Bad Gateway", "boom"));
    const r = await handlers(provider)["mr:by-target"]!({ repoName: REPO, targetBranch: "feat" });
    expect(r).toEqual({ ok: false, error: "GitLab returned 502 Bad Gateway: boom" });
  });

  test("a thrown request is an error", async () => {
    const { provider } = summariesProvider(() => new Error("ECONNRESET"));
    const r = await handlers(provider)["mr:by-target"]!({ repoName: REPO, targetBranch: "feat" });
    expect(r).toMatchObject({ ok: false });
    expect(String((r as { ok: false; error: string }).error)).toContain("ECONNRESET");
  });

  test("a body that is not an array is an error", async () => {
    const { provider } = summariesProvider(() => new Error("GitLab's merge request listing was not a JSON array"));
    const r = await handlers(provider)["mr:by-target"]!({ repoName: REPO, targetBranch: "feat" });
    expect(r).toEqual({ ok: false, error: "GitLab's merge request listing was not a JSON array" });
  });

  test("refuses to call a listing complete past the cap", async () => {
    const { provider, calls } = summariesProvider(() => ({ rows: [row(1, "a")], truncated: true }));
    const r = await handlers(provider)["mr:by-target"]!({ repoName: REPO, targetBranch: "feat" });
    expect(r).toEqual({ ok: false, error: "more than 2000 MRs target feat; the listing stopped before the end" });
    expect(calls[0]!.limit).toBe(2000);
  });

  test("validates targetBranch and the repo before any request", async () => {
    const { provider, calls } = summariesProvider(() => ({ rows: [], truncated: false }));
    const h = handlers(provider);
    for (const targetBranch of [undefined, "", "  ", 3]) {
      expect(await h["mr:by-target"]!({ repoName: REPO, targetBranch })).toEqual({ ok: false, error: "missing repoName/targetBranch" });
    }
    expect(await h["mr:by-target"]!({ repoName: "proj", targetBranch: "feat" })).toEqual({ ok: false, error: "repo-unknown" });
    expect(calls).toEqual([]);
  });
});

describe("mr:get", () => {
  const mr = { iid: 7, state: "merged", author: { username: "someone-else" } };

  test("returns the provider's MR for any author and state, with no cache grant", async () => {
    const h = handlers({ fetchSingleMR: async (_p: string, iid: number) => (iid === 7 ? mr : null) });
    const r = await h["mr:get"]!({ repoName: REPO, iid: 7 });
    expect(r).toMatchObject({ ok: true, data: { mr } });
    expect(typeof (r as { data: { fetchedAt: number } }).data.fetchedAt).toBe("number");
    const closed = { ...mr, iid: 8, state: "closed" };
    expect(await handlers({ fetchSingleMR: async () => closed })["mr:get"]!({ repoName: REPO, iid: 8 })).toMatchObject({ ok: true, data: { mr: closed } });
  });

  test("a null fetch asks GitLab why and returns its text", async () => {
    const h = handlers({
      fetchSingleMR: async () => null,
      restRequest: async () => new Response("no access", { status: 403, statusText: "Forbidden" }),
    });
    expect(await h["mr:get"]!({ repoName: REPO, iid: 7 })).toEqual({ ok: false, error: "GitLab returned 403 Forbidden: no access" });
  });

  test("validates iid and the repo identity", async () => {
    const h = handlers({ fetchSingleMR: async () => mr });
    expect(await h["mr:get"]!({ repoName: REPO })).toEqual({ ok: false, error: "missing repoName/iid" });
    expect(await h["mr:get"]!({ repoName: REPO, iid: 0 })).toEqual({ ok: false, error: '"iid" must be a positive integer' });
    expect(await h["mr:get"]!({ repoName: "proj", iid: 7 })).toEqual({ ok: false, error: "repo-unknown" });
  });

  test("refresh: true writes the fresh MR into the stores", async () => {
    const written: Array<[string, string, unknown]> = [];
    const h = createMRHandlers(fakeCtx(), () => {}, {
      getContext: async () => ({ provider: { fetchSingleMR: async () => mr }, projectPath: "grp/proj" }),
      writeback: (repo: string, projectPath: string, pr: unknown) => { written.push([repo, projectPath, pr]); },
    });
    expect(await h["mr:get"]!({ repoName: REPO, iid: 7, refresh: true })).toMatchObject({ ok: true, data: { mr } });
    expect(written).toEqual([[REPO, "grp/proj", mr]]);
  });
});

describe("mr:list-live", () => {
  test("passes filters through and validates them", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const provider = { fetchPullRequestSummaries: async (_p: string, options: Record<string, unknown>) => { seen.push(options); return { rows: [], truncated: false }; } };
    const h = handlers(provider);
    expect(await h["mr:list-live"]!({ repoName: REPO, search: "refund" })).toEqual({ ok: true, data: { mrs: [], truncated: false } });
    expect(seen[0]!.search).toBe("refund");
    expect(await h["mr:list-live"]!({ repoName: REPO, state: "weird" })).toMatchObject({ ok: false });
    expect(await h["mr:list-live"]!({ repoName: REPO, limit: 201 })).toEqual({ ok: false, error: '"limit" must be an integer from 1 to 200' });
    expect(await h["mr:list-live"]!({ repoName: REPO, author: 5 })).toEqual({ ok: false, error: '"author" must be a string' });
  });
  test("on GitHub, targetBranch reaches the provider and a refusal names GitHub", async () => {
    const GH = "remote:github.com%2Facme%2Fapp";
    const seen: Array<Record<string, unknown>> = [];
    let answer: () => unknown = () => ({ rows: [{ iid: 4 }], truncated: true });
    const provider = {
      fetchPullRequestSummaries: async (_p: string, options: Record<string, unknown>) => {
        seen.push(options);
        const a = answer();
        if (a instanceof Error) throw a;
        return a;
      },
    };
    const h = createMRHandlers({ ...fakeCtx(), repoIndex: () => ({ [GH]: "/tmp/ghapp" }) }, () => {}, {
      getContext: async () => ({ forge: "github", provider, projectPath: "acme/app" }),
      writeback: () => { throw new Error("a live read must not write the project-MRs store"); },
    } as any);
    expect(await h["mr:list-live"]!({ repoName: GH, targetBranch: "feat" })).toEqual({ ok: true, data: { mrs: [{ iid: 4 }], truncated: true } });
    expect(seen[0]).toMatchObject({ targetBranch: "feat", state: "opened", limit: 50 });
    answer = () => new ForgeHttpError("x", 502, "Bad Gateway", "boom");
    expect(await h["mr:list-live"]!({ repoName: GH, targetBranch: "feat" })).toEqual({ ok: false, error: "GitHub returned 502 Bad Gateway: boom" });
  });
});

describe("mr:live-by-branch", () => {
  const none = { rows: [], truncated: false };

  test("finds the open MR for a branch by any author and fetches it in full", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const provider = {
      fetchPullRequestSummaries: async (_p: string, options: Record<string, unknown>) => {
        seen.push(options);
        return options.sourceBranch === "feat"
          ? { rows: [{ iid: 9, title: "t", state: "opened", draft: false, sourceBranch: "feat", targetBranch: "main", author: null, webUrl: null, detailedMergeStatus: null, mergedAt: null }], truncated: false }
          : none;
      },
      fetchSingleMR: async (_p: string, iid: number) => ({ iid, sourceBranch: "feat" }),
    };
    const r = await handlers(provider)["mr:live-by-branch"]!({ repoName: REPO, branches: ["feat", "none"] });
    expect(r).toMatchObject({ ok: true, data: { byBranch: { feat: { iid: 9, sourceBranch: "feat" } } } });
    expect((r as { data: { byBranch: Record<string, unknown> } }).data.byBranch.none).toBeNull();
    expect(seen[0]).toMatchObject({ state: "opened", sourceBranch: "feat" });
  });

  test("a GitLab refusal fails the whole call, never a null", async () => {
    const provider = {
      fetchPullRequestSummaries: async () => { throw new ForgeHttpError("GitLab returned 403 Forbidden: no", 403, "Forbidden", "no"); },
      fetchSingleMR: async () => null,
    };
    expect(await handlers(provider)["mr:live-by-branch"]!({ repoName: REPO, branches: ["feat"] })).toEqual({ ok: false, error: "GitLab returned 403 Forbidden: no" });
  });

  test("validates branches", async () => {
    const h = handlers({ fetchPullRequestSummaries: async () => none, fetchSingleMR: async () => null });
    expect(await h["mr:live-by-branch"]!({ repoName: REPO, branches: [] })).toEqual({ ok: false, error: '"branches" must name at least one branch' });
    expect(await h["mr:live-by-branch"]!({ repoName: REPO, branches: ["a", 3] })).toEqual({ ok: false, error: '"branches" must name at least one branch' });
  });
});

describe("project:labels and pipeline:list", () => {
  test("project:labels returns the listing and validates search", async () => {
    const h = handlers({ fetchProjectLabels: async () => ({ labels: [], truncated: false }) });
    expect(await h["project:labels"]!({ repoName: REPO, search: "preview" })).toEqual({ ok: true, data: { labels: [] } });
    expect(await h["project:labels"]!({ repoName: REPO, search: 3 })).toEqual({ ok: false, error: '"search" must be a string' });
    expect(await h["project:labels"]!({ repoName: "proj" })).toEqual({ ok: false, error: "repo-unknown" });
  });
  test("pipeline:list returns the listing and validates iid and limit", async () => {
    const h = handlers({ fetchPipelineList: async () => [] });
    expect(await h["pipeline:list"]!({ repoName: REPO, ref: "feat" })).toEqual({ ok: true, data: { pipelines: [] } });
    expect(await h["pipeline:list"]!({ repoName: REPO, iid: 0 })).toEqual({ ok: false, error: '"iid" must be a positive integer' });
    expect(await h["pipeline:list"]!({ repoName: REPO, limit: 101 })).toEqual({ ok: false, error: '"limit" must be an integer from 1 to 100' });
  });
});

describe("forge:get", () => {
  test("returns the read and validates query, page and perPage", async () => {
    const h = handlers({ restRequest: async () => new Response("[]", { status: 200 }) });
    expect(await h["forge:get"]!({ repoName: REPO, path: "projects/:id/issues" })).toEqual({ ok: true, data: { status: 200, body: [], truncated: false, nextPage: null, totalPages: null } });
    expect(await h["forge:get"]!({ repoName: REPO, path: "projects/:id/variables" })).toMatchObject({ ok: false });
    expect(await h["forge:get"]!({ repoName: REPO, path: "x", query: [] })).toEqual({ ok: false, error: '"query" must be an object' });
    expect(await h["forge:get"]!({ repoName: REPO, path: "x", query: { a: {} } })).toEqual({ ok: false, error: '"query.a" must be a string, number or boolean' });
    expect(await h["forge:get"]!({ repoName: REPO, path: "x", perPage: 101 })).toEqual({ ok: false, error: '"perPage" must be an integer from 1 to 100' });
  });
});
