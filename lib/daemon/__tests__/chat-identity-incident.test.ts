/**
 * 2026-09-27: a new pane drew "remy", last held weeks earlier, and its
 * welcome handed it the old remy's DM with kai. The spec's first test,
 * against the real handlers and store: session B draws remy after A is
 * pruned and inherits nothing; kai's DM to "remy" reaches B; a reply sent
 * with A's reply-hint id still reaches A.
 */
import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AGENT_NAMES } from "../../chat-names.ts";
import { dmParticipants, openStateDb, setKvValue } from "../../state/index.ts";
import { setSetting } from "../../settings/write.ts";
import { createChatHandlers, type InboxDeps } from "../handlers/chat.ts";

const DAY_MS = 24 * 60 * 60_000;

/** inboxAlive checks process.kill(pid,0) and existsSync(socketPath) for real; `deliver` itself is faked. */
function fakeSocketPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "chat-incident-sock-"));
  const p = join(dir, "s.sock");
  writeFileSync(p, "");
  return p;
}

/** Stamps every pool name as drawn just now except `name`, so the least-recently-used draw lands on it. */
function forceNextDraw(db: ReturnType<typeof openStateDb>, name: string): void {
  const now = Date.now();
  setKvValue("chat", "names", Object.fromEntries(AGENT_NAMES.map((n) => [n, n === name ? 0 : now])), db);
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await Bun.sleep(5);
  }
}

beforeEach(() => {
  setSetting("chat.humanHandle", "matt", "user");
});

test("a recycled pool name never inherits the previous holder's rooms, DMs or catch-up, and replies bind to the id", async () => {
  expect(AGENT_NAMES).toContain("remy");
  const db = openStateDb(join(tmpdir(), `chat-incident-${process.pid}-${Date.now()}.db`));
  const sockets = new Map([["sess-a", fakeSocketPath()], ["sess-b", fakeSocketPath()], ["sess-kai", fakeSocketPath()]]);
  const frames = new Map<string, string[]>();
  const framesOf = (session: string): string[] => frames.get(session) ?? [];
  const inboxDeps: InboxDeps = {
    resolve: (sessionId) => {
      const socketPath = sockets.get(sessionId);
      return socketPath ? { pid: process.pid, socketPath, status: "idle" } : null;
    },
    deliver: async (socketPath, content) => {
      const session = [...sockets].find(([, path]) => path === socketPath)![0];
      frames.set(session, [...framesOf(session), content]);
      return { ok: true };
    },
  };
  const h = createChatHandlers({ db, emitEvent: () => 0, inboxDeps, retryDelayMs: 0 });

  forceNextDraw(db, "remy");
  const a = await h["chat:sign-in"]({ sessionId: "sess-a" });
  if (!a.ok) throw new Error(a.error);
  expect(a.data.name).toBe("remy");
  const kai = await h["chat:sign-in"]({ sessionId: "sess-kai", continue: "kai" });
  if (!kai.ok) throw new Error(kai.error);

  const aToKai = await h["chat:dm"]({ from: a.data.handle, to: "kai", body: "remy to kai", sessionId: "sess-a" });
  if (!aToKai.ok) throw new Error(aToKai.error);
  const aKaiRoom = aToKai.data.room;
  await h["chat:dm"]({ from: "kai", to: a.data.handle, body: "kai to remy", sessionId: "sess-kai" });
  await h["chat:join"]({ room: "rt", handle: a.data.handle });
  await h["chat:post"]({ room: "rt", handle: a.data.handle, body: "remy was here" });
  await waitFor(() => framesOf("sess-kai").some((f) => f.includes("remy to kai")));
  const kaiFrame = framesOf("sess-kai").find((f) => f.includes("remy to kai"))!;
  const hint = /rt chat dm (\S+) "\.\.\."/.exec(kaiFrame)?.[1];
  expect(hint).toBe(a.data.handle);
  expect(kaiFrame).toContain("[dm] remy #");

  await h["chat:sign-out"]({ sessionId: "sess-a" });
  db.run("UPDATE chat_presence SET signed_out_at = ? WHERE session_id = 'sess-a'", [Date.now() - 2 * DAY_MS]);

  forceNextDraw(db, "remy");
  const b = await h["chat:sign-in"]({ sessionId: "sess-b" });
  if (!b.ok) throw new Error(b.error);
  expect(b.data.name).toBe("remy");
  expect(b.data.handle).not.toBe(a.data.handle);
  expect(b.data.continued).toBe(false);

  const bRooms = await h["chat:rooms"]({ handle: b.data.handle });
  if (!bRooms.ok) throw new Error(bRooms.error);
  expect(bRooms.data.rooms).toEqual([]);
  await waitFor(() => framesOf("sess-b").length > 0);
  const welcome = framesOf("sess-b").join("\n");
  expect(welcome).toContain("You're signed in to rt chat as remy.");
  expect(welcome).not.toContain("catch-up:");
  expect(welcome).not.toContain("Reply to a catch-up sender");
  expect(welcome).not.toContain("remy to kai");
  expect(welcome).not.toContain("kai to remy");

  const pair = dmParticipants(aKaiRoom, db)!;
  expect([pair.a, pair.b].sort()).toEqual([a.data.handle, kai.data.handle].sort());

  const toNewRemy = await h["chat:dm"]({ from: "kai", to: "remy", body: "hello new remy", sessionId: "sess-kai" });
  if (!toNewRemy.ok) throw new Error(toNewRemy.error);
  expect(toNewRemy.data.room).not.toBe(aKaiRoom);
  expect(toNewRemy.data.recipients).toEqual([b.data.handle]);
  await waitFor(() => framesOf("sess-b").some((f) => f.includes("hello new remy")));
  expect(framesOf("sess-a").some((f) => f.includes("hello new remy"))).toBe(false);

  const toOldRemy = await h["chat:dm"]({ from: "kai", to: hint!, body: "for the old remy", sessionId: "sess-kai" });
  if (!toOldRemy.ok) throw new Error(toOldRemy.error);
  expect(toOldRemy.data.room).toBe(aKaiRoom);
  expect(toOldRemy.data.recipients).toEqual([a.data.handle]);
  await Bun.sleep(20);
  expect(framesOf("sess-b").some((f) => f.includes("for the old remy"))).toBe(false);
});
