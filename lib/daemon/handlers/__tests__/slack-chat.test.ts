/**
 * lib/daemon/handlers/__tests__/slack-chat.test.ts: opening, watching and confirming a Slack support chat.
 */
import { expect, test } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import type { Logger } from "pino";
import { SLACK_SUPPORT_SCOPES } from "../../../setup/slack-app.ts";
import { SlackError, type SlackClient, type SlackUser } from "../../../slack/client.ts";
import { SLACK_PREFIX, closingLine } from "../../../slack/format.ts";
import {
  closeConversation,
  conversationForAgent,
  enqueueItem,
  getIdentity,
  latestConversationForRoom,
  listDms,
  listMessages,
  listOpenConversations,
  markCloseAsked,
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
  return { id, name: realName.toLowerCase(), displayName: "", realName, title: "", deleted: false, isBot: false, ...over };
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
  const sent: string[] = [];
  const events: string[] = [];
  const notices: string[] = [];
  const client = {
    post: async (_channel: string, text: string) => {
      sent.push(text);
      return { ts: "1" };
    },
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
    emitEvent: (topic) => {
      events.push(topic);
      return 0;
    },
    log,
    slackClient: async () => (opts.connected === false ? null : client),
    notify: (title) => notices.push(title),
    now: () => NOW,
  });
  const chat = createChatHandlers({ db, emitEvent: () => 0, log });
  async function signIn(sessionId = SESSION, baseHandle = "support") {
    const res = await chat["chat:sign-in"]({ sessionId, baseHandle });
    if (!res.ok) throw new Error(res.error);
    return res.data.handle;
  }
  return { db, handlers, chat, signIn, calls, sent, events, notices };
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

test("the conversation keeps the shown name, cleaned, beside the identity name", async () => {
  const h = harness({ users: [OPERATOR, user("U0TEST", "Alex Example", { displayName: "Alex (he/him)" })] });
  const { res } = await open(h, "U0TEST");
  if (!res.ok) throw new Error(res.error);
  expect(listOpenConversations(h.db)[0]!.slackDisplayName).toBe("Alex he him");
  expect(res.data.name).toBe("alex-slack");
});

test("an exact Slack id opens that person, even when the shown name wouldn't match the raw one", async () => {
  const h = harness({ users: [OPERATOR, user("U0TEST", "Alex Example", { displayName: "Alex (he/him)" })] });
  const { res } = await open(h, "U0TEST");
  expect(res.ok).toBe(true);
  expect(listOpenConversations(h.db)[0]!.slackUserId).toBe("U0TEST");
});

test("two people with one name are each reachable by id", async () => {
  const users = [OPERATOR, user("U0ONE", "Alex Example"), user("U0TWO", "Alex Example")];
  for (const id of ["U0ONE", "U0TWO"]) {
    const h = harness({ users });
    const { res } = await open(h, id);
    expect(res.ok).toBe(true);
    expect(listOpenConversations(h.db)[0]!.slackUserId).toBe(id);
  }
});

test("an id wins over a person whose name is that text", async () => {
  const h = harness({ users: [OPERATOR, ALEX, user("U0NAME", "U0TEST")] });
  await open(h, "U0TEST");
  expect(listOpenConversations(h.db)[0]!.slackUserId).toBe("U0TEST");
});

test.each([
  ["a deleted user", "U0GONE"],
  ["a bot", "U0BOT"],
  ["the operator", OPERATOR.id],
])("%s's id is refused like any unknown person", async (_who, id) => {
  const users = [OPERATOR, ALEX, user("U0GONE", "Sam Gone", { deleted: true }), user("U0BOT", "Sam Bot", { isBot: true })];
  const h = harness({ users });
  const { res } = await open(h, id);
  expect(refusal(res)).toBe(`No one in this Slack workspace matches ${id}`);
  expect(listOpenConversations(h.db)).toEqual([]);
});

test("slack-people lists everyone an open can reach, sorted by shown name, and opens nothing", async () => {
  const users = [
    OPERATOR,
    user("U0ZED", "Zed Example"),
    user("U0GONE", "Sam Gone", { deleted: true }),
    user("U0BOT", "Sam Bot", { isBot: true }),
    user("U0ALEX", "Alex Example", { title: "Support lead" }),
  ];
  const h = harness({ users });
  expect(await h.handlers["chat:slack-people"]({})).toEqual({
    ok: true,
    data: {
      people: [
        { name: "Alex Example", person: "U0ALEX", title: "Support lead" },
        { name: "Zed Example", person: "U0ZED" },
      ],
    },
  });
  expect(h.calls).toEqual(["authTest", "listUsers"]);
  expect(listOpenConversations(h.db)).toEqual([]);
  expect(h.db.query("SELECT 1 FROM chat_dms;").all()).toEqual([]);
  expect(getIdentity("slack.u0alex", h.db)).toBeUndefined();
});

