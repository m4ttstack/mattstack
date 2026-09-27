/**
 * lib/state/presence-store.ts: sign-in presence for `rt chat` (RT-48).
 * The only module that touches `chat_presence`; `chat_room_defaults` and
 * `chat_dms` remain chat-store.ts's and dm-store.ts's respectively, and
 * identities and display names come from identity-store.ts.
 */

import { Database } from "bun:sqlite";
import { AGENT_NAMES, baseOfHandle, pickAgentName } from "../chat-names.ts";
import { resolveAllInboxes, resolveInbox, inboxAlive } from "../claude-registry.ts";
import { persistOrWarn, runCriticalWrite } from "./busy.ts";
import { getStateDb } from "./db.ts";
import {
  bindIdentitySession,
  fixedIdentityRefusal,
  getIdentity,
  identityForSession,
  identityName,
  identityNames,
  isKnownId,
  mintIdentity,
  renameIdentity,
  resolveHandle,
  type IdentityRow,
} from "./identity-store.ts";
import { getKvValue, setKvValue } from "./kv-blob.ts";

export type BuddyStatus = "live" | "idle" | "offline";

export interface PresenceRow {
  sessionId: string;
  handle: string;
  baseHandle: string;
  name: string;
  cwd?: string;
  repo?: string;
  branch?: string;
  pane?: string;
  statusText?: string;
  signedInAt: number;
  lastSeenAt: number;
  signedOutAt?: number;
}

export interface PresenceThresholds {
  sessionStaleMs: number;
  pruneMs: number;
}

/** The registry probe, fakeable the same way lib/daemon/handlers/chat.ts's InboxDeps is: real implementations by default, swapped for a fake in tests that need a dead or alive binding on demand. */
export type RegistryDeps = { resolve: typeof resolveInbox; alive: typeof inboxAlive; resolveAll: typeof resolveAllInboxes };
const defaultRegistryDeps: RegistryDeps = { resolve: resolveInbox, alive: inboxAlive, resolveAll: resolveAllInboxes };

/**
 * One registry scan (`deps.resolveAll()`) turned into a per-session lookup,
 * so N row/candidate checks against the result cost one directory read
 * total instead of N. Only `resolve` is replaced; `alive` and `resolveAll`
 * still come from `deps`, so a caller-supplied fake keeps controlling both.
 * Call once per outer operation (one `listBuddies`, one `chat:who`, one
 * `signIn` transaction) and thread the result down to every row it checks.
 */
export function snapshotRegistryDeps(deps: RegistryDeps = defaultRegistryDeps): RegistryDeps {
  const bindings = deps.resolveAll();
  return { resolve: (sessionId) => bindings.get(sessionId) ?? null, alive: deps.alive, resolveAll: deps.resolveAll };
}

interface PresenceRawRow {
  session_id: string;
  handle: string;
  base_handle: string;
  cwd: string | null;
  repo: string | null;
  branch: string | null;
  pane: string | null;
  status_text: string | null;
  signed_in_at: number;
  last_seen_at: number;
  signed_out_at: number | null;
}

function rowToPresence(row: PresenceRawRow, name: string): PresenceRow {
  const presence: PresenceRow = {
    sessionId: row.session_id,
    handle: row.handle,
    baseHandle: row.base_handle,
    name,
    signedInAt: row.signed_in_at,
    lastSeenAt: row.last_seen_at,
  };
  if (row.cwd !== null) presence.cwd = row.cwd;
  if (row.repo !== null) presence.repo = row.repo;
  if (row.branch !== null) presence.branch = row.branch;
  if (row.pane !== null) presence.pane = row.pane;
  if (row.status_text !== null) presence.statusText = row.status_text;
  if (row.signed_out_at !== null) presence.signedOutAt = row.signed_out_at;
  return presence;
}

const PRESENCE_COLUMNS =
  "session_id, handle, base_handle, cwd, repo, branch, pane, status_text, signed_in_at, last_seen_at, signed_out_at";

function bindingAlive(sessionId: string, deps: RegistryDeps): boolean {
  const binding = deps.resolve(sessionId);
  return binding !== null && deps.alive(binding);
}

