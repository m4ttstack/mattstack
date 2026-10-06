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
 * A chat session file proves an identity but
 * not a harness, so on its own it stays unbound. Every record processed
 * leaves an alias row saying what it proved, and an unbound alias needs
 * reconciliation; nothing here guesses from directories, recency or ID
 * syntax. The source rows and files are only ever read.
 */

import type { Database } from "bun:sqlite";
import type {
  HarnessId, NativeSessionRef, Outcome, SessionBinding,
} from "../../packages/rt-client/src/agent-integrations.ts";
import { listChatSessions, type ChatSession } from "../chat-session.ts";
import { listAgentsAwaitingSessionMigration, type AgentRecord } from "../state/agents-store.ts";
import { isBusyError } from "../state/busy.ts";
import { getStateDb } from "../state/db.ts";
import { createSessionStore, LEGACY_DEFAULT_PROFILE, listBindingsByNativeValue, type SessionStore } from "./session-store.ts";

export { LEGACY_DEFAULT_PROFILE };

type AliasSource = "agents" | "chat-session";
type UnboundReason = "no-identity" | "conflicting-identity" | "unknown-provenance" | "unverified-native-id";

/** Providers whose legacy session id rt minted and handed to the harness, so the stored id is the native one. */
const RT_MINTED_SESSION_IDS = new Set<HarnessId>(["claude"]);
type AliasReason = "proven" | "signed-in" | UnboundReason;

interface AliasRow {
  raw: string; harness: string | null; identity: string | null; key: string | null; reason: AliasReason;
}

const INSERT_ALIAS_SQL = `INSERT INTO agent_session_aliases (source, source_id, raw, harness, identity, key, reason, recorded_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?);`;
const SELECT_ALIAS_EXISTS_SQL = "SELECT 1 FROM agent_session_aliases WHERE source = ? AND source_id = ?;";
const SELECT_ALIASES_BY_RAW_SQL =
  "SELECT raw, harness, identity, key, reason FROM agent_session_aliases WHERE raw = ? ORDER BY recorded_at, source, source_id;";

const UNBOUND_REASON: Record<UnboundReason, string> = {
  "no-identity": "its record names no identity",
  "conflicting-identity": "its records name different identities",
  "unknown-provenance": "its record does not say which harness ran it",
  "unverified-native-id": "its record does not show that the stored id is the native session's own",
};

type Alias = { source: AliasSource; sourceId: string; raw: string; harness: string | null; identity: string | null; key: string | null; reason: AliasReason };

function recordAlias(db: Database, a: Alias, now: number): void {
  db.query(INSERT_ALIAS_SQL).run(a.source, a.sourceId, a.raw, a.harness, a.identity, a.key, a.reason, now);
}

function hasAlias(db: Database, source: AliasSource, sourceId: string): boolean {
  return db.query(SELECT_ALIAS_EXISTS_SQL).get(source, sourceId) !== null;
}

function migrateAgent(db: Database, store: SessionStore, row: AgentRecord, chat: ChatSession | undefined, now: number): void {
  const base = { source: "agents" as const, sourceId: row.id, raw: row.sessionId, harness: row.provider };
  const claims = new Set([row.handle, chat?.handle].filter((h): h is string => typeof h === "string" && h.length > 0));
  const [identity] = claims;
  if (claims.size !== 1 || identity === undefined) {
    recordAlias(db, { ...base, identity: null, key: null, reason: claims.size > 1 ? "conflicting-identity" : "no-identity" }, now);
    return;
  }
  const native: NativeSessionRef = {
    harness: row.provider, profile: row.account ?? LEGACY_DEFAULT_PROFILE, kind: "id", value: row.sessionId,
  };
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
  const bound = store.bind(store.reserve({ identity, agentId: row.id }), native, {
    mode: row.surface === "headless" ? "headless" : "herdr", ...(row.paneId !== undefined && { pane: row.paneId }),
  });
  if (!bound.ok) throw new Error(`legacy agent ${row.id} could not bind: ${bound.error.message}`);
  recordAlias(db, { ...base, identity, key: bound.data.key, reason: "proven" }, now);
}

function migrateChat(db: Database, chat: ChatSession, now: number): void {
  const base = { source: "chat-session" as const, sourceId: chat.sessionId, raw: chat.sessionId };
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

/** Records every legacy agents row and chat session file not yet accounted for. Idempotent; takes the write lock only when something is new. */
export function migrateLegacySessions(db: Database = getStateDb()): void {
  const chats = listChatSessions();
  const pending = () => listAgentsAwaitingSessionMigration(db).length > 0
    || chats.some((c) => !hasAlias(db, "chat-session", c.sessionId));
  if (!pending()) return;
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

function refuse(message: string): Outcome<SessionBinding> {
  return { ok: false, error: { code: "ambiguous", message } };
}

function unattributed(raw: string, alias: AliasRow): string {
  return `session ${raw} cannot be attributed: ${UNBOUND_REASON[alias.reason as UnboundReason]}`;
}

/** An unbound record contradicts a binding when it names another harness or identity, or already conflicts with itself. */
function contradicts(alias: AliasRow, binding: SessionBinding): boolean {
  return alias.reason === "conflicting-identity"
    || (alias.identity !== null && alias.identity !== binding.identity)
    || (alias.harness !== null && alias.harness !== binding.native.harness);
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
