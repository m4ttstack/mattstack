/**
 * lib/daemon/__tests__/slack-lifecycle.test.ts: the Slack chat timers and the
 * close sequence, against a fake client, a fake clock and a scratch state db.
 */
import { expect, test } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import type { Logger } from "pino";
import { SlackError, type SlackClient, type SlackMessage } from "../../slack/client.ts";
import { closingLine, holdingLine, SLACK_PREFIX } from "../../slack/format.ts";
import {
  conversationById,
  enqueueItem,
  markOpenItemDelivered,
  markWatcherSeen,
  openConversation,
  openStateDb,
  pendingItems,
  touchConversation,
  type SlackItem,
} from "../../state/index.ts";
import { createChatHandlers } from "../handlers/chat.ts";
import { createSlackChatHandlers } from "../handlers/slack-chat.ts";
import { createSlackBridge } from "../slack-bridge.ts";
import {
  SLACK_CHECK_IN_MS,
  SLACK_FAREWELL_MS,
  SLACK_IDLE_MS,
  SLACK_PANE_GONE_MS,
  SLACK_STALLED_MS,
  finishClose,
  requestClose,
  tickSlackLifecycle,
} from "../slack-lifecycle.ts";

const log = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} } as unknown as Logger;
const START = 1_000_000_000_000;
const TICK_MS = 15_000;
const MINUTE = 60_000;
let n = 0;

const conversation = {
  room: "dm-aaa",
  agentHandle: "pane.one",
  slackHandle: "slack.u0test",
  slackUserId: "U0TEST",
  slackChannel: "D0TEST",
  operatorUserId: "U0OPER",
  operatorName: "Robin",
  frameMarker: "marker1",
  lastReadTs: "1000000000.000100",
  openedAt: START,
};

const CLOSED_LINE = closingLine("Robin", false);

function harness() {
  const db = openStateDb(join(tmpdir(), `slack-lifecycle-${process.pid}-${n++}-${Date.now()}.db`));
  const opened = openConversation(conversation, db);
  const state = { clock: START };
  const sent: string[] = [];
  const failing: { match?: string; err?: unknown; once?: boolean } = {};
  const notices: { title: string; message: string }[] = [];
  const room: { room: string; handle: string; body: string }[] = [];
  const client = {
    post: async (_channel: string, text: string) => {
      if (failing.match !== undefined && text.includes(failing.match)) {
        const err = failing.err ?? new SlackError("channel_not_found");
        if (failing.once) failing.match = undefined;
        throw err;
      }
      sent.push(text);
      return { ts: "1" };
    },
  } as unknown as SlackClient;
  const deps = {
    db,
    client: async () => client,
    notify: (title: string, message: string) => notices.push({ title, message }),
    post: (args: { room: string; handle: string; body: string; fromSlack: true }) => {
      room.push({ room: args.room, handle: args.handle, body: args.body });
      return { id: room.length };
    },
    now: () => state.clock,
  };
  const tick = () => tickSlackLifecycle(deps);
  /** Steps a tick at a time, with the watcher polling, since one long jump reads as the machine sleeping. */
  async function run(ms: number, opts: { watcher?: boolean } = {}) {
    const end = state.clock + ms;
    while (state.clock < end) {
      state.clock = Math.min(end, state.clock + TICK_MS);
      if (opts.watcher !== false) markWatcherSeen(opened.id, state.clock, db);
      await tick();
    }
  }
  const items = () => pendingItems(opened.id, db);
  const kinds = () => items().map((i: SlackItem) => i.kind);
  const row = () => conversationById(opened.id, db)!;
  const queueMessage = (text = "still failing") =>
    enqueueItem({ conversationId: opened.id, kind: "message", fromHandle: "slack.u0test", text, createdAt: state.clock }, db);
  return { db, opened, state, sent, failing, notices, room, client, deps, tick, run, items, kinds, row, queueMessage };
}

test("the timer values are the design's", () => {
  expect([SLACK_CHECK_IN_MS, SLACK_IDLE_MS, SLACK_FAREWELL_MS, SLACK_PANE_GONE_MS, SLACK_STALLED_MS]).toEqual([
    30 * MINUTE,
    60 * MINUTE,
    2 * MINUTE,
    5 * MINUTE,
    10 * MINUTE,
  ]);
});

