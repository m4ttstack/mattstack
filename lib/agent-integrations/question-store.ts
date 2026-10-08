/**
 * Durable native question state, in gates.db beside the gates it belongs to.
 *
 * A binding records which native question presented a gate: the session key,
 * the attachment generation and the native thread/turn/item/question ids. A
 * completion records rt's attempt to finish that question once the gate is
 * answered or closed. Neither ever holds the answer: the gate row is the
 * authority, and a completion keeps only a fingerprint of the row it acted on.
 * Connection ids and RPC request ids never reach this store.
 *
 * gates-store.ts creates the tables; this module only reads and writes them.
 */

import type { Database } from "bun:sqlite";
import type { QuestionBinding } from "../../packages/rt-client/src/agent-integrations.ts";

/** `stuck`: retries ran out without the harness ever finishing the question. */
export type CompletionState = "pending" | "completed" | "gone" | "conflict" | "stuck";

/** Backoff for `recoverable`: a pending completion is due once `baseMs * 2^(attempts-1)`, capped at `maxMs`, has passed since its last update. */
export type RetryDue = { now: number; baseMs: number; maxMs: number };

export type CompletionRecord = {
  gateId: string;
  state: CompletionState;
  /** Of the gate row the completion acts on; set by the first intent and never changed. */
  fingerprint: string;
  attempts: number;
  detail: string | null;
  createdAt: number;
  updatedAt: number;
};

export interface QuestionStore {
  /** Writes the gate's binding, replacing any earlier one. */
  bind(binding: QuestionBinding, now?: number): void;
  get(gateId: string): QuestionBinding | null;
  /** The gate most recently bound to this native item of this thread, if any. */
  gateForItem(thread: string, item: string): string | null;
  /** Bindings of this thread's gates that are still open or parked. */
  openForThread(thread: string): QuestionBinding[];
  completion(gateId: string): CompletionRecord | null;
  /**
   * Records an attempt about to start: a new pending record with
   * `fingerprint`, or one more attempt on a pending one. An existing record's
   * fingerprint and a settled state are never changed. Returns the record as
   * it now stands.
   */
  intend(gateId: string, fingerprint: string, now?: number): CompletionRecord;
  /** Moves a pending completion to `state`; false when it was not pending. */
  settle(gateId: string, state: CompletionState, detail: string | null, now?: number): boolean;
  /**
   * Bound gates that are answered or closed and whose completion is missing
   * or pending, least recently tried first, so rows that stay pending rotate
   * behind ones never tried. With `due`, only rows whose backoff has passed.
   */
  recoverable(limit: number, due?: RetryDue): string[];
  /** Deletes bindings and completions whose gate no longer exists; returns how many rows went. */
  pruneOrphans(): number;
  /** Moves a session's questions from one attachment generation to the next, for a continuation of the same session; returns how many moved. */
  carryGeneration(sessionKey: string, from: number, to: number): number;
}

type BindingRow = {
  gateId: string; sessionKey: string; generation: number;
  nativeThread: string | null; nativeTurn: string | null; nativeItem: string | null;
  nativeQuestions: string | null; presentation: "form" | "wait";
};

function toBinding(row: BindingRow): QuestionBinding {
  return {
    gateId: row.gateId, sessionKey: row.sessionKey, generation: row.generation,
    ...(row.nativeThread != null && { nativeThread: row.nativeThread }),
    ...(row.nativeTurn != null && { nativeTurn: row.nativeTurn }),
    ...(row.nativeItem != null && { nativeItem: row.nativeItem }),
    ...(row.nativeQuestions != null && { nativeQuestions: JSON.parse(row.nativeQuestions) as string[] }),
    presentation: row.presentation,
  };
}

const UPSERT_BINDING_SQL = `
  INSERT INTO gate_native_questions
    (gateId, sessionKey, generation, nativeThread, nativeTurn, nativeItem, nativeQuestions, presentation, boundAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(gateId) DO UPDATE SET
    sessionKey = excluded.sessionKey, generation = excluded.generation,
    nativeThread = excluded.nativeThread, nativeTurn = excluded.nativeTurn, nativeItem = excluded.nativeItem,
    nativeQuestions = excluded.nativeQuestions, presentation = excluded.presentation, boundAt = excluded.boundAt`;
const SELECT_BINDING_SQL = "SELECT * FROM gate_native_questions WHERE gateId = ?";
const SELECT_ITEM_SQL = `
  SELECT gateId FROM gate_native_questions WHERE nativeThread = ? AND nativeItem = ?
  ORDER BY boundAt DESC, rowid DESC LIMIT 1`;
