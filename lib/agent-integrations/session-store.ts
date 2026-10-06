/**
 * Launch reservations and native session bindings in state.db (v16).
 *
 * A binding joins a Mattstack identity to one native session, named by its
 * full tuple (harness, profile, kind, value), so equal raw IDs from two
 * profiles or harnesses stay distinct. Its key is minted here and never
 * derived from the native reference. The attachment generation only moves
 * forward, inside the write transaction, and a result is returned only
 * after that write commits.
 */

import type { Database } from "bun:sqlite";
import type {
  Attachment, FaultCode, Mode, NativeSessionRef, Outcome, SessionBinding,
} from "../../packages/rt-client/src/agent-integrations.ts";
import { isBusyError } from "../state/busy.ts";

/** The profile of a session that names no account: the ambient one. */
export const LEGACY_DEFAULT_PROFILE = "default";

export type ReservationInput = { identity: string; agentId?: string; attemptId?: string };
export type AttachmentInput = Omit<Attachment, "generation">;

export interface SessionStore {
  reserve(input: ReservationInput): string;
  bind(reservationId: string, native: NativeSessionRef, attachment: AttachmentInput): Outcome<SessionBinding>;
  get(key: string): SessionBinding | null;
  find(native: NativeSessionRef): SessionBinding | null;
  replaceAttachment(key: string, expectedGeneration: number, attachment: AttachmentInput): Outcome<SessionBinding>;
}

const BINDING_COLUMNS =
  "key, identity, harness, profile, native_kind, native_value, generation, mode, pane, socket, pid, agent_id, attempt_id";

const INSERT_RESERVATION_SQL =
  "INSERT INTO agent_session_reservations (id, identity, agent_id, attempt_id, bound_key, created_at) VALUES (?, ?, ?, ?, NULL, ?);";
const SELECT_RESERVATION_SQL =
  "SELECT id, identity, agent_id, attempt_id, bound_key FROM agent_session_reservations WHERE id = ?;";
const MARK_RESERVATION_SQL = "UPDATE agent_session_reservations SET bound_key = ? WHERE id = ?;";
const SELECT_BY_KEY_SQL = `SELECT ${BINDING_COLUMNS} FROM agent_session_bindings WHERE key = ?;`;
const SELECT_BY_NATIVE_SQL =
  `SELECT ${BINDING_COLUMNS} FROM agent_session_bindings WHERE harness = ? AND profile = ? AND native_kind = ? AND native_value = ?;`;
const SELECT_BY_VALUE_SQL = `SELECT ${BINDING_COLUMNS} FROM agent_session_bindings WHERE native_value = ? ORDER BY bound_at, key;`;
const SELECT_ATTACHED_SQL = `SELECT ${BINDING_COLUMNS} FROM agent_session_bindings
WHERE harness = ? AND (pane IS NOT NULL OR socket IS NOT NULL OR pid IS NOT NULL) ORDER BY bound_at, key;`;
const INSERT_BINDING_SQL = `INSERT INTO agent_session_bindings (${BINDING_COLUMNS}, bound_at, attached_at)
VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?);`;
const REBIND_SQL = `UPDATE agent_session_bindings
SET generation = generation + 1, mode = ?, pane = ?, socket = ?, pid = ?,
    agent_id = COALESCE(?, agent_id), attempt_id = COALESCE(?, attempt_id), attached_at = ?
WHERE key = ?;`;
const REPLACE_ATTACHMENT_SQL = `UPDATE agent_session_bindings
SET generation = generation + 1, mode = ?, pane = ?, socket = ?, pid = ?, attached_at = ?
WHERE key = ? AND generation = ?;`;

interface ReservationRow {
  id: string; identity: string; agent_id: string | null; attempt_id: string | null; bound_key: string | null;
}

interface BindingRow {
  key: string; identity: string; harness: string; profile: string;
  native_kind: string; native_value: string; generation: number; mode: string;
  pane: string | null; socket: string | null; pid: number | null;
  agent_id: string | null; attempt_id: string | null;
}

function toBinding(r: BindingRow): SessionBinding {
  const attachment: Attachment = { generation: r.generation, mode: r.mode as Mode };
  if (r.pane !== null) attachment.pane = r.pane;
  if (r.socket !== null) attachment.socket = r.socket;
  if (r.pid !== null) attachment.pid = r.pid;
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

function guarded(op: () => Outcome<SessionBinding>): Outcome<SessionBinding> {
  try {
    return op();
  } catch (err) {
    if (isBusyError(err)) return fail("transient", "the state database is busy; nothing was recorded");
    throw err;
  }
}

/** Every binding whose native value is `value`, across harnesses, profiles and kinds. */
export function listBindingsByNativeValue(db: Database, value: string): SessionBinding[] {
  return (db.query(SELECT_BY_VALUE_SQL).all(value) as BindingRow[]).map(toBinding);
}

/** A harness's bindings whose attachment still names a pane, socket or process. */
export function listAttachedBindings(db: Database, harness: string): SessionBinding[] {
  return (db.query(SELECT_ATTACHED_SQL).all(harness) as BindingRow[]).map(toBinding);
}

export function createSessionStore(db: Database): SessionStore {
  const byKey = (key: string) => db.query(SELECT_BY_KEY_SQL).get(key) as BindingRow | null;
  const byNative = (n: NativeSessionRef) =>
    db.query(SELECT_BY_NATIVE_SQL).get(n.harness, n.profile, n.kind, n.value) as BindingRow | null;

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
        let key: string;
        if (existing) {
          if (existing.identity !== reservation.identity) {
            return fail("refused", "that native session already belongs to another identity");
          }
          key = existing.key;
          db.query(REBIND_SQL).run(...attachmentParams(attachment), reservation.agent_id, reservation.attempt_id, now, key);
        } else {
          key = `sk-${crypto.randomUUID()}`;
          db.query(INSERT_BINDING_SQL).run(
            key, reservation.identity, native.harness, native.profile, native.kind, native.value,
            ...attachmentParams(attachment), reservation.agent_id, reservation.attempt_id, now, now,
          );
        }
        db.query(MARK_RESERVATION_SQL).run(key, reservationId);
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
      const problem = attachmentProblem(attachment);
      if (problem) return fail("invalid", problem);
      return guarded(() => writeTransaction(db, () => {
        const result = db.query(REPLACE_ATTACHMENT_SQL).run(...attachmentParams(attachment), Date.now(), key, expectedGeneration);
        const row = byKey(key);
        if (!row) return fail("invalid", "no session binding has that key");
        if (result.changes === 0) {
          return fail("stale-binding", `attachment generation ${expectedGeneration} was replaced; the current one is ${row.generation}`);
        }
        return { ok: true, data: toBinding(row) };
      }));
    },
  };
}