test("30 quiet minutes queues one check-in item", async () => {
  const h = harness();
  await h.run(30 * MINUTE - TICK_MS);
  expect(h.kinds()).toEqual([]);
  await h.run(10 * MINUTE);
  expect(h.kinds()).toEqual(["check-in"]);
  expect(h.row().checkedInAt).toBe(START + 30 * MINUTE);
});

test("a message after the check-in resets the timers", async () => {
  const h = harness();
  await h.run(31 * MINUTE);
  markOpenItemDelivered(h.items()[0]!.id, h.state.clock, h.db);
  touchConversation(h.opened.id, h.state.clock, h.db);
  await h.run(29 * MINUTE);
  expect(h.kinds()).toEqual([]);
  expect(h.row().closeAskedAt).toBeNull();
  await h.run(2 * MINUTE);
  expect(h.kinds()).toEqual(["check-in"]);
});

test("60 quiet minutes queues a close-request with reason idle", async () => {
  const h = harness();
  await h.run(59 * MINUTE);
  expect(h.row().closeAskedAt).toBeNull();
  await h.run(MINUTE);
  expect(h.kinds()).toEqual(["check-in", "close-request"]);
  expect(h.items()[1]!.text).toContain("idle");
  expect(h.row()).toMatchObject({ closeAskedAt: START + 60 * MINUTE, closeReasonAsked: "idle", closedAt: null });
});

test("the close-request is queued once", async () => {
  const h = harness();
  await h.run(61 * MINUTE);
  expect(h.kinds().filter((k) => k === "close-request")).toHaveLength(1);
});

test("the pane's close sends its farewell then the fixed line, in that order", async () => {
  const h = harness();
  await finishClose(h.opened.id, "closed-by-pane", "All sorted.\n", h.deps);
  expect(h.sent).toEqual([`${SLACK_PREFIX}All sorted.`, CLOSED_LINE]);
  expect(h.row()).toMatchObject({ closedAt: START, closeReason: "closed-by-pane" });
  expect(h.notices).toEqual([]);
});

test("a farewell is redacted and never carries a second prefix", async () => {
  const h = harness();
  await finishClose(h.opened.id, "closed-by-pane", `${SLACK_PREFIX}token xoxb-123-abc`, h.deps);
  expect(h.sent[0]).toBe(`${SLACK_PREFIX}token [redacted]`);
  expect(h.room[0]!.body).toBe("token [redacted]");
});

test("a blank farewell sends only the fixed line", async () => {
  const h = harness();
  await finishClose(h.opened.id, "closed-by-pane", "  \n", h.deps);
  expect(h.sent).toEqual([CLOSED_LINE]);
});

test("no close within 2 minutes sends only the fixed line", async () => {
  const h = harness();
  requestClose(h.opened.id, "idle", h.deps);
  await h.run(SLACK_FAREWELL_MS - TICK_MS);
  expect(h.row().closedAt).toBeNull();
  await h.run(TICK_MS);
  expect(h.row()).toMatchObject({ closedAt: START + SLACK_FAREWELL_MS, closeReason: "idle" });
  expect(h.sent).toEqual([CLOSED_LINE]);
  expect(h.notices).toHaveLength(1);
  expect(h.notices[0]!.message).toContain("idle");
});

test("a pane's close inside the window keeps the asked reason and stops the fallback", async () => {
  const h = harness();
  requestClose(h.opened.id, "operator", h.deps);
  await h.run(MINUTE);
  await finishClose(h.opened.id, h.row().closeReasonAsked ?? "closed-by-pane", "Bye.", h.deps);
  await h.run(5 * MINUTE);
  expect(h.row().closeReason).toBe("operator");
  expect(h.sent).toEqual([`${SLACK_PREFIX}Bye.`, CLOSED_LINE]);
});

