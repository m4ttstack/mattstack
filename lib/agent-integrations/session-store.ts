/**
 * Launch reservations and native session bindings in state.db (v16).
 *
 * A binding joins a Mattstack identity to one native session, named by its
 * full tuple (harness, profile, kind, value), so equal raw IDs from two
 * profiles or harnesses stay distinct. Its key is minted here and never
 * derived from the native reference. The attachment generation only moves
 * forward, inside the write transaction, and a result is returned only
 * after that write commits.
 *
 * An attachment is attached or detached by an explicit recorded state, never
 * inferred from the fields it lacks. A reservation records how far its
 * launch got (claimed, native session made, bound), which is what stops a
 * second process from starting another session for it. A binding records the
 * selection it launched with and the generation a launch verified ready; any
 * later generation is unready until verified again.
 */

import type { Database } from "bun:sqlite";
import type {
  Attachment, Capability, FaultCode, Mode, NativeSessionRef, Outcome, Selection, SessionBinding,
} from "../../packages/rt-client/src/agent-integrations.ts";
import { isBusyError } from "../state/busy.ts";

/** The profile of a session that names no account: the ambient one. */
export const LEGACY_DEFAULT_PROFILE = "default";

export type ReservationInput = { identity: string; agentId?: string; attemptId?: string };
export type AttachmentInput = Omit<Attachment, "generation">;
/** A stored attachment; `detached` is present only on a binding whose session left its attachment. */
export type StoredAttachment = Attachment & { detached?: true };

export interface SessionStore {
  reserve(input: ReservationInput): string;
  bind(reservationId: string, native: NativeSessionRef, attachment: AttachmentInput): Outcome<SessionBinding>;
  get(key: string): SessionBinding | null;
  find(native: NativeSessionRef): SessionBinding | null;
  replaceAttachment(key: string, expectedGeneration: number, attachment: AttachmentInput): Outcome<SessionBinding>;
  /** Advances the generation to a detached attachment: no pane, socket or process, in the same mode. */
  detach(key: string, expectedGeneration: number): Outcome<SessionBinding>;
}

const BINDING_COLUMNS =
  "key, identity, harness, profile, native_kind, native_value, generation, mode, pane, socket, pid, agent_id, attempt_id, attachment_state";

const INSERT_RESERVATION_SQL =
  "INSERT INTO agent_session_reservations (id, identity, agent_id, attempt_id, bound_key, created_at) VALUES (?, ?, ?, ?, NULL, ?);";
const SELECT_RESERVATION_SQL =
  "SELECT id, identity, agent_id, attempt_id, bound_key, request FROM agent_session_reservations WHERE id = ?;";
const MARK_RESERVATION_SQL =
  "UPDATE agent_session_reservations SET bound_key = ?, state = 'bound', launched = NULL, error = NULL, updated_at = ? WHERE id = ?;";
const SELECT_BY_KEY_SQL = `SELECT ${BINDING_COLUMNS} FROM agent_session_bindings WHERE key = ?;`;
const SELECT_BY_NATIVE_SQL =
  `SELECT ${BINDING_COLUMNS} FROM agent_session_bindings WHERE harness = ? AND profile = ? AND native_kind = ? AND native_value = ?;`;
const SELECT_BY_VALUE_SQL = `SELECT ${BINDING_COLUMNS} FROM agent_session_bindings WHERE native_value = ? ORDER BY bound_at, key;`;
const SELECT_ATTACHED_SQL = `SELECT ${BINDING_COLUMNS} FROM agent_session_bindings
WHERE harness = ? AND (pane IS NOT NULL OR socket IS NOT NULL OR pid IS NOT NULL) ORDER BY bound_at, key;`;
const SELECT_EVERY_ATTACHED_SQL =
  `SELECT ${BINDING_COLUMNS} FROM agent_session_bindings WHERE attachment_state = 'attached' ORDER BY bound_at, key;`;
const SELECT_AT_PANE_SQL =
  `SELECT ${BINDING_COLUMNS} FROM agent_session_bindings WHERE pane = ? AND attachment_state = 'attached' ORDER BY attached_at DESC, key;`;
