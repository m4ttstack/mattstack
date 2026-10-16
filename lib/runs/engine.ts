/**
 * The run engine's DB-level foundation: manifest rows, stage positions, hold
 * and budget. The engine never writes `gate` or `waiting-gate`, and never
 * refuses on a spent budget.
 */
import type { Database } from "bun:sqlite";
import { join } from "path";
import { decisionRecord, fieldSet, runStatus, stageEnd, stageStart, type Fail, type Ok } from "./write.ts";

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

const NO_MANIFEST = "this run has no pipeline manifest; resume it with run_enter to record one";

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
      if (manifest.length === 0) return refuse(NO_MANIFEST);
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

export type ResolveNext = "retry" | "redirect" | "iterate" | "hold" | "abandon" | "done";
export type ResolveResult =
  | { applied: "retry"; next: Position; cleared: string[] }
  | { applied: "redirect" | "iterate"; next: Position; cleared: string[] }
  | { applied: "hold"; held: { at: Position; scope: string } }
  | { applied: "abandon" | "done"; status: string };

function latestStatus(db: Database, stage: string): StageStatus | null {
  const row = db.query("SELECT status FROM stages WHERE name = ? ORDER BY attempt DESC LIMIT 1").get(stage) as { status: StageStatus } | undefined;
  return row?.status ?? null;
}

function clearConsent(db: Database, stage: string, now: number): string[] {
  const keys = CONSENT_FIELDS[stage] ?? [];
  for (const key of keys) must(fieldSet(db, key, "-", stage, now));
  return keys.slice();
}

export function resolveStage(
  db: Database,
  o: { stage: string; next: ResolveNext; to?: string; note?: string; decidedBy: string; env: NodeJS.ProcessEnv; now?: number },
): Ok<ResolveResult> | Fail {
  const now = o.now ?? Date.now();
  if (o.decidedBy.trim() === "") return refuse("run_resolve needs decidedBy");
  const manifest = readManifest(db);
  if (manifest.length === 0) return refuse(NO_MANIFEST);
  const names = manifest.map((m) => m.stage);
  const index = names.indexOf(o.stage);
  if (index < 0) return refuse(`stage ${o.stage} is not in this run's pipeline manifest (stages: ${names.join(", ")})`);

  const run = db.query("SELECT status FROM runs LIMIT 1").get() as { status: string } | undefined;
  if (!run) return refuse("this run has no run row");
  if (run.status !== "running") {
    if (o.next === "done" && run.status === "done") return { ok: true, applied: "done", status: "done" };
    return refuse(`this run is ${run.status}; nothing to resolve`);
  }

  if (o.next === "hold") {
    const r = holdStage(db, { stage: o.stage, reason: o.note, decidedBy: o.decidedBy, now });
    return r.ok ? { ok: true, applied: "hold", held: { at: r.at, scope: r.scope } } : r;
  }

  try {
    return db.transaction((): Ok<ResolveResult> | Fail => {
      const status = latestStatus(db, o.stage);

      if (o.next === "retry") {
        if (status !== "failed") return refuse(`stage ${o.stage} cannot be retried: ${status ? `its latest attempt is ${status}` : "it has no row"}, not failed`);
        const cleared = clearConsent(db, o.stage, now);
        must(stageStart(db, o.stage, o.env, now));
        return { ok: true, applied: "retry", next: positionOf(db, o.stage)!, cleared };
      }

      if (o.next === "redirect" || o.next === "iterate") {
        const to = o.to ?? (o.next === "iterate" ? o.stage : undefined);
        if (to === undefined) return refuse("redirect needs a target stage (to)");
        const toIndex = names.indexOf(to);
        if (toIndex < 0) return refuse(`stage ${to} is not in this run's pipeline manifest (stages: ${names.join(", ")})`);
        if (toIndex > index) return refuse(`cannot redirect ${o.stage} forward to ${to}; the target must be ${o.stage} or an earlier stage`);
        const from = positionOf(db, o.stage);
        if (!from) return { ok: false, error: `stage ${o.stage} has no row in this run`, code: 3 };

        const reason = o.note ?? `redirected to ${to}`;
        must(
          decisionRecord(db, {
            contract: "gate@1",
            scope: `redirect:${o.stage}:${from.attempt}`,
            selection: JSON.stringify({ from: o.stage, to, reason }),
            decidedBy: o.decidedBy,
            now,
          }),
        );
        if (from.status === "running") must(stageEnd(db, o.stage, "redirected", { reason, now }));

        const cleared: string[] = [];
        for (const m of manifest.slice(toIndex)) {
          for (const key of m.produces) {
            must(fieldSet(db, key, "-", to, now));
            cleared.push(key);
          }
        }
        for (const m of manifest.slice(toIndex)) cleared.push(...clearConsent(db, m.stage, now));
        must(stageStart(db, to, o.env, now));
        return { ok: true, applied: o.next, next: positionOf(db, to)!, cleared };
      }

      if (o.next === "abandon") {
        if (status === "running") must(stageEnd(db, o.stage, "failed", { reason: o.note ?? "abandoned", now }));
        must(runStatus(db, "abandoned", now));
        return { ok: true, applied: "abandon", status: "abandoned" };
      }

      if (index !== names.length - 1 || status !== "done") {
        return refuse(`run cannot be marked done at ${o.stage}: done needs the last stage (${names[names.length - 1]}) with a done row`);
      }
      must(runStatus(db, "done", now));
      return { ok: true, applied: "done", status: "done" };
    })();
  } catch (err) {
    return failOf(err);
  }
}

export function closeRun(
  db: Database,
  o: { workType: string; stage: string; outcome: "done" | "failed" | "abandoned"; reason?: string; detailPath?: string; now?: number },
): Ok<{ closed: true; status: string }> | Fail {
  const now = o.now ?? Date.now();
  try {
    return db.transaction((): Ok<{ closed: true; status: string }> | Fail => {
      const run = db.query("SELECT work_type, status FROM runs LIMIT 1").get() as { work_type: string; status: string } | undefined;
      if (!run) return refuse("this run has no run row");
      if (run.work_type !== o.workType) return refuse(`this run belongs to ${run.work_type}; an inherited run closes nothing`);
      const manifest = readManifest(db);
      if (manifest.length > 1) return refuse("a pipeline run closes through run_resolve");
      const status = latestStatus(db, o.stage);
      if (manifest.length === 1 && manifest[0]!.stage !== o.stage) {
        return refuse(`stage ${o.stage} is not this run's stage (${manifest[0]!.stage})`);
      }
      if (manifest.length === 0 && status === null) return { ok: false, error: `stage ${o.stage} has no row in this run`, code: 3 };
      if (run.status !== "running") {
        if (run.status === o.outcome) return { ok: true, closed: true, status: run.status };
        return refuse(`this run is ${run.status}; nothing to close`);
      }
      if (status === "running") {
        const reason = o.reason ?? (o.outcome === "abandoned" ? "abandoned" : undefined);
        must(stageEnd(db, o.stage, o.outcome === "done" ? "done" : "failed", { reason, detailPath: o.detailPath, now }));
      }
      must(runStatus(db, o.outcome, now));
      return { ok: true, closed: true, status: o.outcome };
    })();
  } catch (err) {
    return failOf(err);
  }
}
