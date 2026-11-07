import { describe, expect, test } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import type { Logger } from "pino";
import { ensureRoomRow, postMessage, readUnread } from "../../state/chat-store.ts";
import { closeConversation, conversationForSlackUser, listOpenConversations, openConversation, openStateDb, pendingItems } from "../../state/index.ts";
import { conversationById, conversationForAssignedSession, endGrace, recordSupportTicket, startGrace } from "../../state/slack-conversation-store.ts";
import type { GateRow } from "../../../packages/rt-client/src/commands.ts";
import {
  SLACK_OPEN_TTL_MS,
  answerSlackOpen,
  approveSlackOpen,
  approveSlackResume,
  expireSlackOpenGates,
  requestSlackOpen,
  slackOpenMarker,
  type SlackOpenDeps,
  type SlackOpenMeta,
  type StartedAgent,
} from "../request.ts";
import { requestResume } from "../resume.ts";
import type { SlackConversation } from "../../state/slack-conversation-store.ts";
import { findOpenGate } from "../../../plugins/mattstack/hooks/slack-support-text.ts";
import { normalizeGateQuestions } from "../../../packages/rt-client/src/gate-options.ts";

const log = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} } as unknown as Logger;
const NOW = 1_800_000_000_123;
let n = 0;

const ALEX = { id: "U0TEST", displayName: "Alex Example" };
const AGENT: StartedAgent = { id: "ag-1", handle: "support-1", sessionId: "sess-agent", paneId: "bg:w1:p9" };

function meta(over: Partial<SlackOpenMeta> = {}): SlackOpenMeta {
  return {
    action: "open",
    person: ALEX.id,
    personName: ALEX.displayName,
    brief: "Export hangs for Alex",
    requesterSession: "sess-req",
    requesterHandle: "req-1",
    requesterPane: null,
    repo: "github.com/acme/app",
    ...over,
  };
}

function harness(opts: { startError?: string; busyAfterStart?: boolean; reused?: boolean; lookupFails?: boolean; repoPath?: string | null; candidates?: boolean; alive?: boolean; repoOf?: string | null } = {}) {
  const db = openStateDb(join(tmpdir(), `slack-request-${process.pid}-${n++}-${Date.now()}.db`));
  const milestones: Array<{ via: string; body: string }> = [];
  const started: string[] = [];
  const stopped: StartedAgent[] = [];
  const opened: Array<Record<string, unknown>> = [];
  const closed: string[] = [];
  const closedPanes: Array<string | null> = [];
  let gates: GateRow[] = [];
  const deps: SlackOpenDeps = {
    db,
    now: () => NOW,
    log,
    humanHandle: () => "matt",
    milestones: {
      isOnline: () => true,
      postDm: async (_f, _t, body) => void milestones.push({ via: "dm", body }),
      desk: async (body) => void milestones.push({ via: "desk", body }),
    },
    findPerson: async (person) => {
      if (opts.candidates) return { ok: false, reason: "More than one person matches Alex", candidates: [{ name: "Alex One", person: "U1" }, { name: "Alex Two", person: "U2" }] };
      return person === "alex" || person === ALEX.id ? { ok: true, person: ALEX } : { ok: false, reason: "No one matches" };
    },
    connect: async () =>
      opts.lookupFails
        ? { ok: false, reason: "Slack did not answer" }
        : { ok: true, target: { userId: ALEX.id, displayName: ALEX.displayName, firstName: "Alex", channel: "D0TEST", operatorUserId: "U0OPER", operatorName: "Robin", newestTs: "1700000000.000100" } },
    repoPath: () => ("repoPath" in opts ? opts.repoPath! : "/work/app"),
    startAgent: async (repo) => {
      started.push(repo);
      if (opts.startError) return { ok: false, error: opts.startError };
      return { ok: true, agent: AGENT, reused: opts.reused ?? false };
    },
    stopAgent: async (agent) => void stopped.push(agent),
    agentAlive: async () => opts.alive ?? true,
    repoOf: () => ("repoOf" in opts ? opts.repoOf! : "github.com/acme/app"),
    closePane: async (pane) => void closedPanes.push(pane),
    presencePane: () => "w1:p1",
    gates: {
      open: async (input) => {
        opened.push(input);
        return { ok: true, id: input.id };
      },
      close: async (id) => void closed.push(id),
      listOpen: () => gates,
      appendContext: () => {},
    },
  };
  return { db, deps, milestones, started, stopped, opened, closed, closedPanes, setGates: (g: GateRow[]) => (gates = g) };
}

