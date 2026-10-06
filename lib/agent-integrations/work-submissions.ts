/**
 * Work submissions in state.db (v16): one row per work input sent to a bound
 * session, keyed by binding, attachment generation and the input's own id.
 *
 * `submitting` is written before the native side effect, so a row found in
 * that state by anyone but the call that wrote it is an interrupted send whose
 * outcome is unknown: it becomes `ambiguous` and is reconciled against native
 * evidence, never sent again. Checks back off exponentially; a row that never
 * shows evidence ends `abandoned`, which asks for attention and is still never
 * resent. The input text is not stored, only its digest, which is enough to
 * recognize it in native history.
 */

import type { Database } from "bun:sqlite";
import { createHash } from "crypto";
import type { DeliveryReceipt, FaultCode, Outcome } from "../../packages/rt-client/src/agent-integrations.ts";
import { isBusyError } from "../state/busy.ts";

export type SubmissionState =
  | "pending" | "submitting" | "submitted" | "queued" | "consumed" | "ambiguous" | "refused" | "abandoned";
export const DELIVERED_STATES: ReadonlySet<SubmissionState> = new Set(["submitted", "queued", "consumed"]);

/** The first recheck of an ambiguous submission waits this long; each further one doubles it, up to the cap. */
export const RECHECK_BASE_MS = 30_000;
export const RECHECK_CAP_MS = 30 * 60_000;
/** Checks without evidence before rt stops checking and asks for attention. */
export const RECHECK_LIMIT = 10;

export type SubmissionKey = { bindingKey: string; generation: number; inputId: string };
export type WorkSubmission = SubmissionKey & {
  attemptId?: string; state: SubmissionState; digest: string;
  nativeId?: string; turnId?: string; itemId?: string; claimedBy?: string; error?: string;
  createdAt: number; updatedAt: number; submittingAt?: number;
  checks: number; nextCheckAt?: number; guard?: string;
};

interface Row {
  binding_key: string; generation: number; input_id: string; attempt_id: string | null; state: string; digest: string;
  native_id: string | null; turn_id: string | null; item_id: string | null; claimed_by: string | null; error: string | null;
  created_at: number; updated_at: number; submitting_at: number | null;
  checks: number; next_check_at: number | null; guard: string | null;
}

const COLUMNS = `binding_key, generation, input_id, attempt_id, state, digest, native_id, turn_id, item_id, claimed_by, error,
  created_at, updated_at, submitting_at, checks, next_check_at, guard`;
const SELECT_LATEST_SQL = `SELECT ${COLUMNS} FROM agent_work_submissions WHERE binding_key = ? AND input_id = ? ORDER BY generation DESC LIMIT 1;`;
const SELECT_ONE_SQL = `SELECT ${COLUMNS} FROM agent_work_submissions WHERE binding_key = ? AND generation = ? AND input_id = ?;`;
const SELECT_IN_STATE_SQL = `SELECT ${COLUMNS} FROM agent_work_submissions WHERE state = ? ORDER BY updated_at LIMIT ?;`;
const SELECT_DUE_SQL = `SELECT ${COLUMNS} FROM agent_work_submissions
WHERE state = 'ambiguous' AND COALESCE(next_check_at, 0) <= ? ORDER BY COALESCE(next_check_at, 0), updated_at LIMIT ?;`;
const SELECT_STALE_PENDING_SQL = `SELECT ${COLUMNS} FROM agent_work_submissions WHERE state = 'pending' AND updated_at < ? LIMIT ?;`;
const INSERT_PENDING_SQL = `INSERT OR IGNORE INTO agent_work_submissions
  (binding_key, generation, input_id, attempt_id, state, digest, guard, created_at, updated_at)
VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?);`;
const SUBMITTING_SQL = `UPDATE agent_work_submissions SET state = 'submitting', claimed_by = ?, error = NULL, submitting_at = ?, updated_at = ?
WHERE binding_key = ? AND generation = ? AND input_id = ? AND state IN ('pending', 'refused');`;
const SETTLE_SQL = `UPDATE agent_work_submissions SET state = ?, native_id = COALESCE(?, native_id), turn_id = COALESCE(?, turn_id),
  item_id = COALESCE(?, item_id), error = ?, updated_at = ?
WHERE binding_key = ? AND generation = ? AND input_id = ? AND state IN (?, ?);`;
const CHECKED_SQL = `UPDATE agent_work_submissions SET checks = ?, next_check_at = ?, state = ?, error = COALESCE(?, error), updated_at = ?
WHERE binding_key = ? AND generation = ? AND input_id = ? AND state = 'ambiguous';`;
/** An unresolved send under this guard, and the agent its session belongs to. */
const IN_PROGRESS_SQL = `SELECT s.state AS state, b.agent_id AS agent_id FROM agent_work_submissions s
LEFT JOIN agent_session_bindings b ON b.key = s.binding_key
WHERE s.guard = ? AND s.state IN ('submitting', 'ambiguous') ORDER BY s.created_at LIMIT 1;`;
const ATTENTION_SQL = `SELECT s.state AS state, s.input_id AS input_id, s.error AS error FROM agent_work_submissions s
JOIN agent_session_bindings b ON b.key = s.binding_key
WHERE b.agent_id = ? AND s.state IN ('submitting', 'ambiguous', 'abandoned') ORDER BY s.created_at DESC LIMIT 1;`;

