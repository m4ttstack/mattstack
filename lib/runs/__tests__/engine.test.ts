import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { budget, cleared, closeRun, holdStage, nextStage, positionOf, readManifest, resolveStage, setManifestRoot, writeManifest } from "../engine.ts";
import { createRunDb, fieldSet, runStatus, stageEnd, stageStart } from "../write.ts";

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

describe("holdStage on a finished run", () => {
  test("is refused with nothing written", () => {
    const db = mkdb();
    writeManifest(db, [{ stage: "plan", consumes: [], produces: [] }], null);
    attempt(db, "plan");
    expect(runStatus(db, "done", 5).ok).toBe(true);
    const before = JSON.stringify([db.query("SELECT * FROM decisions").all(), db.query("SELECT * FROM fields").all(), db.query("SELECT * FROM runs").all()]);
    expect(holdStage(db, { stage: "plan", decidedBy: "me" })).toEqual({ ok: false, error: "this run is done; nothing to hold", code: 2 });
    expect(JSON.stringify([db.query("SELECT * FROM decisions").all(), db.query("SELECT * FROM fields").all(), db.query("SELECT * FROM runs").all()])).toBe(before);
  });
});

describe("write transactions take the write lock first", () => {
  // A second connection holding the write lock makes a bare read inside an
  // IMMEDIATE transaction fail; a deferred one would read through WAL.
  function locked(run: (db: Database) => unknown): unknown {
    const db = mkdb();
    writeManifest(db, [{ stage: "plan", consumes: [], produces: [] }], null);
    attempt(db, "plan");
    expect(runStatus(db, "done", 5).ok).toBe(true);
    const other = new Database(db.filename);
    db.run("PRAGMA busy_timeout=0");
    other.run("BEGIN IMMEDIATE");
    try {
      return run(db);
    } finally {
      other.run("ROLLBACK");
      other.close();
    }
  }
  const env = {};
  const refusedBusy = (r: unknown) => expect(r).toMatchObject({ ok: false, code: 1 });

  test("nextStage", () => refusedBusy(locked((db) => nextStage(db, { stage: "plan", env }))));
  test("resolveStage", () => refusedBusy(locked((db) => resolveStage(db, { stage: "plan", next: "done", decidedBy: "me", env }))));
  test("closeRun", () => refusedBusy(locked((db) => closeRun(db, { workType: "work", stage: "plan", outcome: "done" }))));
  test("holdStage", () => refusedBusy(locked((db) => holdStage(db, { stage: "plan", decidedBy: "me" }))));
  test("budget", () => refusedBusy(locked((db) => budget(db, { key: "k", limit: 1 }))));
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
    expect(stageEnd(db, "plan", "done", { now: 120 }).ok).toBe(true);
    expect(stageStart(db, "ship", {}, 130).ok).toBe(true);
    expect(stageEnd(db, "ship", "failed", { reason: "x", now: 140 }).ok).toBe(true);
    expect(nextStage(db, { stage: "ship", env: {} })).toMatchObject({ ended: "failed", earlier: ["plan"] });
  });

  test("a following stage already running refuses the start and rolls the whole call back", () => {
    const db = pipeline();
    set(db, "approach", "tdd", "plan");
    expect(stageStart(db, "implement", {}, 110).ok).toBe(true);
    expect(nextStage(db, { stage: "plan", env: {}, now: 200 })).toMatchObject({ ok: false, code: 2 });
    expect(db.query("SELECT name, attempt, status FROM stages ORDER BY name").all()).toEqual([
      { name: "implement", attempt: 1, status: "running" },
      { name: "plan", attempt: 1, status: "running" },
    ]);
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

describe("resolveStage", () => {
  const NO_MANIFEST = "this run has no pipeline manifest; resume it with run_enter to record one";
  const stages = [
    { stage: "plan", file: "plan.md", consumes: [], produces: ["approach"] },
    { stage: "implement", file: "implement.md", consumes: ["approach"], produces: ["commits"] },
    { stage: "ship", consumes: ["commits"], produces: ["mr"] },
    { stage: "watch-ci", consumes: ["mr"], produces: ["ci"] },
  ];
  const ok = (r: unknown) => expect(r).toMatchObject({ ok: true });

  // plan and implement done, ship running, every produce and shipTarget set
  function atShip(): Database {
    const db = mkdb();
    writeManifest(db, stages, "/pack");
    for (const s of ["plan", "implement"]) attempt(db, s);
    ok(stageStart(db, "ship", {}, 100));
    for (const [k, v, by] of [["approach", "tdd", "plan"], ["commits", "abc", "implement"], ["mr", "!1", "ship"], ["ci", "green", "watch-ci"], ["shipTarget", "main", "ship"]] as const) {
      ok(fieldSet(db, k, v, by, 110));
    }
    return db;
  }
  const field = (db: Database, key: string) => db.query("SELECT value, produced_by FROM fields WHERE key = ?").get(key);
  const resolve = (db: Database, o: Partial<Parameters<typeof resolveStage>[1]> & { next: Parameters<typeof resolveStage>[1]["next"] }) =>
    resolveStage(db, { stage: "ship", decidedBy: "matt", env: {}, now: 500, ...o });
  const snap = (db: Database) =>
    JSON.stringify([db.query("SELECT * FROM stages").all(), db.query("SELECT * FROM fields").all(), db.query("SELECT * FROM decisions").all(), db.query("SELECT * FROM runs").all()]);

  test("retry after a failure starts attempt 2; retry of ship clears shipTarget", () => {
    const db = atShip();
    ok(stageEnd(db, "ship", "failed", { reason: "boom", now: 120 }));
    expect(resolve(db, { next: "retry" })).toEqual({
      ok: true,
      applied: "retry",
      next: { stage: "ship", attempt: 2, status: "running", file: null },
      cleared: ["shipTarget"],
    });
    expect(field(db, "shipTarget")).toEqual({ value: "-", produced_by: "ship" });
    expect(field(db, "mr")).toEqual({ value: "!1", produced_by: "ship" });
  });

  test("retry of a stage without consent fields clears nothing", () => {
    const db = atShip();
    ok(stageEnd(db, "ship", "redirected", { reason: "r" }));
    ok(stageStart(db, "implement", {}));
    ok(stageEnd(db, "implement", "failed", { reason: "red" }));
    expect(resolve(db, { stage: "implement", next: "retry" })).toMatchObject({ applied: "retry", next: { stage: "implement", attempt: 3 }, cleared: [] });
  });

  test("retry refuses a running or done row", () => {
    const db = atShip();
    const before = snap(db);
    expect(resolve(db, { next: "retry" })).toMatchObject({ ok: false, code: 2 });
    expect(resolve(db, { stage: "plan", next: "retry" })).toMatchObject({ ok: false, code: 2 });
    expect(snap(db)).toBe(before);
  });

  test("redirect from a running ship to implement", () => {
    const db = atShip();
    const r = resolve(db, { next: "redirect", to: "implement", note: "tests missing" });
    expect(r).toEqual({
      ok: true,
      applied: "redirect",
      next: { stage: "implement", attempt: 2, status: "running", file: "/pack/implement.md" },
      cleared: ["commits", "mr", "ci", "shipTarget"],
    });
    expect(db.query("SELECT contract, scope, selection, decided_by FROM decisions").all()).toEqual([
      { contract: "gate@1", scope: "redirect:ship:1", selection: '{"from":"ship","to":"implement","reason":"tests missing"}', decided_by: "matt" },
    ]);
    expect(db.query("SELECT name, attempt, status, reason FROM stages WHERE name = 'ship'").all()).toEqual([
      { name: "ship", attempt: 1, status: "redirected", reason: "tests missing" },
    ]);
    for (const k of ["commits", "mr", "ci"]) expect(field(db, k)).toEqual({ value: "-", produced_by: "implement" });
    expect(field(db, "shipTarget")).toEqual({ value: "-", produced_by: "ship" });
    expect(field(db, "approach")).toEqual({ value: "tdd", produced_by: "plan" });
    expect((db.query("SELECT current_stage FROM runs").get() as { current_stage: string }).current_stage).toBe("implement");
  });

  test("redirect after close (last row done) records the decision and does not end the row", () => {
    const db = atShip();
    ok(stageEnd(db, "ship", "done"));
    attempt(db, "watch-ci");
    const r = resolve(db, { stage: "watch-ci", next: "redirect", to: "ship" });
    expect(r).toMatchObject({ applied: "redirect", next: { stage: "ship", attempt: 2 }, cleared: ["mr", "ci", "shipTarget"] });
    expect(db.query("SELECT status FROM stages WHERE name = 'watch-ci'").all()).toEqual([{ status: "done" }]);
    expect(db.query("SELECT scope, selection FROM decisions").get()).toEqual({
      scope: "redirect:watch-ci:1",
      selection: '{"from":"watch-ci","to":"ship","reason":"redirected to ship"}',
    });
  });

  test("iterate defaults to the same stage; note becomes the reason; no note gives 'redirected to <to>'", () => {
    const db = atShip();
    expect(resolve(db, { next: "iterate", note: "polish" })).toMatchObject({ applied: "iterate", next: { stage: "ship", attempt: 2 }, cleared: ["mr", "ci", "shipTarget"] });
    expect(db.query("SELECT status, reason FROM stages WHERE name = 'ship' AND attempt = 1").get()).toEqual({ status: "redirected", reason: "polish" });
    expect(db.query("SELECT selection FROM decisions WHERE scope = 'redirect:ship:1'").get()).toEqual({ selection: '{"from":"ship","to":"ship","reason":"polish"}' });
    const db2 = atShip();
    resolve(db2, { next: "iterate" });
    expect(db2.query("SELECT reason FROM stages WHERE name = 'ship' AND attempt = 1").get()).toEqual({ reason: "redirected to ship" });
  });

  test("redirect refuses a missing, unknown or later to, writing nothing", () => {
    const db = atShip();
    const before = snap(db);
    expect(resolve(db, { next: "redirect" })).toMatchObject({ ok: false, code: 2 });
    const unknown = resolve(db, { next: "redirect", to: "nope" });
    expect(unknown).toMatchObject({ ok: false, code: 2 });
    expect((unknown as { error: string }).error).toContain("plan, implement, ship, watch-ci");
    expect(resolve(db, { next: "redirect", to: "watch-ci" })).toMatchObject({ ok: false, code: 2 });
    expect(snap(db)).toBe(before);
  });

  test("a finished run refuses every answer, writing nothing; done on a done run repeats", () => {
    const db = atShip();
    ok(runStatus(db, "abandoned", 300));
    const before = snap(db);
    for (const next of ["retry", "redirect", "iterate", "hold", "abandon", "done"] as const) {
      expect(resolve(db, { next, to: "implement" })).toEqual({ ok: false, error: "this run is abandoned; nothing to resolve", code: 2 });
    }
    expect(snap(db)).toBe(before);

    const finished = atShip();
    ok(stageEnd(finished, "ship", "done"));
    attempt(finished, "watch-ci");
    expect(resolve(finished, { stage: "watch-ci", next: "done" })).toMatchObject({ applied: "done" });
    const done = snap(finished);
    expect(resolve(finished, { stage: "watch-ci", next: "done", now: 900 })).toEqual({ ok: true, applied: "done", status: "done" });
    expect(resolve(finished, { stage: "watch-ci", next: "abandon" })).toEqual({ ok: false, error: "this run is done; nothing to resolve", code: 2 });
    expect(snap(finished)).toBe(done);
  });

  test("refuses an unknown stage, an empty decidedBy and a run with no manifest, writing nothing", () => {
    const db = atShip();
    const before = snap(db);
    const unknown = resolve(db, { stage: "nope", next: "abandon" });
    expect(unknown).toMatchObject({ ok: false, code: 2 });
    expect((unknown as { error: string }).error).toContain("plan, implement, ship, watch-ci");
    expect(resolve(db, { next: "abandon", decidedBy: "" })).toMatchObject({ ok: false, code: 2 });
    expect(snap(db)).toBe(before);
    const bare = mkdb();
    expect(resolve(bare, { next: "abandon" })).toEqual({ ok: false, error: NO_MANIFEST, code: 2 });
  });

  test("a failed start rolls the redirect back", () => {
    const db = atShip();
    db.run("CREATE TRIGGER no_stage_insert BEFORE INSERT ON stages BEGIN SELECT RAISE(ABORT, 'boom'); END");
    const before = snap(db);
    expect(resolve(db, { next: "redirect", to: "implement" })).toMatchObject({ ok: false, code: 1 });
    expect(snap(db)).toBe(before);
  });

  test("hold delegates to holdStage", () => {
    const db = atShip();
    expect(resolve(db, { next: "hold", note: "waiting on design" })).toEqual({
      ok: true,
      applied: "hold",
      held: { at: { stage: "ship", attempt: 1, status: "running", file: null }, scope: "hold:ship:1" },
    });
    expect(field(db, "hold")).toEqual({ value: "waiting on design", produced_by: "ship" });
    expect(db.query("SELECT scope FROM decisions").all()).toEqual([{ scope: "hold:ship:1" }]);
  });

  test("abandon fails a running row and sets the run abandoned", () => {
    const db = atShip();
    expect(resolve(db, { next: "abandon" })).toEqual({ ok: true, applied: "abandon", status: "abandoned" });
    expect(db.query("SELECT status, reason FROM stages WHERE name = 'ship'").get()).toEqual({ status: "failed", reason: "abandoned" });
    expect(db.query("SELECT status FROM runs").get()).toEqual({ status: "abandoned" });
  });

  test("abandon of a stage whose row already ended leaves the row alone", () => {
    const db = atShip();
    ok(stageEnd(db, "ship", "failed", { reason: "boom" }));
    expect(resolve(db, { next: "abandon", note: "giving up" })).toMatchObject({ applied: "abandon", status: "abandoned" });
    expect(db.query("SELECT reason FROM stages WHERE name = 'ship'").get()).toEqual({ reason: "boom" });
  });

  test("done sets the run done only when the last stage is done", () => {
    const db = atShip();
    expect(resolve(db, { next: "done" })).toMatchObject({ ok: false, code: 2 });
    expect(resolve(db, { stage: "watch-ci", next: "done" })).toMatchObject({ ok: false, code: 2 });
    ok(stageEnd(db, "ship", "done"));
    attempt(db, "watch-ci");
    expect(resolve(db, { stage: "plan", next: "done" })).toMatchObject({ ok: false, code: 2 });
    expect(resolve(db, { stage: "watch-ci", next: "done" })).toEqual({ ok: true, applied: "done", status: "done" });
    expect(db.query("SELECT status FROM runs").get()).toEqual({ status: "done" });
  });

  test("done refuses while a redirect after close has a stage running", () => {
    const db = atShip();
    ok(stageEnd(db, "ship", "done"));
    attempt(db, "watch-ci");
    ok(resolve(db, { stage: "watch-ci", next: "redirect", to: "implement" }));
    const before = snap(db);
    const r = resolve(db, { stage: "watch-ci", next: "done" });
    expect(r).toMatchObject({ ok: false, code: 2 });
    expect(r).toMatchObject({ error: expect.stringContaining("stage implement attempt 2 is running; the run is not at its close") });
    expect(snap(db)).toBe(before);
  });

  describe("attempt", () => {
    const count = (db: Database, sql: string) => (db.query(sql).get() as { n: number }).n;

    test("iterate twice with the same attempt repeats the first answer and writes nothing", () => {
      const db = atShip();
      const first = resolve(db, { next: "iterate", attempt: 1 });
      expect(first).toMatchObject({ applied: "iterate", next: { stage: "ship", attempt: 2 } });
      expect(first).not.toHaveProperty("repeated");
      const after = snap(db);
      expect(resolve(db, { next: "iterate", attempt: 1, now: 900 })).toEqual({
        ok: true,
        applied: "iterate",
        next: { stage: "ship", attempt: 2, status: "running", file: null },
        cleared: [],
        repeated: true,
      });
      expect(snap(db)).toBe(after);
      expect(count(db, "SELECT COUNT(*) AS n FROM decisions WHERE scope = 'redirect:ship:1'")).toBe(1);
      expect(count(db, "SELECT COUNT(*) AS n FROM stages WHERE name = 'ship' AND status = 'running'")).toBe(1);
    });

    test("redirect to an earlier stage twice repeats instead of refusing the running target", () => {
      const db = atShip();
      expect(resolve(db, { next: "redirect", to: "implement", attempt: 1 })).toMatchObject({ applied: "redirect" });
      const after = snap(db);
      expect(resolve(db, { next: "redirect", to: "implement", attempt: 1 })).toEqual({
        ok: true,
        applied: "redirect",
        next: { stage: "implement", attempt: 2, status: "running", file: "/pack/implement.md" },
        cleared: [],
        repeated: true,
      });
      expect(snap(db)).toBe(after);
    });

    test("retry twice with the same attempt repeats", () => {
      const db = atShip();
      ok(stageEnd(db, "ship", "failed", { reason: "boom", now: 120 }));
      expect(resolve(db, { next: "retry", attempt: 1 })).toMatchObject({ applied: "retry", next: { attempt: 2 } });
      const after = snap(db);
      expect(resolve(db, { next: "retry", attempt: 1 })).toEqual({
        ok: true,
        applied: "retry",
        next: { stage: "ship", attempt: 2, status: "running", file: null },
        cleared: [],
        repeated: true,
      });
      expect(snap(db)).toBe(after);
    });

    test("an answer for an earlier attempt that was not already applied is refused, writing nothing", () => {
      const db = atShip();
      resolve(db, { next: "iterate", attempt: 1 });
      const before = snap(db);
      const stale = "stage ship is at attempt 2; this answer was for attempt 1";
      expect(resolve(db, { next: "redirect", to: "implement", attempt: 1 })).toEqual({ ok: false, error: stale, code: 2 });
      expect(resolve(db, { next: "retry", attempt: 1 })).toEqual({ ok: false, error: stale, code: 2 });
      expect(snap(db)).toBe(before);
    });

    test("an attempt past the latest is refused for every answer, naming the latest", () => {
      const db = atShip();
      const before = snap(db);
      for (const next of ["retry", "redirect", "iterate", "hold", "abandon", "done"] as const) {
        const r = resolve(db, { next, to: "implement", attempt: 3 });
        expect(r).toMatchObject({ ok: false, code: 2 });
        expect((r as { error: string }).error).toContain("attempt 1");
      }
      expect(snap(db)).toBe(before);
    });

    test("hold, abandon and done ignore an earlier attempt", () => {
      const db = atShip();
      resolve(db, { next: "iterate", attempt: 1 });
      expect(resolve(db, { next: "hold", attempt: 1 })).toMatchObject({ applied: "hold", held: { scope: "hold:ship:2" } });
      expect(resolve(db, { next: "abandon", attempt: 1 })).toMatchObject({ applied: "abandon" });
    });
  });
});

describe("closeRun", () => {
  function standalone(): Database {
    const db = mkdb();
    writeManifest(db, [{ stage: "review", consumes: [], produces: [] }], null);
    expect(stageStart(db, "review", {}, 100).ok).toBe(true);
    return db;
  }

  test("own single-stage run: row done, run done", () => {
    const db = standalone();
    expect(closeRun(db, { workType: "work", stage: "review", outcome: "done", now: 200 })).toEqual({ ok: true, closed: true, status: "done" });
    expect(db.query("SELECT status FROM stages").get()).toEqual({ status: "done" });
    expect(db.query("SELECT status, ended_at FROM runs").get()).toEqual({ status: "done", ended_at: 200 });
  });

  test("failed carries the reason and detailPath", () => {
    const db = standalone();
    expect(closeRun(db, { workType: "work", stage: "review", outcome: "failed", reason: "tests red", detailPath: "/tmp/d.txt" })).toMatchObject({ closed: true, status: "failed" });
    expect(db.query("SELECT status, reason, detail_path FROM stages").get()).toEqual({ status: "failed", reason: "tests red", detail_path: "/tmp/d.txt" });
  });

  test("a run with no manifest rows closes when the work type matches", () => {
    const db = mkdb();
    expect(stageStart(db, "review", {}).ok).toBe(true);
    expect(closeRun(db, { workType: "work", stage: "review", outcome: "abandoned" })).toMatchObject({ ok: true, status: "abandoned" });
  });

  test("a finished run is not closed again; the same outcome repeats without writes", () => {
    const db = standalone();
    expect(closeRun(db, { workType: "work", stage: "review", outcome: "done", now: 200 }).ok).toBe(true);
    const before = JSON.stringify([db.query("SELECT * FROM runs").all(), db.query("SELECT * FROM stages").all()]);
    expect(closeRun(db, { workType: "work", stage: "review", outcome: "done", now: 900 })).toEqual({ ok: true, closed: true, status: "done" });
    expect(closeRun(db, { workType: "work", stage: "review", outcome: "failed", reason: "late" })).toEqual({
      ok: false,
      error: "this run is done; nothing to close",
      code: 2,
    });
    expect(JSON.stringify([db.query("SELECT * FROM runs").all(), db.query("SELECT * FROM stages").all()])).toBe(before);
  });

  test("refuses a stage other than the single manifest stage, and a stage with no row on an empty manifest", () => {
    const db = standalone();
    expect(closeRun(db, { workType: "work", stage: "ship", outcome: "done" })).toMatchObject({ ok: false, code: 2 });
    expect(db.query("SELECT status FROM runs").get()).toEqual({ status: "running" });
    const bare = mkdb();
    expect(closeRun(bare, { workType: "work", stage: "review", outcome: "done" })).toMatchObject({ ok: false, code: 3 });
    expect(bare.query("SELECT status FROM runs").get()).toEqual({ status: "running" });
  });

  test("abandoned ends a running row failed with the reason defaulting to abandoned", () => {
    const db = standalone();
    expect(closeRun(db, { workType: "work", stage: "review", outcome: "abandoned" })).toMatchObject({ status: "abandoned" });
    expect(db.query("SELECT status, reason FROM stages").get()).toEqual({ status: "failed", reason: "abandoned" });
  });

  test("refuses another work type and a multi-stage manifest, writing nothing", () => {
    const db = standalone();
    expect(closeRun(db, { workType: "ship", stage: "review", outcome: "done" })).toEqual({
      ok: false,
      error: "this run belongs to work; an inherited run closes nothing",
      code: 2,
    });
    writeManifest(db, [{ stage: "review", consumes: [], produces: [] }, { stage: "ship", consumes: [], produces: [] }], null);
    expect(closeRun(db, { workType: "work", stage: "review", outcome: "done" })).toEqual({
      ok: false,
      error: "a pipeline run closes through run_resolve",
      code: 2,
    });
    expect(db.query("SELECT status FROM runs").get()).toEqual({ status: "running" });
    expect(db.query("SELECT status FROM stages").get()).toEqual({ status: "running" });
  });
});
