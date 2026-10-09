import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import pino from "pino";
import type {
  CallerContext, Capability, CapabilityReport, Mode, Outcome, Selection, SessionBinding,
} from "../../../packages/rt-client/src/agent-integrations.ts";
import { openStateDb } from "../../state/db.ts";
import { resolveCallerContextNow } from "../../agent-integrations/context.ts";
import type { HarnessIntegration, PolicyAdapter, SessionAdapter, WorkInput } from "../../agent-integrations/contracts.ts";
import { createBoundLauncher } from "../../agent-integrations/launch.ts";
import { createRegistry } from "../../agent-integrations/registry.ts";
import { claimReservation, createSessionStore, markBindingReady, readBindingReadiness } from "../../agent-integrations/session-store.ts";
import { recordPolicyProof } from "../../agent-integrations/policy-readiness.ts";
import { findSubmission, listSubmissions } from "../../agent-integrations/work-submissions.ts";
import { createAgentService } from "../handlers/agent.ts";
import { createHerdHandlers, type HerdDeps } from "../handlers/herd.ts";
import { createHerdStore, type HerdStore } from "../herd-store.ts";
import { __test__ as attemptsInProcess, createJobAttempts, type JobAttempts } from "../herd-attempts.ts";

const log = pino({ level: "silent" });
const HERD = "demo-20261008-120000";
const JOB = "job-a";
const SELECTION: Selection = { harness: "claude", options: { model: "opus", effort: "high", account: "acct-2" } };
const POLICY: Capability[] = ["gate-policy", "continuation-policy"];

let dir = "";
let herdsPath = "";
let statePath = "";
let herds: HerdStore;
let state: Database;
let switchOn = true;

const open = () => {
  herds = createHerdStore({ dbPath: herdsPath, log });
  state = openStateDb(statePath);
};
const close = () => {
  herds.close_();
  state.close();
};
/** Closes and reopens both stores and forgets this process's launches, as a daemon restart between two steps would. */
const restart = (): JobAttempts => {
  close();
  attemptsInProcess.reset();
  open();
  return attempts();
};
const attempts = (): JobAttempts => createJobAttempts({ herds, db: () => state, enabled: () => switchOn });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-herd-attempts-"));
  herdsPath = join(dir, "herds.db");
  statePath = join(dir, "state.db");
  switchOn = true;
  open();
});

afterEach(() => {
  attemptsInProcess.reset();
  close();
  rmSync(dir, { recursive: true, force: true });
});

function data<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(`expected ok, got ${outcome.error.code}: ${outcome.error.message}`);
  return outcome.data;
}

let sessions = 0;
/** A worker session bound under the attempt's launch reservation, as the shared launcher binds one. */
function bindWorker(attemptId: string, identity = `${JOB}.w${++sessions}`): SessionBinding {
  const store = createSessionStore(state);
  const reservation = store.reserve({ identity, agentId: `ag-${sessions}`, attemptId });
  return data(store.bind(reservation, { harness: "claude", profile: "acct-2", kind: "id", value: `sess-${sessions}` }, { mode: "herdr", pane: `w1:p${sessions}` }));
}

/** The session proved its policy for its current generation, as a verified launch records it. */
function prove(binding: SessionBinding): void {
  data(recordPolicyProof(binding, {
    sessionKey: binding.key, generation: binding.attachment.generation, revision: "rev-1",
    verified: POLICY, observedAt: 1, kind: "installation",
  }, state));
  data(markBindingReady(state, binding.key, binding.attachment.generation, POLICY, readBindingReadiness(state, binding.key)!.proof));
}

const callerOf = (binding: SessionBinding): CallerContext =>
  data(resolveCallerContextNow({ native: { harness: "claude", kind: "id", value: binding.native.value } }, { db: state }));

function activeWorker(svc: JobAttempts, replaces?: string): { attemptId: string; binding: SessionBinding } {
  const attempt = data(svc.reserveJobAttempt({ herd: HERD, job: JOB, selection: SELECTION, ...(replaces && { replaces }) }));
  const binding = bindWorker(attempt.id);
  prove(binding);
  data(svc.activateJobAttempt(attempt.id, binding));
  return { attemptId: attempt.id, binding };
}

