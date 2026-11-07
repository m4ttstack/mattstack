/**
 * lib/state/slack-conversation-store.ts — the only module that touches
 * `slack_conversations` and `slack_items`.
 */

import { Database } from "bun:sqlite";
import { CHAT_RETENTION_MS } from "./chat-store.ts";
import { getStateDb } from "./db.ts";

export type SlackCloseReason = "closed-by-pane" | "idle" | "operator" | "pane-gone";
export type SlackItemKind = "message" | "operator-slack" | "check-in" | "close-request" | "closed" | "resumed";

export interface SlackConversation {
  id: number;
  room: string;
  agentHandle: string;
  slackHandle: string;
  slackUserId: string;
  slackChannel: string;
  slackDisplayName: string;
  operatorUserId: string;
  operatorName: string;
  frameMarker: string;
  lastReadTs: string;
  threadReadTs: Record<string, string>;
  lastActiveAt: number;
  checkedInAt: number | null;
  closeAskedAt: number | null;
  closeReasonAsked: SlackCloseReason | null;
  watcherSeenAt: number | null;
  stalledNotedAt: number | null;
  openedAt: number;
  closedAt: number | null;
  closeReason: SlackCloseReason | null;
  requesterSession: string | null;
  requesterHandle: string | null;
  requesterPane: string | null;
  brief: string | null;
  resumedFrom: number | null;
  graceUntil: number | null;
  assignedAgent: string | null;
  assignedSession: string | null;
  assignedPane: string | null;
  /** The repo the support agent was started for, so a resume with a fresh agent starts it in the same place. */
  repo: string | null;
}

export interface SupportTicket {
  id: string;
  title: string;
  url: string;
  createdAt: number;
}

export interface SlackItem {
  id: number;
  conversationId: number;
  kind: SlackItemKind;
  fromHandle: string | null;
  text: string;
  createdAt: number;
  deliveredAt: number | null;
}

export class SlackConversationBusy extends Error {
  constructor(public readonly holderAgent: string) {
    super(`slack: a conversation is already open (held by ${holderAgent})`);
    this.name = "SlackConversationBusy";
  }
}

interface ConversationRow {
  id: number;
  room: string;
  agent_handle: string;
  slack_handle: string;
  slack_user_id: string;
  slack_channel: string;
  slack_display_name: string;
  operator_user_id: string;
  operator_name: string;
  frame_marker: string;
  last_read_ts: string;
  thread_read_ts: string;
  last_active_at: number;
  checked_in_at: number | null;
  close_asked_at: number | null;
  close_reason_asked: SlackCloseReason | null;
  watcher_seen_at: number | null;
  stalled_noted_at: number | null;
  opened_at: number;
  closed_at: number | null;
  close_reason: SlackCloseReason | null;
  requester_session: string | null;
  requester_handle: string | null;
  requester_pane: string | null;
  brief: string | null;
  resumed_from: number | null;
  grace_until: number | null;
  assigned_agent: string | null;
  assigned_session: string | null;
  assigned_pane: string | null;
  repo: string | null;
}

interface TicketRow {
  issue_id: string;
  title: string;
  url: string;
  created_at: number;
}

interface ItemRow {
  id: number;
  conversation_id: number;
  kind: SlackItemKind;
  from_handle: string | null;
  text: string;
  created_at: number;
  delivered_at: number | null;
}

const INSERT_CONVERSATION_SQL = `INSERT INTO slack_conversations
  (room, agent_handle, slack_handle, slack_user_id, slack_channel, slack_display_name, operator_user_id, operator_name, frame_marker, last_read_ts, last_active_at, opened_at,
   requester_session, requester_handle, requester_pane, brief, resumed_from, assigned_agent, assigned_session, assigned_pane, repo)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *;`;
const SELECT_OPEN_BY_USER_SQL = `SELECT * FROM slack_conversations WHERE slack_user_id = ? AND closed_at IS NULL;`;
const SELECT_OPEN_BY_AGENT_SQL = `SELECT * FROM slack_conversations WHERE agent_handle = ? AND closed_at IS NULL;`;
const SELECT_OPEN_BY_ROOM_SQL = `SELECT * FROM slack_conversations WHERE room = ? AND closed_at IS NULL;`;
const SELECT_LATEST_BY_ROOM_SQL = `SELECT * FROM slack_conversations WHERE room = ? ORDER BY id DESC LIMIT 1;`;
const SELECT_BY_ID_SQL = `SELECT * FROM slack_conversations WHERE id = ?;`;
const SELECT_OPEN_SQL = `SELECT * FROM slack_conversations WHERE closed_at IS NULL ORDER BY id;`;
const SELECT_LATEST_CLOSED_SQL = `SELECT * FROM slack_conversations WHERE closed_at IS NOT NULL AND id IN (SELECT MAX(id) FROM slack_conversations GROUP BY room) ORDER BY id;`;

