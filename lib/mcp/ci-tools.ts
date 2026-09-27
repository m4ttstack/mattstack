/**
 * The CI attendant lease tools (claim, heartbeat, release, read) and
 * ci_watch, which polls a pipeline to a terminal state under the caller's
 * lease. Every tool acts only as this session: the owner comes from
 * CLAUDE_CODE_SESSION_ID via ownerFromEnv, never from input, so a caller
 * cannot claim, heartbeat, release or watch on another session's behalf.
 */
import {
  boardDoctorOwner, claimCiLease, heartbeatCiLease, leaseOwner, parseMrIid, readCiLease, readProjectMRs, releaseCiLease, rtCommand,
  type CiLeaseHolder, type CiLeaseOpts, type Commands,
} from "../../packages/rt-client/src/index.ts";
import { readChatSession } from "../chat-session.ts";
import { watchPipeline, type WatchDeps, type WatchMr } from "../ci/watch.ts";
import { explainError } from "../explain-error.ts";
import { parseMrUrl, resolveMrTarget } from "./mr-target.ts";
import { tailTrace } from "./mr-read-tools.ts";
import { checkOptional, checkPositiveInts, checkRequired, err, MR_TARGET_PROPS, ok, REPO_NAME_RULE, type McpToolDef, type ToolResult } from "./shared.ts";

export interface CiLeaseToolDeps {
  leaseOpts: () => CiLeaseOpts;
  label: (env: NodeJS.ProcessEnv) => string | undefined;
  owner: (env: NodeJS.ProcessEnv) => string | null;
}

const TTL_MIN = 60;
const TTL_MAX = 900;
const HOLDERS: CiLeaseHolder[] = ["watch-ci", "doctor"];
const NO_SESSION = "CLAUDE_CODE_SESSION_ID is not set; the lease is owned by a Claude Code session";
const LEASE_NOTE = "One CI attendant per MR: a fresh lease held by another owner refuses the claim (reported, not an error); a lease goes stale ttlSeconds after its last heartbeat and can then be taken over. The owner is always this session; there is no owner input.";

export function ownerFromEnv(env: NodeJS.ProcessEnv): string | null {
  return env.CLAUDE_CODE_SESSION_ID ? `session:${env.CLAUDE_CODE_SESSION_ID}` : null;
}

const realLeaseDeps: CiLeaseToolDeps = {
  leaseOpts: () => ({}),
  label: (env) => readChatSession(env.CLAUDE_CODE_SESSION_ID)?.handle,
  owner: ownerFromEnv,
};

const MR_URL_PROP = { mrUrl: { type: "string", description: "The MR or PR https URL (.../-/merge_requests/<iid> or .../pull/<n>)." } };

export interface CiWatchToolDeps {
  projectMrs: typeof readProjectMRs;
  command: typeof rtCommand;
  resolve: typeof resolveMrTarget;
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); signal?.removeEventListener("abort", done); resolve(); }
    signal?.addEventListener("abort", done, { once: true });
  });
}

const realWatchDeps: CiWatchToolDeps = { projectMrs: readProjectMRs, command: rtCommand, resolve: resolveMrTarget, now: Date.now, sleep: abortableSleep };

const WATCH_LIVE_MAX_AGE_MS = 5_000;
const TRACE_TAIL = 40;

/** Shared claim/heartbeat/release/read shape: validate mrUrl and the session
    owner, then run the lease op, turning any thrown error (a busy lock or an
    fs failure) into an ordinary tool error instead of a throw. */
