/**
 * GitLab read tools. Each asks the daemon for a live read from GitLab; none
 * reads the daemon's open-MR cache, so any MR the token can see is readable.
 */
import { rtCommand } from "../../packages/rt-client/src/index.ts";
import type { Commands } from "../../packages/rt-client/src/index.ts";
import { explainError } from "../explain-error.ts";
import { resolveMrTarget, resolveRepoTarget } from "./mr-target.ts";
import { sliceTrace, type TraceMode } from "./trace-slice.ts";
import { checkOptional, checkPositiveInts, checkStringArray, err, MR_TARGET_PROPS, ok, REPO_NAME_RULE, REPO_TARGET_PROPS, type McpToolDef } from "./shared.ts";

export interface MrReadDeps {
  command: typeof rtCommand;
}

export const realMrReadDeps: MrReadDeps = { command: rtCommand };

const STATES = ["opened", "merged", "closed", "all"] as const;
const LIVE_NOTE = "Read from GitLab on every call: any MR the token can see, whoever wrote it. A GitLab refusal comes back as GitLab's own text";
const LEGACY_LIST_LIMIT = 200;
const IGNORED_MAX_AGE = { type: "number", description: "Accepted and ignored; every read is live." };
const READ_TIMEOUT_MS = 30_000;

const JOB_ID_NOTE = "jobId is the numeric part of a job id like gitlab:job:123. Take it from this MR's pipeline: the daemon does not check that the job belongs to this MR, so jobId may name any job in the MR's project";

const TRACE_TAIL_LINES = 200;

export function tailTrace(raw: string, tailLines: number): { trace: string; truncated: boolean; totalLines: number } {
  return sliceTrace(raw, { kind: "tail", lines: tailLines });
}

function pipelineNumber(pr: { pipeline?: { id?: string } | null }): number | undefined {
  const m = /:(\d+)$/.exec(pr.pipeline?.id ?? "");
  return m ? Number(m[1]) : undefined;
}

