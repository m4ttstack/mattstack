/**
 * Presence and sign-in through a Claude session's mattstack-mods link, on
 * the daemon side: the link registry, the session:* handlers and the real
 * chat handlers over one state.db. Claude Code's registry and the mod itself
 * are fakes; the mod's answer to a chat-sign-in command is the chat:sign-in
 * call it would make over its link.
 */
import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { execSync } from "child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Logger } from "pino";
import type { ModBlock, NativeSessionRef, Outcome, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import { createModLinks, TESTED_CLAUDE_CODE } from "../claude/mod-links.ts";
import { claudeModSignIn } from "../claude/sessions.ts";
import { continueSessionPresence } from "../presence.ts";
import { createSessionStore, isDetachedAttachment } from "../session-store.ts";
import { readChatSession, writeChatSession } from "../../chat-session.ts";
import { deriveRoomForCwd } from "../../chat-room-cli.ts";
import type { herdrRequest } from "../../herdr/client.ts";
import { createChatHandlers, type InboxDeps } from "../../daemon/handlers/chat.ts";
import { createModSessionHandlers } from "../../daemon/handlers/mod-session.ts";
import { identityForSession } from "../../state/identity-store.ts";
import { listBuddies, openStateDb, presenceForSession, type RegistryDeps } from "../../state/index.ts";
import { withModExecution } from "../../state/presence-store.ts";

let n = 0;
const quiet = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} } as unknown as Logger;
const PANE = "w1:p1";
const claudeRef = (value: string): NativeSessionRef => ({ harness: "claude", profile: "default", kind: "id", value });
const noHerdr = (async () => ({ ok: false, code: "unreachable", message: "no herdr in this test" })) as unknown as typeof herdrRequest;

function gitRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "claude-mod-presence-repo-")));
  execSync("git init -q", { cwd: dir });
  execSync("git config user.email t@example.com", { cwd: dir });
  execSync("git config user.name t", { cwd: dir });
  execSync("git commit --allow-empty -q -m init", { cwd: dir });
  return dir;
}

function bind(db: Database, session: string, identity: string): SessionBinding {
  const store = createSessionStore(db);
  const bound = store.bind(store.reserve({ identity }), claudeRef(session), { mode: "herdr", pane: PANE, pid: process.pid });
  if (!bound.ok) throw new Error(bound.error.message);
  return bound.data;
}

type Pushed = { sessionId: string; kind: string; data: unknown; commandId: string };
type Reply = { ok: boolean; data?: any; error?: string; failure?: { code: string; message: string } };

/**
 * One state.db shared by the link registry, the session:* handlers and the
 * chat handlers, wired as lib/daemon.ts wires them. `mod` is the session's
 * mod: what it reports as its own id and root, and whether it acks.
 */
