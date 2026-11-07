/**
 * lib/daemon/__tests__/slack-bridge.test.ts: the inbound Slack sweep, against a fake client and a scratch state db.
 */
import { expect, test } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import type { Logger } from "pino";
import { SlackError, type SlackClient, type SlackMessage } from "../../slack/client.ts";
import { openStateDb } from "../../state/db.ts";
import type { GateRow } from "../../../packages/rt-client/src/commands.ts";
import { answerSlackOpen, closeResumeGates, slackOpenMarker, type SlackOpenDeps } from "../../slack/request.ts";
import { offerResume, type ResumeOfferDeps } from "../../slack/resume.ts";
import { closeConversation, conversationById, conversationForRoom, expireOtherGrace, openConversation, pendingItems, startGrace } from "../../state/slack-conversation-store.ts";
import type { SlackPersona } from "../../slack/persona.ts";
import { createSlackBridge, tsBefore } from "../slack-bridge.ts";

const log = { warn: () => {}, debug: () => {} } as unknown as Logger;
const OPENED_AT_MS = 1_000_000_000_000;
const OPENED = "1000000000.000000";
const CURSOR = "1000000000.000100";
let n = 0;

const conv = {
  room: "dm-aaa",
  agentHandle: "pane.one",
  slackHandle: "slack.u0test",
  slackUserId: "U0TEST",
  slackChannel: "D0TEST",
  slackDisplayName: "Alex Example",
  operatorUserId: "U0OPER",
  operatorName: "Operator",
  frameMarker: "marker1",
  lastReadTs: CURSOR,
  openedAt: OPENED_AT_MS,
};

function msg(ts: string, user: string, text: string, extra: Partial<SlackMessage> = {}): SlackMessage {
  return { ts, user, text, ...extra };
}

const ts = (s: number, micro = 0) => `${1_000_000_000 + s}.${String(micro).padStart(6, "0")}`;

function harness(opts: { history?: SlackMessage[]; replies?: Record<string, SlackMessage[]>; operatorHandle?: string; withClient?: boolean; persona?: SlackPersona } = {}) {
  const db = openStateDb(join(tmpdir(), `slack-bridge-${process.pid}-${n++}-${Date.now()}.db`));
  const opened = openConversation(conv, db);
  const state = { history: opts.history ?? [], replies: opts.replies ?? {}, clock: OPENED_AT_MS + 60_000 };
  const calls: string[] = [];
  const historyOldest: string[] = [];
  const posts: { room: string; handle: string; body: string }[] = [];
  const failures: { history?: unknown; post?: boolean; replies?: unknown } = {};
  const warns: unknown[] = [];
  const spyLog = { warn: (...a: unknown[]) => warns.push(a), debug: () => {} } as unknown as Logger;
  const above = (m: SlackMessage, oldest: string) => Number(m.ts) > Number(oldest);
  const client = {
    history: async (_channel: string, oldest: string) => {
      calls.push("history");
      historyOldest.push(oldest);
      if (failures.history) throw failures.history;
      return state.history.filter((m) => above(m, oldest));
    },
    replies: async (_channel: string, parent: string, oldest: string) => {
      calls.push(`replies:${parent}`);
      if (failures.replies) throw failures.replies;
      return (state.replies[parent] ?? []).filter((m) => m.ts === parent || above(m, oldest));
    },
  } as unknown as SlackClient;
  let id = 100;
  const bridge = createSlackBridge({
    db,
    client: async () => (opts.withClient === false ? null : client),
    post: (args) => {
      if (failures.post) return undefined;
      posts.push({ room: args.room, handle: args.handle, body: args.body });
      return { id: id++ };
    },
    operatorHandle: () => opts.operatorHandle ?? "operator",
    log: spyLog,
    now: () => state.clock,
    persona: opts.persona ? () => opts.persona! : undefined,
  });
  const reread = () => conversationForRoom(conv.room, db)!;
  return { db, opened, bridge, state, calls, historyOldest, posts, failures, warns, reread, items: () => pendingItems(opened.id, db) };
}

test("reads only messages after the cursor", async () => {
  const h = harness({ history: [msg("1000000000.000050", "U0TEST", "stale"), msg(ts(10), "U0TEST", "after")] });
  await h.bridge.sweep();
  expect(h.posts.map((p) => p.body)).toEqual(["after"]);
  expect(h.historyOldest).toEqual([OPENED]);
});