describe("fenced job attempts", () => {
  test("replacement rejects old report", () => {
    const svc = attempts();
    const first = activeWorker(svc);
    expect(data(svc.authorizeJobReport(callerOf(first.binding), HERD, JOB)).id).toBe(first.attemptId);

    const second = activeWorker(svc, first.attemptId);
    const stale = svc.authorizeJobReport(callerOf(first.binding), HERD, JOB);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe("stale-binding");
    expect(data(svc.authorizeJobReport(callerOf(second.binding), HERD, JOB)).id).toBe(second.attemptId);

    expect(second.binding.identity).not.toBe(first.binding.identity);
    expect(herds.attempts(HERD, JOB).map((a) => [a.id, a.state])).toEqual([[first.attemptId, "replaced"], [second.attemptId, "active"]]);
  });

  test("crash before activation grants no ownership", async () => {
    let svc = attempts();
    const holder = activeWorker(svc);

    const reserved = data(svc.reserveJobAttempt({ herd: HERD, job: JOB, selection: SELECTION, replaces: holder.attemptId }));
    svc = restart();
    const replacement = bindWorker(reserved.id);
    svc = restart();
    prove(createSessionStore(state).get(replacement.key)!);
    svc = restart();

    expect(svc.authorizeJobReport(callerOf(replacement), HERD, JOB).ok).toBe(false);
    expect(data(svc.authorizeJobReport(callerOf(holder.binding), HERD, JOB)).id).toBe(holder.attemptId);

    await svc.reconcileJobAttempts();
    svc = restart();
    await svc.reconcileJobAttempts();
    expect(herds.attempts(HERD, JOB).map((a) => [a.id, a.state])).toEqual([[holder.attemptId, "active"], [reserved.id, "reserved"]]);
    expect(svc.authorizeJobReport(callerOf(replacement), HERD, JOB).ok).toBe(false);
  });

  test("recovery ends a reservation that never launched and keeps the selection it recorded", async () => {
    let svc = attempts();
    const never = data(svc.reserveJobAttempt({ herd: HERD, job: JOB, selection: SELECTION }));
    svc.release(never.id);
    svc = restart();
    await svc.reconcileJobAttempts();
    svc = restart();
    await svc.reconcileJobAttempts();
    expect(herds.attempts(HERD, JOB)).toHaveLength(1);
    expect(herds.getAttempt(never.id)).toMatchObject({ state: "ended", selection: SELECTION });
  });

  test("after a restart, a claimed but unbound launch keeps its attempt reserved and an unclaimed one ends", async () => {
    let svc = attempts();
    const claimed = data(svc.reserveJobAttempt({ herd: HERD, job: JOB, selection: SELECTION }));
    const unclaimed = data(svc.reserveJobAttempt({ herd: HERD, job: "job-b", selection: SELECTION }));
    const store = createSessionStore(state);
    const claimedLaunch = store.reserve({ identity: `${JOB}.w1`, attemptId: claimed.id });
    store.reserve({ identity: "job-b.w1", attemptId: unclaimed.id });
    data(claimReservation(state, claimedLaunch, "proc-gone", { cwd: "/w/job-a", mode: "herdr", selection: SELECTION, required: POLICY }));

    svc = restart();
    await svc.reconcileJobAttempts();
    svc = restart();
    await svc.reconcileJobAttempts();

    expect(herds.attempts(HERD, JOB).map((a) => a.state)).toEqual(["reserved"]);
    expect(herds.activeAttempt(HERD, JOB)).toBeNull();
    expect(herds.attempts(HERD, "job-b").map((a) => a.state)).toEqual(["ended"]);
    expect(state.query("SELECT count(*) AS n FROM agent_session_bindings").get()).toEqual({ n: 0 });
  });

  test("a reservation still launching in this process is left alone by recovery", async () => {
    const svc = attempts();
    const launching = data(svc.reserveJobAttempt({ herd: HERD, job: JOB, selection: SELECTION }));
    await svc.reconcileJobAttempts();
    expect(herds.getAttempt(launching.id)?.state).toBe("reserved");
  });

  test("activation without a current policy proof is refused", () => {
    const svc = attempts();
    const attempt = data(svc.reserveJobAttempt({ herd: HERD, job: JOB, selection: SELECTION }));
    const binding = bindWorker(attempt.id);
    // Ready for its generation, as an installation inspection would leave it, with no proof recorded.
    data(markBindingReady(state, binding.key, binding.attachment.generation, POLICY));
    const activateWithoutProof = svc.activateJobAttempt(attempt.id, binding);
    expect(activateWithoutProof.ok).toBe(false);
    expect(herds.getAttempt(attempt.id)?.state).toBe("reserved");
    expect(svc.authorizeJobReport(callerOf(binding), HERD, JOB).ok).toBe(false);

    prove(binding);
    expect(data(svc.activateJobAttempt(attempt.id, binding)).state).toBe("active");
  });

  test("a session bound for another attempt cannot activate this one", () => {
    const svc = attempts();
    const mine = data(svc.reserveJobAttempt({ herd: HERD, job: JOB, selection: SELECTION }));
    const other = data(svc.reserveJobAttempt({ herd: HERD, job: "job-b", selection: SELECTION }));
    const binding = bindWorker(other.id);
    prove(binding);
    expect(svc.activateJobAttempt(mine.id, binding).ok).toBe(false);
  });

  test("switch off: activation needs no proof and reports are not fenced here", () => {
    switchOn = false;
    const svc = attempts();
    const attempt = data(svc.reserveJobAttempt({ herd: HERD, job: JOB, selection: SELECTION }));
    expect(data(svc.activateUnbound(attempt.id))).toMatchObject({ state: "active", generation: 0 });
    expect(herds.getAttempt(attempt.id)?.bindingKey).toBeUndefined();
  });

  test("resuming the same worker refreshes its attempt and keeps its identity", () => {
    const svc = attempts();
    const worker = activeWorker(svc);
    const store = createSessionStore(state);
    const resumed = data(store.replaceAttachment(worker.binding.key, worker.binding.attachment.generation, { mode: "herdr", pane: "w2:p9" }));
    prove(resumed);

    const stale = svc.authorizeJobReport({ binding: worker.binding }, HERD, JOB);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe("stale-binding");

    const refreshed = data(svc.activateJobAttempt(worker.attemptId, resumed));
    expect(refreshed).toMatchObject({ id: worker.attemptId, generation: resumed.attachment.generation, bindingKey: worker.binding.key });
    expect(herds.attempts(HERD, JOB)).toHaveLength(1);
    expect(resumed.identity).toBe(worker.binding.identity);
    expect(data(svc.authorizeJobReport(callerOf(resumed), HERD, JOB)).id).toBe(worker.attemptId);
  });

  test("a failed activation transaction keeps selection and history, and the stale report still refuses", () => {
    const svc = attempts();
    const first = activeWorker(svc);
    const next = data(svc.reserveJobAttempt({ herd: HERD, job: JOB, selection: SELECTION, replaces: first.attemptId }));
    const binding = bindWorker(next.id);
    prove(binding);

    const blocker = new Database(herdsPath);
    blocker.exec("BEGIN IMMEDIATE");
    const blocked = svc.activateJobAttempt(next.id, binding);
    blocker.exec("ROLLBACK");
    blocker.close();
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe("transient");

    const reopened = restart();
    expect(herds.attempts(HERD, JOB).map((a) => [a.id, a.state, a.selection])).toEqual([
      [first.attemptId, "active", SELECTION], [next.id, "reserved", SELECTION],
    ]);
    expect(reopened.authorizeJobReport(callerOf(binding), HERD, JOB).ok).toBe(false);

    data(reopened.activateJobAttempt(next.id, createSessionStore(state).get(binding.key)!));
    const stale = reopened.authorizeJobReport(callerOf(first.binding), HERD, JOB);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe("stale-binding");
  });
});