function toSubmission(r: Row): WorkSubmission {
  return {
    bindingKey: r.binding_key, generation: r.generation, inputId: r.input_id, state: r.state as SubmissionState,
    digest: r.digest, createdAt: r.created_at, updatedAt: r.updated_at, checks: r.checks,
    ...(r.attempt_id !== null && { attemptId: r.attempt_id }),
    ...(r.native_id !== null && { nativeId: r.native_id }),
    ...(r.turn_id !== null && { turnId: r.turn_id }),
    ...(r.item_id !== null && { itemId: r.item_id }),
    ...(r.claimed_by !== null && { claimedBy: r.claimed_by }),
    ...(r.error !== null && { error: r.error }),
    ...(r.submitting_at !== null && { submittingAt: r.submitting_at }),
    ...(r.next_check_at !== null && { nextCheckAt: r.next_check_at }),
    ...(r.guard !== null && { guard: r.guard }),
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

function quietly(op: () => boolean): boolean {
  try {
    return op();
  } catch (err) {
    if (isBusyError(err)) return false;
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

/** Ambiguous rows due for a check by `now`, the longest-waiting first, so rows already checked never starve new ones. */
export function listDueSubmissions(db: Database, now: number, limit = 50): WorkSubmission[] {
  return (db.query(SELECT_DUE_SQL).all(now, limit) as Row[]).map(toSubmission);
}

/** Pending rows untouched since `before`: their call ended before sending, so nothing reached a session. */
export function listStalePending(db: Database, before: number, limit = 50): WorkSubmission[] {
  return (db.query(SELECT_STALE_PENDING_SQL).all(before, limit) as Row[]).map(toSubmission);
}

export function recordPending(
  db: Database, key: SubmissionKey, digest: string, attemptId: string | undefined, guard?: string,
): Outcome<WorkSubmission> {
  return guarded(() => {
    const now = Date.now();
    db.query(INSERT_PENDING_SQL).run(key.bindingKey, key.generation, key.inputId, attemptId ?? null, digest, guard ?? null, now, now);
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
  return quietly(() => db.query(SETTLE_SQL).run(
    state, r?.nativeId ?? null, r?.turnId ?? null, r?.itemId ?? null, detail.error ?? null, Date.now(),
    key.bindingKey, key.generation, key.inputId, from[0], from[1],
  ).changes > 0);
}

/**
 * Records a check of an ambiguous row that found no evidence: the next one
 * waits twice as long, and the last allowed check abandons the row. Returns
 * the state the row is left in.
 */
export function noteCheck(db: Database, row: WorkSubmission, now: number, why?: string): SubmissionState {
  const checks = row.checks + 1;
  const state: SubmissionState = checks >= RECHECK_LIMIT ? "abandoned" : "ambiguous";
  const wait = Math.min(RECHECK_BASE_MS * 2 ** (checks - 1), RECHECK_CAP_MS);
  quietly(() => db.query(CHECKED_SQL).run(
    checks, state === "abandoned" ? null : now + wait, state, why ?? null, now,
    row.bindingKey, row.generation, row.inputId,
  ).changes > 0);
  return state;
}

/** Stops checking a row that can never be checked (its session binding is gone). */
export function abandonSubmission(db: Database, row: SubmissionKey, why: string): boolean {
  return settleSubmission(db, row, ["ambiguous", "submitting"], "abandoned", { error: why });
}

/** An unresolved send under this launch guard, if any, and the agent whose session it went to. */
export function sendInProgress(db: Database, guard: string): { agentId?: string } | null {
  const row = db.query(IN_PROGRESS_SQL).get(guard) as { state: string; agent_id: string | null } | null;
  return row ? { ...(row.agent_id !== null && { agentId: row.agent_id }) } : null;
}

/** The newest submission of this agent's sessions whose outcome is unknown, for attention. */
export function unresolvedSubmissionOf(db: Database, agentId: string): { state: SubmissionState; inputId: string; error?: string } | null {
  const row = db.query(ATTENTION_SQL).get(agentId) as { state: string; input_id: string; error: string | null } | null;
  return row ? { state: row.state as SubmissionState, inputId: row.input_id, ...(row.error !== null && { error: row.error }) } : null;
}

export function receiptOf(row: WorkSubmission): DeliveryReceipt {
  return {
    id: row.inputId, evidence: row.state as DeliveryReceipt["evidence"],
    ...(row.nativeId !== undefined && { nativeId: row.nativeId }),
    ...(row.turnId !== undefined && { turnId: row.turnId }),
    ...(row.itemId !== undefined && { itemId: row.itemId }),
  };
}
