/**
 * The CI attendant lease tools (claim, heartbeat, release, read) and
 * ci_watch, which polls a pipeline to a terminal state under the caller's
 * lease. Every tool acts only as this session: the owner comes from
 * CLAUDE_CODE_SESSION_ID via ownerFromEnv, never from input, so a caller
 * cannot claim, heartbeat, release or watch on another session's behalf.
 */
import {
  boardDoctorOwner, claimCiLease, getSetting, heartbeatCiLease, leaseOwner, readCiLease, releaseCiLease, rtCommand,
  type CiLeaseHolder, type CiLeaseOpts, type Commands,
} from "../../packages/rt-client/src/index.ts";
import { readChatSession } from "../chat-session.ts";
import { gitlabTriageForge } from "../ci/gitlab-forge.ts";
import { isHttpsMrUrl, NO_SESSION, ownerFromEnv } from "../ci/lease-guard.ts";
import { keepalive as processKeepalive, type LeaseKeepalive } from "../ci/lease-keepalive.ts";
import { mergeConfig, settingsConfig, type InlineConfig } from "../ci/triage-config.ts";
import { runTriage } from "../ci/triage.ts";
import { readWatchState, writeWatchState, type PersistedWatch } from "../ci/watch-state.ts";
import { watchPipeline, type LeaseCheck, type WatchDeps, type WatchPipeline } from "../ci/watch.ts";
import type { Pipeline as GlancePipeline } from "@mattstack/glance";
import { explainError } from "../explain-error.ts";
import { parseMrUrl, resolveMrTarget } from "./mr-target.ts";
import { isGithubPrUrl, readPipelineSubject, tailTrace, unsupportedGithub } from "./mr-read-tools.ts";
import { checkOptional, checkPositiveInts, checkRequired, err, MR_TARGET_PROPS, ok, REPO_NAME_RULE, type McpToolDef, type ToolResult } from "./shared.ts";

export interface CiLeaseToolDeps {
  leaseOpts: () => CiLeaseOpts;
  label: (env: NodeJS.ProcessEnv) => string | undefined;
  owner: (env: NodeJS.ProcessEnv) => string | null;
}

const TTL_MIN = 60;
const TTL_MAX = 900;
const INTERVAL_MIN = 10;
const INTERVAL_MAX = 120;
// Below Claude Code's 1800 s MCP idle timeout, with room for the last poll's
// trace fetches, for a client that sends no progress token.
const MAX_WAIT = 1500;
const HOLDERS: CiLeaseHolder[] = ["watch-ci", "doctor"];
const NO_PIPELINE_MS = 10 * 60_000;
const MAX_RECLAIMS = 2;
const LEASE_NOTE = "One CI attendant per MR: a fresh lease held by another owner refuses the claim (reported, not an error); a lease goes stale ttlSeconds after its last heartbeat and can then be taken over. The owner is always this session; there is no owner input.";

export { ownerFromEnv, isHttpsMrUrl } from "../ci/lease-guard.ts";

const realLeaseDeps: CiLeaseToolDeps = {
  leaseOpts: () => ({}),
  label: (env) => readChatSession(env.CLAUDE_CODE_SESSION_ID)?.handle,
  owner: ownerFromEnv,
};

const MR_URL_PROP = { mrUrl: { type: "string", description: "The MR or PR https URL (.../-/merge_requests/<iid> or .../pull/<n>)." } };

export interface CiWatchToolDeps {
  command: typeof rtCommand;
  resolve: typeof resolveMrTarget;
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  budgetMinutes: () => number;
  keepalive: LeaseKeepalive;
  stateOpts: () => { dir?: string };
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); signal?.removeEventListener("abort", done); resolve(); }
    signal?.addEventListener("abort", done, { once: true });
  });
}

export interface CiTriageToolDeps {
  command: typeof rtCommand;
  resolve: typeof resolveMrTarget;
  readSetting: (key: string) => unknown;
}

const realTriageDeps: CiTriageToolDeps = { command: rtCommand, resolve: resolveMrTarget, readSetting: (key) => getSetting(key).value };

