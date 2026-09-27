import { describe, expect, test } from "bun:test";
import { isMergeRefPipeline, shaMatches, watchPipeline, type WatchDeps, type WatchMr, type WatchPipeline } from "../watch.ts";

const SHA = "a".repeat(40);
const OLD = "b".repeat(40);
const LEASE = { mr: "u", holder: "watch-ci" as const, owner: "session:a", startedAt: 0, heartbeatAt: 0, ttlSeconds: 600 };

function pipe(over: Partial<WatchPipeline>): WatchPipeline {
  return { id: "gitlab:pipeline:10", status: "running", sha: SHA, ref: "feat", mergeRequestEventType: null, webUrl: null, createdAt: null, jobs: [], ...over };
}
function mr(sha: string | null, pipeline: WatchPipeline | null): WatchMr {
  return { iid: 4, sha, webUrl: "u", pipeline };
}
function fake(seq: WatchMr[], over: Partial<WatchDeps> = {}) {
  let t = 0, i = 0;
  const calls = { heartbeats: 0, parents: 0 };
  const deps: WatchDeps = {
    now: () => t,
    sleep: async (ms) => { t += ms; },
    leaseCheck: () => { calls.heartbeats++; return { ok: true, lease: LEASE }; },
    readMr: async () => ({ ok: true, mr: seq[Math.min(i++, seq.length - 1)]! }),
    commitParents: async () => { calls.parents++; return []; },
    failedJobs: async () => [],
    traceTail: async () => "tail",
    ...over,
  };
  return { deps, calls, clock: () => t };
}
const base = { sha: SHA, maxWaitSeconds: 300, intervalSeconds: 30 };

describe("sha matching", () => {
  test("short uppercase sha matches", () => { expect(shaMatches(SHA, "AAAAAAA")).toBe(true); });
  test("null never matches", () => { expect(shaMatches(null, SHA)).toBe(false); });
  test("merge-ref detection by event type or ref", () => {
    expect(isMergeRefPipeline(pipe({ mergeRequestEventType: "merged_result" }), 4)).toBe(true);
    expect(isMergeRefPipeline(pipe({ ref: "refs/merge-requests/4/train" }), 4)).toBe(true);
    expect(isMergeRefPipeline(pipe({ mergeRequestEventType: "detached" }), 4)).toBe(false);
  });
});