const SELECT_BY_AGENT_SQL =
  `SELECT ${BINDING_COLUMNS} FROM agent_session_bindings WHERE agent_id = ? ORDER BY attached_at DESC, bound_at DESC, key;`;
const INSERT_BINDING_SQL = `INSERT INTO agent_session_bindings (${BINDING_COLUMNS}, bound_at, attached_at, selection)
VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 'attached', ?, ?, ?);`;
const REBIND_SQL = `UPDATE agent_session_bindings
SET generation = generation + 1, mode = ?, pane = ?, socket = ?, pid = ?, attachment_state = 'attached',
    agent_id = COALESCE(?, agent_id), attempt_id = COALESCE(?, attempt_id), attached_at = ?,
    selection = COALESCE(selection, ?)
WHERE key = ?;`;
const REPLACE_ATTACHMENT_SQL = `UPDATE agent_session_bindings
SET generation = generation + 1, mode = ?, pane = ?, socket = ?, pid = ?, attachment_state = ?, attached_at = ?
WHERE key = ? AND generation = ?;`;

interface ReservationRow {
  id: string; identity: string; agent_id: string | null; attempt_id: string | null; bound_key: string | null;
  request: string | null;
}

interface BindingRow {
  key: string; identity: string; harness: string; profile: string;
  native_kind: string; native_value: string; generation: number; mode: string;
  pane: string | null; socket: string | null; pid: number | null;
  agent_id: string | null; attempt_id: string | null; attachment_state: string;
}

function toBinding(r: BindingRow): SessionBinding {
  const attachment: StoredAttachment = { generation: r.generation, mode: r.mode as Mode };
  if (r.pane !== null) attachment.pane = r.pane;
  if (r.socket !== null) attachment.socket = r.socket;
  if (r.pid !== null) attachment.pid = r.pid;
  if (r.attachment_state === "detached") attachment.detached = true;
  const binding: SessionBinding = {
    key: r.key, identity: r.identity, attachment,
    native: { harness: r.harness, profile: r.profile, kind: r.native_kind as NativeSessionRef["kind"], value: r.native_value },
  };
  if (r.agent_id !== null) binding.agentId = r.agent_id;
  if (r.attempt_id !== null) binding.attemptId = r.attempt_id;
  return binding;
}

function fail(code: FaultCode, message: string): Outcome<never> {
  return { ok: false, error: { code, message } };
}

const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function nativeProblem(native: NativeSessionRef): string | undefined {
  if (!isText(native.harness) || !isText(native.profile) || !isText(native.value)) {
    return "a native session needs a harness, a profile and a value";
  }
  if (native.kind !== "id" && native.kind !== "path") return "a native session is named by an id or a path";
  return undefined;
}

function attachmentProblem(attachment: AttachmentInput): string | undefined {
  return attachment.mode === "herdr" || attachment.mode === "headless"
    ? undefined
    : "an attachment runs in herdr or headless mode";
}

function attachmentParams(a: AttachmentInput): [string, string | null, string | null, number | null] {
  return [a.mode, a.pane ?? null, a.socket ?? null, a.pid ?? null];
}

/** BEGIN IMMEDIATE when standalone, so the read and the write that depends on it hold one lock. */
function writeTransaction<T>(db: Database, fn: () => T): T {
  const run = db.transaction(fn);
  return db.inTransaction ? run() : run.immediate();
}

function guarded<T>(op: () => Outcome<T>, busy = "the state database is busy; nothing was recorded"): Outcome<T> {
  try {
    return op();
  } catch (err) {
    if (isBusyError(err)) return fail("transient", busy);
    throw err;
  }
}

