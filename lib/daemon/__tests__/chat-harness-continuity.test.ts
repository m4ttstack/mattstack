/**
 * Chat identity and presence across a harness session's lifecycle, with
 * agent.integrations.enabled on (and the same calls with it off, which change
 * nothing). Real chat handlers, state.db and delivery service; the harness
 * messaging, herdr and Claude Code's registry are fakes.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Logger } from "pino";
import type {
  DeliveryReceipt, NativeSessionRef, Observation, Outcome, PeerInput, SessionBinding,
} from "../../../packages/rt-client/src/agent-integrations.ts";
import { reportClaudeLifecycle } from "../../agent-integrations/claude/sessions.ts";
import { lendsPaneIdentity } from "../../agent-integrations/context.ts";
import { createDeliveryService } from "../../agent-integrations/delivery.ts";
import { applySessionPresence, withHarnessLiveness } from "../../agent-integrations/presence.ts";
import { createSessionStore, isDetachedAttachment } from "../../agent-integrations/session-store.ts";
import { readChatSession, writeChatSession } from "../../chat-session.ts";
import type { herdrRequest } from "../../herdr/client.ts";
import { requireChatHandle, SIGN_IN_HINT, type ChatBuddiesFn } from "../../mcp/shared.ts";
import { setSetting } from "../../settings/write.ts";
import { listBuddies, openStateDb, presenceForSession, signedInPresenceForPane, type RegistryDeps } from "../../state/index.ts";
import { createChatHandlers, type InboxDeps } from "../handlers/chat.ts";

let n = 0;
const quiet = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} } as unknown as Logger;
const CODEX_PROFILE = "/codex-home";

const codexRef = (value: string): NativeSessionRef => ({ harness: "codex", profile: CODEX_PROFILE, kind: "id", value });
const claudeRef = (value: string): NativeSessionRef => ({ harness: "claude", profile: "default", kind: "id", value });

function bind(db: Database, native: NativeSessionRef, pane: string | undefined, identity: string): SessionBinding {
  const store = createSessionStore(db);
  const bound = store.bind(store.reserve({ identity }), native, { mode: "herdr", ...(pane !== undefined && { pane }) });
  if (!bound.ok) throw new Error(bound.error.message);
  return bound.data;
}

function moveTo(db: Database, binding: SessionBinding, pane: string): SessionBinding {
  const moved = createSessionStore(db).replaceAttachment(binding.key, binding.attachment.generation, { mode: "herdr", pane });
  if (!moved.ok) throw new Error(moved.error.message);
  return moved.data;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 2000) throw new Error("waitFor: timed out");
    await Bun.sleep(2);
  }
}

type Submitted = { binding: SessionBinding; input: PeerInput };

/**
 * One state.db, the real chat handlers and delivery service, and a harness
 * whose messaging records every submission. `inbox` lists the Claude
 * sessions with a live registry inbox; their frames land in `frames`.
 */
function fixture(opts: { inbox?: string[]; link?: () => string | null; observe?: () => Observation | null; herdr?: typeof herdrRequest } = {}) {
  const db = openStateDb(join(tmpdir(), `chat-continuity-${process.pid}-${n++}.db`));
  const submits: Submitted[] = [];
  const messaging = {
    submit: async (binding: SessionBinding, input: PeerInput): Promise<Outcome<DeliveryReceipt>> => {
      submits.push({ binding, input });
      return { ok: true, data: { id: input.id, evidence: "queued" } };
    },
  };
  const link = opts.link ?? (() => "conn-1");
  const delivery = createDeliveryService({
    db: () => db, messagingFor: async () => messaging, storedBinding: (key) => createSessionStore(db).get(key),
    connectionOf: (harness) => (harness === "claude" ? undefined : link()), sleep: async () => {}, retryDelayMs: 0, log: quiet,
  });
  const frames: Array<{ session: string; content: string }> = [];
  const live = new Set(opts.inbox ?? []);
  // inboxAlive checks the pid and the socket path for real; the frames themselves are captured.
  const inboxDir = mkdtempSync(join(tmpdir(), "chat-continuity-inbox-"));
  const entry = (session: string) => {
    const socketPath = join(inboxDir, session);
    writeFileSync(socketPath, "");
    return { pid: process.pid, socketPath, status: "idle" as const };
  };
  const inboxDeps: InboxDeps = {
    resolve: (session) => (live.has(session) ? entry(session) : null),
    deliver: async (socketPath, content) => {
      frames.push({ session: socketPath.slice(inboxDir.length + 1), content });
      return { ok: true };
    },
  };
  const herdrCalls: string[] = [];
  const herdr = opts.herdr ?? (async (method: string) => {
    herdrCalls.push(method);
    return { ok: false, code: "unreachable", message: "no herdr in this test" };
  }) as unknown as typeof herdrRequest;
  const claudeRegistry: RegistryDeps = {
    resolve: inboxDeps.resolve, alive: () => true, resolveAll: () => new Map([...live].map((session) => [session, entry(session)])),
  };
  const registryDeps = withHarnessLiveness(claudeRegistry, { db: () => db, connection: (harness) => (harness === "claude" ? undefined : link()) });
  const h = createChatHandlers({
    db, emitEvent: () => 0, inboxDeps, herdr, log: quiet, retryDelayMs: 0, delivery, registryDeps,
    observeSession: async () => opts.observe?.() ?? null,
  });
  const signIn = async (payload: Record<string, unknown>) => {
    const res = await h["chat:sign-in"](payload);
    if (!res.ok) throw new Error(res.error);
    return res.data;
  };
  const to = (handle: string) => submits.filter((s) => s.input.recipient === handle);
  return { db, h, delivery, submits, frames, herdrCalls, signIn, to, registryDeps };
}

