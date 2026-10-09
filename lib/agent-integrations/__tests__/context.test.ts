import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { NativeSessionRef, Outcome, CallerContext } from "../../../packages/rt-client/src/agent-integrations.ts";
import { openStateDb } from "../../state/db.ts";
import { insertAgent, type AgentRecord } from "../../state/agents-store.ts";
import { writeChatSession } from "../../chat-session.ts";
import { setSetting } from "../../settings/write.ts";
import { createSessionStore, type StoredAttachment } from "../session-store.ts";
import { createClaudeSessions } from "../claude/sessions.ts";
import { canonicalCodexProfile } from "../codex/profile.ts";
import {
  BOTH_SESSIONS_MESSAGE, boundCodexGateIdentity, extractCliEvidence, extractMcpEvidence, integrationsEnabled, mcpTransportFromArgs, resolveCallerContext,
  resolveCliSession, resolveCliWorkerSession, resolveToolCaller, type CallerEvidence,
} from "../context.ts";
import { createCallHandler } from "../../../commands/mcp.ts";
import { ok, type McpToolDef } from "../../mcp/shared.ts";

let dir = "";
let origHome: string | undefined;

beforeEach(() => {
  origHome = process.env.HOME;
  dir = mkdtempSync(join(tmpdir(), "rt-caller-context-"));
  process.env.HOME = join(dir, "home");
});

afterEach(() => {
  process.env.HOME = origHome;
  rmSync(dir, { recursive: true, force: true });
});

function freshDb(): Database {
  return openStateDb(join(dir, "state.db"));
}

const codex = (value: string, profile = "default"): NativeSessionRef => ({ harness: "codex", profile, kind: "id", value });