// --- The launch seam: prepare, activate, then work ---------------------------

type Seen = {
  work: WorkInput[]; reports: Array<Outcome<unknown>>; launches?: number;
  /** The next verify proves nothing, so that launch never takes its job. */
  refuseProof?: boolean;
  /** The next work submission's outcome is unknown. */
  ambiguousWork?: boolean;
};

/** A Claude-shaped harness: its mode report lists no policy, which its adapter verifies per session. */
function claudeLike(seen: Seen, onWork?: (binding: SessionBinding) => void): HarnessIntegration {
  const ok = <T>(value: T): Outcome<T> => ({ ok: true, data: value });
  const sessions: SessionAdapter = {
    launch: async (req) => {
      seen.launches = (seen.launches ?? 0) + 1;
      return ok({ native: { harness: "claude", profile: "acct-2", kind: "id", value: req.nativeHint! }, attachment: { mode: req.mode, pane: "w3:p1" } });
    },
    resume: async (native, req) => ok({ native, attachment: { mode: req.mode, pane: "w3:p2" } }),
    discover: async () => [],
    observe: async (b) => ok({ connectivity: "unknown", execution: "unknown", background: "unknown", observedAt: 1, source: "none", generation: b.attachment.generation }),
    startWork: async (b, input) => {
      seen.work.push(input);
      onWork?.(b);
      if (seen.ambiguousWork) return { ok: false, error: { code: "ambiguous", message: "the session never acknowledged the work" } };
      return ok({ id: input.id, evidence: "submitted", nativeId: b.native.value });
    },
  };
  const policy: PolicyAdapter = {
    verifiesPerSession: true,
    prepare: async (req) => ok({ id: "pp", harness: "claude", profile: "acct-2", cwd: req.cwd, revision: "rev-1" }),
    verify: async (b, prepared) => (seen.refuseProof
      ? { ok: false, error: { code: "not-ready", message: "the gate hook never ran in this session" } }
      : ok({ sessionKey: b.key, generation: b.attachment.generation, revision: prepared.revision, verified: POLICY, observedAt: 1, kind: "installation" })),
  };
  return {
    id: "claude", label: "Claude Code", policyProofKind: "installation",
    capabilities: async (mode: Mode): Promise<CapabilityReport> => ({ mode, supported: ["launch", "resume", "observe"], readiness: { ready: true } }),
    validateOptions: (o) => ok(o),
    options: async () => [],
    loadSessions: async () => sessions,
    loadPolicy: async () => policy,
  } as HarnessIntegration;
}

