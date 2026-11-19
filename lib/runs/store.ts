/**
 * The run DB's read side. Every open here is readonly and per-call, no held
 * connections, so a run dir can be pruned under us. Writes live in write.ts.
 */
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, statSync, type Dirent } from "fs";
import { join } from "path";
import type { Attention, RunDecisionRow, RunDetail, RunFieldRow, RunStageRow, RunSummary } from "../../packages/rt-client/src/commands.ts";
import { evidenceShots, readEvidence } from "../../packages/rt-client/src/evidence.ts";
import { computeAttention, fieldValue, lastEventAt, type RunLiveness } from "./attention.ts";
import { fieldSince, parseRedo } from "./engine.ts";
import { buildOutcome, mrRole, readAllCachedOutcomes, readCachedOutcome, type CachedOutcome } from "./outcome.ts";
import { isPathComponent, runsRoot } from "./paths.ts";
import { KNOWN_SCHEMA_VERSION } from "./write.ts";

export { isPathComponent, KNOWN_SCHEMA_VERSION, runsRoot };

function dirs(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true }).filter((d: Dirent) => d.isDirectory()).map((d: Dirent) => d.name);
  } catch {
    return [];
  }
}

/**
 * The repo keys `listRuns` currently has dirs for -- what the CLI's `--repo`
 * filter checks a raw, unresolvable arg against before it decides the arg
 * names a real (if pre-cutover) run-dir key rather than an unknown repo.
 */
export function listRunRepoDirs(): string[] {
  return dirs(runsRoot());
}

function openRun(repo: string, runId: string): { db: Database; schemaAhead: boolean } | null {
  if (!isPathComponent(repo) || !isPathComponent(runId)) return null;
  const path = join(runsRoot(), repo, runId, "state.db");
  if (!existsSync(path)) return null;
  // Bun's sqlite constructor itself throws for a state.db that isn't a
  // readable database file (a directory, a permission-denied path) --
  // one bad run dir must not abort every caller's scan of the rest.
  let db: Database;
  try {
    db = new Database(path, { readonly: true });
  } catch {
    return null;
  }
  try {
    const ver = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    return { db, schemaAhead: ver > KNOWN_SCHEMA_VERSION };
  } catch {
    db.close();
    return null;
  }
}

// SELECT * plus an explicit map, not a named-column SELECT: a v1 db lacks
// pack_commits/pack_dirty entirely, and naming an absent column throws.
function runRow(db: Database): RunSummary | null {
  try {
    const r = db.query("SELECT * FROM runs LIMIT 1").get() as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      id: String(r.id), repo: String(r.repo), work_type: String(r.work_type),
      pipeline: String(r.pipeline), status: String(r.status),
      current_stage: (r.current_stage as string | null) ?? null,
      spawned_by: (r.spawned_by as string | null) ?? null,
      started_at: Number(r.started_at),
      ended_at: (r.ended_at as number | null) ?? null,
      pack_commits: (r.pack_commits as string | undefined) ?? null,
      pack_dirty: Number(r.pack_dirty ?? 0),
      attention: { needs: false, reason: null, evidence: "" },
      // Placeholders: withAttention/readRun overwrite these once they have
      // stages/fields/decisions in hand; this row is never returned as-is.
      last_event_at: Number(r.started_at),
      ticket: null,
      branch: null,
      test: null,
      session: null,
      mr: null,
    };
  } catch {
    return null;
  }
}

function stageRows(db: Database): RunStageRow[] {
  const rows = db.query("SELECT * FROM stages ORDER BY started_at, attempt").all() as Record<string, unknown>[];
  return rows.map((r) => ({
    name: String(r.name), status: String(r.status), attempt: Number(r.attempt),
    started_at: (r.started_at as number | null) ?? null,
    ended_at: (r.ended_at as number | null) ?? null,
    reason: (r.reason as string | undefined) ?? null,
    detail_path: (r.detail_path as string | undefined) ?? null,
  }));
}

function stageSummaries(stages: RunStageRow[]): NonNullable<RunSummary["stages"]> {
  return stages.map((s) => ({ name: s.name, status: s.status, started_at: s.started_at, ended_at: s.ended_at, attempt: s.attempt }));
}

// The same freshness rule run_next applies: a hold counts only for the attempt it was written during.
function controls(run: Pick<RunSummary, "current_stage">, stages: RunStageRow[], fields: RunFieldRow[]): Pick<RunSummary, "hold" | "redo"> {
  const current = stages.filter((s) => s.name === run.current_stage).sort((a, b) => b.attempt - a.attempt)[0];
  const holdRow = fields.find((f) => f.key === "hold");
  const reason = fieldSince(holdRow, current?.started_at ?? null);
  const redo = parseRedo(fields.find((f) => f.key === "redo")?.value);
  return {
    hold: reason && holdRow ? { reason, at: holdRow.at } : null,
    redo: redo ? { gate: redo.gate, to: redo.to, note: redo.note } : null,
  };
}

