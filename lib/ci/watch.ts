import { leaseOwner, type CiLease } from "../../packages/rt-client/src/index.ts";

export interface WatchJob { id: string; name: string; stage: string; status: string; allowFailure: boolean; webUrl: string | null }
export interface WatchPipeline { id: string; status: string; sha: string | null; ref: string | null; mergeRequestEventType: string | null; webUrl: string | null; createdAt: string | null; jobs: WatchJob[] }
export interface WatchMr { iid: number; sha: string | null; webUrl: string | null; pipeline: WatchPipeline | null }
export type LeaseCheck = { ok: true; lease: CiLease | null } | { ok: false; holder: CiLease | null; reason?: "none" | "lost" };

export interface WatchDeps {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  leaseCheck(): LeaseCheck;
  readMr(): Promise<{ ok: true; mr: WatchMr } | { ok: false; error: string }>;
  commitParents(sha: string): Promise<string[] | null>;
  failedJobs(pipelineId: number): Promise<WatchJob[] | null>;
  traceTail(jobId: number): Promise<string | null>;
}

export interface WatchInput { sha: string; maxWaitSeconds: number; intervalSeconds: number; priorPipelineId?: number; signal?: AbortSignal }

export type WatchState =
  | "success" | "success_with_warnings" | "failed" | "canceled" | "skipped" | "manual"
  | "running" | "waiting" | "superseded" | "lease_lost" | "aborted";

export interface WatchResult {
  state: WatchState;
  sha: string;
  headSha: string | null;
  pipeline: Omit<WatchPipeline, "jobs"> | null;
  failedJobs: Array<{ jobId: number; name: string; stage: string; allowFailure: boolean; webUrl: string | null; traceTail?: string }>;
  blockingFailures: number;
  lease: { owner: string; heartbeatAt: number; expiresAt: number } | null;
  holder?: CiLease | null;
  priorPipelineId?: number;
  waitedSeconds: number;
  polls: number;
  next: string;
}

export const HEAD_LAG_GRACE_MS = 120_000;
export const TERMINAL: ReadonlySet<string> = new Set(["success", "success_with_warnings", "failed", "canceled", "skipped", "manual"]);
const TRACE_JOBS = 5;
const MERGE_REF = /^refs\/merge-requests\/(\d+)\/(merge|train)$/;

export function shaMatches(full: string | null, given: string): boolean {
  if (!full) return false;
  return full.toLowerCase().startsWith(given.toLowerCase());
}

function isMergeTrain(p: WatchPipeline): boolean {
  return p.mergeRequestEventType === "merge_train" || (p.ref?.endsWith("/train") ?? false);
}

export function isMergeRefPipeline(p: WatchPipeline, iid: number): boolean {
  if (p.mergeRequestEventType === "merged_result" || p.mergeRequestEventType === "merge_train") return true;
  const m = p.ref ? MERGE_REF.exec(p.ref) : null;
  return m !== null && Number(m[1]) === iid;
}

function idNumber(id: string | null | undefined): number | null {
  const m = /:(\d+)$/.exec(id ?? "");
  return m ? Number(m[1]) : null;
}

function leaseView(lease: CiLease | null): WatchResult["lease"] {
  if (!lease) return null;
  return { owner: leaseOwner(lease), heartbeatAt: lease.heartbeatAt, expiresAt: lease.heartbeatAt + lease.ttlSeconds * 1_000 };
}

function stripJobs(p: WatchPipeline | null): WatchResult["pipeline"] {
  if (!p) return null;
  const { jobs: _jobs, ...rest } = p;
  return rest;
}

