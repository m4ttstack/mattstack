import { describe, expect, test } from "bun:test";
import type { Readiness } from "../../../packages/rt-client/src/agent-integrations.ts";
import { createModLinks, TESTED_CLAUDE_CODE } from "../../agent-integrations/claude/mod-links.ts";
import type { SessionStore } from "../../agent-integrations/session-store.ts";
import { createRegistry } from "../../agent-integrations/registry.ts";
import type { HarnessIntegration } from "../../agent-integrations/contracts.ts";
import { createAgentIntegrationHandlers } from "../handlers/agent-integrations.ts";

const ready: Readiness = { ready: true };

function fake(id: "claude" | "codex"): HarnessIntegration {
  return {
    id, label: id, sessionEnv: [],
    messagingConnection: () => null,
    sessionLive: () => undefined,
    capabilities: async (mode) => ({ mode, supported: [], readiness: ready }),
    validateOptions: (options) => ({ ok: true, data: options }),
    options: async () => [],
    loadSessions: async () => { throw new Error("not expected"); },
    loadMessaging: async () => { throw new Error("not expected"); },
    loadQuestions: async () => { throw new Error("not expected"); },
  } as HarnessIntegration;
}

function setup(over: { enabled?: boolean; experimentalApi?: boolean | undefined } = {}) {
  const clock = { now: 1_000_000 };
  let enabled = over.enabled ?? true;
  const links = createModLinks({ now: () => clock.now, integrationsEnabled: () => enabled, store: {} as SessionStore });
  const handlers = createAgentIntegrationHandlers({
    integrations: createRegistry([fake("claude"), fake("codex")]),
    enabled: () => true,
    modLinks: () => links,
    now: () => clock.now,
    experimentalApi: () => over.experimentalApi,
  });
  return { clock, links, handlers, off: () => { enabled = false; } };
}

const list = async (h: ReturnType<typeof setup>["handlers"]) => {
  const res = await h["agent:integrations"]({ mode: "herdr" });
  if (!res.ok) throw new Error(res.error);
  return res.data.integrations;
};

describe("agent:integrations diagnostics", () => {
  test("links and blocks are listed per Claude session", async () => {
    const { links, clock, handlers } = setup();
    const reg = (sessionId: string, blocks: string[]) => links.register({
      sessionId, cwd: "/r", root: "/r", claudeCode: TESTED_CLAUDE_CODE.min, plugin: "mattstack-mods", blocks: blocks as never,
    });
    reg("s1", ["delivery", "presence"]);
    clock.now += 4_000;
    reg("s2", ["gate-form"]);
    clock.now += 6_000;
    const claude = (await list(handlers)).find((s) => s.id === "claude")!;
    expect(claude.diagnostics?.claudeLinks).toEqual([
      { sessionId: "s1", claudeCode: TESTED_CLAUDE_CODE.min, plugin: "mattstack-mods", blocks: ["delivery", "presence"], lastHeartbeatAgoMs: 10_000 },
      { sessionId: "s2", claudeCode: TESTED_CLAUDE_CODE.min, plugin: "mattstack-mods", blocks: ["gate-form"], lastHeartbeatAgoMs: 6_000 },
    ]);
  });

  test("Codex reports experimentalApi true when negotiated", async () => {
    const yes = await list(setup({ experimentalApi: true }).handlers);
    expect(yes.find((s) => s.id === "codex")!.diagnostics).toEqual({ experimentalApi: true });
    const no = await list(setup({ experimentalApi: false }).handlers);
    expect(no.find((s) => s.id === "codex")!.diagnostics).toEqual({ experimentalApi: false });
    const none = await list(setup({ experimentalApi: undefined }).handlers);
    expect(none.find((s) => s.id === "codex")!.diagnostics).toBeUndefined();
  });

  test("switch off lists no links", async () => {
    const { links, handlers, off } = setup();
    links.register({ sessionId: "s1", cwd: "/r", root: "/r", claudeCode: TESTED_CLAUDE_CODE.min, plugin: "p", blocks: ["delivery"] });
    off();
    const claude = (await list(handlers)).find((s) => s.id === "claude")!;
    expect(claude.diagnostics?.claudeLinks ?? []).toEqual([]);
  });

  test("existing agent:integrations fields are unchanged", async () => {
    const { handlers } = setup();
    const [claude] = await list(handlers);
    const { diagnostics: _d, ...rest } = claude!;
    expect(rest).toEqual({
      id: "claude", label: "claude", enabled: true, readiness: ready, capabilities: [], options: [],
    });
  });
});