function caller(binding: SessionBinding) {
  return { caller: async () => ({ ok: true as const, data: { binding } }) };
}

beforeEach(() => {
  setSetting("chat.humanHandle", "matt", "user");
  setSetting("agent.integrations.enabled", true, "machine");
});
afterEach(() => setSetting("agent.integrations.enabled", false, "machine"));

describe("chat identity follows the native session, not the pane", () => {
  test("same thread resume keeps identity but reused pane does not", async () => {
    const x = fixture();
    const original = await x.signIn({ sessionId: "thread-1", pane: "w1:p1" });
    const first = bind(x.db, codexRef("thread-1"), "w1:p1", original.handle);
    await applySessionPresence(first, "start", { db: x.db });
    expect(signedInPresenceForPane("w1:p1", x.db)?.handle).toBe(original.handle);

    // A fresh thread opens in the same pane: the pane lends it nobody's identity.
    await Bun.sleep(2);
    const second = bind(x.db, codexRef("thread-2"), "w1:p1", "reserved-for-thread-2");
    await applySessionPresence(second, "start", { db: x.db });
    expect(signedInPresenceForPane("w1:p1", x.db)).toBeNull();
    const roster: ChatBuddiesFn = async () => ({ ok: true, data: { buddies: listBuddies(Date.now(), x.db, x.registryDeps) } });
    expect(await requireChatHandle({ CLAUDE_CODE_SESSION_ID: "thread-2", HERDR_PANE_ID: "w1:p1" }, () => null, roster, (id) => lendsPaneIdentity(id, { db: x.db })))
      .toEqual({ error: SIGN_IN_HINT });
    const fresh = await x.signIn({ sessionId: "thread-2", pane: "w1:p1" });
    expect(fresh.handle).not.toBe(original.handle);

    // The first thread resumes, in another pane: the same identity, seated there.
    const resumedAt = moveTo(x.db, first, "w2:p1");
    await applySessionPresence(resumedAt, "resume", { db: x.db });
    expect(presenceForSession("thread-1", x.db)).toMatchObject({ handle: original.handle, pane: "w2:p1" });
    expect(presenceForSession("thread-1", x.db)?.signedOutAt).toBeUndefined();
    const resumed = await x.signIn({ sessionId: "thread-1", pane: "w2:p1" });
    expect(resumed.handle).toBe(original.handle);
    expect(resumed.continued).toBe(false);
  });

  test("compaction keeps the identity and the attachment, and only refreshes the heartbeat", async () => {
    const x = fixture();
    const original = await x.signIn({ sessionId: "thread-1", pane: "w1:p1" });
    const binding = bind(x.db, codexRef("thread-1"), "w1:p1", original.handle);
    x.db.run("UPDATE chat_presence SET last_seen_at = 5 WHERE session_id = 'thread-1'");
    await applySessionPresence(binding, "compact", { db: x.db, now: () => 9_000 });
    expect(presenceForSession("thread-1", x.db)).toMatchObject({ handle: original.handle, pane: "w1:p1", lastSeenAt: 9_000 });
    expect(createSessionStore(x.db).get(binding.key)?.attachment.generation).toBe(binding.attachment.generation);
    expect((await x.signIn({ sessionId: "thread-1", pane: "w1:p1" })).handle).toBe(original.handle);

    // Claude Code's compaction, reported by its SessionStart hook from the session's own pane.
    const claude = await x.signIn({ sessionId: "sess-c", pane: "w3:p1" });
    const claudeBinding = bind(x.db, claudeRef("sess-c"), "w3:p1", claude.handle);
    expect(await reportClaudeLifecycle("sess-c", "compact", { HERDR_PANE_ID: "w3:p1" }, { db: x.db })).toBe("applied");
    expect(createSessionStore(x.db).get(claudeBinding.key)?.attachment.generation).toBe(claudeBinding.attachment.generation);
    expect((await x.signIn({ sessionId: "sess-c", pane: "w3:p1" })).handle).toBe(claude.handle);
  });

  test("a fork or a clear in the same pane starts a fresh identity", async () => {
    const x = fixture({ inbox: ["sess-1"] });
    const original = await x.signIn({ sessionId: "sess-1", pane: "w1:p1" });
    bind(x.db, claudeRef("sess-1"), "w1:p1", original.handle);
    const roster: ChatBuddiesFn = async () => ({ ok: true, data: { buddies: listBuddies(Date.now(), x.db, x.registryDeps) } });
    const lends = (id: string) => lendsPaneIdentity(id, { db: x.db });

    // A fork: a new session id in the same pane, never signed in.
    const forkEnv = { CLAUDE_CODE_SESSION_ID: "sess-fork", HERDR_PANE_ID: "w1:p1" };
    expect(await requireChatHandle(forkEnv, () => null, roster, lends)).toEqual({ error: SIGN_IN_HINT });
    const forked = await x.signIn({ sessionId: "sess-fork", pane: "w1:p1" });
    expect(forked.handle).not.toBe(original.handle);

    // A clear: the old session ends, and the new one signs in fresh.
    writeChatSession({ sessionId: "sess-1", handle: original.handle, baseHandle: original.baseHandle, name: original.name, signedInAt: 1 });
    expect(await reportClaudeLifecycle("sess-1", "end", { HERDR_PANE_ID: "w1:p1" }, { db: x.db })).toBe("applied");
    expect(presenceForSession("sess-1", x.db)?.signedOutAt).toBeDefined();
    expect(readChatSession("sess-1")).toBeNull();
    const cleared = await x.signIn({ sessionId: "sess-clear", pane: "w1:p1" });
    expect(cleared.handle).not.toBe(original.handle);
  });

  test("self-posts never come back as unread or as a delivery", async () => {
    const x = fixture({ inbox: ["sess-kai"] });
    const original = await x.signIn({ sessionId: "thread-1", pane: "w1:p1" });
    const binding = bind(x.db, codexRef("thread-1"), "w1:p1", original.handle);
    const kai = await x.signIn({ sessionId: "sess-kai", continue: "kai" });
    await x.h["chat:join"]({ room: "r", handle: original.handle, wakeOn: "all" });
    await x.h["chat:join"]({ room: "r", handle: kai.handle, wakeOn: "all" });

    const post = async (handle: string, body: string) => {
      const res = await x.h["chat:post"]({ room: "r", handle, body });
      if (!res.ok) throw new Error(res.error);
    };
    await post(kai.handle, "kai, before the resume");
    await waitFor(() => x.to(original.handle).some((s) => s.input.body.includes("kai, before the resume")));

    await applySessionPresence(moveTo(x.db, binding, "w2:p1"), "resume", { db: x.db });
    await post(original.handle, "mine, after the resume");
    const rejoined = await x.h["chat:join"]({ room: "r", handle: original.handle });
    if (!rejoined.ok) throw new Error(rejoined.error);
    expect(rejoined.data.unread).toBe(0);
    const rooms = await x.h["chat:rooms"]({ handle: original.handle });
    expect(rooms.ok && rooms.data.rooms.find((r) => r.room === "r")?.unread).toBe(0);

    await post(kai.handle, "kai, after the resume");
    await waitFor(() => x.to(original.handle).some((s) => s.input.body.includes("kai, after the resume")));
    expect(x.to(original.handle).some((s) => s.input.body.includes("mine, after the resume"))).toBe(false);
  });
});

