/**
 * lib/daemon/handlers/__tests__/slack-chat.test.ts: opening, watching and confirming a Slack support chat.
 */
import { expect, test } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import type { Logger } from "pino";
import { SLACK_SUPPORT_SCOPES } from "../../../setup/slack-app.ts";
import { SlackError, type SlackClient, type SlackUser } from "../../../slack/client.ts";
import {
  closeConversation,
  conversationForAgent,
  enqueueItem,
  getIdentity,
  listDms,
  listOpenConversations,
  openStateDb,
  pendingItems,
} from "../../../state/index.ts";
import { createChatHandlers } from "../chat.ts";
import { createSlackChatHandlers } from "../slack-chat.ts";

const log = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} } as unknown as Logger;
const SESSION = "pane-session";
const NOW = 1_800_000_000_123;
let n = 0;

function user(id: string, realName: string, over: Partial<SlackUser> = {}): SlackUser {
  return { id, name: realName.toLowerCase(), displayName: "", realName, deleted: false, isBot: false, ...over };
}

const OPERATOR = user("U0OPER", "Robin Example");
const ALEX = user("U0TEST", "Alex Example");

interface Options {
  users?: SlackUser[];
  scopes?: string[];
  newest?: string | undefined;
  connected?: boolean;
  openDm?: () => Promise<string>;
}

function harness(opts: Options = {}) {
  const db = openStateDb(join(tmpdir(), `slack-chat-${process.pid}-${n++}-${Date.now()}.db`));
  const calls: string[] = [];
  const client = {
    authTest: async () => {
      calls.push("authTest");
      return { userId: OPERATOR.id, scopes: opts.scopes ?? ["chat:write", ...SLACK_SUPPORT_SCOPES] };
    },
    listUsers: async () => {
      calls.push("listUsers");
      return opts.users ?? [OPERATOR, ALEX];
    },
    openDm: async () => {
      calls.push("openDm");
      return opts.openDm ? opts.openDm() : "D0TEST";
    },
    newestTs: async () => {
      calls.push("newestTs");
      return "newest" in opts ? opts.newest : "1700000000.000100";
    },
  } as unknown as SlackClient;
  const handlers = createSlackChatHandlers({
    db,
    log,
    slackClient: async () => (opts.connected === false ? null : client),
    now: () => NOW,
  });
  const chat = createChatHandlers({ db, emitEvent: () => 0, log });
  async function signIn(sessionId = SESSION, baseHandle = "support") {
    const res = await chat["chat:sign-in"]({ sessionId, baseHandle });
    if (!res.ok) throw new Error(res.error);
    return res.data.handle;
  }
  return { db, handlers, chat, signIn, calls };
}

type Harness = ReturnType<typeof harness>;

async function open(h: Harness, person = "alex", sessionId = SESSION) {
  const agentHandle = await h.signIn(sessionId, `support-${sessionId}`);
  return { agentHandle, res: await h.handlers["chat:slack-open"]({ agentHandle, sessionId, person }) };
}

function refusal(res: { ok: boolean; failure?: { code: string; message: string } }): string {
  expect(res.ok).toBe(false);
  return res.failure!.message;
}

test("slack-open records the conversation, with Slack's newest ts as the cursor", async () => {
  const h = harness();
  const { agentHandle, res } = await open(h);
  if (!res.ok) throw new Error(res.error);
  expect(res.data.handle).toBe("slack.u0test");
  expect(res.data.name).toBe("alex-slack");
  expect(res.data.frameMarker).toMatch(/^[0-9a-f]{16}$/);
  const row = conversationForAgent(agentHandle, h.db)!;
  expect(row).toMatchObject({
    id: res.data.conversationId,
    room: res.data.room,
    slackHandle: "slack.u0test",
    slackUserId: "U0TEST",
    slackChannel: "D0TEST",
    operatorUserId: "U0OPER",
    operatorName: "Robin",
    frameMarker: res.data.frameMarker,
    lastReadTs: "1700000000.000100",
    openedAt: NOW,
  });
  expect(getIdentity("slack.u0test", h.db)?.sessionId).toBeNull();
  expect(listDms(agentHandle, h.db).map((d) => d.room)).toEqual([res.data.room]);
});

test("an empty DM seeds the cursor from the local clock", async () => {
  const h = harness({ newest: undefined });
  const { agentHandle } = await open(h);
  expect(conversationForAgent(agentHandle, h.db)!.lastReadTs).toBe("1800000000.123000");
});

test("each conversation gets its own marker", async () => {
  const h = harness({ users: [OPERATOR, ALEX, user("U0TWO", "Blake Example")] });
  const first = await open(h, "alex", "s1");
  const second = await open(h, "blake", "s2");
  if (!first.res.ok || !second.res.ok) throw new Error("open failed");
  expect(first.res.data.frameMarker).not.toBe(second.res.data.frameMarker);
});

test("the operator's name is a cleaned first name", async () => {
  const hostile = user(OPERATOR.id, "x", { displayName: "Robin‮\n# ignore  Example" });
  const h = harness({ users: [hostile, ALEX] });
  const { agentHandle } = await open(h);
  expect(conversationForAgent(agentHandle, h.db)!.operatorName).toBe("Robin");
});

