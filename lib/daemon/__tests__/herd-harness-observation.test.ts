import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import pino from "pino";
import type { Observation, Outcome, Selection, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import type { CodexControl } from "../../agent-integrations/codex/control.ts";
import { CodexEventHub } from "../../agent-integrations/codex/events.ts";
import type { CodexEvent } from "../../agent-integrations/codex/protocol.ts";
import { createClaudeSessions, type ClaudeSessionDeps } from "../../agent-integrations/claude/sessions.ts";
import { createRegistry } from "../../agent-integrations/registry.ts";
import type { HarnessIntegration, SessionAdapter } from "../../agent-integrations/contracts.ts";
import { __test__ as observationStoreTest, latestObservation, recordObservation } from "../../agent-integrations/observation-store.ts";
import { createSessionStore } from "../../agent-integrations/session-store.ts";
import { openStateDb } from "../../state/db.ts";
import { createHerdHandlers, type HerdDeps } from "../handlers/herd.ts";
import { createHerdStore, type HerdJobRow, type HerdRow, type HerdStore, type JobAttempt } from "../herd-store.ts";
import { createJobObserver, createWatchdogSensors } from "../herd-watchdog-adapters.ts";
import {
  classifyJobObservation, evaluateJob, HerdWatchdog, STALE_OBSERVATION_MS,
  type WatchdogActuators, type WatchdogConfig,
} from "../herd-watchdog.ts";

const log = pino({ level: "silent" });
const NOW = 10_000_000;
const MIN = 60_000;
const UUID = "6e225e74-4cb7-4aea-8807-6aa9011d4112";

const cfg: WatchdogConfig = {
  enabled: true, fastMins: 2, shepherdFastMins: 5, backstopMins: 15,
  retryMins: 5, notifyQuietMins: 30, nagMins: 30, notifyHuman: true,
  midRunTrustAccept: true, relocationAutoAccept: true,
  backgroundCapMins: 60,
};

const CODEX: Selection = { harness: "codex", options: { model: "gpt-5.1" } };
const CLAUDE: Selection = { harness: "claude", options: {} };

function attempt(over: Partial<JobAttempt> = {}): JobAttempt {
  return {
    id: "att-1", herd: "demo-1", job: "job-a", selection: CODEX, mode: "headless",
    bindingKey: "sk-1", generation: 2, state: "active",
    createdAt: NOW - 60 * MIN, updatedAt: NOW - 60 * MIN, activatedAt: NOW - 60 * MIN,
    ...over,
  };
}

function seen(over: Partial<Observation> = {}): Observation {
  return { connectivity: "connected", execution: "working", background: "unknown", observedAt: NOW - 1_000, source: "codex-events", generation: 2, ...over };
}

function herd(over: Partial<HerdRow> = {}): HerdRow {
  return {
    id: "demo-1", repo: "r", room: "herd-demo-1", workspace: "herd: demo-1",
    shepherdSession: "sess-s", shepherdHandle: "shepherd", shepherdPane: "w1:p0",
    herdrSocket: null, hidden: false, status: "active", createdAt: NOW - 60 * MIN, wrappedAt: null,
    ...over,
  };
}

function job(over: Partial<HerdJobRow> = {}): HerdJobRow {
  return {
    herd: "demo-1", name: "job-a", worktree: "/w", branch: null, tree: "t1",
    pane: null, agentSession: null, agentId: null, handle: "job-a",
    status: "active", disposable: false, lastGate: null, lastReport: null,
    createdAt: NOW - 60 * MIN, updatedAt: NOW - 60 * MIN,
    ...over,
  };
}

type Act = { poke: string[]; relocation: number; trust: number; park: number; stuck: number; human: string[] };

function actuators(): { act: WatchdogActuators; calls: Act } {
  const calls: Act = { poke: [], relocation: 0, trust: 0, park: 0, stuck: 0, human: [] };
  const act: WatchdogActuators = {
    poke: async (pane, text) => { calls.poke.push(`${pane}: ${text}`); return true; },
    acceptRelocationModal: async () => { calls.relocation += 1; return false; },
    acceptTrustModal: async () => { calls.trust += 1; return false; },
    parkStuckAtModal: () => { calls.park += 1; },
    notifyStuckAtModal: () => { calls.stuck += 1; },
    notifyHuman: (summary) => { calls.human.push(summary); },
  };
  return { act, calls };
}

/** Sensors over a fake herd store and herdr, with the job's active attempt observed through `observe`. */
function observedSensors(opts: {
  jobs: HerdJobRow[];
  attempts?: Record<string, JobAttempt>;
  observe?: (attempt: JobAttempt) => Promise<Outcome<Observation>>;
  enabled?: boolean;
  clock?: { now: number };
  panes?: Array<{ pane_id: string; agent?: string; agent_status?: string }>;
  screens?: Record<string, string>;
}) {
  const clock = opts.clock ?? { now: NOW };
  const observed: string[] = [];
  const herdrCalls: string[] = [];
  const herdr = (async (method: string, params: { pane_id?: string }) => {
    herdrCalls.push(method);
    if (method === "pane.read") {
      const text = opts.screens?.[params.pane_id ?? ""];
      return text === undefined ? { ok: false, code: "pane_not_found", message: "no such pane" } : { ok: true, result: { read: { text } } };
    }
    return { ok: true, result: { snapshot: { panes: opts.panes ?? [] } } };
  }) as any;
  const sensors = createWatchdogSensors({
    herdStore: {
      list: () => [herd()],
      jobs: () => opts.jobs,
      activeAttempt: (_herd: string, name: string) => opts.attempts?.[name] ?? null,
      attempts: (_herd: string, name: string) => (opts.attempts?.[name] ? [opts.attempts[name]!] : []),
    },
    gatesStore: { list: () => ({ gates: [], cursor: 0 }), unconsumedAnsweredPushes: () => [] },
    lifecycle: { lastStatusChangeMs: () => null },
    herdr,
    defaultSocket: "/default.sock",
    db: openStateDb(join(dir, "state.db")),
    now: () => clock.now,
    log,
    enabled: () => opts.enabled ?? true,
    observeJob: async (a) => {
      observed.push(a.id);
      return opts.observe ? opts.observe(a) : { ok: false, error: { code: "transient", message: "no channel" } };
    },
  });
  return { sensors, observed, herdrCalls, clock };
}

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-herd-observation-"));
  observationStoreTest.reset();
});
afterEach(() => {
  observationStoreTest.reset();
  rmSync(dir, { recursive: true, force: true });
});