describe("lifecycle events name the attachment they came from", () => {
  test("a stale end cannot sign out a replacement attachment", async () => {
    const x = fixture();
    const original = await x.signIn({ sessionId: "thread-1", pane: "w1:p1" });
    writeChatSession({ sessionId: "thread-1", handle: original.handle, baseHandle: original.baseHandle, name: original.name, signedInAt: 1 });
    const first = bind(x.db, codexRef("thread-1"), "w1:p1", original.handle);
    const replacement = moveTo(x.db, first, "w2:p1");
    await applySessionPresence(replacement, "resume", { db: x.db });

    await applySessionPresence(first, "end", { db: x.db });
    expect(presenceForSession("thread-1", x.db)?.signedOutAt).toBeUndefined();
    expect(readChatSession("thread-1")?.handle).toBe(original.handle);
    expect(createSessionStore(x.db).get(first.key)).toMatchObject({ attachment: { generation: replacement.attachment.generation, pane: "w2:p1" } });
    expect(isDetachedAttachment(createSessionStore(x.db).get(first.key)!)).toBe(false);

    await applySessionPresence(replacement, "end", { db: x.db });
    expect(presenceForSession("thread-1", x.db)?.signedOutAt).toBeDefined();
    expect(readChatSession("thread-1")).toBeNull();
    expect(isDetachedAttachment(createSessionStore(x.db).get(first.key)!)).toBe(true);
  });

  test("a Claude Code session resumed in another pane survives its old process's SessionEnd", async () => {
    const x = fixture();
    const original = await x.signIn({ sessionId: "sess-1", pane: "w1:p1" });
    writeChatSession({ sessionId: "sess-1", handle: original.handle, baseHandle: original.baseHandle, name: original.name, signedInAt: 1 });
    const bound = bind(x.db, claudeRef("sess-1"), "w1:p1", original.handle);

    expect(await reportClaudeLifecycle("sess-1", "resume", { HERDR_PANE_ID: "w2:p1" }, { db: x.db })).toBe("applied");
    expect(createSessionStore(x.db).get(bound.key)).toMatchObject({ attachment: { generation: bound.attachment.generation + 1, pane: "w2:p1" } });
    expect(presenceForSession("sess-1", x.db)).toMatchObject({ handle: original.handle, pane: "w2:p1" });

    expect(await reportClaudeLifecycle("sess-1", "end", { HERDR_PANE_ID: "w1:p1" }, { db: x.db })).toBe("stale");
    expect(presenceForSession("sess-1", x.db)?.signedOutAt).toBeUndefined();
    expect(readChatSession("sess-1")?.handle).toBe(original.handle);

    expect(await reportClaudeLifecycle("sess-1", "end", { HERDR_PANE_ID: "w2:p1" }, { db: x.db })).toBe("applied");
    expect(presenceForSession("sess-1", x.db)?.signedOutAt).toBeDefined();
    expect(readChatSession("sess-1")).toBeNull();
  });

  test("a session no binding names is left to the caller's path", async () => {
    const x = fixture();
    await x.signIn({ sessionId: "sess-loose", pane: "w1:p1" });
    expect(await reportClaudeLifecycle("sess-loose", "end", { HERDR_PANE_ID: "w9:p9" }, { db: x.db })).toBe("unbound");
    expect(presenceForSession("sess-loose", x.db)?.signedOutAt).toBeUndefined();
  });
});

