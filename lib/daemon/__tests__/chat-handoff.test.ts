import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openStateDb, presenceForSession } from "../../state/index.ts";
import type { HandoffDeps } from "../../state/chat-handoff.ts";
import { setSetting } from "../../settings/write.ts";
import { createChatHandlers, type InboxDeps } from "../handlers/chat.ts";

let n = 0;

function fakeSocketPath(): string {
  const p = join(mkdtempSync(join(tmpdir(), "chat-handoff-sock-")), "s.sock");
  writeFileSync(p, "");
  return p;
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

/** "old" signs in, then clears: its inbox is gone and the pid now names "new". */
async function world() {
  const db = openStateDb(join(tmpdir(), `chat-handoff-daemon-${process.pid}-${n++}.db`));
  const sockets = new Map<string, string>([["old", fakeSocketPath()], ["kai", fakeSocketPath()]]);
  const frames = new Map<string, string[]>();
  const inboxDeps: InboxDeps = {
    resolve: (sessionId) => {
      const socketPath = sockets.get(sessionId);
      return socketPath ? { pid: process.pid, socketPath, status: "idle" } : null;
    },
    deliver: async (socketPath, content) => {
      const session = [...sockets].find(([, path]) => path === socketPath)![0];
      frames.set(session, [...(frames.get(session) ?? []), content]);
      return { ok: true };
    },
  };
  const pid: { session: string } = { session: "old" };
  const handoffDeps: HandoffDeps = { sessionForPid: () => pid.session, pidAlive: () => true };
  const h = createChatHandlers({ db, emitEvent: () => 0, inboxDeps, handoffDeps, retryDelayMs: 0 });
  const old = await h["chat:sign-in"]({ sessionId: "old" });
  if (!old.ok) throw new Error(old.error);
  const kai = await h["chat:sign-in"]({ sessionId: "kai", continue: "kai" });
  if (!kai.ok) throw new Error(kai.error);
  const clear = () => {
    sockets.delete("old");
    sockets.set("new", fakeSocketPath());
    pid.session = "new";
  };
  return { db, h, handle: old.data.handle, name: old.data.name, frames, clear };
}

test("begin then complete keeps the handle on the new session", async () => {
  const { db, h, handle, name, clear } = await world();
  expect(await h["chat:handoff-begin"]({ sessionId: "old", pid: 4242 })).toEqual({ ok: true, data: { handle } });
  clear();
  expect(await h["chat:handoff-complete"]({ fromSessionId: "old", sessionId: "new" })).toEqual({ ok: true, data: { handle, name } });
  expect(presenceForSession("new", db)?.handle).toBe(handle);
  expect(presenceForSession("old", db)).toBeNull();
});

test("complete delivers a welcome with the catch-up", async () => {
  const { h, handle, frames, clear } = await world();
  await h["chat:handoff-begin"]({ sessionId: "old", pid: 4242 });
  clear();
  await h["chat:dm"]({ from: "kai", to: handle, body: "sent during the reset", sessionId: "kai" });
  await h["chat:handoff-complete"]({ fromSessionId: "old", sessionId: "new" });
  const welcome = () => (frames.get("new") ?? []).find((f) => f.includes("You're signed in to rt chat as"));
  await waitFor(() => welcome() !== undefined);
  expect(welcome()).toContain("kai: sent during the reset");
});

test("complete refuses another session", async () => {
  const { h, clear } = await world();
  await h["chat:handoff-begin"]({ sessionId: "old", pid: 4242 });
  clear();
  const r = await h["chat:handoff-complete"]({ fromSessionId: "old", sessionId: "intruder" });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.failure?.code).toBe("not-this-session");
});

test("cancel returns signedOut false before the clear", async () => {
  const { h } = await world();
  await h["chat:handoff-begin"]({ sessionId: "old", pid: 4242 });
  expect(await h["chat:handoff-cancel"]({ fromSessionId: "old" })).toEqual({ ok: true, data: { signedOut: false } });
});

