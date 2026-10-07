/**
 * Peer delivery evidence in state.db (v16): one row per logical delivery,
 * which is one chat message to one recipient, keyed by its stable id.
 *
 * A row records the latest attempt (binding, attachment generation, the frame
 * it rode in) and the strongest evidence that attempt got: `pending` (nothing
 * known to be sent yet, or a definite failure), `submitted`, `queued`,
 * `consumed`, `ambiguous` (it may have been sent) or `refused`. A consumed
 * row is never written again. Message bodies are not stored: the room log is
 * the recovery source, and a row's room and message id point back into it.
 */

import type { Database } from "bun:sqlite";
import type { DeliveryReceipt, FaultCode, Outcome } from "../../packages/rt-client/src/agent-integrations.ts";
import { isBusyError } from "../state/busy.ts";

export type DeliveryState = "pending" | "submitted" | "queued" | "consumed" | "ambiguous" | "refused";
/** States whose outcome is still open, so the row is reconciled and redelivered. */
export const UNRESOLVED_STATES: ReadonlySet<DeliveryState> = new Set(["pending", "ambiguous"]);

export type DeliveryRow = {
  inputId: string; recipient: string; sessionKey: string; generation: number; harness: string;
  state: DeliveryState; frameId: string; attempts: number; createdAt: number; updatedAt: number;
  nativeId?: string; turnId?: string; itemId?: string; room?: string; messageId?: number;
  nextAttemptAt?: number; error?: string;
};

/** One attempt: every constituent of the frame, under the binding it is sent to. */
export type DeliveryAttempt = {
  frameId: string; recipient: string; sessionKey: string; generation: number; harness: string;
  constituents: ReadonlyArray<{ id: string; room?: string; messageId?: number }>;
};

interface Row {
  input_id: string; recipient: string; session_key: string; generation: number; harness: string; state: string;
  native_id: string | null; turn_id: string | null; item_id: string | null; frame_id: string;
  room: string | null; message_id: number | null; attempts: number; next_attempt_at: number | null;
  error: string | null; created_at: number; updated_at: number;
}

const COLUMNS = `input_id, recipient, session_key, generation, harness, state, native_id, turn_id, item_id, frame_id,
  room, message_id, attempts, next_attempt_at, error, created_at, updated_at`;
const SELECT_ONE_SQL = `SELECT ${COLUMNS} FROM agent_deliveries WHERE input_id = ?;`;
const SELECT_FRAME_SQL = `SELECT ${COLUMNS} FROM agent_deliveries WHERE frame_id = ? ORDER BY input_id;`;
const SELECT_DUE_SQL = `SELECT ${COLUMNS} FROM agent_deliveries
WHERE state IN ('pending', 'ambiguous') AND next_attempt_at IS NOT NULL AND next_attempt_at <= ?
ORDER BY next_attempt_at, updated_at LIMIT ?;`;
const RECORD_ATTEMPT_SQL = `INSERT INTO agent_deliveries
  (input_id, recipient, session_key, generation, harness, state, frame_id, room, message_id, attempts, next_attempt_at, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, 1, ?, ?, ?)
ON CONFLICT(input_id) DO UPDATE SET
  recipient = excluded.recipient, session_key = excluded.session_key, generation = excluded.generation,
  harness = excluded.harness, state = 'pending', frame_id = excluded.frame_id,
  room = COALESCE(excluded.room, room), message_id = COALESCE(excluded.message_id, message_id),
  native_id = NULL, turn_id = NULL, item_id = NULL, error = NULL, next_attempt_at = excluded.next_attempt_at,
  attempts = attempts + 1, updated_at = excluded.updated_at
WHERE agent_deliveries.state <> 'consumed';`;
const SETTLE_ATTEMPT_SQL = `UPDATE agent_deliveries SET state = ?, native_id = ?, turn_id = ?, item_id = ?, error = ?,
  next_attempt_at = ?, updated_at = ?
WHERE frame_id = ? AND session_key = ? AND generation = ? AND state = 'pending';`;
const INTERRUPTED_SQL = `UPDATE agent_deliveries SET state = 'ambiguous', error = ?, updated_at = ?
WHERE frame_id = ? AND session_key = ? AND generation = ? AND state = 'pending' AND error IS NULL;`;
const SETTLE_EVIDENCE_SQL = `UPDATE agent_deliveries SET state = ?, native_id = COALESCE(?, native_id),
  turn_id = COALESCE(?, turn_id), item_id = COALESCE(?, item_id), error = NULL, next_attempt_at = NULL, updated_at = ?
WHERE frame_id = ? AND session_key = ? AND generation = ? AND state IN ('pending', 'ambiguous', 'submitted', 'queued');`;
const SCHEDULE_SQL = `UPDATE agent_deliveries SET next_attempt_at = ?, updated_at = ?
WHERE input_id = ? AND state IN ('pending', 'ambiguous') AND updated_at = ?;`;
const HARNESS_DUE_SQL = `UPDATE agent_deliveries SET next_attempt_at = ?
WHERE harness = ? AND state IN ('pending', 'ambiguous') AND next_attempt_at IS NOT NULL AND next_attempt_at > ?;`;
const OWED_SQL = "SELECT last_read_id FROM chat_members WHERE room = ? AND handle = ?;";
const PRUNE_SQL = `DELETE FROM agent_deliveries WHERE rowid IN (
  SELECT rowid FROM agent_deliveries WHERE updated_at < ? AND (state NOT IN ('pending', 'ambiguous') OR next_attempt_at IS NULL) LIMIT ?
);`;

