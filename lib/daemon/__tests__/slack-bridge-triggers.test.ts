/**
 * lib/daemon/__tests__/slack-bridge-triggers.test.ts: the sweep that offers a new support chat for a teammate's trigger DM.
 */
import { expect, test } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import type { Logger } from "pino";
import type { GateRow } from "../../../packages/rt-client/src/commands.ts";
import { SlackError, type SlackClient, type SlackMessage, type SlackSearchHit } from "../../slack/client.ts";
import type { SlackPersona } from "../../slack/persona.ts";
import { offerTriggerChat, type TriggerOfferDeps } from "../../slack/trigger-offer.ts";
import { openStateDb } from "../../state/db.ts";
import { closeConversation, conversationForRoom, openConversation, pendingItems, startGrace } from "../../state/slack-conversation-store.ts";
import { createSlackBridge, tsBefore } from "../slack-bridge.ts";

const OPENED_AT_MS = 1_000_000_000_000;
const CLOCK_MS = OPENED_AT_MS + 300_000;
let n = 0;

const ts = (s: number) => `${1_000_000_000 + s}.000000`;
const dm = (s: number, user: string, text: string, extra: Partial<SlackSearchHit> = {}): SlackSearchHit => ({ ts: ts(s), user, text, channel: "D0NEW", isIm: true, ...extra });

const conv = {
  room: "dm-open",
  agentHandle: "pane.open",
  slackHandle: "slack.u0new",
  slackUserId: "U0NEW",
  slackChannel: "D0NEW",
  slackDisplayName: "Nia Newcomer",
  operatorUserId: "U0OPER",
  operatorName: "Operator",
  frameMarker: "marker1",
  lastReadTs: "1000000000.000100",
  openedAt: OPENED_AT_MS,
};

function harness(opts: { hits?: SlackSearchHit[]; open?: boolean; graced?: boolean; db?: ReturnType<typeof openStateDb>; persona?: SlackPersona; trigger?: string } = {}) {
  const db = opts.db ?? openStateDb(join(tmpdir(), `slack-trigger-${process.pid}-${n++}-${Date.now()}.db`));
  if (opts.open) openConversation(conv, db);
  if (opts.graced) {
    const old = openConversation({ ...conv, agentHandle: "pane.old", room: "dm-old" }, db);
    closeConversation(old.id, "idle", OPENED_AT_MS + 30_000, db);
    startGrace(old.id, OPENED_AT_MS + 30_000 + 3_600_000, db);
  }
  const state = { hits: opts.hits ?? [], clock: CLOCK_MS, error: undefined as unknown, lookupError: undefined as unknown, authCalls: 0 };
  const queries: string[] = [];
  const opened: Array<{ id: string; subject: string; meta: Record<string, unknown>; context: string }> = [];
  const contexts: string[] = [];
  const gates: GateRow[] = [];
  const failures = { open: false, unavailable: new Set<string>() };
  const desk: string[] = [];
  const refusedUsers = new Set(["U0GUEST"]);
  const warns: unknown[] = [];
  const spyLog = { warn: (...a: unknown[]) => warns.push(a), debug: () => {} } as unknown as Logger;
  const persona = opts.persona ?? { name: "Maude", emoji: "🤖" };
  const offerDeps: TriggerOfferDeps = {
    log: spyLog,
    milestones: { isOnline: () => false, postDm: async () => {}, desk: async (body) => void desk.push(body) },
    findPerson: async (person) => {
      if (refusedUsers.has(person)) return { ok: false, reason: `No one matches ${person}`, refused: true };
      if (failures.unavailable.has(person)) return { ok: false, reason: "This Slack connection can't reach direct messages yet" };
      if (state.lookupError) return { ok: false, reason: "Slack did not answer", error: state.lookupError };
      return { ok: true, person: { id: person, displayName: "Nia Newcomer" } };
    },
    repoPath: () => "/work/support",
    defaultRepo: () => "remote:github.com%2Facme%2Fsupport",
    gates: {
      open: async (input) => {
        if (failures.open) return { ok: false as const, error: "gate store unavailable" };
        opened.push(input as never);
        gates.push({ id: input.id, subject: input.subject, kind: input.kind, meta: input.meta } as unknown as GateRow);
        return { ok: true as const, id: input.id };
      },
      close: async () => {},
      listOpen: () => gates,
      appendContext: (_id, text) => void contexts.push(text),
    },
  };
  const client = {
    authTest: async () => {
      state.authCalls++;
      return { userId: "U0OPER", scopes: [] };
    },
    searchDms: async (query: string) => {
      queries.push(query);
      if (state.error) throw state.error;
      return state.hits;
    },
  } as unknown as SlackClient;
  const bridge = createSlackBridge({
    db,
    client: async () => client,
    post: () => ({ id: 1 }),
    log: spyLog,
    now: () => state.clock,
    persona: () => persona,
    trigger: () => opts.trigger,
    triggers: { offer: (hit) => offerTriggerChat(offerDeps, hit, persona, opts.trigger) },
  });
  return { db, bridge, state, queries, opened, contexts, failures, warns, desk };
}

