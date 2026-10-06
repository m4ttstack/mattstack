import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, dirname, join, relative, resolve } from "path";
import type {
  CapabilityReport, Mode, NativeSessionRef, OptionDescriptor, Outcome, Readiness,
} from "../../../packages/rt-client/src/agent-integrations.ts";
import { builtinRegistry } from "../../agent-integrations/builtins.ts";
import { claudeIntegration } from "../../agent-integrations/claude/integration.ts";
import { createClaudeSessions, type PaneLaunch } from "../../agent-integrations/claude/sessions.ts";
import { codexIntegration } from "../../agent-integrations/codex/integration.ts";
import type {
  HarnessIntegration, IntegrationRegistry, LaunchRequest, NativeLaunch, SessionAdapter, WorkInput,
} from "../../agent-integrations/contracts.ts";
import { createRegistry } from "../../agent-integrations/registry.ts";
import { createSessionStore } from "../../agent-integrations/session-store.ts";
import type { HerdrRunner } from "../../agent-herdr.ts";
import { herdrRequest } from "../../herdr/client.ts";
import { fakeHerdr, HerdrFakeError, type FakeHerdrHandler } from "../../herdr/__tests__/fake-herdr.ts";
import { rtDir } from "../../rt-paths.ts";
import { openStateDb } from "../../state/index.ts";
import { createAgentService, type AgentStartOutcome } from "../handlers/agent.ts";
import { createAgentIntegrationHandlers, listAgentIntegrations } from "../handlers/agent-integrations.ts";
import { createPaneHandlers } from "../handlers/pane.ts";

const NATIVE_BINS = ["claude", "codex", "herdr", "cswap"];
const shimDir = mkdtempSync(join(tmpdir(), "agent-int-shims-"));
const shimLog = join(shimDir, "calls.log");
const savedPath = process.env.PATH;

beforeAll(() => {
  writeFileSync(shimLog, "");
  for (const bin of NATIVE_BINS) {
    const path = join(shimDir, bin);
    writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' "${bin} $*" >> '${shimLog}'\nexit 1\n`);
    chmodSync(path, 0o755);
  }
  process.env.PATH = `${shimDir}:${savedPath ?? ""}`;
});

afterAll(() => {
  process.env.PATH = savedPath;
  expect(readFileSync(shimLog, "utf8")).toBe("");
});

const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops) stop();
  stops.length = 0;
});

let n = 0;
const freshDb = () => openStateDb(join(tmpdir(), `agent-int-${process.pid}-${n++}.db`));

const notCalled = async (): Promise<never> => {
  throw new Error("not expected in this test");
};
const ready = async (mode: Mode): Promise<CapabilityReport> => ({ mode, supported: ["launch", "resume", "observe"], readiness: { ready: true } });
const noHerdrRunner: HerdrRunner = async () => {
  throw new Error("this test opens no pane through the herdr CLI");
};

/** A session-only integration may report only what its session adapter does. */
type SessionOnly = "launch" | "resume" | "observe";
type FakeIntegration = HarnessIntegration & { loads: number; lookups: number[] };

function fakeIntegration(id: string, extra: {
  pidSessions?: Record<number, string>; adapter?: SessionAdapter;
  options?: OptionDescriptor[]; report?: { readiness?: Readiness; supported?: SessionOnly[] }; throws?: boolean;
} = {}): FakeIntegration {
  const adapter: SessionAdapter = extra.adapter ?? {
    launch: notCalled, resume: notCalled, observe: notCalled, startWork: notCalled, discover: notCalled,
  };
  const integration: FakeIntegration = {
    id,
    label: `${id} label`,
    loads: 0,
    lookups: [],
    ...(extra.pidSessions !== undefined && {
      sessionForPid: async (pid: number) => {
        integration.lookups.push(pid);
        return extra.pidSessions![pid] ?? null;
      },
    }),
    capabilities: async (mode: Mode) => {
      if (extra.throws) throw new Error(`${id} probe broke`);
      return { mode, supported: ["launch", "observe"], readiness: { ready: true }, ...extra.report };
    },
    validateOptions: (options) => (options.account !== undefined && id !== "claude"
      ? { ok: false, error: { code: "unsupported", message: `${id} takes no account` } }
      : { ok: true, data: options }),
    options: async () => extra.options ?? [{ name: "model", kind: "text" }],
    loadSessions: async () => {
      integration.loads++;
      return adapter;
    },
  };
  return integration;
}

