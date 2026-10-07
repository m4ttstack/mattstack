import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type {
  Capability, CapabilityReport, DeliveryReceipt, Mode, NativeSessionRef, Outcome, SessionBinding,
} from "../../../packages/rt-client/src/agent-integrations.ts";
import { openStateDb } from "../../state/db.ts";
import { getAgent, insertAgent, type AgentRecord } from "../../state/agents-store.ts";
import { resolveCallerContextNow } from "../context.ts";
import type {
  HarnessIntegration, LaunchRequest, NativeLaunch, PolicyAdapter, PreparedLaunch, SessionAdapter, WorkInput, WorkProbe, WorkReceipt,
} from "../contracts.ts";
import { createBoundLauncher, launchAttention, launchGuard, launchInProgress, type BoundLaunchRequest } from "../launch.ts";
import { claudeIntegration } from "../claude/integration.ts";
import { fakeCodex } from "./codex-fake-server.ts";
import { createClaudeSessions } from "../claude/sessions.ts";
import { createRegistry } from "../registry.ts";
import {
  createSessionStore, readBindingReadiness, readBindingSelection, readReservation, type SessionStore,
} from "../session-store.ts";
import {
  findSubmission, markSubmitting, readSubmission, recordPending, RECHECK_BASE_MS, RECHECK_LIMIT, settleSubmission, workDigest,
} from "../work-submissions.ts";

