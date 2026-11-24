import { Database } from "bun:sqlite";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import { makeFetchHandler } from "../../../apps/board/switchboard/server.ts";
import { SwitchboardStore } from "../../../apps/board/switchboard/store.ts";
import { TeamInviteStore } from "../../../apps/board/switchboard/team-invites.ts";
import { TelemetryStore } from "../../../apps/board/switchboard/telemetry.ts";
import type { GateRow } from "../../../packages/rt-client/src/commands.ts";
import type { SupportPart, SupportState } from "../../../packages/rt-client/src/support.ts";
import { createChatHandlers } from "../../daemon/handlers/chat.ts";
import { createSlackChatHandlers, createSlackOpenDeps, type SlackOpenSeams } from "../../daemon/handlers/slack-chat.ts";
import { finishClose, type SlackLifecycleDeps } from "../../daemon/slack-lifecycle.ts";
import { setSetting } from "../../settings/write.ts";
import { SLACK_SUPPORT_CHAT_SCOPES } from "../../setup/slack-app.ts";
import type { SlackClient } from "../../slack/client.ts";
import { openStateDb } from "../../state/db.ts";
import { listOpenConversations, pendingItems, signIn } from "../../state/index.ts";
import { getRequest, listRequests } from "../../state/support-store.ts";
import type { SupportConfig } from "../config.ts";
import { createSupportRelay } from "../relay.ts";
import { createSupportService, type SupportService } from "../service.ts";

const KEY = Buffer.alloc(32, 1).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 2).toString("base64");
const ORG = "git.example.com/acme/mattstack";
const REPO = "remote:git.example.com%2Facme%2Fapp";
const DAY = 24 * 60 * 60_000;
const log = { warn() {}, info() {}, debug() {}, error() {}, child: () => log } as unknown as Logger;

const running: SupportService[] = [];
afterEach(() => {
  for (const s of running.splice(0)) s.stop();
});

let n = 0;
const scratchDb = () => openStateDb(join(tmpdir(), `support-e2e-${process.pid}-${n++}-${Date.now()}.db`));

async function until(what: string, cond: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !cond(); i++) await Bun.sleep(5);
  if (!cond()) throw new Error(`never happened: ${what}`);
}

