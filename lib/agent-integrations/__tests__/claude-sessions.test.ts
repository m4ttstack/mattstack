import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createObservationSweep, type LaunchRequest, type NativeLaunch, type SessionAdapter } from "../contracts.ts";
import type { ClaudeRegistry, ClaudeSessionDeps, PaneLaunch, PaneOpened } from "../claude/sessions.ts";
import type { AgentOptions, NativeSessionRef, Outcome, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import type { AgentEntry } from "../../runs/liveness.ts";
import type { InboxBinding } from "../../claude-registry.ts";
import * as argvBarrel from "../../agent-argv/index.ts";
import {
  buildClaudeArgv, buildPaneCommand, claudeReadiness, createClaudeSessions, isDetachedClaudeBinding, prepareClaudeSignIn,
} from "../claude/sessions.ts";
import { claudeIntegration } from "../claude/integration.ts";
import { extractMcpEvidence, resolveCallerContext } from "../context.ts";
import { createSessionStore, type StoredAttachment } from "../session-store.ts";
import { openStateDb } from "../../state/db.ts";
import { insertAgent, type AgentRecord } from "../../state/agents-store.ts";
import { setSetting } from "../../settings/write.ts";
import { writeChatSession } from "../../chat-session.ts";
import { callerChatHandle, callerSession, toolContext } from "../../mcp/shared.ts";

const UUID = "6e225e74-4cb7-4aea-8807-6aa9011d4112";
const MINTED = "0b9d2f9a-1c4e-4f6a-9d7e-3b2a1c0d9e8f";
const HOME = "/h";
const DEFAULT_ROOT = `${HOME}/.claude/sessions`;
const SWAP_ROOT = `${HOME}/.claude-swap-backup/sessions/2-sam_example.com/sessions`;
const ACCOUNTS = [{ slot: 1, email: "alex@acme.test" }, { slot: 2, email: "sam@example.com" }];

let dir = "";
let origHome: string | undefined;

beforeEach(() => {
  origHome = process.env.HOME;
  dir = mkdtempSync(join(tmpdir(), "rt-claude-sessions-"));
  process.env.HOME = join(dir, "home");
});

afterEach(() => {
  process.env.HOME = origHome;
  rmSync(dir, { recursive: true, force: true });
});

function freshDb(): Database {
  return openStateDb(join(dir, "state.db"));
}

const inbox = (pid: number, status: InboxBinding["status"] = "idle"): InboxBinding =>
  ({ pid, socketPath: `/sock/${pid}`, status });

function registryOf(roots: Record<string, Record<string, InboxBinding>>, pids: Record<number, string> = {}): ClaudeRegistry {
  return {
    roots: () => Object.keys(roots),
    read: (root) => new Map(Object.entries(roots[root] ?? {})),
    sessionForPid: (pid) => pids[pid] ?? null,
  };
}

type Harness = { deps: Partial<ClaudeSessionDeps>; opened: PaneLaunch[]; trusted: Array<{ opened: PaneOpened; cwd: string }> };

function harness(over: Partial<ClaudeSessionDeps> = {}, db?: Database): Harness {
  const opened: PaneLaunch[] = [];
  const trusted: Array<{ opened: PaneOpened; cwd: string }> = [];
  const deps: Partial<ClaudeSessionDeps> = {
    now: () => 1_000,
    mintId: () => MINTED,
    openPane: async (launch) => { opened.push(launch); return { ok: true, data: { pane: "w4:p2" } }; },
    acceptTrust: async (pane, cwd) => { trusted.push({ opened: pane, cwd }); },
    agents: async () => [],
    registry: registryOf({}),
    processAlive: () => true,
    socketExists: () => true,
    cswapAccounts: async () => ACCOUNTS,
    ...(db && { store: () => createSessionStore(db) }),
    ...over,
  };
  return { deps, opened, trusted };
}

function request(options: AgentOptions = {}, over: Partial<LaunchRequest> = {}): LaunchRequest {
  return {
    reservationId: "rsv-1", cwd: "/w/acme", mode: "herdr",
    selection: { harness: "claude", options }, required: [], access: { readRoots: [] },
    ...over,
  };
}

function data<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(`expected ok, got ${outcome.error.code}: ${outcome.error.message}`);
  return outcome.data;
}

