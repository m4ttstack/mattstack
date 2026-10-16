import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { StageEntry } from "./types";

export const PIPELINES_REL = "pack/pipelines.json";

export type PipelineStage = { stage: string; name: string; file: string; consumes: string[]; produces: string[] };
export type PipelinesManifest = { version: 1; pipelines: Record<string, PipelineStage[]> };

const DIR_PREFIX = "${CLAUDE_SKILL_DIR}/../../";

function stageFile(entry: StageEntry): string {
  const rel = entry.dir.startsWith(DIR_PREFIX) ? entry.dir.slice(DIR_PREFIX.length) : entry.dir;
  return `${rel}/SKILL.md`;
}

export function renderPipelinesManifest(entries: Record<string, StageEntry[]>): string | null {
  const pipelines: Record<string, PipelineStage[]> = {};
  for (const [name, stages] of Object.entries(entries)) {
    if (stages.length === 0) continue;
    pipelines[name] = stages.map((e) => ({
      stage: e.stage, name: e.name, file: stageFile(e), consumes: e.consumes, produces: e.produces,
    }));
  }
  if (Object.keys(pipelines).length === 0) return null;
  const manifest: PipelinesManifest = { version: 1, pipelines };
  return JSON.stringify(manifest, null, 2) + "\n";
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

function escapesPackRoot(file: string): boolean {
  return file.startsWith("/") || /^[A-Za-z]:/.test(file) || file.split(/[\\/]/).includes("..");
}

export function parsePipelinesManifest(
  text: string,
): { ok: true; manifest: PipelinesManifest } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `${PIPELINES_REL} is not valid JSON: ${(e as Error).message}` };
  }
  const bad = (error: string) => ({ ok: false as const, error: `${PIPELINES_REL}: ${error}` });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return bad("expected an object");
  const top = raw as Record<string, unknown>;
  if (top.version !== 1) return bad(`unknown version ${JSON.stringify(top.version)}`);
  const rawPipelines = top.pipelines;
  if (typeof rawPipelines !== "object" || rawPipelines === null || Array.isArray(rawPipelines)) {
    return bad("pipelines must be an object");
  }
  const pipelines: Record<string, PipelineStage[]> = {};
  for (const [pipeline, stages] of Object.entries(rawPipelines)) {
    if (!Array.isArray(stages)) return bad(`pipeline "${pipeline}" must be an array`);
    const out: PipelineStage[] = [];
    for (const [i, s] of stages.entries()) {
      const where = `pipeline "${pipeline}" stage ${i}`;
      if (typeof s !== "object" || s === null) return bad(`${where} must be an object`);
      const st = s as Record<string, unknown>;
      if (typeof st.stage !== "string") return bad(`${where} needs a string stage`);
      if (typeof st.name !== "string") return bad(`${where} needs a string name`);
      if (typeof st.file !== "string") return bad(`${where} needs a string file`);
      if (escapesPackRoot(st.file)) return bad(`${where} file "${st.file}" must stay inside the pack root`);
      if (!isStrings(st.consumes)) return bad(`${where} consumes must be an array of strings`);
      if (!isStrings(st.produces)) return bad(`${where} produces must be an array of strings`);
      out.push({ stage: st.stage, name: st.name, file: st.file, consumes: st.consumes, produces: st.produces });
    }
    pipelines[pipeline] = out;
  }
  return { ok: true, manifest: { version: 1, pipelines } };
}

export function pipelinesWrite(
  resolved: { packDir: string; stageEntries: Record<string, StageEntry[]> },
  readFile: (path: string) => string | null,
  write: boolean,
): { written: string[]; removed: string[]; stale: boolean } {
  const target = join(resolved.packDir, PIPELINES_REL);
  const current = readFile(target);
  const want = renderPipelinesManifest(resolved.stageEntries);
  if (want === current) return { written: [], removed: [], stale: false };
  if (!write) return { written: [], removed: [], stale: true };
  if (want === null) {
    rmSync(target, { force: true });
    return { written: [], removed: [PIPELINES_REL], stale: false };
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, want);
  return { written: [PIPELINES_REL], removed: [], stale: false };
}