const threeHarnesses = () => ({ registry: createRegistry([fakeIntegration("claude"), fakeIntegration("codex"), fakeIntegration("fixture")]) });

const paneInfo = (id: string, agent: string | undefined, extra: Record<string, unknown> = {}) => ({
  pane_id: id, terminal_id: `t-${id}`, workspace_id: "w1", tab_id: "w1:t1", focused: false,
  ...(agent !== undefined && { agent }), agent_status: "idle", cwd: "/repos/acme", revision: 1, ...extra,
});

function snapshotOf(panes: unknown[]) {
  return {
    type: "session_snapshot",
    snapshot: { version: "0.8.0", protocol: 19, tabs: [], layouts: [], agents: [], workspaces: [{ workspace_id: "w1", label: "acme", focused: false }], panes },
  };
}

const MIXED = snapshotOf([
  paneInfo("w1:p1", "claude", { agent_session: { source: "herdr:claude", agent: "claude", kind: "id", value: "sess-claude" } }),
  paneInfo("w1:p2", "codex", { agent_session: { source: "herdr:codex", agent: "codex", kind: "id", value: "thread-codex" } }),
  paneInfo("w1:p3", "fixture"),
  paneInfo("w1:p4", "aider"),
  paneInfo("w1:p5", undefined),
]);

function listFake(snap: unknown, pids: Record<string, number>): FakeHerdrHandler {
  return (method, params) => {
    if (method === "session.snapshot") return snap;
    const pid = pids[String(params.pane_id)];
    if (method === "pane.process_info" && pid !== undefined) {
      return { process_info: { pane_id: params.pane_id, shell_pid: 1, foreground_process_group_id: pid, foreground_processes: [{ pid: pid + 1 }] } };
    }
    return new HerdrFakeError("invalid_request", method);
  };
}

const CSWAP_EXEC = async (argv: [string, ...string[]]) =>
  argv[1] === "list" ? { stdout: "Accounts:\n  1: me@x.y [Me]\n", stderr: "", exitCode: 0 } : { stdout: "main\n", stderr: "", exitCode: 0 };

type StartAgent = (payload: Parameters<ReturnType<typeof createAgentService>["start"]>[0]) => Promise<AgentStartOutcome>;

function harness(handler: FakeHerdrHandler, opts: {
  integrations?: IntegrationRegistry; enabled?: boolean; claudeRegistryRoots?: string[]; db?: Database;
  repoIndex?: Record<string, string>; startAgent?: StartAgent;
} = {}) {
  const { sock, seen, stop } = fakeHerdr(handler);
  stops.push(stop);
  const db = opts.db ?? freshDb();
  const herdr: typeof herdrRequest = (method, params, o) => herdrRequest(method, params, { ...o, sockPath: sock });
  const pane = createPaneHandlers({
    db, repoIndex: () => opts.repoIndex ?? {}, herdr, exec: CSWAP_EXEC,
    ...(opts.claudeRegistryRoots !== undefined && { claudeRegistryRoots: opts.claudeRegistryRoots }),
    ...(opts.integrations !== undefined && { integrations: opts.integrations }),
    ...(opts.enabled !== undefined && { integrationsEnabled: () => opts.enabled! }),
    ...(opts.startAgent !== undefined && { startAgent: opts.startAgent }),
  });
  return { pane, seen, db, herdr };
}

