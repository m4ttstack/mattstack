/**
 * The shared launcher: every bound agent launch, resume and work submission.
 *
 * A launch never sends work. It runs reserve → (policy preflight) →
 * create/resume → bind → verify, and returns a binding ready to take work.
 * The reservation records each step before the side effect it guards, so a
 * launch that times out after making a native session is bound by the next
 * attempt, from any process, without making another; a launch interrupted
 * in another process with no recorded session is refused, never retried
 * blindly. Readiness belongs to one attachment generation: a later
 * generation is unready until verified again.
 *
 * Work goes through `startBoundWork` alone, with a mandatory authorization
 * the caller supplies (a herd attempt check, or the agent handler's own). It
 * persists the submission, authorizes, rechecks the binding, persists
 * `submitting`, and only then makes the native call. A submission whose
 * outcome is unknown is reconciled against native evidence and never sent
 * twice.
 */

import type { Database } from "bun:sqlite";
import { resolve } from "path";
import type {
  Capability, FaultCode, NativeSessionRef, Outcome, Selection, SessionBinding,
} from "../../packages/rt-client/src/agent-integrations.ts";
import { formatPaneRef } from "../../packages/rt-client/src/pane-ref.ts";
import { getAgent, updateAgentPane, updateAgentSessionId } from "../state/agents-store.ts";
import { getStateDb } from "../state/db.ts";
import { admit } from "./admission.ts";
import { applySessionPresence, type PresenceEvent } from "./presence.ts";
import { builtinRegistry } from "./builtins.ts";
import {
  createObservationSweep,
  type HarnessIntegration, type IntegrationRegistry, type LaunchHost, type LaunchRequest, type LaunchSurface, type NativeLaunch,
  type ObservationSweep, type PolicyAdapter, type PolicyProof, type PreparedLaunch, type PreparedPolicy, type SessionAdapter,
  type WorkInput, type WorkReceipt,
} from "./contracts.ts";
import {
  abandonStaleLaunches, claimReservation, createSessionStore, failReservation, isDetachedAttachment, LEGACY_DEFAULT_PROFILE,
  launchHolding, markBindingReady, noteReservationError, pruneReservations, readBindingReadiness, readBindingSelection,
  readReservation, recordLaunched, unresolvedLaunchOf,
  type LaunchedNative, type PersistedLaunch, type ReservationRecord, type SessionStore,
} from "./session-store.ts";
import {
  abandonSubmission, DELIVERED_STATES, findSubmission, listDueSubmissions, listStalePending, listSubmissions, markSubmitting,
  noteCheck, receiptOf, recordPending, sendInProgress, settleSubmission, unresolvedSubmissionOf, workDigest,
  type SubmissionKey, type SubmissionState, type WorkSubmission,
} from "./work-submissions.ts";

export type BoundLaunchRequest = LaunchRequest & {
  /** Resume this binding's native session instead of creating one; it keeps its identity and selection. */
  resumeKey?: string;
};
export type PreparedBinding = SessionBinding & { surface?: LaunchSurface };
export type SubmittedWork = WorkReceipt & { binding: SessionBinding };
/** Trusted server code supplied by the caller, never a tool argument. */
export type AuthorizeWork = () => Promise<Outcome<void>>;

export interface BoundLauncher {
  launchBoundAgent(request: BoundLaunchRequest): Promise<Outcome<PreparedBinding>>;
  startBoundWork(binding: SessionBinding, input: WorkInput, authorize: AuthorizeWork): Promise<Outcome<SubmittedWork>>;
  /** Interrupted submissions become ambiguous and are reconciled; old settled reservations are pruned. */
  recover(): Promise<void>;
}

export type LauncherDeps = {
  db: Database;
  registry: IntegrationRegistry;
  /** Names this process on the claims it persists; a claim with another name is another process's. */
  claimToken: string;
  store: SessionStore;
  syncAgent(db: Database, binding: SessionBinding, surface?: LaunchSurface): void;
  now(): number;
  /** The shared chat presence service, told each lifecycle event a launch observes. */
  presence(binding: SessionBinding, event: PresenceEvent): Promise<void>;
};

type PolicyReady = { adapter: PolicyAdapter; prepared: PreparedPolicy };

