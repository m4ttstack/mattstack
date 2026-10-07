/**
 * Chat identity and presence across a harness session's lifecycle, with
 * agent.integrations.enabled on (and the same calls with it off, which change
 * nothing). Real chat handlers, pane handlers, state.db and delivery service;
 * the harness messaging, herdr and Claude Code's registry are fakes.
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
import { reportClaudeLifecycle, type ClaudeRegistry } from "../../agent-integrations/claude/sessions.ts";
import { createDeliveryService } from "../../agent-integrations/delivery.ts";
import { lendsPaneIdentity } from "../../agent-integrations/pane-identity.ts";
import { applySessionPresence, withHarnessLiveness } from "../../agent-integrations/presence.ts";
import { createSessionStore, isDetachedAttachment } from "../../agent-integrations/session-store.ts";
import { readChatSession, writeChatSession } from "../../chat-session.ts";
import type { herdrRequest } from "../../herdr/client.ts";
import { requireChatHandle, SIGN_IN_HINT, type ChatBuddiesFn } from "../../mcp/shared.ts";
import { setSetting } from "../../settings/write.ts";
import { listBuddies, openStateDb, presenceForSession, signedInPresenceForPane, type RegistryDeps } from "../../state/index.ts";
import { createChatHandlers, type InboxDeps } from "../handlers/chat.ts";
import { createPaneHandlers } from "../handlers/pane.ts";

let n = 0;
const quiet = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} } as unknown as Logger;
const CODEX_PROFILE = "/codex-home";
const IDLE: Observation = { connectivity: "connected", execution: "idle", background: "unknown", observedAt: 1, source: "test", generation: 1 };

const codexRef = (value: string): NativeSessionRef => ({ harness: "codex", profile: CODEX_PROFILE, kind: "id", value });
const claudeRef = (value: string): NativeSessionRef => ({ harness: "claude", profile: "default", kind: "id", value });

function bind(db: Database, native: NativeSessionRef, pane: string | undefined, identity: string, pid?: number): SessionBinding {
  const store = createSessionStore(db);
  const bound = store.bind(store.reserve({ identity }), native, {
    mode: "herdr", ...(pane !== undefined && { pane }), ...(pid !== undefined && { pid }),
  });
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

/** Claude Code's registry as the session adapter reads it: which session each live Claude process runs. */
function claudeProcesses(runs: Record<number, string>, dead: number[] = []) {
  const registry: ClaudeRegistry = { roots: () => [], read: () => new Map(), sessionForPid: (pid) => runs[pid] ?? null };
  return { registry, processAlive: (pid: number) => !dead.includes(pid) };
}

type Submitted = { binding: SessionBinding; input: PeerInput };

/**
 * One state.db, the real chat and pane handlers and delivery service, and a
 * harness whose messaging records every submission. `inbox` lists the Claude
 * sessions with a live registry inbox; their frames land in `frames`.
 * `paneAgents` is the harness herdr shows running in each pane.
 */