/** One org, its relay, a host's Mac and as many teammates' Macs as a test asks for. */
function world() {
  setSetting("chat.humanHandle", "alex", "user");
  const clock = { offset: 0 };
  const now = () => Date.now() + clock.offset;
  const relayDb = new Database(":memory:");
  const boards = new SwitchboardStore(relayDb);
  const handler = makeFetchHandler(boards, "admin", now, new TeamInviteStore(relayDb), new TelemetryStore(relayDb), null);
  const wire: string[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.body) wire.push(String(init.body));
    return handler(new Request(String(input), init));
  }) as typeof fetch;
  const tokens = new Map<string, string>();
  const relayFor = (username: string, machine = `${username}-mac`) => {
    if (!tokens.has(username)) tokens.set(username, boards.registerBoard(username).token);
    return createSupportRelay({ url: "http://relay.test", token: tokens.get(username)!, machine, fetch: fetchFn });
  };

  const org = { enabled: true, host: "alex" as string | null, roster: [{ username: "alex", name: "Alex" }, { username: "ada" }, { username: "bo" }] };
  const configFor = (me: string, accepts: boolean): SupportConfig => {
    const isHost = org.host === me;
    return { org: "acme", orgRemote: ORG, me, isHost, accepts, acceptHere: org.enabled && isHost && accepts, ...org };
  };

  const slack: { channel: string; text: string }[] = [];
  const people: Record<string, string> = { U0HOST: "Alex", U0ADA: "Ada Example", U0BO: "Bo Example" };
  const slackFor = (me: string): SlackClient =>
    ({
      authTest: async () => ({ userId: me, teamId: "T1", scopes: SLACK_SUPPORT_CHAT_SCOPES }),
      listUsers: async () => Object.entries(people).map(([id, name]) => ({ id, name, displayName: name, realName: name, title: "", deleted: false, isBot: false })),
      openDm: async (id: string) => `D-${id}`,
      newestTs: async () => "1700000000.000100",
      post: async (channel: string, text: string) => {
        slack.push({ channel, text });
        return { ts: "1" };
      },
    }) as unknown as SlackClient;

  function mac(me: string, slackId: string, opts: { key?: string; machine?: string } = {}) {
    const db = scratchDb();
    const desk: string[] = [];
    const gates: GateRow[] = [];
    const agents: { handle: string; sessionId: string }[] = [];
    const state = { accepts: false };
    const client = slackFor(slackId);
    const milestones = { isOnline: () => false, postDm: async () => {}, desk: async (body: string) => void desk.push(body) };
    const seams: SlackOpenSeams = {
      repoPath: () => "/work/app",
      startAgent: async () => {
        const sessionId = `sess-${me}-${agents.length}`;
        const handle = signIn({ sessionId, baseHandle: "support", pane: `bg:w1:p${agents.length}` }, db)!.handle;
        agents.push({ handle, sessionId });
        return { ok: true, agent: { id: `ag-${agents.length}`, handle, sessionId, paneId: `bg:w1:p${agents.length}` }, reused: false };
      },
      stopAgent: async () => {},
      agentAlive: async () => false,
      repoOf: () => REPO,
      closePane: async () => {},
      presencePane: () => null,
      gates: {
        open: async (input) => {
          gates.push({ ...input, status: "open", answer: null, openedAt: now() } as unknown as GateRow);
          return { ok: true, id: input.id };
        },
        close: async (id) => void Object.assign(gates.find((g) => g.id === id) ?? {}, { status: "closed" }),
        listOpen: () => gates.filter((g) => g.status === "open"),
        appendContext: () => {},
      },
    };
    const lifecycle: SlackLifecycleDeps = {
      db, client: async () => client, notify: (_t, m) => void desk.push(m), post: () => ({ id: 1 }), now, milestones,
      herdrRunnerFor: () => async () => ({ exitCode: 0, stdout: "" }), persona: () => ({ name: "Maude", emoji: "x" }), trigger: () => undefined,
    };
    const relay = relayFor(me, opts.machine);
    const service = createSupportService({
      db, log, stop: lifecycle, slackClient: async () => client, emitEvent: () => 1,
      slackOpen: createSlackOpenDeps({ db, log, slackClient: async () => client, now, milestones, humanHandle: () => "alex" }, seams),
      gate: (id) => gates.find((g) => g.id === id) ?? null,
      notify: (_t, m) => void desk.push(m),
      seams: {
        now, config: () => configFor(me, state.accepts), keys: async () => ({ current: opts.key ?? KEY, retired: [] }), relay: async () => relay,
        boardToken: async () => "tok", defaultRepo: () => REPO, setAccepting: (on) => void (state.accepts = on), readiness: async () => [],
        versions: async () => ({ rt: "1.2.3", app: null, macos: null }), unreadySetupRows: async () => null,
      },
    });
    running.push(service);
    const chat = createChatHandlers({ db, emitEvent: () => 1, slackClient: async () => client, log } as never);
    const slackChat = createSlackChatHandlers({
      db, log, emitEvent: () => 1, slackClient: async () => client, milestones, now,
      linear: {
        apiKey: async () => "key",
        create: async () => ({ id: "SUP-7", title: "Board will not load", url: "https://linear.app/acme/issue/SUP-7" }),
        context: () => ({ forgeHost: "git.example.com", teamKeys: ["ACME"] }),
      } as never,
    });
    return {
      me, db, desk, gates, agents, service, lifecycle,
      state: (id: string): SupportState | undefined => listRequests("out", undefined, db).find((r) => r.id === id)?.state,
      ask: (id: string, text = "the board will not load", parts: SupportPart[] = []) => service.handlers["support:send"]({ id, text, parts }),
      accept: async (on: boolean) => {
        const r = await service.handlers["support:accept"]({ on });
        if (!r.ok) throw new Error(r.error);
      },
      agentWrites: (i: number, body: string) => {
        const conv = listOpenConversations(db).find((c) => c.agentHandle === agents[i]!.handle)!;
        return chat["chat:dm"]({ from: agents[i]!.handle, to: conv.slackHandle, body, sessionId: agents[i]!.sessionId } as never);
      },
      agentFilesTicket: (i: number) =>
        slackChat["chat:slack-ticket"]({ agentHandle: agents[i]!.handle, sessionId: agents[i]!.sessionId, kind: "bug", title: "Board will not load", problem: "It spins", idea: "Fix it", acceptance: ["It loads"] }),
      answer: (decision: string) => {
        const gate = gates.find((g) => g.status === "open")!;
        Object.assign(gate, { status: "answered", answer: { answers: { decision }, by: "console", at: now() } });
        return service.answerGate(gate);
      },
    };
  }
  return { clock, org, slack, wire, mac, now, relayFor };
}

async function accepting(w: ReturnType<typeof world>) {
  const host = w.mac("alex", "U0HOST");
  await host.accept(true);
  host.service.start();
  return host;
}

