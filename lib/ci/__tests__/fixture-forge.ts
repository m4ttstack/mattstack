import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ForgeJob, TriageForge } from "../triage.ts";

const DROPPED_SOURCES = new Set(["external", "schedule"]);

interface PipelineRow { id: number; status: string; webUrl: string | null; source: string }

function read(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function rows(text: string): string[][] {
  return text.split("\n").filter((l) => l !== "").map((l) => l.split("\t"));
}

function pipelineRows(scenarioDir: string, ref: string): PipelineRow[] | null {
  const text = read(join(scenarioDir, `pipelines-${ref}.tsv`));
  if (text === null) return null;
  return rows(text).map(([id, status, url, source]) => ({
    id: Number(id),
    status: status ?? "",
    webUrl: url ?? null,
    source: source ?? "",
  }));
}

function kept(all: PipelineRow[]): PipelineRow[] {
  return all.filter((p) => !DROPPED_SOURCES.has(p.source));
}

function targetBranch(scenarioDir: string, ref: string): string | null {
  const text = read(join(scenarioDir, `target-branch-${ref}.txt`))?.trim();
  return text ? text : null;
}

export function resolveRef(scenarioDir: string, ref: string): { pipelineId: number | null; targetBranch: string | null } {
  const all = pipelineRows(scenarioDir, ref) ?? [];
  const head = kept(all)[0] ?? all[0];
  return { pipelineId: head ? head.id : null, targetBranch: targetBranch(scenarioDir, ref) };
}

export function fixtureForge(scenarioDir: string, opts: { defaultBranch: string | null; failWith?: string }): TriageForge {
  const guard = (): void => {
    if (opts.failWith !== undefined) throw new Error(opts.failWith);
  };
  return {
    async pipelinesForRef(ref, limit) {
      guard();
      const all = pipelineRows(scenarioDir, ref);
      if (all === null) return null;
      return kept(all).slice(0, limit).map(({ id, status, webUrl }) => ({ id, status, webUrl }));
    },
    async pipelineInfo(id) {
      guard();
      const text = read(join(scenarioDir, `info-${id}`));
      if (text === null) return null;
      return { id, status: text.split("\n")[0] ?? "", webUrl: `https://fake/pipelines/${id}`, sha: null, ref: null };
    },
    async failedJobs(id) {
      guard();
      const text = read(join(scenarioDir, `jobs-${id}.tsv`));
      if (text === null) return null;
      const jobs: ForgeJob[] = rows(text)
        .filter(([, , , status]) => status === "failed")
        .map(([pid, jid, name, status, flag]) => ({
          pipelineId: Number(pid),
          jobId: Number(jid),
          name: name ?? "",
          stage: "",
          status: status ?? "",
          allowFailure: flag === "allow_failure",
          attempt: 1,
          webUrl: null,
        }));
      return { jobs, crossProject: [] };
    },
    async trace(jobId) {
      guard();
      const text = read(join(scenarioDir, `trace-${jobId}.txt`));
      return text === null ? { ok: false, error: `no trace for job ${jobId}` } : { ok: true, text };
    },
    async defaultBranch() {
      guard();
      return opts.defaultBranch;
    },
    infraPatterns() {
      guard();
      const text = read(join(scenarioDir, "infra-patterns.txt"));
      return text === null ? [] : text.split("\n").filter((l) => l !== "");
    },
  };
}