describe("classifyJobObservation", () => {
  test("non-Claude is not dead", () => {
    for (const execution of ["working", "idle"] as const) {
      expect(classifyJobObservation(attempt(), seen({ execution }), NOW)).toBe("active");
    }
    expect(classifyJobObservation(attempt(), seen({ execution: "blocked" }), NOW)).toBe("blocked");
  });

  test("background activity preserves liveness", () => {
    expect(classifyJobObservation(attempt(), seen({ execution: "idle", background: "active" }), NOW)).toBe("active");
    expect(classifyJobObservation(attempt(), seen({ execution: "unknown", background: "active" }), NOW)).toBe("active");
    expect(classifyJobObservation(attempt(), seen({ execution: "unknown", background: "inactive" }), NOW)).toBe("unknown");
  });

  test("stale observation cannot kill replacement", () => {
    const replacement = attempt({ id: "att-2", generation: 3, activatedAt: NOW - 5 * MIN });
    expect(classifyJobObservation(replacement, seen({ execution: "dead", generation: 2 }), NOW)).toBe("unknown");
    expect(classifyJobObservation(replacement, seen({ execution: "dead", generation: 3, observedAt: NOW - 6 * MIN }), NOW)).toBe("unknown");
    expect(classifyJobObservation(attempt(), seen({ execution: "dead", observedAt: NOW - STALE_OBSERVATION_MS - 1 }), NOW)).toBe("unknown");
    expect(classifyJobObservation(attempt({ state: "replaced" }), seen({ execution: "dead" }), NOW)).toBe("unknown");
    expect(classifyJobObservation(replacement, seen({ execution: "dead", generation: 3, observedAt: NOW - 1_000 }), NOW)).toBe("dead");
  });

  test("lost transport remains unknown", () => {
    const disconnected = seen({ connectivity: "disconnected", execution: "unknown", background: "unknown" });
    const job = attempt();
    const now = NOW;
    expect(classifyJobObservation(job, disconnected, now)).toBe("unknown");
    expect(classifyJobObservation(job, seen({ connectivity: "disconnected", execution: "working" }), now)).toBe("active");
  });
});

