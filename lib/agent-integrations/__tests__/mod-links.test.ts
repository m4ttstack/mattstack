import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ModBlock, NativeSessionRef } from "../../../packages/rt-client/src/agent-integrations.ts";
import { openStateDb } from "../../state/db.ts";
import { createSessionStore } from "../session-store.ts";
import {
  createModLinks, modCommandEnvelope, pushModCommand, MOD_COMMAND_ACK_MS, TESTED_CLAUDE_CODE,
  type ModLinks, type ModLinksDeps, type PushDeps,
} from "../claude/mod-links.ts";
import { createGatesStore } from "../../daemon/gates-store.ts";
import { createGateQuestions } from "../questions.ts";
import pino from "pino";

let dir = "";
let origHome: string | undefined;

beforeEach(() => {
  origHome = process.env.HOME;
  dir = mkdtempSync(join(tmpdir(), "rt-mod-links-"));
  process.env.HOME = join(dir, "home");
});

afterEach(() => {
  process.env.HOME = origHome;
  rmSync(dir, { recursive: true, force: true });
});

const claudeRef = (value: string): NativeSessionRef => ({ harness: "claude", profile: "default", kind: "id", value });

function harness(over: { enabled?: () => boolean; continued?: ModLinksDeps["continued"] } = {}) {
  const db: Database = openStateDb(join(dir, "state.db"));
  const store = createSessionStore(db);
  const clock = { now: 1_000_000 };
  const links: ModLinks = createModLinks({
    now: () => clock.now,
    integrationsEnabled: over.enabled ?? (() => true),
    store,
    ...(over.continued && { continued: over.continued }),
  });
  return { db, store, clock, links };
}

const ALL: ModBlock[] = ["delivery", "gate-form", "presence"];