const TRIAGE_NEXT = "Read more of a job's log with mr_job_trace {jobId}; retry one job with mr_retry {jobId}. Whether to retry is your call: the verdicts and ownership are evidence, not an instruction.";

const BUDGET_DEFAULT = 75;
const BUDGET_MAX = 10_080;
const EXTEND_MAX = 1440;

function isMinutes(v: unknown, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max;
}

function settingBudget(): number {
  const v = getSetting<number>("ci.watch.budgetMinutes").value;
  return isMinutes(v, BUDGET_MAX) ? v : BUDGET_DEFAULT;
}

const realWatchDeps: CiWatchToolDeps = {
  command: rtCommand, resolve: resolveMrTarget, now: Date.now, sleep: abortableSleep, budgetMinutes: settingBudget,
  keepalive: processKeepalive, stateOpts: () => ({}),
};

const TRACE_TAIL = 40;

// glance's Pipeline carries sha/ref/mergeRequestEventType as optional (an older provider
// snapshot may lack them); WatchPipeline requires string | null, never undefined, so a
// missing field maps to null rather than an unmatchable pipeline.
function toWatchPipeline(p: GlancePipeline | null | undefined): WatchPipeline | null {
  if (!p) return null;
  return {
    id: p.id,
    status: p.status,
    sha: p.sha ?? null,
    ref: p.ref ?? null,
    mergeRequestEventType: p.mergeRequestEventType ?? null,
    webUrl: p.webUrl,
    createdAt: p.createdAt,
    jobs: p.jobs.map((j) => ({ id: j.id, name: j.name, stage: j.stage, status: j.status, allowFailure: j.allowFailure, webUrl: j.webUrl })),
  };
}

/** Shared claim/heartbeat/release/read shape: validate mrUrl and the session
    owner, then run the lease op, turning any thrown error (a busy lock or an
    fs failure) into an ordinary tool error instead of a throw. */