function answeredGate(m: SlackOpenMeta, decision: string): GateRow {
  return {
    id: "g1", subject: `slack:${m.person}`, kind: "slack-open", questions: [], meta: m as unknown as Record<string, unknown>,
    status: "answered", answer: { answers: { decision }, by: "console", at: NOW } as unknown as GateRow["answer"],
    openedAt: NOW - 1000, parkedAt: null, closedAt: null, closedReason: null, supersededBy: null, agent: null, pane: null,
    nudge: null, delivery: null, released: false, consumedAt: null, owner: null, escalatedAt: null,
  };
}

describe("requestSlackOpen", () => {
  test("slack-request opens a slack-open gate with a slack: subject and returns its id", async () => {
    const h = harness();
    const res = await requestSlackOpen(h.deps, { person: "alex", brief: "Export hangs", requesterSession: "sess-req", requesterHandle: "req-1", repo: "github.com/acme/app" });
    if (!res.ok || !("gateId" in res)) throw new Error("expected a gate");
    expect(h.opened).toHaveLength(1);
    const gate = h.opened[0] as { id: string; subject: string; kind: string; questions: Array<{ label: string; options: string[] }>; context: string; meta: SlackOpenMeta; pane?: string };
    expect(res.gateId).toBe(gate.id);
    expect(gate.subject).toBe("slack:U0TEST");
    expect(gate.kind).toBe("slack-open");
    expect(gate.questions[0]!.label).toBe(`Open a Slack support chat with Alex Example? ${slackOpenMarker(gate.id)}`);
    expect(gate.questions[0]!.options).toEqual(["approve", "decline"]);
    expect(gate.context).toContain("Alex Example");
    expect(gate.context).toContain("Export hangs");
    expect(gate.meta).toEqual(meta({ brief: "Export hangs", requesterPane: null }));
    expect(listOpenConversations(h.db)).toEqual([]);
  });

  test("an ambiguous person returns candidates and opens no gate", async () => {
    const h = harness({ candidates: true });
    const res = await requestSlackOpen(h.deps, { person: "alex", brief: "b", requesterSession: "s", requesterHandle: "h", repo: "r" });
    expect(res).toEqual({ ok: true, candidates: [{ name: "Alex One", person: "U1" }, { name: "Alex Two", person: "U2" }] });
    expect(h.opened).toEqual([]);
  });

  test("a second request for a person whose request is still waiting is refused, and the first gate stands", async () => {
    const h = harness();
    const waiting = { ...answeredGate(meta(), "approve"), status: "open" as const, answer: null };
    h.setGates([waiting]);
    const res = await requestSlackOpen(h.deps, { person: "alex", brief: "again", requesterSession: "s", requesterHandle: "h", repo: "r" });
    expect(res).toEqual({ ok: false, reason: "a request for Alex Example is already waiting" });
    expect(h.opened).toEqual([]);
    expect(h.closed).toEqual([]);
  });

  test("a waiting request for someone else does not block this one", async () => {
    const h = harness();
    h.setGates([{ ...answeredGate(meta({ person: "U9OTHER" }), "approve"), subject: "slack:U9OTHER", status: "open", answer: null }]);
    const res = await requestSlackOpen(h.deps, { person: "alex", brief: "b", requesterSession: "s", requesterHandle: "h", repo: "r" });
    expect(res.ok).toBe(true);
    expect(h.opened).toHaveLength(1);
  });

  test("an unknown person is a refusal and opens no gate", async () => {
    const h = harness();
    const res = await requestSlackOpen(h.deps, { person: "zed", brief: "b", requesterSession: "s", requesterHandle: "h", repo: "r" });
    expect(res).toEqual({ ok: false, reason: "No one matches" });
    expect(h.opened).toEqual([]);
  });
});

