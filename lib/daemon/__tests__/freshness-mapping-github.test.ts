import { describe, test, expect } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  applyInvalidationBatch,
  type FreshnessEnv,
  type RepoTarget,
  type BatchRunner,
} from "../freshness.ts";
import { createProjectMRs } from "../project-mrs-store.ts";
import type { FetchPullRequestsWarning, InvalidationKey } from "@mattstack/glance";
import { fakeStore } from "./fake-cache-store.ts";
import { openStateDb } from "../../state/index.ts";
import { composeKey } from "../../state/branch-cache.ts";

const K = (branch: string) => composeKey("repo-x", branch);

function pmrsStore() {
  const path = join(mkdtempSync(join(tmpdir(), "rt-freshness-mapping-github-")), "state.db");
  return createProjectMRs(openStateDb(path, "cli"));
}

function fakePR(iid: number, overrides: Record<string, any> = {}): any {
  return {
    id: `github:pr:${iid}`,
    iid,
    repositoryId: "github:repo:1",
    title: `PR ${iid}`,
    description: "",
    state: "opened",
    draft: false,
    conflicts: false,
    webUrl: `https://github.com/o/r/pull/${iid}`,
    sourceBranch: `branch-${iid}`,
    targetBranch: "main",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sha: "abc123def456",
    author: { id: "github:user:1", username: "someone", name: "Someone", avatarUrl: null },
    assignees: [],
    reviewers: [],
    roles: [],
    pipeline: null,
    unresolvedThreadCount: 0,
    approvalsLeft: 0,
    approved: false,
    approvedBy: [],
    diffStats: null,
    detailedMergeStatus: "mergeable",
    autoMergeEnabled: false,
    autoMergeStrategy: null,
    mergeUser: null,
    mergeAfter: null,
    divergedCommitsCount: 0,
    rebaseInProgress: false,
    mergeOngoing: false,
    inProgressMergeCommitSha: null,
    mergeError: null,
    shouldBeRebased: false,
    mergeabilityChecks: [],
    blockingMergeRequestsCount: 0,
    approvalsRequired: 0,
    squash: false,
    squashOnMerge: false,
    mergeTrainIndex: null,
    ...overrides,
  };
}

function makeEnv(entries: Record<string, any>) {
  const broadcasts: Array<{ type: string; data: any }> = [];
  const puts: string[] = [];
  const store = fakeStore(entries);
  const env: FreshnessEnv = {
    ctx: {
      cache: {
        ...store,
        put: (branch: string, entry: any) => { puts.push(branch); store.put(branch, entry); },
      },
    } as any,
    broadcast: (type, data) => broadcasts.push({ type, data }),
  };
  return { env, broadcasts, puts };
}

function makeRunner(): BatchRunner {
  return { processing: false, pending: [], gapFillTimer: null };
}

const branchesOnlyGrants = () => ({ mode: "live" as const, caches: new Set(["branches"] as const), projectMrsWindowDays: 30 });
const projectGrants = () => ({ mode: "live" as const, caches: new Set(["branches", "project-mrs", "discussions"] as const), projectMrsWindowDays: 30 });

function key(kind: InvalidationKey["kind"], ref: string, cause = "test"): InvalidationKey {
  return { kind, ref, cause };
}

const fillFailure: FetchPullRequestsWarning = { kind: "request-failed", source: "fill", message: "fill failed" } as FetchPullRequestsWarning;

type Single = (pp: string, iid: number, uid: number | null, onWarning?: (w: FetchPullRequestsWarning) => void) => Promise<any>;

function githubTarget(fetchSingleMR: Single, byBranches: (pp: string, branches: string[], state?: string) => Promise<Map<string, any>> = async () => { throw new Error("unexpected"); }): RepoTarget {
  return {
    repoName: "repo-x",
    projectPath: "o/r",
    forge: "github",
    provider: { fetchSingleMR, fetchPullRequestsByBranches: byBranches } as any,
  };
}

const failingFill: Single = async (_pp, _iid, _uid, onWarning) => { onWarning?.(fillFailure); return null; };