const claudeRef = (value: string, profile = "default"): NativeSessionRef => ({ harness: "claude", profile, kind: "id", value });

function bindClaude(db: Database, identity: string, value: string, attachment: { pane?: string; pid?: number } = {}, profile = "default"): SessionBinding {
  const store = createSessionStore(db);
  return data(store.bind(store.reserve({ identity }), claudeRef(value, profile), { mode: "herdr", ...attachment }));
}

describe("native argv lives in the Claude integration", () => {
  test("the agent-argv barrel forwards the integration's own builders", () => {
    expect(argvBarrel.buildClaudeArgv).toBe(buildClaudeArgv);
    expect(argvBarrel.buildPaneCommand).toBe(buildPaneCommand);
    expect(argvBarrel.buildAgentArgv("claude", { session: { kind: "start", sessionId: UUID }, headless: false }, { claude: "/abs/claude" }))
      .toEqual(["/abs/claude", "--session-id", UUID]);
  });

  test("fresh, resume and headless argv keep today's exact shape", () => {
    const bins = { claude: "/abs/claude", cswap: "/abs/cswap" };
    const knobs = { model: "haiku", effort: "low", yolo: true, extraArgs: "--verbose" };
    expect(buildPaneCommand("/w/acme", { ...knobs, session: { kind: "start", sessionId: UUID }, headless: false }))
      .toBe(`cd '/w/acme' && claude '--dangerously-skip-permissions' '--model' 'haiku' '--effort' 'low' '--session-id' '${UUID}' '--verbose'`);
    expect(buildPaneCommand("/w/acme", { ...knobs, account: "a@b.c", session: { kind: "resume", sessionId: UUID }, headless: false }))
      .toBe(`cd '/w/acme' && cswap run 'a@b.c' -- '--dangerously-skip-permissions' '--model' 'haiku' '--effort' 'low' '--resume' '${UUID}' '--verbose'`);
    expect(buildClaudeArgv({ ...knobs, session: { kind: "resume", sessionId: UUID }, headless: true, prompt: "go" }, bins))
      .toEqual(["/abs/claude", "-p", "--output-format", "json", "--dangerously-skip-permissions", "--model", "haiku", "--effort", "low", "--resume", UUID, "--verbose"]);
  });
});

