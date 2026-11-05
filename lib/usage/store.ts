import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { rtDir } from "../rt-paths.ts";

export const USAGE_SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS usage_messages (
  machine_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  model TEXT,
  subagent_id TEXT,
  subagent_type TEXT,
  subagent_model TEXT,
  input INTEGER NOT NULL DEFAULT 0,
  output INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,
  cache_write_5m INTEGER NOT NULL DEFAULT 0,
  cache_write_1h INTEGER NOT NULL DEFAULT 0,
  thinking INTEGER NOT NULL DEFAULT 0,
  speed TEXT,
  service_tier TEXT,
  run_id TEXT,
  stage TEXT,
  attempt INTEGER,
  mr_key TEXT,
  attribution TEXT NOT NULL DEFAULT 'none',
  PRIMARY KEY (machine_id, message_id)
);
CREATE INDEX IF NOT EXISTS usage_messages_run ON usage_messages (run_id);
CREATE INDEX IF NOT EXISTS usage_messages_mr ON usage_messages (mr_key);
CREATE INDEX IF NOT EXISTS usage_messages_ts ON usage_messages (ts);
CREATE INDEX IF NOT EXISTS usage_messages_session ON usage_messages (session_id);

CREATE TABLE IF NOT EXISTS usage_runs (
  machine_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  repo TEXT,
  pipeline TEXT,
  work_type TEXT,
  spawned_by TEXT,
  status TEXT,
  started_at INTEGER,
  ended_at INTEGER,
  mr_key TEXT,
  mr_url TEXT,
  ticket TEXT,
  branch TEXT,
  PRIMARY KEY (machine_id, run_id)
);

CREATE TABLE IF NOT EXISTS usage_stages (
  machine_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  name TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  status TEXT,
  started_at INTEGER,
  ended_at INTEGER,
  PRIMARY KEY (machine_id, run_id, name, attempt)
);

CREATE TABLE IF NOT EXISTS usage_sessions (
  machine_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  source TEXT NOT NULL,
  ref TEXT NOT NULL,
  agent_mr_key TEXT,
  agent_kind TEXT,
  PRIMARY KEY (machine_id, session_id, source, ref)
);

CREATE TABLE IF NOT EXISTS usage_files (
  path TEXT PRIMARY KEY,
  config_dir TEXT,
  session_id TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  mtime_ms INTEGER NOT NULL DEFAULT 0,
  "offset" INTEGER NOT NULL DEFAULT 0,
  scanned_at INTEGER
);

CREATE TABLE IF NOT EXISTS usage_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function usageDbPath(): string {
  return join(rtDir(), "usage.db");
}

export function openUsageDb(path: string): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA journal_mode = WAL;");
  const row = db.query("PRAGMA user_version").get() as { user_version: number };
  if (row.user_version < USAGE_SCHEMA_VERSION) {
    db.exec(SCHEMA);
    db.exec(`PRAGMA user_version = ${USAGE_SCHEMA_VERSION};`);
  }
  return db;
}

export function openUsageDbReadonly(path: string): Database | null {
  if (!existsSync(path)) return null;
  return new Database(path, { readonly: true });
}

export async function machineIdFor(
  db: Database,
  stable: () => Promise<string | null>,
): Promise<string> {
  const id = await stable();
  if (id) return id;
  const row = db.query("SELECT value FROM usage_meta WHERE key = 'machine_id'").get() as
    | { value: string }
    | null;
  if (row) return row.value;
  const made = crypto.randomUUID();
  db.query("INSERT OR IGNORE INTO usage_meta (key, value) VALUES ('machine_id', ?)").run(made);
  const stored = db.query("SELECT value FROM usage_meta WHERE key = 'machine_id'").get() as {
    value: string;
  };
  return stored.value;
}
