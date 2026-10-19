/**
 * enterRun: start, resume, inherit a run, or list the candidates to choose
 * between. Precedence is handed runDb, then resume, then fresh/spawnedBy start,
 * then candidates. Adopting the session with the daemon is the MCP layer's
 * job; this only records identity in the DB.
 */
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, resolve, sep } from "path";
import { parsePipelinesManifest, PIPELINES_REL } from "../skills/pipeline-manifest.ts";
import { cleared, FailError, failOf, must, positionOf, readManifest, setManifestRoot, writeManifest, type ManifestInput, type Position } from "./engine.ts";
import { recordIdentity } from "./identity.ts";
import { isPathComponent } from "./paths.ts";
import { runStart, type RunStartOpts } from "./start.ts";
import { closedRunMove, fieldSet, openRunDb, stageStart, type Fail, type Ok } from "./write.ts";

export type Candidate = { runId: string; runDb: string; startedAt: number; spawnedBy: string | null; currentStage: string | null; ownSession: boolean };
export type EnterResult =
  | { mode: "inherited"; runDb: string; runId: string; at: Position | null }
  | { mode: "candidates"; candidates: Candidate[]; handedRunDb?: "not-running" }
  | { mode: "resumed"; runDb: string; runId: string; at: Position | null; clearedHold: boolean; handedRunDb?: "not-running" }
  | { mode: "started"; runDb: string; runId: string; at: Position; stages: string[]; handedRunDb?: "not-running" };
export type EnterInput = {
  root: string;
  packRoot: string;
  start: RunStartOpts;
  stage?: string;
  pipeline?: string;
  handedRunDb?: string;
  resume?: string;
  fresh?: boolean;
  env: NodeJS.ProcessEnv;
  now?: number;
};

function refuse(error: string): Fail {
  return { ok: false, error, code: 2 };
}

export function pickManifest(
  packRoot: string,
  o: { stage?: string; pipeline?: string; pipelineFlag: string },
): Ok<{ stages: ManifestInput[] }> | Fail {
  if (o.stage !== undefined) return { ok: true, stages: [{ stage: o.stage, consumes: [], produces: [] }] };
  const path = join(packRoot, PIPELINES_REL);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return refuse(`this pack has no ${PIPELINES_REL}; recompile it with this rt, or pass stage`);
    }
    return refuse(`could not read ${PIPELINES_REL}: ${String(err)}`);
  }
  const parsed = parsePipelinesManifest(text);
  if (!parsed.ok) return refuse(parsed.error);
  const pipelines = parsed.manifest.pipelines;
  const keys = Object.keys(pipelines);
  if (keys.length === 0) return refuse(`${PIPELINES_REL} has no pipelines`);
  let pick: string | undefined;
  if (o.pipeline !== undefined) {
    if (!Object.hasOwn(pipelines, o.pipeline)) return refuse(`pipeline ${o.pipeline} is not in ${PIPELINES_REL} (pipelines: ${keys.join(", ")})`);
    pick = o.pipeline;
  } else if (Object.hasOwn(pipelines, o.pipelineFlag)) {
    pick = o.pipelineFlag;
  } else if (keys.length === 1) {
    pick = keys[0];
  } else {
    return refuse(`${PIPELINES_REL} has several pipelines (${keys.join(", ")}); pass pipeline to choose one`);
  }
  const stages = pipelines[pick!]!;
  if (stages.length === 0) return refuse(`pipeline ${pick} in ${PIPELINES_REL} has no stages`);
  return { ok: true, stages: stages.map((s) => ({ stage: s.stage, name: s.name, file: s.file, consumes: s.consumes, produces: s.produces })) };
}

function positionReadOnly(db: Database, stage: string | null): Position | null {
  if (stage === null) return null;
  try {
    return positionOf(db, stage);
  } catch {
    // A pre-manifest DB has no manifest table; the position is still known.
    const row = db.query("SELECT attempt, status FROM stages WHERE name = ? ORDER BY attempt DESC LIMIT 1").get(stage) as
      | { attempt: number; status: Position["status"] }
      | undefined;
    return row ? { stage, attempt: row.attempt, status: row.status, file: null } : null;
  }
}

