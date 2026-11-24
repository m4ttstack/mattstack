import { describe, expect, test } from "bun:test";
import { getRequest, insertRequest, listRequests, pendingStatuses } from "../../state/support-store.ts";
import type { SupportDraft, SupportMessage } from "../../../packages/rt-client/src/support.ts";
import { supportMac } from "../proof.ts";
import type { SupportRelay } from "../relay.ts";
import { createSupportService, statusNotice, type SupportServiceOptions } from "../service.ts";
import type { SupportConfig } from "../config.ts";
import { ADA, ORG, REPO, supportHost } from "./host-harness.ts";

const KEY = Buffer.alloc(32, 1).toString("base64");
const MINUTE = 60_000;

function harness(me: "alex" | "ada" = "alex") {
  const h = supportHost();
  const isHost = me === "alex";
  const state = {
    config: { ...h.state.config!, me, isHost, accepts: isHost, acceptHere: isHost } as SupportConfig | null,
    setHost: "ok" as "ok" | "other-machine" | "failed",
    reachable: true,
  };
  const events: string[] = [];
  const sent: SupportDraft[] = [];
  let inbox: SupportMessage[] = [];
  const relay: SupportRelay = {
    send: async (d) => {
      sent.push(d);
      return "ok";
    },
    list: async (kind) => (state.reachable ? inbox.filter((m) => m.kind === kind) : null),
    wait: async () => null,
    ack: async (keys) => {
      inbox = inbox.filter((m) => !keys.some((k) => k.from === m.from && k.id === m.id));
      return true;
    },
    setHost: async (on) => {
      events.push(`setHost ${on}`);
      return state.setHost;
    },
    host: async () => ({ accepting: true, lastSeenAt: h.state.now }),
  };
  const options: SupportServiceOptions = {
    db: h.db,
    log: h.deps.log,
    slackOpen: h.deps,
    slackClient: async () => ({ authTest: async () => ({ userId: "U0HOST", teamId: "T1", scopes: [] }) }) as never,
    stop: {} as never,
    emitEvent: (topic) => void events.push(`emit ${topic.replace(/dm-[0-9a-f]+/, "room")}`),
    gate: (id) => h.deps.gate(id),
    notify: (_t, message, url) => void events.push(`notify ${message}${url?.startsWith("slack:") ? ` -> ${url}` : ""}`),
    seams: {
      now: () => h.state.now,
      config: () => state.config,
      keys: async () => ({ current: KEY, retired: [] }),
      relay: async () => relay,
      boardToken: async () => "tok",
      defaultRepo: () => REPO,
      setAccepting: (on) => {
        events.push(`setting ${on}`);
        state.config = { ...state.config!, accepts: on, acceptHere: on };
      },
      readiness: async () => [],
      versions: async () => ({ rt: "1", app: null, macos: null }),
      unreadySetupRows: async () => null,
    },
  };
  const service = createSupportService(options);
  const restart = () => createSupportService(options);
  function arrive(kind: "request" | "status", from: string, to: string, id: string, body: object) {
    const text = JSON.stringify(body);
    const at = h.state.now;
    inbox.push({ id, to, from, kind, sentAt: at, receivedAt: at, body: text, mac: supportMac(KEY, { kind, id, org: ORG, from, to, sentAt: at, body: text }) });
  }
  return { h, state, events, sent, service, restart, arrive, left: () => inbox.length };
}

const ask = { text: "help", parts: [], slackUserId: ADA.slackUserId };

describe("the accepting flag", () => {
  test("a daemon restart publishes the accepting flag again, once", async () => {
    const t = harness();
    await t.service.tick();
    t.h.state.now += 2 * MINUTE;
    await t.service.tick();
    expect(t.events.filter((e) => e.startsWith("setHost"))).toEqual(["setHost true"]);
    await t.restart().tick();
    expect(t.events.filter((e) => e.startsWith("setHost"))).toEqual(["setHost true", "setHost true"]);
  });

  test("a claim that did not land is tried again a minute later", async () => {
    const t = harness();
    t.state.setHost = "failed";
    await t.service.tick();
    t.h.state.now += 5_000;
    await t.service.tick();
    t.state.setHost = "ok";
    t.h.state.now += MINUTE;
    await t.service.tick();
    t.h.state.now += 2 * MINUTE;
    await t.service.tick();
    expect(t.events.filter((e) => e.startsWith("setHost"))).toEqual(["setHost true", "setHost true"]);
  });

  test("turning support off for the org lets go of the role, even after a restart", async () => {
    const t = harness();
    await t.service.tick();
    t.state.config = { ...t.state.config!, enabled: false, acceptHere: false };
    const after = t.restart();
    await after.tick();
    t.h.state.now += 2 * MINUTE;
    await after.tick();
    expect(t.events.filter((e) => e.startsWith("setHost"))).toEqual(["setHost true", "setHost false"]);
  });

  test("a Mac that never accepted, or whose settings cannot be read, says nothing to the relay", async () => {
    const ada = harness("ada");
    await ada.service.tick();
    expect(ada.events).toEqual([]);
    const host = harness();
    await host.service.tick();
    host.state.config = null;
    host.h.state.now += 2 * MINUTE;
    await host.service.tick();
    host.state.config = { ...harness().state.config!, roster: [], acceptHere: false };
    host.h.state.now += 2 * MINUTE;
    await host.service.tick();
    expect(host.events.filter((e) => e.startsWith("setHost"))).toEqual(["setHost true"]);
  });
});

