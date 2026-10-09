import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import pino from "pino";
import type {
  Capability, CapabilityReport, Mode, Outcome, Readiness, Selection,
} from "../../../packages/rt-client/src/agent-integrations.ts";
import type { HarnessIntegration, PolicyAdapter, SessionAdapter } from "../../agent-integrations/contracts.ts";
import { createRegistry } from "../../agent-integrations/registry.ts";
import { createHerdHandlers, type HerdDeps } from "../handlers/herd.ts";
import { createHerdStore, type HerdStore } from "../herd-store.ts";
import { chooseJobWorker, selectWorker } from "../herd-selection.ts";

const log = pino({ level: "silent" });
const POLICY: Capability[] = ["gate-policy", "continuation-policy"];
const REQUIRED: Capability[] = ["launch", ...POLICY];
const ok = <T>(data: T): Outcome<T> => ({ ok: true, data });
const fail = <T>(code: "unsupported", message: string): Outcome<T> => ({ ok: false, error: { code, message } });

const CLAUDE: Selection = { harness: "claude", options: { model: "opus" } };
const CODEX: Selection = { harness: "codex", options: { model: "gpt-5.1", effort: "high" } };

const sessions = {} as SessionAdapter;

/** Claude's shape: no mode report lists policy, which its adapter proves per session. */
function claudeLike(): HarnessIntegration {
  const policy = { verifiesPerSession: true } as PolicyAdapter;
  return {
    id: "claude", label: "Claude Code",
    capabilities: async (mode: Mode): Promise<CapabilityReport> => ({ mode, supported: ["launch", "resume", "observe"], readiness: { ready: true } }),
    validateOptions: (o) => ok(o),
    options: async () => [{ name: "model", kind: "text" }, { name: "account", kind: "text" }],
    loadSessions: async () => sessions,
    loadPolicy: async () => policy,
  } as HarnessIntegration;
}

/** Codex's shape: policy is proven headless only, and it has no account option. */
function codexLike(readiness: () => Readiness = () => ({ ready: true })): HarnessIntegration {
  return {
    id: "codex", label: "Codex",
    capabilities: async (mode: Mode): Promise<CapabilityReport> => ({
      mode, readiness: readiness(), supported: mode === "headless" ? ["launch", "resume", "observe", ...POLICY] : ["launch", "resume", "observe"],
    }),
    validateOptions: (o) => (o.account !== undefined ? fail("unsupported", "codex does not support --account in this version") : ok(o)),
    options: async () => [{ name: "model", kind: "text" }],
    loadSessions: async () => sessions,
    loadPolicy: async () => ({}) as PolicyAdapter,
  } as HarnessIntegration;
}

const registry = createRegistry([claudeLike(), codexLike()]);
const BOTH = ["claude", "codex"];

