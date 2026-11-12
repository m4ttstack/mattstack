import type { Pipeline, PipelineJob } from "@mattstack/glance";
import type { rtCommand } from "../../packages/rt-client/src/index.ts";
import type { ForgeGetData, PipelineListRow } from "../../packages/rt-client/src/commands.ts";
import { shaMatches } from "./watch.ts";

export interface GithubJob {
  id: string;
  jobId: number | null;
  name: string;
  status: string;
  blocking: boolean;
  runId: number | null;
  webUrl: string | null;
}

export interface GithubCommitFacts {
  required: string[] | null;
  requiredTries: number;
  anchor: { runId: number | null; createdAt: number } | null;
  anchorTries: number;
  confirm: { at: number; open: boolean } | null;
}

export interface GithubHead {
  id: string;
  number: number;
  status: string;
  sha: string | null;
  ref: string | null;
  webUrl: string | null;
  createdAt: string | null;
  jobs: GithubJob[];
  allBlock: boolean;
}

export const GITHUB_INFRA_PATTERNS: readonly string[] = [
  "The runner has received a shutdown signal",
  "lost communication with the server",
  "The hosted runner encountered an error",
  "exceeded the maximum execution time",
];

const CHECK_ID_PREFIX = "github:check:";
const RUN_ID_PREFIX = "github:run:";

export function emptyFacts(): GithubCommitFacts {
  return { required: null, requiredTries: 0, anchor: null, anchorTries: 0, confirm: null };
}