type Inherited = { kind: "running"; result: EnterResult } | { kind: "not-running" } | Fail;

function inherit(root: string, repo: string, handed: string): Inherited {
  const path = resolve(handed);
  const base = resolve(root, repo) + sep;
  const rest = path.startsWith(base) ? path.slice(base.length).split(sep) : [];
  if (rest.length !== 2 || !isPathComponent(rest[0]!) || rest[1] !== "state.db") {
    return refuse(`runDb must be ${join(root, repo, "<run id>", "state.db")}`);
  }
  if (!existsSync(path)) return { kind: "not-running" };
  let db: Database;
  try {
    db = new Database(path, { readonly: true });
  } catch {
    return { kind: "not-running" };
  }
  try {
    const run = db.query("SELECT id, status, current_stage FROM runs LIMIT 1").get() as { id: string; status: string; current_stage: string | null } | undefined;
    if (!run || run.status !== "running") return { kind: "not-running" };
    return { kind: "running", result: { mode: "inherited", runDb: path, runId: run.id, at: positionReadOnly(db, run.current_stage) } };
  } catch {
    return { kind: "not-running" };
  } finally {
    db.close();
  }
}

function resumeRun(i: EnterInput, id: string, handedFlag: { handedRunDb?: "not-running" }): Ok<EnterResult> | Fail {
  if (!isPathComponent(id)) return refuse(`resume must be a single path component: ${id}`);
  const runDb = join(i.root, i.start.repo, id, "state.db");
  if (!existsSync(runDb)) return refuse(`no run ${id} in repo ${i.start.repo}`);
  const now = i.now ?? Date.now();
  let db: Database;
  try {
    db = openRunDb(runDb);
  } catch (err) {
    return refuse(`could not open run ${id}: ${String(err)}`);
  }
  try {
    // immediate: the write lock is taken before the checks read, so a run
    // that ends in between cannot be resumed from a stale read.
    return db.transaction((): Ok<EnterResult> | Fail => {
      const refused = (error: string): never => {
        throw new FailError(refuse(error));
      };
      const run = db.query("SELECT id, status, work_type, current_stage FROM runs LIMIT 1").get() as
        | { id: string; status: string; work_type: string; current_stage: string | null }
        | undefined;
      if (!run) return refused(`run ${id} has no run row`);
      if (run.status !== "running") return refused(`run ${id} is ${run.status}; only a running run can be resumed. ${closedRunMove(run.status, runDb)}`);
      if (run.work_type !== i.start.workType) return refused(`run ${id} belongs to work type ${run.work_type}, not ${i.start.workType}`);

      let manifest = readManifest(db);
      let backfilled = false;
      if (manifest.length === 0) {
        const picked = must(pickManifest(i.packRoot, { stage: i.stage, pipeline: i.pipeline, pipelineFlag: i.start.pipeline }));
        const names = new Set(picked.stages.map((s) => s.stage));
        const rows = db.query("SELECT DISTINCT name FROM stages").all() as { name: string }[];
        if (rows.some((r) => !names.has(r.name))) return refused("this run's stages do not match the pack's pipeline; start fresh");
        writeManifest(db, picked.stages, i.stage !== undefined ? null : i.packRoot);
        manifest = readManifest(db);
        backfilled = true;
        const listed = db.query("SELECT 1 FROM fields WHERE key = 'pipeline-stages'").get();
        if (!listed) must(fieldSet(db, "pipeline-stages", picked.stages.map((s) => s.stage).join(" "), picked.stages[0]!.stage, now));
      }

      recordIdentity(db, i.env, now);
      const hold = db.query("SELECT value FROM fields WHERE key = 'hold'").get() as { value: string } | undefined;
      const clearedHold = hold != null && !cleared(hold.value);
      if (!backfilled && manifest.some((m) => m.file !== null)) setManifestRoot(db, i.packRoot);
      let current = run.current_stage;
      if (current === null) {
        const first = manifest[0];
        if (!first) return refused(`run ${id} has no stage to start`);
        must(stageStart(db, first.stage, i.env, now));
        current = first.stage;
      }
      if (clearedHold) must(fieldSet(db, "hold", "-", current, now));
      return { ok: true, mode: "resumed", runDb, runId: run.id, at: positionOf(db, current), clearedHold, ...handedFlag };
    }).immediate();
  } catch (err) {
    return failOf(err);
  } finally {
    db.close();
  }
}