describe("selectWorker", () => {
  test("explicit assignment wins", async () => {
    const chosen = await selectWorker({ explicit: CODEX, proposed: CLAUDE, fallback: CLAUDE, enabled: BOTH, mode: "headless", required: REQUIRED }, { registry });
    if (!chosen.ok) throw new Error(chosen.error.message);
    expect(chosen.data.harness).toBe("codex");
    expect(chosen.data.options).toEqual(CODEX.options);
  });

  test("shepherd can mix enabled harnesses", async () => {
    const claude = await selectWorker({ proposed: CLAUDE, fallback: CODEX, enabled: BOTH, mode: "herdr", required: REQUIRED }, { registry });
    const codex = await selectWorker({ proposed: CODEX, fallback: CLAUDE, enabled: BOTH, mode: "headless", required: REQUIRED }, { registry });
    expect(claude).toEqual({ ok: true, data: CLAUDE });
    expect(codex).toEqual({ ok: true, data: CODEX });

    const disabled = await selectWorker({ proposed: CODEX, fallback: CLAUDE, enabled: ["claude"], mode: "headless", required: REQUIRED }, { registry });
    expect(disabled).toMatchObject({ ok: false, error: { code: "refused" } });
    if (!disabled.ok) expect(disabled.error.message).toContain("Codex is not enabled");

    const unsupported = await selectWorker({ proposed: CODEX, fallback: CLAUDE, enabled: BOTH, mode: "herdr", required: REQUIRED }, { registry });
    expect(unsupported).toMatchObject({ ok: false, error: { code: "unsupported" } });
    if (!unsupported.ok) expect(unsupported.error.message).toContain("gate-policy, continuation-policy");
  });

  test("an invalid option, an unready or an unknown harness refuses and never falls back", async () => {
    const account = await selectWorker({ explicit: { harness: "codex", options: { account: "acct-2" } }, fallback: CLAUDE, enabled: BOTH, mode: "headless", required: REQUIRED }, { registry });
    expect(account).toMatchObject({ ok: false, error: { code: "unsupported" } });

    const unready = createRegistry([claudeLike(), codexLike(() => ({ ready: false, reason: "rt cannot reach the Codex app server" }))]);
    const notReady = await selectWorker({ proposed: CODEX, fallback: CLAUDE, enabled: BOTH, mode: "headless", required: REQUIRED }, { registry: unready });
    expect(notReady).toEqual({ ok: false, error: { code: "not-ready", message: "Codex is not ready: rt cannot reach the Codex app server" } });

    const unknown = await selectWorker({ proposed: { harness: "gemini", options: {} }, fallback: CLAUDE, enabled: [...BOTH, "gemini"], mode: "herdr", required: REQUIRED }, { registry });
    expect(unknown).toMatchObject({ ok: false, error: { code: "invalid" } });
  });

  test("with nothing asked, the configured default is the selection, checked the same way", async () => {
    const chosen = await selectWorker({ fallback: CODEX, enabled: ["claude"], mode: "headless", required: REQUIRED }, { registry });
    expect(chosen).toMatchObject({ ok: false, error: { code: "refused" } });
  });
});

describe("chooseJobWorker", () => {
  test("Claude defaults to a herdr pane and Codex to headless, the first mode that can run the job", async () => {
    const claude = await chooseJobWorker({ proposed: CLAUDE, fallback: CLAUDE, enabled: BOTH, required: REQUIRED }, { registry });
    const codex = await chooseJobWorker({ proposed: CODEX, fallback: CLAUDE, enabled: BOTH, required: REQUIRED }, { registry });
    expect(claude).toEqual({ ok: true, data: { selection: CLAUDE, mode: "herdr" } });
    expect(codex).toEqual({ ok: true, data: { selection: CODEX, mode: "headless" } });
  });

  test("a Codex worker asked for in herdr mode refuses while policy is required", async () => {
    const asked = await chooseJobWorker({ proposed: CODEX, fallback: CLAUDE, enabled: BOTH, required: REQUIRED, mode: "herdr" }, { registry });
    expect(asked).toMatchObject({ ok: false, error: { code: "unsupported" } });
  });

  test("retry ignores changed defaults", async () => {
    const persisted = { selection: CODEX, mode: "headless" as const };
    const retried = await chooseJobWorker({ persisted, fallback: CLAUDE, enabled: BOTH, required: REQUIRED }, { registry });
    expect(retried).toEqual({ ok: true, data: persisted });
    if (retried.ok) expect(retried.data.selection.options).toEqual(CODEX.options);

    const gone = await chooseJobWorker({ persisted, fallback: CLAUDE, enabled: ["claude"], required: REQUIRED }, { registry });
    expect(gone).toMatchObject({ ok: false, error: { code: "refused" } });

    const replaced = await chooseJobWorker({ persisted, explicit: CLAUDE, fallback: CODEX, enabled: BOTH, required: REQUIRED }, { registry });
    expect(replaced).toEqual({ ok: true, data: { selection: CLAUDE, mode: "herdr" } });
  });
});

// --- Through herd:spawn ------------------------------------------------------

