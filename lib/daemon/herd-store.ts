/**
 * Herd registry: one row per shepherd run and one per worker job. Its own
 * SQLite file beside gates.db so it never takes part in state.db's
 * SCHEMA_VERSION claim; open idiom copied from gates-store.ts.
 */
import { Database } from "bun:sqlite";
import { mkdirSync, renameSync } from "fs";
import { dirname } from "path";
import type { Logger } from "pino";
import type { FaultCode, Mode, Outcome, Selection } from "../../packages/rt-client/src/agent-integrations.ts";
import { isCorruptionError } from "../state/db.ts";

export type HerdStatus = "active" | "wrapped";
export type HerdJobStatus = "spawning" | "active" | "at-gate" | "at-milestone" | "done" | "closed" | "crashed" | "stuck-at-modal";

export interface HerdRow {
  id: string; repo: string; room: string; workspace: string;
  shepherdSession: string; shepherdHandle: string; shepherdPane: string | null;
  herdrSocket: string | null; hidden: boolean;
  status: HerdStatus; createdAt: number; wrappedAt: number | null;
}

export interface HerdJobRow {
  herd: string; name: string; worktree: string; branch: string | null;
  /** Registry tree name from provision (a pool slot name, not the branch); what `worktree:dispose` keys on. Null for `--dir` jobs. */
  tree: string | null;
  pane: string | null; agentSession: string | null; agentId: string | null;
  handle: string; status: HerdJobStatus; disposable: boolean;
  lastGate: string | null; lastReport: number | null;
  createdAt: number; updatedAt: number;
}

export type JobAttemptState = "reserved" | "active" | "replaced" | "ended";

/**
 * One launch of a job's worker. At most one attempt per (herd, job) is
 * active; a reserved one holds no authority until it is activated, and an
 * attempt launched with the switch off is active with no binding.
 */
export interface JobAttempt {
  id: string; herd: string; job: string; selection: Selection;
  /** A herdr pane or a headless worker; an attempt recorded before modes were stored ran in a herdr pane. */
  mode: Mode;
  bindingKey?: string;
  /** The worker session an attempt launched with the switch off ran under; set only on an unbound attempt. */
  legacySession?: string;
  /** The binding's attachment generation the attempt was activated for; 0 while unbound. */
  generation: number;
  state: JobAttemptState;
  createdAt: number; updatedAt: number; activatedAt?: number; endedAt?: number;
  replaces?: string;
}

export interface HerdStore {
  create(input: Omit<HerdRow, "status" | "createdAt" | "wrappedAt" | "shepherdPane">): HerdRow;
  get(id: string): HerdRow | null;
  list(filter?: { status?: HerdStatus }): HerdRow[];
  /** An omitted or null `pane` clears the stored shepherd pane to NULL. */
  setShepherd(id: string, s: { session: string; handle: string; pane?: string | null }): void;
  setHerdStatus(id: string, status: HerdStatus): void;
  upsertJob(input: { herd: string; name: string; worktree: string; branch?: string | null; tree?: string | null; pane?: string | null; agentSession?: string | null; agentId?: string | null; handle: string; status: HerdJobStatus; disposable?: boolean }): HerdJobRow;
  getJob(herd: string, name: string): HerdJobRow | null;
  jobs(herd: string): HerdJobRow[];
  jobsByPane(pane: string): HerdJobRow[];
  jobBySubject(subject: string): HerdJobRow | null;
  setJobStatus(herd: string, name: string, status: HerdJobStatus, extra?: { lastGate?: string | null; lastReport?: number | null }): void;
  /** The last agent-status transition seen on a pane, keyed by the ref the job
      row stores. Written through so the watchdog's idle clock survives a
      daemon restart: restarts are routine, and a pane whose turn ended before
      one emits no further event to rebuild an in-memory map from. */
  recordPaneStatus(pane: string, status: string, changedAt: number): void;
  paneStatusRows(): Array<{ pane: string; status: string; changedAt: number }>;
  forgetPaneStatus(pane: string): void;
  reserveAttempt(input: { id: string; herd: string; job: string; selection: Selection; mode?: Mode; replaces?: string }): JobAttempt;
  getAttempt(id: string): JobAttempt | null;
  activeAttempt(herd: string, job: string): JobAttempt | null;
  /** Every attempt a job has had, oldest first. */
  attempts(herd: string, job: string): JobAttempt[];
  attemptsIn(state: JobAttemptState): JobAttempt[];
  /**
   * One transaction: a reserved attempt becomes active only while the job's
   * active attempt is still the one it was reserved to replace (or none),
   * which it marks replaced. An active attempt is refreshed only for its own
   * binding at the same or a later generation.
   */
  activateAttempt(id: string, bindingKey: string | null, generation: number): Outcome<JobAttempt>;
  /** Ends the attempt only from one of `from`; false when it was in another state. */
  endAttempt(id: string, from: readonly JobAttemptState[]): boolean;
  /** Records the session an unbound attempt's worker runs under; a bound attempt is left alone. */
  recordLegacySession(id: string, session: string): void;
  close_(): void;
}