function agentService(svc: JobAttempts, integration: HarnessIntegration) {
  const registry = createRegistry([integration]);
  return createAgentService({
    db: state, emitEvent: () => 0, log, integrations: registry, integrationsEnabled: () => switchOn,
    launcher: createBoundLauncher({ db: state, registry, enabled: () => switchOn }),
    attempts: {
      activate: (attemptId, binding) => svc.activateJobAttempt(attemptId, binding),
      authorize: (attemptId, binding) => svc.authorizeAttemptWork(attemptId, binding),
    },
  });
}

const workerPayload = { provider: "claude", repo: "remote:example.com%2Fa%2Fb", cwd: "/w/job-a", prompt: "the brief", surface: "herdr", handle: "job-a.w9", label: JOB };

describe("the herd launch seam", () => {
  test("activation failure sends no work", async () => {
    const svc = attempts();
    const holder = activeWorker(svc);
    // Reserved without naming the holder, so it cannot take the job from it.
    const loser = data(svc.reserveJobAttempt({ herd: HERD, job: JOB, selection: SELECTION }));
    const seen: Seen = { work: [], reports: [] };
    const started = await agentService(svc, claudeLike(seen)).startAttempt(workerPayload, { id: loser.id, workId: `herd-work-${loser.id}`, required: POLICY });

    expect(started.ok).toBe(false);
    if (!started.ok) expect(started.error).toContain(`held by attempt ${holder.attemptId}`);
    expect(seen.work).toHaveLength(0);
    expect(listSubmissions(state, "submitting")).toHaveLength(0);
    expect(state.query("SELECT count(*) AS n FROM agent_work_submissions").get()).toEqual({ n: 0 });
    expect(herds.getAttempt(loser.id)?.state).toBe("reserved");
    expect(herds.activeAttempt(HERD, JOB)?.id).toBe(holder.attemptId);
    if (!started.ok && "kept" in started) expect(started.kept.agentId).toBeTruthy();
  });

  test("first worker call sees active ownership", async () => {
    const svc = attempts();
    const attempt = data(svc.reserveJobAttempt({ herd: HERD, job: JOB, selection: SELECTION }));
    const seen: Seen = { work: [], reports: [] };
    const integration = claudeLike(seen, (binding) => {
      seen.reports.push(svc.authorizeJobReport(callerOf(binding), HERD, JOB));
    });
    const started = await agentService(svc, integration).startAttempt(workerPayload, { id: attempt.id, workId: `herd-work-${attempt.id}`, required: POLICY });

    if (!started.ok) throw new Error(started.error);
    expect(seen.work.map((w) => w.id)).toEqual([`herd-work-${attempt.id}`]);
    expect(seen.reports).toHaveLength(1);
    expect(seen.reports[0]).toMatchObject({ ok: true, data: { id: attempt.id, state: "active" } });
  });
});

// --- herd:spawn and herd:report through the handlers -------------------------