const HERD = "demo-20261009-120000";
let dir = "";
let store: HerdStore;
let originalHome: string | undefined;
// Spawns write chat session files and read state.db under HOME; each test gets its own so nothing outlives it.
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-herd-selection-"));
  originalHome = process.env.HOME;
  process.env.HOME = join(dir, "home");
  store = createHerdStore({ dbPath: join(dir, "herds.db"), log });
});
afterEach(() => {
  store.close_();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(dir, { recursive: true, force: true });
});

type Spawned = { provider: string; surface: string; model?: string; effort?: string; account?: string; env?: unknown };

type TreeRow = { path: string; branch: string | null; owner?: string; state?: "creating" | "on-deck" | "claimed" | "disposable"; releasedAt?: string };

function spawner(opts: {
  switchOn?: boolean; enabled?: string[]; registry?: ReturnType<typeof createRegistry>;
  /** The worktree registry by tree name; a tree provisioned here is recorded as the job's own. */
  trees?: Record<string, TreeRow>;
  provisionError?: string;
} = {}) {
  store.create({ id: HERD, repo: "remote:example.com%2Fa%2Fb", room: "herd-demo", workspace: `herd: ${HERD}`, shepherdSession: "sess-shep", shepherdHandle: "shepherd", herdrSocket: null, hidden: false });
  const launches: Spawned[] = [];
  const provisions: unknown[] = [];
  const ended: string[] = [];
  const paneCloses: string[][] = [];
  const defaults: { selection: Selection; launch: Record<string, string> } = { selection: CLAUDE, launch: {} };
  let n = 0;
  const reply = <T>(data: T) => ({ ok: true as const, data });
  const startAttempt = async (p: Spawned & { cwd: string }) => {
    launches.push(p);
    n += 1;
    return reply({
      id: `ag-${n}`, sessionId: `sess-${n}`, repo: "r", cwd: p.cwd, surface: p.surface, provider: p.provider,
      ...(p.surface === "herdr" && { paneId: `w9:p${n}` }),
    });
  };
  const deps = {
    store, gateStore: { get: () => null, markConsumed: () => {} },
    gate: { "gate:list": async () => ({ ok: true, data: { gates: [] } }), "gate:subscriptions": async () => ({ ok: true, data: { subscriptions: [] } }) },
    chat: {
      "chat:sign-in": async (p: { continue: string }) => reply({ handle: p.continue, baseHandle: "w", name: "w", continued: true }),
      "chat:join": async () => reply({}),
      "chat:post": async () => reply({ id: 1 }),
      "chat:rooms": async () => reply({ rooms: [] }),
    },
    agent: { "agent:start": (p: Spawned & { cwd: string }) => startAttempt(p), startAttempt },
    worktree: {
      "worktree:provision": async (p: { branch: string; owner: string }) => {
        provisions.push(p);
        if (opts.provisionError) return { ok: false, error: opts.provisionError };
        if (opts.trees) opts.trees[p.branch] = { path: `/w/${p.branch}`, branch: p.branch, owner: p.owner, state: "claimed" };
        return reply({ path: `/w/${p.branch}`, branch: p.branch, tree: p.branch, wasOnDeck: true });
      },
      "worktree:dispose": async () => reply({ disposed: [], refused: [] }),
    },
    runWorktree: () => null,
    findRunningRunByWorktree: () => ({ kind: "none" }),
    presenceIdentityForSession: () => null,
    mintWorkerId: (job: string) => `${job}.w${n + 1}`,
    identityNames: (ids: Iterable<string>) => new Map([...ids].map((id) => [id, id])),
    resolveHandle: (x: string) => x,
    probeInbox: async () => "reachable",
    herdr: async () => ({ ok: true, result: { snapshot: { panes: [] } } }),
    herdrRunnerFor: () => async (args: string[]) => { paneCloses.push(args); return { stdout: "{}", exitCode: 0 }; },
    lifecycle: { connected: () => true, watch: () => {}, sweepClaims: async () => {} },
    bg: { up: async () => false },
    jobsRoot: join(dir, "herds"),
    log,
    integrationsEnabled: () => opts.switchOn ?? true,
    integrations: opts.registry ?? registry,
    enabledHarnesses: () => opts.enabled ?? BOTH,
    defaultSelection: () => defaults.selection,
    endSession: async (key: string) => { ended.push(key); return ok(undefined); },
    launchDefault: (harness: string, option: string) => defaults.launch[`${harness}.${option}`],
    jobTree: (_repo: string, tree: string) => opts.trees?.[tree] ?? null,
  } as unknown as HerdDeps;
  return { h: createHerdHandlers(deps), launches, provisions, ended, paneCloses, defaults };
}

