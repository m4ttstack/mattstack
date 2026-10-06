/**
 * Work submissions in state.db (v16): one row per work input sent to a bound
 * session, keyed by binding, attachment generation and the input's own id.
 *
 * `submitting` is written before the native side effect, so a row found in
 * that state by anyone but the call that wrote it is an interrupted send whose
 * outcome is unknown: it becomes `ambiguous` and is reconciled against native
 * evidence, never sent again. The input text is not stored, only its digest,
 * which is enough to recognize it in native history.
 */

import type { Database } from "bun:sqlite";
import { createHash } from "crypto";
import type { DeliveryReceipt, FaultCode, Outcome } from "../../packages/rt-client/src/agent-integrations.ts";
import { isBusyError } from "../state/busy.ts";

export type SubmissionState = "pending" | "submitting" | "submitted" | "queued" | "consumed" | "ambiguous" | "refused";
export const DELIVERED_STATES: ReadonlySet<SubmissionState> = new Set(["submitted", "queued", "consumed"]);

export type SubmissionKey = { bindingKey: string; generation: number; inputId: string };
export type WorkSubmission = SubmissionKey & {
  attemptId?: string; state: SubmissionState; digest: string;
  nativeId?: string; turnId?: string; itemId?: string; claimedBy?: string; error?: string;
  createdAt: number; updatedAt: number; submittingAt?: number;
};

interface Row {
  binding_key: string; generation: number; input_id: string; attempt_id: string | null; state: string; digest: string;
  native_id: string | null; turn_id: string | null; item_id: string | null; claimed_by: string | null; error: string | null;
  created_at: number; updated_at: number; submitting_at: number | null;
}

const COLUMNS = `binding_key, generation, input_id, attempt_id, state, digest, native_id, turn_id, item_id, claimed_by, error,
  created_at, updated_at, submitting_at`;
const SELECT_LATEST_SQL = `SELECT ${COLUMNS} FROM agent_work_submissions WHERE binding_key = ? AND input_id = ? ORDER BY generation DESC LIMIT 1;`;
const SELECT_ONE_SQL = `SELECT ${COLUMNS} FROM agent_work_submissions WHERE binding_key = ? AND generation = ? AND input_id = ?;`;
const SELECT_IN_STATE_SQL = `SELECT ${COLUMNS} FROM agent_work_submissions WHERE state = ? ORDER BY updated_at LIMIT ?;`;
const INSERT_PENDING_SQL = `INSERT OR IGNORE INTO agent_work_submissions (binding_key, generation, input_id, attempt_id, state, digest, created_at, updated_at)
VALUES (?, ?, ?, ?, 'pending', ?, ?, ?);`;
const SUBMITTING_SQL = `UPDATE agent_work_submissions SET state = 'submitting', claimed_by = ?, error = NULL, submitting_at = ?, updated_at = ?
WHERE binding_key = ? AND generation = ? AND input_id = ? AND state IN ('pending', 'refused');`;
const SETTLE_SQL = `UPDATE agent_work_submissions SET state = ?, native_id = COALESCE(?, native_id), turn_id = COALESCE(?, turn_id),
  item_id = COALESCE(?, item_id), error = ?, updated_at = ?
WHERE binding_key = ? AND generation = ? AND input_id = ? AND state IN (?, ?);`;

function toSubmission(r: Row): WorkSubmission {
  return {
    bindingKey: r.binding_key, generation: r.generation, inputId: r.input_id, state: r.state as SubmissionState,
    digest: r.digest, createdAt: r.created_at, updatedAt: r.updated_at,
    ...(r.attempt_id !== null && { attemptId: r.attempt_id }),
    ...(r.native_id !== null && { nativeId: r.native_id }),
    ...(r.turn_id !== null && { turnId: r.turn_id }),
    ...(r.item_id !== null && { itemId: r.item_id }),
    ...(r.claimed_by !== null && { claimedBy: r.claimed_by }),
    ...(r.error !== null && { error: r.error }),
    ...(r.submitting_at !== null && { submittingAt: r.submitting_at }),
  };
}

function fail<T>(code: FaultCode, message: string): Outcome<T> {
  return { ok: false, error: { code, message } };
}

function guarded<T>(op: () => Outcome<T>): Outcome<T> {
  try {
    return op();
  } catch (err) {
    if (isBusyError(err)) return fail("transient", "the state database is busy; the work was not sent");
    throw err;
  }
}

export function workDigest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The newest row for this input on this binding, at any generation. */
export function findSubmission(db: Database, bindingKey: string, inputId: string): WorkSubmission | null {
  const row = db.query(SELECT_LATEST_SQL).get(bindingKey, inputId) as Row | null;
  return row ? toSubmission(row) : null;
}

export function readSubmission(db: Database, key: SubmissionKey): WorkSubmission | null {
  const row = db.query(SELECT_ONE_SQL).get(key.bindingKey, key.generation, key.inputId) as Row | null;
  return row ? toSubmission(row) : null;
}

export function listSubmissions(db: Database, state: SubmissionState, limit = 50): WorkSubmission[] {
  return (db.query(SELECT_IN_STATE_SQL).all(state, limit) as Row[]).map(toSubmission);
}

export function recordPending(db: Database, key: SubmissionKey, digest: string, attemptId: string | undefined): Outcome<WorkSubmission> {
  return guarded(() => {
    const now = Date.now();
    db.query(INSERT_PENDING_SQL).run(key.bindingKey, key.generation, key.inputId, attemptId ?? null, digest, now, now);
    const row = readSubmission(db, key);
    return row ? { ok: true, data: row } : fail("transient", "the work submission was not recorded");
  });
}

/** The last write before the native side effect; false when another call already moved this row on. */
export function markSubmitting(db: Database, key: SubmissionKey, claimant: string): Outcome<boolean> {
  return guarded(() => {
    const now = Date.now();
    const changed = db.query(SUBMITTING_SQL).run(claimant, now, now, key.bindingKey, key.generation, key.inputId).changes;
    return { ok: true, data: changed > 0 };
  });
}

/** Moves a row out of one of `from` into `state`; false when it was in none of them. */
export function settleSubmission(
  db: Database, key: SubmissionKey, from: readonly [SubmissionState, SubmissionState], state: SubmissionState,
  detail: { receipt?: Pick<DeliveryReceipt, "nativeId" | "turnId" | "itemId">; error?: string } = {},
): boolean {
  const r = detail.receipt;
  try {
    return db.query(SETTLE_SQL).run(
      state, r?.nativeId ?? null, r?.turnId ?? null, r?.itemId ?? null, detail.error ?? null, Date.now(),
      key.bindingKey, key.generation, key.inputId, from[0], from[1],
    ).changes > 0;
  } catch (err) {
    if (isBusyError(err)) return false;
    throw err;
  }
}

export function receiptOf(row: WorkSubmission): DeliveryReceipt {
  return {
    id: row.inputId, evidence: row.state as DeliveryReceipt["evidence"],
    ...(row.nativeId !== undefined && { nativeId: row.nativeId }),
    ...(row.turnId !== undefined && { turnId: row.turnId }),
    ...(row.itemId !== undefined && { itemId: row.itemId }),
  };
}