function parseJson<T>(text: string | null): T | undefined {
  if (text === null) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** The selection a reservation's launch request carried, as a new binding stores it. */
function selectionOf(request: string | null): string | null {
  const parsed = parseJson<PersistedLaunch>(request);
  return parsed?.selection ? JSON.stringify(parsed.selection) : null;
}

/** Every binding whose native value is `value`, across harnesses, profiles and kinds. */
export function listBindingsByNativeValue(db: Database, value: string): SessionBinding[] {
  return (db.query(SELECT_BY_VALUE_SQL).all(value) as BindingRow[]).map(toBinding);
}

/** A harness's bindings whose attachment still names a pane, socket or process. */
export function listAttachedBindings(db: Database, harness: string): SessionBinding[] {
  return (db.query(SELECT_ATTACHED_SQL).all(harness) as BindingRow[]).map(toBinding);
}

/** Every binding recorded as attached, in any harness and mode, headless included. */
export function listEveryAttachedBinding(db: Database): SessionBinding[] {
  return (db.query(SELECT_EVERY_ATTACHED_SQL).all() as BindingRow[]).map(toBinding);
}

/** The attached bindings whose attachment names `pane`, as the ref it was recorded under; the most recently attached first. */
export function listBindingsAtPane(db: Database, pane: string): SessionBinding[] {
  return (db.query(SELECT_AT_PANE_SQL).all(pane) as BindingRow[]).map(toBinding);
}

/** An agent record's bindings, the most recently attached first. */
export function listBindingsByAgent(db: Database, agentId: string): SessionBinding[] {
  return (db.query(SELECT_BY_AGENT_SQL).all(agentId) as BindingRow[]).map(toBinding);
}

/** Whether a binding the store returned is detached. */
export function isDetachedAttachment(binding: SessionBinding): boolean {
  return (binding.attachment as StoredAttachment).detached === true;
}

export function createSessionStore(db: Database): SessionStore {
  const byKey = (key: string) => db.query(SELECT_BY_KEY_SQL).get(key) as BindingRow | null;
  const byNative = (n: NativeSessionRef) =>
    db.query(SELECT_BY_NATIVE_SQL).get(n.harness, n.profile, n.kind, n.value) as BindingRow | null;

  function replace(key: string, expectedGeneration: number, attachment: AttachmentInput, state: "attached" | "detached"): Outcome<SessionBinding> {
    const problem = attachmentProblem(attachment);
    if (problem) return fail("invalid", problem);
    return guarded(() => writeTransaction(db, () => {
      const result = db.query(REPLACE_ATTACHMENT_SQL).run(...attachmentParams(attachment), state, Date.now(), key, expectedGeneration);
      const row = byKey(key);
      if (!row) return fail("invalid", "no session binding has that key");
      if (result.changes === 0) {
        return fail("stale-binding", `attachment generation ${expectedGeneration} was replaced; the current one is ${row.generation}`);
      }
      return { ok: true, data: toBinding(row) };
    }));
  }

  return {
    reserve(input) {
      if (!isText(input.identity)) throw new Error("a launch reservation needs an identity");
      const id = `rsv-${crypto.randomUUID()}`;
      db.query(INSERT_RESERVATION_SQL).run(id, input.identity, input.agentId ?? null, input.attemptId ?? null, Date.now());
      return id;
    },

    bind(reservationId, native, attachment) {
      const problem = nativeProblem(native) ?? attachmentProblem(attachment);
      if (problem) return fail("invalid", problem);
      return guarded(() => writeTransaction(db, () => {
        const reservation = db.query(SELECT_RESERVATION_SQL).get(reservationId) as ReservationRow | null;
        if (!reservation) return fail("invalid", "no launch reservation has that id");
        const existing = byNative(native);
        if (reservation.bound_key !== null) {
          if (existing?.key === reservation.bound_key) return { ok: true, data: toBinding(existing) };
          return fail("refused", "that launch reservation is already bound to another session");
        }
        const now = Date.now();
        const selection = selectionOf(reservation.request);
        let key: string;
        if (existing) {
          if (existing.identity !== reservation.identity) {
            return fail("refused", "that native session already belongs to another identity");
          }
          key = existing.key;
          db.query(REBIND_SQL).run(...attachmentParams(attachment), reservation.agent_id, reservation.attempt_id, now, selection, key);
        } else {
          key = `sk-${crypto.randomUUID()}`;
          db.query(INSERT_BINDING_SQL).run(
            key, reservation.identity, native.harness, native.profile, native.kind, native.value,
            ...attachmentParams(attachment), reservation.agent_id, reservation.attempt_id, now, now, selection,
          );
        }
        db.query(MARK_RESERVATION_SQL).run(key, now, reservationId);
        return { ok: true, data: toBinding(byKey(key)!) };
      }));
    },

    get(key) {
      const row = byKey(key);
      return row ? toBinding(row) : null;
    },

    find(native) {
      const row = byNative(native);
      return row ? toBinding(row) : null;
    },

    replaceAttachment(key, expectedGeneration, attachment) {
      return replace(key, expectedGeneration, attachment, "attached");
    },

    detach(key, expectedGeneration) {
      const row = byKey(key);
      if (!row) return fail("invalid", "no session binding has that key");
      return replace(key, expectedGeneration, { mode: row.mode as Mode }, "detached");
    },
  };
}

// --- Reservation progress ---------------------------------------------------

export type ReservationState = "reserved" | "launching" | "launched" | "bound" | "failed" | "abandoned";

/** What a launch asked for, minus what is held only in memory (labels, environment, transports). */
export type PersistedLaunch = {
  cwd: string; mode: Mode; selection: Selection; required: Capability[];
  resumeKey?: string; nativeHint?: string;
};

/** A native session a launch made before its binding was written. */
export type LaunchedNative = { native: NativeSessionRef; attachment: AttachmentInput };

export type ReservationRecord = {
  id: string; identity: string; agentId?: string; attemptId?: string; boundKey?: string;
  state: ReservationState; claimedBy?: string; request?: PersistedLaunch; launched?: LaunchedNative;
  error?: string; createdAt: number; updatedAt?: number;
};

interface ReservationProgressRow {
  id: string; identity: string; agent_id: string | null; attempt_id: string | null; bound_key: string | null;
  state: string; claimed_by: string | null; request: string | null; launched: string | null;
  error: string | null; created_at: number; updated_at: number | null;
}

const SELECT_PROGRESS_SQL = `SELECT id, identity, agent_id, attempt_id, bound_key, state, claimed_by, request, launched, error, created_at, updated_at
FROM agent_session_reservations WHERE id = ?;`;
const CLAIM_SQL = `UPDATE agent_session_reservations SET state = 'launching', claimed_by = ?, request = ?, guard = ?, error = NULL, updated_at = ?
WHERE id = ? AND bound_key IS NULL AND state IN ('reserved', 'failed');`;
const GUARD_HELD_SQL = `SELECT id, agent_id FROM agent_session_reservations
WHERE guard = ? AND id != ? AND bound_key IS NULL AND state IN ('launching', 'launched') ORDER BY created_at LIMIT 1;`;
const STALE_LAUNCHES_SQL = `UPDATE agent_session_reservations SET state = 'abandoned',
  error = COALESCE(error || '; ', '') || 'rt stopped waiting for this launch to resolve', updated_at = ?
WHERE bound_key IS NULL AND state IN ('launching', 'launched') AND COALESCE(updated_at, created_at) < ?;`;
const UNRESOLVED_FOR_AGENT_SQL = `SELECT id, state, error FROM agent_session_reservations
WHERE agent_id = ? AND bound_key IS NULL AND state IN ('launching', 'launched', 'abandoned') AND created_at > ?
ORDER BY created_at DESC LIMIT 1;`;
const CLAIMED_FOR_AGENT_SQL = `SELECT 1 FROM agent_session_reservations
WHERE agent_id = ? AND (bound_key IS NOT NULL OR state NOT IN ('reserved', 'failed')) LIMIT 1;`;
const LAUNCHED_SQL =`UPDATE agent_session_reservations SET state = 'launched', launched = ?, error = NULL, updated_at = ?
WHERE id = ? AND bound_key IS NULL AND state = 'launching';`;
const FAILED_SQL = `UPDATE agent_session_reservations SET state = 'failed', error = ?, updated_at = ?
WHERE id = ? AND bound_key IS NULL AND state = 'launching';`;
const NOTE_ERROR_SQL = "UPDATE agent_session_reservations SET error = ?, updated_at = ? WHERE id = ? AND bound_key IS NULL;";
const PRUNE_SQL = `DELETE FROM agent_session_reservations
WHERE (state = 'bound' AND COALESCE(updated_at, created_at) < ?)
   OR (state IN ('reserved', 'failed') AND COALESCE(updated_at, created_at) < ?);`;

function toReservation(r: ReservationProgressRow): ReservationRecord {
  const request = parseJson<PersistedLaunch>(r.request);
  const launched = parseJson<LaunchedNative>(r.launched);
  return {
    id: r.id, identity: r.identity, state: r.state as ReservationState, createdAt: r.created_at,
    ...(r.agent_id !== null && { agentId: r.agent_id }),
    ...(r.attempt_id !== null && { attemptId: r.attempt_id }),
    ...(r.bound_key !== null && { boundKey: r.bound_key }),
    ...(r.claimed_by !== null && { claimedBy: r.claimed_by }),
    ...(request !== undefined && { request }),
    ...(launched !== undefined && { launched }),
    ...(r.error !== null && { error: r.error }),
    ...(r.updated_at !== null && { updatedAt: r.updated_at }),
  };
}

export function readReservation(db: Database, id: string): ReservationRecord | null {
  const row = db.query(SELECT_PROGRESS_SQL).get(id) as ReservationProgressRow | null;
  return row ? toReservation(row) : null;
}

/** Another reservation under `guard` whose launch is unresolved: the agent it launches for, or its own id. */
export function launchHolding(db: Database, guard: string, exceptId = ""): { reservationId: string; agentId?: string } | null {
  const row = db.query(GUARD_HELD_SQL).get(guard, exceptId) as { id: string; agent_id: string | null } | null;
  return row ? { reservationId: row.id, ...(row.agent_id !== null && { agentId: row.agent_id }) } : null;
}

/**
 * Persists, before any native side effect, that `claimant` is launching this
 * reservation. Only an unbound reservation that is reserved, or whose last
 * launch failed before making anything, can be claimed; any other state means
 * a launch is in progress or may have made a session, so the claim refuses.
 * The claim also refuses, in the same write lock, while another launch under
 * the same guard (harness, profile, cwd) is unresolved, whichever process
 * started it.
 */
export function claimReservation(
  db: Database, id: string, claimant: string, request: PersistedLaunch, guard?: string,
): Outcome<ReservationRecord> {
  return guarded(() => writeTransaction(db, () => {
    const held = guard === undefined ? null : launchHolding(db, guard, id);
    if (held) {
      return fail("refused", `${held.agentId !== undefined ? `agent ${held.agentId}` : `launch ${held.reservationId}`} is still launching here, or its launch's outcome is unknown; rt will not start another session in the same place until it resolves`);
    }
    const changed = db.query(CLAIM_SQL).run(claimant, JSON.stringify(request), guard ?? null, Date.now(), id).changes;
    const row = readReservation(db, id);
    if (!row) return fail("invalid", "no launch reservation has that id");
    if (changed === 0) return fail("ambiguous", `launch reservation ${id} is already ${row.state}; rt will not start another session for it`);
    return { ok: true, data: row };
  }), "the state database is busy; nothing was launched");
}

/** Records the native session a launch made, so a bind that fails afterwards is retried without launching again. */
export function recordLaunched(db: Database, id: string, launched: LaunchedNative): boolean {
  try {
    return db.query(LAUNCHED_SQL).run(JSON.stringify(launched), Date.now(), id).changes > 0;
  } catch (err) {
    if (isBusyError(err)) return false;
    throw err;
  }
}

/** A launch that made nothing: the reservation can be claimed again. */
export function failReservation(db: Database, id: string, message: string): void {
  try {
    db.query(FAILED_SQL).run(message, Date.now(), id);
  } catch (err) {
    if (!isBusyError(err)) throw err;
  }
}

/** A launch whose outcome is unknown keeps its claim; only its last error is noted. */
export function noteReservationError(db: Database, id: string, message: string): void {
  try {
    db.query(NOTE_ERROR_SQL).run(message, Date.now(), id);
  } catch (err) {
    if (!isBusyError(err)) throw err;
  }
}

/** Unresolved launches untouched since `before` stop holding their guard; they stay recorded for attention and are never relaunched. */
export function abandonStaleLaunches(db: Database, before: number): number {
  try {
    return db.query(STALE_LAUNCHES_SQL).run(Date.now(), before).changes;
  } catch (err) {
    if (isBusyError(err)) return 0;
    throw err;
  }
}

/** This agent's newest launch made after `since` whose outcome is unknown, or that rt stopped waiting on. */
export function unresolvedLaunchOf(
  db: Database, agentId: string, since = -1,
): { reservationId: string; state: ReservationState; error?: string } | null {
  const row = db.query(UNRESOLVED_FOR_AGENT_SQL).get(agentId, since) as { id: string; state: string; error: string | null } | null;
  return row ? { reservationId: row.id, state: row.state as ReservationState, ...(row.error !== null && { error: row.error }) } : null;
}

/** Whether any launch for this agent got past its claim, so a session may exist whatever the caller saw. */
export function launchClaimedFor(db: Database, agentId: string): boolean {
  return db.query(CLAIMED_FOR_AGENT_SQL).get(agentId) !== null;
}

/** Drops bound reservations older than `boundBefore` and unlaunched or failed ones older than `idleBefore`; an unresolved launch is kept. */
export function pruneReservations(db: Database, boundBefore: number, idleBefore: number): number {
  try {
    return db.query(PRUNE_SQL).run(boundBefore, idleBefore).changes;
  } catch (err) {
    if (isBusyError(err)) return 0;
    throw err;
  }
}

// --- Binding selection and readiness ----------------------------------------

export type PolicyProofRecord = {
  sessionKey: string; generation: number; revision: string; verified: Capability[]; observedAt: number;
};
export type BindingReadiness = {
  /** The generation a launch verified ready, or null while unready. */
  generation: number | null;
  required: Capability[];
  proof?: PolicyProofRecord;
};

const SELECT_READINESS_SQL = "SELECT ready_generation, required, proof, selection FROM agent_session_bindings WHERE key = ?;";
const MARK_READY_SQL = `UPDATE agent_session_bindings SET ready_generation = ?, required = ?, proof = ?
WHERE key = ? AND generation = ?;`;

interface ReadinessRow { ready_generation: number | null; required: string | null; proof: string | null; selection: string | null }

export function readBindingReadiness(db: Database, key: string): BindingReadiness | null {
  const row = db.query(SELECT_READINESS_SQL).get(key) as ReadinessRow | null;
  if (!row) return null;
  const proof = parseJson<PolicyProofRecord>(row.proof);
  return {
    generation: row.ready_generation,
    required: parseJson<Capability[]>(row.required) ?? [],
    ...(proof !== undefined && { proof }),
  };
}

export function readBindingSelection(db: Database, key: string): Selection | null {
  const row = db.query(SELECT_READINESS_SQL).get(key) as ReadinessRow | null;
  return parseJson<Selection>(row?.selection ?? null) ?? null;
}

/** Records readiness for exactly `generation`; a binding that has moved on stays unready. */
export function markBindingReady(
  db: Database, key: string, generation: number, required: readonly Capability[], proof?: PolicyProofRecord,
): Outcome<void> {
  return guarded(() => {
    const changed = db.query(MARK_READY_SQL)
      .run(generation, JSON.stringify([...required]), proof ? JSON.stringify(proof) : null, key, generation).changes;
    return changed > 0
      ? { ok: true, data: undefined }
      : fail("stale-binding", `session binding ${key} is no longer at generation ${generation}`);
  }, "the state database is busy; readiness was not recorded");
}