describe("approveSlackOpen", () => {
  test("a teammate-triggered gate starts the cursor just before the trigger and reports to the desk", async () => {
    const h = harness();
    await answerSlackOpen(h.deps, answeredGate(meta({ requesterSession: null, requesterHandle: null, triggerTs: "1700000040.000200" }), "approve"));
    const row = conversationForAssignedSession(AGENT.sessionId, h.db)!;
    expect(row.lastReadTs).toBe("1700000040.000199");
    expect(row.requesterHandle).toBeNull();
    expect(h.milestones.map((m) => m.via)).toEqual(["desk"]);
    expect(h.milestones[0]!.body).toContain("Alex Example is connected");
  });

  test("a pane's gate a teammate's message joined starts the cursor just before that message", async () => {
    const h = harness();
    await answerSlackOpen(h.deps, answeredGate(meta({ appendedTriggerTs: "1700000040.000200" }), "approve"));
    const row = conversationForAssignedSession(AGENT.sessionId, h.db)!;
    expect(row.lastReadTs).toBe("1700000040.000199");
    expect(row.requesterHandle).toBe("req-1");
  });

  test("approve starts a bg agent, opens the row with requester, assigned agent, session and pane, and sends opened", async () => {
    const h = harness();
    const res = await approveSlackOpen(h.deps, meta());
    if (!res.ok) throw new Error(res.reason);
    expect(h.started).toEqual(["github.com/acme/app"]);
    const row = conversationForAssignedSession(AGENT.sessionId, h.db)!;
    expect(row.id).toBe(res.conversation);
    expect(row).toMatchObject({
      agentHandle: "support-1", assignedAgent: "ag-1", assignedSession: "sess-agent", assignedPane: "bg:w1:p9",
      requesterSession: "sess-req", requesterHandle: "req-1", requesterPane: "w1:p1", brief: "Export hangs for Alex",
      slackUserId: "U0TEST", slackChannel: "D0TEST", lastReadTs: "1700000000.000100",
    });
    expect(h.milestones).toEqual([{ via: "dm", body: `Alex Example is connected in room ${row.room}, agent pane bg:w1:p9` }]);
    expect(h.stopped).toEqual([]);
  });

  test("a requester pane given in the meta wins over the presence pane", async () => {
    const h = harness();
    const res = await approveSlackOpen(h.deps, meta({ requesterPane: "w9:p2" }));
    if (!res.ok) throw new Error(res.reason);
    expect(conversationForAssignedSession(AGENT.sessionId, h.db)!.requesterPane).toBe("w9:p2");
  });

  test("approve records the repo the agent was started for", async () => {
    const h = harness();
    const res = await approveSlackOpen(h.deps, meta());
    if (!res.ok) throw new Error(res.reason);
    expect(conversationById(res.conversation, h.db)!.repo).toBe("github.com/acme/app");
  });

  test("approve for a person with an open chat sends open-failed naming it and leaves no agent and no row", async () => {
    const h = harness();
    const first = await approveSlackOpen(h.deps, meta());
    if (!first.ok) throw new Error(first.reason);
    const room = conversationForSlackUser(ALEX.id, h.db)!.room;
    h.milestones.length = 0;
    h.started.length = 0;
    const second = await approveSlackOpen(h.deps, meta());
    expect(second).toEqual({ ok: false, reason: `Alex Example already has a Slack chat open in ${room}` });
    expect(h.started).toEqual([]);
    expect(listOpenConversations(h.db)).toHaveLength(1);
    expect(h.milestones).toEqual([{ via: "dm", body: `Alex Example could not be connected: Alex Example already has a Slack chat open in ${room}` }]);
  });

  test("a chat that opens while the agent starts stops that agent and writes no second row", async () => {
    const h = harness();
    const realStart = h.deps.startAgent;
    h.deps.startAgent = async (repo) => {
      const started = await realStart(repo);
      openConversation(
        { room: "other-room", agentHandle: "other-agent", slackHandle: "slack.u0test", slackUserId: ALEX.id, slackChannel: "D0TEST", slackDisplayName: "Alex Example", operatorUserId: "U0OPER", operatorName: "Robin", frameMarker: "m", lastReadTs: "1", openedAt: NOW },
        h.db,
      );
      return started;
    };
    const res = await approveSlackOpen(h.deps, meta());
    expect(res.ok).toBe(false);
    expect(h.stopped).toEqual([AGENT]);
    expect(listOpenConversations(h.db)).toHaveLength(1);
    expect(h.milestones[0]!.body).toContain("could not be connected");
  });

  test("an agent:start error sends open-failed with the reason and writes no row", async () => {
    const h = harness({ startError: "no free herdr server" });
    const res = await approveSlackOpen(h.deps, meta());
    expect(res).toEqual({ ok: false, reason: "no free herdr server" });
    expect(h.stopped).toEqual([]);
    expect(listOpenConversations(h.db)).toEqual([]);
    expect(h.milestones).toEqual([{ via: "dm", body: "Alex Example could not be connected: no free herdr server" }]);
  });

  test("a start that hands back an agent already running is a failure and stops nothing", async () => {
    const h = harness({ reused: true });
    const res = await approveSlackOpen(h.deps, meta());
    expect(res.ok).toBe(false);
    expect(h.stopped).toEqual([]);
    expect(listOpenConversations(h.db)).toEqual([]);
  });

  test("a Slack failure before the agent starts starts no agent", async () => {
    const h = harness({ lookupFails: true });
    const res = await approveSlackOpen(h.deps, meta());
    expect(res).toEqual({ ok: false, reason: "Slack did not answer" });
    expect(h.started).toEqual([]);
    expect(h.milestones[0]!.body).toBe("Alex Example could not be connected: Slack did not answer");
  });

  test("a repo with no known folder fails without starting an agent", async () => {
    const h = harness({ repoPath: null });
    const res = await approveSlackOpen(h.deps, meta());
    expect(res.ok).toBe(false);
    expect(h.started).toEqual([]);
  });
});

