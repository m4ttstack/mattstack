/**
 * lib/daemon/__tests__/chat-slack-participant.test.ts: a Slack teammate sitting in an rt chat DM room.
 */
import { Database } from "bun:sqlite";
import { beforeEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Logger } from "pino";
import type { InboxBinding } from "../../claude-registry.ts";
import { herdrRequest } from "../../herdr/client.ts";
import { drainNotifications, peekNotifications } from "../../notifier.ts";
import { SlackError, createSlackClient, type SlackClient } from "../../slack/client.ts";
import { SLACK_PREFIX, closingLine } from "../../slack/format.ts";
import {
  closeConversation,
  closedNoticeForAgent,
  conversationById,
  conversationForRoom,
  dmRoomFor,
  ensureSlackIdentity,
  listOpenConversations,
  markWatcherSeen,
  openConversation,
  openStateDb,
  pendingItems,
  postMessage,
  stalePendingPairs,
  type RegistryDeps,
} from "../../state/index.ts";
import { createChatDeliverySweep, createChatHandlers, planSweepTargets, postAndNotify, type InboxDeps } from "../handlers/chat.ts";
import { SLACK_CHECK_IN_MS, SLACK_FAREWELL_MS, SLACK_IDLE_MS, tickSlackLifecycle } from "../slack-lifecycle.ts";

const log = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} } as unknown as Logger;
const SLACK_ID = "slack.u0test";
const PANE_SESSION = "pane-session";
let n = 0;

function socketFile(): string {
  const p = join(mkdtempSync(join(tmpdir(), "slack-sock-")), "s.sock");
  writeFileSync(p, "");
  return p;
}

type Post = { channel: string; text: string };

function harness(post: (p: Post) => Promise<{ ts: string }> = async () => ({ ts: "1.0" }), connected = true) {
  const db = openStateDb(join(tmpdir(), `chat-slack-${process.pid}-${n++}-${Date.now()}.db`));
  const posts: Post[] = [];
  const pushed: string[] = [];
  const slept: number[] = [];
  const notices: string[] = [];
  const binding: InboxBinding = { pid: process.pid, socketPath: socketFile(), status: "busy" };
  const inboxDeps: InboxDeps = {
    resolve: () => binding,
    deliver: async (_socket, content) => {
      pushed.push(content);
      return { ok: true };
    },
  };
  const client = {
    post: (channel: string, text: string) => {
      posts.push({ channel, text });
      return post({ channel, text });
    },
  } as SlackClient;
  const deliveryChains = new Map<string, Promise<void>>();
  const handlers = createChatHandlers({
    db,
    emitEvent: () => 0,
    inboxDeps,
    log,
    deliveryChains,
    retryDelayMs: 0,
    slackClient: async () => (connected ? client : null),
    slackSleep: async (ms) => {
      slept.push(ms);
    },
    slackNotify: (_title, message) => {
      notices.push(message);
    },
  });
  const registryDeps: RegistryDeps = { resolve: () => binding, alive: () => true, resolveAll: () => new Map([["pane-session", binding]]) };
  const sweep = createChatDeliverySweep({ db, deliveryChains, inboxDeps, registryDeps, log, retryDelayMs: 0 });
  const fromSlack = (room: string, handle: string, body: string) =>
    postAndNotify(db, () => 0, { room, handle, body, fromSlack: true }, inboxDeps, herdrRequest, deliveryChains, log, 0);
  return { db, handlers, client, posts, pushed, slept, notices, sweep, fromSlack };
}

type Harness = ReturnType<typeof harness>;

async function settle(): Promise<void> {
  await Bun.sleep(10);
}

async function signIn(h: Harness, sessionId: string, baseHandle: string): Promise<string> {
  const res = await h.handlers["chat:sign-in"]({ sessionId, baseHandle });
  if (!res.ok) throw new Error(res.error);
  return res.data.handle;
}

async function openChat(h: Harness) {
  const agent = await signIn(h, PANE_SESSION, "support");
  ensureSlackIdentity("U0TEST", "Alex", h.db);
  const { room } = dmRoomFor(agent, SLACK_ID, "matt", h.db);
  const conversation = openConversation(
    {
      room,
      agentHandle: agent,
      slackHandle: SLACK_ID,
      slackUserId: "U0TEST",
      slackChannel: "D0TEST",
      slackDisplayName: "Alex Example",
      operatorUserId: "U0OPERATOR",
      operatorName: "Sam",
      frameMarker: "marker",
      lastReadTs: "0.0",
      openedAt: 1000,
    },
    h.db,
  );
  await settle();
  h.pushed.length = 0;
  return { agent, room, conversation };
}