function herdHandlers(svc: JobAttempts, agent: ReturnType<typeof createAgentService>, posted: unknown[]) {
  herds.create({ id: HERD, repo: "remote:example.com%2Fa%2Fb", room: "herd-demo", workspace: `herd: ${HERD}`, shepherdSession: "sess-shep", shepherdHandle: "shepherd", herdrSocket: null, hidden: false });
  let minted = 0;
  const ok = <T>(value: T) => ({ ok: true as const, data: value });
  const deps = {
    store: herds,
    gateStore: { get: () => null, markConsumed: () => {} },
    gate: { "gate:open": async () => ok({ id: `g${posted.length + 1}` }) },
    chat: {
      "chat:sign-in": async (p: { continue: string }) => ok({ handle: p.continue, baseHandle: JOB, name: JOB, continued: true }),
      "chat:join": async () => ok({}),
      "chat:post": async (p: unknown) => { posted.push(p); return ok({ id: posted.length }); },
    },
    agent: { "agent:start": agent.handlers["agent:start"], startAttempt: agent.startAttempt },
    worktree: { "worktree:provision": async () => ({ ok: false, error: "unused" }), "worktree:dispose": async () => ({ ok: false, error: "unused" }) },
    runWorktree: () => null,
    findRunningRunByWorktree: () => ({ kind: "none" }),
    presenceIdentityForSession: () => null,
    mintWorkerId: (job: string) => `${job}.w${++minted}`,
    identityNames: (ids: Iterable<string>) => new Map([...ids].map((id) => [id, id])),
    resolveHandle: (x: string) => x,
    probeInbox: async () => "reachable",
    herdr: async () => ({ ok: false }),
    herdrRunnerFor: () => async () => ({ stdout: "{}", exitCode: 0 }),
    lifecycle: { connected: () => true, watch: () => {}, sweepClaims: async () => {} },
    jobsRoot: join(dir, "herds"),
    log,
    integrationsEnabled: () => switchOn,
    integrations: createRegistry([claudeLike({ work: [], reports: [] })]),
    attempts: svc,
    resolveCaller: (evidence: Parameters<typeof resolveCallerContextNow>[0]) => resolveCallerContextNow(evidence, { db: state }),
  } as unknown as HerdDeps;
  return createHerdHandlers(deps);
}