describe("answerSlackOpen", () => {
  test("an approved gate opens the chat", async () => {
    const h = harness();
    await answerSlackOpen(h.deps, answeredGate(meta(), "approve"));
    expect(listOpenConversations(h.db)).toHaveLength(1);
  });

  test("decline sends declined", async () => {
    const h = harness();
    await answerSlackOpen(h.deps, answeredGate(meta(), "decline"));
    expect(h.milestones).toEqual([{ via: "dm", body: "Alex Example's chat request was declined" }]);
    expect(h.started).toEqual([]);
  });

  test("an action it does not know is left alone", async () => {
    const h = harness();
    await answerSlackOpen(h.deps, answeredGate({ ...meta(), action: "other" } as unknown as SlackOpenMeta, "approve"));
    expect(h.milestones).toEqual([]);
    expect(h.started).toEqual([]);
  });
});

const OLD_AGENT = { id: "ag-0", handle: "support-0", sessionId: "sess-old", paneId: "bg:w1:p3" };
const TRIGGER_TS = "1799999990.000500";

/** A chat that closed a minute ago and is still in its grace window. */
function closedChat(h: ReturnType<typeof harness>, over: { graceUntil?: number | null } = {}) {
  const old = openConversation(
    {
      room: "dm-old", agentHandle: OLD_AGENT.handle, slackHandle: "slack.u0test", slackUserId: ALEX.id, slackChannel: "D0TEST", slackDisplayName: ALEX.displayName,
      operatorUserId: "U0OPER", operatorName: "Robin", frameMarker: "m-old", lastReadTs: "1700000000.000100", openedAt: NOW - 600_000,
      requesterSession: "sess-req", requesterHandle: "req-1", requesterPane: "w1:p1", brief: "Export hangs for Alex",
      assignedAgent: OLD_AGENT.id, assignedSession: OLD_AGENT.sessionId, assignedPane: OLD_AGENT.paneId,
    },
    h.db,
  );
  closeConversation(old.id, "idle", NOW - 60_000, h.db);
  startGrace(old.id, over.graceUntil === undefined ? NOW + 3_000_000 : over.graceUntil!, h.db);
  return old;
}

