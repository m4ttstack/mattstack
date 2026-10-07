/**
 * lib/chat-session.ts — the session file behind chat presence resolution.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

import {
  currentSessionId,
  deleteChatSession,
  isValidSessionId,
  listChatSessions,
  readChatSession,
  sessionFilePath,
  sessionName,
  signInSession,
  writeChatSession,
  type ChatSession,
} from "../chat-session.ts";
import { createSessionStore } from "../agent-integrations/session-store.ts";
import { UserActionableError } from "../errors.ts";
import { setSetting } from "../settings/write.ts";
import { closeStateDb, getStateDb } from "../state/db.ts";

describe("chat-session", () => {
  let home = "";
  let origHome: string | undefined;
  let origSessionId: string | undefined;

  beforeEach(() => {
    origHome = process.env.HOME;
    origSessionId = process.env.CLAUDE_CODE_SESSION_ID;
    delete process.env.CLAUDE_CODE_SESSION_ID;
    home = mkdtempSync(join(tmpdir(), "rt-chat-session-"));
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (origSessionId === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
    else process.env.CLAUDE_CODE_SESSION_ID = origSessionId;
    rmSync(home, { recursive: true, force: true });
  });

  test("sessionFilePath resolves under the rt home at call-time HOME", () => {
    expect(sessionFilePath("s1")).toBe(join(home, ".mattstack", "rt", "chat", "sessions", "s1.json"));
  });

  test("writeChatSession then readChatSession round-trips", () => {
    const session: ChatSession = {
      sessionId: "s1",
      handle: "x-2",
      baseHandle: "x",
      signedInAt: 1000,
      room: "acme-dev",
    };
    writeChatSession(session);
    expect(readChatSession("s1")).toEqual(session);
  });

  test("readChatSession returns null when no file exists", () => {
    expect(readChatSession("nope")).toBeNull();
  });

  test("readChatSession returns null for an undefined session id", () => {
    expect(readChatSession(undefined)).toBeNull();
  });

  test("readChatSession returns null on a session-id mismatch (a copied ~/.mattstack, a resumed session)", () => {
    // A file AT s1's path whose own sessionId names a different session —
    // the shape a copied ~/.mattstack or a resumed-under-a-new-id session
    // leaves behind. Written directly, not via writeChatSession, since that
    // helper always derives the path from its own argument's sessionId.
    const path = sessionFilePath("s1");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ sessionId: "stale-id", handle: "x", baseHandle: "x", signedInAt: 1000 }));
    expect(readChatSession("s1")).toBeNull();
  });

  test("readChatSession returns null when the file's handle field isn't a string (never coerces undefined into the pidfile-path segment \"undefined\")", () => {
    const path = sessionFilePath("s1");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ sessionId: "s1", baseHandle: "x", signedInAt: 1000 })); // handle omitted entirely
    expect(readChatSession("s1")).toBeNull();
  });

  test("sessionFilePath rejects an id with path-traversal characters", () => {
    expect(() => sessionFilePath("../../etc/passwd")).toThrow(/invalid session id/);
    expect(() => sessionFilePath("a/b")).toThrow(/invalid session id/);
  });

  test("isValidSessionId accepts the charset sessionFilePath allows and rejects everything else", () => {
    expect(isValidSessionId("abc123_.-")).toBe(true);
    expect(isValidSessionId("../x")).toBe(false);
    expect(isValidSessionId("a/b")).toBe(false);
  });

  test("readChatSession degrades a path-traversal id to null rather than throwing (every read-only verb runs this on unvalidated input)", () => {
    expect(readChatSession("../../etc/passwd")).toBeNull();
  });

  test("deleteChatSession removes the file", () => {
    writeChatSession({ sessionId: "s1", handle: "x", baseHandle: "x", signedInAt: 1000 });
    expect(existsSync(sessionFilePath("s1"))).toBe(true);
    deleteChatSession("s1");
    expect(existsSync(sessionFilePath("s1"))).toBe(false);
  });

  test("deleteChatSession is a no-op when the file is already gone", () => {
    expect(() => deleteChatSession("never-existed")).not.toThrow();
  });

  test("currentSessionId prefers --session over the environment variable", () => {
    process.env.CLAUDE_CODE_SESSION_ID = "env-id";
    expect(currentSessionId(["post", "r", "hi", "--session", "flag-id"])).toBe("flag-id");
  });

  test("currentSessionId falls back to CLAUDE_CODE_SESSION_ID when --session is absent", () => {
    process.env.CLAUDE_CODE_SESSION_ID = "env-id";
    expect(currentSessionId(["post", "r", "hi"])).toBe("env-id");
  });

  test("currentSessionId is undefined with neither source", () => {
    expect(currentSessionId(["post", "r", "hi"])).toBeUndefined();
  });

  test("currentSessionId treats --session immediately followed by another flag as missing, not that flag's name", () => {
    expect(currentSessionId(["sign-in", "--session", "--no-room"])).toBeUndefined();
  });

  test("currentSessionId falls back to the environment variable when --session's value looks like a flag", () => {
    process.env.CLAUDE_CODE_SESSION_ID = "env-id";
    expect(currentSessionId(["sign-in", "--session", "--no-room"])).toBe("env-id");
  });

  test("listChatSessions reads every valid session file as written, skipping strays", () => {
    const a: ChatSession = { sessionId: "s1", handle: "remy.ab12", baseHandle: "remy", signedInAt: 1 };
    const b: ChatSession = { sessionId: "s2", handle: "kai", baseHandle: "kai", signedInAt: 2, room: "acme-dev" };
    writeChatSession(a);
    writeChatSession(b);
    const dir = dirname(sessionFilePath("s1"));
    writeFileSync(join(dir, "s3.json"), JSON.stringify({ sessionId: "other", handle: "x", baseHandle: "x", signedInAt: 3 }));
    writeFileSync(join(dir, "s4.json"), "{not json");
    writeFileSync(join(dir, "s5.json.123.abc.tmp"), JSON.stringify({ ...a, sessionId: "s5" }));
    expect(listChatSessions().sort((x, y) => x.sessionId.localeCompare(y.sessionId))).toEqual([a, b]);
  });

  test("listChatSessions is empty before any sign-in", () => {
    expect(listChatSessions()).toEqual([]);
  });

  test("writeChatSession round-trips name, and sessionName falls back to the handle for an older file", () => {
    writeChatSession({ sessionId: "s1", handle: "remy.k3f9", baseHandle: "remy", name: "remy", signedInAt: 1 });
    const read = readChatSession("s1")!;
    expect(read.name).toBe("remy");
    expect(sessionName(read)).toBe("remy");
    expect(sessionName({ handle: "kai" })).toBe("kai");
  });
});

describe("currentSessionId through session bindings", () => {
  let home = "";
  const saved: Record<string, string | undefined> = {};
  const KEYS = ["HOME", "CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID", "CODEX_HOME", "CLAUDE_CONFIG_DIR", "HERDR_PANE_ID"] as const;

  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    for (const k of KEYS) delete process.env[k];
    home = mkdtempSync(join(tmpdir(), "rt-chat-session-caller-"));
    process.env.HOME = home;
    closeStateDb();
  });

  afterEach(() => {
    closeStateDb();
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(home, { recursive: true, force: true });
  });

  function bindCodex(identity: string, value: string, profile = "default") {
    const store = createSessionStore(getStateDb());
    const bound = store.bind(store.reserve({ identity }), { harness: "codex", profile, kind: "id", value }, { mode: "herdr", pane: "w1:p1" });
    if (!bound.ok) throw new Error(bound.error.message);
  }

  test("integrations on: a never-bound or detached Claude session keeps its environment id, creating no binding", () => {
    setSetting("agent.integrations.enabled", true, "machine");
    process.env.CLAUDE_CODE_SESSION_ID = "claude-unsigned";
    expect(currentSessionId(["post", "r", "hi"])).toBe("claude-unsigned");
    const db = getStateDb();
    expect(db.query("SELECT count(*) AS n FROM agent_session_bindings").get()).toEqual({ n: 0 });
    // An explicit id still needs a record.
    expect(() => currentSessionId(["post", "r", "hi", "--session", "claude-unsigned"])).toThrow(UserActionableError);

    const store = createSessionStore(db);
    const bound = store.bind(store.reserve({ identity: "remy.ab12" }), { harness: "claude", profile: "default", kind: "id", value: "claude-unsigned" }, { mode: "herdr", pid: 4242 });
    if (!bound.ok) throw new Error(bound.error.message);
    if (!store.detach(bound.data.key, 1).ok) throw new Error("detach failed");
    expect(currentSessionId(["post", "r", "hi"])).toBe("claude-unsigned");
    expect(db.query("SELECT count(*) AS n FROM agent_session_bindings").get()).toEqual({ n: 1 });
  });

  test("integrations on: a Codex CLI caller resolves through CODEX_THREAD_ID", () => {
    setSetting("agent.integrations.enabled", true, "machine");
    bindCodex("kai.cd34", "thread-one");
    process.env.CODEX_THREAD_ID = "thread-one";
    expect(currentSessionId(["post", "r", "hi"])).toBe("thread-one");
  });

  test("integrations on: an unbound Codex thread is refused, never passed through", () => {
    setSetting("agent.integrations.enabled", true, "machine");
    process.env.CODEX_THREAD_ID = "thread-unbound";
    expect(() => currentSessionId(["post", "r", "hi"])).toThrow(UserActionableError);
  });

  test("integrations on: both CODEX_THREAD_ID and CLAUDE_CODE_SESSION_ID set refuses as ambiguous", () => {
    setSetting("agent.integrations.enabled", true, "machine");
    bindCodex("kai.cd34", "thread-one");
    process.env.CODEX_THREAD_ID = "thread-one";
    process.env.CLAUDE_CODE_SESSION_ID = "env-id";
    let thrown: unknown;
    try {
      currentSessionId(["post", "r", "hi"]);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(UserActionableError);
    expect((thrown as UserActionableError).why).toContain("restart the Codex app server from a plain shell");
  });

  test("integrations on: an explicit --session looks up its one recorded session and refuses an ambiguous raw id", () => {
    setSetting("agent.integrations.enabled", true, "machine");
    bindCodex("kai.cd34", "only-one");
    bindCodex("remy.ab12", "shared", "work");
    bindCodex("ivy.ef56", "shared", "personal");
    process.env.CODEX_THREAD_ID = "thread-ignored";
    expect(currentSessionId(["post", "r", "hi", "--session", "only-one"])).toBe("only-one");
    expect(() => currentSessionId(["post", "r", "hi", "--session", "shared"])).toThrow(UserActionableError);
  });

  test("integrations on: no session evidence at all is a plain shell, as before", () => {
    setSetting("agent.integrations.enabled", true, "machine");
    expect(currentSessionId(["post", "r", "hi"])).toBeUndefined();
  });

  test("integrations on: sign-in binds an unbound Claude session first, and every verb then resolves it", async () => {
    setSetting("agent.integrations.enabled", true, "machine");
    process.env.CLAUDE_CODE_SESSION_ID = "claude-manual";
    const target = await signInSession(["sign-in"]);
    expect(target.sessionId).toBe("claude-manual");
    await target.bind!("remy.ab12");
    expect(currentSessionId(["post", "r", "hi"])).toBe("claude-manual");
    expect(createSessionStore(getStateDb()).find({ harness: "claude", profile: "default", kind: "id", value: "claude-manual" })?.identity).toBe("remy.ab12");
    // A repeat sign-in resolves the binding it already has.
    const again = await signInSession(["sign-in"]);
    expect(again).toMatchObject({ sessionId: "claude-manual", binding: { identity: "remy.ab12", native: { value: "claude-manual" } } });
    expect(again.bind).toBeUndefined();
  });

  test("integrations on: a Codex thread with no binding still refuses at sign-in", async () => {
    setSetting("agent.integrations.enabled", true, "machine");
    process.env.CODEX_THREAD_ID = "thread-unbound";
    await expect(signInSession(["sign-in"])).rejects.toBeInstanceOf(UserActionableError);
  });

  test("integrations off: sign-in is the environment lookup and binds nothing", async () => {
    process.env.CLAUDE_CODE_SESSION_ID = "env-id";
    expect(await signInSession(["sign-in"])).toEqual({ sessionId: "env-id" });
    expect(await signInSession(["sign-in", "--session", "flag-id"])).toEqual({ sessionId: "flag-id" });
    expect(existsSync(join(home, ".mattstack", "rt", "state.db"))).toBe(false);
  });

  test("integrations off: byte-identical to the environment lookup, even with unbound or conflicting ids", () => {
    process.env.CODEX_THREAD_ID = "thread-unbound";
    expect(currentSessionId(["post", "r", "hi"])).toBeUndefined();
    process.env.CLAUDE_CODE_SESSION_ID = "env-id";
    expect(currentSessionId(["post", "r", "hi"])).toBe("env-id");
    expect(currentSessionId(["post", "r", "hi", "--session", "flag-id"])).toBe("flag-id");
    expect(currentSessionId(["sign-in", "--session", "--no-room"])).toBe("env-id");
    expect(existsSync(join(home, ".mattstack", "rt", "state.db"))).toBe(false);
  });
});
