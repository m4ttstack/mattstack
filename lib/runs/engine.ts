/**
 * The run engine's DB-level foundation: manifest rows, stage positions, hold
 * and budget. The engine never writes `gate` or `waiting-gate`, and never
 * refuses on a spent budget.
 */
import type { Database } from "bun:sqlite";
import { join } from "path";
import { decisionRecord, fieldSet, type Fail, type Ok } from "./write.ts";

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
      if (!d.ok) return d;
      const f = fieldSet(db, "hold", reason, o.stage, o.now);
      if (!f.ok) return f;
      return { ok: true, held: true, at, scope };
    })();
  } catch (err) {
    return sqliteFail(err);
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
