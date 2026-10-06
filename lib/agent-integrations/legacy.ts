/**
 * Legacy session records: agents rows and chat session files written before
 * session bindings existed, keyed by a raw session id with no harness or
 * profile namespace.
 *
 * Migration binds only what a record itself proves. An agents row names its
 * provider explicitly, so it binds under that harness when exactly one
 * identity claims the session and its stored id is the native one. Only
 * Claude's is: rt minted it and passed it to Claude at launch. A Codex row
 * stores rt's placeholder until a capture overwrites it in place, and no
 * stored field says whether that capture happened, so it binds only to a
 * binding a verified launch already made for that exact native session.
 * A chat session file proves an identity but not a harness, so on its own
 * it stays unbound. Every record processed leaves an alias row saying what
 * it proved, including a row too malformed to bind, and an unbound alias
 * needs reconciliation; nothing here guesses from directories, recency or
 * ID syntax. The source rows and files are only ever read.
 */

import type { Database } from "bun:sqlite";
import { statSync } from "fs";
import type {
  HarnessId, NativeSessionRef, Outcome, SessionBinding,
} from "../../packages/rt-client/src/agent-integrations.ts";
import { listChatSessions, sessionsDir, type ChatSession } from "../chat-session.ts";
import { listAgentsAwaitingSessionMigration, type AgentRecord } from "../state/agents-store.ts";
import { isBusyError } from "../state/busy.ts";
import { getStateDb } from "../state/db.ts";
import { canonicalCodexProfile } from "./codex/profile.ts";
import { createSessionStore, LEGACY_DEFAULT_PROFILE, listBindingsByNativeValue, type SessionStore } from "./session-store.ts";

export { LEGACY_DEFAULT_PROFILE };

type AliasSource = "agents" | "chat-session";
type UnboundReason = "no-identity" | "conflicting-identity" | "unknown-provenance" | "unverified-native-id" | "invalid-record";

/** Providers whose legacy session id rt minted and handed to the harness, so the stored id is the native one. */
const RT_MINTED_SESSION_IDS = new Set<HarnessId>(["claude"]);
type AliasReason = "proven" | "signed-in" | UnboundReason;

interface AliasRow {
  raw: string; harness: string | null; profile: string | null; identity: string | null; key: string | null; reason: AliasReason;
}

const INSERT_ALIAS_SQL = `INSERT INTO agent_session_aliases (source, source_id, raw, harness, profile, identity, key, reason, recorded_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`;
const SELECT_ALIAS_EXISTS_SQL = "SELECT 1 FROM agent_session_aliases WHERE source = ? AND source_id = ?;";
const SELECT_ALIASES_BY_RAW_SQL =
  "SELECT raw, harness, profile, identity, key, reason FROM agent_session_aliases WHERE raw = ? ORDER BY recorded_at, source, source_id;";
const NEWEST_AGENT_SQL = "SELECT rowid AS r, id, (SELECT count(*) FROM agents) AS n FROM agents ORDER BY rowid DESC LIMIT 1;";

const UNBOUND_REASON: Record<UnboundReason, string> = {
  "no-identity": "its record names no identity",
  "conflicting-identity": "its records name different identities",
  "unknown-provenance": "its record does not say which harness ran it",
  "unverified-native-id": "its record does not show that the stored id is the native session's own",
  "invalid-record": "its record could not be bound to a session",
};

type Alias = {
  source: AliasSource; sourceId: string; raw: string; harness: string | null; profile: string | null;
  identity: string | null; key: string | null; reason: AliasReason;
};

function recordAlias(db: Database, a: Alias, now: number): void {
  db.query(INSERT_ALIAS_SQL).run(a.source, a.sourceId, a.raw, a.harness, a.profile, a.identity, a.key, a.reason, now);
}

function hasAlias(db: Database, source: AliasSource, sourceId: string): boolean {
  return db.query(SELECT_ALIAS_EXISTS_SQL).get(source, sourceId) !== null;
}

