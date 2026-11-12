import type { Database } from "bun:sqlite";
import { readFileSync, statSync } from "fs";
import { attributeMessages } from "./attribute.ts";
import {
  classifyAgentSessions,
  linkAgents,
  linkedSessionIds,
  snapshotRuns,
  type AgentLink,
} from "./sources.ts";
import { machineIdFor, openUsageDb } from "./store.ts";
import {
  indexTranscripts,
  readFrom,
  type TranscriptFile,
  type UsageMessage,
} from "./transcripts.ts";

export interface SweepLog {
  warn(context: Record<string, unknown>, message: string): void;
  debug(context: Record<string, unknown>, message: string): void;
}

export interface SweepInput {
  dbPath: string;
  runsRoot: string;
  accountsPath: string;
  configDirs: string[];
  agents: AgentLink[];
  machineId: () => Promise<string | null>;
  now: number;
  log?: SweepLog;
}

export interface SweepResult {
  ran: boolean;
  files: number;
  messages: number;
  skippedLines: number;
  conflicts: number;
  durationMs: number;
}

const LOCK_TTL_MS = 30 * 60_000;
const MAX_SKIP_RATE = 0.01;

const TAKE_LOCK = `
INSERT INTO usage_meta (key, value) VALUES ('sweep_lock', ?1)
ON CONFLICT (key) DO UPDATE SET value = excluded.value
WHERE CAST(usage_meta.value AS INTEGER) < ?2`;

const MESSAGE_COLUMNS =
  "session_id, ts, model, subagent_id, subagent_type, subagent_model, input, output, " +
  "cache_read, cache_write_5m, cache_write_1h, thinking, speed, service_tier";
const MESSAGE_VALUES =
  "$session, $ts, $model, $subagentId, $subagentType, $subagentModel, $input, $output, " +
  "$cacheRead, $cacheWrite5m, $cacheWrite1h, $thinking, $speed, $serviceTier";

const INSERT_MESSAGE = `
INSERT INTO usage_messages (machine_id, message_id, ${MESSAGE_COLUMNS})
VALUES ($machine, $message, ${MESSAGE_VALUES})`;

const UPDATE_MESSAGE = `
UPDATE usage_messages SET (${MESSAGE_COLUMNS}) = (${MESSAGE_VALUES})
WHERE machine_id = $machine AND message_id = $message
  AND (${MESSAGE_COLUMNS}) IS NOT (${MESSAGE_VALUES})`;

const CLEAR_ATTRIBUTION = `
UPDATE usage_messages
SET run_id = NULL, stage = NULL, attempt = NULL, mr_key = NULL, attribution = 'none'
WHERE machine_id = ? AND message_id = ?`;

const SELECT_MESSAGE = `
SELECT session_id, subagent_id, ts FROM usage_messages WHERE machine_id = ? AND message_id = ?`;

const SELECT_FILE = `SELECT size, mtime_ms, "offset" FROM usage_files WHERE path = ?`;

const SAVE_FILE = `
INSERT INTO usage_files (path, config_dir, session_id, size, mtime_ms, "offset", scanned_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (path) DO UPDATE SET
  config_dir = excluded.config_dir, session_id = excluded.session_id, size = excluded.size,
  mtime_ms = excluded.mtime_ms, "offset" = excluded."offset", scanned_at = excluded.scanned_at`;

const SET_META = `
INSERT INTO usage_meta (key, value) VALUES (?, ?)
ON CONFLICT (key) DO UPDATE SET value = excluded.value`;

const ADD_META = `
INSERT INTO usage_meta (key, value) VALUES (?1, ?2)
ON CONFLICT (key) DO UPDATE SET value = CAST(value AS INTEGER) + ?2`;

