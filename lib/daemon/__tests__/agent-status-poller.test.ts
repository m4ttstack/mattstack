import { afterEach, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { RunSummary } from "../../../packages/rt-client/src/commands.ts";
import type { SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import { resetLivenessCache, type AgentEntry } from "../../runs/liveness.ts";
import { observeBoundSessions, startAgentStatusPoller, type AgentStatusPollerHandle } from "../agent-status-poller.ts";
import { claudeIntegration } from "../../agent-integrations/claude/integration.ts";
import { codexIntegration } from "../../agent-integrations/codex/integration.ts";
import type { SessionAdapter } from "../../agent-integrations/contracts.ts";
import { createRegistry } from "../../agent-integrations/registry.ts";
import { createSessionStore, listAttachedBindings } from "../../agent-integrations/session-store.ts";
import { createClaudeSessions, type ClaudeRegistry } from "../../agent-integrations/claude/sessions.ts";
import { openStateDb } from "../../state/db.ts";
import { markSubmitting, readSubmission, recordPending, workDigest } from "../../agent-integrations/work-submissions.ts";

const quietLog = { info: () => {}, warn: () => {} };

function runOf(id: string, status: string, agentStatus: string | null): RunSummary {
  return {
    id, repo: "acme", work_type: "t", pipeline: "p", status,
    current_stage: "implement", spawned_by: null, started_at: 1, ended_at: null,
    pack_commits: null, pack_dirty: 0,
    attention: { needs: false, reason: null, evidence: "" },
    last_event_at: 1, ticket: null, branch: null,
    agent: agentStatus ? { status: agentStatus as "working", pane: "w1:p1" } : null,
  };
}

let handle: AgentStatusPollerHandle | null = null;
afterEach(() => {
  handle?.stop();
  handle = null;
  resetLivenessCache();
});

function poller(probeResults: (AgentEntry[] | null)[], listResults: RunSummary[][]) {
  const events: unknown[] = [];
  let p = 0;
  let l = 0;
  handle = startAgentStatusPoller({
    emitEvent: (topic, payload) => events.push({ topic, payload }),
    log: quietLog,
    intervalMs: 3_600_000,
    probe: async () => probeResults[Math.min(p++, probeResults.length - 1)] ?? null,
    list: () => listResults[Math.min(l++, listResults.length - 1)] ?? [],
  });
  return { events, handle };
}

test("a status flip emits one run-updated; the seed tick emits nothing", async () => {
  const { events } = poller(
    [[], [], []],
    [[runOf("r1", "running", "working")], [runOf("r1", "running", "blocked")], [runOf("r1", "running", "blocked")]],
  );
  await handle!.tick();
  expect(events).toHaveLength(0);
  await handle!.tick();
  expect(events).toEqual([
    { topic: "run-updated", payload: { repo: "acme", runId: "r1", stage: null, kind: "agent-status" } },
  ]);
  await handle!.tick();
  expect(events).toHaveLength(1);
});

test("a failed probe holds last-known state instead of flapping to null", async () => {
  // Two list results only: the failed-probe tick must not consume one.
  const { events } = poller(
    [[], null, []],
    [[runOf("r1", "running", "working")], [runOf("r1", "running", "working")]],
  );
  await handle!.tick();
  await handle!.tick(); // probe null → tick skipped, list never consulted
  await handle!.tick(); // still working → no transition ever observed
  expect(events).toHaveLength(0);
});

test("finished runs are ignored and dropped from tracking", async () => {
  const { events } = poller(
    [[], []],
    [[runOf("r1", "running", "working")], [runOf("r1", "done", null)]],
  );
  await handle!.tick();
  await handle!.tick();
  expect(events).toHaveLength(0);
});

test("backs off the herdr probe after repeated failures", async () => {
  let probeCalls = 0;
  handle = startAgentStatusPoller({
    emitEvent: () => {},
    log: quietLog,
    intervalMs: 3_600_000,           // real timer never fires
    probe: async () => { probeCalls++; return null; }, // herdr absent
    list: () => [],
  });
  for (let i = 0; i < 20; i++) await handle.tick();
  // Without backoff this would be 20; with backoff (threshold 3, 1-in-6) far fewer.
  expect(probeCalls).toBeLessThan(10);
  // Backoff never stops probing forever: 3 initial failures engage it, then
  // one probe every BACKOFF_TICKS (ticks 9 and 15 of 20) keeps checking.
  expect(probeCalls).toBe(5);
});

test("a successful probe after backoff resets consecutiveFailures and resumes per-tick probing", async () => {
  let probeCalls = 0;
  handle = startAgentStatusPoller({
    emitEvent: () => {},
    log: quietLog,
    intervalMs: 3_600_000,
    probe: async () => {
      probeCalls++;
      // Invocations 1-3 cross FAILURE_THRESHOLD and engage backoff; the
      // backoff window then skips ticks 4-8 without invoking probe at all,
      // so invocation 4 is the tick-9 retry ... make it succeed.
      return probeCalls <= 3 ? null : [];
    },
    list: () => [],
  });
  for (let i = 0; i < 9; i++) await handle.tick();
  expect(probeCalls).toBe(4); // probed at ticks 1, 2, 3, then again at tick 9
  const callsBeforeRecovery = probeCalls;
  await handle.tick(); // tick 10, immediately after the successful tick-9 probe
  // A successful probe resets consecutiveFailures to 0, so the very next
  // tick is not gated by backoff ... it probes right away instead of
  // waiting out another BACKOFF_TICKS window.
  expect(probeCalls).toBe(callsBeforeRecovery + 1);
});

test("each answered probe observes bound sessions after the run diff; a failed probe holds", async () => {
  let observed = 0;
  const events: unknown[] = [];
  const results: (AgentEntry[] | null)[] = [[], null, []];
  let p = 0;
  handle = startAgentStatusPoller({
    emitEvent: (topic, payload) => events.push({ topic, payload }),
    log: quietLog,
    intervalMs: 3_600_000,
    probe: async () => results[p++] ?? null,
    list: () => [],
    observeSessions: async () => { observed++; },
  });
  for (let i = 0; i < 3; i++) await handle.tick();
  expect(observed).toBe(2);
  expect(events).toEqual([]);
});

test("an observation that throws is logged and never costs the run diff", async () => {
  const warned: unknown[] = [];
  const events: unknown[] = [];
  let l = 0;
  const lists = [[runOf("r1", "running", "working")], [runOf("r1", "running", "blocked")]];
  handle = startAgentStatusPoller({
    emitEvent: (topic, payload) => events.push({ topic, payload }),
    log: { info: () => {}, warn: (obj, msg) => warned.push({ obj, msg }) },
    intervalMs: 3_600_000,
    probe: async () => [],
    list: () => lists[Math.min(l++, lists.length - 1)]!,
    observeSessions: async () => { throw new Error("state.db busy"); },
  });
  await handle.tick();
  await handle.tick();
  expect(events).toHaveLength(1);
  expect(warned).toHaveLength(2);
});

function withDb<T>(fn: (db: Database) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "rt-poller-observe-"));
  const db = openStateDb(join(dir, "state.db"));
  return fn(db).finally(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
}

test("with the switch off, bound-session observation reads nothing at all", async () => {
  let loaded = 0;
  await observeBoundSessions({
    enabled: () => false,
    db: () => { throw new Error("the state db was opened"); },
    integrations: () => { loaded++; return createRegistry([]); },
  });
  expect(loaded).toBe(0);
});

test("with the switch on, work a crash left submitting becomes ambiguous and is reconciled, never sent again", async () => {
  await withDb(async (db) => {
    const store = createSessionStore(db);
    const bound = store.bind(store.reserve({ identity: "remy" }), { harness: "codex", profile: "default", kind: "id", value: "T1" }, { mode: "headless" });
    if (!bound.ok) throw new Error(bound.error.message);
    const key = { bindingKey: bound.data.key, generation: 1, inputId: "w1" };
    if (!recordPending(db, key, workDigest("go"), undefined).ok) throw new Error("pending failed");
    if (!markSubmitting(db, key, "a-crashed-daemon").ok) throw new Error("submitting failed");
    let started = 0;
    const probes: unknown[] = [];
    const adapter = {
      observe: async () => ({ ok: true, data: {} }),
      startWork: async () => { started++; return { ok: true, data: { id: "w1", evidence: "submitted" } }; },
      reconcileWork: async (_b: SessionBinding, probe: unknown) => { probes.push(probe); return { ok: true, data: null }; },
    } as unknown as SessionAdapter;
    await observeBoundSessions({
      enabled: () => true, db: () => db,
      integrations: () => createRegistry([{ ...codexIntegration, loadSessions: async () => adapter }]),
    });
    expect(readSubmission(db, key)?.state).toBe("ambiguous");
    expect(probes).toEqual([{ id: "w1", digest: workDigest("go"), submittedAt: expect.any(Number) }]);
    expect(started).toBe(0);
  });
});

test("with the switch on, every attached binding of a harness with a session adapter is observed", async () => {
  await withDb(async (db) => {
    const store = createSessionStore(db);
    const bind = (harness: string, value: string, attachment: { pane?: string; pid?: number }) => {
      const r = store.bind(store.reserve({ identity: `id-${value}` }), { harness, profile: "default", kind: "id", value }, { mode: "herdr", ...attachment });
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    };
    const attached = bind("claude", "c-attached", { pane: "w1:p1" });
    const byPid = bind("claude", "c-pid", { pid: 7 });
    bind("claude", "c-dead-pid", { pid: 9, pane: "w3:p1" });
    bind("claude", "c-nothing", {});
    const detached = bind("claude", "c-detached", { pid: 8 });
    if (!store.detach(detached.key, 1).ok) throw new Error("detach failed");
    const codexBound = bind("codex", "x-attached", { pane: "w2:p1" });

    const seen: SessionBinding[] = [];
    const codexSeen: SessionBinding[] = [];
    const sweeps = new Set<unknown>();
    const adapter = {
      observe: async (b: SessionBinding, sweep: unknown) => { seen.push(b); sweeps.add(sweep); return { ok: true, data: {} }; },
    } as unknown as SessionAdapter;
    const codexAdapter = {
      observe: async (b: SessionBinding, sweep: unknown) => { codexSeen.push(b); sweeps.add(sweep); return { ok: true, data: {} }; },
    } as unknown as SessionAdapter;
    await observeBoundSessions({
      enabled: () => true,
      db: () => db,
      alive: (pid) => pid !== 9,
      integrations: () => createRegistry([
        { ...claudeIntegration, loadSessions: async () => adapter },
        { ...codexIntegration, loadSessions: async () => codexAdapter },
      ]),
    });
    // A dead recorded process is skipped, never marked.
    expect(seen.map((b) => b.key).sort()).toEqual([attached.key, byPid.key].sort());
    expect(codexSeen.map((b) => b.key)).toEqual([codexBound.key]);
    expect(sweeps.size).toBe(1);
    expect(listAttachedBindings(db, "claude").map((b) => b.native.value)).toContain("c-dead-pid");
  });
});

test("a harness whose sessions cannot load is warned about, and later harnesses are still observed", async () => {
  await withDb(async (db) => {
    const store = createSessionStore(db);
    for (const [harness, value] of [["claude", "c1"], ["codex", "x1"]] as const) {
      const r = store.bind(store.reserve({ identity: `id-${value}` }), { harness, profile: "default", kind: "id", value }, { mode: "herdr", pane: "w1:p1" });
      if (!r.ok) throw new Error(r.error.message);
    }
    const codexSeen: string[] = [];
    const codexAdapter = {
      observe: async (b: SessionBinding) => { codexSeen.push(b.native.value); return { ok: true, data: {} }; },
    } as unknown as SessionAdapter;
    const warned: string[] = [];
    await observeBoundSessions({
      enabled: () => true, db: () => db, recover: async () => {},
      log: { warn: (_o: unknown, message: string) => { warned.push(message); } } as never,
      integrations: () => createRegistry([
        { ...claudeIntegration, loadSessions: async () => { throw new Error("adapter import failed"); } },
        { ...codexIntegration, loadSessions: async () => codexAdapter },
      ]),
    });
    expect(codexSeen).toEqual(["x1"]);
    expect(warned).toEqual(["agent-status poller could not load a harness's sessions"]);
  });
});

test("a sweep over many Claude bindings reads the registry once", async () => {
  await withDb(async (db) => {
    const store = createSessionStore(db);
    const values = ["a", "b", "c", "d"];
    for (const [i, value] of values.entries()) {
      const r = store.bind(store.reserve({ identity: `id-${value}` }), { harness: "claude", profile: "default", kind: "id", value }, { mode: "herdr", pid: 100 + i });
      if (!r.ok) throw new Error(r.error.message);
    }
    let rootReads = 0;
    let rootLists = 0;
    const rows = new Map(values.map((value, i) => [value, { pid: 100 + i, socketPath: `/sock/${i}`, status: "idle" as const }]));
    const registry: ClaudeRegistry = {
      roots: () => { rootLists++; return ["/h/.claude/sessions"]; },
      read: () => { rootReads++; return rows; },
      sessionForPid: () => { throw new Error("a per-pid registry read"); },
    };
    const sessions = createClaudeSessions({ registry, agents: async () => [], processAlive: () => true, socketExists: () => true, store: () => store });
    await observeBoundSessions({
      enabled: () => true,
      db: () => db,
      alive: () => true,
      integrations: () => createRegistry([{ ...claudeIntegration, loadSessions: async () => sessions }]),
    });
    expect(rootLists).toBe(1);
    expect(rootReads).toBe(1);
  });
});

test("an observe that throws is logged by key and never stops the bindings after it", async () => {
  await withDb(async (db) => {
    const store = createSessionStore(db);
    const keys = ["first", "second", "third"].map((value, i) => {
      const r = store.bind(store.reserve({ identity: `id-${value}` }), { harness: "claude", profile: "default", kind: "id", value }, { mode: "herdr", pane: `w${i}:p1` });
      if (!r.ok) throw new Error(r.error.message);
      return r.data.key;
    });
    const seen: string[] = [];
    const warned: unknown[] = [];
    const adapter = {
      observe: async (b: SessionBinding) => {
        seen.push(b.key);
        if (seen.length === 1) throw new Error("registry exploded");
        return { ok: true, data: {} };
      },
    } as unknown as SessionAdapter;
    await observeBoundSessions({
      enabled: () => true,
      db: () => db,
      log: { warn: (obj) => warned.push(obj) },
      integrations: () => createRegistry([{ ...claudeIntegration, loadSessions: async () => adapter }]),
    });
    expect([...seen].sort()).toEqual([...keys].sort());
    expect(warned).toEqual([{ key: seen[0] }]);
  });
});

test("a tick still in flight makes the next one a no-op", async () => {
  let probes = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  handle = startAgentStatusPoller({
    emitEvent: () => {},
    log: quietLog,
    intervalMs: 3_600_000,
    probe: async () => { probes++; await gate; return []; },
    list: () => [],
    observeSessions: async () => {},
  });
  const first = handle.tick();
  await handle.tick();
  expect(probes).toBe(1);
  release();
  await first;
  await handle.tick();
  expect(probes).toBe(2);
});
