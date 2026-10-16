import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { renderPipelinesManifest } from "../../skills/pipeline-manifest.ts";
import { enterRun, pickManifest, type EnterInput, type EnterResult } from "../enter.ts";
import { readManifest } from "../engine.ts";
import { runStart } from "../start.ts";
import { createRunDb, fieldSet, openRunDb, stageEnd, stageStart } from "../write.ts";

const dirs: string[] = [];

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const PREFIX = "${CLAUDE_SKILL_DIR}/../../";
const entry = (stage: string, consumes: string[], produces: string[]) => ({
  name: stage.toUpperCase(), stage, dir: `${PREFIX}skills/${stage}`, consumes, produces,
});
const FEATURE = [entry("plan", [], ["spec"]), entry("build", ["spec"], ["diff"]), entry("ship", ["diff"], [])];

function pack(pipelines: Record<string, ReturnType<typeof entry>[]> = { feature: FEATURE }): string {
  const dir = tmp("rt-enter-pack-");
  mkdirSync(join(dir, "pack"), { recursive: true });
  writeFileSync(join(dir, "pack", "pipelines.json"), renderPipelinesManifest(pipelines)!);
  return dir;
}

function input(root: string, packRoot: string, over: Partial<EnterInput> = {}): EnterInput {
  return {
    root,
    packRoot,
    start: { repo: "demo", workType: "feature", pipeline: "work" },
    env: { CLAUDE_CODE_SESSION_ID: "sess-1" },
    now: 1000,
    ...over,
  };
}

function enter(i: EnterInput): EnterResult {
  const r = enterRun(i);
  if (!r.ok) throw new Error(r.error);
  const { ok: _ok, ...rest } = r;
  return rest as EnterResult;
}

function mustFail(i: EnterInput): string {
  const r = enterRun(i);
  if (r.ok) throw new Error(`expected a refusal, got ${JSON.stringify(r)}`);
  return r.error;
}

function started(root: string, packRoot: string, over: Partial<EnterInput> = {}) {
  const r = enter(input(root, packRoot, { fresh: true, ...over }));
  if (r.mode !== "started") throw new Error(`expected started, got ${r.mode}`);
  return r;
}

function ro<T>(runDb: string, f: (db: Database) => T): T {
  const db = new Database(runDb, { readonly: true });
  try {
    return f(db);
  } finally {
    db.close();
  }
}

describe("pickManifest", () => {
  test("stage gives a one-stage manifest without reading the pack", () => {
    expect(pickManifest("/nowhere", { stage: "verify", pipelineFlag: "work" })).toEqual({
      ok: true,
      stages: [{ stage: "verify", consumes: [], produces: [] }],
    });
  });

  test("pipeline pick: input wins; flag used when it is a key; the only key otherwise; several and none named refused listing keys; missing file refused", () => {
    const two = pack({ feature: FEATURE, fix: [entry("diagnose", [], [])] });
    const names = (r: ReturnType<typeof pickManifest>) => (r.ok ? r.stages.map((s) => s.stage) : r.error);
    expect(names(pickManifest(two, { pipeline: "fix", pipelineFlag: "feature" }))).toEqual(["diagnose"]);
    expect(names(pickManifest(two, { pipelineFlag: "feature" }))).toEqual(["plan", "build", "ship"]);
    expect(names(pickManifest(pack(), { pipelineFlag: "work" }))).toEqual(["plan", "build", "ship"]);

    const several = pickManifest(two, { pipelineFlag: "work" });
    expect(!several.ok && several.error).toContain("feature, fix");
    const unknown = pickManifest(two, { pipeline: "nope", pipelineFlag: "feature" });
    expect(!unknown.ok && unknown.error).toContain("feature, fix");

    const missing = pickManifest(tmp("rt-enter-empty-"), { pipelineFlag: "work" });
    expect(missing).toEqual({ ok: false, error: "this pack has no pack/pipelines.json; recompile it with this rt, or pass stage", code: 2 });
  });

  test("carries name, file, consumes and produces from the pack", () => {
    const r = pickManifest(pack(), { pipelineFlag: "feature" });
    expect(r.ok && r.stages[1]).toEqual({ stage: "build", name: "BUILD", file: "skills/build/SKILL.md", consumes: ["spec"], produces: ["diff"] });
  });
});