/**
 * The one reclaim predicate (spec "Failure modes", "Suffix churn"): a
 * handle's holder is reclaimable when signed out, or its session heartbeat
 * is older than the session-stale cutoff AND the registry has nothing alive
 * for its session id -- a long autonomous turn can leave last_seen_at old
 * while the agent is very much still there, so staleness alone must never
 * reclaim a seat the registry still vouches for.
 */
function isReclaimable(row: PresenceRawRow, sessionStaleCutoff: number, deps: RegistryDeps): boolean {
  if (row.signed_out_at !== null) return true;
  if (row.last_seen_at >= sessionStaleCutoff) return false;
  return !bindingAlive(row.session_id, deps);
}

/**
 * Prune's own CANDIDATE predicate, deliberately not `isReclaimable`: a row
 * only reaches deletion once it also passes the binding-aware check in
 * `prunePresence` below (signed out, or a dead registry binding) -- a bare
 * `signed_out_at IS NOT NULL` leg with no age bound would delete every
 * signed-out row at daemon startup and empty the offline window, so this
 * SQL only narrows to "old enough to be worth a registry check", never the
 * final delete decision. Bind params in order: dayAgo, dayAgo (both legs).
 */
const PRUNABLE_SQL = `(signed_out_at IS NOT NULL AND signed_out_at < ?) OR (signed_out_at IS NULL AND last_seen_at < ?)`;