function messages(h: Harness, room: string) {
  return h.db.query("SELECT handle, body FROM chat_messages WHERE room = ? ORDER BY id").all(room) as { handle: string; body: string }[];
}

function cursor(h: Harness, room: string, handle: string): number {
  return (h.db.query("SELECT last_read_id AS id FROM chat_members WHERE room = ? AND handle = ?").get(room, handle) as { id: number }).id;
}

test("the sweep never targets a Slack identity", async () => {
  const stale = [{ room: "dm-x", handle: SLACK_ID, maxId: 9, wakeOn: "all" as const }];
  const presence = new Map([[SLACK_ID, { sessionId: "s" }]]);
  expect(planSweepTargets(stale, presence, new Set(["s"]))).toEqual([]);

  const h = harness();
  const { agent, room } = await openChat(h);
  postMessage({ room, handle: agent, body: "not via chat_dm" }, h.db);
  expect(stalePendingPairs(h.db).filter((p) => p.handle === SLACK_ID)).toEqual([]);
});

test("a chat_dm into an open conversation posts to Slack once with the prefix, then records it", async () => {
  const h = harness();
  const { agent, room, conversation } = await openChat(h);

  const res = await h.handlers["chat:dm"]({ from: agent, to: "alex-slack", body: "[Claude 🤖]: try restarting", sessionId: PANE_SESSION });

  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error(res.error);
  expect(res.data.room).toBe(room);
  expect(res.data.redacted).toBeUndefined();
  expect(h.posts).toEqual([{ channel: "D0TEST", text: "[Claude 🤖]: try restarting" }]);
  expect(messages(h, room)).toEqual([{ handle: agent, body: "try restarting" }]);
  expect(cursor(h, room, SLACK_ID)).toBe(res.data.id);
  expect(conversationForRoom(room, h.db)!.lastActiveAt).toBeGreaterThan(conversation.lastActiveAt);
});

test("a reply with Slack's control characters is escaped on the wire and stays plain in the room", async () => {
  const wire: (string | null)[] = [];
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    wire.push(new URLSearchParams(String(init.body)).get("text"));
    return new Response(JSON.stringify({ ok: true, ts: "9.1" }));
  }) as unknown as typeof fetch;
  const h = harness();
  const { agent, room } = await openChat(h);
  const handlers = createChatHandlers({ db: h.db, emitEvent: () => 0, log, slackClient: async () => createSlackClient("t", fakeFetch) });

  const res = await handlers["chat:dm"]({ from: agent, to: SLACK_ID, body: "It returns Promise<void>, so run it with 2>&1", sessionId: PANE_SESSION });

  expect(res.ok).toBe(true);
  expect(wire).toEqual(["[Claude 🤖]: It returns Promise&lt;void&gt;, so run it with 2&gt;&amp;1"]);
  expect(messages(h, room)).toEqual([{ handle: agent, body: "It returns Promise<void>, so run it with 2>&1" }]);
});

test("a pane's message after a check-in leaves the clock alone", async () => {
  const h = harness();
  const { agent, room, conversation } = await openChat(h);
  h.db.run("UPDATE slack_conversations SET checked_in_at = 5 WHERE id = ?", [conversation.id]);

  await h.handlers["chat:dm"]({ from: agent, to: SLACK_ID, body: "Still need help?", sessionId: PANE_SESSION });

  const row = conversationForRoom(room, h.db)!;
  expect(row.lastActiveAt).toBe(conversation.lastActiveAt);
  expect(row.checkedInAt).toBe(5);
});