function leaseCall(input: Record<string, unknown>, env: NodeJS.ProcessEnv, ownerOf: CiLeaseToolDeps["owner"], run: (mrUrl: string, owner: string) => unknown): ToolResult {
  const bad = checkRequired(input, [{ name: "mrUrl", type: "string" }]);
  if (bad) return err(bad);
  const mrUrl = (input.mrUrl as string).trim();
  if (parseMrIid(mrUrl) === null) return err('"mrUrl" must be an MR or PR URL ending in /-/merge_requests/<iid> or /pull/<n>');
  const owner = ownerOf(env);
  if (!owner) return err(NO_SESSION);
  try {
    return ok(run(mrUrl, owner));
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export function ciToolDefs(overrides: Partial<CiLeaseToolDeps> & { watch?: Partial<CiWatchToolDeps> } = {}): McpToolDef[] {
  const deps = { ...realLeaseDeps, ...overrides };
  const w = { ...realWatchDeps, ...overrides.watch };
  return [
    {
      name: "ci_lease_claim",
      description: `Claim this MR's CI attendant lease for this session. Returns {claimed: true, lease, previousOwner?} or {claimed: false, holder}. Re-claiming a lease this session holds refreshes it. holder is the role (watch-ci default, or doctor); ttlSeconds ${TTL_MIN} to ${TTL_MAX}, default 600. ${LEASE_NOTE}`,
      inputSchema: { type: "object", properties: { ...MR_URL_PROP, holder: { type: "string", enum: HOLDERS }, branch: { type: "string" }, ttlSeconds: { type: "number" } }, required: ["mrUrl"], additionalProperties: false },
      shellForms: ["rt ci lease claim"],
      async handler(input, env) {
        const bad = checkOptional(input, [{ name: "holder", type: "string" }, { name: "branch", type: "string" }, { name: "ttlSeconds", type: "number" }]);
        if (bad) return err(bad);
        const holder = (input.holder as CiLeaseHolder | undefined) ?? "watch-ci";
        if (!HOLDERS.includes(holder)) return err('"holder" must be watch-ci or doctor');
        const ttl = input.ttlSeconds as number | undefined;
        if (ttl !== undefined && !(Number.isInteger(ttl) && ttl >= TTL_MIN && ttl <= TTL_MAX)) return err(`"ttlSeconds" must be an integer from ${TTL_MIN} to ${TTL_MAX}`);
        const branch = typeof input.branch === "string" && input.branch.trim() !== "" ? input.branch : undefined;
        return leaseCall(input, env, deps.owner, (mrUrl, owner) => {
          const label = deps.label(env);
          return claimCiLease({
            mrUrl, owner, holder,
            ...(branch !== undefined && { branch }),
            ...(label !== undefined && { sessionLabel: label }),
            ...(ttl !== undefined && { ttlSeconds: ttl }),
          }, deps.leaseOpts());
        });
      },
    },
    {
      name: "ci_lease_heartbeat",
      description: `Refresh this session's CI attendant lease on the MR. Returns {ok: true, lease}, or {ok: false, reason: "lost", holder} when another owner holds it now, or {ok: false, reason: "none"}. ci_watch heartbeats on every poll, so call this only between watches (during a long fix). ${LEASE_NOTE}`,
      inputSchema: { type: "object", properties: { ...MR_URL_PROP }, required: ["mrUrl"], additionalProperties: false },
      shellForms: ["rt ci lease heartbeat"],
      async handler(input, env) {
        return leaseCall(input, env, deps.owner, (mrUrl, owner) => heartbeatCiLease(mrUrl, owner, deps.leaseOpts()));
      },
    },
    {
      name: "ci_lease_release",
      description: `Release this session's CI attendant lease on the MR. Returns {released: true}, or {released: false, reason} when the lease is absent or another owner's. ${LEASE_NOTE}`,
      inputSchema: { type: "object", properties: { ...MR_URL_PROP }, required: ["mrUrl"], additionalProperties: false },
      shellForms: ["rt ci lease release"],
      async handler(input, env) {
        return leaseCall(input, env, deps.owner, (mrUrl, owner) => releaseCiLease(mrUrl, owner, deps.leaseOpts()));
      },
    },
    {
      name: "ci_lease_read",
      description: `Read the MR's CI attendant lease: {lease: <fresh lease or null>, stale: <a stale lease on disk or null>, mine: <true when the fresh lease is this session's>}. A lease with no owner field was written by the pack script and reads as owner legacy:<holder>. A stale lease of this session's own is revived by calling ci_lease_heartbeat, which checks ownership only, not freshness. ${LEASE_NOTE}`,
      inputSchema: { type: "object", properties: { ...MR_URL_PROP }, required: ["mrUrl"], additionalProperties: false },
      shellForms: ["rt ci lease show"],
      async handler(input, env) {
        return leaseCall(input, env, deps.owner, (mrUrl, owner) => {
          const r = readCiLease(mrUrl, deps.leaseOpts());
          return { ...r, mine: r.lease !== null && leaseOwner(r.lease) === owner };
        });
      },
    },
    {
      name: "ci_watch",
      description: `GitLab only. Watch the MR's pipeline for the pushed commit sha until it settles or maxWaitSeconds (default 300, cap 1800) passes, polling every intervalSeconds (default 30, floor 10). Only a pipeline for sha counts: a branch pipeline by its sha, a merged-results or merge-train pipeline by its merge commit's parents, or (fast-forward trains) by being new since the push; pass priorPipelineId (the head pipeline id read before pushing) so that proof never stalls. Every poll heartbeats this session's CI lease and returns state lease_lost the moment another owner holds the MR; with underBoardLease (a doctor the board launched) it only reads the lease and needs a fresh board doctor lease. Returns state (success, success_with_warnings, failed, canceled, skipped, manual when settled; running or waiting means call again; superseded, lease_lost or aborted end the watch), the pipeline with sha and ref, failedJobs with a trace tail for up to five blocking failures, blockingFailures, lease and next. Chat messages reach you only between calls, so a long maxWaitSeconds delays them. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: {
          ...MR_TARGET_PROPS,
          sha: { type: "string", description: "The pushed commit, 7 to 40 hex characters." },
          maxWaitSeconds: { type: "number" },
          intervalSeconds: { type: "number" },
          priorPipelineId: { type: "number", description: "The MR's head pipeline id read before the push." },
          underBoardLease: { type: "boolean" },
        },
        required: ["sha"],
        additionalProperties: false,
      },
      shellForms: ["rt ci watch"],
      async handler(input, env, signal) {
        const bad = checkRequired(input, [{ name: "sha", type: "string" }])
          ?? checkOptional(input, [{ name: "maxWaitSeconds", type: "number" }, { name: "intervalSeconds", type: "number" }, { name: "priorPipelineId", type: "number" }, { name: "underBoardLease", type: "boolean" }])
          ?? checkPositiveInts(input, ["priorPipelineId"]);
        if (bad) return err(bad);
        const sha = (input.sha as string).trim();
        if (!/^[0-9a-f]{7,40}$/i.test(sha)) return err('"sha" must be 7 to 40 hex characters');
        const maxWait = (input.maxWaitSeconds as number | undefined) ?? 300;
        if (!(Number.isInteger(maxWait) && maxWait >= 0 && maxWait <= 1800)) return err('"maxWaitSeconds" must be an integer from 0 to 1800');
        const interval = (input.intervalSeconds as number | undefined) ?? 30;
        if (!(Number.isInteger(interval) && interval >= 10)) return err('"intervalSeconds" must be an integer of at least 10');
        const owner = deps.owner(env);
        if (!owner) return err(NO_SESSION);
        const target = await w.resolve(input);
        if (!target.ok) return err(target.error);

        let mrUrl: string | null = null;
        const underBoard = input.underBoardLease === true;
        const watchDeps: WatchDeps = {
          now: w.now,
          sleep: w.sleep,
          leaseCheck: () => {
            if (!mrUrl) return { ok: false, holder: null, reason: "none" };
            if (underBoard) {
              const { lease } = readCiLease(mrUrl, deps.leaseOpts());
              if (lease && lease.owner === boardDoctorOwner(mrUrl)) return { ok: true, lease };
              return { ok: false, holder: lease, reason: lease ? "lost" : "none" };
            }
            const hb = heartbeatCiLease(mrUrl, owner, deps.leaseOpts());
            return hb.ok ? { ok: true, lease: hb.lease } : { ok: false, holder: hb.reason === "lost" ? hb.holder : null, reason: hb.reason };
          },
          readMr: async () => {
            const res = await w.projectMrs(target.identity, WATCH_LIVE_MAX_AGE_MS);
            if (!res.ok || !res.data) return { ok: false, error: explainError(res.error ?? "failed to read MRs") };
            const entry = Object.values(res.data.mrs).find((e) => e.pr.iid === target.iid);
            if (!entry) return { ok: false, error: `no MR !${target.iid} in the daemon's open-MR cache for ${target.identity}` };
            const pr = entry.pr;
            return { ok: true, mr: { iid: pr.iid, sha: pr.sha ?? null, webUrl: pr.webUrl ?? null, pipeline: (pr.pipeline ?? null) as WatchMr["pipeline"] } };
          },
          commitParents: async (s) => {
            const r = await w.command<Commands["mr:commit-parents"]["data"]>("mr:commit-parents", { repoName: target.identity, iid: target.iid, sha: s }, { timeoutMs: 30_000 });
            return r.ok && Array.isArray(r.data) ? r.data : null;
          },
          failedJobs: async (pipelineId) => {
            const r = await w.command<Commands["mr:pipeline-failed-jobs"]["data"]>("mr:pipeline-failed-jobs", { repoName: target.identity, iid: target.iid, pipelineId }, { timeoutMs: 30_000 });
            return r.ok && Array.isArray(r.data) ? r.data : null;
          },
          traceTail: async (jobId) => {
            const r = await w.command<Commands["mr:fetch-job-trace"]["data"]>("mr:fetch-job-trace", { repoName: target.identity, iid: target.iid, jobId }, { timeoutMs: 60_000 });
            return r.ok ? tailTrace(r.data ?? "", TRACE_TAIL).trace : null;
          },
        };

        const first = await watchDeps.readMr();
        if (!first.ok) return err(first.error);
        mrUrl = first.mr.webUrl;
        if (!mrUrl) return err(`MR !${target.iid} has no web URL in the cache; retry once the daemon has synced it`);
        if (parseMrUrl(mrUrl) === null || (first.mr.pipeline !== null && !first.mr.pipeline.id.startsWith("gitlab:"))) {
          return err("ci_watch is GitLab only");
        }

        try {
          const r = await watchPipeline({ sha, maxWaitSeconds: maxWait, intervalSeconds: interval, ...(typeof input.priorPipelineId === "number" && { priorPipelineId: input.priorPipelineId }), ...(signal && { signal }) }, watchDeps);
          return "error" in r ? err(r.error) : ok(r);
        } catch (e) {
          return err(e instanceof Error ? e.message : String(e));
        }
      },
    },
  ];
}