/** The summary's evidence counts: images and cases a v1 or v2 field records, links a legacy one names. */
function evidenceCounts(fields: RunFieldRow[]): { evidence_count: number; evidence_links: number; evidence_cases: number } {
  const record = readEvidence(fieldValue(fields, "evidence"));
  if (record.version === 2) {
    const images = evidenceShots(record).reduce((n, { shot }) => n + (shot.annotated ? 2 : 1), 0);
    return { evidence_count: images, evidence_links: 0, evidence_cases: record.cases.length };
  }
  return { evidence_count: 0, evidence_links: record.version === 0 ? record.links.length : 0, evidence_cases: 0 };
}

// What buildOutcome reads from the run db; kept beside a cached summary so the
// kv-backed MR state can be merged in fresh on every list.
type OutcomeSource = { mrField: { value: string; produced_by: string } | null; decisions: RunDecisionRow[] };

function outcomeSource(fields: RunFieldRow[], decisions: RunDecisionRow[]): OutcomeSource {
  const mr = fields.find((f) => f.key === "mr");
  return { mrField: mr ? { value: mr.value, produced_by: mr.produced_by } : null, decisions };
}

function withOutcome(summary: RunSummary, src: OutcomeSource, cached: CachedOutcome | null): RunSummary {
  return { ...summary, outcome: buildOutcome(summary, src.mrField, src.decisions, cached) };
}

// A cache that cannot be read is a cold start: summaries list with an unknown MR state.
function cachedOutcomeFor(runId: string): CachedOutcome | null {
  try { return readCachedOutcome(runId); } catch { return null; }
}

// Loaded at most once per list, and only when some run has an mr field, so a
// list over runs with no MRs never opens the state db.
function lazyCachedOutcomes(): (runId: string) => CachedOutcome | null {
  let all: Record<string, CachedOutcome> | null = null;
  return (runId) => {
    if (!all) {
      try { all = readAllCachedOutcomes(); } catch { all = {}; }
    }
    return all[runId] ?? null;
  };
}

const NO_ATTENTION: Attention = { needs: false, reason: null, evidence: "" };

// The herdr mirror only means something while the run is live: a finished
// run's worktree often hosts whatever agent moved in next.
function agentMirror(run: RunSummary, fields: RunFieldRow[], liveness?: RunLiveness): RunSummary["agent"] {
  if (run.status !== "running" || !liveness) return null;
  return liveness.agentFor(fieldValue(fields, "claude-session"), fieldValue(fields, "worktree"));
}

// "-" is the cleared marker; only a work run's own MR counts, never one it reviewed.
function sessionAndMr(run: Pick<RunSummary, "work_type">, fields: RunFieldRow[]): Pick<RunSummary, "session" | "mr"> {
  const latest = fields.filter((f) => f.key === "mr").sort((a, b) => b.at - a.at)[0];
  const own = latest && mrRole(latest.produced_by, run.work_type) === "own" && /^https?:\/\//.test(latest.value);
  return { session: fieldValue(fields, "claude-session"), mr: own ? latest.value : null };
}

// What the DB holds for a run; null when its tables are missing (an
// interrupted run-start). Everything derived from the clock or liveness is
// computed from this per call, so it can be cached by file signature.
type RunData = { stages: RunStageRow[]; fields: RunFieldRow[]; decisions: RunDecisionRow[] } | null;

/** `cacheable` is false when a query failed for a reason other than a
    missing table (a lock, say): that answer must not stick until the next
    write to the run. */
function readRunData(db: Database): { data: RunData; cacheable: boolean } {
  try {
    return {
      data: {
        stages: stageRows(db),
        fields: db.query("SELECT key, value, produced_by, at FROM fields").all() as RunFieldRow[],
        decisions: db.query("SELECT contract, scope, selection, decided_by, decided_at FROM decisions").all() as RunDetail["decisions"],
      },
      cacheable: true,
    };
  } catch (err) {
    return { data: null, cacheable: isMissingTable(err) };
  }
}

function isMissingTable(err: unknown): boolean {
  return err instanceof Error && /no such table/i.test(err.message);
}