describe("pane discovery through the integration registry", () => {
  test("pane discovery includes both harnesses and fixture integration", async () => {
    const claude = fakeIntegration("claude");
    const codex = fakeIntegration("codex");
    const fixture = fakeIntegration("fixture", { pidSessions: { 7002: "fix-from-pid" } });
    const { pane } = harness(listFake(MIXED, { "w1:p3": 7001 }), { integrations: createRegistry([claude, codex, fixture]), enabled: true });
    const res = await pane["pane:list"]({});
    if (!res.ok) throw new Error(res.error);
    const panes = res.data.panes;
    expect(panes.map((p) => p.provider).sort()).toEqual(["claude", "codex", "fixture"]);
    expect(panes.find((p) => p.provider === "fixture")?.sessionId).toBe("fix-from-pid");
    expect(panes.find((p) => p.provider === "codex")?.sessionId).toBe("thread-codex");
    expect(fixture.lookups).toEqual([7001, 7002]);
    expect(claude.loads + codex.loads + fixture.loads).toBe(0);
  });

  test("a Codex pane with no herdr session loads no sessions, opens no connection, and its process is not read", async () => {
    const codex = fakeIntegration("codex");
    const snap = snapshotOf([paneInfo("w1:p2", "codex")]);
    const { pane, seen } = harness(listFake(snap, { "w1:p2": 8100 }), { integrations: createRegistry([codex]), enabled: true });
    const res = await pane["pane:list"]({});
    if (!res.ok) throw new Error(res.error);
    expect(res.data.panes.map((p) => [p.provider, p.sessionId])).toEqual([["codex", undefined]]);
    expect(codex.loads).toBe(0);
    expect(seen.map((s) => s.method)).toEqual(["session.snapshot"]);
  });

  test("with the built-in harnesses, a Claude pane finds its session from Claude's registry and nothing native runs", async () => {
    const sessions = join(process.env.HOME!, ".claude", "sessions");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(join(sessions, "7101.json"), JSON.stringify({ pid: 7101, sessionId: "sess-from-registry" }));
    const snap = snapshotOf([paneInfo("w1:p1", "claude"), paneInfo("w1:p2", "codex")]);
    const { pane, seen } = harness(listFake(snap, { "w1:p1": 7101, "w1:p2": 8100 }), { integrations: builtinRegistry(), enabled: true });
    const res = await pane["pane:list"]({});
    if (!res.ok) throw new Error(res.error);
    expect(res.data.panes.map((p) => [p.provider, p.sessionId])).toEqual([["claude", "sess-from-registry"], ["codex", undefined]]);
    expect(seen.filter((s) => s.method === "pane.process_info").map((s) => s.params.pane_id)).toEqual(["w1:p1"]);
    expect(readFileSync(shimLog, "utf8")).toBe("");
  });

  test("with the switch off pane:list is today's Claude-only list, with no provider, whatever the registry holds", async () => {
    const fixture = fakeIntegration("fixture", { pidSessions: { 7002: "fix-from-pid" } });
    const registry = createRegistry([fakeIntegration("claude"), fakeIntegration("codex"), fixture]);
    const root = mkdtempSync(join(tmpdir(), "agent-int-creg-"));
    const baseline = harness(listFake(MIXED, { "w1:p3": 7001 }), { claudeRegistryRoots: [root] });
    const off = harness(listFake(MIXED, { "w1:p3": 7001 }), { integrations: registry, enabled: false, claudeRegistryRoots: [root] });
    const before = await baseline.pane["pane:list"]({});
    const after = await off.pane["pane:list"]({});
    expect(after).toEqual(before);
    if (!after.ok) throw new Error(after.error);
    expect(after.data.panes.map((p) => p.paneId)).toEqual(["w1:p1"]);
    expect(after.data.panes.every((p) => !("provider" in p))).toBe(true);
    expect(off.seen.map((s) => s.method)).toEqual(baseline.seen.map((s) => s.method));
    expect(fixture.lookups).toEqual([]);
  });
});