describe("the shared observation store", () => {
  test("keeps the newest observation per binding and never moves back a generation", () => {
    recordObservation("sk-1", seen({ generation: 3, observedAt: NOW - 1_000, source: "mod" }));
    recordObservation("sk-1", seen({ generation: 2, observedAt: NOW, execution: "dead" }));
    expect(latestObservation("sk-1")).toMatchObject({ generation: 3, source: "mod" });
    recordObservation("sk-1", seen({ generation: 3, observedAt: NOW - 5_000, execution: "dead" }));
    expect(latestObservation("sk-1")).toMatchObject({ generation: 3, source: "mod", execution: "working" });
    recordObservation("sk-1", seen({ generation: 3, observedAt: NOW, execution: "idle" }));
    expect(latestObservation("sk-1")).toMatchObject({ execution: "idle", observedAt: NOW });
  });
});

describe("observeJob", () => {
  function bound(db: ReturnType<typeof openStateDb>): SessionBinding {
    const store = createSessionStore(db);
    const reserved = store.reserve({ identity: "job-a.w1" });
    const b = store.bind(reserved, { harness: "codex", profile: "default", kind: "id", value: "T1" }, { mode: "headless" });
    if (!b.ok) throw new Error(b.error.message);
    return b.data;
  }

  function registryWith(observe: SessionAdapter["observe"]) {
    const integration = {
      id: "codex", label: "Codex",
      capabilities: async (mode) => ({ mode, supported: [], readiness: { ready: true } }),
      validateOptions: (options) => ({ ok: true, data: options }),
      options: async () => [],
      loadSessions: async () => ({ observe } as unknown as SessionAdapter),
    } as HarnessIntegration;
    return createRegistry([integration]);
  }

  test("an unbound attempt has no observation: its pane stays supervised as before", async () => {
    const db = openStateDb(join(dir, "state.db"));
    const observer = createJobObserver({ db: () => db, integrations: registryWith(async () => { throw new Error("never"); }), now: () => NOW });
    expect(await observer.observeJob(attempt({ bindingKey: undefined, generation: 0 }))).toMatchObject({ ok: false, error: { code: "unsupported" } });
  });

  test("reads a fresh shared observation for the binding's generation, else observes and records", async () => {
    const db = openStateDb(join(dir, "state.db"));
    const binding = bound(db);
    let calls = 0;
    const observer = createJobObserver({
      db: () => db, now: () => NOW,
      integrations: registryWith(async (b) => { calls += 1; return { ok: true, data: seen({ generation: b.attachment.generation, observedAt: NOW, source: "codex-events" }) }; }),
    });
    const job = attempt({ bindingKey: binding.key, generation: binding.attachment.generation });

    recordObservation(binding.key, seen({ generation: binding.attachment.generation, observedAt: NOW - 1_000, source: "mod", execution: "idle", background: "active" }));
    expect(await observer.observeJob(job)).toEqual({ ok: true, data: seen({ generation: binding.attachment.generation, observedAt: NOW - 1_000, source: "mod", execution: "idle", background: "active" }) });
    expect(calls).toBe(0);

    observationStoreTest.reset();
    recordObservation(binding.key, seen({ generation: binding.attachment.generation, observedAt: NOW - STALE_OBSERVATION_MS - 1, source: "mod" }));
    const live = await observer.observeJob(job);
    expect(calls).toBe(1);
    expect(live).toMatchObject({ ok: true, data: { source: "codex-events", observedAt: NOW } });
    expect(latestObservation(binding.key)).toMatchObject({ source: "codex-events", observedAt: NOW });
  });
});

