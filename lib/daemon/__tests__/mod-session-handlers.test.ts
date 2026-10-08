import { describe, expect, test } from "bun:test";
import { openStateDb } from "../../state/index.ts";
import { createSessionStore } from "../../agent-integrations/session-store.ts";
import { createModLinks, TESTED_CLAUDE_CODE } from "../../agent-integrations/claude/mod-links.ts";
import { createModSessionHandlers } from "../handlers/mod-session.ts";

function setup(enabled = true) {
  const links = createModLinks({
    now: () => 5_000, integrationsEnabled: () => enabled, store: createSessionStore(openStateDb(":memory:")),
  });
  return { links, handlers: createModSessionHandlers({ links }) };
}

const registration = {
  sessionId: "sess-1", cwd: "/repo", root: "/repo", pane: "w1:p1",
  claudeCode: TESTED_CLAUDE_CODE.max, plugin: "0.1.0", blocks: ["delivery", "presence"],
};

type Reply = { ok: boolean; data?: unknown; error?: string; failure?: { code: string; message: string } };
const call = (fn: (payload: never) => Promise<unknown>, payload: unknown) => fn(payload as never) as Promise<Reply>;

describe("session:* handlers", () => {
  test("session:register validates its payload", async () => {
    const { handlers } = setup();
    for (const bad of [
      undefined, {}, { ...registration, sessionId: "" }, { ...registration, cwd: 3 }, { ...registration, root: undefined },
      { ...registration, claudeCode: "" }, { ...registration, plugin: null }, { ...registration, blocks: "delivery" },
      { ...registration, blocks: [1] }, { ...registration, pane: 4 }, { ...registration, previousSessionId: 7 },
    ]) {
      const reply = await call(handlers["session:register"], bad);
      expect(reply.ok).toBe(false);
      expect(reply.failure?.code).toBe("invalid");
    }
  });

  test("session:register answers the link id and the blocks it counts", async () => {
    const { handlers, links } = setup();
    const reply = await call(handlers["session:register"], registration);
    expect(reply.ok).toBe(true);
    const data = reply.data as { linkId: string; blocks: string[] };
    expect(data.blocks).toEqual(["delivery", "presence"]);
    expect(links.linkOf("sess-1")?.linkId).toBe(data.linkId);
  });

  test("session:register with the switch off is refused", async () => {
    const { handlers } = setup(false);
    const reply = await call(handlers["session:register"], registration);
    expect(reply.ok).toBe(false);
    expect(reply.failure?.code).toBe("refused");
  });

  test("session:heartbeat, session:end and session:ack validate their payloads", async () => {
    const { handlers } = setup();
    for (const verb of ["session:heartbeat", "session:end", "session:ack"] as const) {
      for (const bad of [undefined, {}, { linkId: "" }, { linkId: 3 }]) {
        const reply = await call(handlers[verb], bad);
        expect(reply.ok).toBe(false);
        expect(reply.failure?.code).toBe("invalid");
      }
    }
    for (const bad of [{ linkId: "ml-1" }, { linkId: "ml-1", id: "" }, { linkId: "ml-1", id: 9 }]) {
      const reply = await call(handlers["session:ack"], bad);
      expect(reply.failure?.code).toBe("invalid");
    }
  });

  test("every session verb answers an unknown link with unknown-link", async () => {
    const { handlers } = setup();
    for (const [verb, payload] of [
      ["session:heartbeat", { linkId: "ml-missing" }],
      ["session:end", { linkId: "ml-missing" }],
      ["session:ack", { linkId: "ml-missing", id: "cmd-1" }],
    ] as const) {
      const reply = await call(handlers[verb], payload);
      expect(reply).toEqual({ ok: false, error: "unknown link", failure: { code: "unknown-link", message: expect.any(String) } });
    }
  });

  test("a known link heartbeats, acks and ends", async () => {
    const { handlers, links } = setup();
    const { linkId } = (await call(handlers["session:register"], registration)).data as { linkId: string };
    expect(await call(handlers["session:heartbeat"], { linkId })).toEqual({ ok: true, data: {} });
    expect(await call(handlers["session:ack"], { linkId, id: "cmd-1" })).toEqual({ ok: true, data: {} });
    expect(links.takeAck("cmd-1", "sess-1")).toMatchObject({ linkId, sessionId: "sess-1" });
    expect(await call(handlers["session:end"], { linkId })).toEqual({ ok: true, data: {} });
    expect(links.live("sess-1", "delivery")).toBe(false);
    expect((await call(handlers["session:heartbeat"], { linkId })).failure?.code).toBe("unknown-link");
  });

  test("session:push validates its payload and answers what the push answered", async () => {
    const links = createModLinks({
      now: () => 5_000, integrationsEnabled: () => true, store: createSessionStore(openStateDb(":memory:")),
    });
    const pushed: unknown[][] = [];
    const handlers = createModSessionHandlers({
      links,
      push: async (sessionId, kind, data) => {
        pushed.push([sessionId, kind, data]);
        return kind === "ping" ? { ok: true, data: { acked: true } } : { ok: false, error: { code: "not-ready", message: "no live link" } };
      },
    });
    for (const bad of [undefined, {}, { sessionId: "", kind: "ping" }, { sessionId: "sess-1" }, { sessionId: "sess-1", kind: 3 }]) {
      const reply = await call(handlers["session:push"], bad);
      expect(reply.failure?.code).toBe("invalid");
    }
    expect(pushed).toHaveLength(0);

    expect(await call(handlers["session:push"], { sessionId: "sess-1", kind: "ping", data: { n: 1 } })).toEqual({ ok: true, data: { acked: true } });
    expect(await call(handlers["session:push"], { sessionId: "sess-1", kind: "nudge" })).toEqual({
      ok: false, error: "no live link", failure: { code: "not-ready", message: "no live link" },
    });
    expect(pushed).toEqual([["sess-1", "ping", { n: 1 }], ["sess-1", "nudge", null]]);
  });
});