test("one tick makes exactly one history call", async () => {
  const parent = msg(ts(5), "U0TEST", "first", { replyCount: 1, latestReply: ts(8) });
  const h = harness({ history: [parent, msg(ts(10), "U0TEST", "hello")], replies: { [ts(5)]: [parent, msg(ts(8), "U0TEST", "reply")] } });
  await h.bridge.sweep();
  expect(h.calls.filter((c) => c === "history")).toHaveLength(1);
  await h.bridge.sweep();
  expect(h.calls.filter((c) => c === "history")).toHaveLength(2);
});

test("never reads anything before the conversation opened", async () => {
  const h = harness({
    history: [msg(ts(-100), "U0TEST", "old parent", { replyCount: 1, latestReply: ts(-50) })],
    replies: { [ts(-100)]: [msg(ts(-100), "U0TEST", "old parent"), msg(ts(-50), "U0TEST", "old reply")] },
  });
  await h.bridge.sweep();
  expect(h.posts).toEqual([]);
  expect(h.calls.filter((c) => c.startsWith("replies"))).toEqual([]);
  expect(h.historyOldest).toEqual([OPENED]);
});

test("a teammate message becomes a chat post and a queued message item", async () => {
  const h = harness({ history: [msg(ts(10), "U0TEST", "it is broken")] });
  await h.bridge.sweep();
  expect(h.posts).toEqual([{ room: "dm-aaa", handle: "slack.u0test", body: "it is broken" }]);
  const [item] = h.items();
  expect(item).toMatchObject({ kind: "message", fromHandle: "slack.u0test", text: "it is broken" });
  expect(h.reread().lastReadTs).toBe(ts(10));
  expect(h.reread().lastActiveAt).toBe(h.state.clock);
});

test("the pane's own prefixed message does not touch the conversation", async () => {
  const h = harness({ history: [msg(ts(10), "U0OPER", "[Claude 🤖]: on it")] });
  await h.bridge.sweep();
  expect(h.reread().lastActiveAt).toBe(OPENED_AT_MS);
});

test("the operator's unprefixed Slack message becomes an operator-slack item", async () => {
  const h = harness({ history: [msg(ts(10), "U0OPER", "try the other branch")] });
  await h.bridge.sweep();
  expect(h.posts).toEqual([{ room: "dm-aaa", handle: "operator", body: "try the other branch" }]);
  expect(h.items()[0]).toMatchObject({ kind: "operator-slack", fromHandle: "operator", text: "try the other branch" });
});

test("the operator's Slack message resets the idle timer", async () => {
  const h = harness({ history: [msg(ts(10), "U0OPER", "steering from Slack")] });
  h.db.query("UPDATE slack_conversations SET checked_in_at = 5 WHERE id = ?").run(h.opened.id);
  await h.bridge.sweep();
  expect(h.reread().lastActiveAt).toBe(h.state.clock);
  expect(h.reread().checkedInAt).toBeNull();
});

test("the operator's account skips a prefixed message in both forms", async () => {
  const h = harness({
    history: [msg(ts(10), "U0OPER", "[Claude 🤖]: hello"), msg(ts(11), "U0OPER", "[Claude :robot_face:]: hello again")],
  });
  await h.bridge.sweep();
  expect(h.posts).toEqual([]);
  expect(h.items()).toEqual([]);
  expect(h.reread().lastReadTs).toBe(ts(11));
});

test("a teammate pasting a Claude line back still reaches the pane", async () => {
  const h = harness({ history: [msg(ts(10), "U0TEST", "[Claude 🤖]: restart the daemon. Which daemon?")] });
  await h.bridge.sweep();
  expect(h.posts.map((p) => p.body)).toEqual(["[Claude 🤖]: restart the daemon. Which daemon?"]);
  expect(h.items()[0]).toMatchObject({ kind: "message", text: "[Claude 🤖]: restart the daemon. Which daemon?" });
});

test("a message from a third user is ignored", async () => {
  const h = harness({ history: [msg(ts(10), "U0OTHER", "hi")] });
  await h.bridge.sweep();
  expect(h.posts).toEqual([]);
  expect(h.reread().lastReadTs).toBe(ts(10));
});