/** The real Claude session adapter, opening its panes through a recorder instead of herdr. */
function recordedClaude(db: Database, trust = "none") {
  const opened: PaneLaunch[] = [];
  const integration: HarnessIntegration = {
    ...claudeIntegration,
    capabilities: ready,
    loadSessions: async () => createClaudeSessions({
      store: () => createSessionStore(db),
      openPane: async (launch) => {
        opened.push(launch);
        return { ok: true, data: { pane: `w2:p${opened.length}`, tabId: `w2:t${opened.length}`, workspaceId: "w2" } };
      },
      acceptTrust: async () => trust,
    }),
  } as HarnessIntegration;
  return { integration, opened };
}

/** A fixture harness whose launch the test answers, counting every call. */
function answeredFixture(answer: (req: LaunchRequest) => Promise<Outcome<NativeLaunch>>) {
  const launches: LaunchRequest[] = [];
  const adapter = {
    carriesReservations: true,
    launch: async (req: LaunchRequest) => { launches.push(req); return answer(req); },
    resume: notCalled, observe: notCalled, discover: async () => [],
    startWork: async (_b: unknown, input: WorkInput) => ({ ok: true, data: { id: input.id, evidence: "submitted" } }),
  } as unknown as SessionAdapter;
  return { launches, integration: { ...fakeIntegration("fixture", { adapter }), capabilities: ready } as HarnessIntegration };
}

const fixtureRef = (value: string): NativeSessionRef => ({ harness: "fixture", profile: "default", kind: "id", value });

const spawnPane = (status: string) => paneInfo("w2:p1", "claude", { workspace_id: "w2", tab_id: "w2:t1", agent_status: status });

/** pane:spawn wired to agent:start's own start over one db, the way the router wires it. */
function spawnHarness(integrations: IntegrationRegistry, db: Database, opts: { status?: string; enabled?: boolean } = {}) {
  const repoDir = mkdtempSync(join(tmpdir(), "agent-int-repo-"));
  mkdirSync(join(repoDir, ".git"));
  const enabled = opts.enabled ?? true;
  const service = createAgentService({
    db, emitEvent: () => 0, integrations, integrationsEnabled: () => enabled, herdrRunner: noHerdrRunner,
    herdr: (async () => ({ ok: false, code: "unreachable", message: "no server" })) as never,
  });
  const starts: unknown[] = [];
  const startAgent: StartAgent = (payload) => {
    starts.push(payload);
    return service.start(payload);
  };
  const handler: FakeHerdrHandler = (method) => (method === "pane.get"
    ? { type: "pane_info", pane: spawnPane(opts.status ?? "idle") }
    : new HerdrFakeError("invalid_request", method));
  const h = harness(handler, { integrations, enabled, db, repoIndex: { "remote:example.com%2Facme%2Fdev": repoDir }, startAgent });
  return { ...h, service, starts, cwd: repoDir };
}