describe("delivery goes through the session's harness", () => {
  test("a bound session's welcome and receipts go through its messaging, and the sender's own room post never does", async () => {
    const x = fixture({ inbox: ["sess-kai"] });
    const kai = await x.signIn({ sessionId: "sess-kai", continue: "kai" });
    await x.h["chat:join"]({ room: "r", handle: kai.handle, wakeOn: "all" });
    const early = await x.h["chat:post"]({ room: "r", handle: kai.handle, body: "waiting for you" });
    if (!early.ok) throw new Error(early.error);

    bind(x.db, codexRef("thread-1"), "w1:p1", "pending-identity");
    const t1 = await x.signIn({ sessionId: "thread-1", pane: "w1:p1" });
    await waitFor(() => x.to(t1.handle).some((s) => s.input.sender === "rt chat"));
    const welcome = x.to(t1.handle).find((s) => s.input.sender === "rt chat")!;
    expect(welcome.input.body).toContain(`You're signed in to rt chat as ${t1.name}.`);
    expect(welcome.input.id).toStartWith(`w-${t1.handle}-`);

    await x.h["chat:join"]({ room: "r", handle: t1.handle, wakeOn: "all" });
    const mine = await x.h["chat:post"]({ room: "r", handle: t1.handle, body: "on it" });
    if (!mine.ok) throw new Error(mine.error);
    const acked = await x.h["chat:ack"]({ id: mine.data.id, handle: kai.handle });
    expect(acked.ok).toBe(true);
    await waitFor(() => x.to(t1.handle).some((s) => s.input.sender.endsWith("(ack)")));
    const receipt = x.to(t1.handle).find((s) => s.input.sender.endsWith("(ack)"))!;
    expect(receipt.input.body).toContain(`acknowledged your message #${mine.data.id}`);

    const claimed = await x.h["chat:claim"]({ id: mine.data.id, handle: kai.handle });
    expect(claimed.ok && claimed.data.outcome).toBe("claimed");
    await waitFor(() => x.to(t1.handle).some((s) => s.input.sender.endsWith("(claim)")));
    expect(x.frames.filter((f) => f.session === "thread-1")).toEqual([]);
  });

  test("an invite reaches a session without typed pane input through its messaging, never into a question", async () => {
    let observed: Observation | null = { connectivity: "connected", execution: "idle", background: "unknown", observedAt: 1, source: "test", generation: 1 };
    const x = fixture({ observe: () => observed });
    const t1 = await x.signIn({ sessionId: "thread-1", pane: "w1:p1" });
    bind(x.db, codexRef("thread-1"), "w1:p1", t1.handle);

    const sent = await x.h["chat:invite"]({ paneId: "w1:p1", room: "build", from: "matt", note: "the deploy is red" });
    expect(sent).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "queued" } });
    const invite = x.to(t1.handle).find((s) => s.input.body.includes("#build"))!;
    expect(invite.input.sender).toBe("matt");
    expect(invite.input.body).toContain('chat_join (room "build")');
    expect(invite.input.body).toContain("note from matt: the deploy is red");
    expect(x.herdrCalls).toEqual([]);

    observed = { ...observed!, execution: "blocked" };
    const before = x.submits.length;
    const blocked = await x.h["chat:invite"]({ paneId: "w1:p1", room: "build", from: "matt" });
    expect(blocked).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "refused", reason: "at a prompt" } });
    expect(x.submits.length).toBe(before);
    expect(x.herdrCalls).toEqual([]);

    const self = await x.h["chat:invite"]({ paneId: "w1:p1", room: "build", from: "matt", callerPane: "w1:p1" });
    expect(self).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "refused", reason: "that is this pane" } });
  });

  test("an invite to a Claude Code pane keeps herdr's typed prompt", async () => {
    const x = fixture();
    const c = await x.signIn({ sessionId: "sess-c", pane: "w1:p1" });
    bind(x.db, claudeRef("sess-c"), "w1:p1", c.handle);
    const res = await x.h["chat:invite"]({ paneId: "w1:p1", room: "build", from: "matt" });
    expect(res.ok).toBe(false);
    expect(x.herdrCalls).toEqual(["agent.get"]);
    expect(x.submits).toEqual([]);
  });

  test("a session outside Claude Code's registry is on the roster while its harness is connected", async () => {
    let link: string | null = "conn-1";
    const x = fixture({ link: () => link });
    const t1 = await x.signIn({ sessionId: "thread-1", pane: "w1:p1" });
    bind(x.db, codexRef("thread-1"), "w1:p1", t1.handle);
    const status = () => listBuddies(Date.now(), x.db, x.registryDeps).find((b) => b.sessionId === "thread-1")?.status;
    expect(status()).toBe("idle");
    link = null;
    expect(status()).toBe("offline");
  });
});