test("a thread reply under a message older than the cursor is delivered once", async () => {
  const parent = msg(ts(5), "U0TEST", "first", { replyCount: 1, latestReply: ts(30) });
  const h = harness({
    history: [parent],
    replies: { [ts(5)]: [parent, msg(ts(30), "U0TEST", "in the thread")] },
  });
  h.db.query("UPDATE slack_conversations SET last_read_ts = ? WHERE id = ?").run(ts(20), h.opened.id);
  await h.bridge.sweep();
  await h.bridge.sweep();
  expect(h.posts.map((p) => p.body)).toEqual(["in the thread"]);
  expect(h.reread().threadReadTs).toEqual({ [ts(5)]: ts(30) });
  expect(h.calls.filter((c) => c.startsWith("replies"))).toHaveLength(1);
});

test("the parent is not delivered a second time when it comes back with its replies", async () => {
  const parent = msg(ts(10), "U0TEST", "parent", { replyCount: 1, latestReply: ts(20) });
  const h = harness({ history: [parent], replies: { [ts(10)]: [parent, msg(ts(20), "U0TEST", "child")] } });
  await h.bridge.sweep();
  expect(h.posts.map((p) => p.body)).toEqual(["parent", "child"]);
});

test("a thread broadcast reply is delivered once", async () => {
  const parent = msg(ts(5), "U0TEST", "first", { replyCount: 1, latestReply: ts(30) });
  const broadcast = msg(ts(30), "U0TEST", "also to the channel", { subtype: "thread_broadcast" });
  const h = harness({ history: [parent, broadcast], replies: { [ts(5)]: [parent, broadcast] } });
  h.db.query("UPDATE slack_conversations SET last_read_ts = ? WHERE id = ?").run(ts(20), h.opened.id);
  await h.bridge.sweep();
  expect(h.posts.map((p) => p.body)).toEqual(["also to the channel"]);
});

test("Slack's entities are decoded in what reaches the room and the pane", async () => {
  const h = harness({ history: [msg(ts(10), "U0TEST", "it returns Promise&lt;void&gt; with 2&gt;&amp;1")] });
  await h.bridge.sweep();
  expect(h.posts[0]!.body).toBe("it returns Promise<void> with 2>&1");
  expect(h.items()[0]!.text).toBe("it returns Promise<void> with 2>&1");
});

test("the pane's own message with escaped text is still skipped", async () => {
  const h = harness({ history: [msg(ts(10), "U0OPER", "[Claude 🤖]: run it with 2&gt;&amp;1")] });
  await h.bridge.sweep();
  expect(h.posts).toEqual([]);
  expect(h.items()).toEqual([]);
});

test("an attachment adds a note naming the file", async () => {
  const h = harness({
    history: [msg(ts(10), "U0TEST", "see this", { subtype: "file_share", files: [{ name: "error.png" }] })],
  });
  await h.bridge.sweep();
  expect(h.posts[0]!.body).toBe("see this\n[sent a file: error.png]");
  expect(h.items()[0]!.text).toBe("see this\n[sent a file: error.png]");
});

test("a forwarded message with empty text carries its attachment text in a note", async () => {
  const h = harness({ history: [msg(ts(10), "U0TEST", "", { attachments: [{ text: "deploy failed on a &lt; b" }] })] });
  await h.bridge.sweep();
  expect(h.posts[0]!.body).toBe("[attached: deploy failed on a < b]");
  expect(h.items()[0]).toMatchObject({ kind: "message", text: "[attached: deploy failed on a < b]" });
});

test("a message with text and attachments keeps both", async () => {
  const h = harness({ history: [msg(ts(10), "U0TEST", "see below", { attachments: [{ text: "first" }, { text: "second" }] })] });
  await h.bridge.sweep();
  expect(h.posts[0]!.body).toBe("see below\n[attached: first]\n[attached: second]");
});

test.each([
  ["an empty message", {}],
  ["an attachment with no text", { attachments: [{ text: "" }] }],
])("%s from the teammate still reaches the pane as a note", async (_name, extra) => {
  const h = harness({ history: [msg(ts(10), "U0TEST", "", extra)] });
  await h.bridge.sweep();
  expect(h.items()[0]).toMatchObject({ kind: "message", text: "[sent something with no readable text]" });
  expect(h.reread().lastActiveAt).toBe(h.state.clock);
});