describe("the watchdog over observations", () => {
  test("non-Claude is not dead: a headless Codex worker idle with no pane reads idle, not dead", async () => {
    const { sensors } = observedSensors({
      jobs: [job()], attempts: { "job-a": attempt() },
      observe: async () => ({ ok: true, data: seen({ execution: "working", observedAt: NOW }) }),
    });
    await sensors.refresh();
    expect(evaluateJob(job(), sensors, cfg)).toEqual({ kind: "healthy" });
  });

  test("an unbound pane worker running the job's own harness is not dead, whatever that harness is", async () => {
    const pane = job({ pane: "w1:p1" });
    const { sensors, observed } = observedSensors({
      jobs: [pane], attempts: { "job-a": attempt({ bindingKey: undefined, generation: 0, mode: "herdr" }) },
      panes: [{ pane_id: "w1:p1", agent: "codex", agent_status: "working" }],
    });
    await sensors.refresh();
    expect(observed).toEqual([]);
    expect(sensors.paneState("w1:p1")).toBe("working");
    expect(evaluateJob(pane, sensors, cfg)).toEqual({ kind: "healthy" });
  });

  test("idle foreground with live background work is not wedged until the background cap", async () => {
    const clock = { now: NOW };
    const { sensors } = observedSensors({
      clock, jobs: [job()], attempts: { "job-a": attempt() },
      observe: async () => ({ ok: true, data: seen({ execution: "idle", background: "active", observedAt: clock.now }) }),
    });
    await sensors.refresh();
    clock.now = NOW + 20 * MIN;
    await sensors.refresh();
    expect(evaluateJob(job(), sensors, cfg)).toEqual({ kind: "healthy" });
    clock.now = NOW + 61 * MIN;
    await sensors.refresh();
    expect(evaluateJob(job(), sensors, cfg)).toMatchObject({ kind: "wedged", path: "backstop" });
  });

  test("lost transport stays unknown: never dead, attention only after the backstop", async () => {
    const clock = { now: NOW };
    const { sensors } = observedSensors({ clock, jobs: [job()], attempts: { "job-a": attempt() } });
    await sensors.refresh();
    expect(evaluateJob(job(), sensors, cfg)).toEqual({ kind: "healthy" });
    clock.now = NOW + 16 * MIN;
    await sensors.refresh();
    const verdict = evaluateJob(job(), sensors, cfg);
    expect(verdict.kind).toBe("attention");
  });

  test("stale observation cannot kill replacement", async () => {
    const replacement = attempt({ id: "att-2", generation: 3, activatedAt: NOW - MIN });
    const { sensors } = observedSensors({
      jobs: [job()], attempts: { "job-a": replacement },
      observe: async () => ({ ok: true, data: seen({ execution: "dead", generation: 2, observedAt: NOW }) }),
    });
    await sensors.refresh();
    expect(evaluateJob(job(), sensors, cfg).kind).not.toBe("dead");
  });

  test("native confirmed death still triggers the existing recovery action, through the shepherd, never the worker", async () => {
    const { sensors } = observedSensors({
      jobs: [job()], attempts: { "job-a": attempt() },
      observe: async () => ({ ok: true, data: seen({ execution: "dead", observedAt: NOW }) }),
    });
    await sensors.refresh();
    expect(evaluateJob(job(), sensors, cfg)).toEqual({ kind: "dead" });
    const { act, calls } = actuators();
    await new HerdWatchdog({ sensors, act, cfg: () => cfg, log }).sweep();
    expect(calls.poke).toEqual(["w1:p0: watchdog: demo-1/job-a: the worker session is gone; strike 3, flagged 0m ago. Check on it."]);
    expect([calls.relocation, calls.trust, calls.park]).toEqual([0, 0, 0]);
  });

  test("a headless worker is never pressed with keys: blocked raises attention instead of a modal accept", async () => {
    const clock = { now: NOW };
    const { sensors } = observedSensors({
      clock, jobs: [job()], attempts: { "job-a": attempt() },
      observe: async () => ({ ok: true, data: seen({ execution: "blocked", observedAt: clock.now }) }),
    });
    await sensors.refresh();
    clock.now = NOW + 3 * MIN;
    await sensors.refresh();
    const verdict = evaluateJob(job(), sensors, cfg);
    expect(verdict).toMatchObject({ kind: "attention" });
    const { act, calls } = actuators();
    await new HerdWatchdog({ sensors, act, cfg: () => cfg, log }).sweep();
    expect([calls.relocation, calls.trust, calls.park, calls.stuck]).toEqual([0, 0, 0, 0]);
    expect(calls.poke.every((p) => p.startsWith("w1:p0: "))).toBe(true);
    expect(calls.poke).toHaveLength(1);
  });

  test("a wedged headless worker's own nudge is skipped: there is no pane to type into", async () => {
    const clock = { now: NOW };
    const { sensors } = observedSensors({
      clock, jobs: [job()], attempts: { "job-a": attempt() },
      observe: async () => ({ ok: true, data: seen({ execution: "idle", background: "inactive", observedAt: clock.now }) }),
    });
    await sensors.refresh();
    clock.now = NOW + 20 * MIN;
    await sensors.refresh();
    const { act, calls } = actuators();
    await new HerdWatchdog({ sensors, act, cfg: () => cfg, log }).sweep();
    expect(calls.poke).toEqual([]);
  });

  test("with the switch off a bound job is supervised by its pane exactly as before", async () => {
    const pane = job({ pane: "w1:p1" });
    const { sensors, observed } = observedSensors({
      enabled: false, jobs: [pane], attempts: { "job-a": attempt({ selection: CLAUDE, mode: "herdr" }) },
      panes: [{ pane_id: "w1:p1", agent: "codex", agent_status: "idle" }],
    });
    await sensors.refresh();
    expect(observed).toEqual([]);
    expect(sensors.paneState("w1:p1")).toBe("dead");
  });

  test("unsupported async questions create attention, never an inferred gate answer", async () => {
    const clock = { now: NOW };
    const { emit, hub } = codexHub();
    emit({ method: "turn/started", connection: "c1", threadId: "T1", turnId: "turn-1", status: "inProgress" });
    emit({
      method: "item/tool/requestUserInput", connection: "c1", threadId: "T1", turnId: "turn-1", itemId: "i-q",
      handle: { connection: "c1", requestId: 7, threadId: "T1", turnId: "turn-1", itemId: "i-q" }, isBlocking: true, questions: [],
    });
    const { sensors } = observedSensors({
      clock, jobs: [job()], attempts: { "job-a": attempt() },
      observe: async () => ({ ok: true, data: fromHub(hub, clock.now) }),
    });
    await sensors.refresh();
    clock.now = NOW + 3 * MIN;
    await sensors.refresh();
    expect(evaluateJob(job(), sensors, cfg)).toMatchObject({ kind: "attention" });
    const { act, calls } = actuators();
    await new HerdWatchdog({ sensors, act, cfg: () => cfg, log }).sweep();
    expect([calls.relocation, calls.trust, calls.park]).toEqual([0, 0, 0]);
  });
});

