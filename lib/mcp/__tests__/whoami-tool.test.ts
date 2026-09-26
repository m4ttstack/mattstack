import { describe, expect, test } from "bun:test";
import type { ChatSession } from "../../chat-session.ts";
import { SIGN_IN_HINT } from "../shared.ts";
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
      chat: { handle: "arwen", baseHandle: "arwen", room: "rt" },
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

  test("HERD_JOB without HERD_ID still reports the herd, since herd tools guard on HERD_JOB alone", async () => {
    const { t } = tool({ s1: SIGNED_IN });
    const r = await t.handler({}, { CLAUDE_CODE_SESSION_ID: "s1", HERD_JOB: "j" } as NodeJS.ProcessEnv);
    expect((r.body as { herd: unknown }).herd).toEqual({ id: null, job: "j", room: null });
  });

  test("a session file missing optional fields reports them as null", async () => {
    const { t } = tool({ s1: { sessionId: "s1", handle: "arwen", signedInAt: 1 } as ChatSession });
    const r = await t.handler({}, { CLAUDE_CODE_SESSION_ID: "s1" } as NodeJS.ProcessEnv);
    expect((r.body as { chat: unknown }).chat).toEqual({ handle: "arwen", baseHandle: null, room: null });
  });

  test("takes no input", () => {
    const { t } = tool();
    expect(t.inputSchema).toEqual({ type: "object", properties: {}, additionalProperties: false });
  });
});