test("a trigger DM from someone with no chat opens one gate with the fixed brief, and a second message appends", async () => {
  const h = harness({ hits: [dm(200, "U0NEW", "@Maude can you look at the export?")] });
  await h.bridge.sweepTriggers();
  expect(h.opened).toHaveLength(1);
  expect(h.opened[0]!.subject).toBe("slack:U0NEW");
  expect(h.opened[0]!.meta).toMatchObject({ action: "open", person: "U0NEW", personName: "Nia Newcomer", brief: "Nia Newcomer asked for help over Slack with @Maude. Their message arrives first.", triggerTs: ts(200), requesterSession: null, requesterHandle: null });
  h.state.hits = [dm(210, "U0NEW", "@Maude and the import too"), dm(200, "U0NEW", "@Maude can you look at the export?")];
  await h.bridge.sweepTriggers();
  expect(h.opened).toHaveLength(1);
  expect(h.contexts).toEqual(["Then:\n@Maude and the import too"]);
});

test("one search call per sweep, looking back ten minutes", async () => {
  const h = harness({ hits: [] });
  await h.bridge.sweepTriggers();
  expect(h.queries).toHaveLength(1);
  expect(h.queries[0]).toContain('"@Maude"');
  expect(h.queries[0]).toContain("to:me");
  expect(h.queries[0]).not.toContain("is:dm");
  expect(h.state.authCalls).toBe(1);
  await h.bridge.sweepTriggers();
  expect(h.state.authCalls).toBe(1);
});

test("a message older than the lookback is not offered", async () => {
  const h = harness({ hits: [dm(-400, "U0NEW", "@Maude too old")] });
  await h.bridge.sweepTriggers();
  expect(h.opened).toEqual([]);
});

test("a person with an open chat or a chat in grace gets no gate", async () => {
  for (const mode of [{ open: true }, { graced: true }]) {
    const h = harness({ ...mode, hits: [dm(200, "U0NEW", "@Maude hello")] });
    await h.bridge.sweepTriggers();
    expect(h.opened).toEqual([]);
  }
});

test("the operator's own message, a mid-text mention, @Maudeline, a channel message and an edit open nothing", async () => {
  const h = harness({
    hits: [
      dm(200, "U0OPER", "@Maude note to self"),
      dm(201, "U0NEW", "hey @Maude are you there"),
      dm(202, "U0NEW", "@Maudeline hello"),
      dm(203, "U0NEW", "@Maude in a channel", { isIm: false, channel: "C0ROOM" }),
      dm(204, "U0NEW", "@Maude edited", { subtype: "message_changed" }),
    ],
  });
  await h.bridge.sweepTriggers();
  expect(h.opened).toEqual([]);
  expect(h.contexts).toEqual([]);
});

test("a custom trigger replaces the default", async () => {
  const h = harness({ persona: { name: "Ada", emoji: "🦊" }, trigger: "!!ada", hits: [dm(200, "U0NEW", "@Maude no"), dm(201, "U0NEW", "!!ada yes")] });
  await h.bridge.sweepTriggers();
  expect(h.opened).toHaveLength(1);
  expect(h.opened[0]!.meta.brief).toBe("Nia Newcomer asked for help over Slack with !!ada. Their message arrives first.");
});

test("a message already handled is not offered again, even by a new bridge on the same database", async () => {
  const first = harness({ hits: [dm(200, "U0NEW", "@Maude hello")] });
  await first.bridge.sweepTriggers();
  expect(first.opened).toHaveLength(1);
  const second = harness({ db: first.db, hits: [dm(200, "U0NEW", "@Maude hello")] });
  await second.bridge.sweepTriggers();
  expect(second.opened).toEqual([]);
  expect(second.contexts).toEqual([]);
});