function toDelivery(r: Row): DeliveryRow {
  return {
    inputId: r.input_id, recipient: r.recipient, sessionKey: r.session_key, generation: r.generation, harness: r.harness,
    state: r.state as DeliveryState, frameId: r.frame_id, attempts: r.attempts, createdAt: r.created_at, updatedAt: r.updated_at,
    ...(r.native_id !== null && { nativeId: r.native_id }),
    ...(r.turn_id !== null && { turnId: r.turn_id }),
    ...(r.item_id !== null && { itemId: r.item_id }),
    ...(r.room !== null && { room: r.room }),
    ...(r.message_id !== null && { messageId: r.message_id }),
    ...(r.next_attempt_at !== null && { nextAttemptAt: r.next_attempt_at }),
    ...(r.error !== null && { error: r.error }),
  };
}

function fail<T>(code: FaultCode, message: string): Outcome<T> {
  return { ok: false, error: { code, message } };
}

/** A busy database leaves the row as it was; the next attempt or sweep writes it again. */
function quietly<T>(op: () => T, busy: T): T {
  try {
    return op();
  } catch (err) {
    if (isBusyError(err)) return busy;
    throw err;
  }
}

export function readDelivery(db: Database, inputId: string): DeliveryRow | null {
  const row = db.query(SELECT_ONE_SQL).get(inputId) as Row | null;
  return row ? toDelivery(row) : null;
}

export function readFrame(db: Database, frameId: string): DeliveryRow[] {
  return (db.query(SELECT_FRAME_SQL).all(frameId) as Row[]).map(toDelivery);
}

/** Unresolved rows due for reconciliation by `now`, the longest-waiting first. */
export function listDueDeliveries(db: Database, now: number, limit: number): DeliveryRow[] {
  return (db.query(SELECT_DUE_SQL).all(now, limit) as Row[]).map(toDelivery);
}

/**
 * The write before the native side effect: every constituent becomes pending
 * under this attempt's binding, already scheduled at `dueAt`, so an attempt a
 * crash interrupts before it is settled is still found by reconciliation. A
 * consumed constituent keeps its evidence.
 */
export function recordAttempt(db: Database, attempt: DeliveryAttempt, now: number, dueAt: number): Outcome<void> {
  try {
    db.transaction(() => {
      for (const c of attempt.constituents) {
        db.query(RECORD_ATTEMPT_SQL).run(
          c.id, attempt.recipient, attempt.sessionKey, attempt.generation, attempt.harness, attempt.frameId,
          c.room ?? null, c.messageId ?? null, dueAt, now, now,
        );
      }
    })();
    return { ok: true, data: undefined };
  } catch (err) {
    if (isBusyError(err)) return fail("transient", "the state database is busy, so nothing was sent");
    throw err;
  }
}