describe("herd:spawn selection", () => {
  test("a shepherd mixes a Claude pane worker and a headless Codex worker in one herd", async () => {
    const { h, launches } = spawner();
    const a = await h["herd:spawn"]({ herd: HERD, job: "job-a", brief: "brief a", harness: "claude", model: "opus" });
    const b = await h["herd:spawn"]({ herd: HERD, job: "job-b", brief: "brief b", harness: "codex", model: "gpt-5.1", effort: "high" });
    if (!a.ok) throw new Error(a.error);
    if (!b.ok) throw new Error(b.error);

    expect(launches.map((l) => [l.provider, l.surface, l.model])).toEqual([["claude", "herdr", "opus"], ["codex", "headless", "gpt-5.1"]]);
    expect(launches[1]!.env).toBeUndefined();
    expect(store.attempts(HERD, "job-a").map((x) => [x.selection, x.mode])).toEqual([[CLAUDE, "herdr"]]);
    expect(store.attempts(HERD, "job-b").map((x) => [x.selection, x.mode])).toEqual([[CODEX, "headless"]]);
    expect(store.getJob(HERD, "job-b")).toMatchObject({ pane: null, status: "active" });

    const status = await h["herd:status"]({ herd: HERD });
    if (!status.ok) throw new Error(status.error);
    expect(status.data.jobs.map((j) => [j.name, j.harness, j.model, j.mode])).toEqual([["job-a", "claude", "opus", "herdr"], ["job-b", "codex", "gpt-5.1", "headless"]]);
  });

  test("an explicit assignment wins over the shepherd's own choice", async () => {
    const { h, launches } = spawner();
    const spawned = await h["herd:spawn"]({ herd: HERD, job: "job-a", brief: "b", harness: "claude", model: "opus", assignment: { harness: "codex", model: "gpt-5.1", effort: "high" } });
    if (!spawned.ok) throw new Error(spawned.error);
    expect(launches.map((l) => [l.provider, l.model, l.effort])).toEqual([["codex", "gpt-5.1", "high"]]);
  });

  test("missing prerequisites refuse before any worktree or worker is made", async () => {
    const cases: Array<[Parameters<typeof spawner>[0], Record<string, unknown>, string]> = [
      [{ enabled: ["claude"] }, { harness: "codex" }, "Codex is not enabled"],
      [{}, { harness: "codex", mode: "herdr" }, "gate-policy, continuation-policy"],
      [{}, { harness: "codex", account: "acct-2" }, "--account"],
      [{ registry: createRegistry([claudeLike(), codexLike(() => ({ ready: false, reason: "no app server" }))]) }, { harness: "codex" }, "no app server"],
      [{ switchOn: false }, { harness: "codex" }, "agent.integrations.enabled"],
    ];
    for (const [opts, asked, why] of cases) {
      store.close_();
      rmSync(dir, { recursive: true, force: true });
      dir = mkdtempSync(join(tmpdir(), "rt-herd-selection-"));
      store = createHerdStore({ dbPath: join(dir, "herds.db"), log });
      const { h, launches, provisions } = spawner(opts);
      const refused = await h["herd:spawn"]({ herd: HERD, job: "job-a", brief: "b", ...asked });
      expect(refused.ok, why).toBe(false);
      if (!refused.ok) expect(refused.error, why).toContain(why);
      if (!refused.ok) expect(refused.failure, why).toEqual({ code: expect.any(String), message: refused.error });
      expect(provisions, why).toEqual([]);
      expect(launches, why).toEqual([]);
      expect(store.attempts(HERD, "job-a"), why).toEqual([]);
    }
  });

  test("retry ignores changed defaults", async () => {
    const { h, launches, defaults } = spawner();
    defaults.selection = CODEX;
    const first = await h["herd:spawn"]({ herd: HERD, job: "job-a", brief: "b" });
    if (!first.ok) throw new Error(first.error);
    defaults.selection = CLAUDE;
    const retried = await h["herd:spawn"]({ herd: HERD, job: "job-a" });
    if (!retried.ok) throw new Error(retried.error);

    expect(launches.map((l) => [l.provider, l.surface, l.model, l.effort])).toEqual([["codex", "headless", "gpt-5.1", "high"], ["codex", "headless", "gpt-5.1", "high"]]);
    const [original, retry] = store.attempts(HERD, "job-a");
    expect(retry!.selection).toEqual(original!.selection);
    expect(retry!.mode).toBe("headless");
  });

  test("a harness change is a new selection recorded as a replacement attempt", async () => {
    const { h, launches } = spawner();
    const first = await h["herd:spawn"]({ herd: HERD, job: "job-a", brief: "b", harness: "codex" });
    if (!first.ok) throw new Error(first.error);
    store.activateAttempt(store.attempts(HERD, "job-a")[0]!.id, null, 0);
    const changed = await h["herd:spawn"]({ herd: HERD, job: "job-a", harness: "claude" });
    if (!changed.ok) throw new Error(changed.error);
    const [old, next] = store.attempts(HERD, "job-a");
    expect([old!.selection.harness, next!.selection.harness]).toEqual(["codex", "claude"]);
    expect(next!.replaces).toBe(old!.id);
    expect(launches.map((l) => l.provider)).toEqual(["codex", "claude"]);
  });

  test("closing a headless worker ends its session through its integration, not a pane close", async () => {
    const { h, ended, paneCloses } = spawner();
    const spawned = await h["herd:spawn"]({ herd: HERD, job: "job-b", brief: "b", harness: "codex" });
    if (!spawned.ok) throw new Error(spawned.error);
    store.activateAttempt(store.attempts(HERD, "job-b")[0]!.id, "sk-codex", 1);
    const closed = await h["herd:close"]({ herd: HERD, job: "job-b" });
    expect(closed.ok).toBe(true);
    expect(ended).toEqual(["sk-codex"]);
    expect(paneCloses).toEqual([]);
  });

  test("switch off: harness, model and mode stay off herd:status", async () => {
    const { h } = spawner({ switchOn: false });
    store.upsertJob({ herd: HERD, name: "job-a", worktree: "/w/a", handle: "job-a.w1", status: "active" });
    const status = await h["herd:status"]({ herd: HERD });
    if (!status.ok) throw new Error(status.error);
    expect(Object.keys(status.data.jobs[0]!)).not.toContain("harness");
    expect(Object.keys(status.data.jobs[0]!)).not.toContain("mode");
  });
});