describe("support, end to end", () => {
  test("ask, open, ticket, close: the sender reads opened and the host hears the ticket and outcome", async () => {
    const w = world();
    const host = await accepting(w);
    const ada = w.mac("ada", "U0ADA");
    ada.service.start();
    expect(await ada.service.handlers["support:availability"]({})).toEqual({ ok: true, data: { state: "ready", host: "Alex", away: false } });
    expect(await ada.ask("r1", "the board will not load", [{ key: "versions", label: "Versions", value: "rt 1.2.3" }])).toMatchObject({ ok: true });
    await until("the request opens", () => host.agents.length === 1);
    await until("the sender reads received", () => ada.state("r1") === "received");
    const conv = listOpenConversations(host.db)[0]!;
    expect(pendingItems(conv.id, host.db)[0]).toMatchObject({ kind: "message", text: "the board will not load\n\nVersions: rt 1.2.3" });

    await host.service.tick();
    expect(ada.state("r1")).toBe("received");
    expect(getRequest("in", "ada", "r1", host.db)!.state).toBe("opening");
    expect(await host.agentWrites(0, "Hi Ada, the board will not load for you. What do you see?")).toMatchObject({ ok: true });
    await host.service.tick();
    await until("the sender reads opened", () => ada.state("r1") === "opened");
    expect(getRequest("out", "alex", "r1", ada.db)).toMatchObject({ dmLink: "slack://user?team=T1&id=U0HOST", persona: "Maude" });
    expect(ada.desk).toEqual(["Alex's Mac has it and Maude is starting", "Maude messaged you in Slack"]);

    expect(await host.agentFilesTicket(0)).toMatchObject({ ok: true });
    await finishClose(conv.id, "closed-by-pane", "We cleared the cache.", host.lifecycle);
    expect(host.desk.at(-1)).toBe("Ada Example's chat closed: the pane ended it. We cleared the cache. Tickets: SUP-7.");
    expect(w.slack.map((m) => m.channel)).toEqual(["D-U0ADA", "D-U0ADA", "D-U0ADA"]);
  });

  test("no ticket id or link reaches Slack or any status body", async () => {
    const w = world();
    const host = await accepting(w);
    const ada = w.mac("ada", "U0ADA");
    ada.service.start();
    await ada.ask("r1");
    await until("the request opens", () => host.agents.length === 1);
    await host.agentWrites(0, "Hi");
    await host.agentFilesTicket(0);
    expect(await host.agentWrites(0, "I filed SUP-7 for you")).toMatchObject({ ok: false });
    expect(await host.agentWrites(0, "See https://linear.app/acme/issue/SUP-7")).toMatchObject({ ok: false });
    await host.service.tick();
    await until("the sender reads opened", () => ada.state("r1") === "opened");
    await host.service.handlers["support:stop"]({ conversation: listOpenConversations(host.db)[0]!.id });
    await ada.ask("r2");
    await until("the second one is answered", () => ada.state("r2") === "waiting");
    await host.answer("approve");
    await until("the second one opens", () => host.agents.length === 2);
    await host.agentWrites(1, "Hi again");
    await host.agentFilesTicket(1);
    await finishClose(listOpenConversations(host.db)[0]!.id, "closed-by-pane", "I filed SUP-7, see https://linear.app/acme/issue/SUP-7", host.lifecycle);
    const everything = [...w.slack.map((m) => m.text), ...w.wire].join("\n");
    expect(everything).not.toContain("SUP-7");
    expect(everything).not.toContain("linear.app");
  });

  test("host away for two days, then back: the request opens once and the brief says it is old", async () => {
    const w = world();
    const host = w.mac("alex", "U0HOST");
    await host.accept(true);
    const ada = w.mac("ada", "U0ADA");
    await ada.ask("r1");
    w.clock.offset = 2 * DAY;
    expect(await ada.service.handlers["support:availability"]({})).toMatchObject({ data: { state: "ready", away: true } });
    expect(await ada.service.handlers["support:mine"]({})).toMatchObject({ data: { requests: [{ id: "r1", state: "sent", away: true }] } });
    ada.service.start();
    host.service.start();
    await until("the request opens", () => host.agents.length === 1);
    await until("the sender reads received", () => ada.state("r1") === "received");
    await host.service.tick();
    expect(host.agents).toHaveLength(1);
    expect(listOpenConversations(host.db)[0]!.brief).toEndWith("It was sent over a day ago, so ask whether they still need help.");
  });

  test("a same-named user in another org is never answered", async () => {
    const w = world();
    const host = await accepting(w);
    const stranger = w.mac("ada", "U0ADA", { key: OTHER_KEY });
    stranger.service.start();
    expect(await stranger.ask("r1")).toMatchObject({ ok: true });
    const bo = w.mac("bo", "U0BO");
    await bo.ask("r2");
    await until("a member's later request opens", () => host.agents.length === 1);
    await host.service.tick();
    expect(listRequests("in", undefined, host.db).map((r) => `${r.peer} ${r.id}`)).toEqual(["bo r2"]);
    expect(host.agents).toHaveLength(1);
    expect(stranger.state("r1")).toBe("sent");
    expect(stranger.desk).toEqual([]);
  });

  test("support turned off with two queued: both read not-accepting and nothing opens", async () => {
    const w = world();
    const host = w.mac("alex", "U0HOST");
    await host.accept(true);
    const ada = w.mac("ada", "U0ADA");
    const bo = w.mac("bo", "U0BO");
    await ada.ask("r1");
    await bo.ask("r2");
    w.org.enabled = false;
    for (const m of [ada, bo, host]) m.service.start();
    await until("both are answered", () => ada.state("r1") === "not-accepting" && bo.state("r2") === "not-accepting");
    expect(host.agents).toEqual([]);
    expect(ada.desk).toEqual(["Alex is not taking requests now. Message Alex directly."]);
    w.clock.offset += 2 * 60_000;
    await host.service.tick();
    expect(await w.relayFor("bo").host("alex")).toMatchObject({ accepting: false });
  });

  test("stop, ask again: the second request waits for the host", async () => {
    const w = world();
    const host = await accepting(w);
    const ada = w.mac("ada", "U0ADA");
    ada.service.start();
    await ada.ask("r1");
    await until("the request opens", () => host.agents.length === 1);
    await host.agentWrites(0, "Hi");
    await host.service.tick();
    await until("the sender reads opened", () => ada.state("r1") === "opened");
    expect(await host.service.handlers["support:stop"]({ conversation: listOpenConversations(host.db)[0]!.id })).toEqual({ ok: true, data: { told: true } });
    expect(w.slack.at(-1)!.text).toContain("is closed. Alex will follow up with you.");
    expect(listOpenConversations(host.db)).toEqual([]);

    await ada.ask("r2");
    await until("the second one waits", () => ada.state("r2") === "waiting");
    expect(host.agents).toHaveLength(1);
    await host.answer("approve");
    await until("the host's OK opens it", () => host.agents.length === 2);
    await until("the sender reads received", () => ada.state("r2") === "received");
  });

  test("a status reaches the Mac that asked, whichever of a teammate's two polls first", async () => {
    const w = world();
    const host = await accepting(w);
    const first = w.mac("ada", "U0ADA");
    const second = w.mac("ada", "U0ADA", { machine: "ada-laptop" });
    await second.ask("r0");
    await first.ask("r1");
    await until("the request opens", () => host.agents.length === 1);
    second.service.start();
    await until("the other Mac has polled and read its own", () => second.state("r0") === "received");
    expect(second.state("r1")).toBeUndefined();
    first.service.start();
    await until("the Mac that asked reads its own answer", () => first.state("r1") === "already-open");
    expect(second.desk).toEqual(["Alex's Mac has it and Maude is starting"]);
  });

  test("off on one of the host's Macs stays off, though the other once accepted", async () => {
    const w = world();
    const desktop = w.mac("alex", "U0HOST");
    await desktop.accept(true);
    const laptop = w.mac("alex", "U0HOST", { machine: "alex-laptop" });
    w.clock.offset = 11 * 60_000;
    await laptop.accept(true);
    await desktop.service.tick();
    await laptop.accept(false);
    w.clock.offset = 30 * 60_000;
    await desktop.service.tick();
    expect(await w.relayFor("ada").host("alex")).toMatchObject({ accepting: false });
    expect(await desktop.service.handlers["support:host"]({})).toMatchObject({ data: { accepting: false } });
  });

  test("a second Mac of the host's cannot accept while the first is there", async () => {
    const w = world();
    const host = await accepting(w);
    const laptop = w.mac("alex", "U0HOST", { machine: "alex-laptop" });
    expect(await laptop.service.handlers["support:accept"]({ on: true })).toMatchObject({ ok: false, failure: { code: "support-other-machine" } });
    await host.accept(false);
    expect(await laptop.service.handlers["support:accept"]({ on: true })).toMatchObject({ ok: true });
    laptop.service.start();
    const ada = w.mac("ada", "U0ADA");
    await ada.ask("r1");
    await until("the laptop opens it", () => laptop.agents.length === 1);
    expect(host.agents).toEqual([]);
  });
});
