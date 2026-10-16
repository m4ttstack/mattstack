/**
 * The run engine's DB-level foundation: manifest rows, stage positions, hold
 * and budget. The engine never writes `gate` or `waiting-gate`, and never
 * refuses on a spent budget.
 */
import type { Database } from "bun:sqlite";
import { join } from "path";
import { decisionRecord, fieldSet, stageEnd, stageStart, type Fail, type Ok } from "./write.ts";

export type StageStatus = "running" | "done" | "failed" | "redirected";
export type Position = { stage: string; attempt: number; status: StageStatus; file: string | null };
export type ManifestStage = {
  ordinal: number;
  stage: string;
  name: string | null;
  file: string | null;
  packRoot: string | null;
  consumes: string[];
  produces: string[];
};
export type ManifestInput = { stage: string; name?: string; file?: string; consumes: string[]; produces: string[] };

export const CONSENT_FIELDS: Readonly<Record<string, readonly string[]>> = { ship: ["shipTarget"] };

type ManifestRow = {
  ordinal: number;
  stage: string;
  name: string | null;
  file: string | null;
  pack_root: string | null;
  consumes: string;
  produces: string;
};

function sqliteFail(err: unknown): Fail {
  return { ok: false, error: `sqlite write failed: ${String(err)}`, code: 1 };
}

// write.ts helpers return Fail instead of throwing; throwing it inside a
// transaction rolls every earlier write back, and failOf maps it back out.
class FailError extends Error {
  constructor(readonly fail: Fail) {
    super(fail.error);
  }
}

function must<T extends { ok: boolean }>(r: T | Fail): T {
  if (!r.ok) throw new FailError(r as Fail);
  return r as T;
}

function failOf(err: unknown): Fail {
  return err instanceof FailError ? err.fail : sqliteFail(err);
}

export function readManifest(db: Database): ManifestStage[] {
  const rows = db.query("SELECT ordinal, stage, name, file, pack_root, consumes, produces FROM manifest ORDER BY ordinal").all() as ManifestRow[];
  return rows.map((r) => ({
    ordinal: r.ordinal,
    stage: r.stage,
    name: r.name,
    file: r.file,
    packRoot: r.pack_root,
    consumes: JSON.parse(r.consumes) as string[],
    produces: JSON.parse(r.produces) as string[],
  }));
}

export function writeManifest(db: Database, stages: ManifestInput[], packRoot: string | null): void {
  db.transaction(() => {
    db.run("DELETE FROM manifest");
    stages.forEach((s, i) => {
      db.run(
        "INSERT INTO manifest (run_id, ordinal, stage, name, file, pack_root, consumes, produces) SELECT id, ?, ?, ?, ?, ?, ?, ? FROM runs",
        [i, s.stage, s.name ?? null, s.file ?? null, packRoot, JSON.stringify(s.consumes), JSON.stringify(s.produces)],
      );
    });
  })();
}

export function setManifestRoot(db: Database, packRoot: string): void {
  db.run("UPDATE manifest SET pack_root = ?", [packRoot]);
}

export function positionOf(db: Database, stage: string): Position | null {
  const row = db.query("SELECT attempt, status FROM stages WHERE name = ? ORDER BY attempt DESC LIMIT 1").get(stage) as
    | { attempt: number; status: StageStatus }
    | undefined;
  if (!row) return null;
  const m = db.query("SELECT file, pack_root FROM manifest WHERE stage = ? ORDER BY ordinal LIMIT 1").get(stage) as
    | { file: string | null; pack_root: string | null }
    | undefined;
  const file = m?.file && m.pack_root ? join(m.pack_root, m.file) : (m?.file ?? null);
  return { stage, attempt: row.attempt, status: row.status, file };
}

export function cleared(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  const t = value.trim();
  return t === "" || t === "-";
}

export function holdStage(
  db: Database,
  o: { stage: string; reason?: string; decidedBy: string; now?: number },
): Ok<{ held: true; at: Position; scope: string }> | Fail {
  const reason = o.reason ?? "held";
  try {
    return db.transaction((): Ok<{ held: true; at: Position; scope: string }> | Fail => {
      const at = positionOf(db, o.stage);
      if (!at) return { ok: false, error: `stage ${o.stage} has no row in this run`, code: 3 };
      const scope = `hold:${o.stage}:${at.attempt}`;
      const d = decisionRecord(db, { contract: "gate@1", scope, selection: JSON.stringify({ reason }), decidedBy: o.decidedBy, now: o.now });
      must(d);
      must(fieldSet(db, "hold", reason, o.stage, o.now));
      return { ok: true, held: true, at, scope };
    })();
  } catch (err) {
    return failOf(err);
  }
}

export function budget(
  db: Database,
  o: { key: string; limit: number; increment?: number; stage?: string; now?: number },
): Ok<{ key: string; spent: number; limit: number; remaining: number; exhausted: boolean }> | Fail {
  const increment = o.increment ?? 1;
  if (o.key.length < 1 || o.key.length > 200 || /[\x00-\x1f\x7f]/.test(o.key)) {
    return { ok: false, error: "budget key must be 1-200 characters with no control characters", code: 2 };
  }
  if (!Number.isInteger(o.limit) || o.limit < 1) return { ok: false, error: "budget limit must be an integer of at least 1", code: 2 };
  if (!Number.isInteger(increment) || increment < 0) return { ok: false, error: "budget increment must be an integer of at least 0", code: 2 };
  try {
    return db.transaction((): Ok<{ key: string; spent: number; limit: number; remaining: number; exhausted: boolean }> | Fail => {
      let stored = o.key;
      if (o.stage !== undefined) {
        const at = positionOf(db, o.stage);
        if (!at) return { ok: false, error: `stage ${o.stage} has no row in this run`, code: 3 };
        stored = `${o.stage}:${at.attempt}:${o.key}`;
      }
      // WHERE true: without it SQLite reads ON CONFLICT after a bare SELECT as a join clause.
      const row = db
        .query(
          `INSERT INTO budgets (run_id, key, spent, "limit", updated_at) SELECT id, ?, ?, ?, ? FROM runs WHERE true
           ON CONFLICT(run_id, key) DO UPDATE SET spent = spent + excluded.spent, "limit" = excluded."limit", updated_at = excluded.updated_at
           RETURNING spent`,
        )
        .get(stored, increment, o.limit, o.now ?? Date.now()) as { spent: number };
      return { ok: true, key: o.key, spent: row.spent, limit: o.limit, remaining: Math.max(0, o.limit - row.spent), exhausted: row.spent >= o.limit };
    })();
  } catch (err) {
    return sqliteFail(err);
  }
}