test("a failed history call keeps the cursor and retries next tick", async () => {
  const h = harness({ history: [msg(ts(10), "U0TEST", "hello")] });
  h.failures.history = new SlackError("network_error");
  await h.bridge.sweep();
  expect(h.posts).toEqual([]);
  expect(h.reread().lastReadTs).toBe(CURSOR);
  h.failures.history = undefined;
  await h.bridge.sweep();
  expect(h.posts.map((p) => p.body)).toEqual(["hello"]);
});

test("a failed room post keeps the cursor and loses nothing", async () => {
  const h = harness({ history: [msg(ts(10), "U0TEST", "one"), msg(ts(11), "U0TEST", "two")] });
  h.failures.post = true;
  await h.bridge.sweep();
  expect(h.reread().lastReadTs).toBe(CURSOR);
  expect(h.items()).toEqual([]);
  h.failures.post = false;
  await h.bridge.sweep();
  expect(h.posts.map((p) => p.body)).toEqual(["one", "two"]);
});

test("a rate limit waits out Retry-After", async () => {
  const h = harness({ history: [msg(ts(10), "U0TEST", "hello")] });
  h.failures.history = new SlackError("ratelimited", 30_000);
  await h.bridge.sweep();
  expect(h.calls).toEqual(["history"]);
  h.failures.history = undefined;
  h.state.clock += 10_000;
  await h.bridge.sweep();
  expect(h.calls).toEqual(["history"]);
  h.state.clock += 21_000;
  await h.bridge.sweep();
  expect(h.posts.map((p) => p.body)).toEqual(["hello"]);
});

test("a rate limit on one conversation holds every conversation", async () => {
  const h = harness({ history: [msg(ts(10), "U0TEST", "hello")] });
  openConversation(
    { ...conv, room: "dm-bbb", slackUserId: "U0TWO", slackHandle: "slack.u0two", slackChannel: "D0TWO", agentHandle: "pane.two" },
    h.db,
  );
  h.failures.history = new SlackError("ratelimited", 30_000);
  await h.bridge.sweep();
  expect(h.calls).toEqual(["history"]);
  h.failures.history = undefined;
  h.state.clock += 29_000;
  await h.bridge.sweep();
  expect(h.calls).toEqual(["history"]);
  expect(h.reread().lastReadTs).toBe(CURSOR);
  h.state.clock += 2_000;
  await h.bridge.sweep();
  expect(h.posts.map((p) => p.body)).toEqual(["hello"]);
});

test("a failure on one conversation does not stop the others", async () => {
  const h = harness({ history: [msg(ts(10), "U0TEST", "hello")] });
  const second = openConversation(
    { ...conv, room: "dm-bbb", slackUserId: "U0TWO", slackHandle: "slack.u0two", slackChannel: "D0TWO", agentHandle: "pane.two" },
    h.db,
  );
  const bridge = createSlackBridge({
    db: h.db,
    client: async () =>
      ({
        history: async (channel: string) => {
          if (channel === "D0TEST") throw new SlackError("channel_not_found");
          return [msg(ts(10), "U0TWO", "from two")];
        },
        replies: async () => [],
      }) as unknown as SlackClient,
    post: (args) => {
      h.posts.push(args);
      return { id: 1 };
    },
    log,
    now: () => h.state.clock,
  });
  await bridge.sweep();
  expect(h.posts.map((p) => p.body)).toEqual(["from two"]);
  expect(pendingItems(second.id, h.db)).toHaveLength(1);
});

test("a thread that cannot be read does not hold up the rest, and keeps its cursor", async () => {
  const bad = msg(ts(5), "U0TEST", "first", { replyCount: 1, latestReply: ts(8) });
  const h = harness({ history: [bad, msg(ts(10), "U0TEST", "fine")] });
  h.failures.replies = new SlackError("network_error");
  await h.bridge.sweep();
  expect(h.posts.map((p) => p.body)).toEqual(["first", "fine"]);
  expect(h.reread().threadReadTs).toEqual({});
});