describe("start", () => {
  test("start with stage: one-stage manifest, stage running, file null", () => {
    const root = tmp("rt-enter-runs-");
    const r = started(root, tmp("rt-enter-nopack-"), { stage: "verify" });
    expect(r.stages).toEqual(["verify"]);
    expect(r.at).toEqual({ stage: "verify", attempt: 1, status: "running", file: null });
    ro(r.runDb, (db) => {
      expect(readManifest(db).map((m) => [m.stage, m.file, m.packRoot])).toEqual([["verify", null, null]]);
      expect(db.query("SELECT current_stage FROM runs").get()).toEqual({ current_stage: "verify" });
      expect(db.query("SELECT value, produced_by FROM fields WHERE key = 'pipeline-stages'").get()).toEqual({ value: "verify", produced_by: "verify" });
    });
  });

  test("start from pipelines.json: manifest rows, pipeline-stages field, first stage running, at.file under packRoot", () => {
    const root = tmp("rt-enter-runs-");
    const packRoot = pack();
    const r = started(root, packRoot, { start: { repo: "demo", workType: "feature", pipeline: "work", ticket: "ABC-1" } });
    expect(r.stages).toEqual(["plan", "build", "ship"]);
    expect(r.at).toEqual({ stage: "plan", attempt: 1, status: "running", file: join(packRoot, "skills/plan/SKILL.md") });
    ro(r.runDb, (db) => {
      expect(readManifest(db).map((m) => [m.stage, m.packRoot, m.produces])).toEqual([
        ["plan", packRoot, ["spec"]],
        ["build", packRoot, ["diff"]],
        ["ship", packRoot, []],
      ]);
      expect(db.query("SELECT value, produced_by FROM fields WHERE key = 'pipeline-stages'").get()).toEqual({ value: "plan build ship", produced_by: "plan" });
      expect(db.query("SELECT value FROM fields WHERE key = 'claude-session'").get()).toEqual({ value: "sess-1" });
      expect(db.query("SELECT pipeline FROM runs").get()).toEqual({ pipeline: "work" });
      expect(db.query("SELECT value FROM fields WHERE key = 'ticket'").get()).toEqual({ value: "ABC-1" });
    });
  });

  test("a refused pick creates no run", () => {
    const root = tmp("rt-enter-runs-");
    expect(mustFail(input(root, tmp("rt-enter-empty-"), { fresh: true }))).toContain("no pack/pipelines.json");
    expect(() => readFileSync(join(root, "demo"))).toThrow();
  });
});

describe("candidates", () => {
  function seedRunning(root: string, packRoot: string, over: Partial<EnterInput>, session?: string) {
    const r = started(root, packRoot, { env: { CLAUDE_CODE_SESSION_ID: session ?? "other" }, ...over });
    return r;
  }

  test("running runs of the same work type in the repo, newest first, ownSession set; another work type or a finished run excluded; none → starts", () => {
    const root = tmp("rt-enter-runs-");
    const packRoot = pack();
    const none = enter(input(root, packRoot));
    expect(none.mode).toBe("started");

    const older = seedRunning(root, packRoot, { now: 2000, start: { repo: "demo", workType: "feature", pipeline: "work", runId: "run-old", spawnedBy: "boss" } }, "other");
    const newer = seedRunning(root, packRoot, { now: 3000, start: { repo: "demo", workType: "feature", pipeline: "work", runId: "run-new" } }, "sess-1");
    seedRunning(root, packRoot, { now: 4000, start: { repo: "demo", workType: "fix", pipeline: "work", runId: "run-fix" } });
    const done = seedRunning(root, packRoot, { now: 5000, start: { repo: "demo", workType: "feature", pipeline: "work", runId: "run-done" } });
    const db = openRunDb(done.runDb);
    db.run("UPDATE runs SET status = 'done'");
    db.close();

    const r = enter(input(root, packRoot));
    if (r.mode !== "candidates") throw new Error(r.mode);
    const firstRun = none.mode === "started" ? none : null;
    expect(r.candidates.map((c) => c.runId)).toEqual(["run-new", "run-old", firstRun!.runId]);
    expect(r.candidates[0]).toEqual({ runId: "run-new", runDb: newer.runDb, startedAt: 3000, spawnedBy: null, currentStage: "plan", ownSession: true });
    expect(r.candidates[1]).toMatchObject({ runId: "run-old", runDb: older.runDb, spawnedBy: "boss", ownSession: false });
  });

  test("fresh and spawnedBy skip candidates", () => {
    const root = tmp("rt-enter-runs-");
    const packRoot = pack();
    const first = started(root, packRoot);
    expect(enter(input(root, packRoot)).mode).toBe("candidates");
    const fresh = enter(input(root, packRoot, { fresh: true }));
    expect(fresh.mode).toBe("started");
    const spawned = enter(input(root, packRoot, { start: { repo: "demo", workType: "feature", pipeline: "work", spawnedBy: "boss" } }));
    expect(spawned.mode).toBe("started");
    expect(fresh.mode === "started" && fresh.runId).not.toBe(first.runId);
  });

  test("an unsafe repo is refused", () => {
    expect(mustFail(input(tmp("rt-enter-runs-"), pack(), { start: { repo: "../x", workType: "feature", pipeline: "work" } }))).toContain("--repo");
  });
});