describe("launch and resume", () => {
  test("a fresh launch with no work to follow opens one pane with rt's minted id and checks folder trust", async () => {
    const h = harness();
    const sessions = createClaudeSessions(h.deps);
    const launched = data(await sessions.launch(request({ model: "haiku" }, { access: { readRoots: ["/r1"] } })));
    expect(launched).toEqual<NativeLaunch>({ native: claudeRef(MINTED), attachment: { mode: "herdr", pane: "w4:p2" } });
    expect(h.opened).toEqual([{
      cwd: "/w/acme", reservationId: "rsv-1",
      command: `cd '/w/acme' && claude '--model' 'haiku' '--add-dir' '/r1' '--session-id' '${MINTED}'`,
    }]);
    expect(h.trusted).toEqual([{ opened: { pane: "w4:p2" }, cwd: "/w/acme" }]);
  });

  test("a launch with deferred work binds rt's id and starts nothing; its work starts the pane with the prompt on the launch line", async () => {
    const h = harness();
    const sessions = createClaudeSessions(h.deps);
    const req = request({ model: "haiku" }, { prompt: "the deferred work", access: { readRoots: ["/r1"] }, nativeHint: UUID });
    const launched = data(await sessions.launch(req));
    expect(launched).toEqual<NativeLaunch>({ native: claudeRef(UUID), attachment: { mode: "herdr" } });
    expect(h.opened).toEqual([]);
    expect(h.trusted).toEqual([]);

    const work = data(await sessions.startWork(
      { key: "sk-1", identity: "remy.ab12", native: launched.native, attachment: { generation: 1, mode: "herdr" } },
      { id: "w1", text: "the deferred work" }, { request: req, kind: "launch" },
    ));
    expect(work).toMatchObject({ id: "w1", evidence: "submitted", nativeId: UUID, attachment: { mode: "herdr", pane: "w4:p2" } });
    expect(h.opened.map((o) => o.command)).toEqual([
      `cd '/w/acme' && claude '--model' 'haiku' '--add-dir' '/r1' '--session-id' '${UUID}' 'the deferred work'`,
    ]);
    expect(h.trusted).toHaveLength(1);
  });

  test("an id that is not a session uuid is never used as the native session; rt mints its own", async () => {
    const launched = data(await createClaudeSessions(harness().deps).launch(request({}, { nativeHint: "not-a-uuid" })));
    expect(launched.native).toEqual(claudeRef(MINTED));
  });

  test("a cswap account is the native profile", async () => {
    const sessions = createClaudeSessions(harness().deps);
    const launched = data(await sessions.launch(request({ account: "sam@example.com" })));
    expect(launched.native).toEqual(claudeRef(MINTED, "sam@example.com"));
  });

  test("persisted model, account, effort and yolo survive changed defaults on resume", async () => {
    setSetting("agent.claude.model", "opus", "user");
    setSetting("agent.claude.effort", "max", "user");
    setSetting("agent.claude.account", "after@example.com", "user");
    for (const yolo of [true, false]) {
      setSetting("agent.claude.yolo", !yolo, "user");
      const h = harness();
      const resumed = data(await createClaudeSessions(h.deps).resume(
        claudeRef(UUID, "before@example.com"),
        request({ model: "haiku", effort: "low", account: "before@example.com", yolo }),
      ));
      expect(resumed.native).toEqual(claudeRef(UUID, "before@example.com"));
      const command = h.opened[0]!.command;
      expect(command).toStartWith(`cd '/w/acme' && cswap run 'before@example.com' -- `);
      expect(command).toContain(`'--model' 'haiku' '--effort' 'low' '--resume' '${UUID}'`);
      expect(command.includes("--dangerously-skip-permissions")).toBe(yolo);
      for (const changed of ["opus", "max", "after@example.com", "--session-id"]) expect(command).not.toContain(changed);
    }
  });

  test("resume runs under the session's own profile and refuses another account", async () => {
    const h = harness();
    const sessions = createClaudeSessions(h.deps);
    data(await sessions.resume(claudeRef(UUID), request({ model: "haiku" })));
    expect(h.opened[0]!.command).toStartWith(`cd '/w/acme' && claude `);
    const crossed = await sessions.resume(claudeRef(UUID), request({ account: "sam@example.com" }));
    expect(crossed).toMatchObject({ ok: false, error: { code: "invalid" } });
    const foreign = await sessions.resume({ harness: "codex", profile: "default", kind: "id", value: UUID }, request());
    expect(foreign).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(h.opened).toHaveLength(1);
  });

  test("headless binds rt's minted id without spawning; its work spawns claude -p with the prompt on stdin, never in argv", async () => {
    const spawned: Array<{ argv: string[]; cwd: string; env: Record<string, string>; opts: { stdin?: string; unset?: readonly string[] } }> = [];
    const h = harness({
      spawn: (argv, cwd, env, opts) => {
        spawned.push({ argv, cwd, env, opts });
        return { pid: 777, exited: Promise.resolve(3), stdout: async () => "{\"result\":\"done\"}" };
      },
    });
    const sessions = createClaudeSessions(h.deps);
    const req = request({ model: "haiku", yolo: true }, {
      mode: "headless", prompt: "the brief", host: { env: { RT_AGENT_ID: "agent-1" }, unsetEnv: ["CODEX_THREAD_ID"] },
    });
    const launched = data(await sessions.launch(req));
    expect(launched).toEqual<NativeLaunch>({ native: claudeRef(MINTED), attachment: { mode: "headless" } });
    expect(spawned).toEqual([]);
    expect(h.opened).toEqual([]);

    const work = data(await sessions.startWork(
      { key: "sk-1", identity: "agent:agent-1", native: launched.native, attachment: { generation: 1, mode: "headless" } },
      { id: "w1", text: "the brief" }, { request: req, kind: "launch" },
    ));
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.argv.slice(1)).toEqual(["-p", "--output-format", "json", "--dangerously-skip-permissions", "--model", "haiku", "--session-id", MINTED]);
    expect(spawned[0]!.argv.join(" ")).not.toContain("the brief");
    expect(spawned[0]!.opts).toEqual({ stdin: "the brief", unset: ["CODEX_THREAD_ID"] });
    expect(spawned[0]!.env).toEqual({ RT_AGENT_ID: "agent-1" });
    expect(work).toMatchObject({ id: "w1", evidence: "submitted", nativeId: MINTED, attachment: { mode: "headless", pid: 777 } });
    expect(await work.completion).toEqual({ exitCode: 3, body: "{\"result\":\"done\"}" });
  });

  test("work for a session this process did not prepare, or one already running, is not sent", async () => {
    const sessions = createClaudeSessions(harness().deps);
    const req = request({}, { prompt: "go" });
    const prepared = { request: req, kind: "launch" as const };
    const at = (attachment: SessionBinding["attachment"]): SessionBinding => ({ key: "sk-1", identity: "remy.ab12", native: claudeRef(UUID), attachment });
    expect(await sessions.startWork(at({ generation: 1, mode: "herdr" }), { id: "w1", text: "go" })).toMatchObject({ ok: false, error: { code: "unsupported" } });
    expect(await sessions.startWork(at({ generation: 1, mode: "herdr", pane: "w1:p1" }), { id: "w1", text: "go" }, prepared))
      .toMatchObject({ ok: false, error: { code: "unsupported" } });
  });

  test("a resume with deferred work resumes on the launch line under the session's own account", async () => {
    const h = harness();
    const sessions = createClaudeSessions(h.deps);
    const req = request({ account: "sam@example.com", effort: "low" }, { prompt: "next step" });
    const resumed = data(await sessions.resume(claudeRef(UUID, "sam@example.com"), req));
    expect(resumed.attachment).toEqual({ mode: "herdr" });
    data(await sessions.startWork(
      { key: "sk-1", identity: "remy.ab12", native: resumed.native, attachment: { generation: 2, mode: "herdr" } },
      { id: "w2", text: "next step" }, { request: req, kind: "resume" },
    ));
    expect(h.opened[0]!.command).toBe(`cd '/w/acme' && cswap run 'sam@example.com' -- '--effort' 'low' '--resume' '${UUID}' 'next step'`);
  });

  test("an interrupted start is evidenced only by the session running", async () => {
    const live = harness({ registry: registryOf({ [DEFAULT_ROOT]: { [UUID]: inbox(42) } }) });
    const gone = harness({ registry: registryOf({}), agents: async () => [] });
    const bound = { key: "sk-1", identity: "remy.ab12", native: claudeRef(UUID), attachment: { generation: 1, mode: "herdr" as const } };
    expect(data(await createClaudeSessions(live.deps).reconcileWork!(bound, { id: "w1", digest: "d" }))).toEqual({ id: "w1", evidence: "submitted", nativeId: UUID });
    expect(data(await createClaudeSessions(gone.deps).reconcileWork!(bound, { id: "w1", digest: "d" }))).toBeNull();
  });

  test("a pane that fails to open is the launch's failure, and trust is not driven", async () => {
    const h = harness({ openPane: async () => ({ ok: false, error: { code: "refused", message: "tab already open" } }) });
    expect(await createClaudeSessions(h.deps).launch(request())).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(h.trusted).toHaveLength(0);
  });
});

