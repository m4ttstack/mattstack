import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, test } from "bun:test";
import { SlackError, type SlackClient } from "../../slack/client.ts";
import { slackPrefix, stoppedLine } from "../../slack/format.ts";
import { createChatHandlers } from "../../daemon/handlers/chat.ts";
import { finishClose, requestClose, tickSlackLifecycle, type SlackLifecycleDeps } from "../../daemon/slack-lifecycle.ts";
import { dmRoomFor, ensureSlackIdentity, openConversation, openStateDb, pendingItems, signIn } from "../../state/index.ts";
import { conversationById, listGracedConversations, recordSupportTicket, startGrace } from "../../state/slack-conversation-store.ts";
import { setSetting } from "../../settings/write.ts";
import { insertRequest, stoppedSince } from "../../state/support-store.ts";
import { stopSlackChat } from "../stop.ts";

const MAUDE = { name: "Maude", emoji: "🤖" };
const NOW = 1_800_000_000_000;
const LINE = `${slackPrefix(MAUDE)}This chat with Maude is closed. Robin will follow up with you.`;
let n = 0;

function harness(opts: { pane?: string | null; paneExit?: number; slack?: "ok" | "down" | "none" } = {}) {
  const db = openStateDb(join(tmpdir(), `support-stop-${process.pid}-${n++}-${Date.now()}.db`));
  const events: string[] = [];
  const notices: string[] = [];
  const desk: string[] = [];
  const room: string[] = [];
  setSetting("chat.humanHandle", "robin", "user");
  const agent = signIn({ sessionId: "sess-1", baseHandle: "support", pane: "bg:w1:p1" }, db)!;
  const identity = ensureSlackIdentity("U0TEST", "Ada", db);
  const { room: dm } = dmRoomFor(agent.handle, identity.id, "robin", db);
  const conv = openConversation(
    {
      room: dm, agentHandle: agent.handle, slackHandle: identity.id, slackUserId: "U0TEST", slackChannel: "D0TEST", slackDisplayName: "Ada Example",
      operatorUserId: "U0HOST", operatorName: "Robin", frameMarker: "m", lastReadTs: "1", openedAt: NOW - 1000,
      assignedAgent: "ag-1", assignedSession: "sess-1", assignedPane: opts.pane === undefined ? "bg:w1:p1" : opts.pane,
    },
    db,
  );
  const client = {
    post: async (_c: string, text: string) => {
      if (opts.slack === "down") throw new SlackError("channel_not_found");
      events.push(`slack ${text}`);
      return { ts: "1" };
    },
  } as unknown as SlackClient;
  const deps: SlackLifecycleDeps = {
    db,
    client: async () => (opts.slack === "none" ? null : client),
    notify: (_t, m) => void notices.push(m),
    post: (a) => {
      room.push(a.body);
      return { id: 1 };
    },
    now: () => NOW,
    milestones: { isOnline: () => false, postDm: async () => {}, desk: async (b) => void desk.push(b) },
    herdrRunnerFor: () => async (args) => {
      events.push(`pane ${args.join(" ")} closed=${conversationById(conv.id, db)!.closedAt !== null}`);
      return { exitCode: opts.paneExit ?? 0, stdout: "" };
    },
    persona: () => MAUDE,
    trigger: () => undefined,
  };
  const supportRequest = () =>
    insertRequest(
      { id: "r1", direction: "in", peer: "ada", org: "acme", text: "help", parts: [], slackUserId: "U0TEST", state: "opened", reason: null, dmLink: null, conversationId: conv.id, gateId: null, statusAt: 0, sentAt: NOW, receivedAt: NOW },
      db,
    );
  return { db, conv, deps, events, notices, desk, room, supportRequest };
}

describe("stoppedLine", () => {
  test("is one fixed line with no trigger", () => {
    expect(stoppedLine("Robin", MAUDE)).toBe(LINE);
  });
});