function fixture(opts: {
  inbox?: string[]; link?: () => string | null; observe?: () => Observation | null; herdr?: typeof herdrRequest;
  paneAgents?: Record<string, string>;
} = {}) {
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
  const herdr = opts.herdr ?? (async (method: string, params: { target?: string }) => {
    herdrCalls.push(method);
    const agent = method === "agent.get" && params.target !== undefined ? opts.paneAgents?.[params.target] : undefined;
    if (agent) return { ok: true, result: { agent: { agent, agent_status: "idle" } } };
    return { ok: false, code: "unreachable", message: "no herdr in this test" };
  }) as unknown as typeof herdrRequest;
  const claudeRegistry: RegistryDeps = {
    resolve: inboxDeps.resolve, alive: () => true, resolveAll: () => new Map([...live].map((session) => [session, entry(session)])),
  };
  const registryDeps = withHarnessLiveness(claudeRegistry, { db: () => db, connection: (harness) => (harness === "claude" ? undefined : link()) });
  const observeSession = async () => opts.observe?.() ?? null;
  const h = createChatHandlers({ db, emitEvent: () => 0, inboxDeps, herdr, log: quiet, retryDelayMs: 0, delivery, registryDeps, observeSession });
  const pane = createPaneHandlers({ db, repoIndex: () => ({}), herdr, log: quiet, delivery, observeSession });
  const signIn = async (payload: Record<string, unknown>) => {
    const res = await h["chat:sign-in"](payload);
    if (!res.ok) throw new Error(res.error);
    return res.data;
  };
  const to = (handle: string) => submits.filter((s) => s.input.recipient === handle);
  const roster: ChatBuddiesFn = async () => ({ ok: true, data: { buddies: listBuddies(Date.now(), db, registryDeps) } });
  return { db, h, pane, delivery, submits, frames, herdrCalls, signIn, to, registryDeps, roster, live };
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
    expect(await requireChatHandle({ CLAUDE_CODE_SESSION_ID: "thread-2", HERDR_PANE_ID: "w1:p1" }, () => null, x.roster, (id, pane) => lendsPaneIdentity(id, pane, { db: x.db })))
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

    // Claude Code's compaction, reported by its SessionStart hook under the session's own process.
    const claude = await x.signIn({ sessionId: "sess-c", pane: "w3:p1" });
    const claudeBinding = bind(x.db, claudeRef("sess-c"), "w3:p1", claude.handle, 501);
    const reporter = { env: { HERDR_PANE_ID: "w3:p1" }, ancestry: [900, 501] };
    expect(await reportClaudeLifecycle("sess-c", "compact", reporter, { db: x.db, ...claudeProcesses({ 501: "sess-c" }) })).toBe("applied");
    expect(createSessionStore(x.db).get(claudeBinding.key)?.attachment.generation).toBe(claudeBinding.attachment.generation);
    expect((await x.signIn({ sessionId: "sess-c", pane: "w3:p1" })).handle).toBe(claude.handle);
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

describe("a pane lends its identity only as #708 does", () => {
  const PANE = "w1:p1";
  const env = (session: string) => ({ CLAUDE_CODE_SESSION_ID: session, HERDR_PANE_ID: PANE });

  test("a session moved to the background keeps its identity at its pane", async () => {
    // The original goes on in a background process; the pane's process (501) now runs a new session id.
    const x = fixture({ inbox: ["sess-1"] });
    const original = await x.signIn({ sessionId: "sess-1", pane: PANE });
    bind(x.db, claudeRef("sess-1"), PANE, original.handle, 501);
    const lends = (id: string, pane: string) => lendsPaneIdentity(id, pane, { db: x.db, sessionForPid: (pid) => (pid === 501 ? "sess-moved" : null), alive: () => true });
    expect(await requireChatHandle(env("sess-moved"), () => null, x.roster, lends)).toMatchObject({ handle: original.handle });
  });

  test("a fork starts a fresh identity: its parent no longer runs anywhere to lend from", async () => {
    const x = fixture();
    const original = await x.signIn({ sessionId: "sess-1", pane: PANE });
    bind(x.db, claudeRef("sess-1"), PANE, original.handle, 501);
    const lends = (id: string, pane: string) => lendsPaneIdentity(id, pane, { db: x.db, sessionForPid: (pid) => (pid === 501 ? "sess-fork" : null), alive: () => true });
    expect(await requireChatHandle(env("sess-fork"), () => null, x.roster, lends)).toEqual({ error: SIGN_IN_HINT });
    expect((await x.signIn({ sessionId: "sess-fork", pane: PANE })).handle).not.toBe(original.handle);
  });

  test("a clear starts a fresh identity: the cleared session signed out at its SessionEnd", async () => {
    const x = fixture({ inbox: ["sess-1", "sess-clear"] });
    const original = await x.signIn({ sessionId: "sess-1", pane: PANE });
    writeChatSession({ sessionId: "sess-1", handle: original.handle, baseHandle: original.baseHandle, name: original.name, signedInAt: 1 });
    bind(x.db, claudeRef("sess-1"), PANE, original.handle, 501);
    const ended = await reportClaudeLifecycle("sess-1", "end", { env: { HERDR_PANE_ID: PANE }, ancestry: [700, 501] }, { db: x.db, ...claudeProcesses({ 501: "sess-1" }) });
    expect(ended).toBe("applied");
    expect(readChatSession("sess-1")).toBeNull();
    const lends = (id: string, pane: string) => lendsPaneIdentity(id, pane, { db: x.db, sessionForPid: () => "sess-clear", alive: () => true });
    expect(await requireChatHandle(env("sess-clear"), () => null, x.roster, lends)).toEqual({ error: SIGN_IN_HINT });
    expect((await x.signIn({ sessionId: "sess-clear", pane: PANE })).handle).not.toBe(original.handle);
  });

  test("a bound identity whose process still runs it, or that lives in another pane or harness, is never lent", async () => {
    const x = fixture({ inbox: ["sess-1"] });
    const original = await x.signIn({ sessionId: "sess-1", pane: PANE });
    bind(x.db, claudeRef("sess-1"), PANE, original.handle, 501);
    const still = (id: string, pane: string) => lendsPaneIdentity(id, pane, { db: x.db, sessionForPid: () => "sess-1", alive: () => true });
    expect(await requireChatHandle(env("sess-other"), () => null, x.roster, still)).toEqual({ error: SIGN_IN_HINT });
    expect(lendsPaneIdentity("sess-1", "w9:p9", { db: x.db, sessionForPid: () => "sess-moved", alive: () => true })).toBe(false);
    bind(x.db, codexRef("thread-1"), PANE, "codex-identity");
    expect(lendsPaneIdentity("thread-1", PANE, { db: x.db, sessionForPid: () => null, alive: () => false })).toBe(false);
  });
});

describe("lifecycle events count only from the session's own process", () => {
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

  test("a Claude Code session resumed in another process survives its old process's SessionEnd, in herdr or not", async () => {
    for (const panes of [{ old: "w1:p1", now: "w2:p1" }, { old: undefined, now: undefined }]) {
      const x = fixture();
      const original = await x.signIn({ sessionId: "sess-1", ...(panes.old && { pane: panes.old }) });
      writeChatSession({ sessionId: "sess-1", handle: original.handle, baseHandle: original.baseHandle, name: original.name, signedInAt: 1 });
      const bound = bind(x.db, claudeRef("sess-1"), panes.old, original.handle, 501);
      const procs = claudeProcesses({ 501: "sess-1", 777: "sess-1" });
      const from = (pid: number, pane?: string) => ({ env: pane ? { HERDR_PANE_ID: pane } : {}, ancestry: [pid] });

      expect(await reportClaudeLifecycle("sess-1", "resume", from(777, panes.now), { db: x.db, ...procs })).toBe("applied");
      expect(createSessionStore(x.db).get(bound.key)?.attachment).toMatchObject({ generation: bound.attachment.generation + 1, pid: 777 });
      if (panes.now) expect(presenceForSession("sess-1", x.db)?.pane).toBe(panes.now);

      expect(await reportClaudeLifecycle("sess-1", "end", from(501, panes.old), { db: x.db, ...procs })).toBe("stale");
      expect(presenceForSession("sess-1", x.db)?.signedOutAt).toBeUndefined();
      expect(readChatSession("sess-1")?.handle).toBe(original.handle);

      expect(await reportClaudeLifecycle("sess-1", "end", from(777, panes.now), { db: x.db, ...procs })).toBe("applied");
      expect(presenceForSession("sess-1", x.db)?.signedOutAt).toBeDefined();
      expect(readChatSession("sess-1")).toBeNull();
    }
  });

  test("a report from outside the session's process tree is refused, whatever it names", async () => {
    const x = fixture();
    const victim = await x.signIn({ sessionId: "sess-v", pane: "w1:p1" });
    writeChatSession({ sessionId: "sess-v", handle: victim.handle, baseHandle: victim.baseHandle, name: victim.name, signedInAt: 1 });
    const bound = bind(x.db, claudeRef("sess-v"), "w1:p1", victim.handle, 501);
    // 900 is no Claude process; 600 is another session's Claude process; 501 runs the victim but is not an ancestor.
    const procs = claudeProcesses({ 501: "sess-v", 600: "sess-other" });
    for (const ancestry of [[900, 901], [900, 600]]) {
      const forged = { env: { HERDR_PANE_ID: "w9:p9" }, ancestry };
      expect(await reportClaudeLifecycle("sess-v", "resume", forged, { db: x.db, ...procs })).toBe("unverified");
      expect(await reportClaudeLifecycle("sess-v", "end", forged, { db: x.db, ...procs })).toBe("unverified");
    }
    expect(createSessionStore(x.db).get(bound.key)?.attachment).toMatchObject({ generation: bound.attachment.generation, pane: "w1:p1", pid: 501 });
    expect(presenceForSession("sess-v", x.db)).toMatchObject({ pane: "w1:p1" });
    expect(presenceForSession("sess-v", x.db)?.signedOutAt).toBeUndefined();
    expect(readChatSession("sess-v")?.handle).toBe(victim.handle);

    // A Claude process whose registry row names the session but is no longer alive moves nothing.
    const gone = await reportClaudeLifecycle("sess-v", "resume", { env: {}, ancestry: [777] }, { db: x.db, ...claudeProcesses({ 777: "sess-v" }, [777]) });
    expect(gone).toBe("unverified");
    expect(createSessionStore(x.db).get(bound.key)?.attachment.generation).toBe(bound.attachment.generation);
  });

  test("the session's own report of a session no binding names is left to the caller's path", async () => {
    const x = fixture();
    await x.signIn({ sessionId: "sess-loose", pane: "w1:p1" });
    const reporter = { env: { HERDR_PANE_ID: "w1:p1" }, ancestry: [501] };
    expect(await reportClaudeLifecycle("sess-loose", "end", reporter, { db: x.db, ...claudeProcesses({ 501: "sess-loose" }) })).toBe("unbound");
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
    let observed: Observation | null = IDLE;
    const x = fixture({ observe: () => observed, paneAgents: { "w1:p1": "codex" } });
    const t1 = await x.signIn({ sessionId: "thread-1", pane: "w1:p1" });
    bind(x.db, codexRef("thread-1"), "w1:p1", t1.handle);

    const sent = await x.h["chat:invite"]({ paneId: "w1:p1", room: "build", from: "matt", note: "the deploy is red" });
    expect(sent).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "queued" } });
    const invite = x.to(t1.handle).find((s) => s.input.body.includes("#build"))!;
    expect(invite.input.sender).toBe("matt");
    expect(invite.input.body).toContain('chat_join (room "build")');
    expect(invite.input.body).toContain("note from matt: the deploy is red");
    expect(x.herdrCalls).toEqual(["agent.get"]);

    observed = { ...IDLE, execution: "blocked" };
    const before = x.submits.length;
    const blocked = await x.h["chat:invite"]({ paneId: "w1:p1", room: "build", from: "matt" });
    expect(blocked).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "refused", reason: "at a prompt" } });
    expect(x.submits.length).toBe(before);
    expect(x.herdrCalls).toEqual(["agent.get", "agent.get"]);

    const self = await x.h["chat:invite"]({ paneId: "w1:p1", room: "build", from: "matt", callerPane: "w1:p1" });
    expect(self).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "refused", reason: "that is this pane" } });
  });

  test("a binding left at a pane where herdr now shows another harness never captures the invite", async () => {
    const x = fixture({ observe: () => IDLE, paneAgents: { "w1:p1": "claude" } });
    bind(x.db, codexRef("thread-old"), "w1:p1", "old-codex");
    const res = await x.h["chat:invite"]({ paneId: "w1:p1", room: "build", from: "matt" });
    expect(x.submits).toEqual([]);
    expect(x.herdrCalls).toContain("agent.prompt");
    expect(res.ok).toBe(false);
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

describe("rt pane send goes through the pane's harness", () => {
  test("text and its continuation reach a Codex session as peer input, in order; a question refuses", async () => {
    let observed: Observation | null = IDLE;
    const x = fixture({ observe: () => observed, paneAgents: { "w1:p1": "codex" } });
    bind(x.db, codexRef("thread-1"), "w1:p1", "codex-identity");
    const sent = await x.pane["pane:send"]({ paneId: "w1:p1", text: "run the tests", continuation: "then report", callerPane: "w2:p1" });
    expect(sent).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "queued", continuation: { delivered: "deferred" } } });
    expect(x.submits.map((s) => [s.input.sender, s.input.body])).toEqual([["pane w2:p1", "run the tests"], ["pane w2:p1", "then report"]]);

    observed = { ...IDLE, execution: "blocked" };
    const blocked = await x.pane["pane:send"]({ paneId: "w1:p1", text: "are you there" });
    expect(blocked).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "refused", reason: "at a prompt" } });
    expect(x.submits).toHaveLength(2);
    expect(x.herdrCalls).not.toContain("agent.prompt");
  });

  test("a Claude pane, and every pane with the switch off, keeps herdr's typed prompt", async () => {
    const x = fixture({ paneAgents: { "w1:p1": "claude", "w2:p1": "codex" } });
    bind(x.db, claudeRef("sess-c"), "w1:p1", "claude-identity");
    await x.pane["pane:send"]({ paneId: "w1:p1", text: "hello" });
    setSetting("agent.integrations.enabled", false, "machine");
    bind(x.db, codexRef("thread-1"), "w2:p1", "codex-identity");
    const off = await x.pane["pane:send"]({ paneId: "w2:p1", text: "hello" });
    expect(off).toEqual({ ok: true, data: { paneId: "w2:p1", delivered: "refused", reason: "not a claude pane" } });
    expect(x.submits).toEqual([]);
  });
});

