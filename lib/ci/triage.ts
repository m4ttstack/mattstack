import { sliceTrace } from "../mcp/trace-slice.ts";
import { classifyTrace, isNoisy, stripAnsi, type Verdict } from "./triage-classify.ts";
import { compilePatterns, type CompiledPatterns, type TriageConfig } from "./triage-config.ts";

export interface ForgePipeline { id: number; status: string; webUrl: string | null; sha: string | null; ref: string | null }
export interface ForgeJob { pipelineId: number; jobId: number; name: string; stage: string; status: string; allowFailure: boolean; attempt: number; webUrl: string | null }
export interface BridgeRow { name: string; status: string; blocking: boolean; downstream: { projectId: number; pipelineId: number; webUrl: string | null } | null }
export interface FailedJobs { jobs: ForgeJob[]; crossProject: BridgeRow[] }

export interface TriageForge {
  pipelinesForRef(ref: string, limit: number): Promise<Array<{ id: number; status: string; webUrl: string | null }> | null>;
  pipelineInfo(id: number): Promise<ForgePipeline | null>;
  failedJobs(id: number): Promise<FailedJobs | null>;
  trace(jobId: number): Promise<{ ok: true; text: string } | { ok: false; error: string }>;
  defaultBranch(): Promise<string | null>;
  infraPatterns(): string[];
}

export interface TriageInput { pipelineId: number; targetBranch: string | null; base?: string; noBase?: boolean; config: TriageConfig }

export type Ownership = "yours" | "INHERITED" | "UNKNOWN";

export interface JobVerdict {
  jobId: number;
  name: string;
  stage: string;
  pipelineId: number;
  attempt: number;
  blocking: boolean;
  noisy: boolean;
  verdict: Verdict;
  ownership: Ownership;
  ownershipNote: string;
  inheritedOn: string[];
  realHits: string[];
  infraHits: string[];
  traceAvailable: boolean;
  traceError?: string;
  traceTail: string;
}

export interface TriageReport {
  pipeline: ForgePipeline;
  base: { refs: string[]; scanned: number; off: boolean };
  blocking: JobVerdict[];
  nonBlocking: JobVerdict[];
  crossProject: BridgeRow[];
  summary: {
    blocking: number;
    blockingYours: number;
    blockingInherited: number;
    blockingUnknown: number;
    nonBlocking: number;
    noisy: string[];
    allInfraBlocking: boolean;
  };
}

const DEFAULT_CONCURRENCY = 4;
const TAIL_LINES = 40;
const FALLBACK_BRANCH = "master";

interface BaseIndex {
  refs: string[];
  scanned: number;
  off: boolean;
  failingOn: Map<string, Set<string>>;
}

function present(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === "" ? null : value;
}

async function baseRefs(forge: TriageForge, input: TriageInput): Promise<string[]> {
  const defaultBranch = present(await forge.defaultBranch()) ?? FALLBACK_BRANCH;
  const primary = present(input.base) ?? present(input.config.baseRef) ?? present(input.targetBranch) ?? defaultBranch;
  return primary === defaultBranch ? [primary] : [primary, defaultBranch];
}

async function indexBase(forge: TriageForge, input: TriageInput): Promise<BaseIndex> {
  const failingOn = new Map<string, Set<string>>();
  if (input.noBase === true || input.config.skipBase) return { refs: [], scanned: 0, off: true, failingOn };

  const refs = await baseRefs(forge, input);
  const depth = input.config.baseDepth;
  let scanned = 0;
  for (const ref of refs) {
    const rows = await forge.pipelinesForRef(ref, depth + 1);
    if (!rows) continue;
    const window = rows.filter((p) => p.id !== input.pipelineId).slice(0, depth);
    for (const pipeline of window) {
      const failed = await forge.failedJobs(pipeline.id);
      if (!failed) continue;
      scanned += 1;
      for (const j of failed.jobs) {
        const on = failingOn.get(j.name) ?? new Set<string>();
        on.add(ref);
        failingOn.set(j.name, on);
      }
    }
  }
  return { refs, scanned, off: false, failingOn };
}