function codexHub(): { emit: (event: CodexEvent) => void; hub: CodexEventHub } {
  let listener: (event: CodexEvent) => void = () => {};
  const control = { subscribe: (l: (event: CodexEvent) => void) => { listener = l; return () => {}; } } as unknown as CodexControl;
  const hub = new CodexEventHub(control);
  return { emit: (event) => listener(event), hub };
}

function fromHub(hub: CodexEventHub, at: number): Observation {
  const view = hub.view("T1") ?? { connectivity: "unknown" as const, execution: "unknown" as const, source: "none" };
  return { connectivity: view.connectivity, execution: view.execution, background: "unknown", observedAt: at, source: view.source, generation: 2 };
}

describe("the Codex turn a Stop hook continues", () => {
  test("DONE, blocked Stop, CONTINUED, allowed Stop, turn complete: neither DONE nor a hook error completes the job", async () => {
    const { emit, hub } = codexHub();
    const clock = { now: NOW };
    const jobs = [job()];
    const { sensors } = observedSensors({
      clock, jobs, attempts: { "job-a": attempt() },
      observe: async () => ({ ok: true, data: fromHub(hub, clock.now) }),
    });
    const { act, calls } = actuators();
    const watchdog = new HerdWatchdog({ sensors, act, cfg: () => cfg, log });
    const agentMessage = (id: string) => ({ type: "agentMessage" as const, id, delivery: null, questionCount: 0 });
    const stop = (status: "running" | "blocked" | "completed" | "failed") =>
      ({ id: "run-stop", eventName: "stop" as const, status });
    const steps: Array<[string, CodexEvent]> = [
      ["turn started", { method: "turn/started", connection: "c1", threadId: "T1", turnId: "turn-1", status: "inProgress" }],
      ["DONE", { method: "item/completed", connection: "c1", threadId: "T1", turnId: "turn-1", item: agentMessage("i-done") }],
      ["blocked Stop", { method: "hook/completed", connection: "c1", threadId: "T1", turnId: "turn-1", run: stop("blocked") }],
      ["hook error", { method: "hook/completed", connection: "c1", threadId: "T1", turnId: "turn-1", run: stop("failed") }],
      ["CONTINUED", { method: "item/completed", connection: "c1", threadId: "T1", turnId: "turn-1", item: agentMessage("i-continued") }],
      ["allowed Stop", { method: "hook/completed", connection: "c1", threadId: "T1", turnId: "turn-1", run: stop("completed") }],
    ];
    for (const [step, event] of steps) {
      emit(event);
      clock.now += 30_000;
      await sensors.refresh();
      expect([step, classifyJobObservation(attempt(), fromHub(hub, clock.now), clock.now)]).toEqual([step, "active"]);
      expect([step, evaluateJob(jobs[0]!, sensors, cfg)]).toEqual([step, { kind: "healthy" }]);
      await watchdog.sweep();
    }
    emit({ method: "turn/completed", connection: "c1", threadId: "T1", turnId: "turn-1", status: "completed" });
    await sensors.refresh();
    expect(fromHub(hub, clock.now).execution).toBe("idle");
    expect(classifyJobObservation(attempt(), fromHub(hub, clock.now), clock.now)).toBe("active");
    await watchdog.sweep();
    expect(jobs[0]!.status).toBe("active");
    expect(calls.park).toBe(0);

    emit({ method: "thread/status/changed", connection: "c1", threadId: "T1", status: { type: "systemError" } });
    expect(classifyJobObservation(attempt(), fromHub(hub, clock.now), clock.now)).toBe("unknown");
  });
});