function fixture(opts: { blocks?: ModBlock[]; root?: string } = {}) {
  const db = openStateDb(join(tmpdir(), `claude-mod-presence-${process.pid}-${n++}.db`));
  const links = createModLinks({
    now: () => Date.now(), integrationsEnabled: () => true, store: createSessionStore(db),
    sessionMoved: (from, to) => continueSessionPresence(from, to, { db, enabled: () => true }),
  });
  const mod = createModSessionHandlers({ links, lifecycle: { db, enabled: () => true } });

  const live = new Set<string>();
  const herdrStatus: Record<string, "busy" | "idle"> = {};
  const inboxDir = mkdtempSync(join(tmpdir(), "claude-mod-presence-inbox-"));
  const entry = (session: string) => {
    const socketPath = join(inboxDir, session);
    writeFileSync(socketPath, "");
    return { pid: process.pid, socketPath, status: herdrStatus[session] ?? ("idle" as const) };
  };
  const frames: Array<{ session: string; content: string }> = [];
  const inboxDeps: InboxDeps = {
    resolve: (session) => (live.has(session) ? entry(session) : null),
    deliver: async (socketPath, content) => {
      frames.push({ session: socketPath.slice(inboxDir.length + 1), content });
      return { ok: true };
    },
  };
  const registryDeps: RegistryDeps = withModExecution(
    { resolve: inboxDeps.resolve, alive: () => true, resolveAll: () => new Map([...live].map((s) => [s, entry(s)])) },
    (sessionId) => links.execution(sessionId),
  );

  const state = { acks: true, sessionId: "", root: opts.root ?? "/repo" };
  const pushed: Pushed[] = [];
  const answers: Array<Promise<Reply>> = [];
  let h: ReturnType<typeof createChatHandlers>;
  const push = async (sessionId: string, kind: string, data: unknown, commandId: string): Promise<Outcome<{ acked: boolean }>> => {
    pushed.push({ sessionId, kind, data, commandId });
    if (!state.acks) return { ok: true, data: { acked: false } };
    const link = links.linkOf(sessionId)!;
    // The mod acks on acceptance and then signs in over its link, so its call can land before the push returns.
    answers.push(h["chat:sign-in"]({ sessionId: state.sessionId, cwd: state.root, linkId: link.linkId, commandId }) as Promise<Reply>);
    return { ok: true, data: { acked: true } };
  };
  h = createChatHandlers({
    db, emitEvent: () => 0, inboxDeps, herdr: noHerdr, log: quiet, retryDelayMs: 0, registryDeps,
    modSignIn: claudeModSignIn({ links: () => links, push }),
  });

  const register = async (sessionId: string, extra: Record<string, unknown> = {}) => {
    state.sessionId = sessionId;
    live.add(sessionId);
    const reply = await (mod["session:register"]({
      sessionId, cwd: state.root, root: state.root, pane: PANE, claudeCode: TESTED_CLAUDE_CODE.max, plugin: "0.1.0",
      blocks: opts.blocks ?? ["delivery", "presence"], ...extra,
    }) as Promise<Reply>);
    if (!reply.ok) throw new Error(reply.error);
    return reply.data.linkId as string;
  };
  const signIn = async (payload: Record<string, unknown>) => {
    const res = (await h["chat:sign-in"](payload)) as Reply;
    if (!res.ok) throw new Error(res.error);
    return res.data;
  };
  const status = (handle: string) => listBuddies(Date.now(), db, registryDeps).find((b) => b.handle === handle)?.status;
  const welcomes = (session: string) => frames.filter((f) => f.session === session && f.content.includes("You're signed in to rt chat"));
  return { db, links, mod, h, live, herdrStatus, frames, state, pushed, answers, register, signIn, status, welcomes };
}