describe("stopSlackChat", () => {
  test("stop closes the row before the pane", async () => {
    const h = harness();
    expect(await stopSlackChat(h.conv.id, h.deps)).toEqual({ ok: true, told: true });
    expect(h.events).toEqual(["pane pane close w1:p1 closed=true", `slack ${LINE}`]);
    expect(conversationById(h.conv.id, h.db)).toMatchObject({ closedAt: NOW, closeReason: "operator" });
  });

  test("the agent can write before the stop and not after it", async () => {
    const h = harness();
    const chat = createChatHandlers({ db: h.db, emitEvent: () => 1, slackClient: h.deps.client } as never);
    const write = (body: string) => chat["chat:dm"]({ from: h.conv.agentHandle, to: h.conv.slackHandle, body, sessionId: "sess-1" } as never);
    expect(await write("hello")).toMatchObject({ ok: true });
    await stopSlackChat(h.conv.id, h.deps);
    expect(await write("still here")).toMatchObject({ ok: false });
    expect(h.events.filter((e) => e.startsWith("slack"))).toHaveLength(2);
  });

  test("one fixed line reaches the teammate, with no farewell and no trigger", async () => {
    const h = harness();
    await stopSlackChat(h.conv.id, h.deps);
    expect(h.events.filter((e) => e.startsWith("slack"))).toEqual([`slack ${LINE}`]);
    expect(h.room).toEqual([LINE.slice(slackPrefix(MAUDE).length)]);
  });

  test("there is no grace window, and an earlier one ends", async () => {
    const h = harness();
    const old = openConversation({ ...h.conv, slackUserId: "U0TMP", agentHandle: "support-0", room: "dm-old", openedAt: NOW - 9000 }, h.db);
    h.db.query("UPDATE slack_conversations SET slack_user_id = 'U0TEST', closed_at = ? WHERE id = ?").run(NOW - 5000, old.id);
    startGrace(old.id, NOW + 1_000_000, h.db);
    await stopSlackChat(h.conv.id, h.deps);
    expect(conversationById(h.conv.id, h.db)!.graceUntil).toBeNull();
    expect(listGracedConversations(NOW, h.db)).toEqual([]);
  });

  test("a second stop says the chat is already closed and sends nothing", async () => {
    const h = harness();
    await stopSlackChat(h.conv.id, h.deps);
    const before = h.events.length;
    expect(await stopSlackChat(h.conv.id, h.deps)).toEqual({ ok: false, reason: "that chat is already closed" });
    expect(await stopSlackChat(999, h.deps)).toEqual({ ok: false, reason: "that chat is not known to rt" });
    expect(h.events).toHaveLength(before);
  });

  test("two stops at once send one line", async () => {
    const h = harness();
    const results = await Promise.all([stopSlackChat(h.conv.id, h.deps), stopSlackChat(h.conv.id, h.deps)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(h.events.filter((e) => e.startsWith("slack"))).toHaveLength(1);
  });

  test("a pane that will not close still leaves the chat closed and tells the host where it is", async () => {
    const h = harness({ paneExit: 1 });
    expect(await stopSlackChat(h.conv.id, h.deps)).toEqual({ ok: true, told: true });
    expect(h.notices).toEqual(["Maude may still be running in bg:w1:p1, though it can no longer message Ada Example"]);
  });

  test("a Slack failure still leaves the chat closed and tells the host", async () => {
    for (const slack of ["down", "none"] as const) {
      const h = harness({ slack });
      expect(await stopSlackChat(h.conv.id, h.deps)).toEqual({ ok: true, told: false });
      expect(conversationById(h.conv.id, h.db)!.closedAt).toBe(NOW);
      expect(h.notices).toEqual(["Ada Example was not told the chat is closed, so check the DM"]);
      expect(h.room).toEqual([]);
    }
  });

  test("a chat held by a pane of the host's own is closed without touching that pane", async () => {
    const h = harness({ pane: null });
    await stopSlackChat(h.conv.id, h.deps);
    expect(h.events).toEqual([`slack ${LINE}`]);
    expect(h.notices).toEqual([]);
    expect(pendingItems(h.conv.id, h.db).map((i) => i.kind)).toEqual(["closed"]);
  });

  test("the stop is recorded for that Slack user only, and a refused one is not", async () => {
    const h = harness();
    await stopSlackChat(h.conv.id, h.deps);
    expect(stoppedSince("U0TEST", NOW, h.db)).toBe(true);
    expect(stoppedSince("U0OTHER", 0, h.db)).toBe(false);
    await stopSlackChat(h.conv.id, h.deps);
    expect(h.db.query("SELECT COUNT(*) AS n FROM support_stops").get()).toEqual({ n: 1 });
  });

  test("a pending close-request does not add its own closing lines", async () => {
    const h = harness();
    requestClose(h.conv.id, "idle", h.deps);
    await stopSlackChat(h.conv.id, h.deps);
    await finishClose(h.conv.id, "idle", "bye", h.deps);
    await tickSlackLifecycle(h.deps);
    expect(h.events.filter((e) => e.startsWith("slack"))).toEqual([`slack ${LINE}`]);
  });

  test("a support chat's stop carries the tickets to the host", async () => {
    const h = harness();
    h.supportRequest();
    recordSupportTicket(h.conv.id, { id: "T-1", title: "t", url: "u" }, NOW, h.db);
    await stopSlackChat(h.conv.id, h.deps);
    expect(h.desk).toEqual(["Ada Example's chat closed: you closed it. Tickets: T-1."]);
  });

  test("no ticket id reaches Slack", async () => {
    const h = harness();
    recordSupportTicket(h.conv.id, { id: "T-1", title: "t", url: "u" }, NOW, h.db);
    await stopSlackChat(h.conv.id, h.deps);
    expect(h.events.join(" ")).not.toContain("T-1");
  });
});