const OPEN_FOR_THREAD_SQL = `
  SELECT q.* FROM gate_native_questions q JOIN gates g ON g.id = q.gateId
  WHERE q.nativeThread = ? AND g.status IN ('open', 'parked') ORDER BY q.boundAt, q.rowid`;
const SELECT_COMPLETION_SQL = "SELECT * FROM gate_native_completion WHERE gateId = ?";
const INTEND_SQL = `
  INSERT INTO gate_native_completion (gateId, state, fingerprint, attempts, detail, createdAt, updatedAt)
  VALUES (?, 'pending', ?, 1, NULL, ?, ?)
  ON CONFLICT(gateId) DO UPDATE SET attempts = attempts + 1, updatedAt = excluded.updatedAt
  WHERE gate_native_completion.state = 'pending'`;
const SETTLE_SQL = "UPDATE gate_native_completion SET state = ?, detail = ?, updatedAt = ? WHERE gateId = ? AND state = 'pending'";
const RECOVERABLE_SQL = `
  SELECT q.gateId AS gateId FROM gate_native_questions q
  JOIN gates g ON g.id = q.gateId
  LEFT JOIN gate_native_completion c ON c.gateId = q.gateId
  WHERE g.status IN ('answered', 'closed') AND (c.gateId IS NULL OR c.state = 'pending')
  ORDER BY COALESCE(c.updatedAt, q.boundAt), q.rowid
  LIMIT ?`;
const DUE_SQL = `
  SELECT q.gateId AS gateId FROM gate_native_questions q
  JOIN gates g ON g.id = q.gateId
  LEFT JOIN gate_native_completion c ON c.gateId = q.gateId
  WHERE g.status IN ('answered', 'closed')
    AND (c.gateId IS NULL OR (c.state = 'pending'
      AND c.updatedAt + MIN(?1 * (1 << MIN(MAX(c.attempts - 1, 0), 20)), ?2) <= ?3))
  ORDER BY COALESCE(c.updatedAt, q.boundAt), q.rowid
  LIMIT ?4`;
const PRUNE_BINDINGS_SQL = "DELETE FROM gate_native_questions WHERE gateId NOT IN (SELECT id FROM gates)";
const PRUNE_COMPLETIONS_SQL = "DELETE FROM gate_native_completion WHERE gateId NOT IN (SELECT id FROM gates)";
const CARRY_GENERATION_SQL = "UPDATE gate_native_questions SET generation = ? WHERE sessionKey = ? AND generation = ?";

export function createQuestionStore(db: Database): QuestionStore {
  const completion = (gateId: string): CompletionRecord | null =>
    (db.query(SELECT_COMPLETION_SQL).get(gateId) as CompletionRecord | null) ?? null;

  return {
    bind(binding, now = Date.now()) {
      db.query(UPSERT_BINDING_SQL).run(
        binding.gateId, binding.sessionKey, binding.generation,
        binding.nativeThread ?? null, binding.nativeTurn ?? null, binding.nativeItem ?? null,
        binding.nativeQuestions ? JSON.stringify(binding.nativeQuestions) : null,
        binding.presentation, now,
      );
    },
    get(gateId) {
      const row = db.query(SELECT_BINDING_SQL).get(gateId) as BindingRow | null;
      return row ? toBinding(row) : null;
    },
    gateForItem(thread, item) {
      const row = db.query(SELECT_ITEM_SQL).get(thread, item) as { gateId: string } | null;
      return row?.gateId ?? null;
    },
    openForThread(thread) {
      return (db.query(OPEN_FOR_THREAD_SQL).all(thread) as BindingRow[]).map(toBinding);
    },
    completion,
    intend(gateId, fingerprint, now = Date.now()) {
      db.query(INTEND_SQL).run(gateId, fingerprint, now, now);
      return completion(gateId)!;
    },
    settle(gateId, state, detail, now = Date.now()) {
      return db.query(SETTLE_SQL).run(state, detail, now, gateId).changes > 0;
    },
    recoverable(limit, due) {
      const capped = Math.max(1, Math.floor(limit));
      const rows = due
        ? db.query(DUE_SQL).all(due.baseMs, due.maxMs, due.now, capped)
        : db.query(RECOVERABLE_SQL).all(capped);
      return (rows as Array<{ gateId: string }>).map((r) => r.gateId);
    },
    pruneOrphans() {
      return db.transaction(() => db.query(PRUNE_BINDINGS_SQL).run().changes + db.query(PRUNE_COMPLETIONS_SQL).run().changes)();
    },
    carryGeneration(sessionKey, from, to) {
      return db.query(CARRY_GENERATION_SQL).run(to, sessionKey, from).changes;
    },
  };
}