test("slack-people cleans the name and the title, and leaves out a title that cleans to nothing", async () => {
  const users = [OPERATOR, user("U0A", "Alex Example", { displayName: "Alex\n(he/him)", title: "Lead\u202e [ops]" }), user("U0B", "Sam Example", { title: "🎉" })];
  const res = await harness({ users }).handlers["chat:slack-people"]({});
  if (!res.ok) throw new Error(res.error);
  expect(res.data.people).toEqual([
    { name: "Alex he him", person: "U0A", title: "Lead ops" },
    { name: "Sam Example", person: "U0B" },
  ]);
});

test("a name or title cut across an astral letter stays well-formed, so one profile can't break the list", async () => {
  const astral = `A${"𝓐".repeat(30)}`;
  const users = [OPERATOR, user("U0A", "Alex Example", { displayName: astral, title: astral })];
  const res = await harness({ users }).handlers["chat:slack-people"]({});
  if (!res.ok) throw new Error(res.error);
  const [person] = res.data.people;
  expect(person!.name.isWellFormed()).toBe(true);
  expect(person!.title!.isWellFormed()).toBe(true);
  expect(Array.from(person!.name)).toHaveLength(31);
  expect(JSON.stringify(res.data.people)).not.toMatch(/\\ud[89ab]/i);
});

test("a stored display name cut across an astral letter stays well-formed", async () => {
  const h = harness({ users: [OPERATOR, user("U0TEST", "Alex", { displayName: `A${"𝓐".repeat(30)}` })] });
  await open(h, "U0TEST");
  expect(listOpenConversations(h.db)[0]!.slackDisplayName.isWellFormed()).toBe(true);
});

test("the cut keeps forty letters, however many units they take", async () => {
  const users = [OPERATOR, user("U0A", "x", { displayName: "𝓐".repeat(50) })];
  const res = await harness({ users }).handlers["chat:slack-people"]({});
  if (!res.ok) throw new Error(res.error);
  expect(Array.from(res.data.people[0]!.name)).toHaveLength(40);
});

test("Slackbot, which Slack doesn't flag as a bot, is neither listed nor opened", async () => {
  const slackbot = user("USLACKBOT", "Slackbot");
  const listed = await harness({ users: [OPERATOR, ALEX, slackbot] }).handlers["chat:slack-people"]({});
  if (!listed.ok) throw new Error(listed.error);
  expect(listed.data.people.map((p) => p.person)).toEqual(["U0TEST"]);
  for (const person of ["USLACKBOT", "Slackbot"]) {
    const h = harness({ users: [OPERATOR, ALEX, slackbot] });
    const { res } = await open(h, person);
    expect(res.ok).toBe(false);
    expect(listOpenConversations(h.db)).toEqual([]);
  }
});

test("a teammate named after a deleted user's id doesn't get that user's chat", async () => {
  const users = [OPERATOR, user("U0GONE", "Sam Gone", { deleted: true }), user("U0TEST", "Alex Example", { displayName: "U0GONE" })];
  const h = harness({ users });
  const { res } = await open(h, "U0GONE");
  expect(refusal(res)).toBe("No one in this Slack workspace matches U0GONE");
  expect(listOpenConversations(h.db)).toEqual([]);
  expect(h.calls).not.toContain("openDm");
});

test("a teammate can't take Slackbot's id as a name", async () => {
  const users = [OPERATOR, user("USLACKBOT", "Slackbot"), user("U0TEST", "Alex Example", { displayName: "USLACKBOT" })];
  const { res } = await open(harness({ users }), "USLACKBOT");
  expect(refusal(res)).toBe("No one in this Slack workspace matches USLACKBOT");
});

test("a capitalised name that isn't shaped like an id still matches by name", async () => {
  const h = harness({ users: [OPERATOR, user("U0WILL", "Will Example")] });
  await open(h, "WILL");
  expect(listOpenConversations(h.db)[0]!.slackUserId).toBe("U0WILL");
});

test("every id slack-people lists opens that person", async () => {
  const users = [OPERATOR, user("U0ONE", "Alex Example"), user("U0TWO", "Alex Example"), user("U0THREE", "Sam (he/him)")];
  const listed = await harness({ users }).handlers["chat:slack-people"]({});
  if (!listed.ok) throw new Error(listed.error);
  expect(listed.data.people).toHaveLength(3);
  for (const { person } of listed.data.people) {
    const h = harness({ users });
    await open(h, person);
    expect(listOpenConversations(h.db)[0]!.slackUserId).toBe(person);
  }
});