function ownershipOf(name: string, base: BaseIndex): { ownership: Ownership; ownershipNote: string; inheritedOn: string[] } {
  if (base.off) return { ownership: "UNKNOWN", ownershipNote: "base comparison off", inheritedOn: [] };
  if (base.scanned === 0) return { ownership: "UNKNOWN", ownershipNote: "no base pipelines scanned", inheritedOn: [] };
  const on = base.failingOn.get(name);
  if (!on) return { ownership: "yours", ownershipNote: "not failing on base", inheritedOn: [] };
  const refs = [...on].sort();
  return { ownership: "INHERITED", ownershipNote: `also failing on ${refs.join(",")}`, inheritedOn: refs };
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

// Classification reads SGR-stripped lines to stay faithful to the shell; a hit shown to a caller drops every escape.
function displayHit(hit: string): string {
  return sliceTrace(hit, { kind: "head", lines: 1 }).trace;
}

async function judgeJob(
  forge: TriageForge,
  job: ForgeJob,
  patterns: CompiledPatterns,
  config: TriageConfig,
  base: BaseIndex,
  onProgress?: () => void,
): Promise<JobVerdict> {
  const trace = await forge.trace(job.jobId);
  onProgress?.();
  const common = {
    jobId: job.jobId,
    name: job.name,
    stage: job.stage,
    pipelineId: job.pipelineId,
    attempt: job.attempt,
    blocking: !job.allowFailure,
    noisy: isNoisy(job.name, job.allowFailure, config.noisyJobs),
    ...ownershipOf(job.name, base),
  };
  if (!trace.ok) {
    return { ...common, verdict: "UNCLEAR", realHits: [], infraHits: [], traceAvailable: false, traceError: trace.error, traceTail: "" };
  }
  const { verdict, realHits, infraHits } = classifyTrace(trace.text, patterns);
  return {
    ...common,
    verdict,
    realHits: realHits.map(displayHit),
    infraHits: infraHits.map(displayHit),
    traceAvailable: true,
    traceTail: sliceTrace(stripAnsi(trace.text), { kind: "tail", lines: TAIL_LINES }).trace,
  };
}

async function triage(
  forge: TriageForge,
  input: TriageInput,
  opts: { concurrency?: number; onProgress?: () => void },
): Promise<TriageReport | { error: string }> {
  const patterns = compilePatterns(input.config, forge.infraPatterns());
  if ("error" in patterns) return patterns;

  const notFound = { error: `pipeline ${input.pipelineId} not found` };
  const pipeline = await forge.pipelineInfo(input.pipelineId);
  if (!pipeline) return notFound;
  const failed = await forge.failedJobs(input.pipelineId);
  if (!failed) return notFound;

  const base = await indexBase(forge, input);
  const verdicts = await mapLimited(failed.jobs, opts.concurrency ?? DEFAULT_CONCURRENCY, (job) =>
    judgeJob(forge, job, patterns, input.config, base, opts.onProgress),
  );
  const blocking = verdicts.filter((v) => v.blocking);
  const nonBlocking = verdicts.filter((v) => !v.blocking);
  const count = (o: Ownership): number => blocking.filter((v) => v.ownership === o).length;

  return {
    pipeline,
    base: { refs: base.refs, scanned: base.scanned, off: base.off },
    blocking,
    nonBlocking,
    crossProject: failed.crossProject,
    summary: {
      blocking: blocking.length,
      blockingYours: count("yours"),
      blockingInherited: count("INHERITED"),
      blockingUnknown: count("UNKNOWN"),
      nonBlocking: nonBlocking.length,
      noisy: nonBlocking.filter((v) => v.noisy).map((v) => v.name),
      allInfraBlocking:
        blocking.length > 0 &&
        blocking.every((v) => v.verdict === "INFRA") &&
        !failed.crossProject.some((b) => b.blocking),
    },
  };
}

export async function runTriage(
  forge: TriageForge,
  input: TriageInput,
  opts: { concurrency?: number; onProgress?: () => void } = {},
): Promise<TriageReport | { error: string }> {
  try {
    return await triage(forge, input, opts);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
