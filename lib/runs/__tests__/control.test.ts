import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { holdAtNextStep, requestRedo } from "../control.ts";
import { nextStage, resolveStage, writeManifest } from "../engine.ts";
import { createRunDb, fieldSet, openRunDb, runStatus, stageEnd, stageStart } from "../write.ts";

const REPO = "remote:acme";
const dirs: string[] = [];

afterEach(() => {
  delete process.env.RT_RUNS_ROOT;
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function seed(runId: string, o: { at?: "implement" | "self-review"; status?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "rt-runs-control-"));
  dirs.push(root);
  process.env.RT_RUNS_ROOT = root;
  mkdirSync(join(root, REPO, runId), { recursive: true });
  const path = join(root, REPO, runId, "state.db");
  const db = createRunDb(path);
  db.run("INSERT INTO runs (id, repo, work_type, pipeline, status, started_at) VALUES (?, ?, 'work', 'work', 'running', 1)", [runId, REPO]);
  writeManifest(db, ["plan", "implement", "self-review"].map((stage) => ({ stage, consumes: [], produces: [] })), null);
  expect(stageStart(db, "plan", {}, 100).ok).toBe(true);
  if (o.at) {
    expect(stageEnd(db, "plan", "done", { now: 110 }).ok).toBe(true);
    expect(stageStart(db, "implement", {}, 120).ok).toBe(true);
  }
  if (o.at === "self-review") {
    expect(stageEnd(db, "implement", "done", { now: 130 }).ok).toBe(true);
    expect(stageStart(db, "self-review", {}, 140).ok).toBe(true);
  }
  if (o.status) expect(runStatus(db, o.status).ok).toBe(true);
  db.close();
  return path;
}

function withDb<T>(path: string, body: (db: ReturnType<typeof openRunDb>) => T): T {
  const db = openRunDb(path);
  try {
    return body(db);
  } finally {
    db.close();
  }
}

function read(path: string, sql: string): unknown {
  const db = openRunDb(path);
  try {
    return db.query(sql).get();
  } finally {
    db.close();
  }
}

const field = (path: string, key: string) => (read(path, `SELECT value FROM fields WHERE key = '${key}'`) as { value: string } | null)?.value;

const redo = { gate: "g-1", to: "plan", note: "use the shared helper", headCommit: "abc1234", by: "console" };

describe("holdAtNextStep", () => {
  test("holds the current stage with a hold decision by console", () => {
    const path = seed("r-hold");
    const r = holdAtNextStep(REPO, "r-hold", { reason: "paused from the console", decidedBy: "console" });
    expect(r).toEqual({ ok: true, stage: "plan" });
    expect(field(path, "hold")).toBe("paused from the console");
    const d = read(path, "SELECT decided_by FROM decisions WHERE scope = 'hold:plan:1'") as { decided_by: string } | null;
    expect(d?.decided_by).toBe("console");
  });

  test("a second hold reports already and writes nothing", () => {
    const path = seed("r-hold2");
    holdAtNextStep(REPO, "r-hold2", { reason: "paused from the console", decidedBy: "console", now: 150 });
    const r = holdAtNextStep(REPO, "r-hold2", { reason: "again", decidedBy: "console", now: 160 });
    expect(r).toEqual({ ok: true, stage: "plan", already: true });
    expect(field(path, "hold")).toBe("paused from the console");
  });

  test("a finished run refuses with finished", () => {
    seed("r-done", { status: "done" });
    expect(holdAtNextStep(REPO, "r-done", { reason: "x", decidedBy: "console" })).toEqual({ ok: false, code: "finished", error: "this run has finished" });
  });

  test("an unknown run refuses with not-found", () => {
    seed("r-any");
    expect(holdAtNextStep(REPO, "nope", { reason: "x", decidedBy: "console" })).toEqual({ ok: false, code: "not-found", error: "no run nope" });
  });

  test("a stale hold does not swallow a Pause", () => {
    const path = seed("r-stale", { at: "implement" });
    withDb(path, (db) => expect(fieldSet(db, "hold", "from plan", "plan", 105).ok).toBe(true));
    expect(holdAtNextStep(REPO, "r-stale", { reason: "paused from the console", decidedBy: "console", now: 150 })).toEqual({ ok: true, stage: "implement" });
    expect(field(path, "hold")).toBe("paused from the console");
    expect(withDb(path, (db) => nextStage(db, { stage: "implement", env: {}, now: 200 }))).toMatchObject({ ended: "held" });
  });

  test("Pause, then the worker's redirect, then a second Pause still holds at run_next", () => {
    const path = seed("r-probe", { at: "self-review" });
    expect(holdAtNextStep(REPO, "r-probe", { reason: "paused from the console", decidedBy: "console", now: 150 })).toEqual({ ok: true, stage: "self-review" });
    withDb(path, (db) =>
      expect(resolveStage(db, { stage: "self-review", next: "redirect", to: "implement", note: "fix", attempt: 1, decidedBy: "pane", env: {}, now: 160 })).toMatchObject({ ok: true }),
    );
    expect(holdAtNextStep(REPO, "r-probe", { reason: "paused from the console", decidedBy: "console", now: 170 })).toEqual({ ok: true, stage: "implement", already: true });
    expect(withDb(path, (db) => nextStage(db, { stage: "implement", env: {}, now: 200 }))).toMatchObject({ ended: "held", at: { stage: "implement", attempt: 2 } });
  });
});

describe("holdAtNextStep at a gate", () => {
  test("a done current stage refuses with not-running and writes nothing", () => {
    const path = seed("r-hold-close", { at: "self-review" });
    withDb(path, (db) => expect(stageEnd(db, "self-review", "done", { now: 150 }).ok).toBe(true));
    expect(holdAtNextStep(REPO, "r-hold-close", { reason: "paused from the console", decidedBy: "console", now: 160 })).toEqual({
      ok: false,
      code: "not-running",
      error: "answer the open gate first",
    });
    expect(field(path, "hold")).toBeUndefined();
  });

  test("a failed current stage still takes a Pause", () => {
    const path = seed("r-hold-failed", { at: "implement" });
    withDb(path, (db) => expect(stageEnd(db, "implement", "failed", { reason: "red", now: 150 }).ok).toBe(true));
    expect(holdAtNextStep(REPO, "r-hold-failed", { reason: "paused from the console", decidedBy: "console", now: 160 })).toEqual({ ok: true, stage: "implement" });
    expect(field(path, "hold")).toBe("paused from the console");
  });
});

describe("requestRedo", () => {
  test("writes the redo request as JSON with by console", () => {
    const path = seed("r-redo", { at: "implement" });
    expect(requestRedo(REPO, "r-redo", { ...redo, now: 42 })).toEqual({ ok: true });
    expect(JSON.parse(field(path, "redo")!)).toEqual({ ...redo, at: 42 });
  });

  test("a second redo refuses with pending and leaves the first", () => {
    const path = seed("r-redo2", { at: "implement" });
    requestRedo(REPO, "r-redo2", { ...redo, now: 1 });
    expect(requestRedo(REPO, "r-redo2", { ...redo, note: "other" })).toEqual({ ok: false, code: "pending", error: "a redo is already waiting for this run" });
    expect(JSON.parse(field(path, "redo")!).note).toBe(redo.note);
  });

  test("a stage after the current one refuses with ahead", () => {
    const path = seed("r-ahead");
    expect(requestRedo(REPO, "r-ahead", { ...redo, to: "self-review" })).toEqual({ ok: false, code: "ahead", error: "that gate's stage is ahead of where the run is now" });
    expect(field(path, "redo")).toBeUndefined();
  });

  test("a finished run refuses with finished", () => {
    seed("r-fin", { status: "abandoned" });
    expect(requestRedo(REPO, "r-fin", redo)).toMatchObject({ ok: false, code: "finished" });
  });

  test("a redo at the close gate refuses with not-running", () => {
    const path = seed("r-close", { at: "self-review" });
    withDb(path, (db) => expect(stageEnd(db, "self-review", "done", { now: 150 }).ok).toBe(true));
    expect(requestRedo(REPO, "r-close", { ...redo, now: 160 })).toEqual({ ok: false, code: "not-running", error: "answer the open gate first" });
    expect(field(path, "redo")).toBeUndefined();
  });

  test("a redo at a failure gate refuses with not-running", () => {
    const path = seed("r-failed", { at: "implement" });
    withDb(path, (db) => expect(stageEnd(db, "implement", "failed", { reason: "red", now: 150 }).ok).toBe(true));
    expect(requestRedo(REPO, "r-failed", { ...redo, now: 160 })).toMatchObject({ ok: false, code: "not-running" });
  });

  test("the close-gate sequence never sends a shipped run back", () => {
    const path = seed("r-ship", { at: "self-review" });
    withDb(path, (db) => expect(nextStage(db, { stage: "self-review", env: {}, now: 150 })).toMatchObject({ ended: "done", last: true }));
    expect(requestRedo(REPO, "r-ship", { ...redo, now: 160 })).toMatchObject({ ok: false, code: "not-running" });
    withDb(path, (db) => {
      expect(resolveStage(db, { stage: "self-review", next: "done", decidedBy: "pane", env: {}, now: 170 })).toMatchObject({ applied: "done" });
      expect(stageStart(db, "self-review", {}, 500, { reopen: true })).toEqual({ ok: true });
      const r = nextStage(db, { stage: "self-review", env: {}, now: 600 });
      expect(r).toMatchObject({ ok: true });
      expect(r).not.toMatchObject({ ended: "redirected" });
    });
  });

  test("a gate from an earlier pass of its stage refuses with stale", () => {
    const path = seed("r-old", { at: "implement" });
    withDb(path, (db) => {
      expect(stageEnd(db, "implement", "redirected", { reason: "again", now: 130 }).ok).toBe(true);
      expect(stageStart(db, "implement", {}, 140).ok).toBe(true);
    });
    expect(requestRedo(REPO, "r-old", { ...redo, to: "implement", openedAt: 125, now: 160 })).toEqual({
      ok: false,
      code: "stale",
      error: "that gate is from an earlier pass of its step",
    });
    expect(field(path, "redo")).toBeUndefined();
    expect(requestRedo(REPO, "r-old", { ...redo, to: "implement", openedAt: 145, now: 160 })).toEqual({ ok: true });
  });

  test("a second press after the redo applied refuses with stale", () => {
    const path = seed("r-twice", { at: "implement" });
    expect(requestRedo(REPO, "r-twice", { ...redo, openedAt: 105, now: 150 })).toEqual({ ok: true });
    withDb(path, (db) => expect(nextStage(db, { stage: "implement", env: {}, now: 200 })).toMatchObject({ ended: "redirected" }));
    expect(requestRedo(REPO, "r-twice", { ...redo, openedAt: 105, now: 210 })).toMatchObject({ ok: false, code: "stale" });
  });

  test("an empty or oversized note refuses with bad-note", () => {
    const path = seed("r-note");
    expect(requestRedo(REPO, "r-note", { ...redo, note: "  " })).toEqual({ ok: false, code: "bad-note", error: "Redo needs a note for the worker" });
    expect(requestRedo(REPO, "r-note", { ...redo, note: "x".repeat(2001) })).toMatchObject({ code: "bad-note" });
    expect(field(path, "redo")).toBeUndefined();
  });
});
