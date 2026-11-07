/**
 * lib/daemon/__tests__/slack-lifecycle.test.ts: the Slack chat timers and the
 * close sequence, against a fake client, a fake clock and a scratch state db.
 */
import { expect, spyOn, test } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import type { Logger } from "pino";
import { CHAT_NOTIFICATION_CATEGORY, __test__ as notifierTest, saveNotificationPrefs } from "../../notifier.ts";
import type { MilestoneDeps } from "../../slack/milestones.ts";
import { SlackError, createSlackClient, type SlackClient, type SlackMessage } from "../../slack/client.ts";
import { closingLine, holdingLine, slackPrefix } from "../../slack/format.ts";
import {
  closeConversation,
  conversationById,
  enqueueItem,
  listOpenConversations,
  markOpenItemDelivered,
  markWatcherSeen,
  openConversation,
  openStateDb,
  pendingItems,
  touchConversation,
  type SlackItem,
} from "../../state/index.ts";
import { recordSupportTicket, startGrace } from "../../state/slack-conversation-store.ts";
import { createChatHandlers } from "../handlers/chat.ts";
import { createSlackChatHandlers } from "../handlers/slack-chat.ts";
import { createSlackBridge } from "../slack-bridge.ts";
import {
  SLACK_CHECK_IN_MS,
  SLACK_FAREWELL_MS,
  SLACK_IDLE_MS,
  SLACK_OPEN_DEADLINE_MS,
  SLACK_PANE_GONE_MS,
  SLACK_STALLED_MS,
  finishClose,
  requestClose,
  slackDeskNotify,
  tickSlackLifecycle,
} from "../slack-lifecycle.ts";

const MAUDE = { name: "Maude", emoji: "🤖" };
const SLACK_PREFIX = slackPrefix(MAUDE);

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
  slackDisplayName: "Alex Example",
  operatorUserId: "U0OPER",
  operatorName: "Robin",
  frameMarker: "marker1",
  lastReadTs: "1000000000.000100",
  openedAt: START,
};

const CLOSED_LINE = closingLine("Robin", false, MAUDE);

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
  const dms: { to: string; body: string }[] = [];
  const desk: string[] = [];
  const herdr: { socket: string | null; args: string[] }[] = [];
  const online = { value: true };
  const milestones: MilestoneDeps = {
    isOnline: () => online.value,
    postDm: async (_from, to, body) => void dms.push({ to, body }),
    desk: async (body) => void desk.push(body),
  };
  const deps = {
    db,
    client: async () => client,
    notify: (title: string, message: string) => notices.push({ title, message }),
    post: (args: { room: string; handle: string; body: string; fromSlack: true }) => {
      room.push({ room: args.room, handle: args.handle, body: args.body });
      return { id: room.length };
    },
    now: () => state.clock,
    milestones,
    herdrRunnerFor: (socket: string | null) => async (args: string[]) => {
      herdr.push({ socket, args });
      return { exitCode: 0, stdout: "" };
    },
  };
  const tick = () => tickSlackLifecycle(deps);
  /** Steps a tick at a time, with the watcher polling, since one long jump reads as the machine sleeping. */
  async function run(ms: number, opts: { watcher?: boolean } = {}) {
    const end = state.clock + ms;
    while (state.clock < end) {
      state.clock = Math.min(end, state.clock + TICK_MS);
      if (opts.watcher !== false) for (const c of listOpenConversations(db)) markWatcherSeen(c.id, state.clock, db);
      await tick();
    }
  }
  const items = () => pendingItems(opened.id, db);
  const kinds = () => items().map((i: SlackItem) => i.kind);
  const row = () => conversationById(opened.id, db)!;
  const queueMessage = (text = "still failing") =>
    enqueueItem({ conversationId: opened.id, kind: "message", fromHandle: "slack.u0test", text, createdAt: state.clock }, db);
  return { db, opened, state, sent, failing, notices, room, client, deps, dms, desk, herdr, online, tick, run, items, kinds, row, queueMessage };
}