const SELECT_PRESENCE_BY_HANDLE_SQL = `SELECT ${PRESENCE_COLUMNS} FROM chat_presence WHERE handle = ?;`;
const SELECT_PRESENCE_BY_SESSION_SQL = `SELECT ${PRESENCE_COLUMNS} FROM chat_presence WHERE session_id = ?;`;
const SELECT_ALL_PRESENCE_SQL = `SELECT ${PRESENCE_COLUMNS} FROM chat_presence;`;
// The roster's own cutoff is the signed-out leg alone, never last_seen_at:
// a stale-but-live-binding row must reach buddyStatus to be classified
// live/idle, not disappear from the list before buddyStatus ever sees it.
// One bind param: dayAgo.
const SELECT_ROSTER_SQL = `SELECT ${PRESENCE_COLUMNS} FROM chat_presence WHERE signed_out_at IS NULL OR signed_out_at >= ?;`;
const SELECT_PRUNE_CANDIDATES_SQL = `SELECT ${PRESENCE_COLUMNS} FROM chat_presence WHERE ${PRUNABLE_SQL};`;
const DELETE_PRESENCE_BY_SESSION_SQL = `DELETE FROM chat_presence WHERE session_id = ?;`;
const INSERT_PRESENCE_SQL = `INSERT INTO chat_presence (session_id, handle, base_handle, cwd, repo, branch, pane, status_text, signed_in_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;
const UPDATE_SIGN_OUT_SQL = `UPDATE chat_presence SET signed_out_at = ? WHERE session_id = ?;`;
const UPDATE_STATUS_TEXT_SQL = `UPDATE chat_presence SET status_text = ? WHERE session_id = ?;`;
const UPDATE_LAST_SEEN_SQL = `UPDATE chat_presence SET last_seen_at = ? WHERE session_id = ?;`;

const DEFAULT_SESSION_STALE_MS = 60 * 60_000;
const DEFAULT_PRUNE_MS = 24 * 60 * 60_000;

function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Read at call time (never memoized): the daemon evaluates thresholds fresh on every status computation, per env at that instant. */
export function presenceThresholds(): PresenceThresholds {
  return {
    sessionStaleMs: envMs("RT_CHAT_SESSION_STALE_MS", DEFAULT_SESSION_STALE_MS),
    pruneMs: envMs("RT_CHAT_PRUNE_MS", DEFAULT_PRUNE_MS),
  };
}

/**
 * offline: signed out, or the registry has nothing alive for this session --
 * no resolvable entry at all, or one whose pid is dead or whose socket is
 * gone (spec: "pid dead, or socket gone"). Otherwise live when the alive
 * binding's status is busy; idle otherwise (alive but not busy).
 *
 * Deliberately no `last_seen_at` staleness leg: prunePresence (below) is
 * what actually retires a row, and it already spares anything the registry
 * still vouches for regardless of how old the heartbeat has gone.
 * Duplicating that staleness check here would flip a still-busy session to
 * offline the moment its heartbeat aged past pruneMs, even though nothing
 * about its row is anywhere near being pruned -- `now`/`th` stay for
 * signature stability with every existing call site.
 */
export function buddyStatus(
  row: Partial<Pick<PresenceRow, "signedOutAt" | "lastSeenAt" | "sessionId">>,
  now: number,
  th: PresenceThresholds = presenceThresholds(),
  deps: RegistryDeps = defaultRegistryDeps,
): BuddyStatus {
  if (row.signedOutAt !== undefined) return "offline";
  if (!row.sessionId) return "offline";
  const binding = deps.resolve(row.sessionId);
  if (!binding || !deps.alive(binding)) return "offline";
  return binding.status === "busy" ? "live" : "idle";
}

/** The suffix number a display name occupies within `baseHandle`'s family (`x` is 1, `x-2` is 2, ...), or null when it is not one of that family's names. */
function suffixOf(handle: string, baseHandle: string): number | null {
  if (handle === baseHandle) return 1;
  const prefix = `${baseHandle}-`;
  if (!handle.startsWith(prefix)) return null;
  const n = Number(handle.slice(prefix.length));
  return Number.isInteger(n) && n >= 2 ? n : null;
}

function suffixToHandle(suffix: number, baseHandle: string): string {
  return suffix === 1 ? baseHandle : `${baseHandle}-${suffix}`;
}

export type SignInResult = { handle: string; baseHandle: string; name: string; reclaimed: boolean; continued: boolean };

type Seat = PresenceRawRow & { name: string; reclaimable: boolean };

/** Every presence row by display name. signIn deletes a reclaimable holder before reusing its name, so names are unique across chat_presence and the map drops nothing. */
function seatsByName(db: Database, sessionStaleCutoff: number, deps: RegistryDeps): Map<string, Seat> {
  const rows = db.query(SELECT_ALL_PRESENCE_SQL).all() as PresenceRawRow[];
  const names = identityNames(rows.map((row) => row.handle), db);
  const seats = new Map<string, Seat>();
  for (const row of rows) {
    const name = names.get(row.handle)!;
    seats.set(name, { ...row, name, reclaimable: isReclaimable(row, sessionStaleCutoff, deps) });
  }
  return seats;
}

/**
 * The session's own previous name when it is free; else the name of a
 * reclaimable row on the same cwd and pane (a restarted process keeps its
 * seat's name, never its id); else the lowest free or reclaimable suffix.
 */
function pickDisplayName(
  baseHandle: string,
  preferred: string | undefined,
  seat: { cwd: string | null; pane: string | null },
  seats: Map<string, Seat>,
): string {
  const free = (name: string): boolean => seats.get(name)?.reclaimable ?? true;
  if (preferred !== undefined && suffixOf(preferred, baseHandle) !== null && free(preferred)) return preferred;
  const sameSeat = [...seats.values()]
    .filter((row) => row.reclaimable && row.cwd === seat.cwd && row.pane === seat.pane && suffixOf(row.name, baseHandle) !== null)
    .sort((a, b) => suffixOf(a.name, baseHandle)! - suffixOf(b.name, baseHandle)!);
  if (sameSeat.length > 0) return sameSeat[0]!.name;
  for (let suffix = 1; ; suffix++) {
    const name = suffixToHandle(suffix, baseHandle);
    if (free(name)) return name;
  }
}

/** False when a live session other than the caller sits on `id`; a reclaimable holder is deleted so the id can be seated again. */
function claimIdentitySeat(id: string, sessionStaleCutoff: number, deps: RegistryDeps, db: Database): boolean {
  const holder = db.query(SELECT_PRESENCE_BY_HANDLE_SQL).get(id) as PresenceRawRow | null;
  if (!holder) return true;
  if (!isReclaimable(holder, sessionStaleCutoff, deps)) return false;
  db.query(DELETE_PRESENCE_BY_SESSION_SQL).run(holder.session_id);
  return true;
}

/** A presence row written before identities existed: its handle is the session's id. */
function legacyIdentity(row: PresenceRawRow): IdentityRow {
  return { id: row.handle, name: row.handle, baseName: row.base_handle, mintedAt: row.signed_in_at, sessionId: row.session_id };
}

function heldByAnotherSession(handle: string): Error {
  return new Error(`chat: handle reclaimed: "${handle}" is now held by another session; sign in again`);
}

/** The identity `continueId` names, or, when it names no known identity, the display name to mint under (`--as newname` has nothing to continue). */
function continuationTarget(continueId: string, db: Database): IdentityRow | string {
  const id = resolveHandle(continueId, db);
  for (const x of [continueId, id]) {
    const refusal = fixedIdentityRefusal(x);
    if (refusal) throw new Error(`chat: may not continue ${JSON.stringify(x)}: ${refusal}`);
  }
  if (!isKnownId(id, db)) return id;
  return getIdentity(id, db) ?? { id, name: id, baseName: baseOfHandle(id), mintedAt: 0, sessionId: null };
}

export function signIn(
  args: {
    sessionId: string;
    baseHandle?: string;
    continueId?: string;
    cwd?: string;
    repo?: string;
    branch?: string;
    pane?: string;
    statusText?: string;
    now?: number;
  },
  db: Database = getStateDb(),
  deps: RegistryDeps = defaultRegistryDeps,
): SignInResult | undefined {
  const { sessionId, statusText } = args;
  // Defense in depth: session_id is a bare TEXT PRIMARY KEY with no NOT
  // NULL/CHECK constraint (bun:sqlite binds undefined as NULL), so a direct
  // caller must not be able to wedge a NULL-keyed row.
  if (!sessionId) throw new Error("signIn: sessionId is required");
  const cwd = args.cwd ?? null;
  const repo = args.repo ?? null;
  const branch = args.branch ?? null;
  const pane = args.pane ?? null;
  const now = args.now ?? Date.now();
  const th = presenceThresholds();
  const sessionStaleCutoff = now - th.sessionStaleMs;

  const run = db.transaction((): SignInResult => {
    // One registry scan for the whole transaction.
    const scoped = snapshotRegistryDeps(deps);
    prunePresence(now, db, scoped);

    const ownPriorRow = db.query(SELECT_PRESENCE_BY_SESSION_SQL).get(sessionId) as PresenceRawRow | null;
    // Resolve continueId (resolveHandle's live-name lookup included) before
    // dropping the caller's own row, or a session continuing its own live
    // display name would find no live holder for it and fall through to a
    // newer identity sharing that name.
    const target = args.continueId === undefined ? undefined : continuationTarget(args.continueId, db);
    if (ownPriorRow) db.query(DELETE_PRESENCE_BY_SESSION_SQL).run(sessionId);

    const continued = typeof target === "object";
    if (continued && !claimIdentitySeat(target.id, sessionStaleCutoff, scoped, db)) throw heldByAnotherSession(target.id);
    let identity: IdentityRow | undefined = continued
      ? target
      : (identityForSession(sessionId, db) ?? (ownPriorRow ? legacyIdentity(ownPriorRow) : undefined));
    if (!continued && identity && !claimIdentitySeat(identity.id, sessionStaleCutoff, scoped, db)) identity = undefined;
    const requestedBase = typeof target === "string" ? target : args.baseHandle;
    const baseHandle = continued ? target.baseName : (requestedBase ?? identity?.baseName ?? drawPoolName(db));

    const seats = seatsByName(db, sessionStaleCutoff, scoped);
    const name = pickDisplayName(baseHandle, identity?.name, { cwd, pane }, seats);
    const displaced = seats.get(name);
    if (displaced) db.query(DELETE_PRESENCE_BY_SESSION_SQL).run(displaced.session_id);

    let handle: string;
    if (identity) {
      handle = identity.id;
      bindIdentitySession(handle, sessionId, db);
      renameIdentity(handle, name, baseHandle, db);
    } else {
      handle = mintIdentity({ base: baseHandle, name, sessionId, now }, db).id;
    }
    db.query(INSERT_PRESENCE_SQL).run(sessionId, handle, baseHandle, cwd, repo, branch, pane, statusText ?? null, now, now);
    recordPoolNameUse(baseHandle, now, db);

    return { handle, baseHandle, name, reclaimed: displaced !== undefined, continued };
  });

  // A signed-in identity is not re-derivable from anything else (R057): a
  // busy connection here must retry, not warn-and-drop.
  return runCriticalWrite("signIn", () => run.immediate(), { sessionId });
}

const NAMES_KV_NS = "chat";
const NAMES_KV_KEY = "names";
const SELECT_ALL_BASES_SQL = `SELECT base_handle FROM chat_presence;`;

/** Runs after the prune, so every remaining row's base counts as held: signed-out rows in their offline window included, which is exactly the buddy list. */
function drawPoolName(db: Database): string {
  const taken = (db.query(SELECT_ALL_BASES_SQL).all() as { base_handle: string }[]).map((r) => r.base_handle);
  return pickAgentName(taken, getKvValue<Record<string, number>>(NAMES_KV_NS, NAMES_KV_KEY, {}, db));
}

function recordPoolNameUse(name: string, now: number, db: Database): void {
  if (!AGENT_NAMES.includes(name)) return;
  const ledger = getKvValue<Record<string, number>>(NAMES_KV_NS, NAMES_KV_KEY, {}, db);
  ledger[name] = now;
  setKvValue(NAMES_KV_NS, NAMES_KV_KEY, ledger, db);
}

/**
 * Mints the identity for an agent that has not signed in yet (`rt agent
 * start`) under a pool name drawn against the same held set and LRU ledger
 * `signIn` uses, and records the draw at once, so a second reservation or a
 * racing sign-in does not also land on the name. Returns the id; the agent's
 * sign-in continues it.
 */
export function reserveAgentHandle(db: Database = getStateDb(), now: number = Date.now()): string {
  const run = db.transaction((): string => {
    const name = drawPoolName(db);
    recordPoolNameUse(name, now, db);
    return mintIdentity({ base: name, name, sessionId: null, now }, db).id;
  });
  // BEGIN IMMEDIATE: read-then-write must lock up front or SQLITE_BUSY_SNAPSHOT
  // bypasses busy_timeout (same reason as signIn's).
  return run.immediate();
}

export function signOut(sessionId: string, now: number = Date.now(), db: Database = getStateDb()): void {
  // A sign-out lost to a busy write is not re-derivable later the way a
  // cache-class status write is (R057): retry rather than warn-and-drop.
  runCriticalWrite("signOut", () => { db.query(UPDATE_SIGN_OUT_SQL).run(now, sessionId); }, { sessionId });
}

export function setAway(sessionId: string, text: string | null, db: Database = getStateDb()): void {
  // Cache-class (R057): the next away/back toggle overwrites this row
  // regardless, so a busy write here warns and defers rather than throwing.
  persistOrWarn("presence", () => { db.query(UPDATE_STATUS_TEXT_SQL).run(text, sessionId); }, { op: "setAway", sessionId });
}

/**
 * Refreshes the SESSION heartbeat alone (no cwd/repo/branch/pane) -- the
 * only remaining route to it now that chat:pulse is gone. Called on every
 * successful delivery (lib/daemon/handlers/chat.ts's deliverPost and
 * deliverWelcomeOnce), so a handle actively receiving messages never goes
 * stale enough for prune to consider it, let alone delete it.
 */
export function touchLastSeen(sessionId: string, now: number, db: Database = getStateDb()): void {
  // Cache-class (R057): the next delivery's touch supersedes a dropped one,
  // so a busy write here warns and defers rather than throwing.
  persistOrWarn("presence", () => { db.query(UPDATE_LAST_SEEN_SQL).run(now, sessionId); }, { op: "touchLastSeen", sessionId });
}

export function listBuddies(
  now: number,
  db: Database = getStateDb(),
  deps: RegistryDeps = defaultRegistryDeps,
): Array<PresenceRow & { status: BuddyStatus }> {
  const th = presenceThresholds();
  const dayAgo = now - th.pruneMs;
  const rows = db.query(SELECT_ROSTER_SQL).all(dayAgo) as PresenceRawRow[];
  const names = identityNames(rows.map((row) => row.handle), db);
  // One registry scan for the whole roster, reused by every row's status.
  const scoped = snapshotRegistryDeps(deps);
  return rows.map((raw) => {
    const presence = rowToPresence(raw, names.get(raw.handle)!);
    return { ...presence, status: buddyStatus(presence, now, th, scoped) };
  });
}

export function presenceForHandle(handle: string, db: Database = getStateDb()): PresenceRow | null {
  const row = db.query(SELECT_PRESENCE_BY_HANDLE_SQL).get(handle) as PresenceRawRow | null;
  return row ? rowToPresence(row, identityName(row.handle, db)) : null;
}

export function presenceForSession(sessionId: string, db: Database = getStateDb()): PresenceRow | null {
  const row = db.query(SELECT_PRESENCE_BY_SESSION_SQL).get(sessionId) as PresenceRawRow | null;
  return row ? rowToPresence(row, identityName(row.handle, db)) : null;
}

/** Handle-keyed payloads (dm/dm-open): enforced only when a presence row exists for the handle AND a session id was offered (the unsigned plan-1 path stays unenforced). */
export function assertSessionOwnsHandle(handle: string, sessionId: string | undefined, db: Database = getStateDb()): void {
  if (sessionId === undefined) return;
  const row = db.query(SELECT_PRESENCE_BY_HANDLE_SQL).get(handle) as PresenceRawRow | null;
  if (row === null) return;
  if (row.session_id !== sessionId) throw heldByAnotherSession(handle);
}

/**
 * Session-keyed payloads (away/back): no row for this session id means the
 * handle was reclaimed; a row whose `signed_out_at` is set means this exact
 * session chose to sign out (a deliberate state, not a reclaim), so its
 * message must never contain "handle reclaimed" (the hook treats that
 * substring as the reclaimed notice).
 */
export function assertSessionSignedIn(sessionId: string, db: Database = getStateDb()): PresenceRow {
  const row = presenceForSession(sessionId, db);
  if (!row) throw new Error("chat: handle reclaimed while you were away; sign in again");
  if (row.signedOutAt !== undefined) throw new Error(`chat: session ${sessionId} is not signed in`);
  return row;
}

/**
 * Signed out more than 24h ago, or a session heartbeat over 24h old — the
 * two moments a handle is about to be needed (sign-in, daemon startup) are
 * the only call sites; RT_CHAT_PRUNE_MS has no other route in.
 *
 * PRUNABLE_SQL only narrows to candidates; the actual delete decision is
 * binding-aware, per row: signed out prunes unconditionally (that leg
 * already carries its own 24h age bound), but a never-signed-out row whose
 * session heartbeat merely went stale is spared as long as the registry
 * still vouches for it -- without chat:pulse to refresh last_seen_at, that
 * is the only thing standing between a session still busy on an autonomous
 * turn and getting pruned out from under it. `deps` is unscoped by default
 * (one directory read per candidate); pass a `snapshotRegistryDeps` result
 * from a caller that already paid for one scan this call (signIn does).
 */
export function prunePresence(now: number, db: Database = getStateDb(), deps: RegistryDeps = defaultRegistryDeps): number {
  const th = presenceThresholds();
  const dayAgo = now - th.pruneMs;
  const candidates = db.query(SELECT_PRUNE_CANDIDATES_SQL).all(dayAgo, dayAgo) as PresenceRawRow[];
  let deleted = 0;
  for (const row of candidates) {
    if (row.signed_out_at === null && bindingAlive(row.session_id, deps)) continue;
    db.query(DELETE_PRESENCE_BY_SESSION_SQL).run(row.session_id);
    deleted++;
  }
  return deleted;
}
