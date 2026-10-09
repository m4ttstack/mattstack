import { describe, expect, test } from "bun:test";
import type { Outcome } from "../../../packages/rt-client/src/agent-integrations.ts";
import { openStateDb } from "../../state/index.ts";
import { createSessionStore } from "../../agent-integrations/session-store.ts";
import { createModLinks, TESTED_CLAUDE_CODE } from "../../agent-integrations/claude/mod-links.ts";
import { createStandDownHandlers, type StandDownPush } from "../handlers/stand-down.ts";

type Reply = { ok: boolean; data?: unknown; error?: string; failure?: { code: string; message: string } };
const call = (fn: (payload: never) => Promise<unknown>, payload: unknown) => fn(payload as never) as Promise<Reply>;


function setup(opts: { push?: StandDownPush; enabled?: boolean; blocks?: string[]; pane?: string } = {}) {
  let now = 5_000;
  const links = createModLinks({
    now: () => now, integrationsEnabled: () => opts.enabled ?? true, store: createSessionStore(openStateDb(":memory:")),
  });
  const pushed: { sessionId: string; kind: string; data: unknown; id: string }[] = [];
  const push: StandDownPush = opts.push ?? (async (sessionId, kind, data, id) => {
    pushed.push({ sessionId, kind, data, id });
    return { ok: true, data: { acked: true } };
  });
  const handlers = createStandDownHandlers({
    links, push, now: () => now, sleep: async (ms) => { now += ms; },
  });
  const registered = links.register({
    sessionId: "sess-1", cwd: "/repo", root: "/repo", pane: opts.pane ?? "w1:p1",
    claudeCode: TESTED_CLAUDE_CODE.max, plugin: "0.2.6", blocks: (opts.blocks ?? ["observe", "board"]) as never,
  });
  const linkId = registered.ok ? registered.data.linkId : "";
  return { links, handlers, pushed, linkId };
}

describe("board:stand-down", () => {
  test("pushes stand-down to the board pane's session and returns the state its block reports", async () => {
    const s = setup({
      push: async (_sessionId, _kind, _data, id) => {
        // The block acks first, then reports once it has aborted the turn.
        queueMicrotask(() => void call(s.handlers["session:stood-down"], { linkId: s.linkId, commandId: id, state: "stood-down-background" }));
        return { ok: true, data: { acked: true } } as Outcome<{ acked: boolean }>;
      },
    });
    expect(await call(s.handlers["board:stand-down"], { pane: "w1:p1" })).toEqual({
      ok: true, data: { acked: true, sessionId: "sess-1", state: "stood-down-background" },
    });
  });

  test("an acked stand-down with no report in time still counts as the mod's", async () => {
    const s = setup();
    const reply = await call(s.handlers["board:stand-down"], { pane: "w1:p1", text: "a caller's words are never forwarded" });
    expect(reply).toEqual({ ok: true, data: { acked: true, sessionId: "sess-1" } });
    expect(s.pushed.map((p) => [p.sessionId, p.kind, p.data])).toEqual([["sess-1", "stand-down", {}]]);
  });

  test("an unacked push answers acked false, so the board falls back once", async () => {
    const s = setup({ push: async () => ({ ok: true, data: { acked: false } }) });
    expect(await call(s.handlers["board:stand-down"], { pane: "w1:p1" })).toEqual({ ok: true, data: { acked: false } });
  });

  test("a push that fails answers acked false", async () => {
    const s = setup({ push: async () => ({ ok: false, error: { code: "not-ready", message: "no inbox" } }) });
    expect(await call(s.handlers["board:stand-down"], { pane: "w1:p1" })).toEqual({ ok: true, data: { acked: false } });
  });

  test("a pane with no live board block is never pushed to", async () => {
    for (const s of [setup({ blocks: ["observe"] }), setup({ pane: "w9:p9" }), setup({ enabled: false })]) {
      expect(await call(s.handlers["board:stand-down"], { pane: "w1:p1" })).toEqual({ ok: true, data: { acked: false } });
      expect(s.pushed).toEqual([]);
    }
  });

  test("validates its payload", async () => {
    const s = setup();
    for (const bad of [undefined, {}, { pane: "" }, { pane: 3 }]) {
      const reply = await call(s.handlers["board:stand-down"], bad);
      expect(reply.failure?.code).toBe("invalid");
    }
    expect(s.pushed).toEqual([]);
  });
});

describe("session:stood-down and board:stand-down-state", () => {
  test("the latest report is the session's state until its link ends", async () => {
    const s = setup();
    const state = () => call(s.handlers["board:stand-down-state"], { sessionId: "sess-1" });
    expect(await state()).toEqual({ ok: true, data: { state: null } });

    expect(await call(s.handlers["session:stood-down"], { linkId: s.linkId, commandId: "c-1", state: "stood-down-background" })).toEqual({ ok: true, data: {} });
    expect(await state()).toEqual({ ok: true, data: { state: "stood-down-background" } });
    await call(s.handlers["session:stood-down"], { linkId: s.linkId, commandId: "c-1", state: "background-finished" });
    expect(await state()).toEqual({ ok: true, data: { state: "background-finished" } });

    s.links.end(s.linkId);
    expect(await state()).toEqual({ ok: true, data: { state: "ended" } });
  });

  test("only a live link carrying the board block reports", async () => {
    const s = setup({ blocks: ["observe"] });
    const refused = await call(s.handlers["session:stood-down"], { linkId: s.linkId, commandId: "c-1", state: "stood-down" });
    expect(refused.failure?.code).toBe("refused");
    const unknown = await call(s.handlers["session:stood-down"], { linkId: "ml-forged", commandId: "c-1", state: "stood-down" });
    expect(unknown.failure?.code).toBe("unknown-link");
    for (const bad of [{ linkId: s.linkId, commandId: "", state: "stood-down" }, { linkId: s.linkId, commandId: "c-1", state: "gone" }]) {
      expect((await call(s.handlers["session:stood-down"], bad)).failure?.code).toBe("invalid");
    }
  });
});