test("a teammate who walks away after a check-in reply still reaches the idle close", async () => {
  const h = harness();
  const { agent, conversation } = await openChat(h);
  let clock = conversation.openedAt;
  const deps = { db: h.db, client: async () => h.client, notify: () => {}, post: () => ({ id: 1 }), now: () => clock };
  const run = async (ms: number) => {
    for (const end = clock + ms; clock < end; ) {
      clock += 15_000;
      for (const open of listOpenConversations(h.db)) markWatcherSeen(open.id, clock, h.db);
      await tickSlackLifecycle(deps);
    }
  };

  await run(SLACK_CHECK_IN_MS);
  expect(pendingItems(conversation.id, h.db).map((i) => i.kind)).toEqual(["check-in"]);
  const reply = await h.handlers["chat:dm"]({ from: agent, to: SLACK_ID, body: "Still need help? I'll close this soon.", sessionId: PANE_SESSION });
  expect(reply.ok).toBe(true);

  await run(SLACK_IDLE_MS - SLACK_CHECK_IN_MS);
  expect(pendingItems(conversation.id, h.db).map((i) => i.kind)).toEqual(["check-in", "close-request"]);

  await run(SLACK_FAREWELL_MS);
  expect(conversationById(conversation.id, h.db)!.closeReason).toBe("idle");
});

test("sign-out closes the session's chat as pane-gone, with the fixed line and the desk notice", async () => {
  const h = harness();
  const { agent, room, conversation } = await openChat(h);

  const res = await h.handlers["chat:sign-out"]({ sessionId: PANE_SESSION });
  await settle();

  expect(res.ok).toBe(true);
  expect(conversationById(conversation.id, h.db)!.closeReason).toBe("pane-gone");
  expect(h.posts.map((p) => p.text)).toEqual([closingLine("Sam", true)]);
  expect(messages(h, room)).toEqual([{ handle: agent, body: closingLine("Sam", true).slice(SLACK_PREFIX.length) }]);
  expect(h.notices).toEqual(["Claude stopped responding to alex-slack, who is waiting to hear from you"]);
  expect(closedNoticeForAgent(agent, h.db)?.item.text).toContain("pane-gone");
});

test("sign-out doesn't wait on Slack, and the chat is closed by the time it returns", async () => {
  const held = Promise.withResolvers<{ ts: string }>();
  const h = harness(() => held.promise);
  const { conversation } = await openChat(h);

  const res = await h.handlers["chat:sign-out"]({ sessionId: PANE_SESSION });

  expect(res.ok).toBe(true);
  expect(conversationById(conversation.id, h.db)!.closedAt).not.toBeNull();
  expect(h.notices).toEqual([]);

  held.resolve({ ts: "1.0" });
  await settle();
  expect(h.notices).toHaveLength(1);
});

test("a Slack failure can't fail a sign-out, and the operator is told", async () => {
  const h = harness(async () => {
    throw new SlackError("channel_not_found");
  });
  const { conversation } = await openChat(h);

  const res = await h.handlers["chat:sign-out"]({ sessionId: PANE_SESSION });
  await settle();

  expect(res.ok).toBe(true);
  expect(conversationById(conversation.id, h.db)!.closeReason).toBe("pane-gone");
  expect(h.notices).toEqual(["The closing message to alex-slack did not reach Slack, so check the DM"]);
});

test("a sign-out from a session that doesn't hold the seat leaves the chat open", async () => {
  const h = harness();
  const { agent, room, conversation } = await openChat(h);

  // The fork, the background session and a `claude -p` run inside the pane each end under an id of their own.
  await h.handlers["chat:sign-out"]({ sessionId: "forked-session" });
  await settle();

  expect(conversationById(conversation.id, h.db)!.closedAt).toBeNull();
  expect(h.posts).toEqual([]);
  const reply = await h.handlers["chat:dm"]({ from: agent, to: SLACK_ID, body: "Still here", sessionId: PANE_SESSION });
  expect(reply.ok).toBe(true);
  expect(messages(h, room)).toEqual([{ handle: agent, body: "Still here" }]);
});

test("a sign-out by another identity leaves the chat open", async () => {
  const h = harness();
  const { conversation } = await openChat(h);
  await signIn(h, "other-session", "other");

  await h.handlers["chat:sign-out"]({ sessionId: "other-session" });
  await settle();

  expect(conversationById(conversation.id, h.db)!.closedAt).toBeNull();
  expect(h.notices).toEqual([]);
});

test("a Slack failure leaves no chat row and fails the tool with the reason", async () => {
  const h = harness(async () => {
    throw new SlackError("channel_not_found");
  });
  const { agent, room } = await openChat(h);

  const res = await h.handlers["chat:dm"]({ from: agent, to: SLACK_ID, body: "hello", sessionId: PANE_SESSION });

  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("unreachable");
  expect(res.error).toContain("channel_not_found");
  expect(messages(h, room)).toEqual([]);
});