const POLICY_CAPABILITIES: ReadonlySet<Capability> = new Set(["gate-policy", "continuation-policy"]);
/** Launch failures an adapter reports only when it made nothing, so the reservation may be claimed again. */
const MADE_NOTHING: ReadonlySet<FaultCode> = new Set(["invalid", "unsupported", "refused"]);
/** Submission failures an adapter reports only when nothing reached the session. */
const SENT_NOTHING: ReadonlySet<FaultCode> = new Set(["invalid", "unsupported", "refused", "not-ready", "stale-binding"]);

const PROCESS_CLAIM = `pid-${process.pid}-${crypto.randomUUID()}`;
/** Launches and submissions running now in this process, keyed with the claim token they persist. */
const LAUNCHING = new Set<string>();
const SUBMITTING = new Set<string>();

const DAY_MS = 24 * 60 * 60_000;
/** An unresolved launch left this long stops holding its place, and asks for attention instead. */
const LAUNCH_GIVE_UP_MS = 6 * 60 * 60_000;
/** A pending submission this old belongs to a call that ended before sending anything. */
const PENDING_STALE_MS = 10 * 60_000;

const ok = <T>(data: T): Outcome<T> => ({ ok: true, data });
const fail = <T>(code: FaultCode, message: string): Outcome<T> => ({ ok: false, error: { code, message } });
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * One unresolved launch at a time per (harness, profile, cwd). The profile is
 * the account the selection names, else the ambient one; a harness whose
 * profile is not an account option (Codex) is guarded per harness and cwd.
 */
export function launchGuard(selection: Selection, cwd: string): string {
  return [selection.harness, selection.options.account ?? LEGACY_DEFAULT_PROFILE, resolve(cwd)].join("\0");
}

/** Why a new launch under this guard must wait, naming the agent whose launch or work is still unresolved; null when none is. */
export function launchInProgress(db: Database, guard: string): string | null {
  const held = launchHolding(db, guard);
  const sending = held ? null : sendInProgress(db, guard);
  if (!held && !sending) return null;
  const who = held?.agentId ?? sending?.agentId;
  const subject = who !== undefined ? `agent ${who}` : held ? `launch ${held.reservationId}` : "an earlier launch";
  return `${subject} is still starting here, or rt cannot tell whether it started; rt will not start another session in the same place until it resolves`;
}

/** Why an agent needs a person: a launch or a submission whose outcome rt cannot tell, made after `since` (its last successful resume). */
export function launchAttention(db: Database, agentId: string, since?: number): string | undefined {
  const launch = unresolvedLaunchOf(db, agentId, since);
  if (launch) {
    return launch.state === "abandoned"
      ? "rt stopped waiting for this agent's launch; check whether its session started"
      : "this agent's launch has not resolved; rt cannot tell yet whether its session started";
  }
  const work = unresolvedSubmissionOf(db, agentId, since);
  if (!work) return undefined;
  return work.state === "abandoned"
    ? "rt found no sign that this agent's work reached its session and stopped checking; it will not send it again"
    : "rt cannot tell yet whether this agent's work reached its session; it will not send it again";
}

/** The agent record follows its binding: the native session id, and the pane when the launch reported where it opened. */
export function syncAgentRecord(db: Database, binding: SessionBinding, surface?: LaunchSurface): void {
  if (binding.agentId === undefined) return;
  const rec = getAgent(binding.agentId, db);
  if (!rec || rec.id !== binding.agentId) return;
  if (rec.sessionId !== binding.native.value) updateAgentSessionId(rec.id, binding.native.value, db);
  const pane = binding.attachment.pane;
  const tabId = surface?.tabId ?? rec.tabId;
  const workspaceId = surface?.workspaceId ?? rec.workspaceId;
  if (pane === undefined || tabId === undefined || workspaceId === undefined) return;
  if (pane === rec.paneId && tabId === rec.tabId && workspaceId === rec.workspaceId) return;
  updateAgentPane(rec.id, { paneId: pane, tabId, workspaceId }, db);
}

function onBackground<T extends { pane?: string }>(attachment: T, host: LaunchHost | undefined): T {
  return host?.background && attachment.pane !== undefined ? { ...attachment, pane: formatPaneRef(attachment.pane, "bg") } : attachment;
}