describe("sign-in --pane finds the pane's session through its integration", () => {
  const snapshotWith = (pane: Record<string, unknown>) => (async (method: string) => (method === "session.snapshot"
    ? { ok: true, result: { snapshot: { workspaces: [], tabs: [], panes: [pane] } } }
    : method === "pane.process_info"
      ? { ok: true, result: { process_info: { foreground_process_group_id: null, foreground_processes: [] } } }
      : { ok: false, code: "unreachable", message: method })) as unknown as typeof herdrRequest;
  const codexPane = { pane_id: "w1:p1", workspace_id: "w1", tab_id: "t1", agent: "codex", agent_status: "idle", cwd: "/nowhere" };

  test("a Codex pane signs in as the thread bound there", async () => {
    const x = fixture({ herdr: snapshotWith(codexPane) });
    bind(x.db, codexRef("thread-1"), "w1:p1", "reserved");
    const res = await x.h["chat:sign-in"]({ pane: "w1:p1", viaPane: true, noRoom: true });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.sessionId).toBe("thread-1");
  });

  test("with the switch off the same pane finds no Claude session, as before", async () => {
    setSetting("agent.integrations.enabled", false, "machine");
    const x = fixture({ herdr: snapshotWith(codexPane) });
    bind(x.db, codexRef("thread-1"), "w1:p1", "reserved");
    const h = createChatHandlers({
      db: x.db, emitEvent: () => 0, herdr: snapshotWith(codexPane), log: quiet, paneSessionBudgetMs: 0, paneSessionPollMs: 1, claudeRegistryRoots: [],
    });
    const res = await h["chat:sign-in"]({ pane: "w1:p1", viaPane: true, noRoom: true });
    expect(res).toEqual({ ok: false, error: 'chat: no Claude session found for pane "w1:p1"' });
  });
});