describe("the Claude adapter owns its pane reading", () => {
  const binding = (over: Partial<SessionBinding> = {}): SessionBinding => ({
    key: "sk-1", identity: "job-a.w1", native: { harness: "claude", profile: "default", kind: "id", value: UUID },
    attachment: { generation: 2, mode: "herdr", pane: "w1:p1" }, attemptId: "att-1", ...over,
  });
  const deps = (over: Partial<ClaudeSessionDeps> = {}): Partial<ClaudeSessionDeps> => ({
    now: () => NOW, agents: async () => [],
    registry: { roots: () => [], read: () => new Map(), sessionForPid: () => null },
    processAlive: () => true, socketExists: () => true, cswapAccounts: async () => [], hasLiveLink: () => false,
    ...over,
  });

  test("a herd worker's pane listed with no Claude on it is confirmed dead", async () => {
    const adapter = createClaudeSessions(deps({ paneRows: async () => new Map([["w1:p1", { agent: null, status: null }]]) }));
    expect(await adapter.observe(binding())).toMatchObject({ ok: true, data: { execution: "dead", source: "herdr-pane", generation: 2 } });
  });

  test("an idle herd worker's footer reports its background work", async () => {
    const footer = ["transcript", "─".repeat(40), "  ⏵⏵ accept edits on · 1 shell"].join("\n");
    const adapter = createClaudeSessions(deps({
      paneRows: async () => new Map([["w1:p1", { agent: "claude", status: "idle" }]]),
      readScreen: async () => footer,
    }));
    expect(await adapter.observe(binding())).toMatchObject({ ok: true, data: { execution: "idle", background: "active", source: "herdr-pane" } });
    const quiet = createClaudeSessions(deps({
      paneRows: async () => new Map([["w1:p1", { agent: "claude", status: "idle" }]]),
      readScreen: async () => ["transcript", "─".repeat(40), "  ⏵⏵ accept edits on"].join("\n"),
    }));
    expect(await quiet.observe(binding())).toMatchObject({ ok: true, data: { execution: "idle", background: "inactive" } });
  });

  test("a pane herdr does not list proves nothing", async () => {
    const adapter = createClaudeSessions(deps({ paneRows: async () => new Map() }));
    const result = await adapter.observe(binding());
    expect(result.ok && result.data.execution).not.toBe("dead");
  });
});

