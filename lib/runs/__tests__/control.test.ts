import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { holdAtNextStep, requestRedo } from "../control.ts";
import { writeManifest } from "../engine.ts";
import { createRunDb, openRunDb, runStatus, stageEnd, stageStart } from "../write.ts";

const REPO = "remote:acme";
const dirs: string[] = [];

afterEach(() => {
  delete process.env.RT_RUNS_ROOT;
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function seed(runId: string, o: { at?: string; status?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "rt-runs-control-"));
  dirs.push(root);
  process.env.RT_RUNS_ROOT = root;
  mkdirSync(join(root, REPO, runId), { recursive: true });
  const path = join(root, REPO, runId, "state.db");
  const db = createRunDb(path);
  db.run("INSERT INTO runs (id, repo, work_type, pipeline, status, started_at) VALUES (?, ?, 'work', 'work', 'running', 1)", [runId, REPO]);
  writeManifest(db, ["plan", "implement", "self-review"].map((stage) => ({ stage, consumes: [], produces: [] })), null);
  expect(stageStart(db, "plan", {}).ok).toBe(true);
  if (o.at === "implement") {
    expect(stageEnd(db, "plan", "done").ok).toBe(true);
    expect(stageStart(db, "implement", {}).ok).toBe(true);
  }
  if (o.status) expect(runStatus(db, o.status).ok).toBe(true);
  db.close();
  return path;
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
    holdAtNextStep(REPO, "r-hold2", { reason: "paused from the console", decidedBy: "console", now: 10 });
    const r = holdAtNextStep(REPO, "r-hold2", { reason: "again", decidedBy: "console", now: 20 });
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

  test("an empty or oversized note refuses with bad-note", () => {
    const path = seed("r-note");
    expect(requestRedo(REPO, "r-note", { ...redo, note: "  " })).toEqual({ ok: false, code: "bad-note", error: "Redo needs a note for the worker" });
    expect(requestRedo(REPO, "r-note", { ...redo, note: "x".repeat(2001) })).toMatchObject({ code: "bad-note" });
    expect(field(path, "redo")).toBeUndefined();
  });
});