describe("with agent.integrations.enabled off nothing changes", () => {
  beforeEach(() => setSetting("agent.integrations.enabled", false, "machine"));

  test("lifecycle events are ignored", async () => {
    const x = fixture();
    const original = await x.signIn({ sessionId: "thread-1", pane: "w1:p1" });
    writeChatSession({ sessionId: "thread-1", handle: original.handle, baseHandle: original.baseHandle, name: original.name, signedInAt: 1 });
    const binding = bind(x.db, codexRef("thread-1"), "w1:p1", original.handle);
    await applySessionPresence({ ...binding, attachment: { ...binding.attachment, pane: "w2:p1" } }, "resume", { db: x.db });
    await applySessionPresence(binding, "end", { db: x.db });
    expect(presenceForSession("thread-1", x.db)).toMatchObject({ pane: "w1:p1" });
    expect(presenceForSession("thread-1", x.db)?.signedOutAt).toBeUndefined();
    expect(readChatSession("thread-1")?.handle).toBe(original.handle);
    expect(isDetachedAttachment(createSessionStore(x.db).get(binding.key)!)).toBe(false);

    const claude = bind(x.db, claudeRef("sess-c"), "w3:p1", "someone");
    expect(await reportClaudeLifecycle("sess-c", "resume", { HERDR_PANE_ID: "w4:p1" }, { db: x.db })).toBe("unbound");
    expect(createSessionStore(x.db).get(claude.key)?.attachment).toMatchObject({ generation: claude.attachment.generation, pane: "w3:p1" });
  });

  test("the pane lends its identity, a join counts every newer message, and delivery takes the inbox", async () => {
    const x = fixture({ inbox: ["sess-1", "sess-kai"] });
    const original = await x.signIn({ sessionId: "sess-1", pane: "w1:p1" });
    bind(x.db, claudeRef("sess-1"), "w1:p1", original.handle);
    const roster: ChatBuddiesFn = async () => ({ ok: true, data: { buddies: listBuddies(Date.now(), x.db, x.registryDeps) } });
    const lent = await requireChatHandle({ CLAUDE_CODE_SESSION_ID: "sess-fork", HERDR_PANE_ID: "w1:p1" }, () => null, roster, (id) => lendsPaneIdentity(id, { db: x.db }));
    expect(lent).toMatchObject({ handle: original.handle });

    const kai = await x.signIn({ sessionId: "sess-kai", continue: "kai" });
    await x.h["chat:join"]({ room: "r", handle: original.handle, wakeOn: "all" });
    await x.h["chat:join"]({ room: "r", handle: kai.handle, wakeOn: "all" });
    const mine = await x.h["chat:post"]({ room: "r", handle: original.handle, body: "mine" });
    if (!mine.ok) throw new Error(mine.error);
    await x.h["chat:ack"]({ id: mine.data.id, handle: kai.handle });
    await waitFor(() => x.frames.some((f) => f.session === "sess-1" && f.content.includes("acknowledged")));
    const rejoined = await x.h["chat:join"]({ room: "r", handle: original.handle });
    expect(rejoined.ok && rejoined.data.unread).toBe(1);
    expect(x.submits).toEqual([]);
  });
});