describe("herd:status over observations", () => {
  let store: HerdStore;
  beforeEach(() => {
    store = createHerdStore({ dbPath: join(dir, "herds.db"), log });
  });
  afterEach(() => store.close_());

  function handlers(opts: { switchOn: boolean; observe: (a: JobAttempt) => Promise<Outcome<Observation>> }) {
    const reply = <T>(data: T) => ({ ok: true as const, data });
    const deps = {
      store, gateStore: { get: () => null, markConsumed: () => {} },
      gate: { "gate:list": async () => reply({ gates: [] }), "gate:subscriptions": async () => reply({ subscriptions: [] }) },
      chat: {
        "chat:sign-in": async () => reply({}), "chat:join": async () => reply({}),
        "chat:post": async () => reply({ id: 1 }), "chat:rooms": async () => reply({ rooms: [] }),
      },
      agent: {}, worktree: {},
      runWorktree: () => null,
      findRunningRunByWorktree: () => ({ kind: "none" }),
      presenceIdentityForSession: () => null,
      mintWorkerId: (j: string) => j,
      identityNames: (ids: Iterable<string>) => new Map([...ids].map((id) => [id, id])),
      resolveHandle: (x: string) => x,
      probeInbox: async () => "reachable",
      herdr: async () => ({ ok: true, result: { snapshot: { panes: [] } } }),
      herdrRunnerFor: () => async () => ({ stdout: "{}", exitCode: 0 }),
      lifecycle: { connected: () => true, watch: () => {}, sweepClaims: async () => {} },
      bg: { up: async () => false },
      jobsRoot: join(dir, "herds"),
      log,
      integrationsEnabled: () => opts.switchOn,
      observeJob: opts.observe,
    } as unknown as HerdDeps;
    return createHerdHandlers(deps);
  }

  function headlessJob(): JobAttempt {
    store.create({ id: "demo-1", repo: "r", room: "herd-demo-1", workspace: "herd: demo-1", shepherdSession: "sess-s", shepherdHandle: "shepherd", herdrSocket: null, hidden: false });
    store.upsertJob({ herd: "demo-1", name: "job-a", worktree: "/w", handle: "job-a", status: "active" });
    store.reserveAttempt({ id: "att-1", herd: "demo-1", job: "job-a", selection: CODEX, mode: "headless" });
    const active = store.activateAttempt("att-1", "sk-1", 2);
    if (!active.ok) throw new Error(active.error.message);
    return active.data;
  }

  test("a headless worker shows its observed liveness, and a confirmed death reads session gone", async () => {
    headlessJob();
    const h = handlers({ switchOn: true, observe: async () => ({ ok: true, data: seen({ execution: "dead", observedAt: Date.now() }) }) });
    const res = await h["herd:status"]({ herd: "demo-1" });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.jobs[0]).toMatchObject({ sessionDead: true, liveness: "dead", mode: "headless" });

    const live = handlers({ switchOn: true, observe: async () => ({ ok: true, data: seen({ execution: "idle", background: "active", observedAt: Date.now() }) }) });
    const ok = await live["herd:status"]({ herd: "demo-1" });
    if (!ok.ok) throw new Error(ok.error);
    expect(ok.data.jobs[0]).toMatchObject({ sessionDead: false, liveness: "active" });
  });

  test("lost transport is unknown, not dead", async () => {
    headlessJob();
    const h = handlers({ switchOn: true, observe: async () => ({ ok: false, error: { code: "transient", message: "closed" } }) });
    const res = await h["herd:status"]({ herd: "demo-1" });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.jobs[0]).toMatchObject({ sessionDead: false, liveness: "unknown" });
  });

  test("with the switch off nothing is observed and the row is unchanged", async () => {
    headlessJob();
    let calls = 0;
    const h = handlers({ switchOn: false, observe: async () => { calls += 1; return { ok: true, data: seen() }; } });
    const res = await h["herd:status"]({ herd: "demo-1" });
    if (!res.ok) throw new Error(res.error);
    expect(calls).toBe(0);
    expect("liveness" in res.data.jobs[0]!).toBe(false);
    expect(res.data.jobs[0]!.sessionDead).toBeNull();
  });
});