/** The profile a row ran under, spelled as its harness binds it: Codex's home, else the row's account or the ambient one. */
function legacyProfile(row: AgentRecord): string {
  return row.provider === "codex" ? canonicalCodexProfile(undefined, process.env) : row.account ?? LEGACY_DEFAULT_PROFILE;
}

class BindRefused extends Error {
  constructor(readonly outcome: Outcome<SessionBinding> & { ok: false }) {
    super(outcome.error.message);
  }
}

/** Reserves and binds in one savepoint, so a row that cannot bind leaves no reservation behind. */
function bindLegacy(db: Database, store: SessionStore, identity: string, agentId: string, native: NativeSessionRef, row: AgentRecord): Outcome<SessionBinding> {
  try {
    return db.transaction(() => {
      const bound = store.bind(store.reserve({ identity, agentId }), native, {
        mode: row.surface === "headless" ? "headless" : "herdr", ...(row.paneId !== undefined && { pane: row.paneId }),
      });
      if (!bound.ok) throw new BindRefused(bound);
      return bound;
    })();
  } catch (err) {
    if (err instanceof BindRefused) return err.outcome;
    throw err;
  }
}

function migrateAgent(db: Database, store: SessionStore, row: AgentRecord, chat: ChatSession | undefined, now: number): void {
  const profile = legacyProfile(row);
  const base = { source: "agents" as const, sourceId: row.id, raw: row.sessionId, harness: row.provider, profile };
  const claims = new Set([row.handle, chat?.handle].filter((h): h is string => typeof h === "string" && h.length > 0));
  const [identity] = claims;
  if (claims.size !== 1 || identity === undefined) {
    recordAlias(db, { ...base, identity: null, key: null, reason: claims.size > 1 ? "conflicting-identity" : "no-identity" }, now);
    return;
  }
  const native: NativeSessionRef = { harness: row.provider, profile, kind: "id", value: row.sessionId };
  const existing = store.find(native);
  if (existing) {
    const agrees = existing.identity === identity;
    recordAlias(db, { ...base, identity: agrees ? identity : null, key: agrees ? existing.key : null, reason: agrees ? "proven" : "conflicting-identity" }, now);
    return;
  }
  if (!RT_MINTED_SESSION_IDS.has(row.provider)) {
    recordAlias(db, { ...base, identity, key: null, reason: "unverified-native-id" }, now);
    return;
  }
  const bound = bindLegacy(db, store, identity, row.id, native, row);
  if (!bound.ok && bound.error.code === "transient") throw new Error(`legacy agent ${row.id} could not bind: ${bound.error.message}`);
  recordAlias(db, bound.ok ? { ...base, identity, key: bound.data.key, reason: "proven" } : { ...base, identity, key: null, reason: "invalid-record" }, now);
}

function migrateChat(db: Database, chat: ChatSession, now: number): void {
  const base = { source: "chat-session" as const, sourceId: chat.sessionId, raw: chat.sessionId, profile: null };
  const matches = listBindingsByNativeValue(db, chat.sessionId);
  const only = matches.length === 1 ? matches[0]! : undefined;
  if (only && only.identity === chat.handle) {
    recordAlias(db, { ...base, harness: only.native.harness, identity: chat.handle, key: only.key, reason: "signed-in" }, now);
  } else if (matches.length > 0) {
    recordAlias(db, { ...base, harness: null, identity: chat.handle, key: null, reason: "conflicting-identity" }, now);
  } else {
    recordAlias(db, { ...base, harness: null, identity: chat.handle, key: null, reason: "unknown-provenance" }, now);
  }
}

/**
 * What a full pass saw: the chat sessions folder's own metadata (a file
 * added or removed changes it) and the newest agents row with the row count
 * (a delete and insert can reuse a rowid, never an id). Null when the folder
 * cannot be read, which never skips a pass.
 */
function scanStamp(db: Database): string | null {
  const dir = sessionsDir();
  let folder: string;
  try {
    const s = statSync(dir, { bigint: true });
    folder = [s.mtimeNs, s.ctimeNs, s.size, s.nlink].join(":");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return null;
    folder = "absent";
  }
  const newest = db.query(NEWEST_AGENT_SQL).get() as { r: number; id: string; n: number } | null;
  return [dir, folder, newest?.r ?? 0, newest?.id ?? "", newest?.n ?? 0].join("\0");
}

