import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ChatSession } from "../../chat-session.ts";
import { setSetting } from "../../settings/write.ts";
import { SIGN_IN_HINT, type ToolContext } from "../shared.ts";
import { whoamiToolDefs } from "../whoami-tool.ts";

function tool(sessions: Record<string, ChatSession> = {}) {
  const asked: Array<string | undefined> = [];
  const t = whoamiToolDefs({ session: (id) => { asked.push(id); return id ? sessions[id] ?? null : null; } })[0]!;
  return { t, asked };
}

const SIGNED_IN: ChatSession = { sessionId: "s1", handle: "arwen", baseHandle: "arwen", signedInAt: 1, room: "rt" };

describe("whoami", () => {
  test("a signed-in herd worker sees its session, pane, handle and herd identity", async () => {
    const { t, asked } = tool({ s1: SIGNED_IN });
    const r = await t.handler({}, { CLAUDE_CODE_SESSION_ID: "s1", HERDR_PANE_ID: "p1", HERD_ID: "hd-1", HERD_JOB: "j", HERD_ROOM: "herd-room" } as NodeJS.ProcessEnv);
    expect(r.ok).toBe(true);
    expect(r.body).toEqual({
      sessionId: "s1",
      pane: "p1",
      chat: { handle: "arwen", name: "arwen", baseHandle: "arwen", room: "rt" },
      herd: { id: "hd-1", job: "j", room: "herd-room" },
    });
    expect(asked).toEqual(["s1"]);
  });

  test("no session file: chat is null and the sign-in hint rides along", async () => {
    const { t } = tool();
    const r = await t.handler({}, { CLAUDE_CODE_SESSION_ID: "s9" } as NodeJS.ProcessEnv);
    expect(r.ok).toBe(true);
    expect(r.body).toEqual({ sessionId: "s9", pane: null, chat: null, herd: null, hint: SIGN_IN_HINT });
  });

  test("no Claude Code session id: everything null, never an error", async () => {
    const { t } = tool({ s1: SIGNED_IN });
    const r = await t.handler({}, {} as NodeJS.ProcessEnv);
    expect(r.ok).toBe(true);
    expect(r.body).toEqual({ sessionId: null, pane: null, chat: null, herd: null, hint: SIGN_IN_HINT });
  });

  test("HERD_JOB without HERD_ID still reports the herd, since the shepherd tools treat HERD_JOB alone as a worker pane", async () => {
    const { t } = tool({ s1: SIGNED_IN });
    const r = await t.handler({}, { CLAUDE_CODE_SESSION_ID: "s1", HERD_JOB: "j" } as NodeJS.ProcessEnv);
    expect((r.body as { herd: unknown }).herd).toEqual({ id: null, job: "j", room: null });
  });

  test("a session file missing optional fields reports them as null", async () => {
    const { t } = tool({ s1: { sessionId: "s1", handle: "arwen", signedInAt: 1 } as ChatSession });
    const r = await t.handler({}, { CLAUDE_CODE_SESSION_ID: "s1" } as NodeJS.ProcessEnv);
    expect((r.body as { chat: unknown }).chat).toEqual({ handle: "arwen", name: "arwen", baseHandle: null, room: null });
  });

  test("a minted identity reports its name and its id", async () => {
    const { t } = tool({ s1: { sessionId: "s1", handle: "arwen.k3f9", baseHandle: "arwen", name: "arwen", signedInAt: 1, room: "rt" } });
    const r = await t.handler({}, { CLAUDE_CODE_SESSION_ID: "s1" } as NodeJS.ProcessEnv);
    expect((r.body as { chat: unknown }).chat).toEqual({ handle: "arwen.k3f9", name: "arwen", baseHandle: "arwen", room: "rt" });
  });

  test("takes no input", () => {
    const { t } = tool();
    expect(t.inputSchema).toEqual({ type: "object", properties: {}, additionalProperties: false });
  });
});

describe("whoami through session bindings", () => {
  let originalHome: string | undefined;
  beforeEach(() => {
    originalHome = process.env.HOME;
    process.env.HOME = mkdtempSync(join(tmpdir(), "rt-whoami-test-"));
  });
  afterEach(() => {
    process.env.HOME = originalHome;
  });

  const BINDING = {
    key: "sk-fixture", identity: "arwen",
    native: { harness: "codex", profile: "default", kind: "id" as const, value: "thread-one" },
    attachment: { generation: 2, mode: "herdr" as const, pane: "wTK:p1" },
  };
  const RESOLVED: ToolContext = { caller: async () => ({ ok: true, data: { binding: BINDING } }) };
  const UNRESOLVED: ToolContext = { caller: async () => ({ ok: false, error: { code: "ambiguous", message: "no trusted session evidence came with this call" } }) };
  const ENV = { CLAUDE_CODE_SESSION_ID: "s1", HERDR_PANE_ID: "wMP:p0", HERD_ID: "hd-1", HERD_JOB: "j" } as NodeJS.ProcessEnv;

  test("integrations on: reports the bound session, its pane and its chat file, never the inherited environment", async () => {
    setSetting("agent.integrations.enabled", true, "machine");
    const { t, asked } = tool({ "thread-one": { ...SIGNED_IN, sessionId: "thread-one" } });
    const r = await t.handler({}, ENV, undefined, RESOLVED);
    expect(r.ok).toBe(true);
    expect(r.body).toEqual({
      sessionId: "thread-one",
      pane: "wTK:p1",
      chat: { handle: "arwen", name: "arwen", baseHandle: "arwen", room: "rt" },
      herd: { id: "hd-1", job: "j", room: null },
      binding: { key: "sk-fixture", identity: "arwen", harness: "codex", profile: "default", generation: 2 },
    });
    expect(asked).toEqual(["thread-one"]);
  });

  test("integrations on: an unresolved caller is reported, never an error", async () => {
    setSetting("agent.integrations.enabled", true, "machine");
    const { t, asked } = tool({ s1: SIGNED_IN });
    const r = await t.handler({}, ENV, undefined, UNRESOLVED);
    expect(r.ok).toBe(true);
    expect(r.body).toMatchObject({ sessionId: null, pane: null, chat: null, binding: null });
    expect((r.body as { hint: string }).hint).toContain("cannot be attributed");
    expect(asked).toEqual([]);
  });

  test("integrations off: an unresolvable caller changes nothing", async () => {
    const { t } = tool({ s1: SIGNED_IN });
    const before = await t.handler({}, ENV);
    const after = await t.handler({}, ENV, undefined, UNRESOLVED);
    expect(after).toEqual(before);
    expect((after.body as { sessionId: string }).sessionId).toBe("s1");
  });
});