test("slack-people is refused with the connect step when Slack isn't connected or lacks the scopes", async () => {
  for (const options of [{ connected: false }, { scopes: ["chat:write"] }]) {
    const message = refusal(await harness(options).handlers["chat:slack-people"]({}));
    expect(message).toContain("rt setup slack connect --support-chat");
  }
});

test("a Slack failure in slack-people is refused and names the code", async () => {
  const failing = createSlackChatHandlers({
    db: harness().db,
    emitEvent: () => 0,
    log,
    slackClient: async () => ({ authTest: async () => { throw new SlackError("ratelimited"); } }) as unknown as SlackClient,
  });
  expect(refusal(await failing["chat:slack-people"]({}))).toBe("Slack did not answer (ratelimited)");
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

test("the pane's close with a farewell closes at once and shows in the room", async () => {
  const h = harness();
  const { agentHandle, res } = await open(h);
  if (!res.ok) throw new Error(res.error);
  const closed = await h.handlers["chat:slack-close"]({ agentHandle, sessionId: SESSION, farewell: "All sorted." });
  expect(closed).toEqual({ ok: true, data: { conversationId: res.data.conversationId, closed: true } });
  expect(h.sent).toEqual([`${SLACK_PREFIX}All sorted.`, closingLine("Robin", false)]);
  expect(listMessages({ room: res.data.room, limit: 10 }, h.db).map((m) => m.body)).toEqual(["All sorted.", closingLine("Robin", false).slice(SLACK_PREFIX.length)]);
  expect(h.events).toEqual([`chat/${res.data.room}/msg`, `chat/${res.data.room}/msg`]);
  expect(conversationForAgent(agentHandle, h.db)).toBeUndefined();
});

test("the pane's close refuses a session that is not seated on the handle, and the chat stays open", async () => {
  const h = harness();
  const { agentHandle, res } = await open(h);
  if (!res.ok) throw new Error(res.error);
  const message = "Only the session signed in as this pane can close its Slack chat, so sign in and try again";
  expect(refusal(await h.handlers["chat:slack-close"]({ agentHandle, farewell: "Bye." }))).toBe(message);
  expect(refusal(await h.handlers["chat:slack-close"]({ agentHandle, sessionId: "another", farewell: "Bye." }))).toBe(message);
  expect(conversationForAgent(agentHandle, h.db)).toBeDefined();
  expect(h.sent).toEqual([]);
});

test("the pane's close reports a farewell that had a credential removed", async () => {
  const h = harness();
  const { agentHandle, res } = await open(h);
  if (!res.ok) throw new Error(res.error);
  const closed = await h.handlers["chat:slack-close"]({ agentHandle, sessionId: SESSION, farewell: "Use AKIAABCDEFGHIJKLMNOP to retry." });
  expect(closed).toEqual({ ok: true, data: { conversationId: res.data.conversationId, closed: true, redacted: true } });
  expect(h.sent[0]).not.toContain("AKIAABCDEFGHIJKLMNOP");
});

test("a close by pane can't carry a farewell, so a caller with only a pane id can't speak to the teammate", async () => {
  const h = harness();
  const agentHandle = await h.signIn("s1", "first");
  h.db.query("UPDATE chat_presence SET pane = 'w1:p1' WHERE session_id = 's1';").run();
  const res = await h.handlers["chat:slack-open"]({ agentHandle, sessionId: "s1", person: "alex" });
  if (!res.ok) throw new Error(res.error);
  const closed = await h.handlers["chat:slack-close"]({ pane: "w1:p1", farewell: "Robin here, all done." });
  expect(refusal(closed)).toContain("can't carry a farewell");
  expect(h.sent).toEqual([]);
  expect(latestConversationForRoom(res.data.room, h.db)!.closedAt).toBeNull();
  expect(latestConversationForRoom(res.data.room, h.db)!.closeAskedAt).toBeNull();
});

test("a pane's close during a close sequence keeps the reason asked for", async () => {
  const h = harness();
  const { agentHandle, res } = await open(h);
  if (!res.ok) throw new Error(res.error);
  markCloseAsked(res.data.conversationId, "idle", NOW, h.db);
  await h.handlers["chat:slack-close"]({ agentHandle, sessionId: SESSION, farewell: "Closing as it went quiet." });
  expect(latestConversationForRoom(res.data.room, h.db)!.closeReason).toBe("idle");
});

test("a close with nothing open is refused and sends nothing", async () => {
  const h = harness();
  const agentHandle = await h.signIn();
  expect(refusal(await h.handlers["chat:slack-close"]({ agentHandle, sessionId: SESSION }))).toBe("This pane has no Slack chat open");
  expect(refusal(await h.handlers["chat:slack-close"]({ pane: "w9:p9" }))).toBe("No Slack chat is open in w9:p9");
  expect(refusal(await h.handlers["chat:slack-close"]({}))).toBe("This pane has no Slack chat open");
  expect(h.sent).toEqual([]);
});

test("an oversized farewell is refused and the chat stays open", async () => {
  const h = harness();
  const { agentHandle, res } = await open(h);
  if (!res.ok) throw new Error(res.error);
  const closed = await h.handlers["chat:slack-close"]({ agentHandle, sessionId: SESSION, farewell: "x".repeat(70_000) });
  expect(closed.ok).toBe(false);
  expect(conversationForAgent(agentHandle, h.db)).toBeDefined();
  expect(h.sent).toEqual([]);
});

test("slack-pending still hands over the closed item, then reports closed once it is delivered", async () => {
  const h = harness();
  const { agentHandle, res } = await open(h);
  if (!res.ok) throw new Error(res.error);
  await h.handlers["chat:slack-close"]({ agentHandle, sessionId: SESSION, farewell: "Bye." });
  const pending = await h.handlers["chat:slack-pending"]({ agentHandle });
  if (!pending.ok) throw new Error(pending.error);
  expect(pending.data.open).toBe(true);
  expect(pending.data.items.map((i) => i.kind)).toEqual(["closed"]);
  expect(pending.data.conversation?.id).toBe(res.data.conversationId);
  expect(await h.handlers["chat:slack-delivered"]({ id: pending.data.items[0]!.id })).toEqual({ ok: true, data: { delivered: true } });
  expect(await h.handlers["chat:slack-pending"]({ agentHandle })).toEqual({ ok: true, data: { items: [], open: false } });
});

test("slack-pending drops a closed conversation's other items", async () => {
  const h = harness();
  const { agentHandle, res } = await open(h);
  if (!res.ok) throw new Error(res.error);
  enqueueItem({ conversationId: res.data.conversationId, kind: "message", fromHandle: null, text: "late", createdAt: 1 }, h.db);
  await h.handlers["chat:slack-close"]({ agentHandle, sessionId: SESSION, farewell: "Bye." });
  const pending = await h.handlers["chat:slack-pending"]({ agentHandle });
  if (!pending.ok) throw new Error(pending.error);
  expect(pending.data.items.map((i) => i.kind)).toEqual(["closed"]);
});

test("a new chat's watcher still counts as seen while an old closed item is owed", async () => {
  const h = harness();
  const { agentHandle, res } = await open(h);
  if (!res.ok) throw new Error(res.error);
  await h.handlers["chat:slack-close"]({ agentHandle, sessionId: SESSION, farewell: "Bye." });
  const reopened = await h.handlers["chat:slack-open"]({ agentHandle, sessionId: SESSION, person: "alex" });
  if (!reopened.ok) throw new Error(reopened.error);
  const pending = await h.handlers["chat:slack-pending"]({ agentHandle });
  if (!pending.ok) throw new Error(pending.error);
  expect(pending.data.conversation?.id).toBe(res.data.conversationId);
  expect(conversationForAgent(agentHandle, h.db)!.watcherSeenAt).toBe(NOW);
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
        {
          id: opened.data.conversationId,
          room: opened.data.room,
          handle: opened.data.handle,
          pane: "w1:p1",
          name: "alex-slack",
          agentName: "first",
          displayName: "Alex Example",
          openedAt: NOW,
          lastActiveAt: NOW,
        },
      ],
      closed: [],
    },
  });
});

test("slack-status answers at once and names the teammate's picture on the next read", async () => {
  const h = harness({ users: [OPERATOR, { ...ALEX, avatar: "https://avatars.slack-edge.com/alex.png" }] });
  const { res } = await open(h);
  if (!res.ok) throw new Error(res.error);
  const before = await h.handlers["chat:slack-status"]({});
  expect(before.ok && before.data.conversations[0]?.avatarId).toBeUndefined();
  await Bun.sleep(0);
  const after = await h.handlers["chat:slack-status"]({});
  expect(after.ok && after.data.conversations[0]?.avatarId).toBe(ALEX.id);
});