function openOtherChat(h: ReturnType<typeof harness>) {
  return openConversation(
    { room: "other-room", agentHandle: "other-agent", slackHandle: "slack.u0test", slackUserId: ALEX.id, slackChannel: "D0TEST", slackDisplayName: "Alex Example", operatorUserId: "U0OPER", operatorName: "Robin", frameMarker: "m", lastReadTs: "1", openedAt: NOW },
    h.db,
  );
}

describe("approveSlackResume", () => {
  test("resume with the old agent alive assigns the new row to it and delivers resumed before the message", async () => {
    const h = harness({ alive: true });
    const old = closedChat(h);
    const res = await approveSlackResume(h.deps, { conversation: old.id, triggerTs: TRIGGER_TS });
    if (!res.ok) throw new Error(res.reason);
    expect(h.started).toEqual([]);
    const row = conversationById(res.conversation, h.db)!;
    expect(row).toMatchObject({
      room: "dm-old", agentHandle: "support-0", slackHandle: "slack.u0test", resumedFrom: old.id, closedAt: null,
      assignedAgent: "ag-0", assignedSession: "sess-old", assignedPane: "bg:w1:p3",
      requesterSession: "sess-req", requesterHandle: "req-1", brief: "Export hangs for Alex",
      slackChannel: "D0TEST", lastReadTs: "1799999990.000499",
    });
    const items = pendingItems(row.id, h.db);
    expect(items.map((i) => i.kind)).toEqual(["resumed"]);
    expect(items[0]!.text).toContain("within a minute");
    expect(h.milestones).toEqual([{ via: "dm", body: "Alex Example's chat is back with the same agent" }]);
  });

  test("resume with the old agent gone starts a fresh agent whose brief names the old room", async () => {
    const h = harness({ alive: false });
    const old = closedChat(h);
    recordSupportTicket(old.id, { id: "SUPPORT-12", title: "Export hangs on large files", url: "https://linear.app/x/SUPPORT-12" }, NOW - 120_000, h.db);
    const res = await approveSlackResume(h.deps, { conversation: old.id, triggerTs: TRIGGER_TS });
    if (!res.ok) throw new Error(res.reason);
    expect(h.started).toEqual(["github.com/acme/app"]);
    const row = conversationById(res.conversation, h.db)!;
    expect(row).toMatchObject({ room: "dm-old", agentHandle: "support-1", resumedFrom: old.id, assignedAgent: "ag-1", assignedSession: "sess-agent", assignedPane: "bg:w1:p9" });
    expect(row.brief).toContain("Export hangs for Alex");
    expect(row.brief).toContain("rt chat read dm-old");
    expect(row.brief).toContain("SUPPORT-12: Export hangs on large files");
    expect(pendingItems(row.id, h.db)).toEqual([]);
    expect(h.milestones).toEqual([{ via: "dm", body: "Alex Example's chat is back with a fresh agent" }]);
  });

  test("a fresh resume closes the old agent's pane, and a same-agent resume keeps it", async () => {
    const fresh = harness({ alive: false });
    const old = closedChat(fresh);
    const res = await approveSlackResume(fresh.deps, { conversation: old.id, triggerTs: TRIGGER_TS });
    if (!res.ok) throw new Error(res.reason);
    expect(fresh.closedPanes).toEqual(["bg:w1:p3"]);

    const same = harness({ alive: true });
    const kept = closedChat(same);
    const again = await approveSlackResume(same.deps, { conversation: kept.id, triggerTs: TRIGGER_TS });
    if (!again.ok) throw new Error(again.reason);
    expect(same.closedPanes).toEqual([]);
  });

  test("a fresh resumed agent can read the room's earlier messages", async () => {
    const h = harness({ alive: false });
    const old = closedChat(h);
    ensureRoomRow("dm-old", NOW - 600_000, h.db);
    postMessage({ room: "dm-old", handle: "slack.u0test", body: "the export hangs" }, h.db);
    const res = await approveSlackResume(h.deps, { conversation: old.id, triggerTs: TRIGGER_TS });
    if (!res.ok) throw new Error(res.reason);
    const read = readUnread({ handle: "support-1", room: "dm-old", limit: 50 }, h.db);
    expect(read.flatMap((r) => r.messages.map((m) => m.body))).toEqual(["the export hangs"]);
  });

  test("a fresh agent that cannot start fails the resume and leaves grace running", async () => {
    const h = harness({ alive: false, startError: "herdr is down" });
    const old = closedChat(h);
    const res = await approveSlackResume(h.deps, { conversation: old.id, triggerTs: TRIGGER_TS });
    expect(res).toEqual({ ok: false, reason: "herdr is down" });
    expect(listOpenConversations(h.db)).toEqual([]);
    expect(conversationById(old.id, h.db)!.graceUntil).toBe(NOW + 3_000_000);
    expect(h.milestones[0]!.body).toBe("Alex Example could not be connected: herdr is down");
  });

  test("a chat that opens while the fresh agent starts stops that agent and writes no second row", async () => {
    const h = harness({ alive: false });
    const old = closedChat(h);
    const realStart = h.deps.startAgent;
    h.deps.startAgent = async (repo) => {
      const started = await realStart(repo);
      openOtherChat(h);
      return started;
    };
    const res = await approveSlackResume(h.deps, { conversation: old.id, triggerTs: TRIGGER_TS });
    expect(res.ok).toBe(false);
    expect(h.stopped).toEqual([AGENT]);
    expect(listOpenConversations(h.db)).toHaveLength(1);
  });

  test("grace that runs out while the fresh agent starts fails the resume, stops that agent and opens no row", async () => {
    const h = harness({ alive: false });
    const old = closedChat(h);
    const realStart = h.deps.startAgent;
    h.deps.startAgent = async (repo) => {
      const started = await realStart(repo);
      endGrace(old.id, h.db);
      return started;
    };
    const res = await approveSlackResume(h.deps, { conversation: old.id, triggerTs: TRIGGER_TS });
    expect(res).toEqual({ ok: false, reason: "the time to pick this chat back up has passed" });
    expect(h.stopped).toEqual([AGENT]);
    expect(listOpenConversations(h.db)).toEqual([]);
    expect(h.milestones[0]!.body).toBe("Alex Example could not be connected: the time to pick this chat back up has passed");
  });

  test("grace that runs out while the old agent is checked leaves that agent alone", async () => {
    const h = harness({ alive: true });
    const old = closedChat(h);
    h.deps.agentAlive = async () => {
      endGrace(old.id, h.db);
      return true;
    };
    const res = await approveSlackResume(h.deps, { conversation: old.id, triggerTs: TRIGGER_TS });
    expect(res.ok).toBe(false);
    expect(h.stopped).toEqual([]);
    expect(listOpenConversations(h.db)).toEqual([]);
  });

  test("a fresh agent starts in the repo the old row recorded, ahead of the agent's own", async () => {
    const h = harness({ alive: false, repoOf: "github.com/acme/elsewhere" });
    const old = closedChat(h);
    h.db.query("UPDATE slack_conversations SET repo = 'github.com/acme/app' WHERE id = ?").run(old.id);
    const res = await approveSlackResume(h.deps, { conversation: old.id, triggerTs: TRIGGER_TS });
    if (!res.ok) throw new Error(res.reason);
    expect(h.started).toEqual(["github.com/acme/app"]);
    expect(conversationById(res.conversation, h.db)!.repo).toBe("github.com/acme/app");
  });

  test("a fresh agent for a row with no recorded repo uses the agent's repo, and the new row keeps it", async () => {
    const h = harness({ alive: false });
    const old = closedChat(h);
    const res = await approveSlackResume(h.deps, { conversation: old.id, triggerTs: TRIGGER_TS });
    if (!res.ok) throw new Error(res.reason);
    expect(h.started).toEqual(["github.com/acme/app"]);
    expect(conversationById(res.conversation, h.db)!.repo).toBe("github.com/acme/app");
  });

  test("a fresh agent with no known repo fails without starting one", async () => {
    const h = harness({ alive: false, repoOf: null });
    const old = closedChat(h);
    const res = await approveSlackResume(h.deps, { conversation: old.id, triggerTs: TRIGGER_TS });
    expect(res.ok).toBe(false);
    expect(h.started).toEqual([]);
  });

  test("resume ends grace and closes the conversation's other waiting resume gates", async () => {
    const h = harness({ alive: true });
    const old = closedChat(h);
    const resumeMeta = { action: "resume", conversation: old.id, person: ALEX.id, personName: ALEX.displayName, requesterSession: "sess-req", requesterHandle: "req-1", triggerTs: TRIGGER_TS };
    const gate = (id: string) => ({ ...answeredGate(meta(), "approve"), id, meta: resumeMeta, status: "open" as const, answer: null });
    h.setGates([gate("g-this"), gate("g-other")]);
    const res = await approveSlackResume(h.deps, { conversation: old.id, triggerTs: TRIGGER_TS, exceptGateId: "g-this" });
    expect(res.ok).toBe(true);
    expect(conversationById(old.id, h.db)!.graceUntil).toBeNull();
    expect(h.closed).toEqual(["g-other"]);
  });

  test("a resume after the grace window ran out refuses and changes nothing", async () => {
    const h = harness({ alive: true });
    const old = closedChat(h, { graceUntil: NOW - 1 });
    const res = await approveSlackResume(h.deps, { conversation: old.id, triggerTs: TRIGGER_TS });
    expect(res.ok).toBe(false);
    expect(listOpenConversations(h.db)).toEqual([]);
    expect(h.started).toEqual([]);
    expect(h.milestones).toHaveLength(1);
    expect(h.milestones[0]!.body).toContain("could not be connected");
  });

  test("a teammate-triggered resume after grace was ended refuses", async () => {
    const h = harness({ alive: true });
    const old = closedChat(h, { graceUntil: null });
    const res = await approveSlackResume(h.deps, { conversation: old.id, triggerTs: TRIGGER_TS });
    expect(res).toEqual({ ok: false, reason: "the time to pick this chat back up has passed" });
    expect(listOpenConversations(h.db)).toEqual([]);
  });

  test("a teammate-triggered resume after grace ran out refuses", async () => {
    const h = harness({ alive: true });
    const old = closedChat(h, { graceUntil: NOW - 1 });
    const res = await approveSlackResume(h.deps, { conversation: old.id, triggerTs: TRIGGER_TS });
    expect(res.ok).toBe(false);
    expect(listOpenConversations(h.db)).toEqual([]);
  });

  test("an operator-started resume after grace opens a new row with a fresh agent when the pane is gone", async () => {
    const h = harness({ alive: false });
    const old = closedChat(h, { graceUntil: NOW - 1 });
    const res = await approveSlackResume(h.deps, { conversation: old.id });
    if (!res.ok) throw new Error(res.reason);
    expect(res.agent).toBe("fresh");
    expect(conversationById(res.conversation, h.db)).toMatchObject({ room: "dm-old", resumedFrom: old.id, closedAt: null });
    expect(conversationById(old.id, h.db)!.graceUntil).toBeNull();
  });

  test("an operator-started resume of a chat whose grace was ended opens a new row", async () => {
    const h = harness({ alive: true });
    const old = closedChat(h, { graceUntil: null });
    const res = await approveSlackResume(h.deps, { conversation: old.id });
    expect(res.ok).toBe(true);
    expect(listOpenConversations(h.db)).toHaveLength(1);
  });

  test("an operator-started resume of a chat that is still open refuses", async () => {
    const h = harness({ alive: true });
    const open = openOtherChat(h);
    const res = await approveSlackResume(h.deps, { conversation: open.id });
    expect(res).toEqual({ ok: false, reason: "that chat is still open" });
  });

  test("a person who already has a chat open cannot be resumed into a second", async () => {
    const h = harness({ alive: true });
    const old = closedChat(h);
    openOtherChat(h);
    const res = await approveSlackResume(h.deps, { conversation: old.id, triggerTs: TRIGGER_TS });
    expect(res.ok).toBe(false);
    expect(listOpenConversations(h.db)).toHaveLength(1);
  });

  test("an approved resume gate resumes the chat, and no trigger starts the cursor at now", async () => {
    const h = harness({ alive: true });
    const old = closedChat(h);
    const resumeMeta = { action: "resume", conversation: old.id, person: ALEX.id, personName: ALEX.displayName, requesterSession: "sess-req", requesterHandle: "req-1", triggerTs: null };
    await answerSlackOpen(h.deps, { ...answeredGate(meta(), "approve"), meta: resumeMeta });
    const [row] = listOpenConversations(h.db);
    expect(row).toMatchObject({ resumedFrom: old.id, lastReadTs: "1800000000.123000" });
  });
});