test("slack-close --pane queues a close-request with reason operator", async () => {
  const h = harness();
  const chat = createChatHandlers({ db: h.db, emitEvent: () => 0, log });
  const seated = await chat["chat:sign-in"]({ sessionId: "s1", baseHandle: "support" });
  if (!seated.ok) throw new Error(seated.error);
  h.db.query("UPDATE slack_conversations SET agent_handle = ? WHERE id = ?;").run(seated.data.handle, h.opened.id);
  h.db.query("UPDATE chat_presence SET pane = 'w1:p1' WHERE session_id = 's1';").run();
  const handlers = createSlackChatHandlers({ db: h.db, log, emitEvent: () => 0, slackClient: h.deps.client, notify: h.deps.notify, now: h.deps.now });

  const res = await handlers["chat:slack-close"]({ pane: "w1:p1" });
  expect(res).toEqual({ ok: true, data: { conversationId: h.opened.id, closed: false } });
  expect(h.kinds()).toEqual(["close-request"]);
  expect(h.items()[0]!.text).toContain("operator");
  expect(h.row()).toMatchObject({ closeAskedAt: START, closeReasonAsked: "operator", closedAt: null });
  expect(h.sent).toEqual([]);

  const twice = await handlers["chat:slack-close"]({ pane: "w1:p1" });
  expect(twice).toEqual({ ok: true, data: { conversationId: h.opened.id, closed: false } });
  expect(h.kinds()).toEqual(["close-request"]);
});

test("no watcher for 5 minutes with a waiting item closes as pane-gone and notifies the operator", async () => {
  const h = harness();
  await h.run(MINUTE);
  h.queueMessage();
  await h.run(SLACK_PANE_GONE_MS - TICK_MS, { watcher: false });
  expect(h.row().closedAt).toBeNull();
  await h.run(TICK_MS, { watcher: false });
  expect(h.row().closeReason).toBe("pane-gone");
  expect(h.sent).toEqual([closingLine("Robin", true)]);
  expect(h.notices).toHaveLength(1);
  expect(h.notices[0]!.message).not.toContain("still failing");
});

test("a dead watcher still gets 5 minutes from a message's arrival", async () => {
  const h = harness();
  await h.run(20 * MINUTE, { watcher: false });
  h.queueMessage();
  await h.run(4 * MINUTE, { watcher: false });
  expect(h.row().closedAt).toBeNull();
  await h.run(MINUTE, { watcher: false });
  expect(h.row().closeReason).toBe("pane-gone");
});

test("no watcher with nothing waiting never closes as pane-gone", async () => {
  const h = harness();
  await h.run(20 * MINUTE, { watcher: false });
  expect(h.row().closedAt).toBeNull();
});

test("a long turn with a live watcher never closes as pane-gone", async () => {
  const h = harness();
  h.queueMessage();
  await h.run(45 * MINUTE);
  expect(h.row().closedAt).toBeNull();
});

test("a gap in ticks (sleep) moves the quiet, stalled and watcher timers, so no timeout, holding line or pane-gone fires straight after wake", async () => {
  const h = harness();
  await h.run(20 * MINUTE);
  h.queueMessage();
  await h.run(MINUTE);
  const before = h.row();

  const gap = 3 * 60 * MINUTE;
  h.state.clock += gap;
  await h.tick();
  expect(h.kinds()).toEqual(["message"]);
  expect(h.row().closeAskedAt).toBeNull();
  expect(h.row().closedAt).toBeNull();
  expect(h.row().stalledNotedAt).toBeNull();
  expect(h.row().lastActiveAt).toBe(before.lastActiveAt + gap);
  expect(h.row().watcherSeenAt).toBe(before.watcherSeenAt! + gap);
  expect(h.sent).toEqual([]);
  expect(h.notices).toEqual([]);

  await h.run(SLACK_STALLED_MS - TICK_MS);
  expect(h.notices).toEqual([]);
  await h.run(TICK_MS);
  expect(h.notices).toHaveLength(1);
});

test("a gap keeps the quiet time from before the sleep", async () => {
  const h = harness();
  await h.run(25 * MINUTE);
  h.state.clock += 60 * MINUTE;
  await h.tick();
  expect(h.kinds()).toEqual([]);
  await h.run(5 * MINUTE);
  expect(h.kinds()).toEqual(["check-in"]);
});

test("a gap gives the farewell window its full 2 minutes back", async () => {
  const h = harness();
  await h.run(MINUTE);
  requestClose(h.opened.id, "operator", h.deps);
  await h.run(MINUTE);
  h.state.clock += 60 * MINUTE;
  await h.tick();
  expect(h.row().closedAt).toBeNull();
});