function toConversation(r: ConversationRow): SlackConversation {
  return {
    id: r.id,
    room: r.room,
    agentHandle: r.agent_handle,
    slackHandle: r.slack_handle,
    slackUserId: r.slack_user_id,
    slackChannel: r.slack_channel,
    slackDisplayName: r.slack_display_name,
    operatorUserId: r.operator_user_id,
    operatorName: r.operator_name,
    frameMarker: r.frame_marker,
    lastReadTs: r.last_read_ts,
    threadReadTs: JSON.parse(r.thread_read_ts) as Record<string, string>,
    lastActiveAt: r.last_active_at,
    checkedInAt: r.checked_in_at,
    closeAskedAt: r.close_asked_at,
    closeReasonAsked: r.close_reason_asked,
    watcherSeenAt: r.watcher_seen_at,
    stalledNotedAt: r.stalled_noted_at,
    openedAt: r.opened_at,
    closedAt: r.closed_at,
    closeReason: r.close_reason,
    requesterSession: r.requester_session,
    requesterHandle: r.requester_handle,
    requesterPane: r.requester_pane,
    brief: r.brief,
    resumedFrom: r.resumed_from,
    graceUntil: r.grace_until,
    assignedAgent: r.assigned_agent,
    assignedSession: r.assigned_session,
    assignedPane: r.assigned_pane,
    repo: r.repo,
  };
}

function toItem(r: ItemRow): SlackItem {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    kind: r.kind,
    fromHandle: r.from_handle,
    text: r.text,
    createdAt: r.created_at,
    deliveredAt: r.delivered_at,
  };
}

type RequesterField =
  | "requesterSession"
  | "requesterHandle"
  | "requesterPane"
  | "brief"
  | "resumedFrom"
  | "assignedAgent"
  | "assignedSession"
  | "assignedPane"
  | "repo";

export type OpenConversationArgs = Partial<Pick<SlackConversation, RequesterField>> &
  Pick<
  SlackConversation,
  | "room"
  | "agentHandle"
  | "slackHandle"
  | "slackUserId"
  | "slackChannel"
  | "slackDisplayName"
  | "operatorUserId"
  | "operatorName"
  | "frameMarker"
  | "lastReadTs"
  | "openedAt"
  >;

export function openConversation(args: OpenConversationArgs, db: Database = getStateDb()): SlackConversation {
  try {
    const row = db
      .query(INSERT_CONVERSATION_SQL)
      .get(
        args.room,
        args.agentHandle,
        args.slackHandle,
        args.slackUserId,
        args.slackChannel,
        args.slackDisplayName,
        args.operatorUserId,
        args.operatorName,
        args.frameMarker,
        args.lastReadTs,
        args.openedAt,
        args.openedAt,
        args.requesterSession ?? null,
        args.requesterHandle ?? null,
        args.requesterPane ?? null,
        args.brief ?? null,
        args.resumedFrom ?? null,
        args.assignedAgent ?? null,
        args.assignedSession ?? null,
        args.assignedPane ?? null,
        args.repo ?? null,
      ) as ConversationRow;
    expireOtherGrace(args.slackUserId, row.id, args.openedAt, db);
    return toConversation(row);
  } catch (e) {
    if (!/UNIQUE constraint failed/.test((e as Error).message)) throw e;
    const byUser = db.query(SELECT_OPEN_BY_USER_SQL).get(args.slackUserId) as ConversationRow | null;
    if (byUser) throw new SlackConversationBusy(byUser.agent_handle);
    throw new SlackConversationBusy(args.agentHandle);
  }
}

export function conversationForAgent(agentHandle: string, db: Database = getStateDb()): SlackConversation | undefined {
  const row = db.query(SELECT_OPEN_BY_AGENT_SQL).get(agentHandle) as ConversationRow | null;
  return row ? toConversation(row) : undefined;
}

/** The open conversation whose support agent runs in this session. */
export function conversationForAssignedSession(sessionId: string, db: Database = getStateDb()): SlackConversation | null {
  const row = db
    .query(`SELECT * FROM slack_conversations WHERE assigned_session = ? AND closed_at IS NULL;`)
    .get(sessionId) as ConversationRow | null;
  return row ? toConversation(row) : null;
}

