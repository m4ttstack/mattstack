import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { budget, cleared, holdStage, positionOf, readManifest, setManifestRoot, writeManifest } from "../engine.ts";
import { createRunDb, stageEnd, stageStart } from "../write.ts";

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