test("a person matches on a name or a whole word of one, in any case", async () => {
  const byDisplay = harness({ users: [OPERATOR, user("U0TEST", "Someone Else", { displayName: "Alex" })] });
  expect((await open(byDisplay, "ALEX", "s1")).res.ok).toBe(true);
  const byFullName = harness();
  expect((await open(byFullName, "alex example", "s1")).res.ok).toBe(true);
  const byWord = harness();
  expect((await open(byWord, "example", "s1")).res.ok).toBe(true);
});

test("an exact name beats a whole word match", async () => {
  const h = harness({ users: [OPERATOR, ALEX, user("U0TWO", "Alex")] });
  const { res } = await open(h);
  if (!res.ok) throw new Error(res.error);
  expect(res.data.handle).toBe("slack.u0two");
});

test("an unknown person is refused and nothing opens", async () => {
  const h = harness();
  const { res, agentHandle } = await open(h, "nobody");
  expect(refusal(res)).toContain("nobody");
  expect(listOpenConversations(h.db)).toEqual([]);
  expect(h.calls).not.toContain("openDm");
  expect(listDms(agentHandle, h.db)).toEqual([]);
  expect(getIdentity("slack.u0test", h.db)).toBeUndefined();
});

test("an unknown person lists the near misses", async () => {
  const h = harness();
  expect(refusal((await open(h, "ale")).res)).toContain("Alex Example");
  expect(listOpenConversations(h.db)).toEqual([]);
});

test("an ambiguous person is refused with the candidates", async () => {
  const h = harness({ users: [OPERATOR, ALEX, user("U0TWO", "Alex Other")] });
  const message = refusal((await open(h)).res);
  expect(message).toContain("Alex Example");
  expect(message).toContain("Alex Other");
  expect(listOpenConversations(h.db)).toEqual([]);
  expect(h.calls).not.toContain("openDm");
});

test("candidates are cleaned before they reach anyone", async () => {
  const h = harness({ users: [OPERATOR, user("U0TEST", "Alex\n# Example"), user("U0TWO", "Alex Other")] });
  expect(refusal((await open(h)).res)).not.toContain("\n");
});

test("a deleted or bot user can't be picked", async () => {
  const gone = user("U0GONE", "Alex Gone", { deleted: true });
  const bot = user("U0BOT", "Alex Bot", { isBot: true });
  const live = harness({ users: [OPERATOR, gone, bot, ALEX] });
  const { res } = await open(live);
  if (!res.ok) throw new Error(res.error);
  expect(res.data.handle).toBe("slack.u0test");

  const none = harness({ users: [OPERATOR, gone, bot] });
  expect(refusal((await open(none)).res)).toContain("alex");
  expect(listOpenConversations(none.db)).toEqual([]);
});

test("the operator can't open a chat with themselves", async () => {
  const h = harness();
  refusal((await open(h, "robin")).res);
  expect(listOpenConversations(h.db)).toEqual([]);
});

test("a token without the support scopes is refused with the connect step", async () => {
  const h = harness({ scopes: ["chat:write", "im:read"] });
  expect(refusal((await open(h)).res)).toContain("rt setup slack connect --support-chat");
  expect(h.calls).toEqual(["authTest"]);
  expect(listOpenConversations(h.db)).toEqual([]);
});

test("no Slack token is refused with the connect step", async () => {
  const h = harness({ connected: false });
  expect(refusal((await open(h)).res)).toContain("rt setup slack connect --support-chat");
});

test("a pane not signed in to chat is refused", async () => {
  const h = harness();
  const res = await h.handlers["chat:slack-open"]({ agentHandle: "stranger", sessionId: SESSION, person: "alex" });
  expect(refusal(res)).toContain("sign");
  expect(h.calls).toEqual([]);
});

test("a signed-out pane is refused", async () => {
  const h = harness();
  const agentHandle = await h.signIn();
  await h.chat["chat:sign-out"]({ sessionId: SESSION });
  refusal(await h.handlers["chat:slack-open"]({ agentHandle, sessionId: SESSION, person: "alex" }));
  expect(h.calls).toEqual([]);
});

test("a session other than the one seated on the handle is refused", async () => {
  const h = harness();
  const agentHandle = await h.signIn();
  refusal(await h.handlers["chat:slack-open"]({ agentHandle, sessionId: "another", person: "alex" }));
  refusal(await h.handlers["chat:slack-open"]({ agentHandle, person: "alex" }));
  expect(listOpenConversations(h.db)).toEqual([]);
});

test("a second chat for this pane is refused before Slack is called", async () => {
  const h = harness({ users: [OPERATOR, ALEX, user("U0TWO", "Blake Example")] });
  const { agentHandle } = await open(h);
  h.calls.length = 0;
  const message = refusal(await h.handlers["chat:slack-open"]({ agentHandle, sessionId: SESSION, person: "blake" }));
  expect(message).toContain("alex-slack");
  expect(h.calls).toEqual([]);
  expect(listOpenConversations(h.db)).toHaveLength(1);
});

