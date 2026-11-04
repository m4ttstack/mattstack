/**
 * lib/state/__tests__/slack-conversation-store.test.ts — Slack support chat conversations and queued items.
 */
import { expect, test } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { openStateDb } from "../db.ts";
import {
  SlackConversationBusy,
  advanceCursor,
  closeConversation,
  conversationForAgent,
  conversationForRoom,
  conversationForSlackUser,
  enqueueItem,
  latestConversationForRoom,
  listOpenConversations,
  markCheckedIn,
  markItemDelivered,
  markOpenItemDelivered,
  openConversation,
  pendingItems,
  touchConversation,
} from "../slack-conversation-store.ts";

let n = 0;
function dbPath() {
  return join(tmpdir(), `slack-conv-test-${process.pid}-${n++}-${Date.now()}.db`);
}
function fresh() {
  return openStateDb(dbPath());
}

const base = {
  room: "dm-aaa",
  agentHandle: "pane.one",
  slackHandle: "slack.u0test",
  slackUserId: "U0TEST",
  slackChannel: "D0TEST",
  operatorUserId: "U0OPER",
  operatorName: "Operator",
  frameMarker: "marker1",
  lastReadTs: "100.000",
  openedAt: 1000,
};

function capture(fn: () => unknown): unknown {
  try {
    return fn();
  } catch (e) {
    return e;
  }
}

test("conversationForSlackUser finds only an open conversation", () => {
  const db = fresh();
  expect(conversationForSlackUser(base.slackUserId, db)).toBeUndefined();
  const conv = openConversation(base, db);
  expect(conversationForSlackUser(base.slackUserId, db)?.id).toBe(conv.id);
  closeConversation(conv.id, "idle", 5, db);
  expect(conversationForSlackUser(base.slackUserId, db)).toBeUndefined();
});

test("markOpenItemDelivered keeps the first delivery time and skips a closed conversation", () => {
  const db = fresh();
  const conv = openConversation(base, db);
  const item = enqueueItem({ conversationId: conv.id, kind: "message", fromHandle: null, text: "x", createdAt: 1 }, db);
  const later = enqueueItem({ conversationId: conv.id, kind: "message", fromHandle: null, text: "y", createdAt: 2 }, db);
  expect(markOpenItemDelivered(item.id, 10, db)).toBe(true);
  expect(markOpenItemDelivered(item.id, 20, db)).toBe(true);
  const stored = db.query("SELECT delivered_at FROM slack_items WHERE id = ?;").get(item.id) as { delivered_at: number };
  expect(stored.delivered_at).toBe(10);
  expect(markOpenItemDelivered(item.id + 100, 20, db)).toBe(false);
  closeConversation(conv.id, "idle", 30, db);
  expect(markOpenItemDelivered(later.id, 40, db)).toBe(false);
  expect(pendingItems(conv.id, db).map((i) => i.id)).toEqual([later.id]);
});

test("latestConversationForRoom sees a closed row, and the newest row wins", () => {
  const db = fresh();
  expect(latestConversationForRoom(base.room, db)).toBeUndefined();
  const first = openConversation(base, db);
  closeConversation(first.id, "idle", 5, db);
  expect(conversationForRoom(base.room, db)).toBeUndefined();
  expect(latestConversationForRoom(base.room, db)?.closedAt).toBe(5);
  const second = openConversation(base, db);
  expect(latestConversationForRoom(base.room, db)?.id).toBe(second.id);
});

test("opens a conversation and finds it by agent and room", () => {
  const db = fresh();
  const c = openConversation(base, db);
  expect(c).toMatchObject({ ...base, threadReadTs: {}, lastActiveAt: 1000, closedAt: null, checkedInAt: null });
  expect(conversationForAgent("pane.one", db)?.id).toBe(c.id);
  expect(conversationForRoom("dm-aaa", db)?.id).toBe(c.id);
  expect(listOpenConversations(db).map(x => x.id)).toEqual([c.id]);
});

test("refuses a second open for the same Slack person, naming the holder", () => {
  const db = fresh();
  openConversation(base, db);
  const err = capture(() => openConversation({ ...base, room: "dm-bbb", agentHandle: "pane.two" }, db));
  expect(err).toBeInstanceOf(SlackConversationBusy);
  expect((err as SlackConversationBusy).holderAgent).toBe("pane.one");
});

test("refuses a second open for the same pane", () => {
  const db = fresh();
  openConversation(base, db);
  const err = capture(() => openConversation({ ...base, room: "dm-bbb", slackUserId: "U0OTHER" }, db));
  expect(err).toBeInstanceOf(SlackConversationBusy);
  expect((err as SlackConversationBusy).holderAgent).toBe("pane.one");
});

test("allows reopening after close", () => {
  const db = fresh();
  const c = openConversation(base, db);
  closeConversation(c.id, "idle", 2000, db);
  expect(conversationForAgent("pane.one", db)).toBeUndefined();
  expect(conversationForRoom("dm-aaa", db)).toBeUndefined();
  const again = openConversation({ ...base, openedAt: 3000 }, db);
  expect(again.id).not.toBe(c.id);
  expect(listOpenConversations(db)).toHaveLength(1);
});

test("two racing opens leave exactly one row", () => {
  const path = dbPath();
  const a = openStateDb(path);
  const b = openStateDb(path);
  const results = [
    capture(() => openConversation(base, a)),
    capture(() => openConversation({ ...base, room: "dm-bbb", agentHandle: "pane.two" }, b)),
  ];
  expect(results.filter(r => r instanceof SlackConversationBusy)).toHaveLength(1);
  expect(listOpenConversations(a)).toHaveLength(1);
});

test("touching clears the check-in", () => {
  const db = fresh();
  const c = openConversation(base, db);
  markCheckedIn(c.id, 1500, db);
  expect(conversationForAgent("pane.one", db)?.checkedInAt).toBe(1500);
  touchConversation(c.id, 1800, db);
  const after = conversationForAgent("pane.one", db);
  expect(after?.checkedInAt).toBeNull();
  expect(after?.lastActiveAt).toBe(1800);
});

test("pendingItems returns undelivered items oldest first", () => {
  const db = fresh();
  const c = openConversation(base, db);
  const first = enqueueItem({ conversationId: c.id, kind: "message", fromHandle: "pane.one", text: "one", createdAt: 10 }, db);
  const second = enqueueItem({ conversationId: c.id, kind: "check-in", fromHandle: null, text: "two", createdAt: 20 }, db);
  enqueueItem({ conversationId: c.id + 1, kind: "message", fromHandle: null, text: "other", createdAt: 5 }, db);
  expect(pendingItems(c.id, db).map(i => i.id)).toEqual([first.id, second.id]);
  markItemDelivered(first.id, 30, db);
  expect(pendingItems(c.id, db).map(i => i.id)).toEqual([second.id]);
  expect(second).toMatchObject({ kind: "check-in", fromHandle: null, deliveredAt: null });
});

test("threadReadTs round-trips through JSON", () => {
  const db = fresh();
  const c = openConversation(base, db);
  advanceCursor(c.id, "200.000", { "150.000": "190.000", "160.000": "195.000" }, db);
  const got = conversationForRoom("dm-aaa", db);
  expect(got?.lastReadTs).toBe("200.000");
  expect(got?.threadReadTs).toEqual({ "150.000": "190.000", "160.000": "195.000" });
});
