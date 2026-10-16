import { rtCommand } from "../../packages/rt-client/src/index.ts";
import type { ForgeGetData } from "../../packages/rt-client/src/commands.ts";
import type { BridgeRow, FailedJobs, ForgeJob, ForgePipeline, TriageForge } from "./triage.ts";

export type Command = typeof rtCommand;

export interface WalkBridge {
  name: string;
  status: string;
  allowFailure: boolean;
  blocking: boolean;
  downstream: { projectId: number; pipelineId: number; status: string; webUrl: string | null } | null;
  crossProject: boolean;
}

export interface WalkResult {
  pipeline: ForgePipeline;
  jobs: ForgeJob[];
  bridges: WalkBridge[];
  /** Failed same-project bridges whose downstream walk produced no failed job and no such bridge of its own. */
  emptyFailedBridges: WalkBridge[];
}

interface Target { identity: string; iid: number }

const READ_TIMEOUT_MS = 30_000;
const TRACE_TIMEOUT_MS = 60_000;
const PIPELINE_LIST_LIMIT = 20;
const PIPELINE_LIST_MAX = 100;
const FIRST_PER_PAGE = 50;
const SMALLEST_PER_PAGE = 5;
const DROPPED_SOURCES = new Set(["schedule", "external", "parent_pipeline"]);
const INFRA_PATTERNS = ["registry.gitlab.com.*error"];

class GitLabStatusError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// The daemon reports a non-2xx GitLab answer as ok:false with the status only in its text.
function statusOf(error: string): number | null {
  const m = /GitLab returned (\d{3})/.exec(error);
  return m ? Number(m[1]) : null;
}

async function forgeGet(
  command: Command,
  target: Target,
  path: string,
  opts: { query?: Record<string, string | number | boolean>; page?: number; perPage?: number } = {},
): Promise<ForgeGetData> {
  const payload: Record<string, unknown> = { repoName: target.identity, path };
  if (opts.query) payload.query = opts.query;
  if (opts.page !== undefined) payload.page = opts.page;
  if (opts.perPage !== undefined) payload.perPage = opts.perPage;
  const res = await command<ForgeGetData>("forge:get", payload, { timeoutMs: READ_TIMEOUT_MS });
  if (!res.ok || !res.data) {
    const error = res.error ?? "GitLab read failed";
    const status = statusOf(error);
    throw status === null ? new Error(error) : new GitLabStatusError(status, error);
  }
  if (res.data.status < 200 || res.data.status >= 300) {
    throw new GitLabStatusError(res.data.status, `GitLab returned ${res.data.status}`);
  }
  return res.data;
}

async function readPipelinePart(command: Command, target: Target, pipelineId: number, path: string, opts?: Parameters<typeof forgeGet>[3]): Promise<ForgeGetData> {
  try {
    return await forgeGet(command, target, path, opts);
  } catch (e) {
    if (e instanceof GitLabStatusError) throw new GitLabStatusError(e.status, `GitLab ${e.status} reading pipeline ${pipelineId}`);
    throw e;
  }
}

async function readAllPages(command: Command, target: Target, pipelineId: number, path: string, query: Record<string, string | number | boolean>): Promise<unknown[]> {
  let perPage = FIRST_PER_PAGE;
  for (;;) {
    const rows: unknown[] = [];
    let truncated = false;
    let page: number | null = 1;
    while (page !== null) {
      const data = await readPipelinePart(command, target, pipelineId, path, { query, page, perPage });
      if (data.truncated) {
        truncated = true;
        break;
      }
      if (!Array.isArray(data.body)) throw new Error(`GitLab ${path} was not a JSON array`);
      rows.push(...data.body);
      page = data.nextPage;
    }
    if (!truncated) return rows;
    if (perPage <= SMALLEST_PER_PAGE) throw new Error(`GitLab job page still over the 256 KiB read cap at ${SMALLEST_PER_PAGE} per page`);
    perPage = Math.max(SMALLEST_PER_PAGE, Math.floor(perPage / 2));
  }
}

interface RawJob { id: number; name: string; stage?: string; status: string; allow_failure?: boolean; retried?: boolean; web_url?: string | null }
interface RawBridge {
  name: string;
  status: string;
  allow_failure?: boolean;
  pipeline?: { project_id?: number } | null;
  downstream_pipeline?: { id: number; project_id: number; status?: string; web_url?: string | null } | null;
}

function jobRows(raw: RawJob[], pipelineId: number, allowFailureUnder: boolean, scope: string | undefined): ForgeJob[] {
  const retriedRuns = new Map<string, number>();
  for (const j of raw) if (j.retried === true) retriedRuns.set(j.name, (retriedRuns.get(j.name) ?? 0) + 1);
  return raw
    .filter((j) => j.retried !== true && (scope === undefined || j.status === scope))
    .map((j) => ({
      pipelineId,
      jobId: j.id,
      name: j.name,
      stage: j.stage ?? "",
      status: j.status,
      allowFailure: allowFailureUnder || j.allow_failure === true,
      attempt: 1 + (retriedRuns.get(j.name) ?? 0),
      webUrl: j.web_url ?? null,
    }));
}

function bridgeRow(raw: RawBridge, parentProjectId: number | undefined): WalkBridge {
  const d = raw.downstream_pipeline;
  const allowFailure = raw.allow_failure === true;
  const parent = raw.pipeline?.project_id ?? parentProjectId;
  return {
    name: raw.name,
    status: raw.status,
    allowFailure,
    blocking: !allowFailure,
    downstream: d ? { projectId: d.project_id, pipelineId: d.id, status: d.status ?? "", webUrl: d.web_url ?? null } : null,
    crossProject: d ? d.project_id !== parent : false,
  };
}