describe("sign-in --pane finds the pane's session through its integration", () => {
  const codexPane = { pane_id: "w1:p1", workspace_id: "w1", tab_id: "t1", agent: "codex", agent_status: "idle", cwd: "/nowhere" };
  /** herdr answering each snapshot from `panes` in turn, the last one for every later call. */
  const herdrShowing = (...panes: Array<Record<string, unknown>>) => {
    let calls = 0;
    return (async (method: string) => {
      if (method === "session.snapshot") {
        const pane = panes[Math.min(calls++, panes.length - 1)];
        return { ok: true, result: { snapshot: { workspaces: [], tabs: [], panes: [pane] } } };
      }
      if (method === "pane.process_info") return { ok: true, result: { process_info: { foreground_process_group_id: null, foreground_processes: [] } } };
      return { ok: false, code: "unreachable", message: method };
    }) as unknown as typeof herdrRequest;
  };
  const handlers = (db: Database, herdr: typeof herdrRequest) =>
    createChatHandlers({ db, emitEvent: () => 0, herdr, log: quiet, paneSessionBudgetMs: 40, paneSessionPollMs: 5, claudeRegistryRoots: [] });

  test("a Codex pane herdr names but reports no session for signs in as the thread bound there, once herdr has had its budget", async () => {
    const x = fixture();
    bind(x.db, codexRef("thread-1"), "w1:p1", "reserved");
    const res = await handlers(x.db, herdrShowing(codexPane))["chat:sign-in"]({ pane: "w1:p1", viaPane: true, noRoom: true });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.sessionId).toBe("thread-1");
  });

  test("an earlier session's binding never answers while herdr is still to report the newer one", async () => {
    const x = fixture();
    bind(x.db, claudeRef("sess-old"), "w1:p1", "old-identity");
    const claudePane = { ...codexPane, agent: "claude" };
    const herdr = herdrShowing(claudePane, { ...claudePane, agent_session: { source: "hook", agent: "claude", kind: "id", value: "sess-new" } });
    const res = await handlers(x.db, herdr)["chat:sign-in"]({ pane: "w1:p1", viaPane: true, noRoom: true });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.sessionId).toBe("sess-new");
  });

  test("a binding of another harness than the one herdr shows never answers", async () => {
    const x = fixture();
    bind(x.db, codexRef("thread-old"), "w1:p1", "old-codex");
    const res = await handlers(x.db, herdrShowing({ ...codexPane, agent: "claude" }))["chat:sign-in"]({ pane: "w1:p1", viaPane: true, noRoom: true });
    expect(res).toEqual({ ok: false, error: 'chat: no agent session found for pane "w1:p1"' });
  });

  test("with the switch off the same pane finds no Claude session, as before", async () => {
    setSetting("agent.integrations.enabled", false, "machine");
    const x = fixture();
    bind(x.db, codexRef("thread-1"), "w1:p1", "reserved");
    const res = await handlers(x.db, herdrShowing(codexPane))["chat:sign-in"]({ pane: "w1:p1", viaPane: true, noRoom: true });
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

    const claude = bind(x.db, claudeRef("sess-c"), "w3:p1", "someone", 501);
    const reporter = { env: { HERDR_PANE_ID: "w4:p1" }, ancestry: [777] };
    expect(await reportClaudeLifecycle("sess-c", "resume", reporter, { db: x.db, ...claudeProcesses({ 777: "sess-c" }) })).toBe("unbound");
    expect(createSessionStore(x.db).get(claude.key)?.attachment).toMatchObject({ generation: claude.attachment.generation, pane: "w3:p1" });
  });

  test("the pane lends its identity, a join counts every newer message, and delivery takes the inbox", async () => {
    const x = fixture({ inbox: ["sess-1", "sess-kai"] });
    const original = await x.signIn({ sessionId: "sess-1", pane: "w1:p1" });
    bind(x.db, claudeRef("sess-1"), "w1:p1", original.handle, 501);
    const lent = await requireChatHandle({ CLAUDE_CODE_SESSION_ID: "sess-fork", HERDR_PANE_ID: "w1:p1" }, () => null, x.roster, (id, pane) => lendsPaneIdentity(id, pane, { db: x.db, sessionForPid: () => "sess-1", alive: () => true }));
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