describe("pane creation through agent:start's shared path", () => {
  test("a switch-on pane spawn puts no prompt text on the command line", async () => {
    const db = freshDb();
    const claude = recordedClaude(db);
    const { pane, cwd } = spawnHarness(createRegistry([claude.integration, codexIntegration]), db);
    const res = await pane["pane:spawn"]({ cwd, prompt: "SECRET-PROMPT-TEXT please read AGENTS.md" });
    if (!res.ok) throw new Error(res.error);
    expect(claude.opened).toHaveLength(1);
    const command = claude.opened[0]!.command;
    expect(command).not.toContain("SECRET-PROMPT-TEXT");
    const promptDir = join(rtDir(), "agent-prompts", res.data.agentId!);
    expect(command).toContain(promptDir);
    expect(readFileSync(join(promptDir, "prompt-1.md"), "utf8")).toContain("SECRET-PROMPT-TEXT");
    expect(res.data).toMatchObject({ ready: true, agentId: expect.stringMatching(/\S/), pane: { paneId: "w2:p1", provider: "claude" } });
  });

  test("two spawns in one cwd open two tabs", async () => {
    const db = freshDb();
    const claude = recordedClaude(db);
    const { pane, cwd } = spawnHarness(createRegistry([claude.integration]), db);
    const first = await pane["pane:spawn"]({ cwd });
    const second = await pane["pane:spawn"]({ cwd });
    if (!first.ok || !second.ok) throw new Error("both spawns should start");
    const tabs = claude.opened.map((o) => o.host?.tab);
    expect(tabs).toHaveLength(2);
    expect(new Set(tabs).size).toBe(2);
    for (const tab of tabs) expect(tab?.startsWith(`${basename(cwd)} `)).toBe(true);
    expect(first.data.agentId).not.toBe(second.data.agentId);
  });

  test("an ambiguous spawn keeps an agent record with attention and returns its id, and a later spawn refusal names it", async () => {
    const db = freshDb();
    const fixture = answeredFixture(async () => ({ ok: false, error: { code: "ambiguous", message: "the fixture cannot say whether it started" } }));
    const { pane, service, cwd } = spawnHarness(createRegistry([recordedClaude(db).integration, fixture.integration]), db);
    const first = await pane["pane:spawn"]({ cwd, provider: "fixture", prompt: "do it" });
    expect(first.ok).toBe(false);
    const agentId = (first as { agentId?: string }).agentId;
    expect(agentId).toEqual(expect.stringMatching(/\S/));
    const kept = await service.handlers["agent:get"]({ id: agentId! });
    if (!kept.ok) throw new Error(kept.error);
    expect((kept.data as { attention?: string }).attention).toContain("has not resolved");

    const retry = await pane["pane:spawn"]({ cwd, provider: "fixture", prompt: "do it" });
    expect(retry).toEqual({ ok: false, error: expect.stringContaining(`agent ${agentId}`) });
    expect(fixture.launches).toHaveLength(1);
  });

  test("an omitted provider launches claude, the API's original meaning", async () => {
    const db = freshDb();
    const claude = recordedClaude(db);
    const fixture = answeredFixture(notCalled);
    const { pane, cwd } = spawnHarness(createRegistry([claude.integration, fixture.integration]), db);
    const res = await pane["pane:spawn"]({ cwd, account: "Me" });
    if (!res.ok) throw new Error(res.error);
    expect(claude.opened).toHaveLength(1);
    expect(claude.opened[0]!.command).toContain("cswap run 'Me'");
    expect(fixture.launches).toHaveLength(0);
  });

  test("a stuck trust dialog leaves the pane not ready", async () => {
    const db = freshDb();
    const { pane, cwd } = spawnHarness(createRegistry([recordedClaude(db, "stuck").integration]), db);
    const res = await pane["pane:spawn"]({ cwd });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.ready).toBe(false);
  });

  test("the launched fixture keeps its native session on the agent record", async () => {
    const db = freshDb();
    const fixture = answeredFixture(async (req) => ({ ok: true, data: { native: fixtureRef(req.nativeHint!), attachment: { mode: "herdr", pane: "w2:p1" }, surface: { tabId: "w2:t1", workspaceId: "w2" } } }));
    const { pane, service, cwd } = spawnHarness(createRegistry([recordedClaude(db).integration, fixture.integration]), db);
    const res = await pane["pane:spawn"]({ cwd, provider: "fixture" });
    if (!res.ok) throw new Error(res.error);
    const rec = await service.handlers["agent:get"]({ id: res.data.agentId! });
    if (!rec.ok) throw new Error(rec.error);
    expect(rec.data).toMatchObject({ provider: "fixture", paneId: "w2:p1", sessionId: fixture.launches[0]!.nativeHint });
  });
});