describe("handed runDb", () => {
  test("inherited: a handed running runDb returns its position and writes nothing (db bytes unchanged)", () => {
    const root = tmp("rt-enter-runs-");
    const packRoot = pack();
    const run = started(root, packRoot);
    const before = readFileSync(run.runDb);
    const r = enter(input(root, packRoot, { handedRunDb: run.runDb, resume: "ignored-since-inherited" }));
    expect(r).toEqual({ mode: "inherited", runDb: run.runDb, runId: run.runId, at: run.at });
    expect(readFileSync(run.runDb).equals(before)).toBe(true);
  });

  test("a handed run that is not running is ignored and flagged handedRunDb: not-running", () => {
    const root = tmp("rt-enter-runs-");
    const packRoot = pack();
    const finished = started(root, packRoot);
    const db = openRunDb(finished.runDb);
    db.run("UPDATE runs SET status = 'done'");
    db.close();
    const r = enter(input(root, packRoot, { handedRunDb: finished.runDb }));
    expect(r.mode).toBe("started");
    expect(r.mode === "started" && r.handedRunDb).toBe("not-running");
    expect(r.mode === "started" && r.runId).not.toBe(finished.runId);
  });

  test("a handed runDb outside the repo's runs dir is refused", () => {
    const root = tmp("rt-enter-runs-");
    expect(mustFail(input(root, pack(), { handedRunDb: join(tmp("rt-enter-elsewhere-"), "x", "state.db") }))).toContain("runDb must be");
  });
});