/** A closed chat this session's agent ran that is still in its grace window, so its watcher has more to wait for. */
export function gracedConversationForSession(agentHandle: string, sessionId: string, now: number, db: Database = getStateDb()): SlackConversation | undefined {
  const row = db
    .query(`SELECT * FROM slack_conversations WHERE agent_handle = ? AND assigned_session = ? AND closed_at IS NOT NULL AND grace_until > ? ORDER BY id DESC LIMIT 1;`)
    .get(agentHandle, sessionId, now) as ConversationRow | null;
  return row ? toConversation(row) : undefined;
}

export function startGrace(id: number, until: number, db: Database = getStateDb()): void {
  db.query(`UPDATE slack_conversations SET grace_until = ? WHERE id = ?;`).run(until, id);
}

export function endGrace(id: number, db: Database = getStateDb()): void {
  db.query(`UPDATE slack_conversations SET grace_until = NULL WHERE id = ?;`).run(id);
}

export function listGracedConversations(now: number, db: Database = getStateDb()): SlackConversation[] {
  return (
    db
      .query(`SELECT * FROM slack_conversations WHERE closed_at IS NOT NULL AND grace_until > ? ORDER BY id;`)
      .all(now) as ConversationRow[]
  ).map(toConversation);
}

/**
 * One person has one live grace window: the newest conversation's. Older windows run out now rather than
 * ending here, so the grace sweep that finds them closes their pane the way it does for any other run-out.
 */
export function expireOtherGrace(slackUserId: string, exceptId: number, now: number, db: Database = getStateDb()): void {
  db.query(
    `UPDATE slack_conversations SET grace_until = ? WHERE slack_user_id = ? AND id != ? AND closed_at IS NOT NULL AND grace_until > ?;`,
  ).run(now, slackUserId, exceptId, now);
}

/** A newer conversation, or a live one, is still using this pane. */
export function paneInUse(pane: string, exceptId: number, db: Database = getStateDb()): boolean {
  return (
    db
      .query(`SELECT 1 FROM slack_conversations WHERE assigned_pane = ? AND id != ? AND (closed_at IS NULL OR id > ?) LIMIT 1;`)
      .get(pane, exceptId, exceptId) !== null
  );
}

/** Closed rows whose grace window has run out and not yet been ended; `endGrace` takes a row out of this list. */
export function listExpiredGraceConversations(now: number, db: Database = getStateDb()): SlackConversation[] {
  return (
    db
      .query(`SELECT * FROM slack_conversations WHERE closed_at IS NOT NULL AND grace_until IS NOT NULL AND grace_until <= ? ORDER BY id;`)
      .all(now) as ConversationRow[]
  ).map(toConversation);
}

export function recordSupportTicket(
  conversationId: number,
  t: { id: string; title: string; url: string },
  now: number,
  db: Database = getStateDb(),
): void {
  db.query(`INSERT INTO slack_support_tickets (conversation_id, issue_id, title, url, created_at) VALUES (?, ?, ?, ?, ?);`).run(
    conversationId,
    t.id,
    t.title,
    t.url,
    now,
  );
}

function toTicket(r: TicketRow): SupportTicket {
  return { id: r.issue_id, title: r.title, url: r.url, createdAt: r.created_at };
}

export function listSupportTickets(conversationId: number, db: Database = getStateDb()): SupportTicket[] {
  return (
    db
      .query(`SELECT * FROM slack_support_tickets WHERE conversation_id = ? ORDER BY created_at, id;`)
      .all(conversationId) as TicketRow[]
  ).map(toTicket);
}

/** This conversation's tickets plus those of every conversation it resumed, transitively, oldest first. */
export function ticketsForChain(conversationId: number, db: Database = getStateDb()): SupportTicket[] {
  const rows = db
    .query(
      `WITH RECURSIVE chain(id) AS (
         SELECT ?1
         UNION
         SELECT c.resumed_from FROM slack_conversations c JOIN chain ON c.id = chain.id WHERE c.resumed_from IS NOT NULL
       )
       SELECT * FROM slack_support_tickets WHERE conversation_id IN (SELECT id FROM chain) ORDER BY created_at, id;`,
    )
    .all(conversationId) as TicketRow[];
  return rows.map(toTicket);
}