/** Records how the attempt for `frameId` ended, on the rows that attempt left pending. */
export function settleAttempt(
  db: Database, attempt: Pick<DeliveryAttempt, "frameId" | "sessionKey" | "generation">, state: DeliveryState, now: number,
  detail: { receipt?: Pick<DeliveryReceipt, "nativeId" | "turnId" | "itemId">; error?: string; nextAttemptAt?: number } = {},
): void {
  const r = detail.receipt;
  quietly(() => db.query(SETTLE_ATTEMPT_SQL).run(
    state, r?.nativeId ?? null, r?.turnId ?? null, r?.itemId ?? null, detail.error ?? null, detail.nextAttemptAt ?? null, now,
    attempt.frameId, attempt.sessionKey, attempt.generation,
  ), undefined);
}

/**
 * A pending row with no recorded outcome whose attempt is not running: the
 * process that sent it stopped between recording and settling, so the frame
 * may have gone out. Every failure settles with its error, so only an
 * unsettled attempt is pending without one.
 */
export function isInterrupted(row: DeliveryRow): boolean {
  return row.state === "pending" && row.error === undefined && row.attempts > 0;
}

/** Records an interrupted attempt's frame as ambiguous, so it is reconciled before anything is sent again. */
export function markInterrupted(db: Database, row: Pick<DeliveryRow, "frameId" | "sessionKey" | "generation">, now: number): void {
  quietly(() => db.query(INTERRUPTED_SQL).run(
    "the attempt was interrupted before its outcome was recorded", now, row.frameId, row.sessionKey, row.generation,
  ), undefined);
}

/** Native evidence for a frame sent under this binding and generation; a consumed row stays consumed. */
export function settleEvidence(
  db: Database, attempt: Pick<DeliveryAttempt, "frameId" | "sessionKey" | "generation">, receipt: DeliveryReceipt, now: number,
): void {
  quietly(() => db.query(SETTLE_EVIDENCE_SQL).run(
    receipt.evidence, receipt.nativeId ?? null, receipt.turnId ?? null, receipt.itemId ?? null, now,
    attempt.frameId, attempt.sessionKey, attempt.generation,
  ), undefined);
}

/** Moves an unresolved row's next reconciliation; null stops scheduling it. Skipped when another write touched the row since it was read. */
export function scheduleDelivery(db: Database, row: Pick<DeliveryRow, "inputId" | "updatedAt">, nextAttemptAt: number | null, now: number): void {
  quietly(() => db.query(SCHEDULE_SQL).run(nextAttemptAt, now, row.inputId, row.updatedAt), undefined);
}

/** After a reconnect, a harness's scheduled unresolved rows are due now. */
export function markHarnessDue(db: Database, harness: string, now: number): number {
  return quietly(() => db.query(HARNESS_DUE_SQL).run(now, harness, now).changes, 0);
}

/** Whether the room log still owes this delivery: the recipient's cursor is behind its message. Outside chat it always is. */
export function owedByRoomLog(db: Database, row: Pick<DeliveryRow, "room" | "messageId" | "recipient">): boolean {
  if (row.room === undefined || row.messageId === undefined) return true;
  const member = db.query(OWED_SQL).get(row.room, row.recipient) as { last_read_id: number } | null;
  return member !== null && member.last_read_id < row.messageId;
}

/** Deletes settled or unscheduled rows untouched since `before`, a bounded number per call. */
export function pruneDeliveries(db: Database, before: number, limit: number): number {
  return quietly(() => db.query(PRUNE_SQL).run(before, limit).changes, 0);
}

export function receiptOfDelivery(row: DeliveryRow): DeliveryReceipt {
  return {
    id: row.inputId, evidence: row.state as DeliveryReceipt["evidence"],
    ...(row.nativeId !== undefined && { nativeId: row.nativeId }),
    ...(row.turnId !== undefined && { turnId: row.turnId }),
    ...(row.itemId !== undefined && { itemId: row.itemId }),
  };
}