function leaseCall(input: Record<string, unknown>, env: NodeJS.ProcessEnv, ownerOf: CiLeaseToolDeps["owner"], run: (mrUrl: string, owner: string) => unknown): ToolResult {
  const bad = checkRequired(input, [{ name: "mrUrl", type: "string" }]);
  if (bad) return err(bad);
  const mrUrl = (input.mrUrl as string).trim();
  if (!isHttpsMrUrl(mrUrl)) return err('"mrUrl" must be an https MR or PR URL ending in /-/merge_requests/<iid> or /pull/<n>');
  const owner = ownerOf(env);
  if (!owner) return err(NO_SESSION);
  try {
    return ok(run(mrUrl, owner));
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export function ciToolDefs(overrides: Partial<CiLeaseToolDeps> & { watch?: Partial<CiWatchToolDeps>; triage?: Partial<CiTriageToolDeps> } = {}): McpToolDef[] {
  const deps = { ...realLeaseDeps, ...overrides };
  const w = { ...realWatchDeps, ...overrides.watch };
  const tri = { ...realTriageDeps, ...overrides.triage };
  return [
    {
      name: "ci_lease_claim",
      description: `Claim this MR's CI attendant lease for this session. Returns {claimed: true, lease, previousOwner?} or {claimed: false, holder}. Re-claiming a lease this session holds refreshes it. holder is the role (watch-ci default, or doctor); ttlSeconds ${TTL_MIN} to ${TTL_MAX}, default 600. ${LEASE_NOTE}`,
      inputSchema: { type: "object", properties: { ...MR_URL_PROP, holder: { type: "string", enum: HOLDERS }, branch: { type: "string", description: "The MR's source branch; pass it so the board's stack preflight sees this attendant." }, ttlSeconds: { type: "number" } }, required: ["mrUrl"], additionalProperties: false },
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
        return leaseCall(input, env, deps.owner, (mrUrl, owner) => {
          const released = releaseCiLease(mrUrl, owner, deps.leaseOpts());
          w.keepalive.drop(mrUrl, owner);
          return released;
        });
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
      description: `GitLab only. Watch the MR's pipeline for the pushed commit sha until it settles or maxWaitSeconds (default 300, cap ${MAX_WAIT}) passes, polling every intervalSeconds (default 30, ${INTERVAL_MIN} to ${INTERVAL_MAX}, and never more than half the lease's ttlSeconds). Only a pipeline for sha counts: a branch pipeline by its sha, a merged-results or merge-train pipeline by its merge commit's parents, or (fast-forward trains) by being new since the push; pass priorPipelineId (the head pipeline id read before pushing) so that proof never stalls; a result that proved it without one carries priorPipelineId to pass on the next call. Every poll heartbeats this session's CI lease and returns state lease_lost the moment another owner holds the MR; with underBoardLease (a doctor the board launched) it only reads the lease and needs a fresh board doctor lease. Returns state (success, success_with_warnings, failed, canceled, skipped, manual when settled; failed also as soon as a blocking job fails while the pipeline still runs; running or waiting means call again; superseded, lease_lost or aborted end the watch), the pipeline with sha and ref, failedJobs listing every failed job, with a trace tail on the first five blocking ones (jobs in same-project downstream pipelines included; read any other job's log with mr_job_trace), blockingFailures, lease, budget and next. budget is {minutes, elapsedMinutes, spent}, measured from the watched pipeline's createdAt against the ci.watch.budgetMinutes setting (default ${BUDGET_DEFAULT}), or null while no pipeline for sha exists; a pipeline still running once spent is true returns running at once, so stop watching it. Chat messages reach you only between calls, so a long maxWaitSeconds delays them. With attend: true the call attends the MR itself: every poll heartbeats this session's lease or, when none is held, claims it (holder, with the MR's source branch); a lease that vanishes is re-claimed at most ${MAX_RECLAIMS} times per commit, and the lease is kept alive between calls until ci_lease_release. The budget window, prior pipeline id and waiting clock persist per MR, so later calls need not pass budgetMinutes or priorPipelineId, and a pipeline that last failed and runs again opens a fresh window by itself. attend adds the states timeout (still running past the budget), no_pipeline (${NO_PIPELINE_MS / 60_000} minutes of waiting with no pipeline for sha; pushed says whether the MR head is at sha, remoteSha is that head), stood_down (another owner attends; carries holder), lease_unavailable (the lease could not be claimed or kept; carries error) and unsupported_forge (a GitHub PR), and never returns lease_lost. With underBoardLease and attend it still only reads the board doctor lease. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: {
          ...MR_TARGET_PROPS,
          sha: { type: "string", description: "The pushed commit, 7 to 40 hex characters." },
          maxWaitSeconds: { type: "number" },
          intervalSeconds: { type: "number" },
          budgetMinutes: { type: "number", description: `Overrides the ci.watch.budgetMinutes setting for this call, 1 to ${BUDGET_MAX}: pass the budget.minutes an extendMinutes call returned.` },
          extendMinutes: { type: "number", description: `1 to ${EXTEND_MAX}: opens a fresh window this many minutes past the pipeline's current age (never shorter than the budget), fixed at the call's first match. Pass it after a granted extension until a result carries a non-null budget; later calls pass that budget.minutes as budgetMinutes.` },
          freshWindow: { type: "boolean", description: "true opens a fresh window of the ci.watch.budgetMinutes setting past the pipeline's current age, as extendMinutes does; pass it after a job retry (budgetMinutes is ignored), never with extendMinutes." },
          priorPipelineId: { type: "number", description: "The MR's head pipeline id read before the push: the numeric part of a gitlab:pipeline:N id, as mr_pipeline returns it." },
          underBoardLease: { type: "boolean" },
          attend: { type: "boolean", description: "true: claim and keep this session's lease and persist the watch window for the MR." },
          holder: { type: "string", enum: HOLDERS, description: "The role a claim takes, watch-ci (default) or doctor; only with attend." },
        },
        required: ["sha"],
        additionalProperties: false,
      },
      shellForms: ["rt ci watch"],
      async handler(input, env, signal, progress) {
        const bad = checkRequired(input, [{ name: "sha", type: "string" }])
          ?? checkOptional(input, [{ name: "maxWaitSeconds", type: "number" }, { name: "intervalSeconds", type: "number" }, { name: "budgetMinutes", type: "number" }, { name: "extendMinutes", type: "number" }, { name: "freshWindow", type: "boolean" }, { name: "priorPipelineId", type: "number" }, { name: "underBoardLease", type: "boolean" }, { name: "attend", type: "boolean" }, { name: "holder", type: "string" }])
          ?? checkPositiveInts(input, ["priorPipelineId"]);
        if (bad) return err(bad);
        const sha = (input.sha as string).trim();
        if (!/^[0-9a-f]{7,40}$/i.test(sha)) return err('"sha" must be 7 to 40 hex characters');
        const maxWait = (input.maxWaitSeconds as number | undefined) ?? 300;
        if (!(Number.isInteger(maxWait) && maxWait >= 0 && maxWait <= MAX_WAIT)) return err(`"maxWaitSeconds" must be an integer from 0 to ${MAX_WAIT}`);
        const interval = (input.intervalSeconds as number | undefined) ?? 30;
        if (!(Number.isInteger(interval) && interval >= INTERVAL_MIN && interval <= INTERVAL_MAX)) return err(`"intervalSeconds" must be an integer from ${INTERVAL_MIN} to ${INTERVAL_MAX}`);
        if (input.budgetMinutes !== undefined && !isMinutes(input.budgetMinutes, BUDGET_MAX)) return err(`"budgetMinutes" must be an integer from 1 to ${BUDGET_MAX}`);
        if (input.extendMinutes !== undefined && !isMinutes(input.extendMinutes, EXTEND_MAX)) return err(`"extendMinutes" must be an integer from 1 to ${EXTEND_MAX}`);
        const fresh = input.freshWindow === true;
        if (fresh && input.extendMinutes !== undefined) return err('"freshWindow" and "extendMinutes" cannot be combined');
        const attend = input.attend === true;
        if (input.holder !== undefined && !attend) return err('"holder" is only valid with "attend": true');
        const holder = (input.holder as CiLeaseHolder | undefined) ?? "watch-ci";
        if (!HOLDERS.includes(holder)) return err('"holder" must be watch-ci or doctor');
        const setting = w.budgetMinutes();
        const extendMinutes = fresh ? setting : (input.extendMinutes as number | undefined);
        const owner = deps.owner(env);
        if (!owner) return err(NO_SESSION);
        if (attend && isGithubPrUrl(input.mrUrl)) return ok({ ...unsupportedGithub("ci_watch"), sha });
        const target = await w.resolve(input);
        if (!target.ok) return err(target.error);

        let mrUrl: string | null = null;
        let sourceBranch: string | undefined;
        const underBoard = input.underBoardLease === true;
        let firstRead: Awaited<ReturnType<WatchDeps["readMr"]>> | null = null;
        // Only set with attend; the leaseCheck mutates held and reclaims, and observe persists them once a poll proves the lease.
        let watched: PersistedWatch | null = null;
        let proved = false;
        const stateOpts = () => ({ ...w.stateOpts(), now: w.now });

        const attendLease = (url: string, st: PersistedWatch): LeaseCheck => {
          const opts = deps.leaseOpts();
          if (underBoard) {
            const { lease } = readCiLease(url, opts);
            if (lease && lease.owner === boardDoctorOwner(url)) return { ok: true, lease };
            return { ok: false, reason: "stood_down", holder: lease };
          }
          const unavailable = (e: unknown): LeaseCheck => {
            w.keepalive.drop(url, owner);
            return { ok: false, reason: "unavailable", error: e instanceof Error ? e.message : String(e) };
          };
          // held and reclaims belong to the owner that held the lease; another owner starts its own count.
          if (st.heldBy !== owner) {
            st.held = false;
            st.reclaims = 0;
          }
          const markHeld = () => {
            st.held = true;
            st.heldBy = owner;
          };
          let hb: ReturnType<typeof heartbeatCiLease>;
          try {
            hb = heartbeatCiLease(url, owner, opts);
          } catch (e) {
            // A busy lock is not a verdict: an unlocked read that still shows this session's fresh lease keeps the watch going.
            try {
              const { lease } = readCiLease(url, opts);
              if (lease && leaseOwner(lease) === owner) {
                markHeld();
                return { ok: true, lease };
              }
            } catch { /* the heartbeat's own error is the one to report */ }
            return unavailable(e);
          }
          if (hb.ok) {
            markHeld();
            w.keepalive.touch(url, owner);
            return { ok: true, lease: hb.lease };
          }
          try {
            const { lease: current, stale } = readCiLease(url, opts);
            if (current && leaseOwner(current) !== owner) return { ok: false, reason: "stood_down", holder: current };
            // Taking over another owner's stale lease is this session's first claim; the re-claim count on disk was theirs.
            const takeover = stale !== null && leaseOwner(stale) !== owner;
            if (!takeover && st.held && st.reclaims >= MAX_RECLAIMS) {
              return unavailable(`the lease vanished again after ${MAX_RECLAIMS} re-claims for this commit`);
            }
            const label = deps.label(env);
            const claim = claimCiLease({
              mrUrl: url, owner, holder,
              ...(sourceBranch !== undefined && { branch: sourceBranch }),
              ...(label !== undefined && { sessionLabel: label }),
            }, opts);
            if (!claim.claimed) return { ok: false, reason: "stood_down", holder: claim.holder };
            if (takeover || claim.previousOwner !== undefined) st.reclaims = 0;
            else if (st.held) st.reclaims++;
            markHeld();
            w.keepalive.touch(url, owner);
            return { ok: true, lease: claim.lease };
          } catch (e) {
            return unavailable(e);
          }
        };

        const watchDeps: WatchDeps = {
          now: w.now,
          sleep: w.sleep,
          leaseCheck: () => {
            if (!mrUrl) return { ok: false, holder: null, reason: "none" };
            if (watched) return attendLease(mrUrl, watched);
            if (underBoard) {
              const { lease } = readCiLease(mrUrl, deps.leaseOpts());
              if (lease && lease.owner === boardDoctorOwner(mrUrl)) return { ok: true, lease };
              // A board-launched doctor never claims, so a missing board lease is a stand-down, not a cue to claim.
              return { ok: false, holder: lease, reason: "lost" };
            }
            const hb = heartbeatCiLease(mrUrl, owner, deps.leaseOpts());
            return hb.ok ? { ok: true, lease: hb.lease } : { ok: false, holder: hb.reason === "lost" ? hb.holder : null, reason: hb.reason };
          },
          readMr: async () => {
            progress?.();
            if (firstRead) {
              const memo = firstRead;
              firstRead = null;
              return memo;
            }
            const res = await w.command<Commands["mr:get"]["data"]>("mr:get", { repoName: target.identity, iid: target.iid }, { timeoutMs: 30_000 });
            if (!res.ok || !res.data) return { ok: false, error: explainError(res.error ?? "failed to read the MR") };
            const pr = res.data.mr;
            if (typeof pr.sourceBranch === "string" && pr.sourceBranch !== "") sourceBranch = pr.sourceBranch;
            return { ok: true, mr: { iid: pr.iid, sha: pr.sha ?? null, webUrl: pr.webUrl ?? null, pipeline: toWatchPipeline(pr.pipeline) } };
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
          observe: (o) => {
            if (!watched) return;
            if (o.pipelineId !== null) {
              watched.pipelineId = o.pipelineId;
              watched.pipelineStatus = o.pipelineStatus;
            }
            watched.budgetMinutes = o.budgetMinutes ?? watched.budgetMinutes;
            watched.priorPipelineId = o.priorPipelineId;
            watched.waitingSince = o.waitingSince;
            writeWatchState(watched, stateOpts());
            proved = true;
          },
        };

        const first = await watchDeps.readMr();
        if (!first.ok) return err(first.error);
        firstRead = first;
        mrUrl = first.mr.webUrl;
        if (!mrUrl) return err(`GitLab returned MR !${target.iid} with no web URL`);
        if (parseMrUrl(mrUrl) === null || (first.mr.pipeline !== null && !first.mr.pipeline.id.startsWith("gitlab:"))) {
          return attend ? ok({ ...unsupportedGithub("ci_watch"), sha }) : err("ci_watch is GitLab only");
        }

        try {
          if (attend) watched = readWatchState(mrUrl, sha, stateOpts());
          const budgetMinutes = fresh ? setting : (input.budgetMinutes as number | undefined) ?? watched?.budgetMinutes ?? setting;
          const priorPipelineId = typeof input.priorPipelineId === "number" ? input.priorPipelineId : watched?.priorPipelineId ?? undefined;
          const retried = watched && (watched.lastResult === "failed" || watched.lastResult === "canceled") ? watched.pipelineId : null;
          const r = await watchPipeline({
            sha, maxWaitSeconds: maxWait, intervalSeconds: interval, budgetMinutes,
            ...(extendMinutes !== undefined && { extendMinutes }),
            ...(priorPipelineId !== undefined && { priorPipelineId }),
            ...(watched && { attend: { waitingSince: watched.waitingSince, noPipelineMs: NO_PIPELINE_MS, lastFailedPipelineId: retried, freshMinutes: setting } }),
            ...(signal && { signal }),
          }, watchDeps);
          if (!("state" in r)) return err(r.error);
          // Only the MR's current attendant writes: a call that stood down or lost the lease leaves the window to whoever holds it.
          if (watched && proved && r.state !== "stood_down" && r.state !== "lease_unavailable") {
            watched.lastResult = r.state;
            writeWatchState(watched, stateOpts());
          }
          return ok(r);
        } catch (e) {
          return err(e instanceof Error ? e.message : String(e));
        }
      },
    },
    {
      name: "ci_triage",
      description: `GitLab only. Sort a pipeline's failed jobs, same-project child pipelines included, into REAL, INFRA or UNCLEAR by their log, and mark each blocking job yours, INHERITED (also failing on the target branch) or UNKNOWN. pipelineId defaults to the MR's head pipeline. Returns state triaged with pipeline, base, blocking, nonBlocking, crossProject, summary and next. Patterns and base settings come from ci.triage.*; config adds one-off real-patterns, infra-patterns and noisy-jobs, and sets base-depth, base-ref and skip-base. base names the comparison branch and noBase turns the comparison off. It reports; retrying is the caller's decision. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: {
          ...MR_TARGET_PROPS,
          pipelineId: { type: "number", description: "The numeric part of a gitlab:pipeline:N id; default the MR's head pipeline." },
          config: { type: "object", description: "Optional one-off override with the keys of a pack's ci-config.json." },
          base: { type: "string", description: "The branch whose recent failures mark a job INHERITED." },
          noBase: { type: "boolean" },
        },
        additionalProperties: false,
      },
      shellForms: { none: "no glab verb triages a pipeline's failures; the script forms join in wave 3" },
      async handler(input, _env, _signal, progress) {
        const bad = checkOptional(input, [{ name: "pipelineId", type: "number" }, { name: "base", type: "string" }, { name: "noBase", type: "boolean" }])
          ?? checkPositiveInts(input, ["pipelineId"]);
        if (bad) return err(bad);
        if (input.config !== undefined && (typeof input.config !== "object" || input.config === null || Array.isArray(input.config))) return err('"config" must be an object');
        let config;
        try {
          const base = settingsConfig(tri.readSetting);
          config = "error" in base ? base : mergeConfig(base, input.config as InlineConfig | undefined);
        } catch (e) {
          return err(e instanceof Error ? e.message : String(e));
        }
        if ("error" in config) return err(config.error);
        if (isGithubPrUrl(input.mrUrl)) return ok(unsupportedGithub("ci_triage"));
        const target = await tri.resolve(input);
        if (!target.ok) return err(target.error);
        const subject = await readPipelineSubject(tri.command, target, input.pipelineId as number | undefined);
        if (subject.kind === "error") return err(subject.error);
        if (subject.kind === "github") return ok(unsupportedGithub("ci_triage"));
        const report = await runTriage(gitlabTriageForge(tri.command, target), {
          pipelineId: subject.pipelineId,
          targetBranch: subject.targetBranch,
          config,
          ...(typeof input.base === "string" && { base: input.base }),
          ...(input.noBase === true && { noBase: true }),
        }, { ...(progress && { onProgress: progress }) });
        return "error" in report ? err(report.error) : ok({ state: "triaged", ...report, next: TRIAGE_NEXT });
      },
    },
  ];
}