describe("observations", () => {
  const binding = (attachment: SessionBinding["attachment"], value = UUID): SessionBinding =>
    ({ key: "sk-1", identity: "remy.ab12", native: claudeRef(value), attachment });
  const agent = (status: AgentEntry["status"], session: string | null = UUID, pane = "w1:p1"): AgentEntry =>
    ({ status, pane, session, cwds: ["/w/acme"] });

  test("herdr statuses normalize, stamped with generation, source and time", async () => {
    const cases: Array<[AgentEntry["status"], string]> = [
      ["working", "working"], ["blocked", "blocked"], ["idle", "idle"], ["done", "idle"], ["unknown", "unknown"],
    ];
    for (const [status, execution] of cases) {
      const h = harness({ agents: async () => [agent(status)] });
      const seen = data(await createClaudeSessions(h.deps).observe(binding({ generation: 3, mode: "herdr", pane: "w1:p1" })));
      expect(seen).toEqual({ connectivity: "unknown", execution, background: "unknown", observedAt: 1_000, source: "herdr", generation: 3 } as never);
    }
  });

  test("a disconnected transport is not a dead session", async () => {
    const h = harness({
      agents: async () => null,
      registry: registryOf({ [DEFAULT_ROOT]: { [UUID]: inbox(4242, "busy") } }),
      socketExists: () => false,
    });
    const seen = data(await createClaudeSessions(h.deps).observe(binding({ generation: 1, mode: "herdr", pid: 4242 })));
    expect(seen.connectivity).toBe("disconnected");
    expect(seen.execution).toBe("working");
    expect(seen.source).toBe("claude-registry");

    const gone = harness({ agents: async () => null, registry: registryOf({ [DEFAULT_ROOT]: { [UUID]: inbox(4242) } }), processAlive: () => false });
    const unknown = data(await createClaudeSessions(gone.deps).observe(binding({ generation: 1, mode: "herdr", pid: 4242 })));
    expect(unknown.connectivity).toBe("disconnected");
    expect(unknown.execution).toBe("unknown");
  });

  test("no evidence at all stays unknown", async () => {
    const h = harness({ agents: async () => null });
    const seen = data(await createClaudeSessions(h.deps).observe(binding({ generation: 2, mode: "herdr", pane: "w1:p1" })));
    expect(seen).toMatchObject({ connectivity: "unknown", execution: "unknown", background: "unknown", source: "none", generation: 2 });
  });

  test("the live registry row decides connectivity even when an older row for the session lingers", async () => {
    const h = harness({
      registry: registryOf({ [DEFAULT_ROOT]: { [UUID]: inbox(111) }, [SWAP_ROOT]: { [UUID]: inbox(222, "busy") } }),
      processAlive: (pid) => pid === 222,
    });
    const seen = data(await createClaudeSessions(h.deps).observe(binding({ generation: 1, mode: "herdr" })));
    expect(seen).toMatchObject({ connectivity: "connected", execution: "working", source: "claude-registry" });
  });

  test("a process that moved to another session detaches the binding with the current generation", async () => {
    const db = freshDb();
    const before = bindClaude(db, "remy.ab12", "sess-before", { pid: 4242, pane: "w1:p1" });
    const h = harness({ registry: registryOf({}, { 4242: "sess-after" }) }, db);
    const seen = data(await createClaudeSessions(h.deps).observe(before));
    expect(seen).toMatchObject({ connectivity: "disconnected", execution: "unknown", source: "claude-registry", generation: 2 });
    const stored = createSessionStore(db).get(before.key)!;
    expect(stored.attachment as StoredAttachment).toEqual({ generation: 2, mode: "herdr", detached: true });
    expect(isDetachedClaudeBinding(stored)).toBe(true);

    // A second observation of the stale copy cannot replace the newer attachment.
    expect(await createClaudeSessions(h.deps).observe(before)).toMatchObject({ ok: false, error: { code: "stale-binding" } });
    expect(data(await createClaudeSessions(h.deps).observe(stored))).toMatchObject({ source: "store", generation: 2 });
  });

  test("a pane now running another session detaches a pane-only binding; a pane with no session yet does not", async () => {
    const db = freshDb();
    const before = bindClaude(db, "remy.ab12", "sess-before", { pane: "w1:p1" });
    const quiet = harness({ agents: async () => [agent("idle", null)] }, db);
    expect(data(await createClaudeSessions(quiet.deps).observe(before)).generation).toBe(1);

    const moved = harness({ agents: async () => [agent("idle", "sess-after")] }, db);
    expect(data(await createClaudeSessions(moved.deps).observe(before))).toMatchObject({ source: "herdr", generation: 2 });
    expect(isDetachedClaudeBinding(createSessionStore(db).get(before.key)!)).toBe(true);
  });

  test("pane evidence never overrides a recorded process, and a bg pane is not on the visible server's list", async () => {
    const db = freshDb();
    const withPid = bindClaude(db, "remy.ab12", "sess-a", { pid: 4242, pane: "w1:p1" });
    const bg = bindClaude(db, "kai.cd34", "sess-b", { pane: "bg:w1:p1" });
    const h = harness({ agents: async () => [agent("working", "sess-other")], registry: registryOf({}, { 4242: "sess-a" }) }, db);
    const sessions = createClaudeSessions(h.deps);
    expect(data(await sessions.observe(withPid)).generation).toBe(1);
    expect(data(await sessions.observe(bg)).generation).toBe(1);
    expect(createSessionStore(db).get(withPid.key)!.attachment.generation).toBe(1);
    expect(createSessionStore(db).get(bg.key)!.attachment.generation).toBe(1);
  });

  test("only a Claude id binding is observable here", async () => {
    const h = harness();
    const codex = { ...binding({ generation: 1, mode: "herdr" }), native: { harness: "codex", profile: "default", kind: "id" as const, value: "t" } };
    expect(await createClaudeSessions(h.deps).observe(codex)).toMatchObject({ ok: false, error: { code: "invalid" } });
  });

  test("a recorded process that is gone is not read and never makes the session dead or detached", async () => {
    let pidReads = 0;
    const registry = { ...registryOf({}), sessionForPid: () => { pidReads++; return "sess-other"; } };
    const h = harness({ agents: async () => null, registry, processAlive: () => false });
    const seen = data(await createClaudeSessions(h.deps).observe(binding({ generation: 1, mode: "herdr", pid: 4242 })));
    expect(seen).toMatchObject({ execution: "unknown", generation: 1 });
    expect(pidReads).toBe(0);
  });

  test("one sweep reads the registry and asks herdr once for every binding it observes", async () => {
    let rootReads = 0;
    let agentCalls = 0;
    const base = registryOf({ [DEFAULT_ROOT]: { a: inbox(1), b: inbox(2), c: inbox(3) } }, { 1: "a", 2: "b", 3: "c" });
    const registry: ClaudeRegistry = { ...base, read: (root) => { rootReads++; return base.read(root); }, sessionForPid: () => { throw new Error("per-pid read"); } };
    const sessions = createClaudeSessions(harness({ registry, agents: async () => { agentCalls++; return []; } }).deps);
    const sweep = createObservationSweep();
    for (const [value, pid] of [["a", 1], ["b", 2], ["c", 3]] as const) {
      expect(data(await sessions.observe(binding({ generation: 1, mode: "herdr", pid }, value), sweep))).toMatchObject({ connectivity: "connected", generation: 1 });
    }
    expect(rootReads).toBe(1);
    expect(agentCalls).toBe(1);
  });

  test("submitting work to a bound session is not built yet and says so", async () => {
    const outcome = await createClaudeSessions(harness().deps).startWork(binding({ generation: 1, mode: "herdr" }), { id: "w1", text: "go" });
    expect(outcome).toMatchObject({ ok: false, error: { code: "unsupported" } });
  });
});

