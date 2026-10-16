/**
 * Herd registry: one row per shepherd run and one per worker job. Its own
 * SQLite file beside gates.db so it never takes part in state.db's
 * SCHEMA_VERSION claim; open idiom copied from gates-store.ts.
 */
import { Database } from "bun:sqlite";
import { mkdirSync, renameSync } from "fs";
import { dirname } from "path";
import type { Logger } from "pino";
import { isCorruptionError } from "../state/db.ts";
import type { BudgetCounter } from "./herd-budgets.ts";

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
  model: string | null; effort: string | null; account: string | null;
  lastGate: string | null; lastReport: number | null;
  createdAt: number; updatedAt: number;
}

export interface WatchdogLadderRow { key: string; strikes: number; lastPokeAt: number | null; since: number; parked: boolean }
export interface WatchdogMarkRow { kind: "action" | "notified"; key: string; at: number }

export interface HerdStore {
  create(input: Omit<HerdRow, "status" | "createdAt" | "wrappedAt" | "shepherdPane">): HerdRow;
  get(id: string): HerdRow | null;
  list(filter?: { status?: HerdStatus }): HerdRow[];
  /** An omitted or null `pane` clears the stored shepherd pane to NULL. */
  setShepherd(id: string, s: { session: string; handle: string; pane?: string | null }): void;
  setHerdStatus(id: string, status: HerdStatus): void;
  upsertJob(input: { herd: string; name: string; worktree: string; branch?: string | null; tree?: string | null; pane?: string | null; agentSession?: string | null; agentId?: string | null; handle: string; status: HerdJobStatus; disposable?: boolean; model?: string | null; effort?: string | null; account?: string | null }): HerdJobRow;
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
  /** Adds one to the counter's row and returns the new count. Counters with no key use "". */
  tickBudget(herd: string, job: string, counter: BudgetCounter, key?: string): number;
  /** Inserts the row at 1 only when absent; true when it inserted. */
  markBudgetOnce(herd: string, job: string, counter: BudgetCounter, key: string): boolean;
  budgetRows(herd: string, job: string): Array<{ counter: BudgetCounter; key: string; used: number }>;
  watchdogLoad(): { ladders: WatchdogLadderRow[]; marks: WatchdogMarkRow[] };
  watchdogSaveLadder(row: WatchdogLadderRow): void;
  watchdogDeleteLadder(key: string): void;
  watchdogMark(kind: WatchdogMarkRow["kind"], key: string, at: number): void;
  watchdogClear(): void;
  close_(): void;
}

const JOB_NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/;
export function isValidJobName(name: string): boolean { return JOB_NAME_RE.test(name); }