test("no Slack token fails the tool with the reason", async () => {
  const h = harness(undefined, false);
  const { agent, room } = await openChat(h);

  const res = await h.handlers["chat:dm"]({ from: agent, to: SLACK_ID, body: "hello", sessionId: PANE_SESSION });

  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("unreachable");
  expect(res.error).toContain("Slack is not connected");
  expect(messages(h, room)).toEqual([]);
});

test("a 429 is retried after Retry-After", async () => {
  let calls = 0;
  const h = harness(async () => {
    if (++calls === 1) throw new SlackError("ratelimited", 3000);
    return { ts: "2.0" };
  });
  const { agent, room } = await openChat(h);

  const res = await h.handlers["chat:dm"]({ from: agent, to: SLACK_ID, body: "hello", sessionId: PANE_SESSION });

  expect(res.ok).toBe(true);
  expect(h.slept).toEqual([3000]);
  expect(h.posts).toHaveLength(2);
  expect(messages(h, room)).toHaveLength(1);
});

test("a Retry-After past what the caller will wait for fails with the reason", async () => {
  const h = harness(async () => {
    throw new SlackError("ratelimited", 600_000);
  });
  const { agent, room } = await openChat(h);

  const res = await h.handlers["chat:dm"]({ from: agent, to: SLACK_ID, body: "hello", sessionId: PANE_SESSION });

  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("unreachable");
  expect(res.error).toContain("ratelimited");
  expect(h.slept).toEqual([]);
  expect(h.posts).toHaveLength(1);
  expect(messages(h, room)).toEqual([]);
});

test("chat_dm into a closed conversation's room is refused", async () => {
  const h = harness();
  const { agent, room, conversation } = await openChat(h);
  closeConversation(conversation.id, "idle", 2000, h.db);

  const res = await h.handlers["chat:dm"]({ from: agent, to: SLACK_ID, body: "one more thing", sessionId: PANE_SESSION });

  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("unreachable");
  expect(res.failure?.code).toBe("slack-chat");
  expect(res.error).toContain("closed");
  expect(h.posts).toEqual([]);
  expect(messages(h, room)).toEqual([]);
});

beforeEach(() => {
  drainNotifications();
});

test("a teammate's Slack message that names the human does not notify", async () => {
  const h = harness();
  const { room } = await openChat(h);

  h.fromSlack(room, SLACK_ID, "@matt can you look at this");

  expect(peekNotifications()).toHaveLength(0);
});

test("a pane's reply to the teammate that names the human does not notify", async () => {
  const h = harness();
  const { agent } = await openChat(h);

  const res = await h.handlers["chat:dm"]({ from: agent, to: SLACK_ID, body: "@matt will follow up", sessionId: PANE_SESSION });

  expect(res.ok).toBe(true);
  expect(peekNotifications()).toHaveLength(0);
});

test("the outcome DM to the human notifies", async () => {
  const h = harness();
  const { agent } = await openChat(h);

  const res = await h.handlers["chat:dm"]({ from: agent, to: "matt", body: "Outcome: sorted", sessionId: PANE_SESSION });

  expect(res.ok).toBe(true);
  expect(peekNotifications()).toHaveLength(1);
});

test("a post from the operator in the room never reaches Slack", async () => {
  const h = harness();
  const { room } = await openChat(h);

  const res = await h.handlers["chat:post"]({ room, handle: "matt", body: "check the logs first" });
  await settle();

  expect(res.ok).toBe(true);
  expect(h.posts).toEqual([]);
  expect(h.pushed.join("\n")).toContain("check the logs first");
  expect(messages(h, room)).toEqual([{ handle: "matt", body: "check the logs first" }]);
});

test("a Slack message is never swept to the pane", async () => {
  const h = harness();
  const { agent, room } = await openChat(h);

  const posted = h.fromSlack(room, SLACK_ID, "it is still broken")!;
  await settle();
  const swept = await h.sweep();
  await settle();

  expect(swept).toEqual({ sweptPairs: 0, recoveredMessages: 0 });
  expect(h.pushed).toEqual([]);
  expect(cursor(h, room, agent)).toBe(posted.id);
});