describe("herd:spawn respawns: the job's tree, then the attempt, then the close", () => {
  const OWNER = `herd:${HERD}`;
  /** The brief an earlier spawn stored, so a respawn naming none reuses it. */
  const writeBrief = (job: string) => {
    mkdirSync(join(dir, "herds", HERD, job), { recursive: true });
    writeFileSync(join(dir, "herds", HERD, job, "job.md"), "b");
  };

  test("an MCP retry, which names no dir, keeps its selection after the default changes and reuses the job's own tree", async () => {
    const trees: Record<string, TreeRow> = {};
    const { h, launches, provisions, defaults, ended } = spawner({ trees });
    defaults.selection = CODEX;
    const first = await h["herd:spawn"]({ herd: HERD, job: "job-a", brief: "b" });
    if (!first.ok) throw new Error(first.error);
    store.activateAttempt(store.attempts(HERD, "job-a")[0]!.id, "sk-first", 1);
    defaults.selection = CLAUDE;

    const retried = await h["herd:spawn"]({ herd: HERD, job: "job-a" });
    if (!retried.ok) throw new Error(retried.error);
    expect(provisions).toHaveLength(1);
    expect(retried.data).toMatchObject({ worktree: "/w/job-a", branch: "job-a", tree: "job-a", wasOnDeck: null });
    expect(launches.map((l) => [l.provider, l.surface, (l as Spawned & { cwd: string }).cwd])).toEqual([["codex", "headless", "/w/job-a"], ["codex", "headless", "/w/job-a"]]);
    const [original, retry] = store.attempts(HERD, "job-a");
    expect(retry!.selection).toEqual(original!.selection);
    expect(retry!.replaces).toBe(original!.id);
    expect(ended).toEqual(["sk-first"]);
  });

  test("a tree that is no longer the job's is not reused: the respawn provisions as before", async () => {
    const trees: Record<string, TreeRow> = {};
    const { h, provisions } = spawner({ trees });
    const first = await h["herd:spawn"]({ herd: HERD, job: "job-a", brief: "b", harness: "codex" });
    if (!first.ok) throw new Error(first.error);
    const moved: TreeRow[] = [
      { path: "/w/job-a", branch: "other", owner: OWNER, state: "claimed" },
      { path: "/w/job-a", branch: "job-a", owner: "herd:another", state: "claimed" },
      { path: "/w/t9", branch: "job-a", owner: OWNER, state: "claimed" },
      { path: "/w/job-a", branch: "job-a", owner: OWNER, state: "claimed", releasedAt: "2026-10-09T09:00:00.000Z" },
      { path: "/w/job-a", branch: "job-a", owner: OWNER, state: "disposable" },
    ];
    for (const row of moved) {
      trees["job-a"] = row;
      const before = provisions.length;
      expect((await h["herd:spawn"]({ herd: HERD, job: "job-a" })).ok).toBe(true);
      expect(provisions.length, JSON.stringify(row)).toBe(before + 1);
    }
  });

  test("an explicit replacement of a headless worker records the attempt it replaces", async () => {
    const { h } = spawner();
    const first = await h["herd:spawn"]({ herd: HERD, job: "job-b", brief: "b", harness: "codex" });
    if (!first.ok) throw new Error(first.error);
    store.activateAttempt(store.attempts(HERD, "job-b")[0]!.id, "sk-codex", 1);
    const replaced = await h["herd:spawn"]({ herd: HERD, job: "job-b", assignment: { harness: "codex", model: "gpt-5.2" } });
    if (!replaced.ok) throw new Error(replaced.error);
    const [old, next] = store.attempts(HERD, "job-b");
    expect(old!.state).toBe("ended");
    expect(next!.replaces).toBe(old!.id);
  });

  test("a refused respawn closes nothing: the live worker keeps running and holding its job", async () => {
    const cases: Array<[string, Parameters<typeof spawner>[0], Record<string, unknown>]> = [
      ["selection", {}, { harness: "codex", account: "acct-2" }],
      ["tree", { provisionError: "branch-attached:t4" }, {}],
    ];
    for (const [why, opts, asked] of cases) {
      store.close_();
      rmSync(dir, { recursive: true, force: true });
      dir = mkdtempSync(join(tmpdir(), "rt-herd-selection-"));
      store = createHerdStore({ dbPath: join(dir, "herds.db"), log });
      const { h, ended, paneCloses, launches } = spawner(opts);
      store.upsertJob({ herd: HERD, name: "job-b", worktree: "/w/job-b", branch: "job-b", tree: "job-b", handle: "job-b.w1", status: "active" });
      writeBrief("job-b");
      store.reserveAttempt({ id: "att-live", herd: HERD, job: "job-b", selection: CODEX, mode: "headless" });
      store.activateAttempt("att-live", "sk-live", 1);

      const refused = await h["herd:spawn"]({ herd: HERD, job: "job-b", ...asked });
      expect(refused.ok, why).toBe(false);
      expect(ended, why).toEqual([]);
      expect(paneCloses, why).toEqual([]);
      expect(launches, why).toEqual([]);
      expect(store.activeAttempt(HERD, "job-b")?.id, why).toBe("att-live");
      expect(store.attempts(HERD, "job-b").map((a) => a.state), why).toEqual(why === "tree" ? ["active", "ended"] : ["active"]);
      expect(store.getJob(HERD, "job-b"), why).toMatchObject({ handle: "job-b.w1", status: "active" });
    }
  });

  test("switch off: a respawn still closes the old pane before it provisions, as before", async () => {
    const { h, paneCloses, provisions } = spawner({ switchOn: false, provisionError: "branch-attached:job-a" });
    store.upsertJob({ herd: HERD, name: "job-a", worktree: "/w/job-a", branch: "job-a", tree: "job-a", handle: "job-a.w1", status: "active", pane: "w9:p7" });
    writeBrief("job-a");
    const refused = await h["herd:spawn"]({ herd: HERD, job: "job-a" });
    expect(refused).toEqual({ ok: false, error: "provision failed: branch-attached:job-a" });
    expect(paneCloses).toEqual([["pane", "close", "w9:p7"]]);
    expect(provisions).toHaveLength(1);
  });
});

