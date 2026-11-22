import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { chatHandoff } from "../chat-handoff.ts";
import { createChatHandlers } from "../../lib/daemon/handlers/chat.ts";
import { closeStateDb, getStateDb } from "../../lib/state/index.ts";
import type { HandoffDeps } from "../../lib/state/chat-handoff.ts";
import { readChatSession } from "../../lib/chat-session.ts";
import { setSetting } from "../../packages/rt-client/src/settings/write.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";

const ENV_KEYS = ["HOME", "CLAUDE_CODE_SESSION_ID", "CLAUDE_PID", "HERDR_PANE_ID"] as const;
let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let home = "";
let server: ReturnType<typeof Bun.serve> | null = null;
const pid = { session: "old" };

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  delete process.env.HERDR_PANE_ID;
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-chat-handoff-")));
  process.env.HOME = home;
  const sockDir = join(home, ".mattstack", "rt");
  mkdirSync(sockDir, { recursive: true });
  setSetting("chat.humanHandle", "matt", "user");
  pid.session = "old";
  const handoffDeps: HandoffDeps = { sessionForPid: () => pid.session, pidAlive: () => true };
  server = Bun.serve({
    unix: join(sockDir, "rt.sock"),
    async fetch(req) {
      const cmd = new URL(req.url).pathname.slice(1);
      const payload = req.method === "POST" ? await req.json() : {};
      const handlers = createChatHandlers({ db: getStateDb(), emitEvent: () => 0, handoffDeps }) as unknown as Record<string, (p: unknown) => Promise<unknown>>;
      const handler = handlers[cmd];
      if (!handler) return Response.json({ ok: false, error: `unknown command: ${cmd}` });
      return Response.json(await handler(payload));
    },
  });
});

afterEach(() => {
  server?.stop(true);
  server = null;
  closeStateDb();
  rmSync(home, { recursive: true, force: true });
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const io = captureOut();
  ui.__test__.setHuman(() => false);
  const exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw Object.assign(new Error("exit"), { exitCode: code ?? 0 });
  }) as never);
  let code = 0;
  let stdout = "";
  let stderr = "";
  try {
    await chatHandoff(args);
  } catch (err) {
    const c = (err as { exitCode?: number }).exitCode;
    if (c === undefined) throw err;
    code = c;
  } finally {
    exitSpy.mockRestore();
    stdout = io.stdout();
    stderr = io.stderr();
    io.restore();
  }
  return { code, stdout, stderr };
}

async function signIn(sessionId: string): Promise<{ handle: string; name: string }> {
  const handlers = createChatHandlers({ db: getStateDb(), emitEvent: () => 0 });
  const r = await handlers["chat:sign-in"]({ sessionId });
  if (!r.ok) throw new Error(r.error);
  return { handle: r.data.handle, name: r.data.name };
}

test("begin, complete and cancel print their --json envelopes", async () => {
  const { handle, name } = await signIn("old");
  process.env.CLAUDE_CODE_SESSION_ID = "old";
  process.env.CLAUDE_PID = "4242";
  const begun = await run(["begin", "--json"]);
  expect(begun.code).toBe(0);
  expect(JSON.parse(begun.stdout)).toEqual({ ok: true, handle });

  pid.session = "new";
  process.env.CLAUDE_CODE_SESSION_ID = "new";
  const done = await run(["complete", "--from", "old", "--json"]);
  expect(done.code).toBe(0);
  expect(JSON.parse(done.stdout)).toEqual({ ok: true, handle, name });

  process.env.CLAUDE_CODE_SESSION_ID = "new";
  process.env.CLAUDE_PID = "4242";
  pid.session = "new";
  await run(["begin", "--json"]);
  const cancelled = await run(["cancel", "--from", "new", "--json"]);
  expect(JSON.parse(cancelled.stdout)).toEqual({ ok: true, signedOut: false });
});

test("complete writes the new session's chat session file", async () => {
  const { handle, name } = await signIn("old");
  process.env.CLAUDE_CODE_SESSION_ID = "old";
  process.env.CLAUDE_PID = "4242";
  await run(["begin", "--json"]);
  pid.session = "new";
  process.env.CLAUDE_CODE_SESSION_ID = "new";
  await run(["complete", "--from", "old", "--json"]);
  expect(readChatSession("new")).toMatchObject({ sessionId: "new", handle, name });
});

test("begin with no CLAUDE_PID fails with a usage failure naming it", async () => {
  await signIn("old");
  process.env.CLAUDE_CODE_SESSION_ID = "old";
  delete process.env.CLAUDE_PID;
  const r = await run(["begin", "--json"]);
  expect(r.code).toBe(1);
  expect(r.stderr).toContain("CLAUDE_PID");
});

test("a refusal prints the envelope and exits 2", async () => {
  process.env.CLAUDE_CODE_SESSION_ID = "stranger";
  process.env.CLAUDE_PID = "4242";
  const r = await run(["begin", "--json"]);
  expect(r.code).toBe(2);
  expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, code: "not-signed-in" });
});