export async function watchPipeline(input: WatchInput, deps: WatchDeps): Promise<WatchResult | { error: string }> {
  const start = deps.now();
  const deadline = start + input.maxWaitSeconds * 1_000;
  // Cache key is the pipeline id, not the sha: two different pipelines under
  // watch across polls (a stale one, then the real one) must not share it.
  const parents = new Map<string, string[]>();
  let polls = 0;
  let mismatchSince: number | null = null;
  // undefined = not yet observed; null = observed but no pipeline present.
  // Both distinct from a real id, which is what "new since first seen" tests against.
  let firstSeenPipelineId: number | null | undefined;
  // Set once a match is proved against firstSeenPipelineId, which is lost when
  // this call returns; the caller passes it back as priorPipelineId.
  let provenPrior: number | undefined;
  let lease: CiLease | null = null;
  let last: { state: WatchState; mr: WatchMr | null; hint: string } = { state: "waiting", mr: null, hint: "call again" };

  const result = (state: WatchState, mr: WatchMr | null, next: string, extra: Partial<WatchResult> = {}): WatchResult => ({
    state,
    sha: input.sha,
    headSha: mr?.sha ?? null,
    pipeline: stripJobs(mr?.pipeline ?? null),
    failedJobs: [],
    blockingFailures: 0,
    lease: leaseView(lease),
    waitedSeconds: Math.round((deps.now() - start) / 1_000),
    polls,
    next,
    ...(provenPrior !== undefined && { priorPipelineId: provenPrior }),
    ...extra,
  });

  async function matches(mr: WatchMr, p: WatchPipeline): Promise<boolean | "undetermined" | "unprovable"> {
    if (!isMergeRefPipeline(p, mr.iid)) return shaMatches(p.sha, input.sha);
    if (p.sha) {
      let ps = parents.get(p.id);
      if (!ps) {
        const fetched = await deps.commitParents(p.sha);
        if (fetched === null) return "undetermined";
        parents.set(p.id, fetched);
        ps = fetched;
      }
      if (ps.some((x) => shaMatches(x, input.sha))) return true;
    }
    // A merged-results commit always has the source head as a parent, so a miss
    // proves another push. Only fast-forward / squash merge trains build a commit
    // whose parents never include the pushed sha, so only they fall back to
    // "is this pipeline new since the push".
    if (!isMergeTrain(p)) return false;
    const pid = idNumber(p.id);
    if (pid === null) return false;
    if (input.priorPipelineId !== undefined) return pid > input.priorPipelineId;
    // firstSeenPipelineId is assigned unconditionally right before every call to matches(),
    // so it is never undefined here; the type stays wide because a closure defeats TS's flow analysis.
    if (pid === firstSeenPipelineId) return "unprovable";
    // A null first-seen id means the head had no pipeline, so any pipeline is new;
    // pid - 1 is then the tightest bound under which a later call still proves this one.
    const bound = firstSeenPipelineId ?? pid - 1;
    if (bound > 0) provenPrior = bound;
    return true;
  }

  async function failures(p: WatchPipeline, withTraces: boolean): Promise<Pick<WatchResult, "failedJobs" | "blockingFailures"> & { fetchFailed: boolean }> {
    let jobs = p.jobs;
    const pid = idNumber(p.id);
    let fetchFailed = false;
    if (jobs.length === 0 && pid !== null && p.status !== "success") {
      const fetched = await deps.failedJobs(pid);
      fetchFailed = fetched === null;
      jobs = fetched ?? [];
    }
    const failed = jobs.filter((j) => j.status === "failed");
    const out: WatchResult["failedJobs"] = [];
    let traced = 0;
    for (const j of failed) {
      const jobId = idNumber(j.id);
      if (jobId === null) continue;
      const row: WatchResult["failedJobs"][number] = { jobId, name: j.name, stage: j.stage, allowFailure: j.allowFailure, webUrl: j.webUrl };
      if (withTraces && !j.allowFailure && traced < TRACE_JOBS) {
        traced++;
        const tail = await deps.traceTail(jobId);
        if (tail !== null) row.traceTail = tail;
      }
      out.push(row);
    }
    // Counted from the returned rows, not the raw failed list, so blockingFailures never exceeds failedJobs.length.
    return { failedJobs: out, blockingFailures: out.filter((j) => !j.allowFailure).length, fetchFailed };
  }

  function standDown(lc: Extract<LeaseCheck, { ok: false }>): string {
    if (lc.reason === "none") return "no lease held for this MR; call ci_lease_claim first";
    return lc.holder ? "another owner attends this MR now; stand down" : "this MR's lease is gone; stand down";
  }

  const again = (hint: string) => (provenPrior === undefined ? `${hint}; call again` : `${hint}; call again with priorPipelineId ${provenPrior}`);

  for (;;) {
    if (input.signal?.aborted) return result("aborted", last.mr, again("the call was cancelled"));
    const lc = deps.leaseCheck();
    polls++;
    if (!lc.ok) return result("lease_lost", last.mr, standDown(lc), { holder: lc.holder, lease: null });
    lease = lc.lease;

    const read = await deps.readMr();
    if (!read.ok) return { error: read.error };
    const mr = read.mr;

    if (!shaMatches(mr.sha, input.sha)) {
      // A null head is an unsynced cache entry, not a moved head, so it never starts the grace clock.
      if (mr.sha !== null) mismatchSince ??= deps.now();
      if (mismatchSince !== null && deps.now() - mismatchSince >= HEAD_LAG_GRACE_MS) {
        return result("superseded", mr, `the MR head is not at the pushed sha (head: ${mr.sha})`);
      }
      last = { state: "waiting", mr, hint: "the MR head has not reached the pushed sha yet; call again" };
    } else {
      mismatchSince = null;
      if (firstSeenPipelineId === undefined) firstSeenPipelineId = idNumber(mr.pipeline?.id);
      const p = mr.pipeline;
      const m = p ? await matches(mr, p) : false;
      if (p && m === true) {
        if (TERMINAL.has(p.status)) {
          const f = await failures(p, p.status === "failed");
          // Trace fetches can outlast the poll's heartbeat, so the lease is re-proved before reporting.
          const after = deps.leaseCheck();
          if (!after.ok) return result("lease_lost", mr, standDown(after), { holder: after.holder, lease: null });
          lease = after.lease;
          const next = p.status !== "failed"
            ? "done"
            : f.fetchFailed
              ? "the failed jobs could not be read; read them with mr_pipeline or mr_job_trace"
              : f.failedJobs.length === 0
                ? "no failed job rows (a bridge job's downstream pipeline failed); read it with mr_pipeline and the bridge job's jobId"
                : "read more of a job's log with mr_job_trace";
          return result(p.status as WatchState, mr, next, { failedJobs: f.failedJobs, blockingFailures: f.blockingFailures });
        }
        last = { state: "running", mr, hint: again("the pipeline for the pushed sha is still running") };
      } else {
        const hint = m === "unprovable"
          ? "cannot prove this merge-train pipeline is new since the push; call again with priorPipelineId (the head pipeline id read before the push)"
          : "no pipeline for the pushed sha yet; call again";
        last = { state: "waiting", mr, hint };
      }
    }

    const remaining = deadline - deps.now();
    if (remaining <= 0) return result(last.state, last.mr, last.hint);
    // Half the lease's ttl bounds the interval so the heartbeat each poll gives never lets the lease go stale.
    const interval = Math.min(input.intervalSeconds * 1_000, lease ? (lease.ttlSeconds * 1_000) / 2 : Infinity);
    await deps.sleep(Math.min(interval, remaining), input.signal);
    if (input.signal?.aborted) return result("aborted", last.mr, again("the call was cancelled"));
  }
}