test("a chat opened after a quiet spell doesn't read that spell as a sleep", async () => {
  const h = harness();
  h.db.query("UPDATE slack_conversations SET closed_at = ?, close_reason = 'idle' WHERE id = ?;").run(START, h.opened.id);
  await h.tick();
  h.state.clock += 5 * 60 * MINUTE;
  await h.tick();
  const fresh = openConversation({ ...conversation, openedAt: h.state.clock, slackUserId: "U0TWO", agentHandle: "pane.two" }, h.db);
  h.state.clock += TICK_MS;
  await h.tick();
  h.state.clock += TICK_MS;
  await h.tick();
  expect(conversationById(fresh.id, h.db)!.lastActiveAt).toBe(fresh.openedAt);
});

test("the tick clock lives in the db, so a daemon restart across a sleep still sees the gap", async () => {
  const h = harness();
  await h.run(MINUTE);
  const reopened = openStateDb(h.db.filename);
  h.state.clock += 3 * 60 * MINUTE;
  await tickSlackLifecycle({ ...h.deps, db: reopened });
  expect(h.row().closeAskedAt).toBeNull();
  expect(h.row().lastActiveAt).toBe(START + 3 * 60 * MINUTE);
});

test("a teammate message during the farewell window goes to the operator, not the pane", async () => {
  const h = harness();
  requestClose(h.opened.id, "idle", h.deps);
  const message: SlackMessage = { ts: "1000000005.000000", user: "U0TEST", text: "wait, one more thing" };
  const client = { history: async () => [message], replies: async () => [] } as unknown as SlackClient;
  const roomPosts: { handle: string; body: string }[] = [];
  const bridge = createSlackBridge({
    db: h.db,
    client: async () => client,
    post: (args) => {
      roomPosts.push({ handle: args.handle, body: args.body });
      return { id: 1 };
    },
    log,
    now: h.deps.now,
  });
  const activeBefore = h.row().lastActiveAt;
  await bridge.sweep();
  expect(roomPosts).toEqual([{ handle: "slack.u0test", body: "wait, one more thing" }]);
  expect(h.kinds()).toEqual(["close-request"]);
  expect(h.row().lastActiveAt).toBe(activeBefore);
  expect(h.row().lastReadTs).toBe(message.ts);
});

test("the operator's Slack message during the farewell window still reaches the pane", async () => {
  const h = harness();
  requestClose(h.opened.id, "idle", h.deps);
  const message: SlackMessage = { ts: "1000000005.000000", user: "U0OPER", text: "tell them I'll look" };
  const client = { history: async () => [message], replies: async () => [] } as unknown as SlackClient;
  const bridge = createSlackBridge({ db: h.db, client: async () => client, post: () => ({ id: 1 }), operatorHandle: () => "operator", log, now: h.deps.now });
  await bridge.sweep();
  expect(h.kinds()).toEqual(["close-request", "operator-slack"]);
});

test("a failed farewell send still closes and notifies the operator", async () => {
  const h = harness();
  h.failing.match = "All sorted";
  await finishClose(h.opened.id, "closed-by-pane", "All sorted.", h.deps);
  expect(h.row().closeReason).toBe("closed-by-pane");
  expect(h.sent).toEqual([CLOSED_LINE]);
  expect(h.notices).toHaveLength(1);
  expect(h.room.map((r) => r.body)).toEqual([CLOSED_LINE.slice(SLACK_PREFIX.length)]);
  expect(JSON.stringify(h.notices)).not.toContain("All sorted");
});

test("no Slack token still closes and notifies the operator", async () => {
  const h = harness();
  await finishClose(h.opened.id, "closed-by-pane", "All sorted.", { ...h.deps, client: async () => null });
  expect(h.row().closeReason).toBe("closed-by-pane");
  expect(h.notices).toHaveLength(1);
  expect(h.room).toEqual([]);
});

test("a rate limited close line is retried after Retry-After", async () => {
  const h = harness();
  h.failing.match = "This chat with Claude is closed";
  h.failing.err = new SlackError("ratelimited", 1);
  h.failing.once = true;
  await finishClose(h.opened.id, "closed-by-pane", undefined, h.deps);
  expect(h.sent).toEqual([CLOSED_LINE]);
});