// A run whose tables are missing is still worth listing -- the store's
// contract is skip-the-broken-row, not throw, and listRuns has no catch
// around this call.
function withAttention(row: RunSummary, data: RunData, liveness?: RunLiveness): { summary: RunSummary; src: OutcomeSource } {
  const broken = { summary: { ...row, attention: NO_ATTENTION }, src: { mrField: null, decisions: [] } };
  if (!data) return broken;
  const { stages, fields, decisions } = data;
  try {
    return {
      summary: {
        ...row,
        attention: computeAttention(row, stages, fields, decisions, Date.now(), liveness),
        last_event_at: lastEventAt(row, stages, fields, decisions),
        ticket: fieldValue(fields, "ticket"),
        branch: fieldValue(fields, "branch"),
        test: fieldValue(fields, "test"),
        ...sessionAndMr(row, fields),
        agent: agentMirror(row, fields, liveness),
        stages: stageSummaries(stages),
        decision_count: decisions.length,
        ...evidenceCounts(fields),
        ...controls(row, stages, fields),
      },
      src: outcomeSource(fields, decisions),
    };
  } catch {
    return broken;
  }
}

/** Signature of a run DB's files. Runs write in WAL mode, so a write can
    land in -wal and leave state.db's mtime alone: the signature covers
    both, and any write to the run changes it. */
function runFilesSignature(dbPath: string): string | null {
  try {
    const db = statSync(dbPath);
    let wal = "0";
    try {
      const w = statSync(`${dbPath}-wal`);
      wal = `${w.mtimeMs}:${w.size}`;
    } catch { /* no -wal file: the run is checkpointed or never wrote in WAL */ }
    return `${db.ino}:${db.mtimeMs}:${db.size}:${wal}`;
  } catch {
    return null;
  }
}

// Keyed by state.db path. The signature is taken before the read, so a
// write racing the read only costs one extra reopen next call.
const runDataCache = new Map<string, { sig: string; row: RunSummary; data: RunData }>();

function cachedRunData(repo: string, id: string): { row: RunSummary; data: RunData } | null {
  const dbPath = join(runsRoot(), repo, id, "state.db");
  const sig = runFilesSignature(dbPath);
  if (sig === null) {
    runDataCache.delete(dbPath);
    return null;
  }
  const hit = runDataCache.get(dbPath);
  if (hit && hit.sig === sig) return hit;
  const opened = openRun(repo, id);
  if (!opened) return null;
  try {
    const row = runRow(opened.db);
    if (!row) return null;
    const { data, cacheable } = readRunData(opened.db);
    const entry = { sig, row, data };
    if (cacheable) runDataCache.set(dbPath, entry);
    else runDataCache.delete(dbPath);
    return entry;
  } finally {
    opened.db.close();
  }
}

export function listRuns(repo?: string, liveness?: RunLiveness, opts: { includeTests?: boolean } = {}): RunSummary[] {
  if (repo != null && !isPathComponent(repo)) return [];
  const repos = repo ? [repo] : dirs(runsRoot());
  const out: RunSummary[] = [];
  const cachedFor = lazyCachedOutcomes();
  const seen = new Set<string>();
  for (const r of repos) {
    for (const id of dirs(join(runsRoot(), r))) {
      seen.add(join(runsRoot(), r, id, "state.db"));
      const read = cachedRunData(r, id);
      if (!read) continue;
      const { summary, src } = withAttention(read.row, read.data, liveness);
      out.push(withOutcome(summary, src, src.mrField ? cachedFor(summary.id) : null));
    }
  }
  if (repo == null) pruneRunCaches(seen);
  const shown = opts.includeTests ? out : out.filter((r) => !r.test);
  return shown.sort((a, b) => b.started_at - a.started_at);
}