test("a thread reply is delivered once after a transient read failure", async () => {
  const parent = msg(ts(5), "U0TEST", "first", { replyCount: 1, latestReply: ts(30) });
  const h = harness({ history: [parent], replies: { [ts(5)]: [parent, msg(ts(30), "U0TEST", "in the thread")] } });
  h.db.query("UPDATE slack_conversations SET last_read_ts = ? WHERE id = ?").run(ts(20), h.opened.id);
  for (const code of ["network_error", "timeout", "http_502"]) {
    h.failures.replies = new SlackError(code);
    await h.bridge.sweep();
    expect(h.posts).toEqual([]);
    expect(h.reread().threadReadTs).toEqual({});
  }
  h.failures.replies = undefined;
  await h.bridge.sweep();
  await h.bridge.sweep();
  expect(h.posts.map((p) => p.body)).toEqual(["in the thread"]);
  expect(h.reread().threadReadTs).toEqual({ [ts(5)]: ts(30) });
});

test("a thread Slack reports as gone stops being fetched", async () => {
  const parent = msg(ts(5), "U0TEST", "first", { replyCount: 1, latestReply: ts(30) });
  const h = harness({ history: [parent] });
  h.db.query("UPDATE slack_conversations SET last_read_ts = ? WHERE id = ?").run(ts(20), h.opened.id);
  h.failures.replies = new SlackError("thread_not_found");
  await h.bridge.sweep();
  await h.bridge.sweep();
  expect(h.calls.filter((c) => c.startsWith("replies"))).toHaveLength(1);
  expect(h.reread().threadReadTs).toEqual({ [ts(5)]: ts(30) });
});

test("a thread read that keeps failing warns once, not every tick", async () => {
  const parent = msg(ts(5), "U0TEST", "first", { replyCount: 1, latestReply: ts(30) });
  const h = harness({ history: [parent] });
  h.db.query("UPDATE slack_conversations SET last_read_ts = ? WHERE id = ?").run(ts(20), h.opened.id);
  h.failures.replies = new SlackError("timeout");
  await h.bridge.sweep();
  await h.bridge.sweep();
  await h.bridge.sweep();
  expect(h.warns).toHaveLength(1);
});

test("no Slack call is made with no open conversation", async () => {
  const h = harness({ history: [msg(ts(10), "U0TEST", "hello")] });
  closeConversation(h.opened.id, "idle", 5, h.db);
  let resolved = 0;
  const bridge = createSlackBridge({
    db: h.db,
    client: async () => {
      resolved++;
      return null;
    },
    post: () => undefined,
    log,
  });
  await bridge.sweep();
  expect(resolved).toBe(0);
  expect(h.calls).toEqual([]);
});

test("a machine with no Slack token does nothing", async () => {
  const h = harness({ history: [msg(ts(10), "U0TEST", "hello")], withClient: false });
  await h.bridge.sweep();
  expect(h.posts).toEqual([]);
});

test("restart resumes from the stored cursor", async () => {
  const h = harness({ history: [msg(ts(10), "U0TEST", "one"), msg(ts(20), "U0TEST", "two")] });
  await h.bridge.sweep();
  expect(h.posts).toHaveLength(2);
  const oldest: string[] = [];
  const restarted = createSlackBridge({
    db: h.db,
    client: async () =>
      ({
        history: async (_c: string, from: string) => {
          oldest.push(from);
          return h.state.history.filter((m) => Number(m.ts) > Number(from));
        },
        replies: async () => [],
      }) as unknown as SlackClient,
    post: (args) => {
      h.posts.push(args);
      return { id: 9 };
    },
    log,
  });
  await restarted.sweep();
  expect(h.posts).toHaveLength(2);
  expect(oldest).toEqual([OPENED]);
});

test("sweeps never overlap", async () => {
  const h = harness({ history: [msg(ts(10), "U0TEST", "hello")] });
  await Promise.all([h.bridge.sweep(), h.bridge.sweep()]);
  expect(h.posts).toHaveLength(1);
});

test("an operator message with no chat handle is queued without a room post", async () => {
  const h = harness({ history: [msg(ts(10), "U0OPER", "note")] });
  const bridge = createSlackBridge({
    db: h.db,
    client: async () => ({ history: async () => [msg(ts(10), "U0OPER", "note")], replies: async () => [] }) as unknown as SlackClient,
    post: (args) => {
      h.posts.push(args);
      return { id: 1 };
    },
    log,
  });
  await bridge.sweep();
  expect(h.posts).toEqual([]);
  expect(h.items()[0]).toMatchObject({ kind: "operator-slack", fromHandle: null });
});

const CLOSED_AT_MS = OPENED_AT_MS + 30_000;
const GRACE_MS = 3_600_000;

