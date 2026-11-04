/**
 * lib/daemon/__tests__/chat-slack-participant.test.ts: a Slack teammate sitting in an rt chat DM room.
 */
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Logger } from "pino";
import type { InboxBinding } from "../../claude-registry.ts";
import { herdrRequest } from "../../herdr/client.ts";
import { SlackError, type SlackClient } from "../../slack/client.ts";
import {
  closeConversation,
  conversationForRoom,
  dmRoomFor,
  ensureSlackIdentity,
  openConversation,
  openStateDb,
  postMessage,
  stalePendingPairs,
  type RegistryDeps,
} from "../../state/index.ts";
import { createChatDeliverySweep, createChatHandlers, planSweepTargets, postAndNotify, type InboxDeps } from "../handlers/chat.ts";

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
  });
  const registryDeps: RegistryDeps = { resolve: () => binding, alive: () => true, resolveAll: () => new Map([["pane-session", binding]]) };
  const sweep = createChatDeliverySweep({ db, deliveryChains, inboxDeps, registryDeps, log, retryDelayMs: 0 });
  const fromSlack = (room: string, handle: string, body: string) =>
    postAndNotify(db, () => 0, { room, handle, body, fromSlack: true }, inboxDeps, herdrRequest, deliveryChains, log, 0);
  return { db, handlers, posts, pushed, slept, sweep, fromSlack };
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
  h.db.run("UPDATE slack_conversations SET checked_in_at = 5 WHERE id = ?", [conversation.id]);

  const res = await h.handlers["chat:dm"]({ from: agent, to: "alex-slack", body: "[Claude 🤖]: try restarting", sessionId: PANE_SESSION });

  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error(res.error);
  expect(res.data.room).toBe(room);
  expect(res.data.redacted).toBeUndefined();
  expect(h.posts).toEqual([{ channel: "D0TEST", text: "[Claude 🤖]: try restarting" }]);
  expect(messages(h, room)).toEqual([{ handle: agent, body: "try restarting" }]);
  expect(cursor(h, room, SLACK_ID)).toBe(res.data.id);
  const touched = conversationForRoom(room, h.db)!;
  expect(touched.lastActiveAt).toBeGreaterThan(conversation.lastActiveAt);
  expect(touched.checkedInAt).toBeNull();
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