function bound(db: Database, identity: string, native: NativeSessionRef, pane = "w1:p1", attemptId?: string) {
  const store = createSessionStore(db);
  const result = store.bind(store.reserve({ identity, ...(attemptId && { attemptId }) }), native, { mode: "herdr", pane });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function resolved(outcome: Outcome<CallerContext> | null): CallerContext {
  if (outcome === null) throw new Error("expected a resolved caller, got the environment path");
  if (!outcome.ok) throw new Error(`expected a resolved caller, got ${outcome.error.code}: ${outcome.error.message}`);
  return outcome.data;
}

function evidence(outcome: Outcome<CallerEvidence>): CallerEvidence {
  if (!outcome.ok) throw new Error(`expected evidence, got ${outcome.error.code}: ${outcome.error.message}`);
  return outcome.data;
}

const CODEX_SERVER = { harness: "codex", profile: "default" } as const;
const SHARED_ENV = { HERDR_PANE_ID: "wMP:p0", HERD_ID: "hd-1", HERD_JOB: "job-1" } as NodeJS.ProcessEnv;

describe("caller attribution", () => {
  test("shared server resolves two callers independently", async () => {
    const db = freshDb();
    const one = bound(db, "remy.ab12", codex("thread-one"), "wTK:p1");
    const two = bound(db, "kai.cd34", codex("thread-two"), "wTM:p1");

    const a = resolved(await resolveCallerContext(evidence(extractMcpEvidence({ threadId: "thread-one" }, SHARED_ENV, CODEX_SERVER)), { db }));
    const b = resolved(await resolveCallerContext(evidence(extractMcpEvidence({ threadId: "thread-two" }, SHARED_ENV, CODEX_SERVER)), { db }));
    expect(a.binding.key).toBe(one.key);
    expect(b.binding.key).toBe(two.key);
    expect(a.binding.key).not.toBe(b.binding.key);
    expect(a.binding.native.value).toBe("thread-one");
    expect(b.binding.native.value).toBe("thread-two");

    // The same server, a call with no host metadata: a valid job id and a
    // working directory that matches a bound worker's do not identify it.
    const uncorrelated = await resolveCallerContext(
      { ...evidence(extractMcpEvidence(undefined, SHARED_ENV, CODEX_SERVER)), hints: { pane: "wTK:p1", cwd: dir } },
      { db },
    );
    expect(uncorrelated).toMatchObject({ ok: false, error: { code: "ambiguous" } });
  });

  test("inherited pane is only a hint", async () => {
    const db = freshDb();
    const one = bound(db, "remy.ab12", codex("thread-one"), "wTH:p1");
    const two = bound(db, "kai.cd34", codex("thread-two"), "wTJ:p1");
    const inherited = { HERDR_PANE_ID: "wMP:p0", HERD_ID: "hd-1", HERD_JOB: "job-1" };

    const a = resolved(await resolveCallerContext(evidence(extractCliEvidence([], { ...inherited, CODEX_THREAD_ID: "thread-one" })), { db }));
    const b = resolved(await resolveCallerContext(evidence(extractCliEvidence([], { ...inherited, CODEX_THREAD_ID: "thread-two" })), { db }));
    expect(a.binding.key).toBe(one.key);
    expect(b.binding.key).toBe(two.key);
    expect(a.binding.key).not.toBe(b.binding.key);

    // A pane that IS a bound worker's attachment still names nobody on its own.
    const paneOnly = await resolveCallerContext(evidence(extractCliEvidence([], { HERDR_PANE_ID: "wTH:p1", HERD_ID: "hd-1", HERD_JOB: "job-1" })), { db });
    expect(paneOnly).toMatchObject({ ok: false, error: { code: "ambiguous" } });
  });

  test("cleared session cannot reuse MCP owner through a connection key", async () => {
    const db = freshDb();
    const store = createSessionStore(db);
    const before = bound(db, "remy.ab12", codex("thread-before"), "w1:p1", "attempt-1");
    // The clear: the old session leaves the pane and a fresh session takes it,
    // with a fresh identity, the same pane and the same working directory.
    const detached = store.replaceAttachment(before.key, before.attachment.generation, { mode: "headless" });
    if (!detached.ok) throw new Error(detached.error.message);
    const after = bound(db, "otto.0001", codex("thread-after"), "w1:p1", "attempt-1");

    const stale = await resolveCallerContext({ connection: { key: before.key, generation: before.attachment.generation }, hints: { pane: "w1:p1", cwd: dir } }, { db });
    expect(stale).toMatchObject({ ok: false, error: { code: "stale-binding" } });

    const crossed = await resolveCallerContext({ connection: { key: before.key, generation: detached.data.attachment.generation }, native: { harness: "codex", profile: "default", kind: "id", value: "thread-after" } }, { db });
    expect(crossed).toMatchObject({ ok: false, error: { code: "ambiguous" } });

    const gone = await resolveCallerContext({ native: { harness: "codex", profile: "default", kind: "id", value: "thread-cleared-never-bound" }, hints: { pane: "w1:p1", cwd: dir } }, { db });
    expect(gone).toMatchObject({ ok: false, error: { code: "ambiguous" } });

    const fresh = resolved(await resolveCallerContext({ native: { harness: "codex", profile: "default", kind: "id", value: "thread-after" } }, { db }));
    expect(fresh.binding.key).toBe(after.key);
    expect(fresh.binding.key).not.toBe(before.key);
  });

  // The Claude compatibility branch reads the MCP process's own
  // CLAUDE_CODE_SESSION_ID, which a clear does not change: once the clear is
  // observed, that id stops naming the old binding and the caller acts as its
  // environment says, as an unbound session does.
  test("Claude compatibility: a pre-clear session id is an unbound environment caller once the clear is observed", async () => {
    const db = freshDb();
    const claude = (value: string): NativeSessionRef => ({ harness: "claude", profile: "default", kind: "id", value });
    const store = createSessionStore(db);
    const reserved = store.bind(store.reserve({ identity: "remy.ab12" }), claude("sess-before"), { mode: "herdr", pane: "w1:p1", pid: 4242 });
    if (!reserved.ok) throw new Error(reserved.error.message);
    const before = reserved.data;
    const staleEnv = evidence(extractMcpEvidence(undefined, { CLAUDE_CODE_SESSION_ID: "sess-before", HERDR_PANE_ID: "w1:p1" }, {}));

    // Before anything observes the clear, the frozen id still names its binding.
    expect(resolved(await resolveCallerContext(staleEnv, { db })).binding.key).toBe(before.key);

    const sessions = createClaudeSessions({
      store: () => store,
      agents: async () => null,
      processAlive: () => true,
      registry: { roots: () => [], read: () => new Map(), sessionForPid: (pid) => (pid === 4242 ? "sess-after" : null) },
    });
    const seen = await sessions.observe(before);
    expect(seen).toMatchObject({ ok: true, data: { generation: 2 } });
    const after = bound(db, "otto.0001", claude("sess-after"), "w1:p1");

    // Not the old binding and not a refusal: the environment path, with no binding and so no assignment.
    expect(await resolveToolCaller(staleEnv, { db })).toBeNull();
    expect(await resolveCallerContext(staleEnv, { db })).toMatchObject({ ok: false, error: { code: "stale-binding" } });
    expect(resolveCliSession([], { CLAUDE_CODE_SESSION_ID: "sess-before" }, { db })).toEqual({ ok: true, data: "sess-before" });
    // An explicit id is not the caller's own environment: it still names nothing.
    expect(await resolveToolCaller({ raw: "sess-before" }, { db })).toMatchObject({ ok: false, error: { code: "stale-binding" } });
    expect(createSessionStore(db).get(before.key)!.attachment as StoredAttachment).toEqual({ generation: 2, mode: "herdr", detached: true });
    const fresh = resolved(await resolveCallerContext(evidence(extractMcpEvidence(undefined, { CLAUDE_CODE_SESSION_ID: "sess-after" }, {})), { db }));
    expect(fresh.binding.key).toBe(after.key);
  });
});

describe("MCP extraction", () => {
  test("missing metadata and metadata on a server not configured for that host carry no native session", () => {
    expect(evidence(extractMcpEvidence(undefined, {}, CODEX_SERVER)).native).toBeUndefined();
    expect(evidence(extractMcpEvidence({}, {}, CODEX_SERVER)).native).toBeUndefined();
    // A Claude-configured server never trusts a threadId just because one arrived.
    const claudeServer = evidence(extractMcpEvidence({ threadId: "thread-one" }, {}, {}));
    expect(claudeServer.native).toBeUndefined();
  });

  test("zero and empty thread ids are refused", () => {
    for (const threadId of [0, "", "   ", null, 42, { id: "x" }]) {
      const result = extractMcpEvidence({ threadId }, {}, CODEX_SERVER);
      expect(result.ok, JSON.stringify(threadId)).toBe(false);
    }
  });

  test("a thread id that disagrees with the server's own environment is refused", () => {
    const result = extractMcpEvidence({ threadId: "thread-two" }, { CODEX_THREAD_ID: "thread-one" }, CODEX_SERVER);
    expect(result).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    expect(evidence(extractMcpEvidence({ threadId: "thread-one" }, { CODEX_THREAD_ID: "thread-one" }, CODEX_SERVER)).native?.value).toBe("thread-one");
  });

  test("foreign-profile metadata is refused", async () => {
    const db = freshDb();
    bound(db, "remy.ab12", codex("thread-one", "work"));
    const server = evidence(extractMcpEvidence({ threadId: "thread-one" }, {}, { harness: "codex", profile: "personal" }));
    expect(server.native).toEqual({ harness: "codex", profile: "personal", kind: "id", value: "thread-one" });
    expect(await resolveCallerContext(server, { db })).toMatchObject({ ok: false, error: { code: "ambiguous" } });
  });

  test("the transport names its harness and profile from its own launch arguments", () => {
    expect(mcpTransportFromArgs([], {})).toEqual({ ok: true, data: {} });
    expect(mcpTransportFromArgs(["--harness", "codex"], {})).toEqual({ ok: true, data: { harness: "codex", profile: "default" } });
    expect(mcpTransportFromArgs(["--harness", "codex"], { CODEX_HOME: "/x/.codex-work" })).toEqual({ ok: true, data: { harness: "codex", profile: "/x/.codex-work" } });
    expect(mcpTransportFromArgs(["--harness", "codex", "--profile", "work"], {})).toEqual({ ok: true, data: { harness: "codex", profile: "work" } });
    expect(mcpTransportFromArgs(["--harness", "gemini"], {}).ok).toBe(false);
    expect(mcpTransportFromArgs(["--harness"], {}).ok).toBe(false);
  });

  test("the CLI, the MCP server and the session adapter name one Codex home the same way", () => {
    const home = "/Users/remy";
    const spellings: Array<string | undefined> = [undefined, "", "  ", "~/.codex", "~/.codex/", `${home}/.codex`, `${home}/.codex/`, `${home}/x/../.codex`];
    for (const spelling of spellings) {
      expect(canonicalCodexProfile(spelling, { HOME: home }), String(spelling)).toBe("default");
      const env = { HOME: home, ...(spelling !== undefined && { CODEX_HOME: spelling }), CODEX_THREAD_ID: "t1" };
      expect(evidence(extractCliEvidence([], env)).native?.profile, String(spelling)).toBe("default");
      expect(mcpTransportFromArgs(["--harness", "codex"], env)).toEqual({ ok: true, data: { harness: "codex", profile: "default" } });
      if (spelling !== undefined) {
        expect(mcpTransportFromArgs(["--harness", "codex", "--profile", spelling], { HOME: home }), spelling)
          .toEqual({ ok: true, data: { harness: "codex", profile: "default" } });
      }
    }
    expect(canonicalCodexProfile("~/.codex-work/", { HOME: home })).toBe(`${home}/.codex-work`);
    expect(canonicalCodexProfile(undefined, { HOME: home, CODEX_HOME: "/x/.codex-work/" })).toBe("/x/.codex-work");
    expect(canonicalCodexProfile("work", { HOME: home, CODEX_HOME: "/elsewhere" })).toBe("work");
  });

  test("a caller-supplied lookalike in tool arguments never reaches the evidence", async () => {
    const db = freshDb();
    const one = bound(db, "remy.ab12", codex("thread-one"));
    bound(db, "kai.cd34", codex("thread-two"));
    const seen: Array<Outcome<CallerContext> | null> = [];
    const probe: McpToolDef = {
      name: "probe", description: "records the resolved caller", shellForms: { none: "test" },
      inputSchema: { type: "object", properties: {}, additionalProperties: true },
      async handler(_input, _env, _signal, context) {
        seen.push(await context!.caller());
        return ok(null);
      },
    };
    const call = createCallHandler([probe], { harness: "codex", profile: "default" }, {}, (e) => resolveCallerContext(e, { db }));
    const parse = (params: Record<string, unknown>) => CallToolRequestSchema.parse({ method: "tools/call", params }).params;

    await call(parse({ name: "probe", arguments: { threadId: "thread-two", _meta: { threadId: "thread-two" } }, _meta: { threadId: "thread-one" } }));
    await call(parse({ name: "probe", arguments: { threadId: "thread-two", _meta: { threadId: "thread-two" } } }));
    expect(resolved(seen[0]!).binding.key).toBe(one.key);
    expect(seen[1]).toMatchObject({ ok: false, error: { code: "ambiguous" } });
  });
});

describe("CLI extraction", () => {
  test("Codex CLI callers are named by CODEX_THREAD_ID under the Codex home's profile", () => {
    expect(evidence(extractCliEvidence([], { CODEX_THREAD_ID: "thread-one" })).native).toEqual(codex("thread-one"));
    expect(evidence(extractCliEvidence([], { CODEX_THREAD_ID: "thread-one", CODEX_HOME: "/x/.codex-work" })).native).toEqual(codex("thread-one", "/x/.codex-work"));
  });

  test("conflicting harness environments and empty ids are refused", () => {
    expect(extractCliEvidence([], { CODEX_THREAD_ID: "thread-one", CLAUDE_CODE_SESSION_ID: "sess-1" })).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    expect(evidence(extractCliEvidence([], { CODEX_THREAD_ID: "" })).native).toBeUndefined();
  });

  test("an explicit --session resolves a unique recorded session and refuses an ambiguous raw id", async () => {
    const db = freshDb();
    const work = bound(db, "remy.ab12", codex("shared", "work"));
    bound(db, "ivy.ef56", { harness: "claude", profile: "default", kind: "id", value: "shared" });
    bound(db, "kai.cd34", codex("only-one"));
    const explicit = evidence(extractCliEvidence(["--session", "only-one"], { CODEX_THREAD_ID: "thread-ignored" }));
    expect(explicit.raw).toBe("only-one");
    expect(resolved(await resolveCallerContext(explicit, { db })).binding.native.value).toBe("only-one");
    expect(await resolveCallerContext(evidence(extractCliEvidence(["--session", "shared"], {})), { db }))
      .toMatchObject({ ok: false, error: { code: "ambiguous" } });
    expect(work.native.profile).toBe("work");
  });
});

describe("a herd worker verb's session from the CLI", () => {
  test("names the bound session, a replaced worker's moved-on session, and nothing for a plain shell or an unknown thread", () => {
    const db = freshDb();
    const live = bound(db, "remy.ab12", codex("thread-live"), "w1:p1", "att-live");
    const gone = bound(db, "kai.cd34", codex("thread-gone"), "w1:p2", "att-gone");
    const store = createSessionStore(db);
    if (!store.detach(gone.key, gone.attachment.generation).ok) throw new Error("detach failed");
    const env = (thread: string) => ({ CODEX_THREAD_ID: thread }) as NodeJS.ProcessEnv;

    expect(resolveCliWorkerSession([], env("thread-live"), { db })).toEqual({ harness: "codex", value: live.native.value });
    expect(resolveCliWorkerSession([], env("thread-gone"), { db })).toEqual({ harness: "codex", value: "thread-gone" });
    expect(resolveCliWorkerSession([], env("thread-never"), { db })).toBeUndefined();
    expect(resolveCliWorkerSession([], {} as NodeJS.ProcessEnv, { db })).toBeUndefined();
  });
});

describe("resolution fallbacks", () => {
  function claudeAgent(over: Partial<AgentRecord> = {}): AgentRecord {
    return {
      id: "ag-1", repo: "remote:gitlab.com%2Facme%2Facme-dev", cwd: "/tmp/repo", provider: "claude", surface: "herdr",
      sessionId: "c1a0de00-0000-4000-8000-000000000001", handle: "remy.ab12", paneId: "w1:p2", createdAt: 1, ...over,
    } as AgentRecord;
  }

  test("a Claude caller binds through its legacy agent record on a native miss", async () => {
    const db = freshDb();
    insertAgent(claudeAgent({ account: "work" }), db);
    const caller = resolved(await resolveCallerContext(evidence(extractMcpEvidence(undefined, { CLAUDE_CODE_SESSION_ID: "c1a0de00-0000-4000-8000-000000000001" }, {})), { db }));
    expect(caller.binding.identity).toBe("remy.ab12");
    expect(caller.binding.native).toEqual({ harness: "claude", profile: "work", kind: "id", value: "c1a0de00-0000-4000-8000-000000000001" });
  });

  test("a chat sign-in alone does not attribute a caller", async () => {
    const db = freshDb();
    writeChatSession({ sessionId: "u0000000-0000-4000-8000-00000000000c", handle: "nell.9f9f", baseHandle: "nell", signedInAt: 1 });
    const result = await resolveCallerContext(evidence(extractMcpEvidence(undefined, { CLAUDE_CODE_SESSION_ID: "u0000000-0000-4000-8000-00000000000c" }, {})), { db });
    expect(result).toMatchObject({ ok: false, error: { code: "ambiguous" } });
  });

  test("a throw from the legacy reader refuses the caller instead of crashing", async () => {
    const db = freshDb();
    const result = await resolveCallerContext(
      { native: { harness: "claude", kind: "id", value: "sess-x" } },
      { db, legacy: () => { throw new Error("malformed legacy row"); } },
    );
    expect(result).toMatchObject({ ok: false, error: { code: "ambiguous" } });
  });

  test("a bound caller never touches the legacy reader", async () => {
    const db = freshDb();
    bound(db, "remy.ab12", codex("thread-one"));
    let legacyCalls = 0;
    const result = await resolveCallerContext({ native: codex("thread-one") }, { db, legacy: () => { legacyCalls++; throw new Error("unreachable"); } });
    expect(result.ok).toBe(true);
    expect(legacyCalls).toBe(0);
  });
});

describe("the agent.integrations.enabled switch", () => {
  test("is off unless this machine turns it on", () => {
    expect(integrationsEnabled()).toBe(false);
    setSetting("agent.integrations.enabled", true, "machine");
    expect(integrationsEnabled()).toBe(true);
    setSetting("agent.integrations.enabled", false, "machine");
    expect(integrationsEnabled()).toBe(false);
  });
});

describe("a bound Codex worker's gate identity", () => {
  const on = () => true;
  function codexAgent(db: Database, id: string, thread: string, subject?: string, pane: string | null = "w1:p1") {
    const rec: AgentRecord = {
      id, repo: "remote:example.com%2Fa%2Fb", cwd: "/w", provider: "codex", surface: "herdr", sessionId: thread, createdAt: 1,
      ...(subject !== undefined && { subject }),
    };
    insertAgent(rec, db);
    const store = createSessionStore(db);
    const result = store.bind(store.reserve({ identity: `agent:${id}`, agentId: id }), codex(thread), { mode: "herdr", ...(pane !== null && { pane }) });
    if (!result.ok) throw new Error(result.error.message);
  }

  test("comes from the binding, never from the app server's environment", () => {
    const db = freshDb();
    codexAgent(db, "ag-sub", "thread-sub", "herd:h1/job-a");
    codexAgent(db, "ag-plain", "thread-plain", undefined, null);
    // RT_* in the environment belong to whoever started the app server, not to this worker.
    const env = { CODEX_THREAD_ID: "thread-sub", RT_AGENT_ID: "ag-someone-else", RT_GATE_SUBJECT: "agent:ag-someone-else", HERDR_PANE_ID: "w0:p0" } as NodeJS.ProcessEnv;
    expect(boundCodexGateIdentity(env, { db, enabled: on })).toEqual({
      ok: true, data: { agentId: "ag-sub", subject: "herd:h1/job-a", sessionId: "thread-sub", pane: "w1:p1", harness: "codex" },
    });
    expect(boundCodexGateIdentity({ CODEX_THREAD_ID: "thread-plain" } as NodeJS.ProcessEnv, { db, enabled: on })).toEqual({
      ok: true, data: { agentId: "ag-plain", subject: "agent:ag-plain", sessionId: "thread-plain", harness: "codex" },
    });
  });

  test("switch off, no Codex thread, or a thread no launched agent owns keeps today's path", () => {
    const db = freshDb();
    codexAgent(db, "ag-sub", "thread-sub");
    bound(db, "kai.cd34", codex("thread-signed-in"));
    expect(boundCodexGateIdentity({ CODEX_THREAD_ID: "thread-sub" } as NodeJS.ProcessEnv, { db, enabled: () => false })).toEqual({ ok: true, data: null });
    expect(boundCodexGateIdentity({ CLAUDE_CODE_SESSION_ID: "c1" } as NodeJS.ProcessEnv, { db, enabled: on })).toEqual({ ok: true, data: null });
    expect(boundCodexGateIdentity({ CODEX_THREAD_ID: "thread-unknown" } as NodeJS.ProcessEnv, { db, enabled: on })).toEqual({ ok: true, data: null });
    expect(boundCodexGateIdentity({ CODEX_THREAD_ID: "thread-signed-in" } as NodeJS.ProcessEnv, { db, enabled: on })).toEqual({ ok: true, data: null });
  });

  test("a hook outside any Codex thread never reads the switch", () => {
    let reads = 0;
    const counted = () => { reads++; return true; };
    expect(boundCodexGateIdentity({ CLAUDE_CODE_SESSION_ID: "c1" } as NodeJS.ProcessEnv, { db: freshDb(), enabled: counted })).toEqual({ ok: true, data: null });
    expect(boundCodexGateIdentity({} as NodeJS.ProcessEnv, { enabled: counted })).toEqual({ ok: true, data: null });
    expect(reads).toBe(0);
  });

  test("a detached Codex binding names no caller, as a detached Claude one does", () => {
    const db = freshDb();
    codexAgent(db, "ag-left", "thread-left");
    const store = createSessionStore(db);
    const binding = store.find(codex("thread-left"))!;
    if (!store.detach(binding.key, binding.attachment.generation).ok) throw new Error("detach failed");
    const outcome = boundCodexGateIdentity({ CODEX_THREAD_ID: "thread-left" } as NodeJS.ProcessEnv, { db, enabled: on });
    expect(outcome).toEqual({ ok: true, data: null });
    const caller = resolveCliSession([], { CODEX_THREAD_ID: "thread-left" } as NodeJS.ProcessEnv, { db });
    expect(caller).toMatchObject({ ok: false, error: { code: "stale-binding" } });
  });

  test("an environment naming both harnesses' sessions still refuses, and says why and what to do", () => {
    const db = freshDb();
    codexAgent(db, "ag-sub", "thread-sub");
    const both = { CODEX_THREAD_ID: "thread-sub", CLAUDE_CODE_SESSION_ID: "c1" } as NodeJS.ProcessEnv;
    const refused = boundCodexGateIdentity(both, { db, enabled: on });
    expect(refused).toEqual({ ok: false, error: { code: "ambiguous", message: BOTH_SESSIONS_MESSAGE } });
    expect(BOTH_SESSIONS_MESSAGE).toContain("inherited a Claude Code session");
    expect(BOTH_SESSIONS_MESSAGE).toContain("restart the Codex app server from a plain shell");
    expect(extractCliEvidence([], both)).toEqual({ ok: false, error: { code: "ambiguous", message: BOTH_SESSIONS_MESSAGE } });
  });
});