function graceHarness(opts: { history?: SlackMessage[]; assignedPane?: string | null; persona?: SlackPersona } = {}) {
  const db = openStateDb(join(tmpdir(), `slack-grace-${process.pid}-${n++}-${Date.now()}.db`));
  const opened = openConversation({ ...conv, assignedPane: opts.assignedPane === undefined ? "bg:w1:p9" : opts.assignedPane }, db);
  closeConversation(opened.id, "idle", CLOSED_AT_MS, db);
  startGrace(opened.id, CLOSED_AT_MS + GRACE_MS, db);
  const state = { history: opts.history ?? [], clock: CLOSED_AT_MS + 60_000 };
  const reads: string[] = [];
  const posts: unknown[] = [];
  const panes: Array<string | null> = [];
  const milestones: string[] = [];
  const contexts: string[] = [];
  const gates: GateRow[] = [];
  const closedGates: string[] = [];
  const failures = { open: false };
  const warns: unknown[] = [];
  const spyLog = { warn: (...a: unknown[]) => warns.push(a), debug: () => {} } as unknown as Logger;
  const openedGates: Array<{ id: string; subject: string; kind: string; questions: Array<{ label: string }>; context: string; meta: unknown }> = [];
  const deps = {
    log,
    milestones: {
      isOnline: () => false,
      postDm: async () => {},
      desk: async (body: string) => void milestones.push(body),
    },
    gates: {
      open: async (input: (typeof openedGates)[number]) => {
        if (failures.open) return { ok: false as const, error: "gate store unavailable" };
        openedGates.push(input);
        gates.push({ id: input.id, subject: input.subject, kind: input.kind, meta: input.meta } as unknown as GateRow);
        return { ok: true as const, id: input.id };
      },
      close: async (id: string) => {
        closedGates.push(id);
        gates.splice(0, gates.length, ...gates.filter((g) => g.id !== id));
      },
      listOpen: () => gates,
      appendContext: (_id: string, text: string) => void contexts.push(text),
    },
  };
  const client = {
    history: async (_c: string, oldest: string) => {
      reads.push(oldest);
      return state.history.filter((m) => Number(m.ts) > Number(oldest));
    },
  } as unknown as SlackClient;
  const bridge = createSlackBridge({
    db,
    client: async () => client,
    post: (args) => {
      posts.push(args);
      return { id: 1 };
    },
    log: spyLog,
    now: () => state.clock,
    persona: opts.persona ? () => opts.persona! : undefined,
    grace: {
      offer: (c, text, triggerTs) => offerResume(deps as unknown as ResumeOfferDeps, c, text, triggerTs),
      closeResume: (c) => closeResumeGates({ gates: deps.gates, log } as unknown as SlackOpenDeps, c.id),
      closePane: async (pane) => void panes.push(pane),
    },
  });
  const row = () => conversationById(opened.id, db)!;
  const openDeps = {
    db,
    log,
    gates: deps.gates,
    closePane: async (pane: string | null) => void panes.push(pane),
  } as unknown as SlackOpenDeps;
  return { db, opened, bridge, state, reads, posts, panes, milestones, contexts, openedGates, closedGates, failures, warns, gates, row, openDeps };
}

const resumeAnswer = (h: ReturnType<typeof graceHarness>, decision: string) =>
  ({
    id: "g1",
    subject: "slack:U0TEST",
    kind: "slack-open",
    meta: { action: "resume", conversation: h.opened.id, person: "U0TEST", personName: "Alex Example", requesterSession: null, requesterHandle: null, triggerTs: ts(40) },
    answer: { answers: { decision }, by: "console", answeredAt: 1 },
  }) as unknown as GateRow;

test("a graced conversation's @Maude message opens one resume gate and sends resume-offered", async () => {
  const h = graceHarness({ history: [msg(ts(40), "U0TEST", "  @Maude can you also check the export?")] });
  await h.bridge.sweepGraced();
  expect(h.openedGates).toHaveLength(1);
  const gate = h.openedGates[0]!;
  expect(gate.subject).toBe("slack:U0TEST");
  expect(gate.kind).toBe("slack-open");
  expect(gate.questions[0]!.label.endsWith(slackOpenMarker(gate.id))).toBe(true);
  expect(gate.context).toContain("can you also check the export?");
  expect(gate.meta).toEqual({
    action: "resume",
    conversation: h.opened.id,
    person: "U0TEST",
    personName: "Alex Example",
    requesterSession: null,
    requesterHandle: null,
    triggerTs: ts(40),
  });
  expect(h.milestones).toEqual([`Alex Example wrote again after the chat closed: @Maude can you also check the export? (chat ${h.opened.id})`]);
});