export function readRun(repo: string, runId: string, liveness?: RunLiveness): RunDetail | null {
  const opened = openRun(repo, runId);
  if (!opened) return null;
  const { db, schemaAhead } = opened;
  try {
    const run = runRow(db);
    if (!run) return null;
    const stages = stageRows(db);
    const fields = db.query("SELECT key, value, produced_by, at FROM fields ORDER BY at").all() as RunDetail["fields"];
    const decisions = db.query("SELECT contract, scope, selection, decided_by, decided_at FROM decisions ORDER BY decided_at").all() as RunDetail["decisions"];
    const src = outcomeSource(fields, decisions);
    return {
      run: withOutcome({
        ...run,
        attention: computeAttention(run, stages, fields, decisions, Date.now(), liveness),
        last_event_at: lastEventAt(run, stages, fields, decisions),
        ticket: fieldValue(fields, "ticket"),
        branch: fieldValue(fields, "branch"),
        test: fieldValue(fields, "test"),
        ...sessionAndMr(run, fields),
        agent: agentMirror(run, fields, liveness),
        stages: stageSummaries(stages),
        decision_count: decisions.length,
        ...evidenceCounts(fields),
        ...controls(run, stages, fields),
      }, src, src.mrField ? cachedOutcomeFor(run.id) : null),
      stages, fields, decisions,
      schemaAhead,
    };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export function findRun(runId: string, liveness?: RunLiveness): RunDetail | null {
  if (!isPathComponent(runId)) return null;
  for (const repo of dirs(runsRoot())) {
    if (dirs(join(runsRoot(), repo)).includes(runId)) return readRun(repo, runId, liveness);
  }
  return null;
}

// RunSummary carries no filesystem path, and widening the shared client type
// for one CLI verb would leak a store-only detail into every consumer that
// already destructures a RunSummary; pairing it with runDb here keeps that
// contained.
export type RunSessionMatch = { summary: RunSummary; runDb: string };

export type RunningRunScan =
  | { kind: "match"; run: { id: string; currentStage: string } }
  | { kind: "none" }
  | { kind: "incomplete" };

/** Run DBs the worktree scan last read as not running, keyed by state.db
    path to their runFilesSignature then. */
const settledRuns = new Map<string, string>();

/** Scans every run DB for a live run anchored at `worktree`, guarding herd
    close/dispose against a filesystem a running pipeline still owns.
    Distinguishes "found nothing" from "could not finish looking": a run dir
    whose state.db could not be opened or queried makes the whole scan
    `incomplete` rather than silently reporting `none` -- a caller gating a
    destructive action on this must fail closed, never treat an unreadable
    run DB as proof nothing is running there. */
export function findRunningRunByWorktree(worktree: string): RunningRunScan {
  let incomplete = false;
  for (const repo of dirs(runsRoot())) {
    for (const id of dirs(join(runsRoot(), repo))) {
      if (!isPathComponent(repo) || !isPathComponent(id)) continue;
      const path = join(runsRoot(), repo, id, "state.db");
      if (!existsSync(path)) continue;
      const sig = runFilesSignature(path);
      if (sig !== null && settledRuns.get(path) === sig) continue;
      let db: Database;
      try {
        db = new Database(path, { readonly: true });
      } catch {
        incomplete = true;
        continue;
      }
      try {
        const run = db.query("SELECT status, current_stage FROM runs LIMIT 1").get() as
          { status: string; current_stage: string | null } | undefined;
        if (!run) { incomplete = true; continue; }
        if (run.status !== "running") {
          if (sig !== null) settledRuns.set(path, sig);
          continue;
        }
        const field = db.query("SELECT value FROM fields WHERE key = 'worktree'").get() as
          { value: string } | undefined;
        if (field?.value === worktree) return { kind: "match", run: { id, currentStage: run.current_stage ?? "" } };
      } catch {
        incomplete = true;
      } finally {
        db.close();
      }
    }
  }
  return incomplete ? { kind: "incomplete" } : { kind: "none" };
}

// Keyed by state.db path: the claude-session value (null when the run has
// none or no fields table) as of the signature.
const sessionCache = new Map<string, { sig: string; session: string | null }>();

function runSession(repo: string, id: string): string | null {
  const dbPath = join(runsRoot(), repo, id, "state.db");
  const sig = runFilesSignature(dbPath);
  if (sig === null) return null;
  const hit = sessionCache.get(dbPath);
  if (hit && hit.sig === sig) return hit.session;
  const opened = openRun(repo, id);
  if (!opened) return null;
  let session: string | null = null;
  let cacheable = true;
  try {
    const row = opened.db.query("SELECT value FROM fields WHERE key = 'claude-session'").get() as { value: string } | undefined;
    session = row?.value ?? null;
  } catch (err) {
    cacheable = isMissingTable(err);
  } finally {
    opened.db.close();
  }
  if (cacheable) sessionCache.set(dbPath, { sig, session });
  else sessionCache.delete(dbPath);
  return session;
}

/** Drops cache entries under the current runs root whose run DB a full
    listing no longer saw: the daemon is long-lived and runs get pruned. */
function pruneRunCaches(seen: ReadonlySet<string>): void {
  const root = runsRoot();
  for (const cache of [runDataCache, settledRuns, sessionCache] as Map<string, unknown>[]) {
    for (const path of cache.keys()) {
      if (path.startsWith(root) && !seen.has(path)) cache.delete(path);
    }
  }
}

export const __test__ = {
  cachedRunPaths: (): string[] => [...new Set([...runDataCache.keys(), ...settledRuns.keys(), ...sessionCache.keys()])],
};

export function findRunsBySession(sessionId: string, liveness?: RunLiveness): RunSessionMatch[] {
  const out: RunSessionMatch[] = [];
  for (const repo of dirs(runsRoot())) {
    for (const id of dirs(join(runsRoot(), repo))) {
      if (!isPathComponent(repo) || !isPathComponent(id)) continue;
      if (runSession(repo, id) !== sessionId) continue;
      const read = cachedRunData(repo, id);
      if (!read) continue;
      const { summary, src } = withAttention(read.row, read.data, liveness);
      out.push({ summary: withOutcome(summary, src, src.mrField ? cachedOutcomeFor(summary.id) : null), runDb: join(runsRoot(), repo, id, "state.db") });
    }
  }
  return out.sort((a, b) => b.summary.started_at - a.summary.started_at);
}