describe("expireSlackOpenGates", () => {
  test("a gate unanswered for 30 min expires and sends expired", async () => {
    const h = harness();
    const old = { ...answeredGate(meta(), "approve"), status: "open" as const, answer: null, openedAt: NOW - SLACK_OPEN_TTL_MS };
    const fresh = { ...old, id: "g2", openedAt: NOW - SLACK_OPEN_TTL_MS + 1000 };
    h.setGates([old, fresh]);
    await expireSlackOpenGates(h.deps);
    expect(h.closed).toEqual(["g1"]);
    expect(h.milestones).toEqual([{ via: "dm", body: "Alex Example's chat request expired without a reply" }]);
  });

  test("a resume gate expires the same way and leaves grace alone", async () => {
    const h = harness();
    const resume = { action: "resume", conversation: 7, person: ALEX.id, personName: ALEX.displayName, requesterSession: "sess-req", requesterHandle: "req-1", triggerTs: "1.0" };
    h.setGates([{ ...answeredGate(meta(), "approve"), meta: resume, status: "open", answer: null, openedAt: NOW - SLACK_OPEN_TTL_MS }]);
    await expireSlackOpenGates(h.deps);
    expect(h.closed).toEqual(["g1"]);
    expect(h.milestones).toEqual([{ via: "dm", body: "Alex Example's request to pick the chat back up expired without a reply" }]);
  });

  test("a gate whose close fails sends nothing", async () => {
    const h = harness();
    h.deps.gates.close = async () => {
      throw new Error("already answered");
    };
    h.setGates([{ ...answeredGate(meta(), "approve"), status: "open", answer: null, openedAt: NOW - SLACK_OPEN_TTL_MS }]);
    await expireSlackOpenGates(h.deps);
    expect(h.milestones).toEqual([]);
  });
});