const INSERT_ACCOUNT = `
INSERT OR IGNORE INTO usage_accounts
  (machine_id, session_id, ts, account, label, org_type, seat_tier, billing_type)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

const optionalString = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function ingestAccounts(db: Database, path: string, machineId: string): number {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return 0;
    throw err;
  }
  const stored = db.query("SELECT value FROM usage_meta WHERE key = 'accounts_offset'").get() as {
    value: string;
  } | null;
  const known = stored === null ? 0 : Number(stored.value);
  const from = known > bytes.length ? 0 : known;
  const end = bytes.lastIndexOf(0x0a) + 1;
  if (end <= from) return 0;

  const insert = db.query(INSERT_ACCOUNT);
  return db.transaction(() => {
    let added = 0;
    for (const text of bytes.subarray(from, end).toString("utf8").split("\n")) {
      if (text === "") continue;
      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(text) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (
        typeof rec !== "object" ||
        rec === null ||
        typeof rec.session !== "string" ||
        typeof rec.account !== "string" ||
        typeof rec.ts !== "number"
      ) {
        continue;
      }
      added += insert.run(
        machineId,
        rec.session,
        rec.ts,
        rec.account,
        optionalString(rec.label),
        optionalString(rec.org_type),
        optionalString(rec.seat_tier),
        optionalString(rec.billing_type),
      ).changes;
    }
    db.query(SET_META).run("accounts_offset", String(end));
    return added;
  })();
}

function takeLock(db: Database, now: number): boolean {
  try {
    return db.query(TAKE_LOCK).run(String(now), now - LOCK_TTL_MS).changes === 1;
  } catch (err) {
    // A long attribution transaction outlasts busy_timeout, and that writer is a sweep too.
    if ((err as { code?: string }).code === "SQLITE_BUSY") return false;
    throw err;
  }
}

function releaseLock(db: Database, now: number): void {
  db.query("DELETE FROM usage_meta WHERE key = 'sweep_lock' AND value = ?").run(String(now));
}

function messageParams(machineId: string, m: UsageMessage) {
  return {
    $machine: machineId,
    $message: m.messageId,
    $session: m.sessionId,
    $ts: m.ts,
    $model: m.model,
    $subagentId: m.subagentId,
    $subagentType: m.subagentType,
    $subagentModel: m.subagentModel,
    $input: m.input,
    $output: m.output,
    $cacheRead: m.cacheRead,
    $cacheWrite5m: m.cacheWrite5m,
    $cacheWrite1h: m.cacheWrite1h,
    $thinking: m.thinking,
    $speed: m.speed,
    $serviceTier: m.serviceTier,
  };
}

interface FileOutcome {
  read: number;
  written: number;
  skippedLines: number;
  conflicts: number;
}

interface KnownFile {
  size: number;
  mtime_ms: number;
  offset: number;
}

interface StoredMessage {
  session_id: string;
  subagent_id: string | null;
  ts: number;
}

function upsertMessages(
  db: Database,
  messages: UsageMessage[],
  machineId: string,
): { written: number; conflicts: number } {
  const select = db.query(SELECT_MESSAGE);
  const insert = db.query(INSERT_MESSAGE);
  const update = db.query(UPDATE_MESSAGE);
  const clear = db.query(CLEAR_ATTRIBUTION);
  let written = 0;
  let conflicts = 0;
  for (const m of messages) {
    const params = messageParams(machineId, m);
    const stored = select.get(machineId, m.messageId) as StoredMessage | null;
    if (stored === null) {
      insert.run(params);
      written++;
      continue;
    }
    const sameSession = stored.session_id === m.sessionId;
    if (!sameSession || stored.subagent_id !== m.subagentId) {
      conflicts++;
      if (m.ts >= stored.ts) continue;
    }
    written += update.run(params).changes;
    if (!sameSession) clear.run(machineId, m.messageId);
  }
  return { written, conflicts };
}

function sweepFile(
  db: Database,
  file: TranscriptFile,
  machineId: string,
  now: number,
): FileOutcome | null {
  const stat = statSync(file.path);
  const mtimeMs = Math.trunc(stat.mtimeMs);
  const known = db.query(SELECT_FILE).get(file.path) as KnownFile | null;
  const rewritten = known !== null && (stat.size < known.size || mtimeMs < known.mtime_ms);
  const offset = known === null || rewritten ? 0 : known.offset;
  if (known !== null && !rewritten && offset === stat.size) return null;

  const read = readFrom(file, offset);
  const saved = db.transaction(() => {
    const result = upsertMessages(db, read.messages, machineId);
    db.query(SAVE_FILE).run(
      file.path,
      file.configDir,
      file.sessionId,
      Math.max(stat.size, read.nextOffset),
      mtimeMs,
      read.nextOffset,
      now,
    );
    return result;
  })();
  return { read: read.messages.length, skippedLines: read.skippedLines, ...saved };
}

export async function runSweep(input: SweepInput): Promise<SweepResult> {
  const { log, now } = input;
  const startedAt = performance.now();
  const db = openUsageDb(input.dbPath);
  try {
    if (!takeLock(db, now)) {
      return { ran: false, files: 0, messages: 0, skippedLines: 0, conflicts: 0, durationMs: 0 };
    }
    try {
      const machineId = await machineIdFor(db, input.machineId);
      const { unresolvedMr } = snapshotRuns(db, input.runsRoot, machineId);
      if (unresolvedMr > 0) {
        log?.debug({ unresolvedMr }, "runs with an mr field that resolved to no key");
      }
      try {
        ingestAccounts(db, input.accountsPath, machineId);
      } catch (err) {
        log?.warn({ error: String(err) }, "could not read the accounts file; retrying next sweep");
      }
      linkAgents(db, input.agents, machineId);
      const files = indexTranscripts(input.configDirs, linkedSessionIds(db, machineId));
      classifyAgentSessions(db, files, machineId);

      const total = { read: 0, written: 0, skippedLines: 0, conflicts: 0 };
      for (const file of files) {
        try {
          const outcome = sweepFile(db, file, machineId, now);
          if (outcome === null) continue;
          total.read += outcome.read;
          total.written += outcome.written;
          total.skippedLines += outcome.skippedLines;
          total.conflicts += outcome.conflicts;
        } catch (err) {
          log?.warn(
            { error: String(err), path: file.path },
            "could not read a transcript; retrying next sweep",
          );
        }
      }

      attributeMessages(db, machineId);

      const seen = total.read + total.skippedLines;
      if (seen > 0 && total.skippedLines / seen > MAX_SKIP_RATE) {
        log?.warn(
          { skippedLines: total.skippedLines, messages: total.read },
          "many transcript lines were skipped; the transcript format may have changed",
        );
      }

      const durationMs = Math.round(performance.now() - startedAt);
      const setMeta = db.query(SET_META);
      const addMeta = db.query(ADD_META);
      db.transaction(() => {
        setMeta.run("last_sweep_at", String(now));
        setMeta.run("last_sweep_ms", String(durationMs));
        addMeta.run("skipped_lines", String(total.skippedLines));
        addMeta.run("conflicts", String(total.conflicts));
      })();
      return {
        ran: true,
        files: files.length,
        messages: total.written,
        skippedLines: total.skippedLines,
        conflicts: total.conflicts,
        durationMs,
      };
    } finally {
      releaseLock(db, now);
    }
  } finally {
    db.close();
  }
}