describe("unknown IDs refuse", () => {
  test("an unregistered provider refuses before anything launches or is recorded", async () => {
    const db = freshDb();
    const claude = recordedClaude(db);
    const { pane, service, cwd, seen } = spawnHarness(createRegistry([claude.integration, codexIntegration, answeredFixture(notCalled).integration]), db);
    const res = await pane["pane:spawn"]({ cwd, provider: "aider" });
    expect(res).toEqual({ ok: false, error: 'invalid provider "aider"; must be one of claude, codex, fixture' });
    expect(claude.opened).toHaveLength(0);
    expect(seen).toHaveLength(0);
    const list = await service.handlers["agent:list"]({});
    expect(list.ok && list.data.agents).toEqual([]);
  });

  test("an option the harness refuses is refused before anything launches", async () => {
    const db = freshDb();
    const fixture = answeredFixture(notCalled);
    const { pane, cwd } = spawnHarness(createRegistry([recordedClaude(db).integration, fixture.integration]), db);
    const res = await pane["pane:spawn"]({ cwd, provider: "fixture", account: "Me" });
    expect(res).toEqual({ ok: false, error: "fixture takes no account" });
    expect(fixture.launches).toHaveLength(0);
  });

  test("an account rt does not know is refused as before", async () => {
    const db = freshDb();
    const { pane, cwd, starts } = spawnHarness(createRegistry([recordedClaude(db).integration]), db);
    const res = await pane["pane:spawn"]({ cwd, account: "Nobody" });
    expect(res).toEqual({ ok: false, error: 'unknown cswap account "Nobody"' });
    expect(starts).toHaveLength(0);
  });

  test("a folder outside every repo rt knows is refused, since its agent could not be recorded", async () => {
    const db = freshDb();
    const { pane, starts } = spawnHarness(createRegistry([recordedClaude(db).integration]), db);
    const res = await pane["pane:spawn"]({ cwd: mkdtempSync(join(tmpdir(), "agent-int-loose-")) });
    expect(res.ok).toBe(false);
    expect(starts).toHaveLength(0);
  });

  test("with the switch off a provider other than claude refuses rather than starting Claude Code", async () => {
    const db = freshDb();
    const { pane, cwd, starts, seen } = spawnHarness(createRegistry([recordedClaude(db).integration, codexIntegration]), db, { enabled: false });
    const res = await pane["pane:spawn"]({ cwd, provider: "codex" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("agent.integrations.enabled");
    expect(starts).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });

  test("with the switch off pane:spawn never reaches the shared start", async () => {
    const db = freshDb();
    const { pane, cwd, starts, seen } = spawnHarness(createRegistry([recordedClaude(db).integration]), db, { enabled: false });
    await pane["pane:spawn"]({ cwd });
    expect(starts).toHaveLength(0);
    expect(seen[0]?.method).toBe("workspace.list");
  });

  test("agent:integrations refuses a mode it does not know", async () => {
    const handlers = createAgentIntegrationHandlers({ integrations: createRegistry([fakeIntegration("claude")]) });
    expect(await handlers["agent:integrations"]({ mode: "tmux" })).toEqual({
      ok: false, error: 'invalid mode "tmux"; must be one of herdr, headless',
    });
    expect(await handlers["agent:integrations"](undefined)).toEqual({
      ok: false, error: 'invalid mode "undefined"; must be one of herdr, headless',
    });
  });
});

describe("integration metadata", () => {
  test("lists every integration's id, label, enabled flag, readiness, capabilities and valid options without loading sessions", async () => {
    const claude = fakeIntegration("claude");
    const codex = fakeIntegration("codex", {
      report: { readiness: { ready: false, reason: "no connection" }, supported: ["launch"] },
      options: [
        { name: "model", kind: "text" },
        { name: "effort", kind: "choice", choices: ["low", "high"] },
        { name: "colour" as never, kind: "text" },
        { name: "yolo", kind: "toggle" as never },
        { name: "effort", kind: "text" },
        { name: "extraArgs", kind: "choice" },
      ],
    });
    const broken = fakeIntegration("broken", { throws: true });
    const summaries = await listAgentIntegrations("headless", {
      integrations: createRegistry([claude, codex, broken]), enabled: (id) => id !== "broken",
    });
    expect(summaries).toEqual([
      { id: "claude", label: "claude label", enabled: true, readiness: { ready: true }, capabilities: ["launch", "observe"], options: [{ name: "model", kind: "text" }] },
      {
        id: "codex", label: "codex label", enabled: true, readiness: { ready: false, reason: "no connection" }, capabilities: ["launch"],
        options: [{ name: "model", kind: "text" }, { name: "effort", kind: "choice", choices: ["low", "high"] }],
      },
      {
        id: "broken", label: "broken label", enabled: false,
        readiness: { ready: false, reason: "rt could not read broken label's capabilities: broken probe broke" },
        capabilities: [], options: [{ name: "model", kind: "text" }],
      },
    ]);
    expect(claude.loads + codex.loads + broken.loads).toBe(0);
  });

  test("the built-in registry reports Codex not ready without connecting and runs no native binary", async () => {
    const summaries = await listAgentIntegrations("herdr", { integrations: builtinRegistry(), enabled: () => true });
    expect(summaries.map((s) => s.id)).toEqual(["claude", "codex"]);
    const codex = summaries.find((s) => s.id === "codex")!;
    expect(codex.readiness.ready).toBe(false);
    expect(codex.options.map((o) => o.name)).not.toContain("account");
    expect(readFileSync(shimLog, "utf8")).toBe("");
  });

  test("enabled defaults to Claude plus the configured rt agent default", async () => {
    const summaries = await listAgentIntegrations("herdr", { integrations: threeHarnesses().registry });
    expect(summaries.map((s) => [s.id, s.enabled])).toEqual([["claude", true], ["codex", false], ["fixture", false]]);
  });

  test("agent:integrations answers through the response envelope", async () => {
    const handlers = createAgentIntegrationHandlers({ integrations: threeHarnesses().registry, enabled: () => true });
    const res = await handlers["agent:integrations"]({ mode: "herdr" });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.integrations.map((s) => s.id)).toEqual(["claude", "codex", "fixture"]);
  });

  test("metadata loading does not import setup modules", () => {
    const libDir = resolve(import.meta.dir, "..", "..");
    const setupDir = join(libDir, "setup");
    const entry = join(libDir, "daemon", "handlers", "agent-integrations.ts");
    const resolveImport = (from: string, spec: string): string | null => {
      const base = resolve(dirname(from), spec);
      for (const candidate of [base, `${base}.ts`, join(base, "index.ts")]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      }
      return null;
    };
    // Every static edge counts, type-only ones included. A dynamic import counts
    // where listing runs it: the integration declarations' capability probes.
    const STATIC = /(?:\bfrom\s*|^\s*import\s*)["'](\.{1,2}\/[^"']+)["']/gm;
    const WITH_DYNAMIC = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s*)["'](\.{1,2}\/[^"']+)["']/gm;
    const specifiers = (file: string): string[] => [
      ...readFileSync(file, "utf8").matchAll(file.endsWith("/integration.ts") ? WITH_DYNAMIC : STATIC),
    ].map((m) => m[1]!);
    const seen = new Set<string>();
    const reached: string[] = [];
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      if (file.startsWith(`${setupDir}/`)) reached.push(relative(libDir, file));
      for (const spec of specifiers(file)) {
        const next = resolveImport(file, spec);
        if (next) visit(next);
      }
    };
    visit(entry);
    expect([...seen].map((f) => relative(libDir, f))).toEqual(expect.arrayContaining([
      "agent-integrations/claude/sessions.ts", "agent-integrations/codex/sessions.ts",
    ]));
    expect(reached).toEqual([]);
  });
});