export function herdSubject(herdId: string, job: string): string { return `herd:${herdId}/${job}`; }

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
interface JobColumns { herd: string; name: string; worktree: string; branch: string | null; tree: string | null; pane: string | null; agentSession: string | null; agentId: string | null; handle: string; status: HerdJobStatus; disposable: number; model: string | null; effort: string | null; account: string | null; lastGate: string | null; lastReport: number | null; createdAt: number; updatedAt: number }

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
      model        TEXT,
      effort       TEXT,
      account      TEXT,
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
    CREATE TABLE IF NOT EXISTS herd_budgets (
      herd      TEXT NOT NULL,
      job       TEXT NOT NULL,
      counter   TEXT NOT NULL,
      key       TEXT NOT NULL,
      used      INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      PRIMARY KEY (herd, job, counter, key)
    );
    CREATE TABLE IF NOT EXISTS herd_watchdog_ladders (
      key        TEXT PRIMARY KEY,
      strikes    INTEGER NOT NULL,
      lastPokeAt INTEGER,
      since      INTEGER NOT NULL,
      parked     INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS herd_watchdog_marks (
      kind TEXT NOT NULL,
      key  TEXT NOT NULL,
      at   INTEGER NOT NULL,
      PRIMARY KEY (kind, key)
    );
  `);

  // Idempotent migrations for a herds.db predating these columns:
  // CREATE TABLE IF NOT EXISTS above never adds columns to an existing table.
  const columns = (table: string) => new Set(
    (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!columns("herds").has("shepherdPane")) db.exec("ALTER TABLE herds ADD COLUMN shepherdPane TEXT;");
  const jobCols = columns("herd_jobs");
  for (const col of ["model", "effort", "account"]) {
    if (!jobCols.has(col)) db.exec(`ALTER TABLE herd_jobs ADD COLUMN ${col} TEXT;`);
  }

  const getHerd = db.prepare("SELECT * FROM herds WHERE id = ?");
  const insertHerd = db.prepare("INSERT INTO herds (id, repo, room, workspace, shepherdSession, shepherdHandle, herdrSocket, hidden, status, createdAt, wrappedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL)");
  const getJobStmt = db.prepare("SELECT * FROM herd_jobs WHERE herd = ? AND name = ?");
  const jobsStmt = db.prepare("SELECT * FROM herd_jobs WHERE herd = ? ORDER BY createdAt");
  const jobsByPaneStmt = db.prepare("SELECT * FROM herd_jobs WHERE pane = ?");
  const tickBudgetStmt = db.prepare("INSERT INTO herd_budgets (herd, job, counter, key, used, updatedAt) VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT(herd, job, counter, key) DO UPDATE SET used = used + 1, updatedAt = excluded.updatedAt RETURNING used");
  const markBudgetStmt = db.prepare("INSERT INTO herd_budgets (herd, job, counter, key, used, updatedAt) VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT(herd, job, counter, key) DO NOTHING");

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
          "INSERT INTO herd_jobs (herd, name, worktree, branch, tree, pane, agentSession, agentId, handle, status, disposable, model, effort, account, lastGate, lastReport, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)",
          [input.herd, input.name, input.worktree, input.branch ?? null, input.tree ?? null, input.pane ?? null, input.agentSession ?? null, input.agentId ?? null, input.handle, input.status, input.disposable ? 1 : 0, input.model ?? null, input.effort ?? null, input.account ?? null, now, now],
        );
      } else {
        // job-release.ts tells a tree's own job by createdAt >= the tree's
        // claimedAt, so a respawn into a fresh claim starts the clock again.
        const createdAt = input.worktree === existing.worktree ? existing.createdAt : now;
        const keep = <T>(given: T | undefined, stored: T): T => (given !== undefined ? given : stored);
        db.run(
          "UPDATE herd_jobs SET worktree = ?, branch = ?, tree = ?, pane = ?, agentSession = ?, agentId = ?, handle = ?, status = ?, disposable = ?, model = ?, effort = ?, account = ?, createdAt = ?, updatedAt = ? WHERE herd = ? AND name = ?",
          [input.worktree, keep(input.branch, existing.branch), keep(input.tree, existing.tree), keep(input.pane, existing.pane), keep(input.agentSession, existing.agentSession), keep(input.agentId, existing.agentId), input.handle, input.status, input.disposable === undefined ? existing.disposable : (input.disposable ? 1 : 0), keep(input.model, existing.model), keep(input.effort, existing.effort), keep(input.account, existing.account), createdAt, now, input.herd, input.name],
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
    tickBudget(herd, job, counter, key = "") {
      return (tickBudgetStmt.get(herd, job, counter, key, Date.now()) as { used: number }).used;
    },
    markBudgetOnce(herd, job, counter, key) {
      return markBudgetStmt.run(herd, job, counter, key, Date.now()).changes === 1;
    },
    budgetRows(herd, job) {
      return db.query("SELECT counter, key, used FROM herd_budgets WHERE herd = ? AND job = ? ORDER BY counter, key").all(herd, job) as Array<{ counter: BudgetCounter; key: string; used: number }>;
    },
    watchdogLoad() {
      const ladders = (db.query("SELECT key, strikes, lastPokeAt, since, parked FROM herd_watchdog_ladders").all() as Array<Omit<WatchdogLadderRow, "parked"> & { parked: number }>)
        .map((r) => ({ ...r, parked: r.parked === 1 }));
      const marks = db.query("SELECT kind, key, at FROM herd_watchdog_marks").all() as WatchdogMarkRow[];
      return { ladders, marks };
    },
    watchdogSaveLadder(row) {
      db.run(
        "INSERT INTO herd_watchdog_ladders (key, strikes, lastPokeAt, since, parked) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET strikes = excluded.strikes, lastPokeAt = excluded.lastPokeAt, since = excluded.since, parked = excluded.parked",
        [row.key, row.strikes, row.lastPokeAt, row.since, row.parked ? 1 : 0],
      );
    },
    watchdogDeleteLadder(key) { db.run("DELETE FROM herd_watchdog_ladders WHERE key = ?", [key]); },
    watchdogMark(kind, key, at) {
      db.run("INSERT INTO herd_watchdog_marks (kind, key, at) VALUES (?, ?, ?) ON CONFLICT(kind, key) DO UPDATE SET at = excluded.at", [kind, key, at]);
    },
    watchdogClear() {
      db.transaction(() => {
        db.run("DELETE FROM herd_watchdog_ladders");
        db.run("DELETE FROM herd_watchdog_marks");
      })();
    },
    close_() { db.close(); },
  };
}