/** A resume keeps its session's harness and every option it launched with; it may only leave an option unsaid. */
function mergeSelection(stored: Selection | null, asked: Selection): Outcome<Selection> {
  if (!stored) return ok(asked);
  if (stored.harness !== asked.harness) {
    return fail("invalid", `this session runs on ${stored.harness}; switching it to ${asked.harness} needs a new launch, not a resume`);
  }
  const options: Record<string, unknown> = { ...stored.options };
  for (const [name, value] of Object.entries(asked.options)) {
    if (value === undefined) continue;
    if (options[name] !== value) {
      return fail("invalid", `a resume keeps the session's ${name}; changing it needs a new launch`);
    }
  }
  return ok({ harness: stored.harness, options: options as Selection["options"] });
}

function proofMismatch(proof: PolicyProof, binding: SessionBinding, prepared: PreparedPolicy, needed: readonly Capability[]): string | undefined {
  if (proof.sessionKey !== binding.key) return "the policy proof names another session";
  if (proof.generation !== binding.attachment.generation) return "the policy proof is for another attachment";
  if (proof.revision !== prepared.revision) return "the policy proof is for another policy revision";
  const missing = needed.filter((c) => !proof.verified.includes(c));
  return missing.length > 0 ? `the session never proved: ${missing.join(", ")}` : undefined;
}

async function warnOnce(message: string, context: Record<string, unknown>): Promise<void> {
  const { warn } = await import("../ui/warn.ts");
  warn("agent-launch", message, { context });
}