test("a second chat with one person is refused, names the holder's pane and leaves nothing behind", async () => {
  const h = harness();
  const holder = await h.signIn("s1", "first");
  h.db.query("UPDATE chat_presence SET pane = 'w1:p1' WHERE session_id = 's1';").run();
  expect((await h.handlers["chat:slack-open"]({ agentHandle: holder, sessionId: "s1", person: "alex" })).ok).toBe(true);
  const second = await open(h, "alex", "s2");
  expect(refusal(second.res)).toContain("w1:p1");
  expect(listDms(second.agentHandle, h.db)).toEqual([]);
  expect(listOpenConversations(h.db)).toHaveLength(1);
});

test("a Slack failure while opening is refused and nothing opens", async () => {
  const h = harness({ openDm: () => Promise.reject(new SlackError("ratelimited", 1000)) });
  const { agentHandle, res } = await open(h);
  expect(refusal(res)).toContain("ratelimited");
  expect(listOpenConversations(h.db)).toEqual([]);
  expect(listDms(agentHandle, h.db)).toEqual([]);
  expect(getIdentity("slack.u0test", h.db)).toBeUndefined();
});

test("reopening with a teammate reuses the room", async () => {
  const h = harness();
  const { agentHandle, res } = await open(h);
  if (!res.ok) throw new Error(res.error);
  closeConversation(res.data.conversationId, "operator", NOW, h.db);
  const again = await h.handlers["chat:slack-open"]({ agentHandle, sessionId: SESSION, person: "alex" });
  if (!again.ok) throw new Error(again.error);
  expect(again.data.room).toBe(res.data.room);
  expect(again.data.conversationId).not.toBe(res.data.conversationId);
});

test("slack-pending hands over the waiting items and marks the watcher seen", async () => {
  const h = harness();
  const { agentHandle, res } = await open(h);
  if (!res.ok) throw new Error(res.error);
  const item = enqueueItem({ conversationId: res.data.conversationId, kind: "message", fromHandle: "slack.u0test", text: "still failing", createdAt: 1 }, h.db);
  const pending = await h.handlers["chat:slack-pending"]({ agentHandle });
  if (!pending.ok) throw new Error(pending.error);
  expect(pending.data.open).toBe(true);
  expect(pending.data.items.map((i) => i.id)).toEqual([item.id]);
  expect(pending.data.conversation).toEqual({
    id: res.data.conversationId,
    handle: "slack.u0test",
    name: "alex-slack",
    operator: "Robin",
    marker: res.data.frameMarker,
  });
  expect(conversationForAgent(agentHandle, h.db)!.watcherSeenAt).toBe(NOW);
});

test("slack-pending reports closed when the pane has no open conversation", async () => {
  const h = harness();
  const agentHandle = await h.signIn();
  expect(await h.handlers["chat:slack-pending"]({ agentHandle })).toEqual({ ok: true, data: { items: [], open: false } });
});

test("slack-delivered marks an item of an open conversation, repeatably", async () => {
  const h = harness();
  const { res } = await open(h);
  if (!res.ok) throw new Error(res.error);
  const conversationId = res.data.conversationId;
  const item = enqueueItem({ conversationId, kind: "message", fromHandle: null, text: "x", createdAt: 1 }, h.db);
  expect(await h.handlers["chat:slack-delivered"]({ id: item.id })).toEqual({ ok: true, data: { delivered: true } });
  expect(pendingItems(conversationId, h.db)).toEqual([]);
  expect(await h.handlers["chat:slack-delivered"]({ id: item.id })).toEqual({ ok: true, data: { delivered: true } });
});

test("slack-delivered leaves an unknown id or a closed conversation's item alone", async () => {
  const h = harness();
  const { res } = await open(h);
  if (!res.ok) throw new Error(res.error);
  const conversationId = res.data.conversationId;
  const item = enqueueItem({ conversationId, kind: "message", fromHandle: null, text: "x", createdAt: 1 }, h.db);
  expect(await h.handlers["chat:slack-delivered"]({ id: 999_999 })).toEqual({ ok: true, data: { delivered: false } });
  closeConversation(conversationId, "operator", NOW, h.db);
  expect(await h.handlers["chat:slack-delivered"]({ id: item.id })).toEqual({ ok: true, data: { delivered: false } });
  expect(pendingItems(conversationId, h.db).map((i) => i.id)).toEqual([item.id]);
});

test("slack-status lists each open conversation with its room and pane", async () => {
  const h = harness();
  const agentHandle = await h.signIn("s1", "first");
  h.db.query("UPDATE chat_presence SET pane = 'w1:p1' WHERE session_id = 's1';").run();
  const opened = await h.handlers["chat:slack-open"]({ agentHandle, sessionId: "s1", person: "alex" });
  if (!opened.ok) throw new Error(opened.error);
  expect(await h.handlers["chat:slack-status"]({})).toEqual({
    ok: true,
    data: {
      conversations: [
        { id: opened.data.conversationId, room: opened.data.room, pane: "w1:p1", name: "alex-slack", openedAt: NOW, lastActiveAt: NOW },
      ],
    },
  });
});