describe("applyInvalidationBatch on GitHub", () => {
  test("an mr event whose fill fails writes nothing", async () => {
    const cached = fakePR(3, { sourceBranch: "feat-a" });
    const entries: Record<string, any> = { [K("feat-a")]: { mr: cached, fetchedAt: 1, repoName: "repo-x" } };
    const { env, puts } = makeEnv(entries);
    let notified = 0;
    await applyInvalidationBatch(env, githubTarget(failingFill), makeRunner(), [key("mr", "3")], {
      notify: () => { notified++; }, gapFillDebounceMs: 10, grantsFor: branchesOnlyGrants,
    });
    expect(entries[K("feat-a")].mr).toBe(cached);
    expect(entries[K("feat-a")].fetchedAt).toBe(1);
    expect(puts).toEqual([]);
    expect(notified).toBe(0);
  });

  test("a branch event null re-reads the cached PR", async () => {
    const entries: Record<string, any> = { [K("feat-a")]: { mr: fakePR(3, { sourceBranch: "feat-a" }), fetchedAt: 1, repoName: "repo-x" } };
    const { env } = makeEnv(entries);
    const singleCalls: number[] = [];
    const batchCalls: Array<[string[], string | undefined]> = [];
    const target = githubTarget(
      async (_pp, iid) => { singleCalls.push(iid); return fakePR(3, { sourceBranch: "feat-a", state: "merged" }); },
      async (_pp, branches, state) => { batchCalls.push([branches, state]); return new Map([["feat-a", null]]); },
    );
    await applyInvalidationBatch(env, target, makeRunner(), [key("branch", "feat-a")], {
      notify: () => {}, gapFillDebounceMs: 10, grantsFor: branchesOnlyGrants,
    });
    expect(batchCalls).toEqual([[["feat-a"], "all"]]);
    expect(singleCalls).toEqual([3]);
    expect(entries[K("feat-a")].mr.state).toBe("merged");
  });

  test("a branch event null whose re-read fails writes nothing", async () => {
    const cached = fakePR(3, { sourceBranch: "feat-a" });
    const entries: Record<string, any> = { [K("feat-a")]: { mr: cached, fetchedAt: 1, repoName: "repo-x" } };
    const { env, puts } = makeEnv(entries);
    const target = githubTarget(failingFill, async () => new Map([["feat-a", null]]));
    await applyInvalidationBatch(env, target, makeRunner(), [key("branch", "feat-a")], {
      notify: () => {}, gapFillDebounceMs: 10, grantsFor: branchesOnlyGrants,
    });
    expect(entries[K("feat-a")].mr).toBe(cached);
    expect(entries[K("feat-a")].fetchedAt).toBe(1);
    expect(puts).toEqual([]);
  });

  test("a branch event null re-read returning null writes nothing", async () => {
    const cached = fakePR(3, { sourceBranch: "feat-a" });
    const entries: Record<string, any> = { [K("feat-a")]: { mr: cached, fetchedAt: 1, repoName: "repo-x" } };
    const { env, puts } = makeEnv(entries);
    const target = githubTarget(async () => null, async () => new Map([["feat-a", null]]));
    await applyInvalidationBatch(env, target, makeRunner(), [key("branch", "feat-a")], {
      notify: () => {}, gapFillDebounceMs: 10, grantsFor: branchesOnlyGrants,
    });
    expect(entries[K("feat-a")].mr).toBe(cached);
    expect(entries[K("feat-a")].fetchedAt).toBe(1);
    expect(puts).toEqual([]);
  });

  test("a branch event on a branch with no cached PR writes null as today", async () => {
    const entries: Record<string, any> = { [K("feat-a")]: { mr: null, fetchedAt: 1, repoName: "repo-x" } };
    const { env, puts } = makeEnv(entries);
    let singleCalled = false;
    const target = githubTarget(async () => { singleCalled = true; return null; }, async () => new Map([["feat-a", null]]));
    await applyInvalidationBatch(env, target, makeRunner(), [key("branch", "feat-a")], {
      notify: () => {}, gapFillDebounceMs: 10, grantsFor: branchesOnlyGrants,
    });
    expect(singleCalled).toBe(false);
    expect(entries[K("feat-a")].mr).toBeNull();
    expect(entries[K("feat-a")].fetchedAt).toBeGreaterThan(1);
    expect(puts).toEqual(["feat-a"]);
  });

  test("the approval heal never runs on GitHub", async () => {
    const store = pmrsStore();
    store.fullSync("repo-x", "o/r", [fakePR(9, { sourceBranch: "branch-9" })], Date.now() - 1000);
    store.setSectionTags("repo-x", { 9: ["Acme"] });
    store.setScope("repo-x", { authors: ["someone"], sections: ["Acme"], windowDays: 30 });
    const { env } = makeEnv({});
    let rulesCalled = false;
    const target = githubTarget(async (_pp, iid) => fakePR(iid, { sourceBranch: "branch-9" }));
    await applyInvalidationBatch(env, target, makeRunner(), [key("mr", "9", "approved")], {
      notify: () => {}, gapFillDebounceMs: 10, grantsFor: projectGrants, projectStore: store,
      fetchRulesByIid: async () => { rulesCalled = true; throw new Error("rules read on GitHub"); },
    });
    expect(rulesCalled).toBe(false);
    expect(store.read("repo-x")!.mrs[9]!.codeownerSections).toEqual(["Acme"]);
  });

  test("fetchSingleMR gets null as its user id on GitHub", async () => {
    const entries: Record<string, any> = { [K("feat-a")]: { mr: fakePR(3, { sourceBranch: "feat-a" }), fetchedAt: 1, repoName: "repo-x" } };
    const { env } = makeEnv(entries);
    const userIds: Array<number | null> = [];
    const target = githubTarget(async (_pp, iid, uid) => { userIds.push(uid); return fakePR(iid, { sourceBranch: "feat-a" }); });
    await applyInvalidationBatch(env, target, makeRunner(), [key("mr", "3")], {
      notify: () => {}, gapFillDebounceMs: 10, grantsFor: branchesOnlyGrants,
    });
    expect(userIds).toEqual([null]);
  });

  test("a teammate push whose fill fails writes nothing to the project store", async () => {
    const store = pmrsStore();
    const stored = fakePR(6, { sourceBranch: "feat-6", title: "stored" });
    store.fullSync("repo-x", "o/r", [stored], Date.now() - 1000);
    const { env, broadcasts } = makeEnv({});
    const singleCalls: number[] = [];
    const target = githubTarget(async (pp, iid, uid, onWarning) => { singleCalls.push(iid); return failingFill(pp, iid, uid, onWarning); });
    await applyInvalidationBatch(env, target, makeRunner(), [key("branch", "feat-6")], {
      notify: () => {}, gapFillDebounceMs: 10, grantsFor: projectGrants, projectStore: store,
    });
    expect(singleCalls).toEqual([6]);
    expect(store.read("repo-x")!.mrs[6]!.pr.title).toBe("stored");
    expect(broadcasts.filter((b) => b.type === "project-mrs")).toEqual([]);
  });
});
