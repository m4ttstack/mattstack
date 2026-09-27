import { describe, expect, test } from "bun:test";
import { createMRHandlers } from "../handlers/mr.ts";
import { fakeStore } from "./fake-cache-store.ts";

const REPO = "remote:gitlab.com%2Fgrp%2Fproj";
const fakeCtx = () => ({ cache: fakeStore({}), repoIndex: () => ({ [REPO]: "/tmp/repo" }), log: { warn() {}, info() {}, debug() {}, error() {} } as any });

function handlers(provider: Record<string, unknown>) {
  return createMRHandlers(fakeCtx(), () => {}, {
    getContext: async () => ({ provider, projectPath: "grp/proj" }),
  });
}

describe("mr:commit-parents", () => {
  test("returns the provider's parents", async () => {
    const provider = { fetchCommitParents: async (_p: string, sha: string) => (sha === "m1" ? ["t", "h"] : []) };
    const h = handlers(provider);
    expect(await h["mr:commit-parents"]!({ repoName: REPO, iid: 4, sha: "m1" })).toEqual({ ok: true, data: ["t", "h"] });
  });

  test("refuses a provider without the method", async () => {
    const h = handlers({});
    const r = await h["mr:commit-parents"]!({ repoName: REPO, iid: 4, sha: "m1" });
    expect(r).toMatchObject({ ok: false });
    expect(String((r as { ok: false; error: string }).error)).toContain("unsupported");
  });

  test("validates sha", async () => {
    const r = await handlers({})["mr:commit-parents"]!({ repoName: REPO, iid: 4, sha: "" });
    expect(r).toMatchObject({ ok: false });
  });

  test("refuses a display name instead of failing open", async () => {
    const h = handlers({ fetchCommitParents: async () => ["t"] });
    const r = await h["mr:commit-parents"]!({ repoName: "proj", iid: 4, sha: "m1" });
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

  test("refuses a display name instead of failing open", async () => {
    const h = handlers({ fetchPipelineFailedJobs: async () => [] });
    const r = await h["mr:pipeline-failed-jobs"]!({ repoName: "proj", iid: 4, pipelineId: 9 });
    expect(r).toEqual({ ok: false, error: "repo-unknown" });
  });
});