function dirs(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

function scanCandidates(root: string, repo: string, workType: string, session: string | undefined): Candidate[] {
  const out: Candidate[] = [];
  for (const id of dirs(join(root, repo))) {
    const runDb = join(root, repo, id, "state.db");
    if (!existsSync(runDb)) continue;
    let db: Database;
    try {
      db = new Database(runDb, { readonly: true });
    } catch {
      continue;
    }
    try {
      const run = db.query("SELECT id, status, work_type, current_stage, spawned_by, started_at FROM runs LIMIT 1").get() as
        | { id: string; status: string; work_type: string; current_stage: string | null; spawned_by: string | null; started_at: number }
        | undefined;
      if (!run || run.status !== "running" || run.work_type !== workType) continue;
      const own = db.query("SELECT value FROM fields WHERE key = 'claude-session'").get() as { value: string } | undefined;
      out.push({
        runId: run.id,
        runDb,
        startedAt: Number(run.started_at),
        spawnedBy: run.spawned_by,
        currentStage: run.current_stage,
        ownSession: session !== undefined && session !== "" && own?.value === session,
      });
    } catch {
      continue;
    } finally {
      db.close();
    }
  }
  return out.sort((a, b) => b.startedAt - a.startedAt || b.runId.localeCompare(a.runId));
}

function startRun(i: EnterInput, handedFlag: { handedRunDb?: "not-running" }): Ok<EnterResult> | Fail {
  const picked = pickManifest(i.packRoot, { stage: i.stage, pipeline: i.pipeline, pipelineFlag: i.start.pipeline });
  if (!picked.ok) return picked;
  const now = i.now ?? Date.now();
  const started = runStart(i.root, { ...i.start, env: i.env, now });
  if (!started.ok) return started;
  const stages = picked.stages;
  const db = openRunDb(started.runDb);
  try {
    return db.transaction((): Ok<EnterResult> | Fail => {
      writeManifest(db, stages, i.stage !== undefined ? null : i.packRoot);
      must(fieldSet(db, "pipeline-stages", stages.map((s) => s.stage).join(" "), stages[0]!.stage, now));
      must(stageStart(db, stages[0]!.stage, i.env, now));
      return {
        ok: true,
        mode: "started",
        runDb: started.runDb,
        runId: started.runId,
        at: positionOf(db, stages[0]!.stage)!,
        stages: stages.map((s) => s.stage),
        ...handedFlag,
      };
    })();
  } catch (err) {
    return failOf(err);
  } finally {
    db.close();
  }
}

export function enterRun(i: EnterInput): Ok<EnterResult> | Fail {
  if (!isPathComponent(i.start.repo)) return refuse(`--repo must be a single path component: ${i.start.repo}`);
  const handedFlag: { handedRunDb?: "not-running" } = {};
  if (i.handedRunDb !== undefined) {
    const inherited = inherit(i.root, i.start.repo, i.handedRunDb);
    if ("ok" in inherited) return inherited;
    if (inherited.kind === "running") return { ok: true, ...inherited.result };
    handedFlag.handedRunDb = "not-running";
  }
  if (i.resume !== undefined) return resumeRun(i, i.resume, handedFlag);
  if (i.fresh || i.start.spawnedBy) return startRun(i, handedFlag);
  const candidates = scanCandidates(i.root, i.start.repo, i.start.workType, i.env.CLAUDE_CODE_SESSION_ID);
  if (candidates.length === 0) return startRun(i, handedFlag);
  return { ok: true, mode: "candidates", candidates, ...handedFlag };
}