/** A second chat, and a client whose first send to the first chat holds until `release`. */
function twoChats() {
  const h = harness();
  const other = openConversation({ ...conversation, room: "dm-bbb", slackChannel: "D0TWO", slackUserId: "U0TWO", agentHandle: "pane.two" }, h.db);
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const sentToOther: string[] = [];
  const client = {
    post: async (channel: string, text: string) => {
      if (channel === conversation.slackChannel) {
        entered.resolve();
        await gate.promise;
      } else {
        sentToOther.push(text);
      }
      return { ts: "1" };
    },
  } as unknown as SlackClient;
  const deps = { ...h.deps, client: async () => client };
  const queueFor = (conversationId: number) =>
    enqueueItem({ conversationId, kind: "message", fromHandle: "slack.u0test", text: "still failing", createdAt: h.state.clock }, h.db);
  /** Starts a tick and returns once it is stuck in the first chat's send. */
  async function holdFirstSend() {
    const tick = tickSlackLifecycle(deps);
    await entered.promise;
    return async () => {
      gate.resolve();
      await tick;
    };
  }
  return { h, other, deps, sentToOther, queueFor, holdFirstSend };
}

test("a desk notice reaches the operator with chat notifications switched off, because the holding line says they were told", () => {
  saveNotificationPrefs({ [CHAT_NOTIFICATION_CATEGORY]: false });
  const notify = spyOn(notifierTest.getDefaultNotifier(), "notify").mockImplementation(() => {});
  try {
    slackDeskNotify("Slack chat is waiting", "Claude hasn't picked up alex-slack's message");
    expect(notify).toHaveBeenCalledWith("Slack chat is waiting", "Claude hasn't picked up alex-slack's message", undefined, CHAT_NOTIFICATION_CATEGORY, undefined, undefined);
  } finally {
    notify.mockRestore();
    saveNotificationPrefs({});
  }
});

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

test("a close starts a 60 minute grace window from the close", async () => {
  const h = harness();
  await finishClose(h.opened.id, "closed-by-pane", undefined, h.deps);
  expect(h.row().graceUntil).toBe(START + 60 * MINUTE);
});

test("a close ends the grace window of the same person's older closed chat", async () => {
  const h = harness();
  h.db.query("UPDATE slack_conversations SET closed_at = ? WHERE id = ?;").run(START - 1, h.opened.id);
  const older = openConversation({ ...conversation, room: "dm-old", agentHandle: "pane.old", frameMarker: "old" }, h.db);
  closeConversation(older.id, "idle", START - MINUTE, h.db);
  startGrace(older.id, START + 30 * MINUTE, h.db);
  h.db.query("UPDATE slack_conversations SET closed_at = NULL WHERE id = ?;").run(h.opened.id);
  await finishClose(h.opened.id, "closed-by-pane", undefined, h.deps);
  expect(conversationById(older.id, h.db)!.graceUntil).toBe(START);
  expect(h.row().graceUntil).toBe(START + 60 * MINUTE);
});

test("a farewell is redacted and never carries a second prefix", async () => {
  const h = harness();
  await finishClose(h.opened.id, "closed-by-pane", `${SLACK_PREFIX}token xoxb-123-abc`, h.deps);
  expect(h.sent[0]).toBe(`${SLACK_PREFIX}token [redacted]`);
  expect(h.room[0]!.body).toBe("token [redacted]");
});

test("a farewell and the fixed line are escaped on the wire and stay plain in the room", async () => {
  const h = harness();
  h.db.run("UPDATE slack_conversations SET operator_name = 'R&D' WHERE id = ?", [h.opened.id]);
  const wire: (string | null)[] = [];
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    wire.push(new URLSearchParams(String(init.body)).get("text"));
    return new Response(JSON.stringify({ ok: true, ts: "9.1" }));
  }) as unknown as typeof fetch;
  await finishClose(h.opened.id, "closed-by-pane", "Use a < b && c", { ...h.deps, client: async () => createSlackClient("t", fakeFetch) });
  expect(wire).toEqual([
    `${SLACK_PREFIX}Use a &lt; b &amp;&amp; c`,
    `${SLACK_PREFIX}This chat with Maude is closed. Anything you send now goes to R&amp;D. To add something for Maude in the next hour, start your message with @Maude`,
  ]);
  expect(h.room.map((r) => r.body)).toEqual([
    "Use a < b && c",
    "This chat with Maude is closed. Anything you send now goes to R&D. To add something for Maude in the next hour, start your message with @Maude",
  ]);
});