export function restJobStatus(status: string | null, conclusion: string | null): string {
  if (status === "in_progress") return "running";
  if (status !== "completed") return "pending";
  switch (conclusion) {
    case "success":
    case "neutral":
      return "success";
    case "failure":
    case "timed_out":
    case "stale":
    case "startup_failure":
      return "failed";
    case "cancelled":
      return "canceled";
    case "skipped":
      return "skipped";
    case "action_required":
      return "manual";
    default:
      return "pending";
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function requiredNames(rules: unknown, branch: unknown): string[] {
  const names = new Set<string>();
  if (Array.isArray(rules)) {
    for (const rule of rules) {
      if (!isRecord(rule) || rule.type !== "required_status_checks") continue;
      const checks = isRecord(rule.parameters) ? rule.parameters.required_status_checks : null;
      if (!Array.isArray(checks)) continue;
      for (const c of checks) {
        if (isRecord(c) && typeof c.context === "string") names.add(c.context);
      }
    }
  }
  if (isRecord(branch) && isRecord(branch.protection) && isRecord(branch.protection.required_status_checks)) {
    const contexts = branch.protection.required_status_checks.contexts;
    if (Array.isArray(contexts)) {
      for (const c of contexts) if (typeof c === "string") names.add(c);
    }
  }
  return [...names].sort();
}

function toGithubJob(j: PipelineJob, blocking: boolean): GithubJob {
  const jobId = j.id.startsWith(CHECK_ID_PREFIX) ? Number(j.id.slice(CHECK_ID_PREFIX.length)) : NaN;
  const runId = j.runId == null ? NaN : Number(j.runId);
  return {
    id: j.id,
    jobId: Number.isSafeInteger(jobId) ? jobId : null,
    name: j.name,
    status: j.status,
    blocking,
    runId: Number.isSafeInteger(runId) ? runId : null,
    webUrl: j.webUrl,
  };
}

function aggregate(statuses: string[]): string {
  for (const s of ["failed", "canceled", "running"]) {
    if (statuses.includes(s)) return s;
  }
  return statuses.every((s) => s === "success" || s === "skipped") ? "success" : "pending";
}

export function buildHead(p: Pipeline, facts: GithubCommitFacts): GithubHead {
  const required = facts.required;
  const hasList = required !== null && required.length > 0;
  let blockingFlags: boolean[];
  if (hasList) {
    const names = new Set(required);
    blockingFlags = p.jobs.map((j) => names.has(j.name));
  } else if (required === null && p.jobs.some((j) => !j.allowFailure)) {
    blockingFlags = p.jobs.map((j) => !j.allowFailure);
  } else {
    blockingFlags = p.jobs.map(() => true);
  }
  const jobs = p.jobs.map((j, i) => toGithubJob(j, blockingFlags[i]!));
  const allBlock = !hasList && !(required === null && p.jobs.some((j) => !j.allowFailure));

  const statuses = jobs.filter((j) => j.blocking).map((j) => j.status);
  if (hasList) {
    const seen = new Set(jobs.map((j) => j.name));
    for (const name of required) if (!seen.has(name)) statuses.push("pending");
  }
  let status = statuses.length > 0 ? aggregate(statuses) : p.status;
  if (allBlock && status === "success" && facts.confirm?.open) status = "running";

  const anchor = facts.anchor;
  const runId = anchor?.runId ?? null;
  return {
    id: runId !== null ? `${RUN_ID_PREFIX}${runId}` : p.id,
    number: runId ?? 0,
    status,
    sha: p.sha ?? null,
    ref: p.ref ?? null,
    webUrl: p.webUrl,
    createdAt: anchor ? new Date(anchor.createdAt).toISOString() : null,
    jobs,
    allBlock,
  };
}

export const CONFIRM_EVERY_MS = 300_000;
export const REQUIRED_TRIES = 3;
export const ANCHOR_TRIES = 3;

const READ_TIMEOUT_MS = 30_000;
const RUN_LIST_LIMIT = 100;
const COMPLETED_RUN_STATUSES = new Set(["success", "failed", "canceled", "skipped", "manual"]);

export interface FactsStore {
  get(): GithubCommitFacts;
  set(f: GithubCommitFacts): void;
}

const memory = new Map<string, GithubCommitFacts>();

export function memoryFacts(key: string): FactsStore {
  return {
    get: () => structuredClone(memory.get(key) ?? emptyFacts()),
    set: (f) => { memory.set(key, structuredClone(f)); },
  };
}

export function __resetMemoryFacts(): void {
  memory.clear();
}

export interface GithubTarget {
  identity: string;
  iid: number;
}

type ForgeAnswer = { ok: true; body: unknown } | { ok: false };

// The daemon reports a non-2xx GitHub answer either as ok:false with the status only in its text or as data.status.
function githubStatusOf(error: string): number | null {
  const m = /GitHub returned (\d{3})/.exec(error);
  return m ? Number(m[1]) : null;
}

export class GithubHeadReader {
  constructor(
    private readonly command: typeof rtCommand,
    private readonly target: GithubTarget,
    private readonly store: FactsStore,
    private readonly now: () => number,
  ) {}

  async read(
    mr: { sha: string | null; targetBranch: string | null; pipeline: Pipeline | null },
    watchedSha: string | null,
  ): Promise<GithubHead | null> {
    const p = mr.pipeline;
    if (!p) return null;
    const onWatched = mr.sha !== null && watchedSha !== null && shaMatches(mr.sha, watchedSha);
    if (!onWatched) return buildHead(p, emptyFacts());

    const facts = this.store.get();
    const sha = mr.sha!;
    let rows: PipelineListRow[] | null = null;

    if (facts.required === null && facts.requiredTries < REQUIRED_TRIES && mr.targetBranch) {
      const branch = encodeURIComponent(mr.targetBranch);
      const [rules, protection] = await Promise.all([
        this.forgeGet(`:repo/rules/branches/${branch}`),
        this.forgeGet(`:repo/branches/${branch}`),
      ]);
      facts.requiredTries += 1;
      if (rules.ok && protection.ok) facts.required = requiredNames(rules.body, protection.body);
      this.store.set(facts);
    }

    if (p.jobs.length > 0) {
      if (facts.anchor === null) {
        facts.anchor = { runId: null, createdAt: this.now() };
        this.store.set(facts);
      }
      if (facts.anchor.runId === null && facts.anchorTries < ANCHOR_TRIES && p.jobs.some((j) => j.runId)) {
        rows = await this.listRuns(p.ref ?? null, sha);
        facts.anchorTries += 1;
        const earliest = rows ? earliestRun(rows) : null;
        if (earliest) facts.anchor = earliest;
        this.store.set(facts);
      }
    }

    const raw = buildHead(p, { ...facts, confirm: null });
    if (raw.allBlock && raw.status === "success") {
      const due = facts.confirm === null || this.now() - facts.confirm.at >= CONFIRM_EVERY_MS;
      if (due) {
        rows ??= await this.listRuns(p.ref ?? null, sha);
        facts.confirm = {
          at: this.now(),
          open: rows ? rows.some((r) => !COMPLETED_RUN_STATUSES.has(r.status)) : (facts.confirm?.open ?? false),
        };
        this.store.set(facts);
      }
    }

    return buildHead(p, facts);
  }

  private async forgeGet(path: string): Promise<ForgeAnswer> {
    const res = await this.command<ForgeGetData>(
      "forge:get",
      { repoName: this.target.identity, path },
      { timeoutMs: READ_TIMEOUT_MS },
    );
    if (!res.ok || !res.data) {
      return githubStatusOf(res.error ?? "") === 404 ? { ok: true, body: null } : { ok: false };
    }
    if (res.data.status === 404) return { ok: true, body: null };
    if (res.data.status < 200 || res.data.status >= 300) return { ok: false };
    return { ok: true, body: res.data.body };
  }

  private async listRuns(ref: string | null, sha: string): Promise<PipelineListRow[] | null> {
    const payload: Record<string, unknown> = { repoName: this.target.identity };
    if (ref !== null) payload.ref = ref;
    payload.sha = sha;
    payload.limit = RUN_LIST_LIMIT;
    const res = await this.command<{ pipelines: PipelineListRow[] }>("pipeline:list", payload, { timeoutMs: READ_TIMEOUT_MS });
    if (!res.ok || !res.data || !Array.isArray(res.data.pipelines)) return null;
    return res.data.pipelines;
  }
}

function earliestRun(rows: PipelineListRow[]): { runId: number; createdAt: number } | null {
  let best: { runId: number; createdAt: number } | null = null;
  for (const r of rows) {
    const at = r.createdAt === null ? NaN : Date.parse(r.createdAt);
    if (!Number.isFinite(at) || !Number.isSafeInteger(r.id)) continue;
    if (best === null || at < best.createdAt || (at === best.createdAt && r.id < best.runId)) {
      best = { runId: r.id, createdAt: at };
    }
  }
  return best;
}
