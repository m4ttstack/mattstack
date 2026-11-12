import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdtempSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { FetchPullRequestsOptions, FetchPullRequestsWarning, PullRequest } from "@mattstack/glance";
import {
  backfillAuthors,
  backfillSections,
  DEEP_RECONCILE_MS,
  remeasureDivergedCounts,
  syncProjectMRs,
  type ProjectSyncOverrides,
} from "../project-sync.ts";
import type { GitHubSyncContext } from "../project-sync-github.ts";
import { createProjectMRs } from "../project-mrs-store.ts";
import { readSyncHealth } from "../project-sync-health.ts";
import { openStateDb } from "../../state/index.ts";
import * as freshnessModule from "../freshness.ts";

function tmpStore() {
  return createProjectMRs(openStateDb(join(mkdtempSync(join(tmpdir(), "rt-psync-gh-")), "state.db"), "cli"));
}

function pr(iid: number, over: Record<string, unknown> = {}): PullRequest {
  return {
    id: `github:pr:${iid}`, iid, title: `PR ${iid}`, state: "opened",
    sourceBranch: `b${iid}`, targetBranch: "main", webUrl: "", divergedCommitsCount: null,
    updatedAt: new Date().toISOString(), mergedAt: null,
    author: { username: "octo" },
    ...over,
  } as unknown as PullRequest;
}

type Reply = { prs: PullRequest[]; warnings?: FetchPullRequestsWarning[] };
type SingleReply = { pr: PullRequest | null; warnings?: FetchPullRequestsWarning[] };

const warn = (kind: FetchPullRequestsWarning["kind"], source: FetchPullRequestsWarning["source"]): FetchPullRequestsWarning =>
  ({ kind, source, message: `${kind} on ${source}` });

function fakeGitHub(list: (opts: FetchPullRequestsOptions) => Reply, single: (iid: number) => SingleReply = () => ({ pr: null })) {
  const listCalls: FetchPullRequestsOptions[] = [];
  const singleCalls: number[] = [];
  const provider = {
    async fetchPullRequests(opts?: FetchPullRequestsOptions) {
      listCalls.push(opts!);
      const reply = list(opts!);
      for (const w of reply.warnings ?? []) opts?.onWarning?.(w);
      return reply.prs;
    },
    async fetchSingleMR(_pp: string, iid: number, _user: number | null, onWarning?: (w: FetchPullRequestsWarning) => void) {
      singleCalls.push(iid);
      const reply = single(iid);
      for (const w of reply.warnings ?? []) onWarning?.(w);
      return reply.pr;
    },
  };
  const githubContext = async () => ({ provider, projectPath: "o/r" }) as unknown as GitHubSyncContext;
  return { githubContext, listCalls, singleCalls };
}

const isDeepList = (opts: FetchPullRequestsOptions) => opts.state === "opened" && opts.updatedAfter === undefined;

function deps(repoName: string, broadcasts: unknown[] = []) {
  return { repoIndex: () => ({ [repoName]: `/repos/${repoName}` }), broadcast: (_t: string, d: unknown) => { broadcasts.push(d); } };
}

function repoWithOrigin(origin: string): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "rt-psync-github-")));
  execFileSync("git", ["init", "-q"], { cwd: path, stdio: "pipe" });
  execFileSync("git", ["remote", "add", "origin", origin], { cwd: path, stdio: "pipe" });
  return path;
}

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });

describe("project sync on GitHub", () => {
  test("a GitHub repo fills the store and reports healthy", async () => {
    const repo = "github.com/acme/fill";
    const store = tmpStore();
    const gh = fakeGitHub(() => ({ prs: [pr(1), pr(2)] }));
    const broadcasts: unknown[] = [];
    await syncProjectMRs(deps(repo, broadcasts), repo, { store, forge: "github", githubContext: gh.githubContext });
    expect(Object.keys(store.read(repo)!.mrs).map(Number).sort()).toEqual([1, 2]);
    expect(broadcasts).toEqual([{ repoName: repo, iids: expect.arrayContaining([1, 2]) }]);
    expect(readSyncHealth(repo)).toBeUndefined();
  });

  test("a repo with a GitHub origin takes the GitHub reads without a forge override", async () => {
    const repo = "github.com/acme/detect";
    const path = repoWithOrigin("git@github.com:acme/detect.git");
    const store = tmpStore();
    const gh = fakeGitHub(() => ({ prs: [pr(1)] }));
    await syncProjectMRs({ repoIndex: () => ({ [repo]: path }), broadcast: () => {} }, repo, { store, githubContext: gh.githubContext });
    expect(gh.listCalls).toHaveLength(1);
    expect(store.read(repo)!.mrs[1]).toBeDefined();
  });

  test("a failed GitHub deep with a record falls back to delta and prunes nothing", async () => {
    const repo = "github.com/acme/fallback";
    const store = tmpStore();
    store.fullSync(repo, "o/r", [pr(1), pr(2)], Date.now() - DEEP_RECONCILE_MS - 60_000);
    const gh = fakeGitHub((opts) => (isDeepList(opts) ? { prs: [pr(1)], warnings: [warn("request-failed", "fill")] } : { prs: [] }));
    await syncProjectMRs(deps(repo), repo, { store, forge: "github", githubContext: gh.githubContext });
    expect(Object.keys(store.read(repo)!.mrs).map(Number).sort()).toEqual([1, 2]);
    expect(gh.listCalls.some((c) => c.updatedAfter !== undefined)).toBe(true);
  });

  test("a cold GitHub deep that fails records a sync error", async () => {
    const repo = "github.com/acme/cold";
    const store = tmpStore();
    const gh = fakeGitHub(() => ({ prs: [pr(1)], warnings: [warn("page-cap", "list")] }));
    await expect(syncProjectMRs(deps(repo), repo, { store, forge: "github", githubContext: gh.githubContext }))
      .rejects.toThrow("GitHub read incomplete");
    expect(readSyncHealth(repo)).toBeDefined();
  });

  test("a scoped GitHub deep lists once, adds your login and skips sections", async () => {
    const repo = "github.com/acme/scoped";
    const store = tmpStore();
    store.registerDemand(repo, "board", ["Dev"], Date.now(), ["Backend"]);
    const gh = fakeGitHub(() => ({ prs: [pr(1, { author: { username: "dev" } }), pr(2, { author: { username: "x" } })] }));
    const overrides: ProjectSyncOverrides = {
      store, forge: "github", githubContext: gh.githubContext, selfUsername: "octo",
      fetchRules: async () => { throw new Error("must not read rules"); },
      fetchKnownSections: async () => { throw new Error("must not read sections"); },
    };
    await syncProjectMRs(deps(repo), repo, overrides);
    expect(gh.listCalls).toHaveLength(1);
    expect(gh.listCalls[0]!.authorUsernames).toBeUndefined();
    const scope = store.read(repo)!.scope!;
    expect(scope.authors).toEqual(["Dev", "octo"]);
    expect(scope.sections).toBeUndefined();
    expect(Object.keys(store.read(repo)!.mrs).map(Number)).toEqual([1]);
  });

  test("a scoped GitHub deep resolves your login per repo", async () => {
    const repo = "github.com/acme/self";
    const store = tmpStore();
    store.registerDemand(repo, "board", ["Dev"], Date.now());
    const spy = spyOn(freshnessModule, "resolveSelfUsername").mockResolvedValue("octo");
    spies.push(spy);
    const gh = fakeGitHub(() => ({ prs: [] }));
    await syncProjectMRs(deps(repo), repo, { store, forge: "github", githubContext: gh.githubContext });
    expect(spy).toHaveBeenCalledWith(repo, `/repos/${repo}`);
    expect(store.read(repo)!.scope!.authors).toContain("octo");
  });

  test("GitHub delta keeps a scope author in another case", async () => {
    const repo = "github.com/acme/case";
    const store = tmpStore();
    store.fullSync(repo, "o/r", [], Date.now() - 1000);
    store.setScope(repo, { authors: ["Octo"], windowDays: 30 });
    const gh = fakeGitHub((opts) => (opts.state === "opened" ? { prs: [pr(3, { author: { username: "octo" } })] } : { prs: [] }));
    await syncProjectMRs(deps(repo), repo, { store, forge: "github", githubContext: gh.githubContext });
    expect(store.read(repo)!.mrs[3]).toBeDefined();
  });

  test("backfillSections on GitHub reads nothing and logs once", async () => {
    const repo = "github.com/acme/sections";
    const store = tmpStore();
    const gh = fakeGitHub(() => ({ prs: [] }));
    const logged: Array<{ obj: object; msg: string }> = [];
    const overrides: ProjectSyncOverrides = {
      store, forge: "github", githubContext: gh.githubContext,
      info: (obj, msg) => logged.push({ obj, msg }),
    };
    await backfillSections(deps(repo), repo, ["Backend"], overrides);
    await backfillSections(deps(repo), repo, ["Backend"], overrides);
    expect(gh.listCalls).toHaveLength(0);
    expect(gh.singleCalls).toHaveLength(0);
    expect(logged).toHaveLength(1);
    expect(logged[0]!.msg).toBe("codeowner sections are not available on GitHub yet");
  });

  test("the GitHub top-up re-reads an in-flight PR and skips a failed one", async () => {
    const repo = "github.com/acme/topup";
    const store = tmpStore();
    const running = { status: "running" };
    store.fullSync(repo, "o/r", [pr(1, { pipeline: running }), pr(2, { pipeline: running })], Date.now() - 1000);
    const before2 = store.read(repo)!.mrs[2]!.pr;
    const gh = fakeGitHub(() => ({ prs: [] }), (iid) => (iid === 1
      ? { pr: pr(1, { pipeline: { status: "success" } }) }
      : { pr: null, warnings: [warn("request-failed", "fill")] }));
    await syncProjectMRs(deps(repo), repo, { store, forge: "github", githubContext: gh.githubContext });
    const after = store.read(repo)!;
    expect((after.mrs[1]!.pr as unknown as { pipeline: { status: string } }).pipeline.status).toBe("success");
    expect(after.mrs[2]!.pr).toEqual(before2);
    expect(gh.singleCalls.sort()).toEqual([1, 2]);
  });

  test("remeasureDivergedCounts makes no read on GitHub", async () => {
    const repo = "github.com/acme/behind";
    const store = tmpStore();
    store.fullSync(repo, "o/r", [pr(1)], Date.now());
    let reads = 0;
    const out = await remeasureDivergedCounts(deps(repo), repo, {
      store, forge: "github",
      fetchDiverged: async () => { reads++; throw new Error("must not read"); },
    });
    expect(out).toEqual([]);
    expect(reads).toBe(0);
  });

  test("backfillAuthors on GitHub adds the GitHub login, not the GitLab username", async () => {
    const repo = "github.com/acme/backfill";
    const store = tmpStore();
    store.fullSync(repo, "o/r", [], Date.now());
    spies.push(spyOn(freshnessModule, "cachedSelfUsername").mockResolvedValue("octo"));
    spies.push(spyOn(freshnessModule, "getSelfUsername").mockReturnValue("gl-me"));
    const gh = fakeGitHub(() => ({ prs: [] }));
    await backfillAuthors(deps(repo), repo, ["Dev"], { store, forge: "github", githubContext: gh.githubContext, windowDays: 30 });
    const authors = store.read(repo)!.scope!.authors;
    expect(authors).toContain("octo");
    expect(authors).not.toContain("gl-me");
  });
});