describe("discovery", () => {
  test("live registry sessions are discovered under their account's profile", async () => {
    const h = harness({
      registry: registryOf({
        [DEFAULT_ROOT]: { "sess-a": inbox(11), "sess-dead": inbox(12) },
        [SWAP_ROOT]: { "sess-b": inbox(21) },
        [`${HOME}/.claude-swap-backup/sessions/9-gone_example.com/sessions`]: { "sess-c": inbox(31) },
      }),
      processAlive: (pid) => pid !== 12,
    });
    const found = await createClaudeSessions(h.deps).discover();
    expect(found).toEqual([
      { native: claudeRef("sess-a"), attachment: { mode: "herdr", pid: 11 } },
      { native: claudeRef("sess-b", "sam@example.com"), attachment: { mode: "herdr", pid: 21 } },
    ]);
  });
});

describe("registration", () => {
  test("claude loads its session adapter and advertises only what it provides", async () => {
    expect(typeof claudeIntegration.loadSessions).toBe("function");
    const adapter: SessionAdapter = await claudeIntegration.loadSessions!();
    expect(typeof adapter.observe).toBe("function");
    const herdr = await claudeIntegration.capabilities("herdr");
    const headless = await claudeIntegration.capabilities("headless");
    expect(herdr.supported).toEqual(["launch", "resume", "observe", "peer-idle", "peer-working", "questions-form"]);
    expect(headless.supported).toEqual(["launch", "resume", "observe"]);
    expect(typeof herdr.readiness.ready).toBe("boolean");
  });

  test("readiness follows the claude binary", () => {
    expect(claudeReadiness(() => true, () => null)).toEqual({ ready: true });
    expect(claudeReadiness(() => false, () => null)).toMatchObject({ ready: false });
    expect(claudeReadiness(() => false, () => "/usr/bin/claude")).toEqual({ ready: true });
  });
});

