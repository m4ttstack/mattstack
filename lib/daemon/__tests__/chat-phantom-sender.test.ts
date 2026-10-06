import { expect, test } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { openStateDb, type RegistryDeps } from "../../state/index.ts";
import type { InboxBinding } from "../../claude-registry.ts";
import { createChatHandlers } from "../handlers/chat.ts";

const PANE = "wMP:p17";
let n = 0;

function handlers(liveSessions: string[]) {
  const db = openStateDb(join(tmpdir(), `chat-phantom-${process.pid}-${n++}.db`));
  const binding: InboxBinding = { pid: process.pid, socketPath: "/fake.sock", status: "busy" };
  const bindings = new Map(liveSessions.map((s) => [s, binding]));
  const registryDeps: RegistryDeps = { resolve: (s) => bindings.get(s) ?? null, alive: () => true, resolveAll: () => bindings };
  return Object.assign(createChatHandlers({ db, emitEvent: () => 0, registryDeps }), { db });
}

async function signInTyler(h: ReturnType<typeof handlers>): Promise<string> {
  const res = await h["chat:sign-in"]({ sessionId: "orig", baseHandle: "tyler", pane: PANE });
  if (!res.ok) throw new Error(res.error);
  await h["chat:join"]({ room: "r", handle: res.data.handle });
  return res.data.handle;
}

test("chat:post refuses a sender nobody signed in as when its pane is signed in as someone else", async () => {
  const h = handlers(["orig"]);
  await signInTyler(h);
  const res = await h["chat:post"]({ room: "r", handle: "hide-mrs-from-board", body: "hi", pane: PANE });
  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("unreachable");
  expect(res.failure).toEqual({ code: "pane-signed-in", message: "This pane is signed in as tyler; post as tyler" });
  expect(h.db.query("SELECT COUNT(*) AS c FROM chat_messages").get()).toEqual({ c: 0 });
});

test("chat:dm refuses a sender nobody signed in as when its pane is signed in as someone else", async () => {
  const h = handlers(["orig"]);
  await signInTyler(h);
  const res = await h["chat:dm"]({ from: "hide-mrs-from-board", to: "kai", body: "hi", pane: PANE });
  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("unreachable");
  expect(res.failure?.code).toBe("pane-signed-in");
});

test("chat:dm refuses a sender nobody signed in as when its session is signed in as someone else", async () => {
  const h = handlers(["orig"]);
  await signInTyler(h);
  const res = await h["chat:dm"]({ from: "hide-mrs-from-board", to: "kai", body: "hi", sessionId: "orig" });
  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("unreachable");
  expect(res.failure?.code).toBe("pane-signed-in");
});

test("a plain unsigned legacy handle still posts and DMs when nothing names a pane", async () => {
  const h = handlers(["orig"]);
  await signInTyler(h);
  await h["chat:join"]({ room: "r", handle: "deploy-bot" });
  expect((await h["chat:post"]({ room: "r", handle: "deploy-bot", body: "shipped" })).ok).toBe(true);
  expect((await h["chat:dm"]({ from: "deploy-bot", to: "kai", body: "shipped" })).ok).toBe(true);
});

test("an unsigned handle posts from a pane nobody is signed in at", async () => {
  const h = handlers(["orig"]);
  await signInTyler(h);
  await h["chat:join"]({ room: "r", handle: "deploy-bot" });
  expect((await h["chat:post"]({ room: "r", handle: "deploy-bot", body: "shipped", pane: "w1:p1" })).ok).toBe(true);
});

test("an unsigned handle posts from a pane whose signed-in session is gone", async () => {
  const h = handlers([]);
  await signInTyler(h);
  await h["chat:join"]({ room: "r", handle: "deploy-bot" });
  expect((await h["chat:post"]({ room: "r", handle: "deploy-bot", body: "shipped", pane: PANE })).ok).toBe(true);
});

test("the pane's own identity posts from its pane", async () => {
  const h = handlers(["orig"]);
  const tyler = await signInTyler(h);
  expect((await h["chat:post"]({ room: "r", handle: tyler, body: "hi", pane: PANE })).ok).toBe(true);
});