describe("accepting requests", () => {
  test("accept off answers what is queued, and keeps trying until the queue is read", async () => {
    const t = harness();
    t.arrive("request", "ada", "alex", "r1", ask);
    t.state.reachable = false;
    expect(await t.service.handlers["support:accept"]({ on: false })).toEqual({ ok: true, data: { accepting: false } });
    expect(t.left()).toBe(1);
    t.state.reachable = true;
    const after = t.restart();
    await after.tick();
    expect(t.left()).toBe(0);
    expect(getRequest("in", "ada", "r1", t.h.db)!.state).toBe("not-accepting");
    expect(t.sent.map((d) => d.id)).toEqual(["r1:not-accepting"]);
    expect(t.h.started).toEqual([]);
    t.arrive("request", "ada", "alex", "r2", ask);
    t.h.state.now += 2 * MINUTE;
    await after.tick();
    expect(t.left()).toBe(1);
  });

  test("a request that arrives opens, tells the host, and its status goes out", async () => {
    const t = harness();
    t.arrive("request", "ada", "alex", "r1", ask);
    t.service.start();
    for (let i = 0; i < 200 && t.sent.length === 0; i++) await Bun.sleep(5);
    t.service.stop();
    expect(t.sent.map((d) => d.id)).toEqual(["r1:received"]);
    expect(t.events).toContain("emit chat/room/msg");
    expect(t.events.filter((e) => e.startsWith("notify"))).toEqual(["notify ada asked for help, and Maude is answering"]);
    t.h.agentPosts(t.h.db.query("SELECT room, agent_handle AS agentHandle FROM slack_conversations").get() as never);
    await t.service.tick();
    expect(t.sent.map((d) => d.id)).toEqual(["r1:received", "r1:opened"]);
    expect(JSON.parse(t.sent[1]!.body)).toMatchObject({ state: "opened", dmLink: "slack://user?team=T1&id=U0HOST" });
  });

  test("ten requests read at once are taken in one pass", async () => {
    const t = harness();
    let lookups = 0;
    t.h.deps.findPerson = async () => {
      lookups++;
      return { ok: false, reason: "Slack did not answer", error: new Error("ratelimited") };
    };
    const service = t.restart();
    for (let i = 0; i < 10; i++) t.arrive("request", i % 2 ? "ada" : "bo", "alex", `r${i}`, ask);
    service.start();
    for (let i = 0; i < 100 && lookups < 10; i++) await Bun.sleep(5);
    await Bun.sleep(30);
    service.stop();
    expect(lookups).toBe(10);
  });

  test("an answered gate opens the chat and sends its status", async () => {
    const t = harness();
    t.h.operatorChat("U0XX1");
    t.h.operatorChat("U0XX2");
    const r = t.h.request();
    await t.service.tick();
    const gateId = getRequest("in", "ada", r.id, t.h.db)!.gateId!;
    await t.service.answerGate(t.h.answer(gateId, "approve"));
    expect(t.sent.map((d) => d.id)).toEqual([`${r.id}:waiting`, `${r.id}:received`]);
    expect(pendingStatuses(t.h.db)).toEqual([]);
  });

  test("a step that throws does not stop the next", async () => {
    const t = harness();
    const r = t.h.request();
    t.h.deps.gates.listOpen = () => {
      throw new Error("gate store is busy");
    };
    await t.service.tick();
    expect(t.sent.map((d) => d.id)).toEqual([`${r.id}:received`]);
  });
});

describe("the sender's side", () => {
  test("a status that arrives after sending raises one desk notification", async () => {
    const t = harness("ada");
    await t.service.handlers["support:send"]({ id: "r1", text: "help", parts: [] });
    t.arrive("status", "alex", "ada", "r1:opened", { requestId: "r1", state: "opened", at: 5, dmLink: "slack://user?team=T1&id=U0HOST" });
    t.service.start();
    for (let i = 0; i < 200 && t.left() > 0; i++) await Bun.sleep(5);
    t.service.stop();
    t.arrive("status", "alex", "ada", "r1:opened", { requestId: "r1", state: "opened", at: 5 });
    await Bun.sleep(5);
    expect(t.events.filter((e) => e.startsWith("notify"))).toEqual(["notify Maude messaged you in Slack -> slack://user?team=T1&id=U0HOST"]);
    expect(getRequest("out", "alex", "r1", t.h.db)!.state).toBe("opened");
  });

  test("a sender polls statuses only while it has a request that is not settled", async () => {
    const t = harness("ada");
    t.arrive("status", "alex", "ada", "r0:opened", { requestId: "r0", state: "opened", at: 5 });
    t.service.start();
    await Bun.sleep(20);
    t.service.stop();
    expect(t.left()).toBe(1);
    expect(listRequests("out", undefined, t.h.db)).toEqual([]);
  });

  test("every state reads in plain words", () => {
    const say = (state: Parameters<typeof statusNotice>[0]["state"], reason: string | null = null) => statusNotice({ state, reason }, "Alex", "Maude");
    expect(say("received")).toBe("Alex's Mac has it and Maude is starting");
    expect(say("waiting")).toBe("Alex needs to OK this one; it will wait");
    expect(say("declined")).toBe("Alex declined this one. Message Alex directly.");
    expect(say("failed", "the support agent could not start")).toBe("It did not open: the support agent could not start. Message Alex directly.");
    expect(say("failed")).toBe("It did not open. Message Alex directly.");
    expect(say("expired")).toBe("It was never picked up. Message Alex directly.");
  });

  test("prune keeps what is recent", () => {
    const t = harness("ada");
    insertRequest({ id: "old", direction: "out", peer: "alex", org: "acme", text: "x", parts: [], slackUserId: "U", state: "opened", reason: null, dmLink: null, conversationId: null, gateId: null, statusAt: 0, sentAt: 1, receivedAt: 1 }, t.h.db);
    t.service.prune();
    expect(listRequests("out", undefined, t.h.db)).toEqual([]);
  });
});