function asPipeline(body: unknown, id: number): { pipeline: ForgePipeline; projectId: number | undefined } {
  const b = (body ?? {}) as { status?: string; web_url?: string | null; sha?: string | null; ref?: string | null; project_id?: number };
  return {
    pipeline: { id, status: b.status ?? "", webUrl: b.web_url ?? null, sha: b.sha ?? null, ref: b.ref ?? null },
    projectId: b.project_id,
  };
}

async function readPipeline(command: Command, target: Target, id: number): Promise<ReturnType<typeof asPipeline> | null> {
  try {
    const data = await readPipelinePart(command, target, id, `/projects/:id/pipelines/${id}`);
    return asPipeline(data.body, id);
  } catch (e) {
    if (e instanceof GitLabStatusError && e.status === 404) return null;
    throw e;
  }
}

export async function walkPipeline(
  command: Command,
  target: Target,
  pipelineId: number,
  opts: { scope?: string; name?: string } = {},
): Promise<WalkResult | null> {
  const root = await readPipeline(command, target, pipelineId);
  if (!root) return null;

  const rootProjectId = root.projectId;
  const jobs: ForgeJob[] = [];
  const bridges: WalkBridge[] = [];
  const emptyFailedBridges: WalkBridge[] = [];
  const seen = new Set<number>();
  const failedSoFar = () => jobs.filter((j) => j.status === "failed").length + emptyFailedBridges.length;

  async function visit(id: number, allowFailureUnder: boolean): Promise<void> {
    if (seen.has(id)) return;
    seen.add(id);
    // Unscoped on purpose: attempt counts every earlier run, and a scoped read hides the runs of other statuses.
    const rawJobs = (await readAllPages(command, target, id, `/projects/:id/pipelines/${id}/jobs`, { include_retried: true })) as RawJob[];
    jobs.push(...jobRows(rawJobs, id, allowFailureUnder, opts.scope || undefined));
    const rawBridges = (await readAllPages(command, target, id, `/projects/:id/pipelines/${id}/bridges`, {})) as RawBridge[];
    for (const raw of rawBridges) {
      const bridge = bridgeRow(raw, rootProjectId);
      bridges.push(bridge);
      if (bridge.downstream && !bridge.crossProject && !seen.has(bridge.downstream.pipelineId)) {
        const before = failedSoFar();
        await visit(bridge.downstream.pipelineId, allowFailureUnder || bridge.allowFailure || bridge.status === "success");
        if (bridge.status === "failed" && !bridge.allowFailure && failedSoFar() === before) {
          emptyFailedBridges.push({ ...bridge, blocking: !allowFailureUnder });
        }
      }
    }
  }

  await visit(pipelineId, false);
  const name = opts.name;
  return { pipeline: root.pipeline, jobs: name ? jobs.filter((j) => j.name.includes(name)) : jobs, bridges, emptyFailedBridges };
}

function asFailedJobs(walk: WalkResult): FailedJobs {
  const crossProject: BridgeRow[] = [];
  const reported = walk.bridges.filter((b) => b.status === "failed" && !(b.downstream && !b.crossProject));
  for (const b of [...reported, ...walk.emptyFailedBridges]) {
    const d = b.downstream;
    crossProject.push({
      name: b.name,
      status: b.status,
      blocking: b.blocking,
      downstream: d ? { projectId: d.projectId, pipelineId: d.pipelineId, webUrl: d.webUrl } : null,
    });
  }
  return { jobs: walk.jobs, crossProject };
}

export function gitlabTriageForge(command: Command, target: Target): TriageForge {
  return {
    async pipelinesForRef(ref, limit) {
      const res = await command<{ pipelines: Array<{ id: number; status: string; webUrl: string | null; source: string | null }> }>(
        "pipeline:list",
        { repoName: target.identity, ref, limit: Math.min(PIPELINE_LIST_MAX, Math.max(PIPELINE_LIST_LIMIT, limit)) },
        { timeoutMs: READ_TIMEOUT_MS },
      );
      if (!res.ok || !res.data) {
        const error = res.error ?? "pipeline listing failed";
        if (statusOf(error) === 404) return null;
        throw new Error(error);
      }
      return res.data.pipelines
        .filter((p) => p.source === null || !DROPPED_SOURCES.has(p.source))
        .slice(0, limit)
        .map((p) => ({ id: p.id, status: p.status, webUrl: p.webUrl }));
    },
    async pipelineInfo(id) {
      return (await readPipeline(command, target, id))?.pipeline ?? null;
    },
    async failedJobs(id) {
      const walk = await walkPipeline(command, target, id, { scope: "failed" });
      return walk ? asFailedJobs(walk) : null;
    },
    async trace(jobId) {
      const res = await command<string>("mr:fetch-job-trace", { repoName: target.identity, iid: target.iid, jobId }, { timeoutMs: TRACE_TIMEOUT_MS });
      if (!res.ok || typeof res.data !== "string") return { ok: false, error: res.error ?? "trace read failed" };
      return { ok: true, text: res.data };
    },
    async defaultBranch() {
      const data = await forgeGet(command, target, "/projects/:id");
      const branch = (data.body as { default_branch?: string | null } | null)?.default_branch;
      return typeof branch === "string" && branch !== "" ? branch : null;
    },
    infraPatterns() {
      return [...INFRA_PATTERNS];
    },
  };
}