test("begin refuses a session that is not signed in", async () => {
  const { h } = await world();
  const r = await h["chat:handoff-begin"]({ sessionId: "stranger", pid: 4242 });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.failure?.code).toBe("not-signed-in");
});

test("a refusal's message is plain copy, and malformed payloads are refused", async () => {
  const { h } = await world();
  const r = await h["chat:handoff-begin"]({ sessionId: "stranger", pid: 4242 });
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error.startsWith("chat: ")).toBe(true);
    expect(r.failure?.message.startsWith("chat: ")).toBe(false);
  }
  for (const bad of [{ sessionId: "old" }, { sessionId: "old", pid: 0 }, { sessionId: "old", pid: -3 }, { sessionId: 7, pid: 4242 }]) {
    expect((await h["chat:handoff-begin"](bad)).ok).toBe(false);
  }
  expect((await h["chat:handoff-complete"]({ fromSessionId: "old" })).ok).toBe(false);
  expect((await h["chat:handoff-cancel"]({})).ok).toBe(false);
});

test("a DM delivered to the old session during the reset comes back in complete's catch-up", async () => {
  const { h, handle, frames, clear } = await world();
  await h["chat:handoff-begin"]({ sessionId: "old", pid: 4242 });
  await h["chat:dm"]({ from: "kai", to: handle, body: "seen by the old session only", sessionId: "kai" });
  await waitFor(() => (frames.get("old") ?? []).some((f) => f.includes("seen by the old session only")));
  clear();
  await h["chat:handoff-complete"]({ fromSessionId: "old", sessionId: "new" });
  const welcome = () => (frames.get("new") ?? []).find((f) => f.includes("You're signed in to rt chat as"));
  await waitFor(() => welcome() !== undefined);
  expect(welcome()).toContain("kai: seen by the old session only");
});

test("a quiet complete hands the welcome back when nothing new arrived during the reset", async () => {
  const { h, handle, frames, clear } = await world();
  await h["chat:dm"]({ from: "kai", to: handle, body: "from before the reset", sessionId: "kai" });
  await Bun.sleep(5);
  await h["chat:handoff-begin"]({ sessionId: "old", pid: 4242 });
  clear();
  const r = await h["chat:handoff-complete"]({ fromSessionId: "old", sessionId: "new", quiet: true });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.data.welcome).toContain("You're signed in to rt chat as");
  await Bun.sleep(30);
  expect((frames.get("new") ?? []).some((f) => f.includes("You're signed in to rt chat as"))).toBe(false);
});

test("a quiet complete still wakes the new session when a message arrived during the reset", async () => {
  const { h, handle, frames, clear } = await world();
  await h["chat:handoff-begin"]({ sessionId: "old", pid: 4242 });
  clear();
  await h["chat:dm"]({ from: "kai", to: handle, body: "pr-usher handoff: please ack", sessionId: "kai" });
  const r = await h["chat:handoff-complete"]({ fromSessionId: "old", sessionId: "new", quiet: true });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.data.welcome).toBeUndefined();
  const welcome = () => (frames.get("new") ?? []).find((f) => f.includes("You're signed in to rt chat as"));
  await waitFor(() => welcome() !== undefined);
  expect(welcome()).toContain("kai: pr-usher handoff: please ack");
});

test("begin can date the hand-off from when the reset was asked for, so a DM in between is caught up", async () => {
  const { h, handle, frames, clear } = await world();
  const askedAt = Date.now();
  await Bun.sleep(5);
  await h["chat:dm"]({ from: "kai", to: handle, body: "between the call and begin", sessionId: "kai" });
  await waitFor(() => (frames.get("old") ?? []).some((f) => f.includes("between the call and begin")));
  await h["chat:handoff-begin"]({ sessionId: "old", pid: 4242, since: askedAt });
  clear();
  await h["chat:handoff-complete"]({ fromSessionId: "old", sessionId: "new" });
  const welcome = () => (frames.get("new") ?? []).find((f) => f.includes("You're signed in to rt chat as"));
  await waitFor(() => welcome() !== undefined);
  expect(welcome()).toContain("kai: between the call and begin");
});