export function conversationForRoom(room: string, db: Database = getStateDb()): SlackConversation | undefined {
  const row = db.query(SELECT_OPEN_BY_ROOM_SQL).get(room) as ConversationRow | null;
  return row ? toConversation(row) : undefined;
}

export function conversationForSlackUser(slackUserId: string, db: Database = getStateDb()): SlackConversation | undefined {
  const row = db.query(SELECT_OPEN_BY_USER_SQL).get(slackUserId) as ConversationRow | null;
  return row ? toConversation(row) : undefined;
}

/** The room's newest conversation, closed or not. */
export function latestConversationForRoom(room: string, db: Database = getStateDb()): SlackConversation | undefined {
  const row = db.query(SELECT_LATEST_BY_ROOM_SQL).get(room) as ConversationRow | null;
  return row ? toConversation(row) : undefined;
}

export function conversationById(id: number, db: Database = getStateDb()): SlackConversation | undefined {
  const row = db.query(SELECT_BY_ID_SQL).get(id) as ConversationRow | null;
  return row ? toConversation(row) : undefined;
}

/** Each room's newest conversation, when that one has closed. */
export function listLatestClosedConversations(db: Database = getStateDb()): SlackConversation[] {
  return (db.query(SELECT_LATEST_CLOSED_SQL).all() as ConversationRow[]).map(toConversation);
}

export function listOpenConversations(db: Database = getStateDb()): SlackConversation[] {
  return (db.query(SELECT_OPEN_SQL).all() as ConversationRow[]).map(toConversation);
}

export function advanceCursor(
  id: number,
  lastReadTs: string,
  threadReadTs: Record<string, string>,
  db: Database = getStateDb(),
): void {
  db.query(`UPDATE slack_conversations SET last_read_ts = ?, thread_read_ts = ? WHERE id = ?;`).run(
    lastReadTs,
    JSON.stringify(threadReadTs),
    id,
  );
}

export function touchConversation(id: number, now: number, db: Database = getStateDb()): void {
  db.query(`UPDATE slack_conversations SET last_active_at = ?, checked_in_at = NULL WHERE id = ?;`).run(now, id);
}

/** True only for the caller that claimed it, so a stale read can't queue a second check-in. */
export function markCheckedIn(id: number, now: number, db: Database = getStateDb()): boolean {
  const { changes } = db
    .query(`UPDATE slack_conversations SET checked_in_at = ? WHERE id = ? AND checked_in_at IS NULL AND closed_at IS NULL;`)
    .run(now, id);
  return changes > 0;
}

/** False when a close was already asked for or the conversation has closed, so the first reason stands. */
export function markCloseAsked(id: number, reason: SlackCloseReason, now: number, db: Database = getStateDb()): boolean {
  const { changes } = db
    .query(`UPDATE slack_conversations SET close_asked_at = ?, close_reason_asked = ? WHERE id = ? AND close_asked_at IS NULL AND closed_at IS NULL;`)
    .run(now, reason, id);
  return changes > 0;
}

/** True only for the caller that claimed it, so a stale read can't send a second holding line. */
export function markStalledNoted(id: number, now: number, db: Database = getStateDb()): boolean {
  const { changes } = db
    .query(`UPDATE slack_conversations SET stalled_noted_at = ? WHERE id = ? AND stalled_noted_at IS NULL AND closed_at IS NULL;`)
    .run(now, id);
  return changes > 0;
}

/**
 * True once the support agent has posted into the conversation's room. Neither a watcher poll nor a
 * teammate's message sets it, so it separates an agent that reached the chat from one that only started.
 */
export function agentHasPosted(conv: Pick<SlackConversation, "room" | "agentHandle" | "openedAt">, db: Database = getStateDb()): boolean {
  // A resumed conversation reuses the room and may reuse the handle, so posts from before this row opened don't count.
  return (
    db
      .query(`SELECT 1 FROM chat_messages WHERE room = ? AND handle = ? AND posted_at >= ? LIMIT 1;`)
      .get(conv.room, conv.agentHandle, conv.openedAt) !== null
  );
}

export function markWatcherSeen(id: number, now: number, db: Database = getStateDb()): void {
  db.query(`UPDATE slack_conversations SET watcher_seen_at = ? WHERE id = ?;`).run(now, id);
}

/** True only for the caller that closed it, which is what stops two closes both sending. */
export function closeConversation(id: number, reason: SlackCloseReason, now: number, db: Database = getStateDb()): boolean {
  const { changes } = db
    .query(`UPDATE slack_conversations SET closed_at = ?, close_reason = ? WHERE id = ? AND closed_at IS NULL;`)
    .run(now, reason, id);
  return changes > 0;
}