test("a farewell naming a chat ticket or a Linear url is dropped, and only the fixed line goes to Slack", async () => {
  for (const farewell of ["Filed as SUPPORT-4, thanks!", "Tracking it at https://linear.app/acme/issue/OTHER-9"]) {
    const h = harness();
    recordSupportTicket(h.opened.id, { id: "SUPPORT-4", title: "Cannot log in", url: "https://tracker.example/SUPPORT-4" }, START, h.db);
    await finishClose(h.opened.id, "closed-by-pane", farewell, h.deps);
    expect(h.sent).toEqual([CLOSED_LINE]);
    expect(JSON.stringify(h.notices)).toContain("named a ticket");
  }
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
  expect(h.sent).toEqual([closingLine("Robin", true, MAUDE)]);
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

test("a teammate message during the farewell window reaches the pane, and after the close nothing more is read or queued", async () => {
  const h = harness();
  requestClose(h.opened.id, "idle", h.deps);
  const history: SlackMessage[] = [{ ts: "1000000005.000000", user: "U0TEST", text: "wait, one more thing" }];
  let reads = 0;
  const client = {
    history: async () => {
      reads++;
      return history;
    },
    replies: async () => [],
  } as unknown as SlackClient;
  const roomPosts: string[] = [];
  const bridge = createSlackBridge({
    db: h.db,
    client: async () => client,
    post: (args) => {
      roomPosts.push(args.body);
      return { id: 1 };
    },
    log,
    now: h.deps.now,
  });

  await bridge.sweep();
  expect(h.kinds()).toEqual(["close-request", "message"]);
  expect(h.items()[1]!.text).toBe("wait, one more thing");
  expect(roomPosts).toEqual(["wait, one more thing"]);

  await finishClose(h.opened.id, "idle", undefined, h.deps);
  history.push({ ts: "1000000006.000000", user: "U0TEST", text: "are you still there?" });
  const readsAtClose = reads;
  await bridge.sweep();
  expect(reads).toBe(readsAtClose);
  expect(roomPosts).toEqual(["wait, one more thing"]);
  expect(h.items().map((i) => i.text)).not.toContain("are you still there?");
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
  expect(h.sent).toEqual([holdingLine("Robin", MAUDE)]);
  expect(h.notices).toHaveLength(1);
  expect(h.notices[0]!.message).not.toContain("still failing");
  await h.run(5 * MINUTE);
  expect(h.sent).toHaveLength(1);
  expect(h.notices).toHaveLength(1);
});

test("the holding line follows the persona as it is when the line is sent", async () => {
  const h = harness();
  const persona = { name: "Maude", emoji: "🤖" } as { name: string; emoji: string; trigger?: string };
  Object.assign(h.deps, { persona: () => persona });
  h.queueMessage();
  await h.run(SLACK_STALLED_MS - TICK_MS);
  Object.assign(persona, { name: "Ada", emoji: "🦊" });
  await h.run(TICK_MS);
  expect(h.sent).toEqual([holdingLine("Robin", { name: "Ada", emoji: "🦊" })]);
});

test("a close speaks as the persona and offers its trigger", async () => {
  const h = harness();
  Object.assign(h.deps, { persona: () => ({ name: "Ada", emoji: "🦊", trigger: "!!ada" }) });
  await finishClose(h.opened.id, "closed-by-pane", "All sorted.", h.deps);
  expect(h.sent).toEqual([
    "[Ada 🦊]: All sorted.",
    "[Ada 🦊]: This chat with Ada is closed. Anything you send now goes to Robin. To add something for Ada in the next hour, start your message with !!ada",
  ]);
  expect(h.room.map((r) => r.body)).toEqual([
    "All sorted.",
    "This chat with Ada is closed. Anything you send now goes to Robin. To add something for Ada in the next hour, start your message with !!ada",
  ]);
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
  expect(h.sent).toEqual([holdingLine("Robin", MAUDE), holdingLine("Robin", MAUDE)]);
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

test("a tick that overlaps a slow send sends no second holding line", async () => {
  const { h, other, deps, sentToOther, queueFor, holdFirstSend } = twoChats();
  queueFor(h.opened.id);
  queueFor(other.id);
  await h.run(SLACK_STALLED_MS - TICK_MS);
  h.state.clock += TICK_MS;
  const release = await holdFirstSend();
  await tickSlackLifecycle(deps);
  await release();
  expect(sentToOther).toEqual([holdingLine("Robin", MAUDE)]);
  expect(h.notices).toHaveLength(2);
});

test("a tick that overlaps a slow send queues no second check-in", async () => {
  const { h, other, deps, queueFor, holdFirstSend } = twoChats();
  await h.run(20 * MINUTE);
  queueFor(h.opened.id);
  await h.run(SLACK_STALLED_MS - TICK_MS);
  h.state.clock += TICK_MS;
  const release = await holdFirstSend();
  await tickSlackLifecycle(deps);
  await release();
  expect(pendingItems(other.id, h.db).filter((i) => i.kind === "check-in")).toHaveLength(1);
});

test("a chat that closes while a tick waits on another chat's send hears nothing more", async () => {
  const { h, other, deps, sentToOther, queueFor, holdFirstSend } = twoChats();
  queueFor(h.opened.id);
  queueFor(other.id);
  await h.run(SLACK_STALLED_MS - TICK_MS);
  h.state.clock += TICK_MS;
  const release = await holdFirstSend();
  await finishClose(other.id, "closed-by-pane", undefined, deps);
  await release();
  expect(sentToOther).toEqual([CLOSED_LINE]);
});

test("a sleep during a slow send moves the clocks before the tick reaches the next chat", async () => {
  const { h, other, queueFor, holdFirstSend } = twoChats();
  await h.run(49 * MINUTE);
  queueFor(h.opened.id);
  await h.run(SLACK_STALLED_MS - TICK_MS);
  h.state.clock += TICK_MS;
  const release = await holdFirstSend();
  const quietAtSleep = conversationById(other.id, h.db)!.lastActiveAt;
  const gap = 3 * 60 * MINUTE;
  h.state.clock += gap;
  await release();
  expect(conversationById(other.id, h.db)).toMatchObject({ closeAskedAt: null, closedAt: null, lastActiveAt: quietAtSleep + gap });
});

test("a tick runs again once the slow one ends", async () => {
  const { h, other, deps, queueFor, holdFirstSend } = twoChats();
  queueFor(h.opened.id);
  await h.run(SLACK_STALLED_MS - TICK_MS);
  h.state.clock += TICK_MS;
  const release = await holdFirstSend();
  await release();
  queueFor(other.id);
  await h.run(SLACK_STALLED_MS);
  await tickSlackLifecycle(deps);
  expect(conversationById(other.id, h.db)!.stalledNotedAt).not.toBeNull();
});

test("a clock written after the wake and before the first tick stays at now, so the 2 minute fallback still fires", async () => {
  const h = harness();
  await h.run(MINUTE);
  h.state.clock += 8 * 60 * MINUTE;
  const wokeAt = h.state.clock;
  requestClose(h.opened.id, "operator", h.deps);
  await h.tick();
  expect(h.row().closeAskedAt).toBe(wokeAt);
  await h.run(SLACK_FAREWELL_MS);
  expect(h.row().closeReason).toBe("operator");
});

test("a sleep before a chat's first tick still moves its clocks", async () => {
  const h = harness();
  const gap = 8 * 60 * MINUTE;
  h.state.clock += gap;
  await h.tick();
  expect(h.kinds()).toEqual([]);
  expect(h.row()).toMatchObject({ closeAskedAt: null, lastActiveAt: START + gap });
});

function withRequester(h: ReturnType<typeof harness>, assigned: { pane: string } | null = null) {
  h.db
    .query("UPDATE slack_conversations SET requester_handle = 'req.one', requester_session = 'rs1', assigned_agent = ?, assigned_pane = ? WHERE id = ?;")
    .run(assigned ? "agent-1" : null, assigned?.pane ?? null, h.opened.id);
}

test("finishClose sends the requester a closed milestone with the reason, the farewell as summary, and the conversation's ticket ids", async () => {
  const h = harness();
  withRequester(h);
  recordSupportTicket(h.opened.id, { id: "SUPPORT-4", title: "Cannot log in", url: "https://linear.example/SUPPORT-4" }, START, h.db);
  await finishClose(h.opened.id, "closed-by-pane", "All sorted.\n", h.deps);
  expect(h.dms).toEqual([
    { to: "req.one", body: "Alex Example's chat closed: the pane ended it. All sorted. Tickets: SUPPORT-4." },
  ]);
  expect(h.desk).toEqual([]);
});

test("a closed milestone with the requester offline goes to the desk", async () => {
  const h = harness();
  withRequester(h);
  h.online.value = false;
  await finishClose(h.opened.id, "idle", undefined, h.deps);
  expect(h.dms).toEqual([]);
  expect(h.desk).toEqual(["Alex Example's chat closed: it went quiet."]);
});

test("a conversation with no requester sends no closed milestone", async () => {
  const h = harness();
  await finishClose(h.opened.id, "idle", undefined, h.deps);
  expect(h.dms).toEqual([]);
  expect(h.desk).toEqual([]);
});

test("finishClose does not close the agent's pane (it must live through grace)", async () => {
  const h = harness();
  withRequester(h, { pane: "bg:p7" });
  await finishClose(h.opened.id, "closed-by-pane", "Bye.", h.deps);
  expect(h.herdr).toEqual([]);
});

const agentPosts = (h: ReturnType<typeof harness>, at = h.state.clock) =>
  h.db.query("INSERT INTO chat_messages (room, handle, body, posted_at) VALUES (?, ?, 'hello', ?);").run(conversation.room, conversation.agentHandle, at);

test("an assigned agent with no first post after 60 s closes the row as pane-gone, sends open-failed and closes its pane, even while its watcher polls", async () => {
  const h = harness();
  withRequester(h, { pane: "bg:p7" });
  await h.run(SLACK_OPEN_DEADLINE_MS - TICK_MS);
  expect(h.row().closedAt).toBeNull();
  await h.run(TICK_MS);
  expect(h.row()).toMatchObject({ closeReason: "pane-gone" });
  expect(h.dms).toEqual([{ to: "req.one", body: "Alex Example could not be connected: the support agent never reached the chat within 60 seconds" }]);
  expect(h.herdr).toEqual([{ socket: expect.stringContaining("herdr.sock"), args: ["pane", "close", "p7"] }]);
  expect(h.sent).toEqual([]);
  expect(h.kinds()).toEqual(["closed"]);
});

test("an assigned agent that posts within 60 s is not closed by the open deadline", async () => {
  const h = harness();
  withRequester(h, { pane: "bg:p7" });
  await h.run(SLACK_OPEN_DEADLINE_MS - TICK_MS);
  agentPosts(h);
  await h.run(2 * SLACK_OPEN_DEADLINE_MS);
  expect(h.row().closedAt).toBeNull();
  expect(h.herdr).toEqual([]);
  expect(h.dms).toEqual([]);
});

test("an agent post from before the conversation opened does not disarm the open deadline", async () => {
  const h = harness();
  withRequester(h, { pane: "bg:p7" });
  agentPosts(h, START - MINUTE);
  await h.run(SLACK_OPEN_DEADLINE_MS);
  expect(h.row().closeReason).toBe("pane-gone");
  expect(h.dms).toEqual([{ to: "req.one", body: "Alex Example could not be connected: the support agent never reached the chat within 60 seconds" }]);
  expect(h.herdr).toHaveLength(1);
});

test("a sleep restarts the open deadline from the wake", async () => {
  const h = harness();
  withRequester(h, { pane: "bg:p7" });
  h.state.clock += 8 * 60 * MINUTE;
  await h.tick();
  expect(h.row().closedAt).toBeNull();
  await h.run(SLACK_OPEN_DEADLINE_MS - TICK_MS);
  expect(h.row().closedAt).toBeNull();
  await h.run(TICK_MS);
  expect(h.row().closeReason).toBe("pane-gone");
  expect(h.herdr).toHaveLength(1);
});

test("a manually opened conversation has no open deadline", async () => {
  const h = harness();
  await h.run(2 * SLACK_OPEN_DEADLINE_MS, { watcher: false });
  expect(h.row().closedAt).toBeNull();
});