describe("watchPipeline", () => {
  test("the previous push's green pipeline is not reported (false-green fix)", async () => {
    const { deps } = fake([mr(SHA, pipe({ sha: OLD, status: "success", id: "gitlab:pipeline:9" })), mr(SHA, pipe({ status: "success" }))]);
    const r = await watchPipeline(base, deps);
    expect(r).toMatchObject({ state: "success", pipeline: { id: "gitlab:pipeline:10" } });
  });
  test("a stale-sha pipeline alone ends in waiting at maxWait", async () => {
    const { deps } = fake([mr(SHA, pipe({ sha: OLD, status: "success" }))]);
    expect(await watchPipeline({ ...base, maxWaitSeconds: 90 }, deps)).toMatchObject({ state: "waiting" });
  });
  test("running at maxWait returns running", async () => {
    const { deps } = fake([mr(SHA, pipe({ status: "running" }))]);
    expect(await watchPipeline({ ...base, maxWaitSeconds: 60 }, deps)).toMatchObject({ state: "running" });
  });
  for (const s of ["success", "success_with_warnings", "failed", "canceled", "skipped", "manual"]) {
    test(`terminal ${s} returns`, async () => {
      const { deps } = fake([mr(SHA, pipe({ status: s }))]);
      expect(await watchPipeline(base, deps)).toMatchObject({ state: s });
    });
  }
  test("head lag inside the grace window reads waiting, then the new head is watched", async () => {
    const { deps } = fake([mr(OLD, pipe({ sha: OLD, status: "success" })), mr(OLD, null), mr(SHA, pipe({ status: "success" }))]);
    expect(await watchPipeline(base, deps)).toMatchObject({ state: "success" });
  });
  test("a head that stays different past the grace window is superseded", async () => {
    const other = "c".repeat(40);
    const { deps } = fake([mr(other, pipe({ sha: other }))]);
    expect(await watchPipeline(base, deps)).toMatchObject({ state: "superseded", headSha: other });
  });
  test("merged-results pipeline matched through its merge commit's parents", async () => {
    const { deps } = fake([mr(SHA, pipe({ sha: "m".repeat(40), mergeRequestEventType: "merged_result", status: "failed" }))], {
      commitParents: async () => ["t".repeat(40), SHA],
    });
    expect(await watchPipeline(base, deps)).toMatchObject({ state: "failed" });
  });
  test("fast-forward merge train: fallback with priorPipelineId", async () => {
    const { deps } = fake([mr(SHA, pipe({ id: "gitlab:pipeline:12", sha: "m".repeat(40), mergeRequestEventType: "merge_train", status: "success" }))]);
    expect(await watchPipeline({ ...base, priorPipelineId: 11 }, deps)).toMatchObject({ state: "success" });
  });
  test("fast-forward merge train: the prior pipeline itself never matches", async () => {
    const { deps } = fake([mr(SHA, pipe({ id: "gitlab:pipeline:11", sha: "m".repeat(40), mergeRequestEventType: "merge_train", status: "success" }))]);
    expect(await watchPipeline({ ...base, priorPipelineId: 11, maxWaitSeconds: 60 }, deps)).toMatchObject({ state: "waiting" });
  });
  test("fast-forward merge train without priorPipelineId: a pipeline new since the head was first seen matches", async () => {
    const train = (id: string, status: string) => pipe({ id, sha: "m".repeat(40), mergeRequestEventType: "merge_train", status });
    const { deps } = fake([mr(SHA, train("gitlab:pipeline:11", "success")), mr(SHA, train("gitlab:pipeline:12", "success"))]);
    expect(await watchPipeline(base, deps)).toMatchObject({ state: "success", pipeline: { id: "gitlab:pipeline:12" } });
  });
  test("without priorPipelineId, a pipeline already there when the head was first seen stays waiting with a hint", async () => {
    const { deps } = fake([mr(SHA, pipe({ sha: "m".repeat(40), mergeRequestEventType: "merge_train", status: "success" }))]);
    const r = await watchPipeline({ ...base, maxWaitSeconds: 60 }, deps);
    expect(r).toMatchObject({ state: "waiting" });
    expect((r as { next: string }).next).toContain("priorPipelineId");
  });
  test("a failed parent fetch is retried, not cached as no match", async () => {
    let n = 0;
    const { deps, calls } = fake([mr(SHA, pipe({ sha: "m".repeat(40), mergeRequestEventType: "merged_result", status: "success" }))], {
      commitParents: async () => { calls.parents++; return n++ === 0 ? null : [SHA]; },
    });
    expect(await watchPipeline(base, deps)).toMatchObject({ state: "success" });
    expect(calls.parents).toBe(2);
  });
  test("lease lost ends the watch with the holder", async () => {
    const other = { ...LEASE, owner: "session:b" };
    const { deps } = fake([mr(SHA, pipe({}))], { leaseCheck: () => ({ ok: false, holder: other }) });
    expect(await watchPipeline(base, deps)).toMatchObject({ state: "lease_lost", holder: { owner: "session:b" } });
  });
  test("the lease is checked on every poll", async () => {
    const { deps, calls } = fake([mr(SHA, pipe({ status: "running" }))]);
    const r = await watchPipeline({ ...base, maxWaitSeconds: 90 }, deps);
    expect(calls.heartbeats).toBe((r as { polls: number }).polls);
  });
  test("abort returns aborted at once and stops polling", async () => {
    const ac = new AbortController();
    const { deps, calls } = fake([mr(SHA, pipe({ status: "running" }))], {
      sleep: async () => { ac.abort(); },
    });
    const r = await watchPipeline({ ...base, signal: ac.signal }, deps);
    expect(r).toMatchObject({ state: "aborted" });
    expect(calls.heartbeats).toBe(1);
  });
  test("failed pipeline: blocking failures get trace tails, capped at five", async () => {
    const jobs = Array.from({ length: 7 }, (_, i) => ({ id: `gitlab:job:${i + 1}`, name: `j${i}`, stage: "test", status: "failed", allowFailure: i === 0, webUrl: null }));
    const { deps } = fake([mr(SHA, pipe({ status: "failed", jobs }))]);
    const r = await watchPipeline(base, deps) as { failedJobs: Array<{ traceTail?: string; allowFailure: boolean }>; blockingFailures: number };
    expect(r.blockingFailures).toBe(6);
    expect(r.failedJobs.filter((j) => j.traceTail !== undefined)).toHaveLength(5);
    expect(r.failedJobs.find((j) => j.allowFailure)?.traceTail).toBeUndefined();
  });
  test("list-weight pipeline with no jobs fetches failed jobs once", async () => {
    let fetched = 0;
    const { deps } = fake([mr(SHA, pipe({ status: "failed", jobs: [] }))], {
      failedJobs: async () => { fetched++; return [{ id: "gitlab:job:5", name: "unit", stage: "test", status: "failed", allowFailure: false, webUrl: null }]; },
    });
    const r = await watchPipeline(base, deps) as { failedJobs: Array<{ jobId: number }> };
    expect(fetched).toBe(1);
    expect(r.failedJobs[0]!.jobId).toBe(5);
  });
  test("a read error is returned as an error", async () => {
    const { deps } = fake([], { readMr: async () => ({ ok: false, error: "daemon down" }) });
    expect(await watchPipeline(base, deps)).toEqual({ error: "daemon down" });
  });
});
