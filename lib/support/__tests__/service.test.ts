import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { dirname } from "path";
import { teamSecretsFile } from "../../secrets/team-store.ts";
import { setSetting, unsetSetting } from "../../settings/write.ts";
import { setKvValue } from "../../state/kv-blob.ts";
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
    hostAccepting: true,
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
    host: async () => ({ accepting: state.hostAccepting, lastSeenAt: h.state.now }),
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
  // What a tap on accept leaves behind.
  if (isHost) setKvValue("support", "accepted", ORG, h.db);
  const service = createSupportService(options);
  const restart = () => createSupportService(options);
  function arrive(kind: "request" | "status", from: string, to: string, id: string, body: object) {
    const text = JSON.stringify(body);
    const at = h.state.now;
    inbox.push({ id, to, from, kind, sentAt: at, receivedAt: at, body: text, mac: supportMac(KEY, { kind, id, org: ORG, from, to, sentAt: at, body: text }) });
  }
  return { h, state, events, sent, relay, options, service, restart, arrive, left: () => inbox.length };
}

const ask = { text: "help", parts: [], slackUserId: ADA.slackUserId };

describe("the accepting flag", () => {
  test("a daemon restart publishes the accepting flag again, and every minute keeps it", async () => {
    const t = harness();
    await t.service.tick();
    t.h.state.now += 5_000;
    await t.service.tick();
    expect(t.events.filter((e) => e.startsWith("setHost"))).toEqual(["setHost true"]);
    await t.restart().tick();
    expect(t.events.filter((e) => e.startsWith("setHost"))).toHaveLength(2);
    t.h.state.now += MINUTE;
    await t.service.tick();
    expect(t.events.filter((e) => e.startsWith("setHost"))).toHaveLength(3);
  });

  test("a Mac that lost the role to another stops for good, and tells the host once", async () => {
    const t = harness();
    await t.service.tick();
    expect(await t.service.handlers["support:host"]({})).toMatchObject({ data: { accepting: true } });
    t.state.setHost = "other-machine";
    t.h.state.now += 2 * MINUTE;
    await t.service.tick();
    expect(await t.service.handlers["support:host"]({})).toMatchObject({ data: { isHost: true, accepting: false } });
    let polled = 0;
    t.relay.list = async () => (polled++, []);
    t.service.start();
    await Bun.sleep(30);
    t.service.stop();
    expect(polled).toBe(0);
    t.state.setHost = "ok";
    const calls = t.events.filter((e) => e.startsWith("setHost")).length;
    for (const service of [t.service, t.restart()]) {
      t.h.state.now += 2 * MINUTE;
      await service.tick();
    }
    expect(t.events.filter((e) => e.startsWith("setHost"))).toHaveLength(calls);
    expect(t.events.filter((e) => e.startsWith("notify"))).toEqual(["notify Another of your Macs answers help requests now, so this one stopped"]);
    expect(t.events).toContain("setting false");
    expect(await t.service.handlers["support:accept"]({ on: true })).toMatchObject({ ok: true });
  });

  test("a setting turned off outside accept takes the tap with it, and the tap is one org's", async () => {
    const t = harness();
    await t.service.tick();
    const on = t.state.config!;
    t.state.config = { ...on, accepts: false, acceptHere: false };
    t.h.state.now += 2 * MINUTE;
    await t.service.tick();
    t.state.config = on;
    t.h.state.now += 2 * MINUTE;
    await t.service.tick();
    expect(await t.service.handlers["support:host"]({})).toMatchObject({ data: { accepting: false } });

    const other = harness();
    other.state.config = { ...other.state.config!, org: "other", orgPath: "other/mattstack" };
    await other.service.tick();
    expect(other.events.filter((e) => e.startsWith("setHost"))).toEqual([]);
  });

  test("the setting alone never accepts: a tap on accept has to be recorded on this Mac", async () => {
    const t = harness();
    setKvValue("support", "accepted", null, t.h.db);
    t.arrive("request", "ada", "alex", "r1", ask);
    t.service.start();
    await t.service.tick();
    await Bun.sleep(30);
    t.service.stop();
    expect(t.events).toEqual([]);
    expect(t.left()).toBe(1);
    expect(await t.service.handlers["support:host"]({})).toMatchObject({ data: { isHost: true, accepting: false } });
    expect(await t.service.handlers["support:accept"]({ on: true })).toMatchObject({ ok: true });
    expect(await t.service.handlers["support:host"]({})).toMatchObject({ data: { accepting: true } });
  });

  test("letting go of the role drains what was queued, however it was let go", async () => {
    const t = harness();
    await t.service.tick();
    t.state.config = { ...t.state.config!, accepts: false, acceptHere: false };
    t.arrive("request", "ada", "alex", "r1", ask);
    t.h.state.now += 2 * MINUTE;
    await t.service.tick();
    await t.service.tick();
    expect(t.left()).toBe(0);
    expect(getRequest("in", "ada", "r1", t.h.db)!.state).toBe("not-accepting");
  });

  test("a Mac that stops accepting with a chat open says so, since another Mac cannot see it", async () => {
    const t = harness();
    await t.service.tick();
    t.h.operatorChat("U0ADA");
    await t.service.handlers["support:accept"]({ on: false });
    expect(t.events).toContain("notify 1 Slack chat is still open on this Mac, so stop it before another of your Macs accepts");

    const lost = harness();
    await lost.service.tick();
    lost.h.operatorChat("U0ADA");
    lost.h.operatorChat("U0BO");
    lost.state.setHost = "other-machine";
    lost.h.state.now += 2 * MINUTE;
    await lost.service.tick();
    expect(lost.events).toContain("notify 2 Slack chats are still open on this Mac, so stop them before another of your Macs accepts");
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

describe("readiness", () => {
  test("a chat name nobody set reads as missing, whatever the registry's default is", async () => {
    const t = harness();
    const seen: string[] = [];
    unsetSetting("chat.humanHandle", "user");
    const service = createSupportService({ ...t.options, seams: { ...t.options.seams, readiness: async (d) => (seen.push(d.humanHandle()), []) } });
    await service.handlers["support:host"]({});
    setSetting("chat.humanHandle", "alex", "user");
    await service.handlers["support:host"]({});
    unsetSetting("chat.humanHandle", "user");
    expect(seen).toEqual(["", "alex"]);
  });
});

describe("the org's support key", () => {
  test("an org whose setting was turned on without one is told apart from one this Mac cannot open", async () => {
    const t = harness();
    const seen: string[] = [];
    const service = createSupportService({
      ...t.options,
      seams: { ...t.options.seams, keys: async () => null, readiness: async (d) => (seen.push(await d.supportKey()), []) },
    });
    await service.handlers["support:host"]({});
    const file = teamSecretsFile("acme", "support");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "not sops");
    await service.handlers["support:host"]({});
    rmSync(file);
    expect(seen).toEqual(["missing", "unreadable"]);
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

  test("a tick asked for while one is running is skipped", async () => {
    const t = harness();
    let lookups = 0;
    let release = () => {};
    const held = new Promise<void>((r) => (release = r));
    t.h.deps.findPerson = async () => {
      lookups++;
      await held;
      return { ok: false, reason: "Slack did not answer", error: new Error("ratelimited") };
    };
    const service = t.restart();
    t.h.request();
    const ticks = [service.tick()];
    await Bun.sleep(5);
    for (let i = 0; i < 12; i++) ticks.push(service.tick());
    release();
    await Promise.all(ticks);
    expect(lookups).toBe(1);
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

  test("a request no one picked up in 7 days expires on its own, with one notice", async () => {
    const t = harness("ada");
    await t.service.handlers["support:send"]({ id: "r1", text: "help", parts: [] });
    t.h.state.now += 7 * 24 * 60 * MINUTE;
    await t.service.tick();
    await t.service.tick();
    expect(getRequest("out", "alex", "r1", t.h.db)!.state).toBe("expired");
    expect(t.events.filter((e) => e.startsWith("notify"))).toEqual(["notify It was never picked up. Message alex directly."]);
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

  test("a notice names the host's bot, not the sender's own", async () => {
    const t = harness("ada");
    insertRequest({ id: "r1", direction: "out", peer: "alex", org: ORG, text: "x", parts: [], slackUserId: "U0ADA", state: "sent", reason: null, persona: null, dmLink: null, conversationId: null, gateId: null, statusAt: 0, sentAt: t.h.state.now, receivedAt: t.h.state.now }, t.h.db);
    t.arrive("status", "alex", "ada", "r1:opened", { requestId: "r1", state: "opened", at: 5, persona: "Robin" });
    t.service.start();
    await Bun.sleep(30);
    t.service.stop();
    expect(t.events).toContain("notify Robin messaged you in Slack");
    expect(getRequest("out", "alex", "r1", t.h.db)!.persona).toBe("Robin");
  });

  test("prune keeps what is recent", () => {
    const t = harness("ada");
    insertRequest({ id: "old", direction: "out", peer: "alex", org: "acme", text: "x", parts: [], slackUserId: "U", state: "opened", reason: null, persona: null, dmLink: null, conversationId: null, gateId: null, statusAt: 0, sentAt: 1, receivedAt: 1 }, t.h.db);
    t.service.prune();
    expect(listRequests("out", undefined, t.h.db)).toEqual([]);
  });
});
