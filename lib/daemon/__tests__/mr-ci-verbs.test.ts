import { describe, expect, test } from "bun:test";
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

  test("refuses a provider without the method", async () => {
    const h = handlers({});
    const r = await h["mr:commit-parents"]!({ repoName: REPO, iid: 4, sha: "abc1234" });
    expect(r).toMatchObject({ ok: false });
    expect(String((r as { ok: false; error: string }).error)).toContain("unsupported");
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

  test("refuses a provider without the method", async () => {
    const h = handlers({});
    const r = await h["mr:pipeline-failed-jobs"]!({ repoName: REPO, iid: 4, pipelineId: 9 });
    expect(r).toMatchObject({ ok: false });
    expect(String((r as { ok: false; error: string }).error)).toContain("unsupported");
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
    iid, title: `t${iid}`, state: "opened", draft: false, source_branch: `child-${iid}`, target_branch: "feat",
    author: { username: author }, web_url: `https://gitlab.com/grp/proj/-/merge_requests/${iid}`, detailed_merge_status: "mergeable", ...extra,
  });
  const page = (rows: unknown[], nextPage = "") => new Response(JSON.stringify(rows), { status: 200, headers: { "x-next-page": nextPage } });

  function restProvider(respond: (path: string) => Response | Promise<Response>) {
    const paths: string[] = [];
    const provider = { restRequest: async (_method: string, path: string) => { paths.push(path); return respond(path); } };
    return { provider, paths };
  }

  test("an empty forge answer is an empty list", async () => {
    const { provider, paths } = restProvider(() => page([]));
    expect(await handlers(provider)["mr:by-target"]!({ repoName: REPO, targetBranch: "feat" })).toEqual({ ok: true, data: { mrs: [] } });
    expect(paths).toHaveLength(1);
    expect(paths[0]).toStartWith("/projects/grp%2Fproj/merge_requests?");
    const query = new URLSearchParams(paths[0]!.split("?")[1]);
    expect(query.get("target_branch")).toBe("feat");
    expect(query.get("state")).toBe("opened");
    expect(query.has("author_username")).toBe(false);
    expect(query.has("scope")).toBe(false);
  });

  test("returns every author's MR targeting the branch, summarized", async () => {
    const { provider } = restProvider(() => page([row(7, "bob", { draft: true })]));
    const r = await handlers(provider)["mr:by-target"]!({ repoName: REPO, targetBranch: "feat" });
    expect(r).toEqual({ ok: true, data: { mrs: [{
      iid: 7, title: "t7", state: "opened", draft: true, sourceBranch: "child-7", targetBranch: "feat",
      author: "bob", webUrl: "https://gitlab.com/grp/proj/-/merge_requests/7", detailedMergeStatus: "mergeable",
    }] } });
  });

  test("follows x-next-page until the last page", async () => {
    const { provider, paths } = restProvider((path) => {
      const n = new URLSearchParams(path.split("?")[1]).get("page");
      return n === "1" ? page([row(1, "a")], "2") : page([row(2, "b")]);
    });
    const r = await handlers(provider)["mr:by-target"]!({ repoName: REPO, targetBranch: "feat" });
    expect((r as any).data.mrs.map((m: any) => m.iid)).toEqual([1, 2]);
    expect(paths).toHaveLength(2);
  });

  test("keeps walking past a full page that carries no x-next-page header", async () => {
    const full = Array.from({ length: 100 }, (_, i) => row(i + 1, "a"));
    const { provider, paths } = restProvider((path) => {
      const n = new URLSearchParams(path.split("?")[1]).get("page");
      return n === "1" ? new Response(JSON.stringify(full), { status: 200 }) : new Response(JSON.stringify([row(101, "b")]), { status: 200 });
    });
    const r = await handlers(provider)["mr:by-target"]!({ repoName: REPO, targetBranch: "feat" });
    expect((r as any).data.mrs).toHaveLength(101);
    expect(paths).toHaveLength(2);
  });

  test("stops at a short page even with no x-next-page header", async () => {
    const { provider, paths } = restProvider(() => new Response(JSON.stringify([row(1, "a")]), { status: 200 }));
    const r = await handlers(provider)["mr:by-target"]!({ repoName: REPO, targetBranch: "feat" });
    expect((r as any).data.mrs).toHaveLength(1);
    expect(paths).toHaveLength(1);
  });

  test("passes a state through and refuses an unknown one", async () => {
    const { provider, paths } = restProvider(() => page([]));
    const h = handlers(provider);
    await h["mr:by-target"]!({ repoName: REPO, targetBranch: "feat", state: "all" });
    expect(new URLSearchParams(paths[0]!.split("?")[1]).get("state")).toBe("all");
    expect(await h["mr:by-target"]!({ repoName: REPO, targetBranch: "feat", state: "draft" })).toEqual({ ok: false, error: '"state" must be one of opened, merged, closed, all' });
  });

  test("a forge error is an error, never an empty list", async () => {
    const { provider } = restProvider(() => new Response("boom", { status: 502, statusText: "Bad Gateway" }));
    const r = await handlers(provider)["mr:by-target"]!({ repoName: REPO, targetBranch: "feat" });
    expect(r).toEqual({ ok: false, error: "GitLab returned 502 Bad Gateway: boom" });
  });

  test("a thrown request is an error", async () => {
    const { provider } = restProvider(() => { throw new Error("ECONNRESET"); });
    const r = await handlers(provider)["mr:by-target"]!({ repoName: REPO, targetBranch: "feat" });
    expect(r).toMatchObject({ ok: false });
    expect(String((r as { ok: false; error: string }).error)).toContain("ECONNRESET");
  });

  test("a body that is not an array is an error", async () => {
    const { provider } = restProvider(() => new Response(JSON.stringify({ message: "x" }), { status: 200 }));
    const r = await handlers(provider)["mr:by-target"]!({ repoName: REPO, targetBranch: "feat" });
    expect(r).toEqual({ ok: false, error: "GitLab's merge request listing was not a JSON array" });
  });

  test("refuses to call a listing complete past the page cap", async () => {
    const { provider, paths } = restProvider((path) => {
      const n = Number(new URLSearchParams(path.split("?")[1]).get("page"));
      return page([row(n, "a")], String(n + 1));
    });
    const r = await handlers(provider)["mr:by-target"]!({ repoName: REPO, targetBranch: "feat" });
    expect(r).toMatchObject({ ok: false });
    expect(String((r as { ok: false; error: string }).error)).toContain("more than");
    expect(paths.length).toBeGreaterThan(1);
  });

  test("validates targetBranch and the repo before any request", async () => {
    const { provider, paths } = restProvider(() => page([]));
    const h = handlers(provider);
    for (const targetBranch of [undefined, "", "  ", 3]) {
      expect(await h["mr:by-target"]!({ repoName: REPO, targetBranch })).toEqual({ ok: false, error: "missing repoName/targetBranch" });
    }
    expect(await h["mr:by-target"]!({ repoName: "proj", targetBranch: "feat" })).toEqual({ ok: false, error: "repo-unknown" });
    expect(paths).toEqual([]);
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

  test("refuses a provider without fetchSingleMR", async () => {
    const r = await handlers({})["mr:get"]!({ repoName: REPO, iid: 7 });
    expect(String((r as { error: string }).error)).toContain("unsupported");
  });
});

describe("mr:list-live", () => {
  test("passes filters through and validates them", async () => {
    const seen: string[] = [];
    const provider = { restRequest: async (_m: string, path: string) => { seen.push(path); return new Response("[]", { status: 200, headers: { "x-next-page": "" } }); } };
    const h = handlers(provider);
    expect(await h["mr:list-live"]!({ repoName: REPO, search: "refund" })).toEqual({ ok: true, data: { mrs: [], truncated: false } });
    expect(seen[0]).toContain("search=refund");
    expect(await h["mr:list-live"]!({ repoName: REPO, state: "weird" })).toMatchObject({ ok: false });
    expect(await h["mr:list-live"]!({ repoName: REPO, limit: 201 })).toEqual({ ok: false, error: '"limit" must be an integer from 1 to 200' });
    expect(await h["mr:list-live"]!({ repoName: REPO, author: 5 })).toEqual({ ok: false, error: '"author" must be a string' });
  });
});

describe("mr:live-by-branch", () => {
  const listing = (rows: unknown[]) => new Response(JSON.stringify(rows), { status: 200, headers: { "x-next-page": "" } });

  test("finds the open MR for a branch by any author and fetches it in full", async () => {
    const paths: string[] = [];
    const provider = {
      restRequest: async (_m: string, path: string) => {
        paths.push(path);
        return listing(path.includes("source_branch=feat") ? [{ iid: 9, title: "t", state: "opened", source_branch: "feat", target_branch: "main" }] : []);
      },
      fetchSingleMR: async (_p: string, iid: number) => ({ iid, sourceBranch: "feat" }),
    };
    const r = await handlers(provider)["mr:live-by-branch"]!({ repoName: REPO, branches: ["feat", "none"] });
    expect(r).toMatchObject({ ok: true, data: { byBranch: { feat: { iid: 9, sourceBranch: "feat" } } } });
    expect((r as { data: { byBranch: Record<string, unknown> } }).data.byBranch.none).toBeNull();
    expect(paths[0]).toContain("state=opened");
    expect(paths[0]).toContain("source_branch=feat");
  });

  test("a GitLab refusal fails the whole call, never a null", async () => {
    const provider = { restRequest: async () => new Response("no", { status: 403, statusText: "Forbidden" }), fetchSingleMR: async () => null };
    expect(await handlers(provider)["mr:live-by-branch"]!({ repoName: REPO, branches: ["feat"] })).toEqual({ ok: false, error: "GitLab returned 403 Forbidden: no" });
  });

  test("validates branches", async () => {
    const h = handlers({ restRequest: async () => listing([]), fetchSingleMR: async () => null });
    expect(await h["mr:live-by-branch"]!({ repoName: REPO, branches: [] })).toEqual({ ok: false, error: '"branches" must name at least one branch' });
    expect(await h["mr:live-by-branch"]!({ repoName: REPO, branches: ["a", 3] })).toEqual({ ok: false, error: '"branches" must name at least one branch' });
  });
});

describe("project:labels and pipeline:list", () => {
  const empty = () => new Response("[]", { status: 200, headers: { "x-next-page": "" } });
  test("project:labels returns the listing and validates search", async () => {
    const h = handlers({ restRequest: async () => empty() });
    expect(await h["project:labels"]!({ repoName: REPO, search: "preview" })).toEqual({ ok: true, data: { labels: [] } });
    expect(await h["project:labels"]!({ repoName: REPO, search: 3 })).toEqual({ ok: false, error: '"search" must be a string' });
    expect(await h["project:labels"]!({ repoName: "proj" })).toEqual({ ok: false, error: "repo-unknown" });
  });
  test("pipeline:list returns the listing and validates iid and limit", async () => {
    const h = handlers({ restRequest: async () => empty() });
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