/** The stamp of the last full pass per database, in this process. */
const lastPass = new WeakMap<Database, string>();
let scans = 0;
export const __test__ = { scans: () => scans, reset: () => { scans = 0; } };

/**
 * Records every legacy agents row and chat session file not yet accounted
 * for. Idempotent; takes the write lock only when something is new, and
 * reads nothing when no file or row appeared since its last full pass.
 */
export function migrateLegacySessions(db: Database = getStateDb()): void {
  const stamp = db.inTransaction ? null : scanStamp(db);
  if (stamp !== null && lastPass.get(db) === stamp) return;
  scans++;
  const chats = listChatSessions();
  const pending = () => listAgentsAwaitingSessionMigration(db).length > 0
    || chats.some((c) => !hasAlias(db, "chat-session", c.sessionId));
  if (pending()) {
    const run = db.transaction(() => {
      const store = createSessionStore(db);
      const chatBySession = new Map(chats.map((c) => [c.sessionId, c]));
      const now = Date.now();
      for (const row of listAgentsAwaitingSessionMigration(db)) migrateAgent(db, store, row, chatBySession.get(row.sessionId), now);
      for (const chat of chats) if (!hasAlias(db, "chat-session", chat.sessionId)) migrateChat(db, chat, now);
    });
    if (db.inTransaction) run();
    else run.immediate();
  }
  if (stamp !== null) lastPass.set(db, stamp);
}

function refuse(message: string): Outcome<SessionBinding> {
  return { ok: false, error: { code: "ambiguous", message } };
}

function unattributed(raw: string, alias: AliasRow): string {
  return `session ${raw} cannot be attributed: ${UNBOUND_REASON[alias.reason as UnboundReason]}`;
}

/** An unbound record contradicts a binding when it names another harness, profile or identity, or already conflicts with itself. */
function contradicts(alias: AliasRow, binding: SessionBinding): boolean {
  return alias.reason === "conflicting-identity"
    || (alias.identity !== null && alias.identity !== binding.identity)
    || (alias.harness !== null && alias.harness !== binding.native.harness)
    || (alias.profile !== null && alias.profile !== binding.native.profile);
}

/**
 * The one binding a raw legacy session id names, optionally narrowed to a
 * harness. A caller's harness narrows the match; it never supplies the
 * provenance a record lacks. Anything short of one uncontradicted binding
 * refuses as ambiguous.
 */
export function resolveLegacySession(raw: string, harness?: HarnessId, db: Database = getStateDb()): Outcome<SessionBinding> {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, error: { code: "invalid", message: "a legacy session id is required" } };
  }
  try {
    migrateLegacySessions(db);
  } catch (err) {
    if (isBusyError(err)) return { ok: false, error: { code: "transient", message: "the state database is busy; try again" } };
    throw err;
  }
  const store = createSessionStore(db);
  const aliases = db.query(SELECT_ALIASES_BY_RAW_SQL).all(raw) as AliasRow[];
  const candidates = new Map<string, SessionBinding>();
  for (const binding of listBindingsByNativeValue(db, raw)) candidates.set(binding.key, binding);
  for (const alias of aliases) {
    const binding = alias.key === null ? null : store.get(alias.key);
    if (binding) candidates.set(binding.key, binding);
  }
  const bound = [...candidates.values()].filter((b) => harness === undefined || b.native.harness === harness);
  const unbound = aliases.filter((a) => a.key === null && (harness === undefined || a.harness === null || a.harness === harness));

  if (bound.length > 1) return refuse(`session ${raw} matches more than one recorded session`);
  if (bound.length === 1) {
    const binding = bound[0]!;
    const conflict = unbound.find((a) => contradicts(a, binding));
    return conflict ? refuse(unattributed(raw, conflict)) : { ok: true, data: binding };
  }
  if (unbound.length > 0) return refuse(unattributed(raw, unbound[0]!));
  return refuse(harness === undefined ? `no recorded session matches ${raw}` : `no recorded ${harness} session matches ${raw}`);
}