const JOB_NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/;
export function isValidJobName(name: string): boolean { return JOB_NAME_RE.test(name); }

export function herdSubject(herdId: string, job: string): string { return `herd:${herdId}/${job}`; }

/** The attempt that speaks for a job's worker: the active one, else the latest; null when none was recorded or the store keeps none. */
export function currentJobAttempt(store: Partial<Pick<HerdStore, "activeAttempt" | "attempts">>, herd: string, job: string): JobAttempt | null {
  return store.activeAttempt?.(herd, job) ?? store.attempts?.(herd, job).at(-1) ?? null;
}

/** Subject prefix every gate in a herd shares; what the shepherd subscribes on. */
export function herdPrefix(herdId: string): string { return `herd:${herdId}/`; }

const SUBJECT_RE = /^herd:([^/]+)\/([^/]+)$/;
export function parseHerdSubject(subject: string): { herd: string; job: string } | null {
  const m = SUBJECT_RE.exec(subject);
  return m ? { herd: m[1]!, job: m[2]! } : null;
}

export function mintHerdId(name: string, now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `${name}-${stamp}`;
}

interface HerdColumns { id: string; repo: string; room: string; workspace: string; shepherdSession: string; shepherdHandle: string; shepherdPane: string | null; herdrSocket: string | null; hidden: number; status: HerdStatus; createdAt: number; wrappedAt: number | null }
interface JobColumns { herd: string; name: string; worktree: string; branch: string | null; tree: string | null; pane: string | null; agentSession: string | null; agentId: string | null; handle: string; status: HerdJobStatus; disposable: number; lastGate: string | null; lastReport: number | null; createdAt: number; updatedAt: number }

interface AttemptColumns { id: string; herd: string; job: string; selection: string; mode: Mode | null; legacySession: string | null; bindingKey: string | null; generation: number; state: JobAttemptState; replaces: string | null; createdAt: number; updatedAt: number; activatedAt: number | null; endedAt: number | null }

function toAttempt(r: AttemptColumns): JobAttempt {
  const a: JobAttempt = {
    id: r.id, herd: r.herd, job: r.job, selection: JSON.parse(r.selection) as Selection, mode: r.mode ?? "herdr",
    generation: r.generation, state: r.state, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
  if (r.bindingKey !== null) a.bindingKey = r.bindingKey;
  if (r.legacySession !== null) a.legacySession = r.legacySession;
  if (r.activatedAt !== null) a.activatedAt = r.activatedAt;
  if (r.endedAt !== null) a.endedAt = r.endedAt;
  if (r.replaces !== null) a.replaces = r.replaces;
  return a;
}

const attemptFail = (code: FaultCode, message: string): Outcome<JobAttempt> => ({ ok: false, error: { code, message } });

const toHerd = (r: HerdColumns): HerdRow => ({ ...r, hidden: r.hidden === 1 });
const toJob = (r: JobColumns): HerdJobRow => ({ ...r, disposable: r.disposable === 1 });

function quarantine(path: string, log: Logger): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  log.warn({ path }, "herds db could not be opened (corrupt), quarantining and recreating empty");
  renameSync(path, `${path}.corrupt-${stamp}`);
  for (const sidecar of [`${path}-wal`, `${path}-shm`]) {
    try { renameSync(sidecar, `${sidecar}.corrupt-${stamp}`); } catch { /* sidecar absent */ }
  }
}