export function createBoundLauncher(overrides: Partial<LauncherDeps> = {}): BoundLauncher {
  const db = overrides.db ?? getStateDb();
  const deps: LauncherDeps = {
    db,
    registry: overrides.registry ?? builtinRegistry(),
    claimToken: overrides.claimToken ?? PROCESS_CLAIM,
    store: overrides.store ?? createSessionStore(db),
    syncAgent: overrides.syncAgent ?? syncAgentRecord,
    now: overrides.now ?? Date.now,
    presence: overrides.presence ?? ((binding, event) => applySessionPresence(binding, event, { db })),
  };
  const { store, registry, claimToken } = deps;
  /** The launch each binding was prepared by in this process, handed to its first work submission. */
  const prepared = new Map<string, PreparedLaunch>();
  /** Native sessions made here whose `launched` record could not be written. */
  const madeHere = new Map<string, NativeLaunch>();

  const flight = (...parts: string[]) => [claimToken, ...parts].join("\0");

  /** Presence follows the binding; a failure there never fails the launch that made the session. */
  async function observed(binding: SessionBinding, event: PresenceEvent): Promise<void> {
    try {
      await deps.presence(binding, event);
    } catch (err) {
      void warnOnce("chat presence could not follow a session's launch", { key: binding.key, event, err: messageOf(err) });
    }
  }

  function foreignSessionEnv(harness: string): string[] {
    return registry.list().filter((i) => i.id !== harness).flatMap((i) => [...(i.sessionEnv ?? [])]);
  }

  /** The policy capabilities a binding must prove, from the launch or from what its readiness recorded. */
  function policyNeeded(required: readonly Capability[]): Capability[] {
    return [...new Set(required.filter((c) => POLICY_CAPABILITIES.has(c)))];
  }

  /** Read-only preflight; only a request that requires policy ever loads an integration's policy factory. */
  async function preparePolicy(integration: HarnessIntegration, request: LaunchRequest): Promise<Outcome<PolicyReady>> {
    const adapter = await integration.loadPolicy!();
    const preparedPolicy = await adapter.prepare(request);
    return preparedPolicy.ok ? ok({ adapter, prepared: preparedPolicy.data }) : preparedPolicy;
  }

  /** Verifies the bound session itself, then records readiness for its current generation only. */
  async function finish(
    integration: HarnessIntegration, binding: SessionBinding, request: LaunchRequest, kind: PreparedLaunch["kind"],
    surface: LaunchSurface | undefined, policy?: Outcome<PolicyReady>,
  ): Promise<Outcome<PreparedBinding>> {
    const needed = policyNeeded(request.required);
    let proof: PolicyProof | undefined;
    if (needed.length > 0) {
      const ready = policy ?? await preparePolicy(integration, request);
      if (!ready.ok) return fail("not-ready", `session ${binding.native.value} is bound but its policy could not be prepared: ${ready.error.message}`);
      const verified = await ready.data.adapter.verify(binding, ready.data.prepared);
      if (!verified.ok) return fail("not-ready", `session ${binding.native.value} is bound but has not proved its policy: ${verified.error.message}`);
      const mismatch = proofMismatch(verified.data, binding, ready.data.prepared, needed);
      if (mismatch) return fail("not-ready", `session ${binding.native.value} is bound but not ready: ${mismatch}`);
      proof = verified.data;
    }
    const marked = markBindingReady(db, binding.key, binding.attachment.generation, request.required, proof);
    if (!marked.ok) return marked;
    prepared.set(binding.key, { request, kind });
    return ok({ ...binding, ...(surface !== undefined && { surface }) });
  }

  async function bindMade(
    integration: HarnessIntegration, reservationId: string, made: NativeLaunch, request: LaunchRequest, kind: PreparedLaunch["kind"],
    policy?: Outcome<PolicyReady>,
  ): Promise<Outcome<PreparedBinding>> {
    const bound = store.bind(reservationId, made.native, made.attachment);
    if (!bound.ok) return bound;
    madeHere.delete(reservationId);
    deps.syncAgent(db, bound.data, made.surface);
    await observed(bound.data, kind === "resume" ? "resume" : "start");
    return finish(integration, bound.data, request, kind, made.surface, policy);
  }

  /**
   * A launch whose outcome is unknown and that no adapter is carrying on (it
   * started in another process, or its adapter keeps nothing per
   * reservation): only native discovery of the id the launch was handed can
   * say what it made. It is never launched again.
   */
  async function reconcileByDiscovery(
    integration: HarnessIntegration, sessions: SessionAdapter, reservation: ReservationRecord, request: LaunchRequest, kind: PreparedLaunch["kind"],
  ): Promise<Outcome<PreparedBinding>> {
    const hint = reservation.request?.nativeHint;
    const found = hint === undefined ? undefined
      : (await sessions.discover()).find((d) => d.native.harness === integration.id && d.native.value === hint);
    if (!found) {
      return fail("ambiguous", `launch reservation ${reservation.id} has an unknown outcome and no running session shows it; rt will not start another session for it`);
    }
    return bindMade(integration, reservation.id, { ...found, attachment: onBackground(found.attachment, request.host) }, request, kind);
  }

  async function launchReserved(
    integration: HarnessIntegration, reservation: ReservationRecord, request: LaunchRequest,
    kind: PreparedLaunch["kind"], resumed: NativeSessionRef | undefined, persisted: PersistedLaunch,
  ): Promise<Outcome<PreparedBinding>> {
    const sessions = await integration.loadSessions!();
    const made = madeHere.get(reservation.id) ?? reservation.launched;
    if (made) return bindMade(integration, reservation.id, made, request, kind);

    const report = await integration.capabilities(request.mode);
    const admitted = admit(report, [kind, ...request.required]);
    if (!admitted.ok) return admitted;
    let policy: Outcome<PolicyReady> | undefined;
    if (policyNeeded(request.required).length > 0) {
      policy = await preparePolicy(integration, request);
      if (!policy.ok) return policy;
    }

    const retried = reservation.state === "launching";
    if (retried) {
      // Only this process's own adapter, holding what the launch made under this id, may carry it on.
      if (reservation.claimedBy !== claimToken || sessions.carriesReservations !== true) {
        return reconcileByDiscovery(integration, sessions, reservation, request, kind);
      }
    } else {
      const claimed = claimReservation(db, reservation.id, claimToken, persisted, launchGuard(persisted.selection, persisted.cwd));
      if (!claimed.ok) return claimed;
    }

    const result = resumed ? await sessions.resume(resumed, request) : await sessions.launch(request);
    if (!result.ok) {
      // A retried launch may already have made something, whatever the adapter says now (a deduped tab can be its own).
      if (!retried && MADE_NOTHING.has(result.error.code)) failReservation(db, reservation.id, result.error.message);
      else noteReservationError(db, reservation.id, result.error.message);
      return retried && result.error.code !== "ambiguous" ? fail("ambiguous", result.error.message) : result;
    }
    const launched: NativeLaunch = { ...result.data, attachment: onBackground(result.data.attachment, request.host) };
    madeHere.set(reservation.id, launched);
    const record: LaunchedNative = { native: launched.native, attachment: launched.attachment };
    recordLaunched(db, reservation.id, record);
    return bindMade(integration, reservation.id, launched, request, kind, policy);
  }

  /** The current binding for a submission, or why it cannot take work now. */
  function currentFor(binding: SessionBinding): Outcome<SessionBinding> {
    const current = store.get(binding.key);
    if (!current) return fail("invalid", "no session binding has that key");
    if (current.attachment.generation !== binding.attachment.generation) {
      return fail("stale-binding", `session ${current.native.value} moved from attachment ${binding.attachment.generation} to ${current.attachment.generation}; nothing was sent`);
    }
    if (isDetachedAttachment(current)) return fail("stale-binding", `session ${current.native.value} left its attachment; nothing was sent`);
    const readiness = readBindingReadiness(db, current.key);
    if (readiness?.generation !== current.attachment.generation) {
      return fail("not-ready", `session ${current.native.value} has not been verified ready for this attachment; nothing was sent`);
    }
    const needed = policyNeeded(readiness.required);
    if (needed.length > 0 && (readiness.proof?.generation !== current.attachment.generation || readiness.proof.sessionKey !== current.key)) {
      return fail("not-ready", `session ${current.native.value} has no current policy proof; nothing was sent`);
    }
    return ok(current);
  }

  /**
   * Checks native evidence for a submission whose outcome is unknown. A check
   * that finds nothing pushes the next one back; the last allowed one
   * abandons the row. Neither ever sends the work again.
   */
  async function reconcileSubmission(
    row: WorkSubmission, binding: SessionBinding, integration: HarnessIntegration, sweep?: ObservationSweep,
  ): Promise<Outcome<SubmittedWork>> {
    const key: SubmissionKey = { bindingKey: row.bindingKey, generation: row.generation, inputId: row.inputId };
    const unsent = (why: string) => fail<SubmittedWork>("ambiguous", `work ${row.inputId} may or may not have reached session ${binding.native.value} (${why}); rt will not send it again`);
    if (row.state === "abandoned") return unsent("rt stopped checking for it");
    let current = row;
    if (row.state === "submitting") {
      settleSubmission(db, key, ["submitting", "submitting"], "ambiguous", { error: "interrupted before its outcome was recorded" });
      current = { ...row, state: "ambiguous" };
    }
    const unknown = (why: string) => {
      const left = noteCheck(db, current, deps.now(), why);
      return unsent(left === "abandoned" ? `${why}; rt has stopped checking` : why);
    };
    const sessions = await integration.loadSessions!();
    if (!sessions.reconcileWork) return unknown(`${integration.label} offers no evidence to check`);
    const found = await sessions.reconcileWork(binding, {
      id: row.inputId, digest: row.digest, ...(row.submittingAt !== undefined && { submittedAt: row.submittingAt }),
    }, sweep);
    if (!found.ok) return unknown(found.error.message);
    if (!found.data) return unknown("no native evidence of it yet");
    settleSubmission(db, key, ["ambiguous", "submitting"], found.data.evidence, { receipt: found.data });
    return ok({ ...found.data, binding });
  }

  async function submit(current: SessionBinding, input: WorkInput, integration: HarnessIntegration, authorize: AuthorizeWork): Promise<Outcome<SubmittedWork>> {
    const existing = findSubmission(db, current.key, input.id);
    if (existing && DELIVERED_STATES.has(existing.state)) return ok({ ...receiptOf(existing), binding: current });
    if (existing && (existing.state === "submitting" || existing.state === "ambiguous" || existing.state === "abandoned")) {
      return reconcileSubmission(existing, current, integration);
    }

    const key: SubmissionKey = { bindingKey: current.key, generation: current.attachment.generation, inputId: input.id };
    const launch = prepared.get(current.key);
    const guard = launch ? launchGuard(launch.request.selection, launch.request.cwd) : undefined;
    const pending = recordPending(db, key, workDigest(input.text), current.attemptId, guard);
    if (!pending.ok) return pending;
    const refuse = (error: { code: FaultCode; message: string }): Outcome<SubmittedWork> => {
      settleSubmission(db, key, ["pending", "refused"], "refused", { error: error.message });
      return { ok: false, error };
    };
    const sessions = await integration.loadSessions!();
    const authorized = await authorize();
    if (!authorized.ok) return refuse(authorized.error);
    const now = currentFor(current);
    if (!now.ok) return refuse(now.error);
    const claimed = markSubmitting(db, key, claimToken);
    if (!claimed.ok) return claimed;
    if (!claimed.data) return fail("ambiguous", `work ${input.id} was already being submitted elsewhere; rt will not send it again`);

    let result: Outcome<WorkReceipt>;
    try {
      result = await sessions.startWork(now.data, input, launch);
    } catch (err) {
      settleSubmission(db, key, ["submitting", "ambiguous"], "ambiguous", { error: messageOf(err) });
      return fail("ambiguous", `work ${input.id} may or may not have reached session ${current.native.value}: ${messageOf(err)}`);
    }
    if (!result.ok) {
      const sent: SubmissionState = SENT_NOTHING.has(result.error.code) ? "refused" : "ambiguous";
      settleSubmission(db, key, ["submitting", "ambiguous"], sent, { error: result.error.message });
      return sent === "refused" ? result : fail("ambiguous", result.error.message);
    }
    const receipt = result.data;
    settleSubmission(db, key, ["submitting", "ambiguous"], receipt.evidence, { receipt });
    prepared.delete(current.key);

    let bound = now.data;
    if (receipt.attachment) {
      // The work started the native process, so the session has its first real attachment now.
      const attachment = onBackground(receipt.attachment, launch?.request.host);
      const moved = store.replaceAttachment(current.key, current.attachment.generation, attachment);
      if (moved.ok) {
        bound = moved.data;
        await observed(bound, launch?.kind === "resume" ? "resume" : "start");
        const readiness = readBindingReadiness(db, current.key);
        if (readiness && policyNeeded(readiness.required).length === 0) markBindingReady(db, current.key, bound.attachment.generation, readiness.required);
      } else {
        bound = { ...bound, attachment: { ...attachment, generation: bound.attachment.generation } };
        void warnOnce("a submitted session's new attachment was not recorded", { key: current.key, error: moved.error.message });
      }
    }
    deps.syncAgent(db, bound, receipt.surface);
    return ok({ ...receipt, binding: bound });
  }

  return {
    async launchBoundAgent(request) {
      const asked = registry.get(request.selection.harness);
      if (!asked) return fail("invalid", `no harness is registered as "${request.selection.harness}"`);
      if (!asked.loadSessions) return fail("unsupported", `${asked.label} has no session integration`);
      const needed = policyNeeded(request.required);
      if (needed.length > 0 && !asked.loadPolicy) {
        return fail("unsupported", `${asked.label} cannot enforce ${needed.join(", ")}, which this launch requires`);
      }
      const reservation = readReservation(db, request.reservationId);
      if (!reservation) return fail("invalid", "no launch reservation has that id");

      let resumed: SessionBinding | undefined;
      let selection = request.selection;
      if (request.resumeKey !== undefined) {
        resumed = store.get(request.resumeKey) ?? undefined;
        if (!resumed) return fail("invalid", "no session binding has that key to resume");
        if (resumed.identity !== reservation.identity) return fail("refused", `session ${resumed.native.value} belongs to another identity`);
        const merged = mergeSelection(readBindingSelection(db, resumed.key), request.selection);
        if (!merged.ok) return merged;
        if (resumed.native.harness !== merged.data.harness) {
          return fail("invalid", `this session runs on ${resumed.native.harness}; switching harness needs a new launch, not a resume`);
        }
        selection = merged.data;
      }
      const validated = asked.validateOptions(selection.options);
      if (!validated.ok) return validated;
      selection = { harness: selection.harness, options: validated.data };

      const unsetEnv = [...new Set([...(request.host?.unsetEnv ?? []), ...foreignSessionEnv(asked.id)])];
      const { resumeKey: _resumeKey, ...base } = request;
      // Every launch is handed one id up front, kept across retries, so a harness that takes rt-minted ids is found by it later.
      const nativeHint = reservation.request?.nativeHint ?? request.nativeHint ?? crypto.randomUUID();
      const adapterRequest: LaunchRequest = {
        ...base, selection, nativeHint,
        ...((request.host !== undefined || unsetEnv.length > 0) && { host: { ...request.host, unsetEnv } }),
      };
      const kind: PreparedLaunch["kind"] = resumed ? "resume" : "launch";

      if (reservation.boundKey !== undefined) {
        const bound = store.get(reservation.boundKey);
        if (!bound) return fail("invalid", `launch reservation ${reservation.id} names a binding that no longer exists`);
        const readiness = readBindingReadiness(db, bound.key);
        if (readiness?.generation === bound.attachment.generation) return ok(bound);
        return finish(asked, bound, adapterRequest, kind, undefined);
      }

      const inFlight = flight("launch", reservation.id);
      if (LAUNCHING.has(inFlight)) {
        return fail("ambiguous", `a launch for reservation ${reservation.id} is still in progress; rt will not start another session for it`);
      }
      LAUNCHING.add(inFlight);
      try {
        const persisted: PersistedLaunch = {
          cwd: request.cwd, mode: request.mode, selection, required: [...request.required],
          ...(request.resumeKey !== undefined && { resumeKey: request.resumeKey }),
          nativeHint,
        };
        return await launchReserved(asked, reservation, adapterRequest, kind, resumed?.native, persisted);
      } catch (err) {
        // A throw says nothing about what the adapter made, so the reservation keeps whatever claim it reached.
        noteReservationError(db, reservation.id, messageOf(err));
        return fail("ambiguous", messageOf(err));
      } finally {
        LAUNCHING.delete(inFlight);
      }
    },

    async startBoundWork(binding, input, authorize) {
      if (typeof authorize !== "function") return fail("refused", "work needs its caller's authorization; nothing was sent");
      if (!input || typeof input.id !== "string" || input.id === "" || typeof input.text !== "string") {
        return fail("invalid", "work needs an id and its text");
      }
      const current = currentFor(binding);
      if (!current.ok) return current;
      const integration = registry.get(current.data.native.harness);
      if (!integration?.loadSessions) return fail("invalid", `no session integration is registered for ${current.data.native.harness}`);
      const inFlight = flight("work", current.data.key, input.id);
      if (SUBMITTING.has(inFlight)) return fail("ambiguous", `work ${input.id} is already being submitted; rt will not send it again`);
      SUBMITTING.add(inFlight);
      try {
        return await submit(current.data, input, integration, authorize);
      } finally {
        SUBMITTING.delete(inFlight);
      }
    },

    async recover() {
      const now = deps.now();
      const busyHere = (row: WorkSubmission) => SUBMITTING.has(flight("work", row.bindingKey, row.inputId));
      for (const row of listStalePending(db, now - PENDING_STALE_MS)) {
        if (busyHere(row)) continue;
        settleSubmission(db, row, ["pending", "pending"], "refused", { error: "its call ended before sending anything" });
      }
      for (const row of listSubmissions(db, "submitting")) {
        if (row.claimedBy === claimToken && busyHere(row)) continue;
        settleSubmission(db, row, ["submitting", "submitting"], "ambiguous", { error: "interrupted before its outcome was recorded" });
      }
      // One sweep for every check this pass, so a native source is read once, not once per row.
      const sweep = createObservationSweep();
      for (const row of listDueSubmissions(db, now)) {
        if (busyHere(row)) continue;
        const binding = store.get(row.bindingKey);
        const integration = binding ? registry.get(binding.native.harness) : undefined;
        if (!binding || !integration?.loadSessions) {
          abandonSubmission(db, row, binding ? `no session integration is registered for ${binding.native.harness}` : "its session binding is gone");
          continue;
        }
        try {
          await reconcileSubmission(row, binding, integration, sweep);
        } catch (err) {
          noteCheck(db, row, now, messageOf(err));
          void warnOnce("an interrupted work submission could not be reconciled", { key: row.bindingKey, input: row.inputId, err: messageOf(err) });
        }
      }
      abandonStaleLaunches(db, now - LAUNCH_GIVE_UP_MS);
      pruneReservations(db, now - DAY_MS, now - 7 * DAY_MS);
    },
  };
}

let shared: BoundLauncher | undefined;

/** This process's launcher over state.db and the built-in harnesses. */
export function sharedBoundLauncher(): BoundLauncher {
  return (shared ??= createBoundLauncher());
}

export function launchBoundAgent(request: BoundLaunchRequest): Promise<Outcome<PreparedBinding>> {
  return sharedBoundLauncher().launchBoundAgent(request);
}

export function startBoundWork(binding: SessionBinding, input: WorkInput, authorize: AuthorizeWork): Promise<Outcome<SubmittedWork>> {
  return sharedBoundLauncher().startBoundWork(binding, input, authorize);
}