test("a custom persona's own trigger opens the resume gate, and the default one no longer does", async () => {
  const ada = { name: "Ada", emoji: "🦊", trigger: "!!ada" };
  const h = graceHarness({ persona: ada, history: [msg(ts(40), "U0TEST", "@Maude not me"), msg(ts(41), "U0TEST", "!!ada over here")] });
  await h.bridge.sweepGraced();
  expect(h.openedGates).toHaveLength(1);
  expect(h.openedGates[0]!.context).toContain("over here");
});

test("the operator's own copy of a persona line is not posted back to the room", async () => {
  const ada = { name: "Ada", emoji: "🦊" };
  const h = harness({ persona: ada, history: [msg(ts(10), "U0OPER", "[Ada 🦊]: on it"), msg(ts(11), "U0OPER", "[Claude 🤖]: from before the rename"), msg(ts(12), "U0OPER", "[Old Name :fox_face:]: shortcode of an earlier persona")] });
  await h.bridge.sweep();
  expect(h.posts).toEqual([]);
});

test("a second @Maude while the gate is open opens no second gate", async () => {
  const h = graceHarness({ history: [msg(ts(40), "U0TEST", "@Maude first")] });
  await h.bridge.sweepGraced();
  h.state.history.push(msg(ts(45), "U0TEST", "@Maude and one more thing"));
  await h.bridge.sweepGraced();
  expect(h.openedGates).toHaveLength(1);
  expect(h.contexts).toEqual(["Then:\n@Maude and one more thing"]);
  expect(h.milestones).toHaveLength(1);
});

test("a message already offered is not offered again", async () => {
  const h = graceHarness({ history: [msg(ts(40), "U0TEST", "@Maude first")] });
  await h.bridge.sweepGraced();
  await h.bridge.sweepGraced();
  expect(h.openedGates).toHaveLength(1);
  expect(h.contexts).toEqual([]);
});

test("an ordinary reply in grace opens nothing and posts nothing to the room", async () => {
  const h = graceHarness({
    history: [msg(ts(40), "U0TEST", "thanks!"), msg(ts(41), "U0TEST", "ok @Maude"), msg(ts(42), "U0OTHER", "@Maude hi"), msg(ts(43), "U0OPER", "@Maude")],
  });
  await h.bridge.sweepGraced();
  expect(h.openedGates).toEqual([]);
  expect(h.posts).toEqual([]);
  expect(h.milestones).toEqual([]);
});

test("a @Maude from before the close does not count", async () => {
  const h = graceHarness({ history: [msg(ts(20), "U0TEST", "@Maude too early")] });
  await h.bridge.sweepGraced();
  expect(h.openedGates).toEqual([]);
});

test("a conversation past grace_until is not read", async () => {
  const h = graceHarness({ history: [msg(ts(40), "U0TEST", "@Maude late")] });
  h.state.clock = CLOSED_AT_MS + GRACE_MS + 1;
  await h.bridge.sweepGraced();
  expect(h.reads).toEqual([]);
  expect(h.openedGates).toEqual([]);
});

test("declining the resume gate ends grace and closes the agent's pane", async () => {
  const h = graceHarness();
  await answerSlackOpen(h.openDeps, resumeAnswer(h, "decline"));
  expect(h.row().graceUntil).toBeNull();
  expect(h.panes).toEqual(["bg:w1:p9"]);
});

test("a conversation whose grace_until passes with no resume gets endGrace and its pane closed, once", async () => {
  const h = graceHarness();
  h.state.clock = CLOSED_AT_MS + GRACE_MS;
  await h.bridge.sweepGraced();
  await h.bridge.sweepGraced();
  expect(h.row().graceUntil).toBeNull();
  expect(h.panes).toEqual(["bg:w1:p9"]);
});

function openNewChat(h: ReturnType<typeof graceHarness>, assignedPane: string) {
  return openConversation(
    { ...conv, room: "dm-bbb", agentHandle: "pane.two", frameMarker: "marker2", openedAt: h.state.clock, assignedPane },
    h.db,
  );
}