test("a second close is a no-op", async () => {
  const h = harness();
  await finishClose(h.opened.id, "closed-by-pane", "All sorted.", h.deps);
  await finishClose(h.opened.id, "idle", "Again.", h.deps);
  expect(h.sent).toEqual([`${SLACK_PREFIX}All sorted.`, CLOSED_LINE]);
  expect(h.row().closeReason).toBe("closed-by-pane");
  expect(h.kinds()).toEqual(["closed"]);
});

test("two racing closes send once", async () => {
  const h = harness();
  await Promise.all([finishClose(h.opened.id, "closed-by-pane", undefined, h.deps), finishClose(h.opened.id, "idle", undefined, h.deps)]);
  expect(h.sent).toEqual([CLOSED_LINE]);
});

test("closing queues a closed item for the watcher", async () => {
  const h = harness();
  await finishClose(h.opened.id, "idle", undefined, h.deps);
  expect(h.kinds()).toEqual(["closed"]);
  expect(h.items()[0]!.text).toContain("idle");
});

test("an item undelivered for 10 minutes with a live watcher notifies the operator and sends one holding line", async () => {
  const h = harness();
  h.queueMessage();
  await h.run(SLACK_STALLED_MS - TICK_MS);
  expect(h.notices).toEqual([]);
  await h.run(TICK_MS);
  expect(h.sent).toEqual([holdingLine("Robin")]);
  expect(h.notices).toHaveLength(1);
  expect(h.notices[0]!.message).not.toContain("still failing");
  await h.run(5 * MINUTE);
  expect(h.sent).toHaveLength(1);
  expect(h.notices).toHaveLength(1);
});

test("a holding line doesn't reset the quiet timer", async () => {
  const h = harness();
  h.queueMessage();
  await h.run(SLACK_STALLED_MS);
  expect(h.row().lastActiveAt).toBe(START);
});

test("a stuck check-in alone sends no holding line, since no teammate is waiting", async () => {
  const h = harness();
  await h.run(45 * MINUTE);
  expect(h.kinds()).toEqual(["check-in"]);
  expect(h.sent).toEqual([]);
  expect(h.notices).toEqual([]);
});

test("a delivery resets the stalled notice", async () => {
  const h = harness();
  const first = h.queueMessage();
  await h.run(SLACK_STALLED_MS);
  expect(h.row().stalledNotedAt).not.toBeNull();
  expect(markOpenItemDelivered(first.id, h.state.clock, h.db)).toBe(true);
  expect(h.row().stalledNotedAt).toBeNull();
  h.queueMessage("another");
  await h.run(SLACK_STALLED_MS);
  expect(h.sent).toEqual([holdingLine("Robin"), holdingLine("Robin")]);
});

test("a delivery with another message queued behind it restarts the stall clock", async () => {
  const h = harness();
  const first = h.queueMessage("one");
  h.queueMessage("two");
  await h.run(SLACK_STALLED_MS);
  markOpenItemDelivered(first.id, h.state.clock, h.db);
  await h.run(MINUTE);
  expect(h.sent).toHaveLength(1);
});

test("the farewell and fixed line are recorded in the room", async () => {
  const h = harness();
  await finishClose(h.opened.id, "closed-by-pane", "All sorted.", h.deps);
  expect(h.room).toEqual([
    { room: "dm-aaa", handle: "pane.one", body: "All sorted." },
    { room: "dm-aaa", handle: "pane.one", body: CLOSED_LINE.slice(SLACK_PREFIX.length) },
  ]);
});

test("one conversation's failure doesn't stop the tick reaching the next", async () => {
  const h = harness();
  const second = openConversation({ ...conversation, room: "dm-bbb", slackUserId: "U0TWO", agentHandle: "pane.two", openedAt: START }, h.db);
  requestClose(h.opened.id, "idle", h.deps);
  requestClose(second.id, "idle", h.deps);
  let calls = 0;
  const flaky = { ...h.deps, notify: () => { calls++; if (calls === 1) throw new Error("desk down"); } };
  h.state.clock += SLACK_FAREWELL_MS;
  await tickSlackLifecycle(flaky);
  expect(conversationById(second.id, h.db)!.closedAt).not.toBeNull();
  expect(h.row().closedAt).not.toBeNull();
});
