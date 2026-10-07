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

export type CompletionState = "pending" | "completed" | "gone" | "conflict";

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
  /** Bound gates that are answered or closed and whose completion is missing or pending, oldest binding first. */
  recoverable(limit: number): string[];
  /** Deletes bindings and completions whose gate no longer exists; returns how many rows went. */
  pruneOrphans(): number;
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
  ORDER BY q.boundAt, q.rowid
  LIMIT ?`;
const PRUNE_BINDINGS_SQL = "DELETE FROM gate_native_questions WHERE gateId NOT IN (SELECT id FROM gates)";
const PRUNE_COMPLETIONS_SQL = "DELETE FROM gate_native_completion WHERE gateId NOT IN (SELECT id FROM gates)";

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
    completion,
    intend(gateId, fingerprint, now = Date.now()) {
      db.query(INTEND_SQL).run(gateId, fingerprint, now, now);
      return completion(gateId)!;
    },
    settle(gateId, state, detail, now = Date.now()) {
      return db.query(SETTLE_SQL).run(state, detail, now, gateId).changes > 0;
    },
    recoverable(limit) {
      return (db.query(RECOVERABLE_SQL).all(Math.max(1, Math.floor(limit))) as Array<{ gateId: string }>).map((r) => r.gateId);
    },
    pruneOrphans() {
      return db.transaction(() => db.query(PRUNE_BINDINGS_SQL).run().changes + db.query(PRUNE_COMPLETIONS_SQL).run().changes)();
    },
  };
}