export function mrReadToolDefs(deps: MrReadDeps = realMrReadDeps): McpToolDef[] {
  async function getMr(identity: string, iid: number): Promise<{ ok: true; data: Commands["mr:get"]["data"] } | { ok: false; error: string }> {
    const r = await deps.command<Commands["mr:get"]["data"]>("mr:get", { repoName: identity, iid }, { timeoutMs: READ_TIMEOUT_MS });
    if (!r.ok || !r.data) return { ok: false, error: explainError(r.error ?? "MR read failed") };
    return { ok: true, data: r.data };
  }

  return [
    {
      name: "mr_view",
      description: `GitLab only. One MR by iid, in full: opened, merged or closed. ${LIVE_NOTE}. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...MR_TARGET_PROPS, maxAgeMs: IGNORED_MAX_AGE }, additionalProperties: false },
      shellForms: ["glab mr view", { id: "glab", pattern: /(?<![\w-])glab\b/, example: "glab issue list", note: "mr_view, mr_list, mr_for_branch, mr_threads, mr_pipeline, mr_job_trace, pipeline_list, project_labels, mr_merge, an mr_* write, or gitlab_get for any other read" }],
      async handler(input) {
        const bad = checkOptional(input, [{ name: "maxAgeMs", type: "number" }]);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const read = await getMr(target.identity, target.iid);
        return read.ok ? ok({ mr: read.data.mr, fetchedAt: read.data.fetchedAt }) : err(read.error);
      },
    },
    {
      name: "mr_list",
      description: `GitLab only. A summary of each matching MR of the target project (iid, title, state, draft, sourceBranch, targetBranch, author username, webUrl, detailedMergeStatus), most recently updated first. Filters: author (a username, or "me"), sourceBranch, targetBranch, state (default opened, which includes drafts), search (title and description, so a ticket id finds its MR). Returns {mrs, truncated}: at most limit rows (default 50, maximum 200), truncated true when GitLab had more. With targetBranch the body also carries targetBranch and full (true when nothing was cut); use that to prove a branch has no stacked children. Use mr_view for one MR in full. ${LIVE_NOTE}. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: {
          ...REPO_TARGET_PROPS,
          author: { type: "string", description: 'A GitLab username, or "me" for the signed-in user.' },
          sourceBranch: { type: "string" },
          targetBranch: { type: "string" },
          state: { type: "string", enum: [...STATES] },
          search: { type: "string", description: "Text matched against title and description." },
          limit: { type: "number" },
          maxAgeMs: IGNORED_MAX_AGE,
        },
        additionalProperties: false,
      },
      shellForms: ["glab mr list"],
      async handler(input) {
        const bad = checkOptional(input, [
          { name: "author", type: "string" }, { name: "sourceBranch", type: "string" }, { name: "targetBranch", type: "string" },
          { name: "state", type: "string" }, { name: "search", type: "string" }, { name: "limit", type: "number" }, { name: "maxAgeMs", type: "number" },
        ]);
        if (bad) return err(bad);
        for (const name of ["author", "sourceBranch", "targetBranch", "search"] as const) {
          if (typeof input[name] === "string" && !(input[name] as string).trim()) return err(`"${name}" is blank; omit it to leave the filter off`);
        }
        const state = (input.state as string | undefined) ?? "opened";
        if (!STATES.includes(state as typeof STATES[number])) return err(`"state" must be one of ${STATES.join(", ")}`);
        const target = await resolveRepoTarget(input);
        if (!target.ok) return err(target.error);
        const payload: Commands["mr:list-live"]["payload"] = { repoName: target.identity };
        for (const name of ["author", "sourceBranch", "targetBranch", "search"] as const) {
          const v = (input[name] as string | undefined)?.trim();
          if (v) payload[name] = v;
        }
        if (input.state !== undefined) payload.state = state as typeof STATES[number];
        if (typeof input.limit === "number") payload.limit = input.limit;
        // Skills compiled before the read went live call this with only maxAgeMs to
        // rule out a stack, and a partial list there would pass a stacked branch.
        const legacy = input.maxAgeMs !== undefined && Object.keys(payload).length === 1;
        if (legacy) payload.limit = LEGACY_LIST_LIMIT;
        const r = await deps.command<Commands["mr:list-live"]["data"]>("mr:list-live", { ...payload }, { timeoutMs: READ_TIMEOUT_MS });
        if (!r.ok || !r.data) return err(explainError(r.error ?? "MR listing failed"));
        if (legacy) {
          if (r.data.truncated) return err(`more than ${LEGACY_LIST_LIMIT} open MRs; pass sourceBranch or targetBranch to read the ones that matter`);
          return ok({ mrs: r.data.mrs, truncated: false, syncedAt: Date.now() });
        }
        return ok({ mrs: r.data.mrs, truncated: r.data.truncated, ...(payload.targetBranch ? { targetBranch: payload.targetBranch, full: !r.data.truncated } : {}) });
      },
    },
    {
      name: "mr_for_branch",
      description: `GitLab only. The open MR (or null) for each named source branch, by any author. A null means GitLab has no open MR with that source branch. ${LIVE_NOTE}. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...REPO_TARGET_PROPS, branches: { type: "array", items: { type: "string" }, minItems: 1 } }, required: ["branches"], additionalProperties: false },
      shellForms: [{ id: "subst", pattern: /\b[A-Za-z_][A-Za-z0-9_]*=\$\(\s*(rt|glab)\b/, example: "IID=$(glab mr list --json)", note: "a tool returns the value; nothing needs a shell variable (the inner call names the tool: glab mr list is mr_for_branch or mr_list, rt runs is run_*)" }],
      async handler(input) {
        const bad = checkStringArray(input, "branches");
        if (bad) return err(bad);
        if (!Array.isArray(input.branches) || input.branches.length === 0) return err('"branches" must name at least one branch');
        const target = await resolveRepoTarget(input);
        if (!target.ok) return err(target.error);
        const r = await deps.command<Commands["mr:live-by-branch"]["data"]>("mr:live-by-branch", { repoName: target.identity, branches: input.branches as string[] }, { timeoutMs: 60_000 });
        if (!r.ok || !r.data) return err(explainError(r.error ?? "branch lookup failed"));
        const byBranch = Object.fromEntries(Object.entries(r.data.byBranch).map(([branch, mr]) => [branch, mr ? { pr: mr, source: "forge" as const } : null]));
        return ok({ byBranch });
      },
    },
    {
      name: "mr_threads",
      description: `GitLab only. The MR's discussion threads, fetched from GitLab on every call. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...MR_TARGET_PROPS, refresh: { type: "boolean", description: "Accepted and ignored; every read is live." } }, additionalProperties: false },
      shellForms: { none: "discussions have no glab verb; a glab api call hits the glab catch-all on mr_view" },
      async handler(input) {
        const bad = checkOptional(input, [{ name: "refresh", type: "boolean" }]);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const r = await deps.command<Commands["discussions:refresh"]["data"]>("discussions:refresh", { repoName: target.identity, iid: target.iid }, { timeoutMs: READ_TIMEOUT_MS });
        if (!r.ok || !r.data) return err(explainError(r.error ?? "thread read failed"));
        return ok({ discussions: r.data.discussions, fetchedAt: r.data.fetchedAt, stale: false });
      },
    },
    {
      name: "mr_pipeline",
      description: `GitLab only. The MR's head pipeline, carrying sha, ref and mergeRequestEventType ("merged_result", "detached", "merge_train" or null; for merged-results pipelines sha is the merge commit, not the source branch head), and, with jobId, that job's detail: a bridge job's downstream pipeline, or for any other job {type: "trace", traceVia: "mr_job_trace"}, since its log is read with mr_job_trace. For pipelines on a branch with no MR, or an MR's earlier pipelines, use pipeline_list. ${JOB_ID_NOTE}. ${LIVE_NOTE}. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...MR_TARGET_PROPS, maxAgeMs: IGNORED_MAX_AGE, jobId: { type: "number" } }, additionalProperties: false },
      shellForms: ["glab ci view", "glab ci status"],
      async handler(input) {
        const bad = checkOptional(input, [{ name: "maxAgeMs", type: "number" }]) ?? checkPositiveInts(input, ["jobId"]);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const read = await getMr(target.identity, target.iid);
        if (!read.ok) return err(read.error);
        const body: Record<string, unknown> = { pipeline: read.data.mr.pipeline ?? null };
        if (typeof input.jobId === "number") {
          const payload: Commands["mr:fetch-job-detail"]["payload"] = { repoName: target.identity, iid: target.iid, jobId: input.jobId };
          const pipelineId = pipelineNumber(read.data.mr);
          if (pipelineId !== undefined) payload.pipelineId = pipelineId;
          const job = await deps.command<Commands["mr:fetch-job-detail"]["data"]>("mr:fetch-job-detail", payload, { timeoutMs: READ_TIMEOUT_MS });
          if (!job.ok) return err(explainError(job.error ?? "job detail failed"));
          body.job = job.data?.type === "trace" ? { type: "trace", traceVia: "mr_job_trace" } : job.data;
        }
        return ok(body);
      },
    },
    {
      name: "mr_job_trace",
      description: `GitLab only. Part of one CI job's plain-text trace, ANSI escapes stripped, capped at 64 KiB. One mode per call: tailLines (the last N lines; the default, N=${TRACE_TAIL_LINES}), headLines (the first N), fromLine with lineCount (a range, 1-based, lineCount default ${TRACE_TAIL_LINES}), or grep with contextLines (lines containing the text, case-insensitive plain text, each prefixed with its line number, groups separated by --; contextLines default 2). Returns trace, truncated (true when the trace holds more than was returned, and always true for grep results, which never claim to be the whole trace) and totalLines, so a range can be chosen from a tail. ${JOB_ID_NOTE}. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: {
          ...MR_TARGET_PROPS, jobId: { type: "number" }, tailLines: { type: "number" }, headLines: { type: "number" },
          fromLine: { type: "number" }, lineCount: { type: "number" }, grep: { type: "string" }, contextLines: { type: "number" },
        },
        required: ["jobId"],
        additionalProperties: false,
      },
      shellForms: ["glab ci trace"],
      async handler(input) {
        if (input.jobId === undefined) return err('"jobId" is required');
        const bad = checkPositiveInts(input, ["jobId", "tailLines", "headLines", "fromLine", "lineCount"]) ?? checkOptional(input, [{ name: "grep", type: "string" }, { name: "contextLines", type: "number" }]);
        if (bad) return err(bad);
        const chosen = ["tailLines", "headLines", "fromLine", "grep"].filter((k) => input[k] !== undefined);
        if (chosen.length > 1) return err("pass one of tailLines, headLines, fromLine or grep");
        if (input.lineCount !== undefined && input.fromLine === undefined) return err('"lineCount" needs "fromLine"');
        if (input.contextLines !== undefined && input.grep === undefined) return err('"contextLines" needs "grep"');
        const context = (input.contextLines as number | undefined) ?? 2;
        if (!(Number.isInteger(context) && context >= 0 && context <= 50)) return err('"contextLines" must be an integer from 0 to 50');
        if (typeof input.grep === "string" && !input.grep.trim()) return err('"grep" must not be empty');
        const mode: TraceMode =
          input.headLines !== undefined ? { kind: "head", lines: input.headLines as number }
          : input.fromLine !== undefined ? { kind: "range", from: input.fromLine as number, count: (input.lineCount as number | undefined) ?? TRACE_TAIL_LINES }
          : typeof input.grep === "string" ? { kind: "grep", pattern: input.grep, context }
          : { kind: "tail", lines: (input.tailLines as number | undefined) ?? TRACE_TAIL_LINES };
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const r = await deps.command<Commands["mr:fetch-job-trace"]["data"]>("mr:fetch-job-trace", { repoName: target.identity, iid: target.iid, jobId: input.jobId as number }, { timeoutMs: 60_000 });
        if (!r.ok) return err(explainError(r.error ?? "trace failed"));
        return ok(sliceTrace(r.data ?? "", mode));
      },
    },
  ];
}
