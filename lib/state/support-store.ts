/**
 * lib/state/support-store.ts: the only module that touches
 * `support_requests`, `support_outbox` and `support_stops`.
 */

import type { Database } from "bun:sqlite";
import type { SupportDirection, SupportPart, SupportRequest, SupportState } from "../../packages/rt-client/src/support.ts";
import { CHAT_RETENTION_MS } from "./chat-store.ts";
import { getStateDb } from "./db.ts";

export type { SupportDirection, SupportPart, SupportRequest, SupportState };

export const SUPPORT_TERMINAL_STATES = [
  "opened",
  "already-waiting",
  "already-open",
  "declined",
  "not-accepting",
  "failed",
  "expired",
] as const satisfies readonly SupportState[];

interface RequestRow {
  id: string;
  direction: SupportDirection;
  peer: string;
  org: string;
  text: string;
  parts: string;
  slack_user_id: string;
  state: SupportState;
  reason: string | null;
  dm_link: string | null;
  conversation_id: number | null;
  gate_id: string | null;
  status_at: number;
  sent_at: number;
  received_at: number;
  updated_at: number;
}

function toRequest(r: RequestRow): SupportRequest {
  return {
    id: r.id,
    direction: r.direction,
    peer: r.peer,
    org: r.org,
    text: r.text,
    parts: JSON.parse(r.parts) as SupportPart[],
    slackUserId: r.slack_user_id,
    state: r.state,
    reason: r.reason,
    dmLink: r.dm_link,
    conversationId: r.conversation_id,
    gateId: r.gate_id,
    statusAt: r.status_at,
    sentAt: r.sent_at,
    receivedAt: r.received_at,
    updatedAt: r.updated_at,
  };
}

/** False for a repeat of the same id from the same person, which changes nothing. */
export function insertRequest(r: Omit<SupportRequest, "updatedAt">, db: Database = getStateDb()): boolean {
  const { changes } = db
    .query(
      `INSERT INTO support_requests
         (direction, peer, id, org, text, parts, slack_user_id, state, reason, dm_link, conversation_id, gate_id, status_at, sent_at, received_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(direction, peer, id) DO NOTHING;`,
    )
    .run(
      r.direction,
      r.peer,
      r.id,
      r.org,
      r.text,
      JSON.stringify(r.parts),
      r.slackUserId,
      r.state,
      r.reason,
      r.dmLink,
      r.conversationId,
      r.gateId,
      r.statusAt,
      r.sentAt,
      r.receivedAt,
      r.receivedAt,
    );
  return changes > 0;
}

export function getRequest(direction: SupportDirection, peer: string, id: string, db: Database = getStateDb()): SupportRequest | null {
  const row = db
    .query(`SELECT * FROM support_requests WHERE direction = ? AND peer = ? AND id = ?;`)
    .get(direction, peer, id) as RequestRow | null;
  return row ? toRequest(row) : null;
}

/** Oldest arrival first; `states` left out lists every state. */
export function listRequests(direction: SupportDirection, states?: readonly SupportState[], db: Database = getStateDb()): SupportRequest[] {
  const filter = states === undefined ? "" : ` AND state IN (${states.map(() => "?").join(", ")})`;
  const rows = db
    .query(`SELECT * FROM support_requests WHERE direction = ?${filter} ORDER BY received_at, rowid;`)
    .all(direction, ...(states ?? [])) as RequestRow[];
  return rows.map(toRequest);
}

type RequestKey = Pick<SupportRequest, "direction" | "peer" | "id">;
type RequestPatch = Partial<Pick<SupportRequest, "state" | "reason" | "dmLink" | "conversationId" | "gateId" | "statusAt">>;

const PATCH_COLUMNS = { state: "state", reason: "reason", dmLink: "dm_link", conversationId: "conversation_id", gateId: "gate_id", statusAt: "status_at" } as const;

/** True only for the caller that found the row in one of `from`. */
export function moveRequest(r: RequestKey, from: readonly SupportState[], patch: RequestPatch, now: number, db: Database = getStateDb()): boolean {
  if (from.length === 0) return false;
  const fields = (Object.keys(PATCH_COLUMNS) as (keyof typeof PATCH_COLUMNS)[]).filter((f) => patch[f] !== undefined);
  const sets = [...fields.map((f) => `${PATCH_COLUMNS[f]} = ?`), "updated_at = ?"].join(", ");
  const { changes } = db
    .query(`UPDATE support_requests SET ${sets} WHERE direction = ? AND peer = ? AND id = ? AND state IN (${from.map(() => "?").join(", ")});`)
    .run(...fields.map((f) => patch[f] ?? null), now, r.direction, r.peer, r.id, ...from);
  return changes > 0;
}

export function requestForConversation(conversationId: number, db: Database = getStateDb()): SupportRequest | null {
  const row = db
    .query(`SELECT * FROM support_requests WHERE direction = 'in' AND conversation_id = ? ORDER BY rowid DESC LIMIT 1;`)
    .get(conversationId) as RequestRow | null;
  return row ? toRequest(row) : null;
}

export function requestForGate(gateId: string, db: Database = getStateDb()): SupportRequest | null {
  const row = db
    .query(`SELECT * FROM support_requests WHERE direction = 'in' AND gate_id = ? LIMIT 1;`)
    .get(gateId) as RequestRow | null;
  return row ? toRequest(row) : null;
}

/** A status waits here until the relay takes it. One already waiting under this id for this person stands. */
export function queueStatus(o: { id: string; to: string; body: string }, now: number, db: Database = getStateDb()): void {
  db.query(`INSERT OR IGNORE INTO support_outbox (id, to_user, body, created_at) VALUES (?, ?, ?, ?);`).run(o.id, o.to, o.body, now);
}

export function pendingStatuses(db: Database = getStateDb()): { id: string; to: string; body: string; createdAt: number }[] {
  return (
    db.query(`SELECT id, to_user, body, created_at FROM support_outbox ORDER BY rowid;`).all() as {
      id: string;
      to_user: string;
      body: string;
      created_at: number;
    }[]
  ).map((r) => ({ id: r.id, to: r.to_user, body: r.body, createdAt: r.created_at }));
}

export function dropStatus(id: string, to: string, db: Database = getStateDb()): void {
  db.query(`DELETE FROM support_outbox WHERE id = ? AND to_user = ?;`).run(id, to);
}

export function recordStop(slackUserId: string, now: number, db: Database = getStateDb()): void {
  db.query(`INSERT INTO support_stops (slack_user_id, stopped_at) VALUES (?, ?);`).run(slackUserId, now);
}

export function stoppedSince(slackUserId: string, since: number, db: Database = getStateDb()): boolean {
  return db.query(`SELECT 1 FROM support_stops WHERE slack_user_id = ? AND stopped_at >= ? LIMIT 1;`).get(slackUserId, since) !== null;
}

/** Drops finished requests, stops and unsent statuses past the chat history's own retention. */
export function pruneSupport(now: number, db: Database = getStateDb()): void {
  const cutoff = now - CHAT_RETENTION_MS;
  db.query(`DELETE FROM support_requests WHERE received_at < ? AND state IN (${SUPPORT_TERMINAL_STATES.map(() => "?").join(", ")});`).run(cutoff, ...SUPPORT_TERMINAL_STATES);
  db.query(`DELETE FROM support_stops WHERE stopped_at < ?;`).run(cutoff);
  db.query(`DELETE FROM support_outbox WHERE created_at < ?;`).run(cutoff);
}
