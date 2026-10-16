import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { budget, cleared, holdStage, nextStage, positionOf, readManifest, setManifestRoot, writeManifest } from "../engine.ts";
import { createRunDb, fieldSet, stageEnd, stageStart } from "../write.ts";

const dirs: string[] = [];

function mkdb(): Database {
  const dir = mkdtempSync(join(tmpdir(), "rt-runs-engine-"));
  dirs.push(dir);
  const db = createRunDb(join(dir, "state.db"));
  db.run("INSERT INTO runs (id, repo, work_type, pipeline, status, started_at) VALUES ('r1','repo','work','work','running',1)");
  return db;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function attempt(db: Database, stage: string): void {
  expect(stageStart(db, stage, {}).ok).toBe(true);
  expect(stageEnd(db, stage, "done").ok).toBe(true);
}

describe("manifest", () => {
  test("writeManifest/readManifest round-trip; positionOf joins packRoot and file", () => {
    const db = mkdb();
    writeManifest(db, [
      { stage: "plan", name: "Plan", file: "plan.md", consumes: [], produces: ["spec"] },
      { stage: "ship", consumes: ["spec"], produces: [] },
    ], "/pack");
    expect(readManifest(db)).toEqual([
      { ordinal: 0, stage: "plan", name: "Plan", file: "plan.md", packRoot: "/pack", consumes: [], produces: ["spec"] },
      { ordinal: 1, stage: "ship", name: null, file: null, packRoot: "/pack", consumes: ["spec"], produces: [] },
    ]);
    writeManifest(db, [{ stage: "only", consumes: [], produces: [] }], null);
    expect(readManifest(db).map((s) => s.stage)).toEqual(["only"]);
    writeManifest(db, [{ stage: "plan", file: "plan.md", consumes: [], produces: [] }], "/pack");
    attempt(db, "plan");
    expect(positionOf(db, "plan")).toEqual({ stage: "plan", attempt: 1, status: "done", file: "/pack/plan.md" });
    expect(positionOf(db, "nope")).toBeNull();
  });

  test("setManifestRoot rewrites every row's pack_root", () => {
    const db = mkdb();
    writeManifest(db, [
      { stage: "a", consumes: [], produces: [] },
      { stage: "b", consumes: [], produces: [] },
    ], "/old");
    setManifestRoot(db, "/new");
    expect(readManifest(db).map((s) => s.packRoot)).toEqual(["/new", "/new"]);
  });
});

describe("cleared", () => {
  test('null, "", "-", " - " are cleared; "x" is not', () => {
    for (const v of [null, undefined, "", "-", " - "]) expect(cleared(v)).toBe(true);
    expect(cleared("x")).toBe(false);
  });
});

describe("holdStage", () => {
  test("records gate@1 hold:<stage>:<attempt> and the hold field", () => {
    const db = mkdb();
    writeManifest(db, [{ stage: "plan", consumes: [], produces: [] }], null);
    attempt(db, "plan");
    attempt(db, "plan");
    const r = holdStage(db, { stage: "plan", reason: "waiting on design", decidedBy: "me", now: 5 });
    expect(r).toEqual({ ok: true, held: true, at: { stage: "plan", attempt: 2, status: "done", file: null }, scope: "hold:plan:2" });
    const d = db.query("SELECT contract, scope, selection, decided_by FROM decisions").get() as Record<string, string>;
    expect(d).toEqual({ contract: "gate@1", scope: "hold:plan:2", selection: '{"reason":"waiting on design"}', decided_by: "me" });
    const f = db.query("SELECT value, produced_by FROM fields WHERE key='hold'").get();
    expect(f).toEqual({ value: "waiting on design", produced_by: "plan" });
  });

  test("defaults the reason to held; refuses a stage with no row", () => {
    const db = mkdb();
    writeManifest(db, [{ stage: "plan", consumes: [], produces: [] }], null);
    const r = holdStage(db, { stage: "plan", decidedBy: "me" });
    expect(r.ok).toBe(false);
    attempt(db, "plan");
    const ok = holdStage(db, { stage: "plan", decidedBy: "me" });
    expect(ok.ok).toBe(true);
    expect((db.query("SELECT value FROM fields WHERE key='hold'").get() as { value: string }).value).toBe("held");
    const none = holdStage(db, { stage: "ghost", decidedBy: "me" });
    expect(none).toMatchObject({ ok: false, code: 3 });
  });
});

describe("budget", () => {
  test("counts up, reports remaining and exhausted, and keeps counting past the limit", () => {
    const db = mkdb();
    const run = () => budget(db, { key: "k", limit: 2 });
    expect(run()).toEqual({ ok: true, key: "k", spent: 1, limit: 2, remaining: 1, exhausted: false });
    expect(run()).toEqual({ ok: true, key: "k", spent: 2, limit: 2, remaining: 0, exhausted: true });
    expect(run()).toEqual({ ok: true, key: "k", spent: 3, limit: 2, remaining: 0, exhausted: true });
  });

  test("increment 0 reads; a new limit replaces the old", () => {
    const db = mkdb();
    budget(db, { key: "k", limit: 5, increment: 2 });
    expect(budget(db, { key: "k", limit: 5, increment: 0 })).toMatchObject({ spent: 2, remaining: 3 });
    expect(budget(db, { key: "k", limit: 3, increment: 0 })).toMatchObject({ spent: 2, limit: 3, remaining: 1 });
  });

  test("with stage resets on a new attempt", () => {
    const db = mkdb();
    writeManifest(db, [{ stage: "implement", consumes: [], produces: [] }], null);
    attempt(db, "implement");
    expect(budget(db, { key: "retries", limit: 3, stage: "implement" })).toMatchObject({ ok: true, key: "retries", spent: 1 });
    expect(budget(db, { key: "retries", limit: 3, stage: "implement" })).toMatchObject({ spent: 2 });
    expect((db.query("SELECT key FROM budgets").get() as { key: string }).key).toBe("implement:1:retries");
    attempt(db, "implement");
    expect(budget(db, { key: "retries", limit: 3, stage: "implement" })).toMatchObject({ spent: 1 });
    expect(db.query("SELECT key FROM budgets ORDER BY key").all()).toEqual([{ key: "implement:1:retries" }, { key: "implement:2:retries" }]);
    expect(budget(db, { key: "retries", limit: 3, stage: "ghost" })).toMatchObject({ ok: false, code: 3 });
  });

  test("refuses an empty key, a control character, limit 0, a negative or fractional increment", () => {
    const db = mkdb();
    expect(budget(db, { key: "", limit: 1 })).toMatchObject({ ok: false, code: 2 });
    expect(budget(db, { key: "a\nb", limit: 1 })).toMatchObject({ ok: false, code: 2 });
    expect(budget(db, { key: "x".repeat(201), limit: 1 })).toMatchObject({ ok: false, code: 2 });
    expect(budget(db, { key: "k", limit: 0 })).toMatchObject({ ok: false, code: 2 });
    expect(budget(db, { key: "k", limit: 1, increment: -1 })).toMatchObject({ ok: false, code: 2 });
    expect(budget(db, { key: "k", limit: 1, increment: 0.5 })).toMatchObject({ ok: false, code: 2 });
    expect(db.query("SELECT COUNT(*) AS n FROM budgets").get()).toEqual({ n: 0 });
  });
});

describe("holdStage atomicity", () => {
  test("a failed hold field write rolls back the decision", () => {
    const db = mkdb();
    writeManifest(db, [{ stage: "plan", consumes: [], produces: [] }], null);
    attempt(db, "plan");
    db.run("CREATE TRIGGER no_fields BEFORE INSERT ON fields BEGIN SELECT RAISE(ABORT, 'boom'); END");
    const r = holdStage(db, { stage: "plan", decidedBy: "me" });
    expect(r).toMatchObject({ ok: false, code: 1 });
    expect(db.query("SELECT COUNT(*) AS n FROM decisions").get()).toEqual({ n: 0 });
  });
});

describe("nextStage", () => {
  function pipeline(): Database {
    const db = mkdb();
    writeManifest(
      db,
      [
        { stage: "plan", file: "plan.md", consumes: [], produces: ["approach"] },
        { stage: "implement", file: "implement.md", consumes: ["approach"], produces: ["commits"] },
        { stage: "ship", consumes: ["commits"], produces: ["mr"] },
      ],
      "/pack",
    );
    expect(stageStart(db, "plan", {}, 100).ok).toBe(true);
    return db;
  }
  const set = (db: Database, key: string, value: string, stage: string, at = 150) => expect(fieldSet(db, key, value, stage, at).ok).toBe(true);
  const rows = (db: Database) => db.query("SELECT name, attempt, status FROM stages ORDER BY name, attempt").all();

  test("done: all produces set, plan done, implement attempt 1 running, next.file is the joined path", () => {
    const db = pipeline();
    set(db, "approach", "tdd", "plan");
    const r = nextStage(db, { stage: "plan", env: {}, now: 200 });
    expect(r).toEqual({ ok: true, ended: "done", next: { stage: "implement", attempt: 1, status: "running", file: "/pack/implement.md" } });
    expect(rows(db)).toEqual([
      { name: "implement", attempt: 1, status: "running" },
      { name: "plan", attempt: 1, status: "done" },
    ]);
    expect((db.query("SELECT current_stage FROM runs").get() as { current_stage: string }).current_stage).toBe("implement");
  });

  test("failed: a missing produce fails the row with the reason and returns missing, scope plan-failed:1", () => {
    const db = pipeline();
    const r = nextStage(db, { stage: "plan", env: {}, now: 200 });
    expect(r).toEqual({
      ok: true,
      ended: "failed",
      at: { stage: "plan", attempt: 1, status: "failed", file: "/pack/plan.md" },
      reason: "missing produce: approach",
      detailPath: null,
      missing: ["approach"],
      scope: "plan-failed:1",
      earlier: [],
    });
    expect(db.query("SELECT status, reason FROM stages").get()).toEqual({ status: "failed", reason: "missing produce: approach" });
  });

  test("whitespace and ' - ' produces count as missing", () => {
    const db = pipeline();
    set(db, "approach", "   ", "plan");
    expect(nextStage(db, { stage: "plan", env: {}, now: 200 })).toMatchObject({ ended: "failed", missing: ["approach"] });
    const db2 = pipeline();
    set(db2, "approach", " - ", "plan");
    expect(nextStage(db2, { stage: "plan", env: {}, now: 200 })).toMatchObject({ ended: "failed", missing: ["approach"] });
  });

  test("several missing produces are listed in manifest order", () => {
    const db = mkdb();
    writeManifest(db, [{ stage: "plan", consumes: [], produces: ["a", "b", "c"] }], null);
    stageStart(db, "plan", {}, 100);
    set(db, "b", "x", "plan");
    expect(nextStage(db, { stage: "plan", env: {}, now: 200 })).toMatchObject({ ended: "failed", missing: ["a", "c"], reason: "missing produce: a, c" });
  });

  test("a stage that wrote its own fail returns failed with its reason and detailPath, and earlier lists started stages before it", () => {
    const db = pipeline();
    set(db, "approach", "tdd", "plan");
    nextStage(db, { stage: "plan", env: {}, now: 200 });
    expect(stageEnd(db, "implement", "failed", { reason: "tests red", detailPath: "/tmp/d.txt", now: 300 }).ok).toBe(true);
    const r = nextStage(db, { stage: "implement", env: {}, now: 400 });
    expect(r).toEqual({
      ok: true,
      ended: "failed",
      at: { stage: "implement", attempt: 1, status: "failed", file: "/pack/implement.md" },
      reason: "tests red",
      detailPath: "/tmp/d.txt",
      scope: "implement-failed:1",
      earlier: ["plan"],
    });
  });

  test("earlier skips manifest stages that never started", () => {
    const db = pipeline();
    db.run("UPDATE stages SET status='failed', reason='x'");
    expect(nextStage(db, { stage: "plan", env: {} })).toMatchObject({ ended: "failed", earlier: [] });
  });

  test("held and waiting are returned without writes", () => {
    const db = pipeline();
    set(db, "approach", "tdd", "plan");
    set(db, "hold", "waiting on design", "plan", 150);
    const at = { stage: "plan", attempt: 1, status: "running", file: "/pack/plan.md" } as const;
    expect(nextStage(db, { stage: "plan", env: {}, now: 200 })).toEqual({ ok: true, ended: "held", at, reason: "waiting on design" });
    set(db, "hold", "-", "plan", 160);
    set(db, "waiting-gate", "clarify", "plan", 170);
    expect(nextStage(db, { stage: "plan", env: {}, now: 200 })).toMatchObject({ ended: "waiting", gate: "clarify" });
    set(db, "waiting-gate", "-", "plan", 180);
    expect(nextStage(db, { stage: "plan", env: {}, now: 200 })).toMatchObject({ ended: "done" });
  });

  test("held writes nothing", () => {
    const db = pipeline();
    set(db, "hold", "h", "plan", 150);
    const snap = () => JSON.stringify([db.query("SELECT * FROM stages").all(), db.query("SELECT * FROM fields").all(), db.query("SELECT * FROM decisions").all()]);
    const before = snap();
    nextStage(db, { stage: "plan", env: {}, now: 999 });
    expect(snap()).toBe(before);
  });

  test("a hold set at the attempt's start belongs to it; one set before does not", () => {
    const db = pipeline();
    set(db, "approach", "x", "plan");
    set(db, "hold", "same ms", "plan", 100);
    expect(nextStage(db, { stage: "plan", env: {}, now: 200 })).toMatchObject({ ended: "held" });
    set(db, "hold", "stale", "plan", 99);
    expect(nextStage(db, { stage: "plan", env: {}, now: 200 })).toMatchObject({ ended: "done" });
  });

  test("starting the next stage clears a leftover hold to -", () => {
    const db = pipeline();
    set(db, "approach", "x", "plan");
    set(db, "hold", "old", "plan", 50);
    expect(nextStage(db, { stage: "plan", env: {}, now: 200 })).toMatchObject({ ended: "done" });
    expect(db.query("SELECT value FROM fields WHERE key='hold'").get()).toEqual({ value: "-" });
  });

  test("last stage done returns last: true, stages, scope close", () => {
    const db = pipeline();
    set(db, "approach", "x", "plan");
    nextStage(db, { stage: "plan", env: {}, now: 200 });
    set(db, "commits", "c", "implement", 250);
    nextStage(db, { stage: "implement", env: {}, now: 300 });
    set(db, "mr", "!1", "ship", 350);
    const r = nextStage(db, { stage: "ship", env: {}, now: 400 });
    expect(r).toEqual({ ok: true, ended: "done", last: true, stages: ["plan", "implement", "ship"], scope: "close" });
    expect(db.query("SELECT status FROM stages WHERE name='ship'").get()).toEqual({ status: "done" });
  });

  test("a repeated call returns the same result with repeated: true and leaves one running row for the next stage", () => {
    const db = pipeline();
    set(db, "approach", "x", "plan");
    const first = nextStage(db, { stage: "plan", env: {}, now: 200 });
    const again = nextStage(db, { stage: "plan", env: {}, now: 300 });
    expect(first).toMatchObject({ ended: "done" });
    expect(again as unknown).toEqual({ ...(first as object), repeated: true });
    expect(db.query("SELECT COUNT(*) AS n FROM stages WHERE name='implement'").get()).toEqual({ n: 1 });
  });

  test("a repeated call after the last stage returns the last result with repeated: true", () => {
    const db = mkdb();
    writeManifest(db, [{ stage: "only", consumes: [], produces: [] }], null);
    stageStart(db, "only", {}, 100);
    const first = nextStage(db, { stage: "only", env: {}, now: 200 });
    expect(first).toEqual({ ok: true, ended: "done", last: true, stages: ["only"], scope: "close" });
    expect(nextStage(db, { stage: "only", env: {}, now: 300 }) as unknown).toEqual({ ...(first as object), repeated: true });
  });

  test("a done row whose next stage moved on is refused", () => {
    const db = pipeline();
    set(db, "approach", "x", "plan");
    nextStage(db, { stage: "plan", env: {}, now: 200 });
    stageEnd(db, "implement", "done", { now: 250 });
    expect(nextStage(db, { stage: "plan", env: {} })).toMatchObject({ ok: false, code: 2 });
  });

  test("closed run returns closed; a run with no manifest is refused; a stage that is not current is refused", () => {
    const db = pipeline();
    expect(nextStage(db, { stage: "implement", env: {} })).toEqual({
      ok: false,
      error: "stage implement is not the run's current stage (current stage plan; implement was never started)",
      code: 2,
    });
    expect(nextStage(db, { stage: "ghost", env: {} })).toMatchObject({ ok: false, code: 2 });
    db.run("UPDATE runs SET status='done'");
    expect(nextStage(db, { stage: "plan", env: {} })).toEqual({ ok: true, ended: "closed", status: "done" });

    const bare = mkdb();
    stageStart(bare, "plan", {}, 100);
    expect(nextStage(bare, { stage: "plan", env: {} })).toEqual({
      ok: false,
      error: "this run has no pipeline manifest; resume it with run_enter to record one",
      code: 2,
    });
  });

  test("a redirected row is refused naming the current stage and status", () => {
    const db = pipeline();
    stageEnd(db, "plan", "redirected", { reason: "r" });
    expect(nextStage(db, { stage: "plan", env: {} })).toEqual({
      ok: false,
      error: "stage plan is not the run's current stage (current stage plan; plan is redirected)",
      code: 2,
    });
  });

  test("a failed start of the next stage rolls the whole transition back", () => {
    const db = pipeline();
    set(db, "approach", "x", "plan");
    db.run("CREATE TRIGGER no_stage_insert BEFORE INSERT ON stages BEGIN SELECT RAISE(ABORT, 'boom'); END");
    expect(nextStage(db, { stage: "plan", env: {}, now: 200 })).toMatchObject({ ok: false, code: 1 });
    expect(db.query("SELECT status FROM stages WHERE name='plan'").get()).toEqual({ status: "running" });
  });
});