test("a message ignored for an open chat is not offered later when that chat closes", async () => {
  const h = harness({ open: true, hits: [dm(200, "U0NEW", "@Maude hello")] });
  await h.bridge.sweepTriggers();
  closeConversation(conversationForRoom("dm-open", h.db)!.id, "idle", h.state.clock, h.db);
  await h.bridge.sweepTriggers();
  expect(h.opened).toEqual([]);
});

test("a gate that will not open is logged once and the message is offered again next tick", async () => {
  const h = harness({ hits: [dm(200, "U0NEW", "@Maude hello")] });
  h.failures.open = true;
  await h.bridge.sweepTriggers();
  await h.bridge.sweepTriggers();
  expect(h.warns.length).toBe(1);
  h.failures.open = false;
  await h.bridge.sweepTriggers();
  expect(h.opened).toHaveLength(1);
});

test("a Slack rate limit holds the next sweeps until it passes", async () => {
  const h = harness({ hits: [dm(200, "U0NEW", "@Maude hello")] });
  h.state.error = new SlackError("ratelimited", 30_000);
  await h.bridge.sweepTriggers();
  h.state.error = undefined;
  h.state.clock += 10_000;
  await h.bridge.sweepTriggers();
  expect(h.queries).toHaveLength(1);
  h.state.clock += 25_000;
  await h.bridge.sweepTriggers();
  expect(h.queries).toHaveLength(2);
  expect(h.opened).toHaveLength(1);
});

test("a conversation opened from a trigger reads the trigger message first", async () => {
  const db = openStateDb(join(tmpdir(), `slack-trigger-read-${process.pid}-${n++}-${Date.now()}.db`));
  const opened = openConversation({ ...conv, lastReadTs: tsBefore(ts(200)), openedAt: CLOCK_MS }, db);
  const history: SlackMessage[] = [{ ts: ts(200), user: "U0NEW", text: "@Maude the export hangs" }];
  const client = { history: async (_c: string, oldest: string) => history.filter((m) => Number(m.ts) > Number(oldest)) } as unknown as SlackClient;
  const bridge = createSlackBridge({ db, client: async () => client, post: () => ({ id: 1 }), log: { warn: () => {}, debug: () => {} }, now: () => CLOCK_MS });
  await bridge.sweep();
  expect(pendingItems(opened.id, db)[0]).toMatchObject({ kind: "message", text: "@Maude the export hangs" });
});

test("a sender Slack refuses to resolve is settled once, and a later sender still opens a gate in the same sweep", async () => {
  const h = harness({ hits: [dm(200, "U0GUEST", "@Maude hi from outside"), dm(210, "U0NEW", "@Maude hello")] });
  await h.bridge.sweepTriggers();
  expect(h.opened.map((g) => g.subject)).toEqual(["slack:U0NEW"]);
  expect(h.desk).toHaveLength(1);
  expect(h.desk[0]).toContain("U0GUEST could not be connected");
  await h.bridge.sweepTriggers();
  expect(h.desk).toHaveLength(1);
  expect(h.warns).toEqual([]);
});

test("a sender that cannot be looked up for now is retried, warned once, and does not hold up the next sender", async () => {
  const h = harness({ hits: [dm(200, "U0SLOW", "@Maude hi"), dm(210, "U0NEW", "@Maude hello")] });
  h.failures.unavailable.add("U0SLOW");
  await h.bridge.sweepTriggers();
  await h.bridge.sweepTriggers();
  expect(h.opened.map((g) => g.subject)).toEqual(["slack:U0NEW"]);
  expect(h.warns).toHaveLength(1);
  h.failures.unavailable.clear();
  await h.bridge.sweepTriggers();
  expect(h.opened.map((g) => g.subject)).toEqual(["slack:U0NEW", "slack:U0SLOW"]);
});

test("a rate limit while looking a sender up stops the sweep and holds the next ones", async () => {
  const h = harness({ hits: [dm(200, "U0NEW", "@Maude hello"), dm(210, "U0MORE", "@Maude hi")] });
  h.state.lookupError = new SlackError("ratelimited", 30_000);
  await h.bridge.sweepTriggers();
  expect(h.opened).toEqual([]);
  h.state.lookupError = undefined;
  h.state.clock += 10_000;
  await h.bridge.sweepTriggers();
  expect(h.queries).toHaveLength(1);
});
