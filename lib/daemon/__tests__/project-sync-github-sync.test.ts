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

const owner = (section: string) => ({ type: "CODE_OWNER" as const, approved: false, section });

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

  test("a scoped GitHub deep lists once, adds your login and sweeps sections", async () => {
    const repo = "github.com/acme/scoped";
    const store = tmpStore();
    store.registerDemand(repo, "board", ["Dev"], Date.now(), ["@org/backend"]);
    const gh = fakeGitHub(
      () => ({ prs: [pr(1, { author: { username: "dev" } }), pr(2, { author: { username: "x" } })] }),
      (iid) => ({ pr: pr(iid, { author: { username: "x" } }) }),
    );
    const overrides: ProjectSyncOverrides = {
      store, forge: "github", githubContext: gh.githubContext, selfUsername: "octo",
      fetchRules: async () => ({ projectPath: "o/r", rules: [{ iid: 2, rules: [owner("@org/backend")] }] }),
      fetchKnownSections: async () => ["@org/backend"],
    };
    await syncProjectMRs(deps(repo), repo, overrides);
    expect(gh.listCalls).toHaveLength(1);
    expect(gh.listCalls[0]!.authorUsernames).toBeUndefined();
    const scope = store.read(repo)!.scope!;
    expect(scope.authors).toEqual(["Dev", "octo"]);
    expect(scope.sections).toEqual(["@org/backend"]);
    expect(Object.keys(store.read(repo)!.mrs).map(Number).sort()).toEqual([1, 2]);
    expect(store.read(repo)!.mrs[2]!.codeownerSections).toEqual(["@org/backend"]);
    expect(gh.singleCalls).toEqual([2]);
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

describe("codeowner sections on GitHub", () => {
  const A = "@org/a";
  const stranger = (iid: number) => pr(iid, { author: { username: "stranger" } });

  /** One deep that tags strangers 1, 2 and 3 with A, so later runs have stored tags to keep or drop. */
  async function seeded(repo: string, forge: "github" | "gitlab") {
    const store = tmpStore();
    store.registerDemand(repo, "board", ["dev"], Date.now(), [A]);
    await syncProjectMRs(deps(repo), repo, {
      store, forge, selfUsername: "octo", windowDays: 30, mode: "deep",
      fetchAuthors: async () => ({ projectPath: "o/r", prs: [] }),
      fetchRules: async () => ({ projectPath: "o/r", rules: [1, 2, 3].map((iid) => ({ iid, rules: [owner(A)] })) }),
      fetchKnownSections: async () => [A],
      fetchSingle: async (_r, _p, iid) => stranger(iid),
    });
    expect([1, 2, 3].map((iid) => store.read(repo)!.mrs[iid]?.codeownerSections)).toEqual([[A], [A], [A]]);
    return store;
  }

  const secondDeep = (store: ReturnType<typeof tmpStore>, forge: "github" | "gitlab", warn: ProjectSyncOverrides["warn"]): ProjectSyncOverrides => ({
    store, forge, selfUsername: "octo", windowDays: 30, mode: "deep", warn,
    fetchAuthors: async () => ({ projectPath: "o/r", prs: [] }),
    fetchRules: async () => ({ projectPath: "o/r", rules: [
      { iid: 1, rules: [] },
      { iid: 2, rules: [], unknownReason: "team unreadable" },
    ] }),
    fetchKnownSections: async () => [A, "@org/b"],
    fetchSingle: async () => { throw new Error("stored rows need no fetch"); },
  });

  test("a GitHub deep keeps a stored tag through approval and an unknown read, and drops one outside the window", async () => {
    const repo = "github.com/acme/sticky";
    const store = await seeded(repo, "github");
    const warned: Array<{ obj: object; msg: string }> = [];
    await syncProjectMRs(deps(repo), repo, secondDeep(store, "github", (obj, msg) => warned.push({ obj, msg })));
    const rec = store.read(repo)!;
    expect(rec.mrs[1]!.codeownerSections).toEqual([A]);
    expect(rec.mrs[2]!.codeownerSections).toEqual([A]);
    expect(rec.mrs[3]).toBeUndefined();
    expect(rec.scope!.knownSections).toEqual([A, "@org/b"]);
    expect(warned).toHaveLength(1);
    expect(warned[0]!.obj).toMatchObject({ unknown: 1, reason: "team unreadable" });
  });

  test("a GitLab deep with the same inputs is not sticky", async () => {
    const repo = "gitlab.com/acme/plain";
    const store = await seeded(repo, "gitlab");
    await syncProjectMRs(deps(repo), repo, secondDeep(store, "gitlab", () => {}));
    const rec = store.read(repo)!;
    expect(rec.mrs[1]).toBeUndefined();
  });

  test("a GitHub sections delta keeps an approved PR's tag and hydrates a newly tagged stranger", async () => {
    const repo = "github.com/acme/delta";
    const store = await seeded(repo, "github");
    const broadcasts: Array<{ iids: number[] }> = [];
    const hydrated: number[] = [];
    const warned: object[] = [];
    await syncProjectMRs(deps(repo, broadcasts), repo, {
      store, forge: "github", selfUsername: "octo", windowDays: 30, warn: (obj) => warned.push(obj),
      fetchDelta: async () => ({ projectPath: "o/r", prs: [] }),
      fetchRules: async () => ({ projectPath: "o/r", rules: [
        { iid: 1, rules: [] },
        { iid: 2, rules: [], unknownReason: "reviewer hidden" },
        { iid: 7, rules: [owner(A)] },
      ] }),
      fetchSingle: async (_r, _p, iid) => { hydrated.push(iid); return stranger(iid); },
    });
    const rec = store.read(repo)!;
    expect(hydrated).toEqual([7]);
    expect(rec.mrs[1]!.codeownerSections).toEqual([A]);
    expect(rec.mrs[2]!.codeownerSections).toEqual([A]);
    expect(rec.mrs[7]!.codeownerSections).toEqual([A]);
    const iids = broadcasts.flatMap((b) => b.iids);
    expect(iids).toContain(7);
    expect(iids).not.toContain(1);
    expect(iids).not.toContain(2);
    expect(warned).toEqual([expect.objectContaining({ unknown: 1, reason: "reviewer hidden" })]);
  });

  test("backfillSections on GitHub tags matches and records knownSections", async () => {
    const repo = "github.com/acme/backfill-sections";
    const store = tmpStore();
    store.fullSync(repo, "o/r", [stranger(1)], Date.now());
    store.setScope(repo, { authors: ["dev"], windowDays: 30 });
    const hydrated: number[] = [];
    await backfillSections(deps(repo), repo, [A], {
      store, forge: "github", windowDays: 30,
      fetchRules: async () => ({ projectPath: "o/r", rules: [{ iid: 1, rules: [owner(A)] }, { iid: 5, rules: [owner(A)] }] }),
      fetchKnownSections: async () => [A],
      fetchSingle: async (_r, _p, iid) => { hydrated.push(iid); return stranger(iid); },
    });
    const rec = store.read(repo)!;
    expect(hydrated).toEqual([5]);
    expect(rec.mrs[1]!.codeownerSections).toEqual([A]);
    expect(rec.mrs[5]!.codeownerSections).toEqual([A]);
    expect(rec.scope).toMatchObject({ sections: [A], knownSections: [A] });
  });

  test("backfillSections on GitHub keeps a sticky tag in a section the scope already covers", async () => {
    const repo = "github.com/acme/backfill-covered";
    const B = "@org/b";
    const store = tmpStore();
    store.fullSync(repo, "o/r", [stranger(1)], Date.now());
    store.setScope(repo, { authors: ["dev"], sections: [A], windowDays: 30 });
    store.setSectionTags(repo, { 1: [A] });
    await backfillSections(deps(repo), repo, [B], {
      store, forge: "github", windowDays: 30,
      fetchRules: async () => ({ projectPath: "o/r", rules: [{ iid: 1, rules: [owner(B)] }] }),
      fetchKnownSections: async () => [A, B],
      fetchSingle: async () => { throw new Error("stored row needs no fetch"); },
    });
    expect(store.read(repo)!.mrs[1]!.codeownerSections).toEqual([A, B]);
  });
});