describe("the form a pane shows for a slack-open gate", () => {
  function storedGateList(input: Record<string, unknown>): string {
    return JSON.stringify({ gates: [{ id: input.id, questions: normalizeGateQuestions(input.questions as GateRow["questions"]) }] });
  }

  test("a request returns the question the mod checks the pane's form against", async () => {
    const h = harness();
    const res = await requestSlackOpen(h.deps, { person: "alex", brief: "Export hangs", requesterSession: "sess-req", requesterHandle: "req-1", repo: "github.com/acme/app" });
    if (!res.ok || !("gateId" in res)) throw new Error("expected a gate");
    const stored = findOpenGate(storedGateList(h.opened[0]!), res.gateId);
    expect(stored).not.toBeNull();
    expect(res.question.label).toBe(stored!.question);
    expect(res.question.options).toEqual(stored!.options);
    expect(res.question.options).toEqual([{ value: "approve", label: "Approve" }, { value: "decline", label: "Decline" }]);
  });

  test("a pane's resume returns the stored question, new or already waiting", async () => {
    const h = harness();
    const conv = { id: 7, slackUserId: ALEX.id, slackDisplayName: ALEX.displayName, requesterSession: null, requesterHandle: null } as unknown as SlackConversation;
    const res = await requestResume(h.deps, conv, { session: "sess-req", handle: "req-1" });
    if (!res.ok) throw new Error(res.reason);
    const stored = findOpenGate(storedGateList(h.opened[0]!), res.gateId);
    expect(stored).not.toBeNull();
    expect(res.question.label).toBe(stored!.question);
    expect(res.question.options).toEqual(stored!.options);

    const opened = h.opened[0] as { id: string; questions: GateRow["questions"]; meta: Record<string, unknown> };
    h.setGates([{ ...answeredGate(meta(), "approve"), id: opened.id, status: "open" as const, answer: null, questions: normalizeGateQuestions(opened.questions), meta: opened.meta }]);
    const again = await requestResume(h.deps, conv, { session: "sess-req", handle: "req-1" });
    expect(again).toEqual({ ok: true, gateId: res.gateId, question: res.question });
  });
});