let dir = "";
let db: Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-launch-"));
  db = openStateDb(join(dir, "state.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const ok = <T>(data: T): Outcome<T> => ({ ok: true, data });
const fail = <T>(code: "not-ready" | "ambiguous" | "refused" | "transient" | "invalid", message: string): Outcome<T> =>
  ({ ok: false, error: { code, message } });

function data<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(`expected ok, got ${outcome.error.code}: ${outcome.error.message}`);
  return outcome.data;
}

type Calls = {
  spawn: number; launches: LaunchRequest[]; resumes: Array<{ native: NativeSessionRef; request: LaunchRequest }>;
  startWork: number; work: WorkInput[]; prepared: Array<PreparedLaunch | undefined>; reconcile: WorkProbe[];
  loadSessions: number; loadPolicy: number; verify: number; order: string[];
};

type FakeOptions = {
  id?: string;
  sessionEnv?: string[];
  supported?: Capability[];
  /** Ready only once loadSessions has run, like Codex before its connection is live. */
  readyAfterLoad?: boolean;
  policy?: Partial<PolicyAdapter> | "absent";
  launch?: (request: LaunchRequest, calls: Calls) => Outcome<NativeLaunch>;
  startWork?: (binding: SessionBinding, input: WorkInput, calls: Calls) => Outcome<WorkReceipt>;
  reconcile?: (binding: SessionBinding, probe: WorkProbe) => Outcome<DeliveryReceipt | null>;
  /** The adapter holds what an unfinished launch made under its reservation id, as Codex does. */
  carries?: boolean;
  discover?: () => NativeLaunch[];
};

function fake(o: FakeOptions = {}): { integration: HarnessIntegration; calls: Calls } {
  const id = o.id ?? "fake";
  const calls: Calls = {
    spawn: 0, launches: [], resumes: [], startWork: 0, work: [], prepared: [], reconcile: [],
    loadSessions: 0, loadPolicy: 0, verify: 0, order: [],
  };
  let loaded = false;
  const seen = new Map<string, string>();
  const native = (value: string): NativeSessionRef => ({ harness: id, profile: "default", kind: "id", value });
  const sessions: SessionAdapter = {
    ...(o.carries && { carriesReservations: true }),
    async launch(request) {
      calls.launches.push(request);
      if (o.launch) return o.launch(request, calls);
      // Carrying on with a reservation it already started is not a second spawn.
      let value = seen.get(request.reservationId);
      if (value === undefined) {
        calls.spawn++;
        value = `T${calls.spawn}`;
        seen.set(request.reservationId, value);
      }
      return ok({ native: native(value), attachment: { mode: request.mode, ...(request.mode === "herdr" && { pane: `w1:p${calls.spawn}` }) } });
    },
    async resume(ref, request) {
      calls.resumes.push({ native: ref, request });
      return ok({ native: ref, attachment: { mode: request.mode, pane: "w2:p9" } });
    },
    async discover() {
      return o.discover ? o.discover() : [];
    },
    async observe(binding) {
      return ok({ connectivity: "unknown", execution: "unknown", background: "unknown", observedAt: 1, source: "none", generation: binding.attachment.generation });
    },
    async startWork(binding, input, prepared) {
      calls.startWork++;
      calls.work.push(input);
      calls.prepared.push(prepared);
      return o.startWork ? o.startWork(binding, input, calls) : ok({ id: input.id, evidence: "submitted", nativeId: binding.native.value });
    },
    async reconcileWork(binding, probe) {
      calls.reconcile.push(probe);
      return o.reconcile ? o.reconcile(binding, probe) : ok(null);
    },
  };
  const policy: PolicyAdapter = {
    async prepare(request) {
      calls.order.push("prepare");
      return ok({ id: "pp-1", harness: id, profile: "default", cwd: request.cwd, revision: "rev-1" });
    },
    async verify(binding, prepared) {
      calls.verify++;
      calls.order.push("verify");
      return ok({
        sessionKey: binding.key, generation: binding.attachment.generation, revision: prepared.revision,
        verified: ["gate-policy"], observedAt: 5,
      });
    },
    ...(o.policy !== "absent" ? o.policy : {}),
  };
  const integration = {
    id, label: id,
    ...(o.sessionEnv && { sessionEnv: o.sessionEnv }),
    async capabilities(mode: Mode): Promise<CapabilityReport> {
      calls.order.push("capabilities");
      const ready = o.readyAfterLoad ? loaded : true;
      return { mode, supported: o.supported ?? ["launch", "resume", "observe", "gate-policy"], readiness: ready ? { ready } : { ready, reason: "no connection yet" } };
    },
    validateOptions: (options: object) => ok(options),
    options: async () => [],
    async loadSessions() {
      calls.loadSessions++;
      calls.order.push("loadSessions");
      loaded = true;
      return sessions;
    },
    ...(o.policy !== "absent" && {
      async loadPolicy() {
        calls.loadPolicy++;
        return policy;
      },
    }),
  } as unknown as HarnessIntegration;
  return { integration, calls };
}

function launcherFor(integrations: HarnessIntegration[], over: { claimToken?: string; store?: SessionStore; now?: () => number } = {}) {
  return createBoundLauncher({
    db, registry: createRegistry(integrations), claimToken: over.claimToken ?? "proc-A",
    ...(over.store && { store: over.store }), ...(over.now && { now: over.now }),
  });
}

function request(reservationId: string, over: Partial<BoundLaunchRequest> = {}): BoundLaunchRequest {
  return {
    reservationId, cwd: "/w/acme", mode: "herdr", selection: { harness: "fake", options: { model: "m1" } },
    required: [], prompt: "the deferred brief", access: { readRoots: [] }, ...over,
  };
}

const allow = async (): Promise<Outcome<void>> => ok(undefined);

describe("reservation before native creation", () => {
  test("timeout reconciles without duplicate spawn", async () => {
    const { integration, calls } = fake();
    const real = createSessionStore(db);
    let bindTimeouts = 1;
    const flaky: SessionStore = {
      ...real,
      bind: (...args) => (bindTimeouts-- > 0 ? fail("transient", "timed out waiting for the state database") : real.bind(...args)),
    };
    const reservationId = real.reserve({ identity: "remy", agentId: "a1" });

    const first = await launcherFor([integration], { store: flaky }).launchBoundAgent(request(reservationId));
    expect(first.ok).toBe(false);
    expect(calls.spawn).toBe(1);
    expect(readReservation(db, reservationId)?.state).toBe("launched");

    // Reconciliation from another process binds what the first one made.
    const reconciled = data(await launcherFor([integration], { claimToken: "proc-B" }).launchBoundAgent(request(reservationId)));
    expect(calls.spawn).toBe(1);
    expect(reconciled.native.value).toBe("T1");
    expect(readReservation(db, reservationId)?.state).toBe("bound");
    expect(data(await launcherFor([integration]).launchBoundAgent(request(reservationId))).key).toBe(reconciled.key);
    expect(calls.spawn).toBe(1);
    expect(calls.launches).toHaveLength(1);
    expect(calls.startWork).toBe(0);
  });

  test("an unresolved launch is carried on by its own process and refused by any other", async () => {
    let ambiguousOnce = true;
    const { integration, calls } = fake({
      carries: true,
      launch: (req, c) => {
        if (ambiguousOnce) {
          ambiguousOnce = false;
          c.spawn++;
          return fail("ambiguous", "the initialization turn has not finished yet");
        }
        return ok({ native: { harness: "fake", profile: "default", kind: "id", value: "T1" }, attachment: { mode: req.mode, pane: "w1:p1" } });
      },
    });
    const reservationId = createSessionStore(db).reserve({ identity: "remy" });
    expect((await launcherFor([integration]).launchBoundAgent(request(reservationId))).ok).toBe(false);
    expect(readReservation(db, reservationId)?.state).toBe("launching");

    const elsewhere = await launcherFor([integration], { claimToken: "proc-B" }).launchBoundAgent(request(reservationId));
    expect(elsewhere).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    expect(calls.launches).toHaveLength(1);

    data(await launcherFor([integration]).launchBoundAgent(request(reservationId)));
    expect(calls.launches).toHaveLength(2);
    expect(calls.spawn).toBe(1);
  });

  test("a launch that made nothing can be claimed again", async () => {
    let refuse = true;
    const { integration, calls } = fake({
      launch: (req) => (refuse
        ? (refuse = false, fail("refused", `tab "${req.reservationId}" already open; focused it`))
        : ok({ native: { harness: "fake", profile: "default", kind: "id", value: "T7" }, attachment: { mode: req.mode, pane: "w1:p7" } })),
    });
    const reservationId = createSessionStore(db).reserve({ identity: "remy" });
    expect((await launcherFor([integration]).launchBoundAgent(request(reservationId))).ok).toBe(false);
    expect(readReservation(db, reservationId)?.state).toBe("failed");
    expect(data(await launcherFor([integration], { claimToken: "proc-B" }).launchBoundAgent(request(reservationId))).native.value).toBe("T7");
    expect(calls.launches).toHaveLength(2);
  });

  test("the launch request is persisted before the adapter runs, and the adapter never receives work", async () => {
    let persisted: unknown;
    const { integration, calls } = fake({
      launch: (req) => {
        persisted = readReservation(db, req.reservationId);
        return ok({ native: { harness: "fake", profile: "default", kind: "id", value: "T1" }, attachment: { mode: req.mode, pane: "w1:p1" } });
      },
    });
    const reservationId = createSessionStore(db).reserve({ identity: "remy" });
    data(await launcherFor([integration]).launchBoundAgent(request(reservationId)));
    expect(persisted).toMatchObject({ state: "launching", claimedBy: "proc-A", request: { cwd: "/w/acme", mode: "herdr", selection: { harness: "fake", options: { model: "m1" } } } });
    expect(JSON.stringify(persisted)).not.toContain("the deferred brief");
    expect(calls.startWork).toBe(0);
  });

  test("admission loads the session adapter before trusting readiness", async () => {
    const { integration, calls } = fake({ readyAfterLoad: true });
    const reservationId = createSessionStore(db).reserve({ identity: "remy" });
    data(await launcherFor([integration]).launchBoundAgent(request(reservationId)));
    expect(calls.order.indexOf("loadSessions")).toBeLessThan(calls.order.indexOf("capabilities"));
  });
});

describe("policy readiness", () => {
  test("failed policy does not activate assignment", async () => {
    const { integration, calls } = fake({ policy: { verify: async () => fail("not-ready", "the gate hook never ran in this session") } });
    const store = createSessionStore(db);
    const reservationId = store.reserve({ identity: "worker-1", agentId: "a1", attemptId: "att-1" });
    const activations: string[] = [];
    const launched = await launcherFor([integration]).launchBoundAgent(request(reservationId, { required: ["gate-policy"] }));
    if (launched.ok) activations.push(launched.data.attemptId!);

    expect(launched).toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(activations).toEqual([]);
    // Bound for recovery, but unready.
    const bound = store.find({ harness: "fake", profile: "default", kind: "id", value: "T1" })!;
    expect(bound.attemptId).toBe("att-1");
    expect(readBindingReadiness(db, bound.key)?.generation).toBeNull();
    expect(await launcherFor([integration]).startBoundWork(bound, { id: "w1", text: "go" }, allow)).toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(calls.startWork).toBe(0);
  });

  test("a proof for another session, generation or revision is not readiness", async () => {
    const proofs = [
      (b: SessionBinding) => ({ sessionKey: "sk-other", generation: b.attachment.generation, revision: "rev-1", verified: ["gate-policy" as Capability], observedAt: 1 }),
      (b: SessionBinding) => ({ sessionKey: b.key, generation: b.attachment.generation + 1, revision: "rev-1", verified: ["gate-policy" as Capability], observedAt: 1 }),
      (b: SessionBinding) => ({ sessionKey: b.key, generation: b.attachment.generation, revision: "rev-0", verified: ["gate-policy" as Capability], observedAt: 1 }),
      (b: SessionBinding) => ({ sessionKey: b.key, generation: b.attachment.generation, revision: "rev-1", verified: [] as Capability[], observedAt: 1 }),
    ];
    for (const proof of proofs) {
      const { integration } = fake({ policy: { verify: async (b) => ok(proof(b)) } });
      const reservationId = createSessionStore(db).reserve({ identity: "w-proof" });
      const launched = await launcherFor([integration]).launchBoundAgent(request(reservationId, { required: ["gate-policy"], cwd: `/w/${reservationId}` }));
      expect(launched).toMatchObject({ ok: false, error: { code: "not-ready" } });
    }
  });

  test("a verified proof makes exactly that generation ready, and a new attachment invalidates it", async () => {
    const { integration, calls } = fake();
    const store = createSessionStore(db);
    const launched = data(await launcherFor([integration]).launchBoundAgent(request(store.reserve({ identity: "w1" }), { required: ["gate-policy"] })));
    expect(calls.order).toEqual(["loadSessions", "capabilities", "prepare", "verify"]);
    expect(readBindingReadiness(db, launched.key)).toMatchObject({ generation: 1, required: ["gate-policy"], proof: { revision: "rev-1", generation: 1 } });

    const moved = data(store.replaceAttachment(launched.key, 1, { mode: "herdr", pane: "w9:p9" }));
    const launcher = launcherFor([integration]);
    expect(await launcher.startBoundWork(launched, { id: "w1", text: "go" }, allow)).toMatchObject({ ok: false, error: { code: "stale-binding" } });
    expect(await launcher.startBoundWork(moved, { id: "w1", text: "go" }, allow)).toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(calls.startWork).toBe(0);
  });

  test("missing policy factory refuses managed requests while ordinary launch works", async () => {
    const { integration, calls } = fake({ policy: "absent" });
    const store = createSessionStore(db);
    const managedId = store.reserve({ identity: "w1", attemptId: "att-1" });
    const managed = await launcherFor([integration]).launchBoundAgent(request(managedId, { required: ["gate-policy"] }));
    expect(managed).toMatchObject({ ok: false, error: { code: "unsupported" } });
    expect(calls.loadSessions).toBe(0);
    expect(calls.spawn).toBe(0);
    expect(readReservation(db, managedId)?.state).toBe("reserved");

    const ordinary = data(await launcherFor([integration]).launchBoundAgent(request(store.reserve({ identity: "w2" }))));
    expect(ordinary.native.value).toBe("T1");
    expect(readBindingReadiness(db, ordinary.key)?.generation).toBe(1);
  });

  test("an ordinary launch never loads an integration's policy", async () => {
    const { integration, calls } = fake();
    data(await launcherFor([integration]).launchBoundAgent(request(createSessionStore(db).reserve({ identity: "w1" }))));
    expect(calls.loadPolicy).toBe(0);
  });
});

describe("resume", () => {
  test("resume preserves selection", async () => {
    const { integration, calls } = fake();
    const store = createSessionStore(db);
    const launched = data(await launcherFor([integration]).launchBoundAgent(
      request(store.reserve({ identity: "remy", agentId: "a1" }), { selection: { harness: "fake", options: { model: "m1", effort: "high" } } }),
    ));
    expect(readBindingSelection(db, launched.key)).toEqual({ harness: "fake", options: { model: "m1", effort: "high" } });

    const resumed = data(await launcherFor([integration]).launchBoundAgent(
      request(store.reserve({ identity: "remy", agentId: "a1" }), { resumeKey: launched.key, selection: { harness: "fake", options: {} } }),
    ));
    expect(calls.resumes).toHaveLength(1);
    expect(calls.resumes[0]!.native).toEqual(launched.native);
    expect(calls.resumes[0]!.request.selection).toEqual({ harness: "fake", options: { model: "m1", effort: "high" } });
    expect(resumed.key).toBe(launched.key);
    expect(resumed.identity).toBe("remy");
    expect(resumed.attachment.generation).toBe(2);
    expect(readBindingSelection(db, launched.key)).toEqual({ harness: "fake", options: { model: "m1", effort: "high" } });

    const otherHarness = await launcherFor([integration, fake({ id: "other" }).integration]).launchBoundAgent(
      request(store.reserve({ identity: "remy" }), { resumeKey: launched.key, selection: { harness: "other", options: {} } }),
    );
    expect(otherHarness).toMatchObject({ ok: false, error: { code: "invalid" } });
    const otherModel = await launcherFor([integration]).launchBoundAgent(
      request(store.reserve({ identity: "remy" }), { resumeKey: launched.key, selection: { harness: "fake", options: { model: "m2" } } }),
    );
    expect(otherModel).toMatchObject({ ok: false, error: { code: "invalid" } });
    const otherIdentity = await launcherFor([integration]).launchBoundAgent(
      request(store.reserve({ identity: "sam" }), { resumeKey: launched.key, selection: { harness: "fake", options: {} } }),
    );
    expect(otherIdentity).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(calls.resumes).toHaveLength(1);
    expect(calls.spawn).toBe(1);
  });
});

describe("work submission", () => {
  async function launched(o: FakeOptions = {}, attemptId?: string) {
    const f = fake(o);
    const store = createSessionStore(db);
    const reservationId = store.reserve({ identity: "worker-1", agentId: "a1", ...(attemptId && { attemptId }) });
    const launcher = launcherFor([f.integration]);
    const binding = data(await launcher.launchBoundAgent(request(reservationId)));
    return { ...f, launcher, binding, store };
  }

  test("activation fails without sending work", async () => {
    const { launcher, binding, calls } = await launched({}, "att-1");
    const refused = await launcher.startBoundWork(binding, { id: "w1", text: "go" }, async () => fail("refused", "attempt att-1 is not active"));
    expect(refused).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(calls.startWork).toBe(0);
    expect(findSubmission(db, binding.key, "w1")?.state).toBe("refused");

    const unauthorized = await launcher.startBoundWork(binding, { id: "w2", text: "go" }, undefined as never);
    expect(unauthorized).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(calls.startWork).toBe(0);
  });

  test("immediate report sees active attempt", async () => {
    const active = new Set<string>();
    let seen: { attempt?: string; active: boolean; state?: string } | undefined;
    const { launcher, binding, calls } = await launched({
      startWork: (bound, input) => {
        // The worker reports before the submission call has even returned.
        const caller = resolveCallerContextNow({ native: bound.native }, { db });
        const attempt = caller.ok ? caller.data.binding.attemptId : undefined;
        seen = {
          ...(attempt !== undefined && { attempt }),
          active: attempt !== undefined && active.has(attempt),
          ...(readSubmission(db, { bindingKey: bound.key, generation: bound.attachment.generation, inputId: input.id })?.state !== undefined
            && { state: readSubmission(db, { bindingKey: bound.key, generation: bound.attachment.generation, inputId: input.id })!.state }),
        };
        return ok({ id: input.id, evidence: "submitted" });
      },
    }, "att-1");
    active.add("att-1");
    const receipt = data(await launcher.startBoundWork(binding, { id: "w1", text: "go" }, async () => (active.has(binding.attemptId!) ? ok(undefined) : fail("refused", "inactive"))));
    expect(seen).toEqual({ attempt: "att-1", active: true, state: "submitting" });
    expect(receipt.evidence).toBe("submitted");
    expect(findSubmission(db, binding.key, "w1")).toMatchObject({ state: "submitted", attemptId: "att-1", digest: workDigest("go") });
    expect(calls.startWork).toBe(1);
  });

  test("no work prompt is submitted before readiness, and the prepared launch reaches the submission", async () => {
    const { launcher, binding, calls } = await launched();
    expect(calls.startWork).toBe(0);
    data(await launcher.startBoundWork(binding, { id: "w1", text: "the deferred brief" }, allow));
    expect(calls.work).toEqual([{ id: "w1", text: "the deferred brief" }]);
    expect(calls.prepared[0]).toMatchObject({ kind: "launch", request: { cwd: "/w/acme", prompt: "the deferred brief" } });
  });

  test("an ambiguous send is reconciled, never sent twice", async () => {
    let evidence: DeliveryReceipt | null = null;
    const { launcher, binding, calls } = await launched({
      startWork: () => fail("ambiguous", "the connection dropped before Codex answered"),
      reconcile: () => ok(evidence),
    });
    expect(await launcher.startBoundWork(binding, { id: "w1", text: "go" }, allow)).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    expect(findSubmission(db, binding.key, "w1")?.state).toBe("ambiguous");

    expect(await launcher.startBoundWork(binding, { id: "w1", text: "go" }, allow)).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    expect(calls.reconcile).toEqual([{ id: "w1", digest: workDigest("go"), submittedAt: expect.any(Number) }]);
    expect(calls.startWork).toBe(1);

    evidence = { id: "w1", evidence: "submitted", turnId: "U7" };
    expect(data(await launcher.startBoundWork(binding, { id: "w1", text: "go" }, allow))).toMatchObject({ id: "w1", evidence: "submitted", turnId: "U7" });
    expect(findSubmission(db, binding.key, "w1")).toMatchObject({ state: "submitted", turnId: "U7" });
    expect(data(await launcher.startBoundWork(binding, { id: "w1", text: "go" }, allow)).evidence).toBe("submitted");
    expect(calls.startWork).toBe(1);
  });

  test("a definite native refusal records the work refused", async () => {
    const { launcher, binding } = await launched({ startWork: () => fail("refused", "Codex refused turn/start") });
    expect(await launcher.startBoundWork(binding, { id: "w1", text: "go" }, allow)).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(findSubmission(db, binding.key, "w1")?.state).toBe("refused");
  });

  test("a submission another process left submitting is ambiguous after recovery, and is never resent", async () => {
    const { launcher, binding, calls } = await launched();
    const key = { bindingKey: binding.key, generation: binding.attachment.generation, inputId: "w1" };
    data(recordPending(db, key, workDigest("go"), undefined));
    expect(data(markSubmitting(db, key, "crashed-process"))).toBe(true);

    await launcherFor([fake().integration], { claimToken: "proc-B" }).recover();
    expect(readSubmission(db, key)?.state).toBe("ambiguous");
    expect(await launcher.startBoundWork(binding, { id: "w1", text: "go" }, allow)).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    expect(calls.startWork).toBe(0);
  });

  test("recovery settles an ambiguous submission from native evidence", async () => {
    const { binding, integration } = await launched({ reconcile: (_b, probe) => ok({ id: probe.id, evidence: "consumed", turnId: "U3" }) });
    const key = { bindingKey: binding.key, generation: binding.attachment.generation, inputId: "w1" };
    data(recordPending(db, key, workDigest("go"), undefined));
    data(markSubmitting(db, key, "crashed-process"));
    await launcherFor([integration], { claimToken: "proc-B" }).recover();
    expect(readSubmission(db, key)).toMatchObject({ state: "consumed", turnId: "U3" });
  });

  test("starting the process on submission moves the attachment and keeps an ordinary binding ready", async () => {
    const { launcher, binding, store } = await launched({
      launch: (req) => ok({ native: { harness: "fake", profile: "default", kind: "id", value: "T1" }, attachment: { mode: req.mode } }),
      startWork: (_b, input) => ok({ id: input.id, evidence: "submitted", attachment: { mode: "herdr", pane: "w3:p1" }, surface: { tabId: "w3:t1", workspaceId: "w3" } }),
    });
    expect(binding.attachment).toEqual({ generation: 1, mode: "herdr" });
    const receipt = data(await launcher.startBoundWork(binding, { id: "w1", text: "go" }, allow));
    expect(receipt.binding.attachment).toEqual({ generation: 2, mode: "herdr", pane: "w3:p1" });
    expect(store.get(binding.key)!.attachment.pane).toBe("w3:p1");
    expect(readBindingReadiness(db, binding.key)?.generation).toBe(2);
  });
});

describe("what the launcher records and hands the adapter", () => {
  function agent(id: string): AgentRecord {
    const rec: AgentRecord = { id, repo: "remote:example.com%2Fa%2Fb", cwd: "/w/acme", provider: "fake", surface: "herdr", sessionId: "placeholder", createdAt: 1 };
    insertAgent(rec, db);
    return rec;
  }

  test("the agent record follows its binding: session id, and the pane recorded as a bg: ref on the background server", async () => {
    const { integration } = fake({
      launch: (req) => ok({
        native: { harness: "fake", profile: "default", kind: "id", value: "T-real" }, attachment: { mode: req.mode, pane: "w5:p2", socket: "/bg.sock" },
        surface: { tabId: "w5:t2", workspaceId: "w5" },
      }),
    });
    agent("a1");
    const reservationId = createSessionStore(db).reserve({ identity: "remy", agentId: "a1" });
    const bound = data(await launcherFor([integration]).launchBoundAgent(request(reservationId, { host: { background: true, socket: "/bg.sock" } })));
    expect(bound.attachment).toEqual({ generation: 1, mode: "herdr", pane: "bg:w5:p2", socket: "/bg.sock" });
    expect(getAgent("a1", db)).toMatchObject({ sessionId: "T-real", paneId: "bg:w5:p2", tabId: "w5:t2", workspaceId: "w5" });
  });

  test("a worker never inherits another harness's session variable", async () => {
    const claudeLike = fake({ id: "claude-like", sessionEnv: ["CLAUDE_CODE_SESSION_ID"] });
    const codexLike = fake({ id: "codex-like", sessionEnv: ["CODEX_THREAD_ID"] });
    const launcher = launcherFor([claudeLike.integration, codexLike.integration]);
    data(await launcher.launchBoundAgent(request(createSessionStore(db).reserve({ identity: "w1" }), { selection: { harness: "codex-like", options: {} } })));
    expect(codexLike.calls.launches[0]!.host?.unsetEnv).toEqual(["CLAUDE_CODE_SESSION_ID"]);
    data(await launcher.launchBoundAgent(request(createSessionStore(db).reserve({ identity: "w2" }), {
      selection: { harness: "claude-like", options: {} }, host: { unsetEnv: ["EXTRA_VAR"] },
    })));
    expect(claudeLike.calls.launches[0]!.host?.unsetEnv).toEqual(["EXTRA_VAR", "CODEX_THREAD_ID"]);
  });

  test("an unknown harness or a selection the integration refuses launches nothing", async () => {
    const { integration, calls } = fake();
    const refusing = { ...integration, validateOptions: () => fail("invalid", "no such model") } as HarnessIntegration;
    expect(await launcherFor([integration]).launchBoundAgent(request(createSessionStore(db).reserve({ identity: "w1" }), { selection: { harness: "nope", options: {} } })))
      .toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(await launcherFor([refusing]).launchBoundAgent(request(createSessionStore(db).reserve({ identity: "w2" }))))
      .toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(calls.loadSessions).toBe(0);
  });
});

describe("retries never make a second session", () => {
  test("a retried reservation whose adapter keeps nothing is reconciled through discovery with the id it was handed", async () => {
    let first = true;
    let shown: NativeLaunch[] = [];
    const { integration, calls } = fake({
      discover: () => shown,
      launch: (req, c) => {
        c.spawn++;
        if (first) { first = false; return fail("ambiguous", "the pane did not answer"); }
        return ok({ native: { harness: "fake", profile: "default", kind: "id", value: req.nativeHint! }, attachment: { mode: req.mode, pane: "w1:p2" } });
      },
    });
    const reservationId = createSessionStore(db).reserve({ identity: "remy" });
    const launcher = launcherFor([integration]);
    expect((await launcher.launchBoundAgent(request(reservationId))).ok).toBe(false);
    const hint = calls.launches[0]!.nativeHint!;
    expect(hint).toMatch(/^[0-9a-f-]{36}$/);
    expect(readReservation(db, reservationId)?.request?.nativeHint).toBe(hint);

    expect(await launcher.launchBoundAgent(request(reservationId))).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    expect(calls.spawn).toBe(1);

    shown = [{ native: { harness: "fake", profile: "default", kind: "id", value: hint }, attachment: { mode: "herdr", pid: 77 } }];
    const bound = data(await launcher.launchBoundAgent(request(reservationId)));
    expect(bound.native.value).toBe(hint);
    expect(bound.attachment).toEqual({ generation: 1, mode: "herdr", pid: 77 });
    expect(calls.spawn).toBe(1);
  });

  test("a deduped tab on a retried reservation is ambiguous, never a launch that made nothing", async () => {
    let attempt = 0;
    const { integration, calls } = fake({
      carries: true,
      launch: (req) => (++attempt === 1
        ? fail("ambiguous", "the terminal has not attached yet")
        : fail("refused", `tab "${req.reservationId}" already open; focused it`)),
    });
    const reservationId = createSessionStore(db).reserve({ identity: "remy" });
    const launcher = launcherFor([integration]);
    await launcher.launchBoundAgent(request(reservationId));
    expect(await launcher.launchBoundAgent(request(reservationId))).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    expect(readReservation(db, reservationId)?.state).toBe("launching");
    expect(await launcherFor([integration], { claimToken: "proc-B" }).launchBoundAgent(request(reservationId)))
      .toMatchObject({ ok: false, error: { code: "ambiguous" } });
    expect(calls.launches).toHaveLength(2);
  });
});

describe("one unresolved launch per harness, profile and cwd", () => {
  const guard = (cwd = "/w/acme", account?: string) => launchGuard({ harness: "fake", options: { ...(account && { account }) } }, cwd);

  test("a launch whose outcome is unknown holds its place, in any process, until it resolves", async () => {
    const { integration, calls } = fake({ carries: true, launch: (_req, c) => { c.spawn++; return fail("ambiguous", "no answer yet"); } });
    const store = createSessionStore(db);
    const first = store.reserve({ identity: "remy", agentId: "ag-first" });
    await launcherFor([integration]).launchBoundAgent(request(first));
    expect(launchInProgress(db, guard())).toContain("agent ag-first");
    expect(launchInProgress(db, guard("/w/acme/"))).toContain("agent ag-first");
    expect(launchAttention(db, "ag-first")).toContain("has not resolved");

    const second = await launcherFor([integration], { claimToken: "proc-B" }).launchBoundAgent(request(store.reserve({ identity: "sam" })));
    expect(second).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(second.ok ? "" : second.error.message).toContain("agent ag-first");
    expect(calls.spawn).toBe(1);

    expect(launchInProgress(db, guard("/w/other"))).toBeNull();
    expect(launchInProgress(db, guard("/w/acme", "sam@example.com"))).toBeNull();
  });

  test("work whose delivery is unknown holds the place too; a delivered one does not", async () => {
    const { integration } = fake({ startWork: () => fail("ambiguous", "dropped") });
    const store = createSessionStore(db);
    const launcher = launcherFor([integration]);
    const bound = data(await launcher.launchBoundAgent(request(store.reserve({ identity: "remy", agentId: "ag-1" }))));
    expect(launchInProgress(db, guard())).toBeNull();
    await launcher.startBoundWork(bound, { id: "w1", text: "go" }, allow);
    expect(launchInProgress(db, guard())).toContain("agent ag-1");
    expect(launchAttention(db, "ag-1")).toContain("cannot tell yet whether this agent's work reached");
    settleSubmission(db, { bindingKey: bound.key, generation: 1, inputId: "w1" }, ["ambiguous", "ambiguous"], "submitted");
    expect(launchInProgress(db, guard())).toBeNull();
  });

  test("a launch left unresolved for hours stops holding its place and asks for attention", async () => {
    const { integration } = fake({ carries: true, launch: () => fail("ambiguous", "no answer yet") });
    const first = createSessionStore(db).reserve({ identity: "remy", agentId: "ag-old" });
    await launcherFor([integration]).launchBoundAgent(request(first));
    await launcherFor([integration], { claimToken: "proc-B", now: () => Date.now() + 7 * 60 * 60_000 }).recover();
    expect(readReservation(db, first)?.state).toBe("abandoned");
    expect(launchInProgress(db, guard())).toBeNull();
    expect(launchAttention(db, "ag-old")).toContain("stopped waiting");
  });

  test("a launch whose adapter throws holds its place, records why, and is ambiguous", async () => {
    const { integration, calls } = fake({ carries: true, launch: (_req, c) => { c.spawn++; throw new Error("socket closed mid-launch"); } });
    const store = createSessionStore(db);
    const first = store.reserve({ identity: "remy", agentId: "ag-thrown" });
    const res = await launcherFor([integration]).launchBoundAgent(request(first));
    expect(res).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    expect(res.ok ? "" : res.error.message).toContain("socket closed mid-launch");
    expect(readReservation(db, first)).toMatchObject({ state: "launching", error: expect.stringContaining("socket closed mid-launch") });
    expect(launchInProgress(db, guard())).toContain("agent ag-thrown");
    expect(launchAttention(db, "ag-thrown")).toContain("has not resolved");

    const second = await launcherFor([integration], { claimToken: "proc-B" }).launchBoundAgent(request(store.reserve({ identity: "sam" })));
    expect(second).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(calls.spawn).toBe(1);
  });

  test("a session adapter that cannot load records why and launches nothing", async () => {
    const { integration } = fake();
    const broken = { ...integration, loadSessions: async () => { throw new Error("adapter import failed"); } } as HarnessIntegration;
    const id = createSessionStore(db).reserve({ identity: "remy", agentId: "ag-load" });
    const res = await launcherFor([broken]).launchBoundAgent(request(id));
    expect(res).toMatchObject({ ok: false, error: { code: "ambiguous", message: expect.stringContaining("adapter import failed") } });
    expect(readReservation(db, id)).toMatchObject({ state: "reserved", error: expect.stringContaining("adapter import failed") });
    expect(launchInProgress(db, guard())).toBeNull();
  });

  test("a successful later launch or resume clears the attention an older unresolved one left", async () => {
    const { integration } = fake({ carries: true, launch: () => fail("ambiguous", "no answer yet") });
    const first = createSessionStore(db).reserve({ identity: "remy", agentId: "ag-old" });
    await launcherFor([integration]).launchBoundAgent(request(first));
    await launcherFor([integration], { claimToken: "proc-B", now: () => Date.now() + 7 * 60 * 60_000 }).recover();
    expect(launchAttention(db, "ag-old")).toContain("stopped waiting");
    expect(launchAttention(db, "ag-old", Date.now() + 1)).toBeUndefined();
  });
});

describe("the ambiguous-submission sweep", () => {
  function stuck(binding: SessionBinding, inputId: string) {
    const key = { bindingKey: binding.key, generation: binding.attachment.generation, inputId };
    data(recordPending(db, key, workDigest(inputId), undefined));
    data(markSubmitting(db, key, "a-crashed-daemon"));
    return key;
  }

  async function boundFake(o: FakeOptions = {}) {
    const f = fake(o);
    const binding = data(await launcherFor([f.integration]).launchBoundAgent(request(createSessionStore(db).reserve({ identity: "remy" }))));
    return { ...f, binding };
  }

  test("checks back off exponentially, then give up for attention, never sending again", async () => {
    const { integration, binding, calls } = await boundFake();
    const key = stuck(binding, "w1");
    let now = Date.now() + 1_000;
    const sweep = () => launcherFor([integration], { claimToken: "proc-B", now: () => now }).recover();
    await sweep();
    expect(readSubmission(db, key)).toMatchObject({ state: "ambiguous", checks: 1, nextCheckAt: now + RECHECK_BASE_MS });
    now += RECHECK_BASE_MS - 1;
    await sweep();
    expect(calls.reconcile).toHaveLength(1);
    now += 1;
    await sweep();
    expect(readSubmission(db, key)).toMatchObject({ checks: 2, nextCheckAt: now + 2 * RECHECK_BASE_MS });
    for (let i = 0; i < RECHECK_LIMIT; i++) {
      now += 24 * 60 * 60_000;
      await sweep();
    }
    expect(readSubmission(db, key)?.state).toBe("abandoned");
    expect(calls.reconcile).toHaveLength(RECHECK_LIMIT);
    expect(await launcherFor([integration]).startBoundWork(binding, { id: "w1", text: "w1" }, allow)).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    expect(calls.reconcile).toHaveLength(RECHECK_LIMIT);
    expect(calls.startWork).toBe(0);
  });

  test("more than one sweep's worth of stuck rows never starves a new one", async () => {
    const { integration, binding } = await boundFake({
      reconcile: (_b, probe) => ok(probe.id === "fresh" ? { id: probe.id, evidence: "submitted" } : null),
    });
    for (let i = 0; i < 60; i++) stuck(binding, `old-${i}`);
    const fresh = stuck(binding, "fresh");
    const now = Date.now() + 1_000;
    const sweep = () => launcherFor([integration], { claimToken: "proc-B", now: () => now }).recover();
    await sweep();
    await sweep();
    expect(readSubmission(db, fresh)?.state).toBe("submitted");
  });

  test("a row whose binding is gone is abandoned, not skipped forever", async () => {
    const { integration, binding } = await boundFake();
    const key = stuck(binding, "w1");
    db.query("DELETE FROM agent_session_bindings WHERE key = ?").run(binding.key);
    await launcherFor([integration], { claimToken: "proc-B" }).recover();
    expect(readSubmission(db, key)).toMatchObject({ state: "abandoned", error: "its session binding is gone" });
  });

  test("a pending row whose call is long gone sent nothing and is refused", async () => {
    const { integration, binding } = await boundFake();
    const key = { bindingKey: binding.key, generation: 1, inputId: "w1" };
    data(recordPending(db, key, workDigest("go"), undefined));
    await launcherFor([integration], { claimToken: "proc-B", now: () => Date.now() + 60 * 60_000 }).recover();
    expect(readSubmission(db, key)?.state).toBe("refused");
  });

  test("one sweep asks herdr for its agents once, however many Claude rows it checks", async () => {
    let herdrCalls = 0;
    const sessions = createClaudeSessions({
      agents: async () => { herdrCalls++; return []; },
      registry: { roots: () => [], read: () => new Map(), sessionForPid: () => null },
      processAlive: () => true,
    });
    const ready = async (mode: Mode): Promise<CapabilityReport> => ({ mode, supported: ["launch", "resume", "observe"], readiness: { ready: true } });
    const claude = { ...claudeIntegration, capabilities: ready, loadSessions: async () => sessions } as HarnessIntegration;
    const store = createSessionStore(db);
    for (const value of ["0b9d2f9a-1c4e-4f6a-9d7e-3b2a1c0d9e81", "0b9d2f9a-1c4e-4f6a-9d7e-3b2a1c0d9e82", "0b9d2f9a-1c4e-4f6a-9d7e-3b2a1c0d9e83"]) {
      const bound = data(store.bind(store.reserve({ identity: `id-${value}` }), { harness: "claude", profile: "default", kind: "id", value }, { mode: "headless" }));
      stuck(bound, `w-${value}`);
    }
    await launcherFor([claude], { claimToken: "proc-B" }).recover();
    expect(herdrCalls).toBe(1);
  });
});

describe("a Codex folder-trust refusal", () => {
  test("is a certain no-op: the reservation fails, nothing holds the folder, and a fresh call after trusting attaches at once", async () => {
    const cwd = realpathSync(mkdtempSync(join(dir, "work-")));
    const config = join(dir, "codex-config.toml");
    writeFileSync(config, "");
    const codex = await fakeCodex(db, config);
    try {
      const store = createSessionStore(db);
      const codexRequest = (reservationId: string): BoundLaunchRequest => ({
        reservationId, cwd, mode: "herdr", selection: { harness: "codex", options: {} }, required: [], access: { readRoots: [] },
      });
      const first = store.reserve({ identity: "remy", agentId: "ag-untrusted" });
      const refused = await launcherFor([codex.integration]).launchBoundAgent(codexRequest(first));
      expect(refused).toMatchObject({ ok: false, error: { code: "refused" } });
      expect(refused.ok ? "" : refused.error.message).toContain(cwd);
      expect(readReservation(db, first)?.state).toBe("failed");
      expect(launchInProgress(db, launchGuard({ harness: "codex", options: {} }, cwd))).toBeNull();
      expect(launchAttention(db, "ag-untrusted")).toBeUndefined();
      expect(codex.ops).toEqual([]);

      writeFileSync(config, `[projects."${cwd}"]\ntrust_level = "trusted"\n`);
      const bound = data(await launcherFor([codex.integration]).launchBoundAgent(codexRequest(store.reserve({ identity: "remy", agentId: "ag-trusted" }))));
      expect(bound.attachment).toMatchObject({ mode: "herdr", pane: "w9:p1" });
      expect(codex.ops).toEqual(["thread/start", "turn/start", "pane"]);
    } finally {
      codex.close();
    }
  });
});
