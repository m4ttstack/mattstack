/**
 * The operator's two live controls on a running run: Pause (today's hold) and
 * Redo (a pending request the engine applies at the worker's next run_next).
 * Opened like reconcile.ts: the daemon writes, the worker reads.
 */
import type { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { join } from "path";
import { attemptStart, fieldRow, fieldSince, holdStage, pendingRedo, positionOf, readManifest, type RedoRequest } from "./engine.ts";
import { isPathComponent, runsRoot } from "./store.ts";
import { fieldSet, openRunDb } from "./write.ts";

export type ControlCode = "not-found" | "finished" | "pending" | "ahead" | "no-stage" | "not-mode" | "bad-note" | "not-running" | "stale";
export type ControlFail = { ok: false; code: ControlCode; error: string };

export const REDO_NOTE_MAX = 2000;

/** The decider the console's Pause and Redo record under. */
export const CONSOLE_DECIDER = "console";

export const CONTROL_MESSAGES = {
  "bad-note": "Redo needs a note for the worker",
  "not-mode": "only a gate a mode answered can be redone",
  "no-stage": "that gate recorded no stage to go back to",
  finished: "this run has finished",
  ahead: "that gate's stage is ahead of where the run is now",
  pending: "a redo is already waiting for this run",
  "not-running": "answer the open gate first",
  stale: "that gate is from an earlier pass of its step",
} as const satisfies Partial<Record<ControlCode, string>>;

export function controlFail(code: ControlCode, error: string = (CONTROL_MESSAGES as Record<string, string>)[code] ?? code): ControlFail {
  return { ok: false, code, error };
}

export function badNote(note: string): boolean {
  const t = note.trim();
  return t === "" || t.length > REDO_NOTE_MAX;
}

type RunRow = { status: string; current_stage: string | null };

function withRun<T>(repo: string, runId: string, body: (db: Database, run: RunRow) => T | ControlFail): T | ControlFail {
  if (!isPathComponent(repo) || !isPathComponent(runId)) return controlFail("not-found", `no run ${runId}`);
  const path = join(runsRoot(), repo, runId, "state.db");
  if (!existsSync(path)) return controlFail("not-found", `no run ${runId}`);
  const db = openRunDb(path);
  try {
    return db.transaction((): T | ControlFail => {
      const run = db.query("SELECT status, current_stage FROM runs LIMIT 1").get() as RunRow | undefined;
      if (!run) return controlFail("not-found", `no run ${runId}`);
      if (run.status !== "running") return controlFail("finished");
      return body(db, run);
    }).immediate();
  } finally {
    db.close();
  }
}

export function holdAtNextStep(
  repo: string,
  runId: string,
  o: { reason: string; decidedBy: string; now?: number },
): { ok: true; stage: string; already?: true } | ControlFail {
  return withRun(repo, runId, (db, run) => {
    const stage = run.current_stage;
    if (!stage || !positionOf(db, stage)) return controlFail("no-stage", "this run has no step to pause at");
    if (fieldSince(fieldRow(db, "hold"), attemptStart(db, stage)) !== null) return { ok: true as const, stage, already: true as const };
    const held = holdStage(db, { stage, reason: o.reason, decidedBy: o.decidedBy, now: o.now });
    if (!held.ok) throw new Error(held.error);
    return { ok: true as const, stage };
  });
}

export function requestRedo(
  repo: string,
  runId: string,
  r: { gate: string; to: string; note: string; headCommit: string | null; by: string; openedAt?: number; now?: number },
): { ok: true } | ControlFail {
  if (badNote(r.note)) return controlFail("bad-note");
  return withRun(repo, runId, (db, run) => {
    if (pendingRedo(db)) return controlFail("pending");
    if (!run.current_stage || positionOf(db, run.current_stage)?.status !== "running") return controlFail("not-running");
    const toStarted = attemptStart(db, r.to);
    if (r.openedAt !== undefined && toStarted !== null && r.openedAt < toStarted) return controlFail("stale");
    const order = readManifest(db).map((m) => m.stage);
    const toIndex = order.indexOf(r.to);
    const atIndex = run.current_stage ? order.indexOf(run.current_stage) : -1;
    if (toIndex >= 0 && atIndex >= 0 && toIndex > atIndex) return controlFail("ahead");
    const now = r.now ?? Date.now();
    const request: RedoRequest = { gate: r.gate, to: r.to, note: r.note.trim(), headCommit: r.headCommit, by: r.by, at: now };
    const wrote = fieldSet(db, "redo", JSON.stringify(request), run.current_stage ?? r.to, now);
    if (!wrote.ok) throw new Error(wrote.error);
    return { ok: true as const };
  });
}