export function createHerdStore(opts: { dbPath: string; log: Logger }): HerdStore {
  const log = opts.log.child({ module: "herds" });
  mkdirSync(dirname(opts.dbPath), { recursive: true });
  const openDb = () => {
    const db = new Database(opts.dbPath, { create: true });
    db.exec("PRAGMA busy_timeout = 250;");
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = NORMAL;");
    return db;
  };
  let db: Database;
  try {
    db = openDb();
    db.query("PRAGMA user_version").get();
  } catch (err) {
    if (!isCorruptionError(err)) throw err;
    quarantine(opts.dbPath, log);
    db = openDb();
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS herds (
      id              TEXT PRIMARY KEY,
      repo            TEXT NOT NULL,
      room            TEXT NOT NULL,
      workspace       TEXT NOT NULL,
      shepherdSession TEXT NOT NULL,
      shepherdHandle  TEXT NOT NULL,
      shepherdPane    TEXT,
      herdrSocket     TEXT,
      hidden          INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL,
      createdAt       INTEGER NOT NULL,
      wrappedAt       INTEGER
    );
    CREATE TABLE IF NOT EXISTS herd_jobs (
      herd         TEXT NOT NULL,
      name         TEXT NOT NULL,
      worktree     TEXT NOT NULL,
      branch       TEXT,
      tree         TEXT,
      pane         TEXT,
      agentSession TEXT,
      agentId      TEXT,
      handle       TEXT NOT NULL,
      status       TEXT NOT NULL,
      disposable   INTEGER NOT NULL DEFAULT 0,
      lastGate     TEXT,
      lastReport   INTEGER,
      createdAt    INTEGER NOT NULL,
      updatedAt    INTEGER NOT NULL,
      PRIMARY KEY (herd, name)
    );
    CREATE INDEX IF NOT EXISTS idx_herd_jobs_pane ON herd_jobs(pane);
    CREATE TABLE IF NOT EXISTS herd_pane_status (
      pane      TEXT PRIMARY KEY,
      status    TEXT NOT NULL,
      changedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS herd_job_attempts (
      id          TEXT PRIMARY KEY,
      herd        TEXT NOT NULL,
      job         TEXT NOT NULL,
      selection   TEXT NOT NULL,
      mode        TEXT,
      legacySession TEXT,
      bindingKey  TEXT,
      generation  INTEGER NOT NULL DEFAULT 0,
      state       TEXT NOT NULL,
      replaces    TEXT,
      createdAt   INTEGER NOT NULL,
      updatedAt   INTEGER NOT NULL,
      activatedAt INTEGER,
      endedAt     INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_herd_job_attempts_job ON herd_job_attempts(herd, job);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_herd_job_attempts_active ON herd_job_attempts(herd, job) WHERE state = 'active';
  `);

  // Idempotent migration for a herds.db predating shepherdPane:
  // CREATE TABLE IF NOT EXISTS above never adds columns to an existing table.
  const herdCols = new Set(
    (db.query("PRAGMA table_info(herds)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!herdCols.has("shepherdPane")) db.exec("ALTER TABLE herds ADD COLUMN shepherdPane TEXT;");
  const attemptCols = new Set(
    (db.query("PRAGMA table_info(herd_job_attempts)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!attemptCols.has("mode")) db.exec("ALTER TABLE herd_job_attempts ADD COLUMN mode TEXT;");
  if (!attemptCols.has("legacySession")) db.exec("ALTER TABLE herd_job_attempts ADD COLUMN legacySession TEXT;");

  const getHerd = db.prepare("SELECT * FROM herds WHERE id = ?");
  const insertHerd = db.prepare("INSERT INTO herds (id, repo, room, workspace, shepherdSession, shepherdHandle, herdrSocket, hidden, status, createdAt, wrappedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL)");
  const getJobStmt = db.prepare("SELECT * FROM herd_jobs WHERE herd = ? AND name = ?");
  const jobsStmt = db.prepare("SELECT * FROM herd_jobs WHERE herd = ? ORDER BY createdAt");
  const jobsByPaneStmt = db.prepare("SELECT * FROM herd_jobs WHERE pane = ?");
  const getAttemptStmt = db.prepare("SELECT * FROM herd_job_attempts WHERE id = ?");
  const activeAttemptStmt = db.prepare("SELECT * FROM herd_job_attempts WHERE herd = ? AND job = ? AND state = 'active'");
  const attemptById = (id: string): JobAttempt | null => {
    const r = getAttemptStmt.get(id) as AttemptColumns | null;
    return r ? toAttempt(r) : null;
  };
  const activeFor = (herd: string, job: string): JobAttempt | null => {
    const r = activeAttemptStmt.get(herd, job) as AttemptColumns | null;
    return r ? toAttempt(r) : null;
  };
  const activate = db.transaction((id: string, bindingKey: string | null, generation: number): Outcome<JobAttempt> => {
    const attempt = attemptById(id);
    if (!attempt) return attemptFail("invalid", `no herd job attempt has id ${id}`);
    const now = Date.now();
    if (attempt.state === "active") {
      if ((attempt.bindingKey ?? null) !== bindingKey || generation < attempt.generation) {
        return attemptFail("stale-binding", `attempt ${id} is active for another session or a later attachment`);
      }
      db.run("UPDATE herd_job_attempts SET generation = ?, updatedAt = ? WHERE id = ?", [generation, now, id]);
      return { ok: true, data: attemptById(id)! };
    }
    if (attempt.state !== "reserved") return attemptFail("stale-binding", `attempt ${id} was ${attempt.state}; it can no longer take the job`);
    const current = activeFor(attempt.herd, attempt.job);
    if (current && current.id !== attempt.replaces) {
      return attemptFail("stale-binding", `job ${attempt.job} is held by attempt ${current.id}, which attempt ${id} was not reserved to replace`);
    }
    if (current) db.run("UPDATE herd_job_attempts SET state = 'replaced', updatedAt = ?, endedAt = ? WHERE id = ?", [now, now, current.id]);
    db.run(
      "UPDATE herd_job_attempts SET state = 'active', bindingKey = ?, generation = ?, activatedAt = ?, updatedAt = ? WHERE id = ?",
      [bindingKey, generation, now, now, id],
    );
    return { ok: true, data: attemptById(id)! };
  });

  return {
    create(input) {
      if (getHerd.get(input.id)) throw new Error(`herd ${input.id} already exists`);
      const now = Date.now();
      insertHerd.run(input.id, input.repo, input.room, input.workspace, input.shepherdSession, input.shepherdHandle, input.herdrSocket, input.hidden ? 1 : 0, now);
      return toHerd(getHerd.get(input.id) as HerdColumns);
    },
    get(id) {
      const r = getHerd.get(id) as HerdColumns | null;
      return r ? toHerd(r) : null;
    },
    list(filter = {}) {
      const rows = filter.status
        ? db.query("SELECT * FROM herds WHERE status = ? ORDER BY createdAt").all(filter.status)
        : db.query("SELECT * FROM herds ORDER BY createdAt").all();
      return (rows as HerdColumns[]).map(toHerd);
    },
    setShepherd(id, s) {
      db.run("UPDATE herds SET shepherdSession = ?, shepherdHandle = ?, shepherdPane = ? WHERE id = ?", [s.session, s.handle, s.pane ?? null, id]);
    },
    setHerdStatus(id, status) {
      db.run("UPDATE herds SET status = ?, wrappedAt = ? WHERE id = ?", [status, status === "wrapped" ? Date.now() : null, id]);
    },
    upsertJob(input) {
      if (!isValidJobName(input.name)) throw new Error(`invalid job name "${input.name}" (must match ${JOB_NAME_RE})`);
      const now = Date.now();
      const existing = getJobStmt.get(input.herd, input.name) as JobColumns | null;
      if (!existing) {
        db.run(
          "INSERT INTO herd_jobs (herd, name, worktree, branch, tree, pane, agentSession, agentId, handle, status, disposable, lastGate, lastReport, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)",
          [input.herd, input.name, input.worktree, input.branch ?? null, input.tree ?? null, input.pane ?? null, input.agentSession ?? null, input.agentId ?? null, input.handle, input.status, input.disposable ? 1 : 0, now, now],
        );
      } else {
        // job-release.ts tells a tree's own job by createdAt >= the tree's
        // claimedAt, so a respawn into a fresh claim starts the clock again.
        const createdAt = input.worktree === existing.worktree ? existing.createdAt : now;
        db.run(
          "UPDATE herd_jobs SET worktree = ?, branch = ?, tree = ?, pane = ?, agentSession = ?, agentId = ?, handle = ?, status = ?, disposable = ?, createdAt = ?, updatedAt = ? WHERE herd = ? AND name = ?",
          [input.worktree, input.branch !== undefined ? input.branch : existing.branch, input.tree !== undefined ? input.tree : existing.tree, input.pane !== undefined ? input.pane : existing.pane, input.agentSession !== undefined ? input.agentSession : existing.agentSession, input.agentId !== undefined ? input.agentId : existing.agentId, input.handle, input.status, input.disposable === undefined ? existing.disposable : (input.disposable ? 1 : 0), createdAt, now, input.herd, input.name],
        );
      }
      return toJob(getJobStmt.get(input.herd, input.name) as JobColumns);
    },
    getJob(herd, name) {
      const r = getJobStmt.get(herd, name) as JobColumns | null;
      return r ? toJob(r) : null;
    },
    jobs(herd) { return (jobsStmt.all(herd) as JobColumns[]).map(toJob); },
    jobsByPane(pane) { return (jobsByPaneStmt.all(pane) as JobColumns[]).map(toJob); },
    jobBySubject(subject) {
      const parsed = parseHerdSubject(subject);
      if (!parsed) return null;
      const r = getJobStmt.get(parsed.herd, parsed.job) as JobColumns | null;
      return r ? toJob(r) : null;
    },
    setJobStatus(herd, name, status, extra = {}) {
      const sets = ["status = ?", "updatedAt = ?"];
      const vals: unknown[] = [status, Date.now()];
      if (extra.lastGate !== undefined) { sets.push("lastGate = ?"); vals.push(extra.lastGate); }
      if (extra.lastReport !== undefined) { sets.push("lastReport = ?"); vals.push(extra.lastReport); }
      vals.push(herd, name);
      db.run(`UPDATE herd_jobs SET ${sets.join(", ")} WHERE herd = ? AND name = ?`, vals as never[]);
    },
    recordPaneStatus(pane, status, changedAt) {
      db.run(
        "INSERT INTO herd_pane_status (pane, status, changedAt) VALUES (?, ?, ?) ON CONFLICT(pane) DO UPDATE SET status = excluded.status, changedAt = excluded.changedAt",
        [pane, status, changedAt],
      );
    },
    paneStatusRows() {
      return db.query("SELECT pane, status, changedAt FROM herd_pane_status").all() as Array<{ pane: string; status: string; changedAt: number }>;
    },
    forgetPaneStatus(pane) { db.run("DELETE FROM herd_pane_status WHERE pane = ?", [pane]); },
    reserveAttempt(input) {
      const now = Date.now();
      db.run(
        "INSERT INTO herd_job_attempts (id, herd, job, selection, mode, bindingKey, generation, state, replaces, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, NULL, 0, 'reserved', ?, ?, ?)",
        [input.id, input.herd, input.job, JSON.stringify(input.selection), input.mode ?? "herdr", input.replaces ?? null, now, now],
      );
      return attemptById(input.id)!;
    },
    getAttempt: attemptById,
    activeAttempt: activeFor,
    attempts(herd, job) {
      return (db.query("SELECT * FROM herd_job_attempts WHERE herd = ? AND job = ? ORDER BY createdAt, rowid").all(herd, job) as AttemptColumns[]).map(toAttempt);
    },
    attemptsIn(state) {
      return (db.query("SELECT * FROM herd_job_attempts WHERE state = ? ORDER BY createdAt, rowid").all(state) as AttemptColumns[]).map(toAttempt);
    },
    activateAttempt(id, bindingKey, generation) { return activate.immediate(id, bindingKey, generation); },
    endAttempt(id, from) {
      if (from.length === 0) return false;
      const now = Date.now();
      const result = db.run(
        `UPDATE herd_job_attempts SET state = 'ended', updatedAt = ?, endedAt = ? WHERE id = ? AND state IN (${from.map(() => "?").join(", ")})`,
        [now, now, id, ...from],
      );
      return result.changes > 0;
    },
    recordLegacySession(id, session) {
      db.run("UPDATE herd_job_attempts SET legacySession = ?, updatedAt = ? WHERE id = ? AND bindingKey IS NULL", [session, Date.now(), id]);
    },
    close_() { db.close(); },
  };
}