test("a new conversation for the same person ends the older grace window, and the sweep closes the older pane", async () => {
  const h = graceHarness();
  openNewChat(h, "bg:w1:p10");
  expect(h.row().graceUntil).toBe(h.state.clock);
  await h.bridge.sweepGraced();
  expect(h.row().graceUntil).toBeNull();
  expect(h.panes).toEqual(["bg:w1:p9"]);
});

test("a new conversation that reuses the older pane leaves it open", async () => {
  const h = graceHarness();
  openNewChat(h, "bg:w1:p9");
  await h.bridge.sweepGraced();
  expect(h.row().graceUntil).toBeNull();
  expect(h.panes).toEqual([]);
});

test("a @Maude in a person's live chat opens no resume gate for their older closed chat", async () => {
  const h = graceHarness({ history: [msg(ts(40), "U0TEST", "@Maude over here")] });
  openNewChat(h, "bg:w1:p10");
  startGrace(h.opened.id, CLOSED_AT_MS + GRACE_MS, h.db);
  await h.bridge.sweepGraced();
  expect(h.reads).toEqual([]);
  expect(h.openedGates).toEqual([]);
});

test("the older of two graced chats is never offered a message the newer one has", async () => {
  const h = graceHarness({ history: [msg(ts(50), "U0TEST", "@Maude hello")] });
  const newer = openNewChat(h, "bg:w1:p10");
  closeConversation(newer.id, "idle", CLOSED_AT_MS + 10_000, h.db);
  startGrace(newer.id, CLOSED_AT_MS + 10_000 + GRACE_MS, h.db);
  startGrace(h.opened.id, CLOSED_AT_MS + GRACE_MS, h.db);
  expireOtherGrace("U0TEST", newer.id, h.state.clock, h.db);
  await h.bridge.sweepGraced();
  expect(h.openedGates).toHaveLength(1);
  expect((h.openedGates[0]!.meta as { conversation: number }).conversation).toBe(newer.id);
  expect(h.panes).toEqual(["bg:w1:p9"]);
});

test("grace running out closes the chat's waiting resume request", async () => {
  const h = graceHarness({ history: [msg(ts(40), "U0TEST", "@Maude hi")] });
  await h.bridge.sweepGraced();
  const gateId = h.openedGates[0]!.id;
  h.state.clock = CLOSED_AT_MS + GRACE_MS;
  await h.bridge.sweepGraced();
  expect(h.closedGates).toEqual([gateId]);
  expect(h.gates).toEqual([]);
});

test("declining closes any other resume request still waiting for the chat", async () => {
  const h = graceHarness({ history: [msg(ts(40), "U0TEST", "@Maude hi")] });
  await h.bridge.sweepGraced();
  const waiting = h.openedGates[0]!.id;
  await answerSlackOpen(h.openDeps, resumeAnswer(h, "decline"));
  expect(h.closedGates).toEqual([waiting]);
});

test("declining leaves the pane open when a newer conversation uses it", async () => {
  const h = graceHarness();
  openNewChat(h, "bg:w1:p9");
  await answerSlackOpen(h.openDeps, resumeAnswer(h, "decline"));
  expect(h.row().graceUntil).toBeNull();
  expect(h.panes).toEqual([]);
});

test("a resume request that will not open is logged once, retried, and is not a Slack failure", async () => {
  const h = graceHarness({ history: [msg(ts(40), "U0TEST", "@Maude hi")] });
  h.failures.open = true;
  await h.bridge.sweepGraced();
  await h.bridge.sweepGraced();
  expect(h.warns).toHaveLength(1);
  expect(h.warns[0]).toEqual([{ conversationId: h.opened.id }, "slack-bridge: a resume request would not open, retrying next tick"]);
  expect(h.milestones).toEqual([]);
  h.failures.open = false;
  await h.bridge.sweepGraced();
  expect(h.openedGates).toHaveLength(1);
});

test("tsBefore is one microsecond earlier, across a whole second and at the epoch", () => {
  expect(tsBefore("1700000000.000500")).toBe("1700000000.000499");
  expect(tsBefore("1700000001.000000")).toBe("1700000000.999999");
  expect(tsBefore("1700000001")).toBe("1700000000.999999");
  expect(tsBefore("0.000000")).toBe("0.000000");
});