export type NextResult =
  | { ended: "closed"; status: string }
  | { ended: "failed"; at: Position; reason: string | null; detailPath: string | null; missing?: string[]; scope: string; earlier: string[] }
  | { ended: "held"; at: Position; reason: string }
  | { ended: "waiting"; at: Position; gate: string }
  | { ended: "done"; next: Position; repeated?: true }
  | { ended: "done"; last: true; stages: string[]; scope: "close"; repeated?: true };

type StageRow = { attempt: number; status: StageStatus; started_at: number | null; reason: string | null; detail_path: string | null };

function refuse(error: string): Fail {
  return { ok: false, error, code: 2 };
}

function fieldAfter(db: Database, key: string, since: number): string | null {
  const row = db.query("SELECT value, at FROM fields WHERE key = ?").get(key) as { value: string; at: number } | undefined;
  return row && row.at >= since && !cleared(row.value) ? row.value : null;
}

export function nextStage(db: Database, o: { stage: string; env: NodeJS.ProcessEnv; now?: number }): Ok<NextResult> | Fail {
  const now = o.now ?? Date.now();
  try {
    return db.transaction((): Ok<NextResult> | Fail => {
      const run = db.query("SELECT status, current_stage FROM runs LIMIT 1").get() as { status: string; current_stage: string | null } | undefined;
      if (!run) return refuse("this run has no run row");
      if (run.status !== "running") return { ok: true, ended: "closed", status: run.status };

      const manifest = readManifest(db);
      if (manifest.length === 0) return refuse("this run has no pipeline manifest; resume it with run_enter to record one");
      const index = manifest.findIndex((m) => m.stage === o.stage);
      if (index < 0) return refuse(`stage ${o.stage} is not in this run's pipeline manifest`);
      const entry = manifest[index]!;

      const row = db
        .query("SELECT attempt, status, started_at, reason, detail_path FROM stages WHERE name = ? ORDER BY attempt DESC LIMIT 1")
        .get(o.stage) as StageRow | undefined;
      const mismatch = (): Fail =>
        refuse(
          `stage ${o.stage} is not the run's current stage (current stage ${run.current_stage ?? "none"}; ${o.stage} ${row ? `is ${row.status}` : "was never started"})`,
        );
      if (!row) return mismatch();

      const earlier = (): string[] =>
        manifest
          .slice(0, index)
          .filter((m) => db.query("SELECT 1 FROM stages WHERE name = ? LIMIT 1").get(m.stage))
          .map((m) => m.stage);
      const failed = (at: Position, reason: string | null, detailPath: string | null, missing?: string[]): Ok<NextResult> => ({
        ok: true,
        ended: "failed",
        at,
        reason,
        detailPath,
        ...(missing ? { missing } : {}),
        scope: `${o.stage}-failed:${at.attempt}`,
        earlier: earlier(),
      });

      if (row.status === "failed") return failed(positionOf(db, o.stage)!, row.reason, row.detail_path);

      const following = manifest[index + 1];
      const finished = (repeated: boolean): Ok<NextResult> =>
        following
          ? { ok: true, ended: "done", next: positionOf(db, following.stage)!, ...(repeated ? { repeated: true as const } : {}) }
          : { ok: true, ended: "done", last: true, stages: manifest.map((m) => m.stage), scope: "close", ...(repeated ? { repeated: true as const } : {}) };

      if (row.status === "done") {
        if (run.current_stage === o.stage && !following) return finished(true);
        if (following && run.current_stage === following.stage && positionOf(db, following.stage)?.status === "running") return finished(true);
        return mismatch();
      }
      if (row.status !== "running" || run.current_stage !== o.stage) return mismatch();

      const since = row.started_at ?? 0;
      const at = positionOf(db, o.stage)!;
      const held = fieldAfter(db, "hold", since);
      if (held !== null) return { ok: true, ended: "held", at, reason: held };
      const gate = fieldAfter(db, "waiting-gate", since);
      if (gate !== null) return { ok: true, ended: "waiting", at, gate };

      const missing = entry.produces.filter((key) => {
        const f = db.query("SELECT value FROM fields WHERE key = ?").get(key) as { value: string } | undefined;
        return cleared(f?.value);
      });
      if (missing.length > 0) {
        const reason = `missing produce: ${missing.join(", ")}`;
        must(stageEnd(db, o.stage, "failed", { reason, now }));
        return failed(positionOf(db, o.stage)!, reason, null, missing);
      }

      must(stageEnd(db, o.stage, "done", { now }));
      if (following) {
        const hold = db.query("SELECT value FROM fields WHERE key = 'hold'").get() as { value: string } | undefined;
        if (hold && !cleared(hold.value)) must(fieldSet(db, "hold", "-", following.stage, now));
        must(stageStart(db, following.stage, o.env, now));
      }
      return finished(false);
    })();
  } catch (err) {
    return failOf(err);
  }
}
