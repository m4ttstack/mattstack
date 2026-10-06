import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, relative, resolve } from "path";
import type {
  Mode, OptionDescriptor, Outcome, Readiness, SessionBinding,
} from "../../../packages/rt-client/src/agent-integrations.ts";
import { builtinRegistry } from "../../agent-integrations/builtins.ts";
import type {
  HarnessIntegration, IntegrationRegistry, NativeLaunch, SessionAdapter, WorkInput,
} from "../../agent-integrations/contracts.ts";
import type { BoundLaunchRequest, BoundLauncher, PreparedBinding, SubmittedWork } from "../../agent-integrations/launch.ts";
import { createRegistry } from "../../agent-integrations/registry.ts";
import { createSessionStore } from "../../agent-integrations/session-store.ts";
import { herdrRequest } from "../../herdr/client.ts";
import { fakeHerdr, HerdrFakeError, type FakeHerdrHandler } from "../../herdr/__tests__/fake-herdr.ts";
import { openStateDb } from "../../state/index.ts";
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

type FakeIntegration = HarnessIntegration & { loads: number };
/** A session-only integration may report only what its session adapter does. */
type SessionOnly = "launch" | "resume" | "observe";

function fakeIntegration(
  id: string,
  extra: { discovered?: NativeLaunch[]; options?: OptionDescriptor[]; report?: { readiness?: Readiness; supported?: SessionOnly[] }; throws?: boolean } = {},
): FakeIntegration {
  const adapter: SessionAdapter = {
    launch: notCalled, resume: notCalled, observe: notCalled, startWork: notCalled,
    discover: async () => extra.discovered ?? [],
  };
  const integration: FakeIntegration = {
    id,
    label: `${id} label`,
    loads: 0,
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

/** Binds through the real session store when given its db, the way the shared launcher records a launch. */
function fakeLauncher(binding: Partial<SessionBinding["attachment"]> & { surface?: PreparedBinding["surface"] } = {}, db?: Database) {
  const launches: BoundLaunchRequest[] = [];
  const works: WorkInput[] = [];
  const { surface: asked, ...attachment } = binding;
  const surface = asked ?? { tabId: "w2:t3", workspaceId: "w2", trust: "none" };
  const native = { harness: "fixture", profile: "default", kind: "id" as const, value: "fix-native" };
  const launcher: BoundLauncher = {
    async launchBoundAgent(request) {
      launches.push(request);
      if (db) {
        const bound = createSessionStore(db).bind(request.reservationId, native, { mode: "herdr", pane: "w2:p7", ...attachment });
        return bound.ok ? { ok: true, data: { ...bound.data, surface } } : bound;
      }
      return { ok: true, data: { key: "k1", identity: "pane:x", native, attachment: { generation: 1, mode: "herdr", pane: "w2:p7", ...attachment }, surface } };
    },
    async startBoundWork(bound, input, authorize): Promise<Outcome<SubmittedWork>> {
      works.push(input);
      const allowed = await authorize();
      if (!allowed.ok) return allowed;
      return { ok: true, data: { id: input.id, evidence: "submitted", binding: bound } };
    },
    recover: async () => {},
  };
  return { launcher, launches, works };
}

const paneInfo = (id: string, agent: string | undefined, extra: Record<string, unknown> = {}) => ({
  pane_id: id, terminal_id: `t-${id}`, workspace_id: "w1", tab_id: "w1:t1", focused: false,
  ...(agent !== undefined && { agent }), agent_status: "idle", cwd: "/repos/acme", revision: 1, ...extra,
});

const SNAPSHOT = {
  type: "session_snapshot",
  snapshot: {
    version: "0.8.0", protocol: 19, tabs: [], layouts: [], agents: [],
    workspaces: [{ workspace_id: "w1", label: "acme", focused: false }],
    panes: [
      paneInfo("w1:p1", "claude", { agent_session: { source: "herdr:claude", agent: "claude", kind: "id", value: "sess-claude" } }),
      paneInfo("w1:p2", "codex", { agent_session: { source: "herdr:codex", agent: "codex", kind: "id", value: "thread-codex" } }),
      paneInfo("w1:p3", "fixture"),
      paneInfo("w1:p4", "aider"),
      paneInfo("w1:p5", undefined),
    ],
  },
};

function listFake(): FakeHerdrHandler {
  return (method, params) => {
    if (method === "session.snapshot") return SNAPSHOT;
    if (method === "pane.process_info" && params.pane_id === "w1:p3") {
      return { process_info: { pane_id: "w1:p3", shell_pid: 1, foreground_process_group_id: 7001, foreground_processes: [{ pid: 7002 }] } };
    }
    return new HerdrFakeError("invalid_request", method);
  };
}

const spawnPane = (status: string) => paneInfo("w2:p7", "fixture", { workspace_id: "w2", tab_id: "w2:t3", agent_status: status, cwd: "/repos/acme-dev" });

function spawnFake(status = "idle"): FakeHerdrHandler {
  return (method) => {
    if (method === "pane.get") return { type: "pane_info", pane: spawnPane(status) };
    return new HerdrFakeError("invalid_request", method);
  };
}

const CSWAP_EXEC = async (argv: [string, ...string[]]) =>
  argv[1] === "list" ? { stdout: "Accounts:\n  1: me@x.y [Me]\n", stderr: "", exitCode: 0 } : { stdout: "main\n", stderr: "", exitCode: 0 };

function harness(handler: FakeHerdrHandler, opts: {
  integrations?: IntegrationRegistry; enabled?: boolean; launcher?: BoundLauncher; claudeRegistryRoots?: string[]; db?: Database;
} = {}) {
  const { sock, seen, stop } = fakeHerdr(handler);
  stops.push(stop);
  const db = opts.db ?? freshDb();
  const herdr: typeof herdrRequest = (method, params, o) => herdrRequest(method, params, { ...o, sockPath: sock });
  const pane = createPaneHandlers({
    db, repoIndex: () => ({}), herdr, exec: CSWAP_EXEC,
    ...(opts.claudeRegistryRoots !== undefined && { claudeRegistryRoots: opts.claudeRegistryRoots }),
    ...(opts.integrations !== undefined && { integrations: opts.integrations }),
    ...(opts.enabled !== undefined && { integrationsEnabled: () => opts.enabled! }),
    ...(opts.launcher !== undefined && { launcher: opts.launcher }),
  });
  return { pane, seen, db };
}

function threeHarnesses() {
  const claude = fakeIntegration("claude");
  const codex = fakeIntegration("codex");
  const fixture = fakeIntegration("fixture", {
    discovered: [{ native: { harness: "fixture", profile: "default", kind: "id", value: "fix-from-pid" }, attachment: { mode: "herdr", pid: 7002 } }],
  });
  return { claude, codex, fixture, registry: createRegistry([claude, codex, fixture]) };
}

describe("pane discovery through the integration registry", () => {
  test("pane discovery includes both harnesses and fixture integration", async () => {
    const { claude, codex, fixture, registry } = threeHarnesses();
    const { pane } = harness(listFake(), { integrations: registry, enabled: true });
    const res = await pane["pane:list"]({});
    if (!res.ok) throw new Error(res.error);
    const panes = res.data.panes;
    expect(panes.map((p) => p.provider).sort()).toEqual(["claude", "codex", "fixture"]);
    expect(panes.find((p) => p.provider === "fixture")?.sessionId).toBe("fix-from-pid");
    expect(panes.find((p) => p.provider === "codex")?.sessionId).toBe("thread-codex");
    expect(fixture.loads).toBe(1);
    expect(claude.loads + codex.loads).toBe(0);
  });

  test("a pane whose harness discovered nothing is not asked for its processes", async () => {
    const quiet = createRegistry([fakeIntegration("claude"), fakeIntegration("codex"), fakeIntegration("fixture")]);
    const { pane, seen } = harness(listFake(), { integrations: quiet, enabled: true });
    const res = await pane["pane:list"]({});
    if (!res.ok) throw new Error(res.error);
    expect(res.data.panes.find((p) => p.provider === "fixture")?.sessionId).toBeUndefined();
    expect(seen.map((s) => s.method)).toEqual(["session.snapshot"]);
  });

  test("with the switch off pane:list is today's Claude-only list, with no provider, whatever the registry holds", async () => {
    const { registry, fixture } = threeHarnesses();
    const root = mkdtempSync(join(tmpdir(), "agent-int-creg-"));
    const baseline = harness(listFake(), { claudeRegistryRoots: [root] });
    const off = harness(listFake(), { integrations: registry, enabled: false, claudeRegistryRoots: [root] });
    const before = await baseline.pane["pane:list"]({});
    const after = await off.pane["pane:list"]({});
    expect(after).toEqual(before);
    if (!after.ok) throw new Error(after.error);
    expect(after.data.panes.map((p) => p.paneId)).toEqual(["w1:p1"]);
    expect(after.data.panes.every((p) => !("provider" in p))).toBe(true);
    expect(off.seen.map((s) => s.method)).toEqual(baseline.seen.map((s) => s.method));
    expect(fixture.loads).toBe(0);
  });
});

describe("pane creation through the shared launcher", () => {
  test("pane:spawn calls the shared launcher once and opens nothing itself", async () => {
    const { registry } = threeHarnesses();
    const { launcher, launches, works } = fakeLauncher();
    const { pane, seen } = harness(spawnFake("idle"), { integrations: registry, enabled: true, launcher });
    const res = await pane["pane:spawn"]({ cwd: "/repos/acme-dev", provider: "fixture", model: "m1", workspace: "fleet" });
    if (!res.ok) throw new Error(res.error);
    expect(launches).toHaveLength(1);
    expect(launches[0]).toMatchObject({
      cwd: "/repos/acme-dev", mode: "herdr", selection: { harness: "fixture", options: { model: "m1" } },
      host: { workspace: "fleet", tab: "acme-dev" },
    });
    expect(works).toHaveLength(0);
    expect(res.data).toMatchObject({ ready: true, pane: { paneId: "w2:p7", workspace: "fleet", provider: "fixture", agentStatus: "idle" } });
    expect(seen.map((s) => s.method)).toEqual(["pane.get"]);
  });

  test("an opening prompt is submitted once through the launcher's work step", async () => {
    const { registry } = threeHarnesses();
    const db = freshDb();
    const { launcher, launches, works } = fakeLauncher({}, db);
    const { pane } = harness(spawnFake("working"), { integrations: registry, enabled: true, launcher, db });
    const res = await pane["pane:spawn"]({ cwd: "/repos/acme-dev", provider: "fixture", prompt: "read AGENTS.md" });
    if (!res.ok) throw new Error(res.error);
    expect(launches).toHaveLength(1);
    expect(launches[0]!.prompt).toBe("read AGENTS.md");
    expect(works.map((w) => w.text)).toEqual(["read AGENTS.md"]);
    expect(res.data.ready).toBe(true);
  });

  test("the opening prompt is not sent once the session belongs to someone else", async () => {
    const { registry } = threeHarnesses();
    const { launcher, works } = fakeLauncher();
    const { pane } = harness(spawnFake("idle"), { integrations: registry, enabled: true, launcher });
    const res = await pane["pane:spawn"]({ cwd: "/repos/acme-dev", provider: "fixture", prompt: "read AGENTS.md" });
    expect(res.ok).toBe(false);
    expect(works).toHaveLength(1);
  });

  test("an omitted provider launches claude, the API's original meaning", async () => {
    const { registry } = threeHarnesses();
    const { launcher, launches } = fakeLauncher();
    const { pane } = harness(spawnFake("idle"), { integrations: registry, enabled: true, launcher });
    const res = await pane["pane:spawn"]({ cwd: "/repos/acme-dev", account: "Me" });
    if (!res.ok) throw new Error(res.error);
    expect(launches[0]!.selection).toEqual({ harness: "claude", options: { account: "Me" } });
  });

  test("a stuck trust dialog leaves the pane not ready", async () => {
    const { registry } = threeHarnesses();
    const { launcher } = fakeLauncher({ surface: { tabId: "w2:t3", workspaceId: "w2", trust: "stuck" } });
    const { pane } = harness(spawnFake("idle"), { integrations: registry, enabled: true, launcher });
    const res = await pane["pane:spawn"]({ cwd: "/repos/acme-dev", provider: "fixture" });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.ready).toBe(false);
  });
});

describe("unknown IDs refuse", () => {
  test("an unregistered provider refuses before anything launches", async () => {
    const { registry } = threeHarnesses();
    const { launcher, launches } = fakeLauncher();
    const { pane, seen } = harness(spawnFake(), { integrations: registry, enabled: true, launcher });
    const res = await pane["pane:spawn"]({ cwd: "/repos/acme-dev", provider: "aider" });
    expect(res).toEqual({ ok: false, error: 'invalid provider "aider"; must be one of claude, codex, fixture' });
    expect(launches).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });

  test("an option the harness refuses is refused before anything launches", async () => {
    const { registry } = threeHarnesses();
    const { launcher, launches } = fakeLauncher();
    const { pane } = harness(spawnFake(), { integrations: registry, enabled: true, launcher });
    const res = await pane["pane:spawn"]({ cwd: "/repos/acme-dev", provider: "codex", account: "Me" });
    expect(res).toEqual({ ok: false, error: "codex takes no account" });
    expect(launches).toHaveLength(0);
  });

  test("an account rt does not know is refused as before", async () => {
    const { registry } = threeHarnesses();
    const { launcher, launches } = fakeLauncher();
    const { pane } = harness(spawnFake(), { integrations: registry, enabled: true, launcher });
    const res = await pane["pane:spawn"]({ cwd: "/repos/acme-dev", account: "Nobody" });
    expect(res).toEqual({ ok: false, error: 'unknown cswap account "Nobody"' });
    expect(launches).toHaveLength(0);
  });

  test("with the switch off a provider other than claude refuses rather than starting Claude Code", async () => {
    const { registry } = threeHarnesses();
    const { launcher, launches } = fakeLauncher();
    const { pane, seen } = harness(spawnFake(), { integrations: registry, enabled: false, launcher });
    const res = await pane["pane:spawn"]({ cwd: "/repos/acme-dev", provider: "codex" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("agent.integrations.enabled");
    expect(launches).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });

  test("with the switch off pane:spawn never reaches the launcher", async () => {
    const { registry } = threeHarnesses();
    const { launcher, launches } = fakeLauncher();
    const { pane, seen } = harness(spawnFake(), { integrations: registry, enabled: false, launcher });
    await pane["pane:spawn"]({ cwd: "/repos/acme-dev" });
    expect(launches).toHaveLength(0);
    expect(seen[0]?.method).toBe("workspace.list");
  });

  test("agent:integrations refuses a mode it does not know", async () => {
    const handlers = createAgentIntegrationHandlers({ integrations: threeHarnesses().registry });
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