test("the operator's Slack message is marked delivered for the pane too", async () => {
  const h = harness();
  const { agent, room } = await openChat(h);

  const posted = h.fromSlack(room, "matt", "I typed this in Slack")!;
  await settle();

  expect(h.pushed).toEqual([]);
  expect(cursor(h, room, agent)).toBe(posted.id);
});

test("a chat UI post never bundles a Slack message", async () => {
  const h = harness();
  const { room } = await openChat(h);

  h.fromSlack(room, SLACK_ID, "text from slack");
  await h.handlers["chat:post"]({ room, handle: "matt", body: "from the viewer" });
  await settle();

  const frames = h.pushed.join("\n");
  expect(frames).toContain("from the viewer");
  expect(frames).not.toContain("text from slack");
});

test("chat_dm to a Slack identity from another pane is refused", async () => {
  const h = harness();
  await openChat(h);
  const other = await signIn(h, "other-session", "bystander");

  const res = await h.handlers["chat:dm"]({ from: other, to: SLACK_ID, body: "hi" });

  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("unreachable");
  expect(res.failure?.code).toBe("slack-chat");
  expect(h.posts).toEqual([]);
  expect(h.db.query("SELECT COUNT(*) AS c FROM chat_dms WHERE a = ?1 OR b = ?1").get(other)).toEqual({ c: 0 });
});

test("chat:dm-open to a Slack identity from another pane leaves no orphan room", async () => {
  const h = harness();
  await openChat(h);
  const other = await signIn(h, "other-session", "bystander");

  const res = await h.handlers["chat:dm-open"]({ from: other, to: SLACK_ID });

  expect(res.ok).toBe(false);
  expect(h.db.query("SELECT COUNT(*) AS c FROM chat_dms WHERE a = ?1 OR b = ?1").get(other)).toEqual({ c: 0 });
});

test("nobody speaks as a Slack identity through chat:dm or chat:post", async () => {
  const h = harness();
  const { agent, room } = await openChat(h);

  const dm = await h.handlers["chat:dm"]({ from: SLACK_ID, to: agent, body: "forged" });
  const post = await h.handlers["chat:post"]({ room, handle: "alex-slack", body: "forged" });

  expect(dm.ok).toBe(false);
  expect(post.ok).toBe(false);
  expect(messages(h, room)).toEqual([]);
});

test("a shell naming the pane's handle with no session can't reach Slack", async () => {
  const h = harness();
  const { agent, room } = await openChat(h);

  const res = await h.handlers["chat:dm"]({ from: agent, to: SLACK_ID, body: "spoofed" });

  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("unreachable");
  expect(res.failure?.code).toBe("slack-chat");
  expect(h.posts).toEqual([]);
  expect(messages(h, room)).toEqual([]);
});

test("a foreign session naming the pane's handle can't reach Slack", async () => {
  const h = harness();
  const { agent, room } = await openChat(h);

  const res = await h.handlers["chat:dm"]({ from: agent, to: SLACK_ID, body: "spoofed", sessionId: "someone-else" });

  expect(res.ok).toBe(false);
  expect(h.posts).toEqual([]);
  expect(messages(h, room)).toEqual([]);
});

test("a pruned presence row can't reach Slack", async () => {
  const h = harness();
  const { agent, room } = await openChat(h);
  h.db.run("DELETE FROM chat_presence WHERE handle = ?", [agent]);

  const res = await h.handlers["chat:dm"]({ from: agent, to: SLACK_ID, body: "too late", sessionId: PANE_SESSION });

  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("unreachable");
  expect(res.failure?.code).toBe("slack-chat");
  expect(h.posts).toEqual([]);
  expect(messages(h, room)).toEqual([]);
});

test("the pane's chat_post into its open conversation is refused and points at chat_dm", async () => {
  const h = harness();
  const { agent, room } = await openChat(h);

  const res = await h.handlers["chat:post"]({ room, handle: agent, body: "this would never reach Slack" });

  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("unreachable");
  expect(res.failure?.code).toBe("slack-chat");
  expect(res.error).toContain("chat_dm");
  expect(messages(h, room)).toEqual([]);
});