/** Time asleep doesn't count, so each open chat's clocks move forward by it. A clock written since the wake stops at `now`. */
export function shiftOpenConversationClocks(gapMs: number, now: number, db: Database = getStateDb()): void {
  db.query(
    `UPDATE slack_conversations SET
       last_active_at = MIN(last_active_at + ?1, ?2),
       watcher_seen_at = MIN(COALESCE(watcher_seen_at, opened_at) + ?1, ?2),
       close_asked_at = MIN(close_asked_at + ?1, ?2)
     WHERE closed_at IS NULL;`,
  ).run(gapMs, now);
}

export function enqueueItem(args: Omit<SlackItem, "id" | "deliveredAt">, db: Database = getStateDb()): SlackItem {
  const row = db
    .query(
      `INSERT INTO slack_items (conversation_id, kind, from_handle, text, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *;`,
    )
    .get(args.conversationId, args.kind, args.fromHandle, args.text, args.createdAt) as ItemRow;
  return toItem(row);
}

export function pendingItems(conversationId: number, db: Database = getStateDb()): SlackItem[] {
  return (
    db
      .query(`SELECT * FROM slack_items WHERE conversation_id = ? AND delivered_at IS NULL ORDER BY created_at, id;`)
      .all(conversationId) as ItemRow[]
  ).map(toItem);
}

export function markItemDelivered(id: number, now: number, db: Database = getStateDb()): void {
  db.query(`UPDATE slack_items SET delivered_at = ? WHERE id = ?;`).run(now, id);
}

/**
 * False for an unknown id or a closed conversation's item, except its `closed`
 * item, which only exists after the close. A first delivery clears the stalled
 * notice; a repeat keeps the first delivery time and still reads true.
 */
export function markOpenItemDelivered(id: number, now: number, db: Database = getStateDb()): boolean {
  return db.transaction(() => {
    const { changes } = db
      .query(
        `UPDATE slack_items SET delivered_at = COALESCE(delivered_at, ?1) WHERE id = ?2
         AND (kind = 'closed' OR conversation_id IN (SELECT id FROM slack_conversations WHERE closed_at IS NULL));`,
      )
      .run(now, id);
    if (changes === 0) return false;
    db.query(
      `UPDATE slack_conversations SET stalled_noted_at = NULL
       WHERE id = (SELECT conversation_id FROM slack_items WHERE id = ?1 AND delivered_at = ?2);`,
    ).run(id, now);
    return true;
  })();
}

/** When the pane last took an item, undefined if it never has. */
export function lastDeliveredAt(conversationId: number, db: Database = getStateDb()): number | undefined {
  const row = db.query(`SELECT MAX(delivered_at) AS at FROM slack_items WHERE conversation_id = ?;`).get(conversationId) as { at: number | null };
  return row.at ?? undefined;
}

/** Items share the room's retention, since they hold the same teammate text. Undelivered ones stay, and a `closed` item may still be owed to a watcher. */
export function pruneSlackItems(db: Database, opts: { olderThanMs?: number } = {}): { removed: number } {
  const cutoff = Date.now() - (opts.olderThanMs ?? CHAT_RETENTION_MS);
  const { changes } = db
    .query(
      `DELETE FROM slack_items WHERE delivered_at IS NOT NULL AND created_at < ?
       AND conversation_id IN (SELECT id FROM slack_conversations WHERE closed_at IS NOT NULL);`,
    )
    .run(cutoff);
  return { removed: changes };
}

/** The oldest `closed` item still owed to this agent, so a close reaches a watcher after the conversation has ended. */
export function closedNoticeForAgent(
  agentHandle: string,
  db: Database = getStateDb(),
): { conversation: SlackConversation; item: SlackItem } | undefined {
  const item = db
    .query(
      `SELECT i.* FROM slack_items i JOIN slack_conversations c ON c.id = i.conversation_id
       WHERE c.agent_handle = ? AND c.closed_at IS NOT NULL AND i.kind = 'closed' AND i.delivered_at IS NULL
       ORDER BY i.id LIMIT 1;`,
    )
    .get(agentHandle) as ItemRow | null;
  if (!item) return undefined;
  const conversation = conversationById(item.conversation_id, db);
  return conversation ? { conversation, item: toItem(item) } : undefined;
}
