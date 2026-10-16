import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { createRunDb, KNOWN_SCHEMA_VERSION, migrate, openRunDb, runStatus, stageStart, stageEnd, fieldSet, fieldGet, decisionRecord, snapshot } from "../write.ts";
import { runStart } from "../start.ts";
import { seedRun } from "./fixtures.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "rt-runs-write-"));
}

function cols(db: Database, table: string): string[] {
  return (db.query(`SELECT name FROM pragma_table_info('${table}')`).all() as { name: string }[]).map((r) => r.name);
}

function userVersion(db: Database): number {
  return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
}

afterEach(() => { delete process.env.RT_RUNS_ROOT; });

describe("createRunDb", () => {
  test("creates the four tables, WAL mode, and stamps the current schema version", () => {
    const path = join(tmp(), "r", "20260901-000000-abcd-1", "state.db");
    const db = createRunDb(path);
    try {
      const tables = (db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
      expect(tables).toEqual(["budgets", "decisions", "fields", "manifest", "runs", "stages"]);
      expect(userVersion(db)).toBe(KNOWN_SCHEMA_VERSION);
      expect(cols(db, "stages")).toContain("reason");
      expect(cols(db, "runs")).toContain("pack_dirty");
      const mode = (db.query("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode;
      expect(mode).toBe("wal");
    } finally {
      db.close();
    }
  });
});

describe("migrate", () => {
  test("brings a v1 DB to the current version in place and is idempotent", () => {
    const root = tmp();
    seedRun(root, "r", "20260901-000000-abcd-1", 1000, 1);
    const path = join(root, "r", "20260901-000000-abcd-1", "state.db");
    const db = openRunDb(path);
    try {
      expect(userVersion(db)).toBe(KNOWN_SCHEMA_VERSION);
      expect(cols(db, "stages")).toContain("detail_path");
      expect(cols(db, "runs")).toContain("pack_commits");
      migrate(db);
      expect(userVersion(db)).toBe(KNOWN_SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });

  test("createRunDb stamps user_version 3 and creates manifest and budgets", () => {
    const db = createRunDb(join(tmp(), "r", "x", "state.db"));
    try {
      expect(KNOWN_SCHEMA_VERSION).toBe(3);
      expect(userVersion(db)).toBe(3);
      expect(cols(db, "manifest")).toEqual(["run_id", "ordinal", "stage", "name", "file", "pack_root", "consumes", "produces"]);
      expect(cols(db, "budgets")).toEqual(["run_id", "key", "spent", "limit", "updated_at"]);
    } finally {
      db.close();
    }
  });

  test("migrate upgrades a v2 db: adds both tables, stamps 3, keeps rows", () => {
    const path = join(tmp(), "r", "x", "state.db");
    mkdirSync(dirname(path), { recursive: true });
    const old = new Database(path);
    old.run(`CREATE TABLE runs (id TEXT PRIMARY KEY, repo TEXT NOT NULL, work_type TEXT NOT NULL, pipeline TEXT NOT NULL, status TEXT NOT NULL, current_stage TEXT, spawned_by TEXT, started_at INTEGER NOT NULL, ended_at INTEGER, pack_commits TEXT, pack_dirty INTEGER DEFAULT 0)`);
    old.run(`CREATE TABLE stages (run_id TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 1, started_at INTEGER, ended_at INTEGER, reason TEXT, detail_path TEXT, PRIMARY KEY (run_id, name, attempt))`);
    old.run("INSERT INTO runs (id, repo, work_type, pipeline, status, started_at) VALUES ('r1','demo','fix','default','running',1)");
    old.run("PRAGMA user_version=2");
    old.close();
    const db = openRunDb(path);
    try {
      expect(userVersion(db)).toBe(3);
      expect(cols(db, "manifest")).toContain("pack_root");
      expect(cols(db, "budgets")).toContain("spent");
      expect(db.query("SELECT id FROM runs").get()).toEqual({ id: "r1" });
    } finally {
      db.close();
    }
  });

  test("openRunDb sets busy_timeout", () => {
    const path = join(tmp(), "r", "x", "state.db");
    createRunDb(path).close();
    const db = openRunDb(path);
    try {
      const t = (db.query("PRAGMA busy_timeout").get() as { timeout: number }).timeout;
      expect(t).toBe(5000);
    } finally {
      db.close();
    }
  });
});

describe("runStatus", () => {
  test("closes the run with the given status; anything else is exit 2", () => {
    const r = runStart(tmp(), { repo: "demo", workType: "fix", pipeline: "default", env: {} });
    if (!r.ok) throw new Error(r.error);
    const db = openRunDb(r.runDb);
    expect(runStatus(db, "done", 9000)).toEqual({ ok: true });
    expect(db.query("SELECT status, ended_at FROM runs").get()).toEqual({ status: "done", ended_at: 9000 });
    expect(runStatus(db, "paused")).toMatchObject({ ok: false, code: 2 });
    db.close();
  });
});

function started(): Database {
  const r = runStart(tmp(), { repo: "demo", workType: "feature", pipeline: "default", env: {} });
  if (!r.ok) throw new Error(r.error);
  return openRunDb(r.runDb);
}

describe("stage lifecycle", () => {
  test("stage-start inserts a running row, sets current_stage, and bumps attempt on re-entry", () => {
    const db = started();
    expect(stageStart(db, "plan", {}, 10)).toEqual({ ok: true });
    expect(stageEnd(db, "plan", "done", { now: 20 })).toEqual({ ok: true });
    expect(stageStart(db, "plan", {}, 30)).toEqual({ ok: true });
    const rows = db.query("SELECT attempt, status, started_at, ended_at FROM stages ORDER BY attempt").all();
    expect(rows).toEqual([{ attempt: 1, status: "done", started_at: 10, ended_at: 20 }, { attempt: 2, status: "running", started_at: 30, ended_at: null }]);
    expect(db.query("SELECT current_stage FROM runs").get()).toEqual({ current_stage: "plan" });
    db.close();
  });

  test("stage-start refuses while the latest attempt is running", () => {
    const db = started();
    expect(stageStart(db, "plan", {}, 10)).toEqual({ ok: true });
    const again = stageStart(db, "plan", { HERDR_PANE_ID: "w1:p4" }, 20);
    expect(again).toMatchObject({ ok: false, code: 2 });
    if (again.ok) return;
    expect(again.error).toContain("stage plan attempt 1 is still running");
    expect(again.error).toBe("stage plan attempt 1 is still running; end it (done, fail or redirect) before starting another, or resume it with run_enter");
    expect((db.query("SELECT COUNT(*) AS n FROM stages").get() as { n: number }).n).toBe(1);
    expect(db.query("SELECT value FROM fields WHERE key='herdr-pane'").get()).toBeNull();
    db.close();
  });

  test("stage-start with onRunning refuse leaves a running latest attempt untouched", () => {
    const db = started();
    stageStart(db, "plan", {}, 10);
    const again = stageStart(db, "plan", {}, 20, { onRunning: "refuse" });
    expect(again).toMatchObject({ ok: false, code: 2 });
    expect(db.query("SELECT attempt, status, reason, ended_at FROM stages ORDER BY attempt").all()).toEqual([{ attempt: 1, status: "running", reason: null, ended_at: null }]);
    db.close();
  });

  test("stage-start with onRunning supersede ends the running attempt redirected and runs the next, in one step", () => {
    const db = started();
    stageStart(db, "plan", {}, 10);
    expect(stageStart(db, "plan", { HERDR_PANE_ID: "w1:p4" }, 20, { onRunning: "supersede" })).toEqual({ ok: true });
    expect(db.query("SELECT attempt, status, reason, started_at, ended_at FROM stages ORDER BY attempt").all()).toEqual([
      { attempt: 1, status: "redirected", reason: "superseded by attempt 2", started_at: 10, ended_at: 20 },
      { attempt: 2, status: "running", reason: null, started_at: 20, ended_at: null },
    ]);
    expect((db.query("SELECT COUNT(*) AS n FROM stages WHERE status='running'").get() as { n: number }).n).toBe(1);
    expect(db.query("SELECT current_stage FROM runs").get()).toEqual({ current_stage: "plan" });
    expect(db.query("SELECT contract, scope, selection, decided_by, decided_at FROM decisions").all()).toEqual([
      { contract: "gate@1", scope: "redirect:plan:1", selection: '{"from":"plan","to":"plan","reason":"superseded by attempt 2"}', decided_by: "run_stage", decided_at: 20 },
    ]);
    expect(db.query("SELECT value FROM fields WHERE key='herdr-pane'").get()).toEqual({ value: "w1:p4" });
    db.close();
  });

  test("stage-start with onRunning supersede on a stage that is not running behaves as a normal start", () => {
    const db = started();
    stageStart(db, "plan", {}, 10);
    stageEnd(db, "plan", "done", { now: 20 });
    expect(stageStart(db, "plan", {}, 30, { onRunning: "supersede" })).toEqual({ ok: true });
    expect(db.query("SELECT attempt, status, reason FROM stages ORDER BY attempt").all()).toEqual([
      { attempt: 1, status: "done", reason: null },
      { attempt: 2, status: "running", reason: null },
    ]);
    db.close();
  });

  test("stage-start after done or failed starts the next attempt", () => {
    const db = started();
    stageStart(db, "plan", {}, 10);
    stageEnd(db, "plan", "done", { now: 20 });
    expect(stageStart(db, "plan", {}, 30)).toEqual({ ok: true });
    stageEnd(db, "plan", "failed", { now: 40 });
    expect(stageStart(db, "plan", {}, 50)).toEqual({ ok: true });
    expect(db.query("SELECT attempt FROM stages ORDER BY attempt").all()).toEqual([{ attempt: 1 }, { attempt: 2 }, { attempt: 3 }]);
    db.close();
  });

  test("stage-start records identity from env", () => {
    const db = started();
    stageStart(db, "plan", { HERDR_PANE_ID: "w1:p4" }, 10);
    expect(db.query("SELECT value, produced_by FROM fields WHERE key='herdr-pane'").get()).toEqual({ value: "w1:p4", produced_by: "run" });
    db.close();
  });

  test("stage-fail records reason and detail path on the latest attempt", () => {
    const db = started();
    stageStart(db, "gates", {}, 10);
    expect(stageEnd(db, "gates", "failed", { reason: "acme-gate assertion failed", detailPath: "/tmp/gates.log", now: 20 })).toEqual({ ok: true });
    expect(db.query("SELECT status, reason, detail_path FROM stages WHERE name='gates'").get()).toEqual({ status: "failed", reason: "acme-gate assertion failed", detail_path: "/tmp/gates.log" });
    db.close();
  });

  test("a reason containing quotes is stored verbatim", () => {
    const db = started();
    stageStart(db, "gates", {}, 10);
    stageEnd(db, "gates", "failed", { reason: "expected '/c/1' got '/x'" });
    expect(db.query("SELECT reason FROM stages WHERE name='gates'").get()).toEqual({ reason: "expected '/c/1' got '/x'" });
    db.close();
  });

  test("stage-fail without a reason stores NULL", () => {
    const db = started();
    stageStart(db, "gates", {}, 10);
    stageEnd(db, "gates", "failed");
    expect(db.query("SELECT reason, detail_path FROM stages WHERE name='gates'").get()).toEqual({ reason: null, detail_path: null });
    db.close();
  });

  test("stage-fail with an empty reason stores NULL, not an empty string", () => {
    const db = started();
    stageStart(db, "gates", {}, 10);
    stageEnd(db, "gates", "failed", { reason: "" });
    expect(db.query("SELECT reason FROM stages WHERE name='gates'").get()).toEqual({ reason: null });
    db.close();
  });

  test("stage-done and stage-fail on a stage that was never started are exit 3 and write nothing", () => {
    const db = started();
    expect(stageEnd(db, "plan", "done")).toEqual({ ok: false, error: "stage never started: plan", code: 3 });
    expect(stageEnd(db, "gates", "failed", { reason: "boom" })).toEqual({ ok: false, error: "stage never started: gates", code: 3 });
    expect(db.query("SELECT COUNT(*) AS n FROM stages").get()).toEqual({ n: 0 });
    db.close();
  });

  test("stage-redirect closes the latest running attempt as redirected with the default reason", () => {
    const db = started();
    stageStart(db, "implement", {}, 10);
    expect(stageEnd(db, "implement", "redirected", { reason: "redirected to plan", requireRunning: true, now: 20 })).toEqual({ ok: true });
    expect(db.query("SELECT status, reason, ended_at FROM stages WHERE name='implement'").get()).toEqual({ status: "redirected", reason: "redirected to plan", ended_at: 20 });
    db.close();
  });

  test("stage-redirect refuses a done attempt and leaves it untouched", () => {
    const db = started();
    stageStart(db, "implement", {}, 10);
    stageEnd(db, "implement", "done", { now: 20 });
    expect(stageEnd(db, "implement", "redirected", { reason: "redirected to plan", requireRunning: true, now: 30 }))
      .toEqual({ ok: false, error: "stage implement is done, not running", code: 3 });
    expect(db.query("SELECT status, ended_at FROM stages WHERE name='implement'").get()).toEqual({ status: "done", ended_at: 20 });
    db.close();
  });

  test("stage-redirect on a never-started stage is exit 3", () => {
    const db = started();
    expect(stageEnd(db, "implement", "redirected", { reason: "redirected to plan", requireRunning: true }))
      .toEqual({ ok: false, error: "stage never started: implement", code: 3 });
    db.close();
  });
});

describe("fields", () => {
  test("field set refuses an evidence@2 image with no annotation and no waiver, keeping the old value", () => {
    const db = started();
    const good = JSON.stringify({ v: 2, cases: [{ id: "c1", label: "C", after: { path: "/a.png", waiver: "identical" } }] });
    expect(fieldSet(db, "evidence", good, "evidence", 10)).toEqual({ ok: true });
    const raw = JSON.stringify({ v: 2, cases: [{ id: "c1", label: "C", after: { path: "/a.png" } }] });
    expect(fieldSet(db, "evidence", raw, "ship", 20)).toEqual({
      ok: false,
      code: 2,
      error: 'evidence@2: case "c1" after has no annotated image and no waiver; annotate it or add a waiver with a reason',
    });
    expect(fieldGet(db, "evidence")).toEqual({ ok: true, value: good });
    db.close();
  });

  test("field set still writes v1 and legacy evidence, and validates only the evidence key", () => {
    const db = started();
    expect(fieldSet(db, "evidence", JSON.stringify({ v: 1, before: "/b.png" }), "evidence", 10)).toEqual({ ok: true });
    expect(fieldSet(db, "evidence", "see /tmp/x.png", "evidence", 11)).toEqual({ ok: true });
    expect(fieldSet(db, "notes", JSON.stringify({ v: 2, cases: [] }), "plan", 12)).toEqual({ ok: true });
    db.close();
  });

  test("field set/get round-trips a value with single quotes; a missing key is exit 3", () => {
    const db = started();
    expect(fieldSet(db, "mr-url", "https://x/1?a='b'", "ship", 10)).toEqual({ ok: true });
    expect(fieldGet(db, "mr-url")).toEqual({ ok: true, value: "https://x/1?a='b'" });
    expect(db.query("SELECT produced_by, at FROM fields WHERE key='mr-url'").get()).toEqual({ produced_by: "ship", at: 10 });
    expect(fieldGet(db, "nope")).toMatchObject({ ok: false, code: 3 });
    db.close();
  });

  test("field set replaces an existing key", () => {
    const db = started();
    fieldSet(db, "branch", "a", "provision", 10);
    fieldSet(db, "branch", "b", "provision", 20);
    expect(db.query("SELECT value, at FROM fields WHERE key='branch'").get()).toEqual({ value: "b", at: 20 });
    db.close();
  });
});

describe("decisions", () => {
  test("decision record upserts on (contract, scope) and refuses a selection that is not JSON", () => {
    const db = started();
    const rec = (selection: string) => decisionRecord(db, { contract: "execution-strategy@1", scope: "run", selection, decidedBy: "stage-plan" });
    expect(rec('{"tier":"direct-tdd"}')).toEqual({ ok: true });
    expect(rec('{"tier":"superpowers"}')).toEqual({ ok: true });
    const rows = db.query("SELECT selection FROM decisions").all() as { selection: string }[];
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.selection).tier).toBe("superpowers");
    expect(rec("not json")).toMatchObject({ ok: false, code: 2 });
    db.close();
  });

  test("scopes are free-form: a per-branch discriminator keeps every row", () => {
    const db = started();
    const rec = (scope: string, now: number) =>
      decisionRecord(db, { contract: "ci-outcome@1", scope, selection: '{"ok":true}', decidedBy: "watch-ci", now });
    expect(rec("ci:sync-open-mrs:1:feature-a", 10)).toEqual({ ok: true });
    expect(rec("ci:sync-open-mrs:1:feature-b", 20)).toEqual({ ok: true });
    const s = snapshot(db);
    if (!s.ok) throw new Error(s.error);
    expect(s.decisions.map((d) => d.scope)).toEqual(["ci:sync-open-mrs:1:feature-a", "ci:sync-open-mrs:1:feature-b"]);
    db.close();
  });
});

describe("snapshot", () => {
  test("returns manifest and budgets arrays", () => {
    const db = started();
    const s = snapshot(db);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.manifest).toEqual([]);
    expect(s.budgets).toEqual([]);
    const id = (db.query("SELECT id FROM runs").get() as { id: string }).id;
    db.run("INSERT INTO manifest VALUES (?,2,'b',NULL,NULL,NULL,'[]','[]'),(?,1,'a',NULL,NULL,NULL,'[]','[]')", [id, id]);
    db.run('INSERT INTO budgets VALUES (?,\'z\',1,5,9),(?,\'k\',2,5,9)', [id, id]);
    const s2 = snapshot(db);
    if (!s2.ok) return;
    expect(s2.manifest.map((r) => r.stage)).toEqual(["a", "b"]);
    expect(s2.budgets.map((r) => r.key)).toEqual(["k", "z"]);
    db.close();
  });

  test("returns raw rows in the script's order", () => {
    const db = started();
    stageStart(db, "plan", {}, 10);
    stageEnd(db, "plan", "done", { now: 20 });
    stageStart(db, "gates", {}, 30);
    fieldSet(db, "b", "2", "plan", 50);
    fieldSet(db, "a", "1", "plan", 40);
    decisionRecord(db, { contract: "c@1", scope: "run", selection: "{}", decidedBy: "x", now: 60 });
    const s = snapshot(db);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.run).toMatchObject({ status: "running", current_stage: "gates" });
    expect(s.stages.map((r) => r.name)).toEqual(["plan", "gates"]);
    expect(s.fields.map((r) => r.key)).toEqual(["a", "b"]);
    expect(s.decisions).toHaveLength(1);
    expect(s.stages[0]).toHaveProperty("run_id");
    db.close();
  });
});