describe("herd:spawn and herd:report with the switch on", () => {
  test("an ambiguous work submission keeps the active attempt and its stable work id, and launches no replacement", async () => {
    const svc = attempts();
    const seen: Seen = { work: [], reports: [], ambiguousWork: true };
    const h = herdHandlers(svc, agentService(svc, claudeLike(seen)), []);

    const spawned = await h["herd:spawn"]({ herd: HERD, job: JOB, brief: "do the thing", dir: "/w/job-a" });
    expect(spawned.ok).toBe(false);

    const all = herds.attempts(HERD, JOB);
    expect(all.map((a) => a.state)).toEqual(["active"]);
    const attempt = all[0]!;
    expect(seen.launches).toBe(1);
    expect(seen.work.map((w) => w.id)).toEqual([`herd-work-${attempt.id}`]);
    expect(findSubmission(state, attempt.bindingKey!, `herd-work-${attempt.id}`)).toMatchObject({ state: "ambiguous", attemptId: attempt.id });
    expect(herds.getJob(HERD, JOB)?.handle).toBe("job-a.w1");
  });

  test("a respawn that never takes the job gives the row back to the worker that holds it", async () => {
    const svc = attempts();
    const seen: Seen = { work: [], reports: [] };
    const posted: Array<{ handle: string }> = [];
    const h = herdHandlers(svc, agentService(svc, claudeLike(seen)), posted);

    const first = await h["herd:spawn"]({ herd: HERD, job: JOB, brief: "do the thing", dir: "/w/job-a" });
    if (!first.ok) throw new Error(first.error);
    const holder = herds.getJob(HERD, JOB)!;
    seen.refuseProof = true;
    const refused = await h["herd:spawn"]({ herd: HERD, job: JOB, dir: "/w/job-a" });
    expect(refused.ok).toBe(false);

    expect(herds.attempts(HERD, JOB).map((a) => a.state)).toEqual(["active", "reserved"]);
    expect(herds.getJob(HERD, JOB)).toMatchObject({ handle: holder.handle, agentId: holder.agentId, agentSession: holder.agentSession, status: holder.status });
    const report = await h["herd:report"]({ herd: HERD, job: JOB, body: "done", session: first.data.sessionId });
    expect(report.ok).toBe(true);
    expect(posted.map((p) => p.handle)).toEqual([first.data.handle]);
  });

  test("a respawn mints a fresh worker identity and fences the predecessor's report", async () => {
    const svc = attempts();
    const seen: Seen = { work: [], reports: [] };
    const posted: unknown[] = [];
    const h = herdHandlers(svc, agentService(svc, claudeLike(seen)), posted);

    const first = await h["herd:spawn"]({ herd: HERD, job: JOB, brief: "do the thing", dir: "/w/job-a", model: "opus" });
    if (!first.ok) throw new Error(first.error);
    const second = await h["herd:spawn"]({ herd: HERD, job: JOB, dir: "/w/job-a", model: "opus" });
    if (!second.ok) throw new Error(second.error);
    expect(second.data.handle).not.toBe(first.data.handle);

    const [old, current] = herds.attempts(HERD, JOB);
    expect([old!.state, current!.state]).toEqual(["replaced", "active"]);
    expect(current!.replaces).toBe(old!.id);
    expect(current!.selection).toEqual({ harness: "claude", options: { model: "opus" } });

    const refused = await h["herd:report"]({ herd: HERD, job: JOB, body: "done", session: first.data.sessionId });
    expect(refused).toMatchObject({ ok: false, failure: { code: "stale-binding" } });
    if (!refused.ok) expect(refused.failure?.message).toBe(refused.error);
    const missing = await h["herd:report"]({ herd: HERD, job: JOB, body: "done" });
    expect(missing.ok).toBe(false);
    expect(posted).toHaveLength(0);

    const accepted = await h["herd:report"]({ herd: HERD, job: JOB, body: "done", session: second.data.sessionId });
    expect(accepted.ok).toBe(true);
    expect(posted).toHaveLength(1);
  });

  test("a worker that names no herd or job reports for the job its own attempt holds", async () => {
    const svc = attempts();
    const posted: Array<{ handle: string }> = [];
    const h = herdHandlers(svc, agentService(svc, claudeLike({ work: [], reports: [] })), posted);
    const spawned = await h["herd:spawn"]({ herd: HERD, job: JOB, brief: "do the thing", dir: "/w/job-a" });
    if (!spawned.ok) throw new Error(spawned.error);

    const reported = await h["herd:report"]({ body: "done", session: spawned.data.sessionId });
    expect(reported.ok).toBe(true);
    expect(posted.map((p) => p.handle)).toEqual([spawned.data.handle]);
    expect(herds.getJob(HERD, JOB)?.status).toBe("done");

    const nobody = await h["herd:report"]({ body: "done" });
    expect(nobody).toMatchObject({ ok: false, error: "herd, job, and a non-empty body are required" });
  });

  const QUESTIONS = [{ id: "q1", label: "Proceed?", multi: false, options: ["yes", "no"] }];

  test("a worker that names no herd or job asks and posts a milestone for the job its attempt holds", async () => {
    const svc = attempts();
    const posted: unknown[] = [];
    const h = herdHandlers(svc, agentService(svc, claudeLike({ work: [], reports: [] })), posted);
    const spawned = await h["herd:spawn"]({ herd: HERD, job: JOB, brief: "do the thing", dir: "/w/job-a" });
    if (!spawned.ok) throw new Error(spawned.error);

    const asked = await h["herd:ask"]({ session: spawned.data.sessionId, questions: QUESTIONS });
    expect(asked.ok).toBe(true);
    expect(herds.getJob(HERD, JOB)?.status).toBe("at-gate");
    const milestone = await h["herd:milestone"]({ session: spawned.data.sessionId, artifact: "/spec.md" });
    expect(milestone.ok).toBe(true);
    expect(herds.getJob(HERD, JOB)?.status).toBe("at-milestone");
  });

  test("a replaced predecessor's question and milestone are refused stale-binding", async () => {
    const svc = attempts();
    const posted: unknown[] = [];
    const h = herdHandlers(svc, agentService(svc, claudeLike({ work: [], reports: [] })), posted);
    const first = await h["herd:spawn"]({ herd: HERD, job: JOB, brief: "do the thing", dir: "/w/job-a" });
    if (!first.ok) throw new Error(first.error);
    const second = await h["herd:spawn"]({ herd: HERD, job: JOB, dir: "/w/job-a" });
    if (!second.ok) throw new Error(second.error);

    const asked = await h["herd:ask"]({ herd: HERD, job: JOB, session: first.data.sessionId, questions: QUESTIONS });
    expect(asked).toMatchObject({ ok: false, failure: { code: "stale-binding" } });
    if (!asked.ok) expect(asked.failure?.message).toBe(asked.error);
    const milestone = await h["herd:milestone"]({ herd: HERD, job: JOB, session: first.data.sessionId, artifact: "/spec.md" });
    expect(milestone).toMatchObject({ ok: false, failure: { code: "stale-binding" } });
    expect(posted).toEqual([]);
    expect((await h["herd:ask"]({ session: second.data.sessionId, questions: QUESTIONS })).ok).toBe(true);
  });

  test("a job named in the environment that the session's attempt does not hold is refused", async () => {
    const svc = attempts();
    const posted: unknown[] = [];
    const h = herdHandlers(svc, agentService(svc, claudeLike({ work: [], reports: [] })), posted);
    const spawned = await h["herd:spawn"]({ herd: HERD, job: JOB, brief: "do the thing", dir: "/w/job-a" });
    if (!spawned.ok) throw new Error(spawned.error);
    herds.upsertJob({ herd: HERD, name: "job-b", worktree: "/w/job-b", handle: "job-b.w9", status: "active" });

    for (const [verb, extra] of [["herd:ask", { questions: QUESTIONS }], ["herd:milestone", { artifact: "/a.md" }], ["herd:report", { body: "done" }]] as const) {
      const res = await (h[verb] as (p: unknown) => Promise<{ ok: boolean; failure?: { code: string } }>)({ herd: HERD, job: "job-b", session: spawned.data.sessionId, ...extra });
      expect(res, verb).toMatchObject({ ok: false, failure: { code: "refused" } });
    }
    expect(posted).toEqual([]);
  });

  test("switch off: a question and a milestone name their job and trust the session as before", async () => {
    switchOn = false;
    const svc = attempts();
    const posted: unknown[] = [];
    const legacy = {
      handlers: { "agent:start": async () => ({ ok: true as const, data: { id: "ag-1", sessionId: "sess-w1", paneId: "w9:p1", repo: "r", cwd: "/w/job-a", surface: "herdr", provider: "claude" } }) },
      startAttempt: async () => { throw new Error("the switch is off"); },
    } as unknown as ReturnType<typeof createAgentService>;
    const h = herdHandlers(svc, legacy, posted);
    const spawned = await h["herd:spawn"]({ herd: HERD, job: JOB, brief: "do the thing", dir: "/w/job-a" });
    if (!spawned.ok) throw new Error(spawned.error);
    expect((await h["herd:ask"]({ herd: HERD, job: JOB, session: "any-session", questions: QUESTIONS })).ok).toBe(true);
    expect(await h["herd:ask"]({ session: "sess-w1", questions: QUESTIONS })).toEqual({ ok: false, error: "herd, job, and session are required (HERD_ID, HERD_JOB, CLAUDE_CODE_SESSION_ID)" });
    expect((await h["herd:milestone"]({ herd: HERD, job: JOB, session: "any-session", artifact: "/a.md" })).ok).toBe(true);
  });

  test("switch off: spawn records an unbound attempt and a report needs no session", async () => {
    switchOn = false;
    const svc = attempts();
    const posted: unknown[] = [];
    const legacy = {
      handlers: {
        "agent:start": async () => ({ ok: true as const, data: { id: "ag-1", sessionId: "sess-w1", paneId: "w9:p1", repo: "r", cwd: "/w/job-a", surface: "herdr", provider: "claude" } }),
      },
      startAttempt: async () => { throw new Error("the switch is off"); },
    } as unknown as ReturnType<typeof createAgentService>;
    const h = herdHandlers(svc, legacy, posted);

    const spawned = await h["herd:spawn"]({ herd: HERD, job: JOB, brief: "do the thing", dir: "/w/job-a" });
    if (!spawned.ok) throw new Error(spawned.error);
    expect(herds.attempts(HERD, JOB).map((a) => [a.state, a.bindingKey])).toEqual([["active", undefined]]);

    const reported = await h["herd:report"]({ herd: HERD, job: JOB, body: "done" });
    expect(reported.ok).toBe(true);
    expect(posted).toHaveLength(1);
  });
});