test("a reply Slack accepted is not reported as failed when the room record can't be written", async () => {
  const held: Database[] = [];
  const h = harness(async () => {
    const other = new Database(h.db.filename);
    other.exec("BEGIN IMMEDIATE");
    held.push(other);
    return { ts: "1.0" };
  });
  const { agent, room } = await openChat(h);
  h.db.exec("PRAGMA busy_timeout = 1");
  const warned = spyOn(log, "warn");

  const res = await h.handlers["chat:dm"]({ from: agent, to: SLACK_ID, body: "try restarting", sessionId: PANE_SESSION });

  for (const other of held) other.close();
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error(res.error);
  expect(res.data.note).toContain("do not send it again");
  expect(res.data.room).toBe(room);
  expect(h.posts).toHaveLength(1);
  expect(messages(h, room)).toEqual([]);
  expect(warned.mock.calls.filter(([, message]) => String(message).includes("Slack took"))).toHaveLength(1);
  warned.mockRestore();
});

test("a reply whose row was written reports that row, even when the bookkeeping after it fails", async () => {
  const h = harness();
  const { agent, room } = await openChat(h);
  h.db.exec("CREATE TRIGGER no_touch BEFORE UPDATE ON slack_conversations BEGIN SELECT RAISE(ABORT, 'no touch'); END;");
  const warned = spyOn(log, "warn");

  const res = await h.handlers["chat:dm"]({ from: agent, to: SLACK_ID, body: "try restarting", sessionId: PANE_SESSION });

  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error(res.error);
  expect(res.data.note).toBeUndefined();
  expect(res.data.id).toBeGreaterThan(0);
  expect(messages(h, room)).toEqual([{ handle: agent, body: "try restarting" }]);
  expect(warned.mock.calls.filter(([, message]) => String(message).includes("Slack took"))).toHaveLength(1);
  warned.mockRestore();
});

test("a thrown chat row write after Slack took the reply warns once", async () => {
  const h = harness();
  const { agent, room } = await openChat(h);
  h.db.exec("CREATE TRIGGER no_row BEFORE INSERT ON chat_messages BEGIN SELECT RAISE(ABORT, 'no row'); END;");
  const warned = spyOn(log, "warn");

  const res = await h.handlers["chat:dm"]({ from: agent, to: SLACK_ID, body: "try restarting", sessionId: PANE_SESSION });

  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error(res.error);
  expect(res.data.note).toContain("do not send it again");
  expect(res.data.room).toBe(room);
  expect(warned.mock.calls.filter(([, message]) => String(message).includes("Slack took"))).toHaveLength(1);
  warned.mockRestore();
});

test("a chat_dm between agents still fails when its row can't be written", async () => {
  const h = harness();
  const agent = await signIn(h, PANE_SESSION, "support");
  await signIn(h, "other-session", "other");
  const opened = await h.handlers["chat:dm"]({ from: agent, to: "other", body: "first", sessionId: PANE_SESSION });
  expect(opened.ok).toBe(true);
  const other = new Database(h.db.filename);
  other.exec("BEGIN IMMEDIATE");
  h.db.exec("PRAGMA busy_timeout = 1");

  const res = await h.handlers["chat:dm"]({ from: agent, to: "other", body: "second", sessionId: PANE_SESSION });

  other.close();
  expect(res.ok).toBe(false);
});

test("a credential in a reply is redacted and the tool result says so", async () => {
  const h = harness();
  const { agent, room } = await openChat(h);

  const res = await h.handlers["chat:dm"]({ from: agent, to: SLACK_ID, body: "use ghp_abc123 here", sessionId: PANE_SESSION });

  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error(res.error);
  expect(res.data.redacted).toBe(true);
  expect(h.posts[0]!.text).toBe("[Claude 🤖]: use [redacted] here");
  expect(messages(h, room)).toEqual([{ handle: agent, body: "use [redacted] here" }]);
});

test("a chat_dm between two agents is untouched", async () => {
  const h = harness();
  const { agent } = await openChat(h);
  const other = await signIn(h, "other-session", "bystander");

  const res = await h.handlers["chat:dm"]({ from: agent, to: other, body: "ghp_abc123" });

  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error(res.error);
  expect(res.data.redacted).toBeUndefined();
  expect(h.posts).toEqual([]);
  expect(messages(h, res.data.room)).toEqual([{ handle: agent, body: "ghp_abc123" }]);
});