function register(links: ModLinks, sessionId: string, over: Partial<Parameters<ModLinks["register"]>[0]> = {}) {
  const result = links.register({
    sessionId, cwd: "/repo", root: "/repo", pane: "w1:p1",
    claudeCode: TESTED_CLAUDE_CODE.max, plugin: "0.1.0", blocks: ALL, ...over,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

describe("mod links", () => {
  test("a sweep hands each link it drops for a missed heartbeat to lapsed, and none when the switch turns off", () => {
    let enabled = true;
    const seen: string[] = [];
    const { links, clock } = (() => {
      const db: Database = openStateDb(join(dir, "lapse.db"));
      const c = { now: 1_000_000 };
      return {
        clock: c,
        links: createModLinks({
          now: () => c.now, integrationsEnabled: () => enabled, store: createSessionStore(db),
          lapsed: (link) => { seen.push(`${link.sessionId}:${link.blocks.join(",")}`); },
        }),
      };
    })();
    register(links, "sess-1");
    clock.now += 31_000;
    expect(links.sweep()).toBe(1);
    expect(seen).toEqual(["sess-1:delivery,gate-form,presence"]);

    register(links, "sess-2");
    enabled = false;
    expect(links.sweep()).toBe(1);
    expect(seen).toHaveLength(1);
  });

  test("a turn report counts only from a live presence block, survives a same-session re-register and lapses with the link", () => {
    const { links, clock } = harness();
    expect(links.execution("sess-1")).toBeNull();
    const first = register(links, "sess-1");
    expect(links.execution("sess-1")).toBeNull();
    expect(links.setExecution(first.linkId, "working")).toEqual({ ok: true, data: true });
    expect(links.execution("sess-1")).toBe("working");

    // A cleared block or a forgotten link re-registers mid-turn: the turn it reported stands.
    const second = register(links, "sess-1");
    expect(links.execution("sess-1")).toBe("working");
    expect(links.setExecution(first.linkId, "idle").ok).toBe(false);

    const continued = register(links, "sess-2", { previousSessionId: "sess-1", previousLinkId: second.linkId });
    expect(links.execution("sess-2")).toBe("working");
    expect(links.setExecution(continued.linkId, "idle").ok).toBe(true);
    expect(links.execution("sess-2")).toBe("idle");
    clock.now += 31_000;
    expect(links.execution("sess-2")).toBeNull();

    const noPresence = register(links, "sess-3", { blocks: ["delivery"] });
    expect(links.setExecution(noPresence.linkId, "working")).toEqual({ ok: true, data: false });
    expect(links.execution("sess-3")).toBeNull();
  });

  test("blocks clear 30 s after the last heartbeat", () => {
    const { links, clock } = harness();
    const start = clock.now;
    const { linkId } = register(links, "sess-1");
    expect(links.live("sess-1", "delivery")).toBe(true);
    expect(links.live("sess-1", "observe")).toBe(false);

    clock.now = start + 29_000;
    expect(links.live("sess-1", "delivery")).toBe(true);
    clock.now = start + 31_000;
    expect(links.live("sess-1", "delivery")).toBe(false);
    expect(links.linkOf("sess-1")).toBeNull();
    const late = links.heartbeat(linkId);
    expect(late.ok).toBe(false);

    const again = register(links, "sess-1");
    clock.now = start + 31_000 + 20_000;
    expect(links.heartbeat(again.linkId).ok).toBe(true);
    clock.now = start + 31_000 + 20_000 + 29_000;
    expect(links.live("sess-1", "delivery")).toBe(true);
    expect(links.linkOf("sess-1")?.lastHeartbeatAt).toBe(start + 31_000 + 20_000);
    clock.now = start + 31_000 + 20_000 + 31_000;
    expect(links.sweep()).toBe(1);
    expect(links.live("sess-1", "delivery")).toBe(false);
  });

  test("switch off refuses register and clears existing links", () => {
    let enabled = true;
    const { links } = harness({ enabled: () => enabled });
    const { linkId } = register(links, "sess-1");
    expect(links.live("sess-1", "delivery")).toBe(true);

    enabled = false;
    const refused = links.register({
      sessionId: "sess-2", cwd: "/repo", root: "/repo", claudeCode: TESTED_CLAUDE_CODE.max, plugin: "0.1.0", blocks: ALL,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("refused");
    expect(links.live("sess-1", "delivery")).toBe(false);
    expect(links.linkOf("sess-1")).toBeNull();
    expect(links.heartbeat(linkId).ok).toBe(false);

    enabled = true;
    expect(links.heartbeat(linkId).ok).toBe(false);
    expect(links.live("sess-2", "delivery")).toBe(false);
  });

  test("an engine outside the tested range registers with no blocks", () => {
    const { links } = harness();
    for (const [sessionId, claudeCode] of [["new", "9.0.0"], ["next", "2.1.295"], ["old", "2.1.292"], ["odd", "unknown"]] as const) {
      const out = register(links, sessionId, { claudeCode });
      expect(out.blocks).toEqual([]);
      expect(links.live(sessionId, "delivery")).toBe(false);
      expect(links.linkOf(sessionId)).toMatchObject({ claudeCode, blocks: [] });
      expect(links.heartbeat(out.linkId).ok).toBe(true);
    }
    const inRange = register(links, "in", { claudeCode: `${TESTED_CLAUDE_CODE.min} (Claude Code)` });
    expect(inRange.blocks).toEqual(ALL);
    expect(register(links, "top", { claudeCode: TESTED_CLAUDE_CODE.max }).blocks).toEqual(ALL);
  });

  test("a link-reported id change keeps the binding key and identity and advances the generation", () => {
    const { links, store } = harness();
    const bound = store.bind(store.reserve({ identity: "remy.ab12" }), claudeRef("sess-1"), { mode: "herdr", pane: "w1:p1" });
    if (!bound.ok) throw new Error(bound.error.message);
    const old = register(links, "sess-1");

    const next = register(links, "sess-2", { previousSessionId: "sess-1", previousLinkId: old.linkId });

    const moved = store.get(bound.data.key);
    expect(moved?.key).toBe(bound.data.key);
    expect(moved?.identity).toBe("remy.ab12");
    expect(moved?.native).toEqual(claudeRef("sess-2"));
    expect(moved?.attachment.generation).toBe(bound.data.attachment.generation + 1);
    expect(store.find(claudeRef("sess-1"))).toBeNull();
    expect(links.live("sess-2", "delivery")).toBe(true);
    expect(links.live("sess-1", "delivery")).toBe(false);
    expect(links.heartbeat(old.linkId).ok).toBe(false);
    expect(links.heartbeat(next.linkId).ok).toBe(true);
  });

  test("an id change without a live link from the old id registers fresh, with no continuation", () => {
    const { links, store, clock } = harness();
    const bound = store.bind(store.reserve({ identity: "remy.ab12" }), claudeRef("sess-1"), { mode: "herdr", pane: "w1:p1" });
    if (!bound.ok) throw new Error(bound.error.message);

    register(links, "sess-2", { previousSessionId: "sess-1" });
    expect(store.get(bound.data.key)).toEqual(bound.data);
    expect(links.live("sess-2", "delivery")).toBe(true);

    const expired = register(links, "sess-1");
    clock.now += 31_000;
    register(links, "sess-3", { previousSessionId: "sess-1", previousLinkId: expired.linkId });
    expect(store.get(bound.data.key)).toEqual(bound.data);
    expect(store.find(claudeRef("sess-3"))).toBeNull();
    expect(links.live("sess-3", "delivery")).toBe(true);
  });

  test("a register naming a live previous id without its link id does not continue", () => {
    const { links, store } = harness();
    const bound = store.bind(store.reserve({ identity: "remy.ab12" }), claudeRef("sess-1"), { mode: "herdr", pane: "w1:p1" });
    if (!bound.ok) throw new Error(bound.error.message);
    const old = register(links, "sess-1");

    register(links, "sess-2", { previousSessionId: "sess-1" });
    expect(store.get(bound.data.key)).toEqual(bound.data);
    expect(links.heartbeat(old.linkId).ok).toBe(true);
    expect(links.live("sess-1", "delivery")).toBe(true);
    expect(links.live("sess-2", "delivery")).toBe(true);
  });

  test("a wrong previousLinkId does not continue", () => {
    const { links, store } = harness();
    const bound = store.bind(store.reserve({ identity: "remy.ab12" }), claudeRef("sess-1"), { mode: "herdr", pane: "w1:p1" });
    if (!bound.ok) throw new Error(bound.error.message);
    const old = register(links, "sess-1");
    const other = register(links, "sess-other");

    register(links, "sess-2", { previousSessionId: "sess-1", previousLinkId: other.linkId });
    register(links, "sess-3", { previousSessionId: "sess-1", previousLinkId: "ml-forged" });
    expect(store.get(bound.data.key)).toEqual(bound.data);
    expect(links.heartbeat(old.linkId).ok).toBe(true);
    expect(links.heartbeat(other.linkId).ok).toBe(true);
  });

  test("continuing a detached binding is refused and registers fresh", () => {
    const { links, store } = harness();
    const bound = store.bind(store.reserve({ identity: "remy.ab12" }), claudeRef("sess-1"), { mode: "herdr", pane: "w1:p1" });
    if (!bound.ok) throw new Error(bound.error.message);
    const detached = store.detach(bound.data.key, 1);
    if (!detached.ok) throw new Error(detached.error.message);
    const old = register(links, "sess-1");

    const next = register(links, "sess-2", { previousSessionId: "sess-1", previousLinkId: old.linkId });
    expect(store.get(bound.data.key)).toEqual(detached.data);
    expect(store.find(claudeRef("sess-2"))).toBeNull();
    expect(links.linkOf("sess-2")?.linkId).toBe(next.linkId);
  });

  test("a gate asked before a continuation is still open after it", async () => {
    const gates = createGatesStore({ dbPath: join(dir, "gates.db"), log: pino({ level: "silent" }) });
    const { links, store } = harness({
      continued: (key, from, to) => { gates.nativeQuestions().carryGeneration(key, from, to); },
    });
    const bound = store.bind(store.reserve({ identity: "remy.ab12" }), claudeRef("sess-1"), { mode: "herdr", pane: "w1:p1" });
    if (!bound.ok) throw new Error(bound.error.message);
    const gate = gates.open({ subject: "run:r1", kind: "clarify", questions: [{ id: "why", label: "Why?", multi: false, options: [] }] }).row;
    gates.nativeQuestions().bind({ gateId: gate.id, sessionKey: bound.data.key, generation: 1, presentation: "form" });
    const old = register(links, "sess-1");

    register(links, "sess-2", { previousSessionId: "sess-1", previousLinkId: old.linkId });

    expect(gates.get(gate.id)?.status).toBe("open");
    expect(gates.nativeQuestions().get(gate.id)?.generation).toBe(2);
    const completed: string[] = [];
    const questions = createGateQuestions({
      gates,
      storedBinding: (key) => store.get(key),
      supports: () => true,
      questionCapabilities: async () => ["question-recovery", "questions-form"],
      questionsFor: async () => ({ async complete(_b, q) { completed.push(q.gateId); return { ok: true, data: "completed" }; } }),
      connectionOf: () => undefined,
      harnesses: () => ["claude"],
      enabled: () => true,
      now: () => 1,
      recoverLimit: 10,
    });
    gates.answer(gate.id, { why: { value: "", text: "because" } }, "console");
    expect(await questions.completeGateQuestion(gate.id)).toEqual({ ok: true, data: undefined });
    expect(completed).toEqual([gate.id]);
  });

  test("with no links held, a sweep or a read never reads the switch", () => {
    let reads = 0;
    const { links } = harness({ enabled: () => { reads++; return true; } });
    expect(links.sweep()).toBe(0);
    expect(links.live("sess-1", "delivery")).toBe(false);
    expect(links.linkOf("sess-1")).toBeNull();
    expect(links.has("ml-1")).toBe(false);
    expect(links.heartbeat("ml-1").ok).toBe(false);
    expect(reads).toBe(0);
  });

  test("two links for one session id: the newer wins and the older stops counting", () => {
    const { links } = harness();
    const older = register(links, "sess-1", { blocks: ["delivery"] });
    const newer = register(links, "sess-1", { blocks: ["presence"], pane: "w2:p2" });

    expect(links.linkOf("sess-1")).toMatchObject({ linkId: newer.linkId, pane: "w2:p2", blocks: ["presence"] });
    expect(links.live("sess-1", "presence")).toBe(true);
    expect(links.live("sess-1", "delivery")).toBe(false);
    expect(links.heartbeat(older.linkId).ok).toBe(false);
    expect(links.has(older.linkId)).toBe(false);
    links.end(older.linkId);
    expect(links.live("sess-1", "presence")).toBe(true);
    links.end(newer.linkId);
    expect(links.live("sess-1", "presence")).toBe(false);
    expect(links.linkOf("sess-1")).toBeNull();
  });

  test("a link view carries what diagnostics list", () => {
    const { links, clock } = harness();
    const { linkId } = register(links, "sess-1", { blocks: ["delivery", "delivery", "not-a-block" as ModBlock] });
    expect(links.linkOf("sess-1")).toEqual({
      linkId, sessionId: "sess-1", cwd: "/repo", root: "/repo", pane: "w1:p1",
      claudeCode: TESTED_CLAUDE_CODE.max, plugin: "0.1.0", blocks: ["delivery"],
      registeredAt: clock.now, lastHeartbeatAt: clock.now,
    });
  });

  test("an ack is recorded under its command id for the link that sent it", () => {
    const { links, clock } = harness();
    const { linkId } = register(links, "sess-1");
    expect(links.ack("ml-missing", "cmd-1").ok).toBe(false);
    expect(links.ack(linkId, "cmd-1").ok).toBe(true);
    expect(links.takeAck("cmd-1", "sess-1")).toEqual({ linkId, sessionId: "sess-1", at: clock.now });
    expect(links.takeAck("cmd-1", "sess-1")).toBeNull();
  });

  test("the first ack wins, and another session's link cannot ack a command for this one", () => {
    const { links, clock } = harness();
    const one = register(links, "sess-1");
    const two = register(links, "sess-2");

    expect(links.ack(two.linkId, "cmd-1").ok).toBe(true);
    expect(links.takeAck("cmd-1", "sess-1")).toBeNull();

    const first = clock.now;
    expect(links.ack(one.linkId, "cmd-1").ok).toBe(true);
    clock.now += 1_000;
    expect(links.ack(one.linkId, "cmd-1").ok).toBe(true);
    expect(links.takeAck("cmd-1", "sess-1")).toEqual({ linkId: one.linkId, sessionId: "sess-1", at: first });
  });
});

describe("pushModCommand", () => {
  function push(over: Partial<PushDeps> & { ackFrom?: () => string | null } = {}) {
    const h = harness();
    const { linkId } = register(h.links, "sess-1");
    const writes: { socketPath: string; content: string; msgId?: string }[] = [];
    let slept = 0;
    const { ackFrom, ...rest } = over;
    const deps: PushDeps = {
      links: h.links,
      inbox: (sessionId) => (sessionId === "sess-1" ? { socketPath: "/inbox/sess-1.sock" } : null),
      deliver: async (socketPath, content, opts) => {
        writes.push({ socketPath, content, ...(opts?.msgId !== undefined && { msgId: opts.msgId }) });
        return { ok: true };
      },
      now: () => h.clock.now,
      sleep: async (ms) => {
        slept += ms;
        const acker = ackFrom ? ackFrom() : linkId;
        if (acker && writes.length > 0) h.links.ack(acker, "cmd-fixed");
        h.clock.now += ms;
      },
      newId: () => "cmd-fixed",
      ...rest,
    };
    return { ...h, linkId, writes, deps, slept: () => slept };
  }

  test("writes the command envelope to the session's inbox and reports its ack", async () => {
    const p = push();
    const result = await pushModCommand("sess-1", "gate.complete", { gate: "g1" }, p.deps);

    expect(result).toEqual({ ok: true, data: { acked: true } });
    expect(p.writes).toEqual([{
      socketPath: "/inbox/sess-1.sock",
      content: `<rt-mod-command id="cmd-fixed" kind="gate.complete" link="${p.linkId}">{"gate":"g1"}</rt-mod-command>`,
      msgId: "cmd-fixed",
    }]);
    expect(modCommandEnvelope("cmd-fixed", "ping", undefined, "ml-x")).toBe('<rt-mod-command id="cmd-fixed" kind="ping" link="ml-x">null</rt-mod-command>');
  });

  test("pushModCommand writes the session's live link id into the envelope", async () => {
    const p = push({ ackFrom: () => null });
    const first = p.linkId;
    const second = register(p.links, "sess-1").linkId;
    expect(second).not.toBe(first);

    await pushModCommand("sess-1", "gate.complete", {}, p.deps);

    expect(p.writes).toHaveLength(1);
    expect(p.writes[0]!.content).toContain(` link="${second}">`);
    expect(p.writes[0]!.content).not.toContain(first);
  });

  test("an ack from another session's link does not count, and the push reports no ack after 5 s", async () => {
    let other: string | null = null;
    const p = push({ ackFrom: () => other });
    other = register(p.links, "sess-2").linkId;
    const result = await pushModCommand("sess-1", "gate.complete", {}, p.deps);

    expect(result).toEqual({ ok: true, data: { acked: false } });
    expect(p.slept()).toBeGreaterThanOrEqual(MOD_COMMAND_ACK_MS);
    expect(p.slept()).toBeLessThan(MOD_COMMAND_ACK_MS + 1_000);
  });

  test("a session with no live link or no inbox gets nothing written", async () => {
    const p = push();
    const noLink = await pushModCommand("sess-9", "ping", null, p.deps);
    expect(noLink.ok).toBe(false);
    if (!noLink.ok) expect(noLink.error.code).toBe("not-ready");

    const noInbox = await pushModCommand("sess-1", "ping", null, { ...p.deps, inbox: () => null });
    expect(noInbox.ok).toBe(false);
    if (!noInbox.ok) expect(noInbox.error.code).toBe("not-ready");

    const noRegistry = await pushModCommand("sess-1", "ping", null, { ...p.deps, links: null });
    expect(noRegistry.ok).toBe(false);
    if (!noRegistry.ok) expect(noRegistry.error.code).toBe("not-ready");
    expect(p.writes).toHaveLength(0);
  });

  test("a failed inbox write is transient, and a kind that cannot ride the envelope is invalid", async () => {
    const p = push();
    const failed = await pushModCommand("sess-1", "ping", null, { ...p.deps, deliver: async () => ({ ok: false, error: "ECONNREFUSED" }) });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe("transient");

    const writes = p.writes.length;
    for (const kind of ["", 'a"b', "a>b", "two words"]) {
      const bad = await pushModCommand("sess-1", kind, null, p.deps);
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.error.code).toBe("invalid");
    }
    expect(p.writes).toHaveLength(writes);
  });
});