describe("binding at sign-in", () => {
  const signIn = (db: Database, sessionId: string, env: NodeJS.ProcessEnv, over: Partial<ClaudeSessionDeps> = {}, explicit = false) =>
    prepareClaudeSignIn({ sessionId, explicit }, env, { db, ...harness(over).deps });
  const bindings = (db: Database) => (db.query("SELECT count(*) AS n FROM agent_session_bindings").get() as { n: number }).n;
  function boundBy(outcome: Outcome<SessionBinding | null>): SessionBinding {
    const binding = data(outcome);
    if (binding === null) throw new Error("expected a binding, got an unbound sign-in");
    return binding;
  }

  test("a manually started session binds under the ambient \"default\" profile, then resolves through its MCP environment", async () => {
    const db = freshDb();
    const commit = await signIn(db, "sess-manual", { HERDR_PANE_ID: "w2:p1" }, { registry: registryOf({ [DEFAULT_ROOT]: { "sess-manual": inbox(777) } }) });
    const bound = boundBy(commit("remy.ab12"));
    expect(bound.native).toEqual(claudeRef("sess-manual"));
    expect(bound.attachment).toEqual({ generation: 1, mode: "herdr", pane: "w2:p1", pid: 777 });

    const env = { CLAUDE_CODE_SESSION_ID: "sess-manual", HERDR_PANE_ID: "w2:p1" } as NodeJS.ProcessEnv;
    const caller = data(await resolveCallerContext(data(extractMcpEvidence(undefined, env, {})), { db }));
    expect(caller.binding.key).toBe(bound.key);
    expect(caller.binding.identity).toBe("remy.ab12");

    // The migrated tools' own seams, with the switch on: gate_ask's session and the chat tools' handle.
    setSetting("agent.integrations.enabled", true, "machine");
    writeChatSession({ sessionId: "sess-manual", handle: "remy.ab12", baseHandle: "remy", name: "remy", signedInAt: 1 });
    const context = () => toolContext(extractMcpEvidence(undefined, env, {}), (e) => resolveCallerContext(e, { db }));
    expect(await callerSession(env, context())).toEqual({ session: "sess-manual", pane: "w2:p1" });
    expect(await callerChatHandle(env, context())).toEqual({ handle: "remy.ab12", name: "remy", sessionId: "sess-manual" });
  });

  test("a cswap session binds under its account, from the registry root or the config dir", async () => {
    const db = freshDb();
    const fromRoot = await signIn(db, "sess-swap", {}, { registry: registryOf({ [SWAP_ROOT]: { "sess-swap": inbox(31) } }) });
    expect(boundBy(fromRoot("kai.cd34")).native.profile).toBe("sam@example.com");
    const fromEnv = await signIn(db, "sess-env", { CLAUDE_CONFIG_DIR: `${HOME}/.claude-swap-backup/sessions/1-alex_acme.test` });
    expect(boundBy(fromEnv("ivy.ef56")).native.profile).toBe("alex@acme.test");
  });

  test("a cswap slot cswap does not list signs in unbound, as before bindings", async () => {
    const db = freshDb();
    const commit = await signIn(db, "sess-x", { CLAUDE_CONFIG_DIR: `${HOME}/.claude-swap-backup/sessions/9-gone_example.com` });
    expect(commit("remy.ab12")).toEqual({ ok: true, data: null });
    expect(bindings(db)).toBe(0);
  });

  test("an explicit --session binds only a live registry session, and an id that is not live signs in unbound", async () => {
    const db = freshDb();
    expect((await signIn(db, "sess-elsewhere", {}, {}, true))("remy.ab12")).toEqual({ ok: true, data: null });
    expect(bindings(db)).toBe(0);
    const live = await signIn(db, "sess-live", {}, { registry: registryOf({ [DEFAULT_ROOT]: { "sess-live": inbox(55) } }) }, true);
    expect(boundBy(live("remy.ab12")).attachment.pid).toBe(55);
  });

  test("a malformed legacy agent row does not stop a sign-in", async () => {
    const db = freshDb();
    insertAgent({ id: "ag-bad", repo: "r", cwd: "/w", provider: "claude", surface: "herdr", sessionId: UUID, createdAt: 1, handle: "zed.0bad", account: "" }, db);
    const commit = await signIn(db, "sess-manual", {}, { registry: registryOf({ [DEFAULT_ROOT]: { "sess-manual": inbox(777) } }) });
    expect(boundBy(commit("remy.ab12")).native).toEqual(claudeRef("sess-manual"));
  });

  test("a migrated legacy agent row is reused under its own account, never bound a second time", async () => {
    const db = freshDb();
    const row: AgentRecord = {
      id: "ag-1", repo: "r", cwd: "/w", provider: "claude", surface: "herdr", sessionId: UUID,
      createdAt: 1, handle: "remy.ab12", account: "before@example.com", paneId: "w1:p1",
    };
    insertAgent(row, db);
    const commit = await signIn(db, UUID, {});
    const bound = boundBy(commit("remy.ab12"));
    expect(bound.native).toEqual(claudeRef(UUID, "before@example.com"));
    expect(bound.agentId).toBe("ag-1");
    expect(boundBy(commit("remy.ab12")).key).toBe(bound.key);
    expect(commit("otto.0001")).toMatchObject({ ok: false, error: { code: "refused" } });
  });

  test("a detached binding re-attaches when the registry shows the session live; otherwise the session signs in unbound", async () => {
    const db = freshDb();
    const store = createSessionStore(db);
    const before = bindClaude(db, "remy.ab12", "sess-back", { pid: 10 });
    data(store.detach(before.key, 1));
    // The pre-clear id a cleared MCP server passes: no binding to attach, so today's sign-in.
    const notLive = await signIn(db, "sess-back", {}, {}, true);
    expect(notLive("remy.ab12")).toEqual({ ok: true, data: null });
    expect(notLive("otto.0001")).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(store.get(before.key)!.attachment.generation).toBe(2);

    const commit = await signIn(db, "sess-back", { HERDR_PANE_ID: "w5:p1" }, { registry: registryOf({ [DEFAULT_ROOT]: { "sess-back": inbox(99) } }) });
    const reattached = boundBy(commit("remy.ab12"));
    expect(reattached.key).toBe(before.key);
    expect(reattached.attachment).toEqual({ generation: 3, mode: "herdr", pane: "w5:p1", pid: 99 });
    expect(isDetachedClaudeBinding(reattached)).toBe(false);
  });

  test("two recorded profiles for one session sign in unbound rather than pick, and refuse another identity", async () => {
    const db = freshDb();
    bindClaude(db, "remy.ab12", "sess-dup", {}, "default");
    bindClaude(db, "remy.ab12", "sess-dup", {}, "sam@example.com");
    const commit = await signIn(db, "sess-dup", {});
    expect(commit("remy.ab12")).toEqual({ ok: true, data: null });
    expect(commit("otto.0001")).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(bindings(db)).toBe(2);
  });
});