describe("herd:spawn options, defaults, accounts and closes", () => {
  test("options naming no harness go to the job's recorded harness", async () => {
    const { h, launches } = spawner();
    const first = await h["herd:spawn"]({ herd: HERD, job: "job-b", brief: "b", harness: "codex", model: "gpt-5.1" });
    if (!first.ok) throw new Error(first.error);
    const again = await h["herd:spawn"]({ herd: HERD, job: "job-b", model: "gpt-5.2" });
    if (!again.ok) throw new Error(again.error);
    expect(launches.map((l) => [l.provider, l.model])).toEqual([["codex", "gpt-5.1"], ["codex", "gpt-5.2"]]);
  });

  test("with no recorded harness, options go to the default only when it is the sole enabled, ready harness", async () => {
    const sole = spawner({ enabled: ["claude"] });
    const ok1 = await sole.h["herd:spawn"]({ herd: HERD, job: "job-a", brief: "b", model: "opus" });
    if (!ok1.ok) throw new Error(ok1.error);
    expect(sole.launches.map((l) => [l.provider, l.model])).toEqual([["claude", "opus"]]);

    store.close_();
    rmSync(dir, { recursive: true, force: true });
    dir = mkdtempSync(join(tmpdir(), "rt-herd-selection-"));
    store = createHerdStore({ dbPath: join(dir, "herds.db"), log });
    const both = spawner();
    const refused = await both.h["herd:spawn"]({ herd: HERD, job: "job-a", brief: "b", model: "opus" });
    expect(refused).toMatchObject({ ok: false, failure: { code: "invalid" } });
    if (!refused.ok) expect(refused.error).toContain("name the harness for this job");
    expect(both.provisions).toEqual([]);
    expect(both.launches).toEqual([]);
    expect(store.attempts(HERD, "job-a")).toEqual([]);
  });

  test("retry ignores a launch default changed since the first spawn, and status shows the pinned model", async () => {
    const { h, launches, defaults } = spawner();
    defaults.launch = { "codex.model": "gpt-5.1", "codex.effort": "high" };
    const first = await h["herd:spawn"]({ herd: HERD, job: "job-b", brief: "b", harness: "codex" });
    if (!first.ok) throw new Error(first.error);
    defaults.launch = { "codex.model": "gpt-6", "codex.effort": "low" };
    const retried = await h["herd:spawn"]({ herd: HERD, job: "job-b" });
    if (!retried.ok) throw new Error(retried.error);

    expect(launches.map((l) => [l.model, l.effort])).toEqual([["gpt-5.1", "high"], ["gpt-5.1", "high"]]);
    expect(store.attempts(HERD, "job-b").map((a) => a.selection)).toEqual([CODEX, CODEX]);
    const status = await h["herd:status"]({ herd: HERD });
    if (!status.ok) throw new Error(status.error);
    expect(status.data.jobs[0]).toMatchObject({ harness: "codex", model: "gpt-5.1" });
  });

  test("the caller's account hint applies to a Claude Code worker and is dropped for Codex", async () => {
    const { h, launches } = spawner();
    const a = await h["herd:spawn"]({ herd: HERD, job: "job-a", brief: "b", harness: "claude", callerAccount: "alex@acme.test" });
    const b = await h["herd:spawn"]({ herd: HERD, job: "job-b", brief: "b", harness: "codex", callerAccount: "alex@acme.test" });
    if (!a.ok) throw new Error(a.error);
    if (!b.ok) throw new Error(b.error);
    expect(launches.map((l) => [l.provider, l.account])).toEqual([["claude", "alex@acme.test"], ["codex", undefined]]);
    expect(store.attempts(HERD, "job-b")[0]!.selection.options.account).toBeUndefined();
  });

  test("switch off: the account hint fills a Claude worker's account as before", async () => {
    const { h, launches } = spawner({ switchOn: false });
    const spawned = await h["herd:spawn"]({ herd: HERD, job: "job-a", brief: "b", callerAccount: "alex@acme.test" });
    if (!spawned.ok) throw new Error(spawned.error);
    const named = await h["herd:spawn"]({ herd: HERD, job: "job-c", brief: "b", account: "other@example.com", callerAccount: "alex@acme.test" });
    if (!named.ok) throw new Error(named.error);
    expect(launches.map((l) => [l.provider, l.surface, l.account])).toEqual([["claude", "herdr", "alex@acme.test"], ["claude", "herdr", "other@example.com"]]);
  });

  test("a headless worker's session ends once: a second close or a respawn does not end it again", async () => {
    const { h, ended } = spawner();
    const spawned = await h["herd:spawn"]({ herd: HERD, job: "job-b", brief: "b", harness: "codex" });
    if (!spawned.ok) throw new Error(spawned.error);
    const attempt = store.attempts(HERD, "job-b")[0]!;
    store.activateAttempt(attempt.id, "sk-codex", 1);
    expect((await h["herd:close"]({ herd: HERD, job: "job-b" })).ok).toBe(true);
    expect((await h["herd:close"]({ herd: HERD, job: "job-b" })).ok).toBe(true);
    const respawned = await h["herd:spawn"]({ herd: HERD, job: "job-b" });
    if (!respawned.ok) throw new Error(respawned.error);
    expect(ended).toEqual(["sk-codex"]);
    expect(store.getAttempt(attempt.id)?.state).toBe("ended");
  });

  test("switch off: a close never reaches an integration, even for a job whose attempt says headless", async () => {
    const { h, ended, paneCloses } = spawner({ switchOn: false });
    store.upsertJob({ herd: HERD, name: "job-b", worktree: "/w/b", handle: "job-b.w1", status: "active", pane: "w9:p7" });
    store.reserveAttempt({ id: "att-h", herd: HERD, job: "job-b", selection: CODEX, mode: "headless" });
    store.activateAttempt("att-h", "sk-codex", 1);
    expect((await h["herd:close"]({ herd: HERD, job: "job-b" })).ok).toBe(true);
    expect(ended).toEqual([]);
    expect(paneCloses).toEqual([["pane", "close", "w9:p7"]]);
  });
});