describe("presence through the Claude mod", () => {
  test("turn start and end flip the buddy list between live and idle", async () => {
    const x = fixture();
    const linkId = await x.register("sess-1");
    const { handle } = await x.signIn({ sessionId: "sess-1", pane: PANE });
    bind(x.db, "sess-1", handle);
    // herdr says busy; the link's own turn reports win while its presence block is live.
    x.herdrStatus["sess-1"] = "busy";
    expect(x.status(handle)).toBe("idle");

    expect((await x.mod["session:report"]({ linkId, event: "turn-start" }) as Reply).ok).toBe(true);
    expect(x.status(handle)).toBe("live");
    expect((await x.mod["session:report"]({ linkId, event: "turn-end" }) as Reply).ok).toBe(true);
    expect(x.status(handle)).toBe("idle");
    expect(x.links.execution("sess-1")).toBe("idle");

    const bad = await x.mod["session:report"]({ linkId, event: "turn-sideways" }) as Reply;
    expect(bad.failure?.code).toBe("invalid");
  });

  test("session end signs out", async () => {
    const x = fixture();
    const linkId = await x.register("sess-1");
    const signed = await x.signIn({ sessionId: "sess-1", pane: PANE });
    const binding = bind(x.db, "sess-1", signed.handle);
    writeChatSession({ sessionId: "sess-1", handle: signed.handle, baseHandle: signed.baseHandle, name: signed.name, signedInAt: 1, bound: true });

    expect((await x.mod["session:end"]({ linkId }) as Reply).ok).toBe(true);
    expect(presenceForSession("sess-1", x.db)?.signedOutAt).toBeDefined();
    expect(isDetachedAttachment(createSessionStore(x.db).get(binding.key)!)).toBe(true);
    expect(readChatSession("sess-1")).toBeNull();
    expect(x.links.linkOf("sess-1")).toBeNull();
  });

  test("sign-in through the mod uses the session's own id and root", async () => {
    const root = gitRepo();
    const x = fixture({ root });
    await x.register("sess-1");
    bind(x.db, "sess-1", "reserved");

    // The caller's own cwd is somewhere else (an MCP server's fixed directory); the mod's root wins.
    const signed = await x.signIn({ sessionId: "sess-1", cwd: "/elsewhere", pane: "w9:p9" });
    expect(x.pushed.map((p) => [p.sessionId, p.kind])).toEqual([["sess-1", "chat-sign-in"]]);
    expect(signed).toMatchObject({ sessionId: "sess-1", mod: true, room: deriveRoomForCwd(root) });
    expect(presenceForSession("sess-1", x.db)).toMatchObject({ handle: signed.handle, cwd: root, pane: PANE });
    await Bun.sleep(5);
    expect(x.welcomes("sess-1")).toHaveLength(1);

    // A link may sign in only to answer a command that still waits, and only for its own session.
    const linkId = x.links.linkOf("sess-1")!.linkId;
    const unasked = await x.h["chat:sign-in"]({ sessionId: "sess-1", cwd: root, linkId, commandId: x.pushed[0]!.commandId }) as Reply;
    expect(unasked.ok).toBe(false);
    const other = await x.h["chat:sign-in"]({ sessionId: "sess-2", cwd: root, linkId, commandId: "c-x" }) as Reply;
    expect(other.ok).toBe(false);
    expect(x.pushed).toHaveLength(1);
  });

  test("sign-in survives /clear through the link continuation", async () => {
    const root = gitRepo();
    const x = fixture({ root });
    const first = await x.register("sess-1");
    bind(x.db, "sess-1", "reserved");
    const signed = await x.signIn({ sessionId: "sess-1", pane: PANE });
    writeChatSession({ sessionId: "sess-1", handle: signed.handle, baseHandle: signed.baseHandle, name: signed.name, signedInAt: 1, room: signed.room, bound: true });
    await Bun.sleep(5);
    const framesBefore = x.frames.length;
    const identities = () => (x.db.query("SELECT COUNT(*) AS c FROM chat_identities").get() as { c: number }).c;
    const minted = identities();

    await x.register("sess-2", { previousSessionId: "sess-1", previousLinkId: first });
    x.live.delete("sess-1");

    expect(createSessionStore(x.db).listByNativeValue("sess-2")).toHaveLength(1);
    expect(presenceForSession("sess-1", x.db)).toBeNull();
    expect(presenceForSession("sess-2", x.db)).toMatchObject({ handle: signed.handle, pane: PANE });
    expect(presenceForSession("sess-2", x.db)?.signedOutAt).toBeUndefined();
    expect(identityForSession("sess-2", x.db)?.id).toBe(signed.handle);
    expect(readChatSession("sess-1")).toBeNull();
    expect(readChatSession("sess-2")).toMatchObject({ sessionId: "sess-2", handle: signed.handle, room: signed.room });
    expect(x.status(signed.handle)).toBe("idle");
    await Bun.sleep(5);
    expect(x.frames.length).toBe(framesBefore);
    expect(identities()).toBe(minted);

    // Chat routing finds the continued session: a peer's post reaches it.
    const kai = await x.signIn({ sessionId: "sess-kai", continue: "kai" });
    x.live.add("sess-kai");
    await x.h["chat:join"]({ room: "r", handle: signed.handle, wakeOn: "all" });
    await x.h["chat:join"]({ room: "r", handle: kai.handle });
    const posted = await x.h["chat:post"]({ room: "r", handle: kai.handle, body: "after the clear" }) as Reply;
    expect(posted.ok).toBe(true);
    await Bun.sleep(20);
    expect(x.frames.some((f) => f.session === "sess-2" && f.content.includes("after the clear"))).toBe(true);

    // Signing in again after the clear continues the same identity, with no new mint.
    const again = await x.signIn({ sessionId: "sess-2", pane: PANE });
    expect(again.handle).toBe(signed.handle);
    expect(identities()).toBe(minted + 1);
  });

  test("an unacked sign-in command falls back once to today's daemon-side sign-in", async () => {
    const root = gitRepo();
    const x = fixture({ root });
    await x.register("sess-1");
    bind(x.db, "sess-1", "reserved");
    x.state.acks = false;

    const signed = await x.signIn({ sessionId: "sess-1", cwd: "/caller", pane: PANE });
    expect(x.pushed).toHaveLength(1);
    expect(signed.mod).toBeUndefined();
    expect(signed.room).toBeNull();
    expect(presenceForSession("sess-1", x.db)).toMatchObject({ handle: signed.handle, cwd: "/caller" });

    // The mod's late answer to the command it never acked changes nothing.
    const late = await x.h["chat:sign-in"]({
      sessionId: "sess-1", cwd: root, linkId: x.links.linkOf("sess-1")!.linkId, commandId: x.pushed[0]!.commandId,
    }) as Reply;
    expect(late.ok).toBe(false);
    expect(presenceForSession("sess-1", x.db)?.cwd).toBe("/caller");
  });

  test("without the block, herdr status and the session-end path are used", async () => {
    const x = fixture({ blocks: ["delivery"] });
    const linkId = await x.register("sess-1");
    const signed = await x.signIn({ sessionId: "sess-1", pane: PANE });
    const binding = bind(x.db, "sess-1", signed.handle);
    expect(x.pushed).toHaveLength(0);

    x.herdrStatus["sess-1"] = "busy";
    await x.mod["session:report"]({ linkId, event: "turn-end" });
    expect(x.links.execution("sess-1")).toBeNull();
    expect(x.status(signed.handle)).toBe("live");

    expect(await x.mod["session:owned"]({ sessionId: "sess-1", block: "presence" })).toEqual({ ok: true, data: { owned: false } });
    expect((await x.mod["session:end"]({ linkId }) as Reply).ok).toBe(true);
    expect(presenceForSession("sess-1", x.db)?.signedOutAt).toBeUndefined();
    expect(isDetachedAttachment(createSessionStore(x.db).get(binding.key)!)).toBe(false);
  });

  test("session:owned answers from modPath for the session's one attached binding", async () => {
    const x = fixture();
    expect(await x.mod["session:owned"]({ sessionId: "sess-1", block: "presence" })).toEqual({ ok: true, data: { owned: false } });
    await x.register("sess-1");
    expect(await x.mod["session:owned"]({ sessionId: "sess-1", block: "presence" })).toEqual({ ok: true, data: { owned: false } });
    bind(x.db, "sess-1", "reserved");
    expect(await x.mod["session:owned"]({ sessionId: "sess-1", block: "presence" })).toEqual({ ok: true, data: { owned: true } });
    expect(await x.mod["session:owned"]({ sessionId: "sess-1", block: "gate-form" })).toEqual({ ok: true, data: { owned: false } });
    for (const bad of [{}, { sessionId: "sess-1" }, { sessionId: "sess-1", block: "nonsense" }]) {
      expect(((await x.mod["session:owned"](bad)) as Reply).failure?.code).toBe("invalid");
    }
  });
});