describe("resume", () => {
  test("resume adopts the running attempt (no new row), clears hold, records claude-session, rewrites pack_root", () => {
    const root = tmp("rt-enter-runs-");
    const oldPack = pack();
    const run = started(root, oldPack, { env: { CLAUDE_CODE_SESSION_ID: "sess-old" } });
    const db = openRunDb(run.runDb);
    fieldSet(db, "hold", "waiting on infra", "plan", 1500);
    db.close();

    const newPack = pack();
    const r = enter(input(root, newPack, { resume: run.runId, now: 2000 }));
    expect(r).toEqual({
      mode: "resumed",
      runDb: run.runDb,
      runId: run.runId,
      at: { stage: "plan", attempt: 1, status: "running", file: join(newPack, "skills/plan/SKILL.md") },
      clearedHold: true,
    });
    ro(run.runDb, (d) => {
      expect(d.query("SELECT COUNT(*) AS n FROM stages").get()).toEqual({ n: 1 });
      expect(d.query("SELECT value FROM fields WHERE key = 'hold'").get()).toEqual({ value: "-" });
      expect(d.query("SELECT value FROM fields WHERE key = 'claude-session'").get()).toEqual({ value: "sess-1" });
      expect(d.query("SELECT DISTINCT pack_root FROM manifest").all()).toEqual([{ pack_root: newPack }]);
    });
  });

  test("resume with no hold set reports clearedHold false and writes no hold row", () => {
    const root = tmp("rt-enter-runs-");
    const packRoot = pack();
    const run = started(root, packRoot);
    const r = enter(input(root, packRoot, { resume: run.runId }));
    expect(r.mode === "resumed" && r.clearedHold).toBe(false);
    ro(run.runDb, (d) => expect(d.query("SELECT COUNT(*) AS n FROM fields WHERE key = 'hold'").get()).toEqual({ n: 0 }));
  });

  test("resume returns a failed row as is", () => {
    const root = tmp("rt-enter-runs-");
    const packRoot = pack();
    const run = started(root, packRoot);
    const db = openRunDb(run.runDb);
    stageEnd(db, "plan", "failed", { reason: "boom" });
    db.close();
    const r = enter(input(root, packRoot, { resume: run.runId }));
    expect(r.mode === "resumed" && r.at).toMatchObject({ stage: "plan", attempt: 1, status: "failed" });
    ro(run.runDb, (d) => expect(d.query("SELECT COUNT(*) AS n FROM stages").get()).toEqual({ n: 1 }));
  });

  test("resume refuses a missing run, a finished run, another work type, a bad id (../x)", () => {
    const root = tmp("rt-enter-runs-");
    const packRoot = pack();
    const run = started(root, packRoot);
    expect(mustFail(input(root, packRoot, { resume: "nope" }))).toContain("no run nope");
    expect(mustFail(input(root, packRoot, { resume: "../x" }))).toContain("single path component");
    expect(mustFail(input(root, packRoot, { resume: run.runId, start: { repo: "demo", workType: "fix", pipeline: "work" } }))).toContain("belongs to work type feature");
    const db = openRunDb(run.runDb);
    db.run("UPDATE runs SET status = 'done'");
    db.close();
    expect(mustFail(input(root, packRoot, { resume: run.runId }))).toContain("only a running run can be resumed");
  });

  test("resume backfills a missing manifest from the pack; refuses when the run's stages are not in it", () => {
    const root = tmp("rt-enter-runs-");
    const packRoot = pack();
    const bare = runStart(root, { repo: "demo", workType: "feature", pipeline: "work", env: {}, now: 10 });
    if (!bare.ok) throw new Error(bare.error);
    let db = openRunDb(bare.runDb);
    stageStart(db, "plan", {}, 11);
    db.close();

    const r = enter(input(root, packRoot, { resume: bare.runId }));
    expect(r.mode === "resumed" && r.at).toEqual({ stage: "plan", attempt: 1, status: "running", file: join(packRoot, "skills/plan/SKILL.md") });
    ro(bare.runDb, (d) => expect(readManifest(d).map((m) => m.stage)).toEqual(["plan", "build", "ship"]));

    const odd = runStart(root, { repo: "demo", workType: "feature", pipeline: "work", env: {}, now: 20 });
    if (!odd.ok) throw new Error(odd.error);
    db = openRunDb(odd.runDb);
    stageStart(db, "mystery", {}, 21);
    db.close();
    expect(mustFail(input(root, packRoot, { resume: odd.runId }))).toBe("this run's stages do not match the pack's pipeline; start fresh");
    ro(odd.runDb, (d) => expect(readManifest(d)).toEqual([]));
  });

  test("resume of a run with no current stage starts the first manifest stage", () => {
    const root = tmp("rt-enter-runs-");
    const packRoot = pack();
    const crashed = runStart(root, { repo: "demo", workType: "feature", pipeline: "work", env: {}, now: 10 });
    if (!crashed.ok) throw new Error(crashed.error);
    const r = enter(input(root, packRoot, { resume: crashed.runId }));
    expect(r.mode === "resumed" && r.at).toEqual({ stage: "plan", attempt: 1, status: "running", file: join(packRoot, "skills/plan/SKILL.md") });
    ro(crashed.runDb, (d) => expect(d.query("SELECT current_stage FROM runs").get()).toEqual({ current_stage: "plan" }));
  });

  test("a refused backfill leaves the DB as it was", () => {
    const root = tmp("rt-enter-runs-");
    const bare = runStart(root, { repo: "demo", workType: "feature", pipeline: "work", env: {}, now: 10 });
    if (!bare.ok) throw new Error(bare.error);
    const err = mustFail(input(root, tmp("rt-enter-empty-"), { resume: bare.runId }));
    expect(err).toContain("no pack/pipelines.json");
    ro(bare.runDb, (d) => expect(d.query("SELECT COUNT(*) AS n FROM fields WHERE key = 'claude-session'").get()).toEqual({ n: 0 }));
  });
});

describe("repo confinement", () => {
  function decoy(): { root: string; runDb: string; before: Buffer } {
    const base = tmp("rt-enter-escape-");
    const root = join(base, "runs");
    mkdirSync(root);
    const runDb = join(base, "x", "victim", "state.db");
    mkdirSync(join(base, "x", "victim"), { recursive: true });
    const db = createRunDb(runDb);
    db.run("INSERT INTO runs (id, repo, work_type, pipeline, status, started_at) VALUES ('victim','x','feature','work','running',1)");
    db.run("INSERT INTO fields (run_id, key, value, produced_by, at) VALUES ('victim','hold','stuck','plan',1)");
    db.close();
    return { root, runDb, before: readFileSync(runDb) };
  }
  const escaped = (root: string): Partial<EnterInput> => ({ start: { repo: "../x", workType: "feature", pipeline: "work" }, root });

  test("resume with repo ../x is refused and the run outside the root is untouched", () => {
    const d = decoy();
    expect(mustFail(input(d.root, pack(), { ...escaped(d.root), resume: "victim" }))).toContain("--repo must be a single path component");
    expect(readFileSync(d.runDb).equals(d.before)).toBe(true);
  });

  test("handedRunDb with repo ../x is refused and the run outside the root is untouched", () => {
    const d = decoy();
    expect(mustFail(input(d.root, pack(), { ...escaped(d.root), handedRunDb: d.runDb }))).toContain("--repo must be a single path component");
    expect(readFileSync(d.runDb).equals(d.before)).toBe(true);
  });
});
