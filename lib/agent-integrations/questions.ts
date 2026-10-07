/**
 * Native question completion, shared by every harness.
 *
 * The gate store stays the authority. A harness that asked a gate as a
 * native question binds the two (`bindGateQuestion`); once the gate is
 * answered or closed, the answer is committed through the gate service first,
 * and only then is the native question completed from the stored row
 * (`completeGateQuestion`). The completion is recorded apart from the answer:
 * its intent, with a fingerprint of the row it acts on, is written before the
 * native side effect, and nothing a completion does ever changes or rolls back
 * the gate's answer. `conflict` keeps the answer and reports the divergence.
 *
 * A question belongs to the attachment generation it was asked under. A
 * session on another attachment never receives it, and a result that comes
 * back after the attachment changed, or after shutdown began, is not applied.
 * Connection and request ids live only inside the harness and authorize
 * nothing here, so after a restart or a reconnect `recoverGateQuestions`
 * starts again from the durable binding and the stored row.
 *
 * Every entry point is inert while agent.integrations.enabled is off.
 */

import type { Database } from "bun:sqlite";
import { createHash } from "crypto";
import type { Logger } from "pino";
import type { FaultCode, Outcome, QuestionBinding, SessionBinding } from "../../packages/rt-client/src/agent-integrations.ts";
import { validateGateAnswers } from "../../packages/rt-client/src/gate-answers.ts";
import type { NativeQuestionSeam } from "../daemon/gate-push.ts";
import { answeredByNudgedPane, type GateRow, type GatesStore } from "../daemon/gates-store.ts";
import { getStateDb } from "../state/db.ts";
import { builtinRegistry } from "./builtins.ts";
import type { QuestionAdapter } from "./contracts.ts";
import type { CompletionRecord, CompletionState } from "./question-store.ts";
import { createSessionStore, isDetachedAttachment } from "./session-store.ts";
import { integrationsEnabled } from "./switch.ts";

/** Bound gates one recovery pass looks at; the rest wait for the next pass. */
export const RECOVER_LIMIT = 50;

export type GateQuestionDeps = {
  gates: Pick<GatesStore, "get" | "markConsumed" | "nativeQuestions">;
  /** The session store's binding for a key, attached or not. */
  storedBinding(key: string): SessionBinding | null;
  /** Whether the harness completes native questions, read without loading its code. */
  supports(harness: string): boolean;
  questionsFor(harness: string): Promise<QuestionAdapter | undefined>;
  /** The harness's native connection now, without connecting: an id, null while it has none, undefined when it has none to track. */
  connectionOf(harness: string): string | null | undefined;
  harnesses(): readonly string[];
  enabled(): boolean;
  now(): number;
  recoverLimit: number;
  /** Aborted at daemon shutdown: in-flight completions stop waiting and apply nothing. */
  signal?: AbortSignal;
  log?: Pick<Logger, "warn" | "info" | "debug">;
  emit?(topic: string, payload: Record<string, unknown>): void;
};

export interface GateQuestions extends NativeQuestionSeam {
  /**
   * Binds a gate to the native question that presented it, under the
   * session's current attachment. A gate already answered or closed starts
   * its completion at once.
   */
  bindGateQuestion(binding: QuestionBinding): Outcome<void>;
  /** Completes the gate's native question from the stored row; ok only once it is completed. */
  completeGateQuestion(gateId: string): Promise<Outcome<void>>;
  /** One bounded pass over answered or closed bound gates whose completion is missing or pending. */
  recoverGateQuestions(): Promise<{ completed: number; pending: number }>;
  /** Runs recovery when a harness's native connection has changed since it was last read; reads the switch only then. */
  noteConnections(): Promise<void>;
  completion(gateId: string): CompletionRecord | null;
  /** Settles once every completion and recovery this service started has finished. */
  idle(): Promise<void>;
}

const OFF = "agent integrations are off, so native questions are not completed";
const STOPPING = "the daemon is stopping; the completion stays pending for recovery";

const ok = <T>(data: T): Outcome<T> => ({ ok: true, data });
const fail = <T>(code: FaultCode, message: string): Outcome<T> => ({ ok: false, error: { code, message } });
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** What a completion acts on: the winning answer, or for a gate that ended unanswered, how it ended. */
export function answerFingerprint(row: Pick<GateRow, "answer" | "closedReason" | "closedAt">): string {
  const subject = row.answer ? { answer: row.answer } : { closed: row.closedReason, closedAt: row.closedAt };
  return createHash("sha256").update(canonicalJson(subject)).digest("hex");
}

function sameBinding(a: QuestionBinding, b: QuestionBinding): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

function bindingProblem(b: QuestionBinding): string | null {
  if (typeof b?.gateId !== "string" || !b.gateId) return "a question binding needs a gate id";
  if (typeof b.sessionKey !== "string" || !b.sessionKey) return "a question binding needs a session key";
  if (!Number.isInteger(b.generation) || b.generation < 0) return "a question binding needs an attachment generation";
  if (b.presentation !== "form" && b.presentation !== "wait") return 'presentation must be "form" or "wait"';
  for (const key of ["nativeThread", "nativeTurn", "nativeItem"] as const) {
    if (b[key] !== undefined && (typeof b[key] !== "string" || !b[key])) return `${key} must be a non-empty string`;
  }
  if (b.nativeQuestions !== undefined
    && (!Array.isArray(b.nativeQuestions) || !b.nativeQuestions.every((id) => typeof id === "string" && id.length > 0))) {
    return "nativeQuestions must be question ids";
  }
  return null;
}

/** The session that asked recorded the answer itself, so its native question is already resolved. */
function selfAnswered(row: GateRow, session: SessionBinding): boolean {
  if (!row.answer) return false;
  if (row.answer.session !== undefined && row.answer.session === session.native.value) return true;
  return row.nudge != null && answeredByNudgedPane(row);
}

const ABORTED = Symbol("aborted");
function untilAborted<T>(work: Promise<T>, signal?: AbortSignal): Promise<T | typeof ABORTED> {
  if (!signal) return work;
  if (signal.aborted) return Promise.resolve(ABORTED);
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(ABORTED);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (err) => { signal.removeEventListener("abort", onAbort); reject(err); },
    );
  });
}

function defaultDeps(db: () => Database): Omit<GateQuestionDeps, "gates"> {
  const registry = builtinRegistry();
  return {
    storedBinding: (key) => createSessionStore(db()).get(key),
    supports: (harness) => typeof registry.get(harness)?.loadQuestions === "function",
    questionsFor: async (harness) => registry.get(harness)?.loadQuestions?.(),
    connectionOf: (harness) => registry.get(harness)?.messagingConnection?.(),
    harnesses: () => registry.list().map((integration) => integration.id),
    enabled: integrationsEnabled,
    now: Date.now,
    recoverLimit: RECOVER_LIMIT,
  };
}

export function createGateQuestions(
  overrides: Partial<GateQuestionDeps> & Pick<GateQuestionDeps, "gates"> & { db?: () => Database },
): GateQuestions {
  const deps: GateQuestionDeps = { ...defaultDeps(overrides.db ?? (() => getStateDb())), ...overrides };
  const store = () => deps.gates.nativeQuestions();
  const inflight = new Map<string, Promise<Outcome<void>>>();
  const tracked = new Set<Promise<unknown>>();
  const links = new Map<string, string | null | undefined>();
  let recovering: Promise<{ completed: number; pending: number }> | undefined;
  let recoverAgain = false;

  function track<T>(work: Promise<T>): Promise<T> {
    tracked.add(work);
    const done = () => { tracked.delete(work); };
    work.then(done, done);
    return work;
  }

  function resultOf(record: CompletionRecord | null, code?: FaultCode): Outcome<void> {
    switch (record?.state) {
      case "completed": return ok(undefined);
      case "gone": return fail("stale-binding", record.detail ?? "the native question no longer belongs to this session");
      case "conflict": return fail("ambiguous", record.detail ?? "the native question resolved differently from the gate");
      default: return fail(code ?? "transient", record?.detail ?? "the native completion is pending");
    }
  }

  function settle(row: GateRow, state: CompletionState, detail: string | null, code?: FaultCode): Outcome<void> {
    const q = store();
    q.settle(row.id, state, detail, deps.now());
    const record = q.completion(row.id);
    if (record?.state === "completed" && row.status === "answered") deps.gates.markConsumed(row.id);
    if (record?.state === "conflict" && state === "conflict") {
      deps.log?.warn({ gateId: row.id, detail }, "gate: native question did not take the gate's answer; the gate answer stands");
      deps.emit?.("gate.native-conflict", { gateId: row.id, subject: row.subject, kind: row.kind, detail });
    } else {
      deps.log?.debug({ gateId: row.id, state: record?.state, detail }, "gate: native question completion");
    }
    return resultOf(record, code);
  }

  async function run(gateId: string): Promise<Outcome<void>> {
    if (!deps.enabled()) return fail("unsupported", OFF);
    if (deps.signal?.aborted) return fail("not-ready", STOPPING);
    const question = store().get(gateId);
    if (!question) return fail("invalid", `no native question is bound to gate ${gateId}`);
    const row = deps.gates.get(gateId);
    if (!row) return fail("invalid", `gate ${gateId} no longer exists`);
    if (row.status !== "answered" && row.status !== "closed") return fail("not-ready", `gate ${gateId} is still ${row.status}`);

    const fingerprint = answerFingerprint(row);
    const intent = store().intend(gateId, fingerprint, deps.now());
    if (intent.state !== "pending") return resultOf(intent);
    if (intent.fingerprint !== fingerprint) {
      return settle(row, "conflict", "the gate row no longer matches the one this completion began from");
    }
    if (row.answer) {
      const invalid = validateGateAnswers(row.questions, row.answer.answers);
      if (invalid) return settle(row, "conflict", `the stored answer does not fit the gate's questions: ${invalid}`);
    }

    const session = deps.storedBinding(question.sessionKey);
    if (!session) return settle(row, "gone", "the session that asked has no binding any more");
    if (selfAnswered(row, session)) return settle(row, "completed", "the session that asked answered it");
    if (session.attachment.generation !== question.generation) {
      return settle(row, "gone", `asked under attachment ${question.generation}; the session is now on ${session.attachment.generation}`);
    }
    if (isDetachedAttachment(session)) return settle(row, "pending", "the session is detached", "not-ready");
    const harness = session.native.harness;
    if (!deps.supports(harness)) return settle(row, "gone", `${harness} no longer completes native questions`);

    let adapter: QuestionAdapter | undefined;
    try {
      adapter = await deps.questionsFor(harness);
    } catch (err) {
      return settle(row, "pending", `question completion failed to load: ${messageOf(err)}`, "transient");
    }
    if (!adapter) return settle(row, "gone", `${harness} no longer completes native questions`);
    if (deps.signal?.aborted) return fail("not-ready", STOPPING);

    const native = Promise.resolve()
      .then(() => adapter.complete(session, question, row))
      .catch((err): Outcome<"completed" | "pending" | "gone" | "conflict"> => fail("transient", messageOf(err)));
    const out = await untilAborted(native, deps.signal);
    if (out === ABORTED || deps.signal?.aborted) return fail("not-ready", STOPPING);

    const current = deps.storedBinding(question.sessionKey);
    if (!current || current.attachment.generation !== question.generation) {
      return settle(row, "pending", "the attachment changed while the question was being completed", "stale-binding");
    }
    if (!out.ok) {
      const terminal = out.error.code === "stale-binding" || out.error.code === "unsupported";
      return settle(row, terminal ? "gone" : "pending", `${out.error.code}: ${out.error.message}`, out.error.code);
    }
    return settle(row, out.data, null);
  }

  function completeGateQuestion(gateId: string): Promise<Outcome<void>> {
    const running = inflight.get(gateId);
    if (running) return running;
    const work = run(gateId)
      .catch((err) => fail<void>("transient", messageOf(err)))
      .finally(() => inflight.delete(gateId));
    inflight.set(gateId, work);
    return work;
  }

  /** Reads every question-completing harness's connection; true when one moved to a new live connection. */
  function noteLinks(): boolean {
    let reconnected = false;
    for (const harness of deps.harnesses()) {
      if (!deps.supports(harness)) continue;
      const now = deps.connectionOf(harness);
      if (links.has(harness) && now != null && now !== links.get(harness)) reconnected = true;
      links.set(harness, now);
    }
    return reconnected;
  }

  async function recoverPass(): Promise<{ completed: number; pending: number }> {
    let completed = 0;
    let pending = 0;
    if (!deps.enabled() || deps.signal?.aborted) return { completed, pending };
    noteLinks();
    const q = store();
    q.pruneOrphans();
    for (const gateId of q.recoverable(deps.recoverLimit)) {
      if (deps.signal?.aborted) break;
      await completeGateQuestion(gateId);
      const state = q.completion(gateId)?.state;
      if (state === "completed") completed++;
      else if (state === undefined || state === "pending") pending++;
    }
    return { completed, pending };
  }

  function recoverGateQuestions(): Promise<{ completed: number; pending: number }> {
    if (recovering) {
      recoverAgain = true;
      return recovering;
    }
    recovering = (async () => {
      let result: { completed: number; pending: number };
      do {
        recoverAgain = false;
        result = await recoverPass();
      } while (recoverAgain && !deps.signal?.aborted);
      return result;
    })().finally(() => { recovering = undefined; });
    return track(recovering);
  }

  return {
    bindGateQuestion(binding) {
      if (!deps.enabled()) return fail("unsupported", OFF);
      const problem = bindingProblem(binding);
      if (problem) return fail("invalid", problem);
      const row = deps.gates.get(binding.gateId);
      if (!row) return fail("invalid", `no gate ${binding.gateId}`);
      const unasked = (binding.nativeQuestions ?? []).filter((id) => !row.questions.some((q) => q.id === id));
      if (unasked.length > 0) return fail("invalid", `gate ${row.id} asks no question ${unasked.join(", ")}`);
      const session = deps.storedBinding(binding.sessionKey);
      if (!session) return fail("invalid", "no session binding has that key");
      if (session.attachment.generation !== binding.generation) {
        return fail("stale-binding", `attachment generation ${binding.generation} was replaced; the current one is ${session.attachment.generation}`);
      }
      if (!deps.supports(session.native.harness)) return fail("unsupported", `${session.native.harness} does not complete native questions`);
      const q = store();
      const existing = q.get(binding.gateId);
      if (existing && sameBinding(existing, binding)) return ok(undefined);
      if (existing) {
        // Only a question from an attachment the session has since left may
        // be replaced, and only before any completion began.
        const replaceable = existing.sessionKey === binding.sessionKey && existing.generation < binding.generation
          && q.completion(binding.gateId) === null;
        if (!replaceable) return fail("refused", `gate ${row.id} is already bound to another native question`);
      }
      q.bind(binding, deps.now());
      if (row.status === "answered" || row.status === "closed") void track(completeGateQuestion(row.id));
      return ok(undefined);
    },
    completeGateQuestion,
    recoverGateQuestions,
    async noteConnections() {
      if (deps.signal?.aborted) return;
      if (noteLinks() && deps.enabled()) await recoverGateQuestions();
    },
    completion: (gateId) => store().completion(gateId),
    owns(row) {
      // Bindings exist only where the switch was on, so a gate no harness
      // asked costs one indexed read and never a settings read.
      const question = store().get(row.id);
      if (!question || !deps.enabled()) return false;
      const session = deps.storedBinding(question.sessionKey);
      return session !== null && deps.supports(session.native.harness);
    },
    async settle(row) {
      await track(completeGateQuestion(row.id));
    },
    async idle() {
      while (tracked.size > 0 || inflight.size > 0) {
        await Promise.allSettled([...tracked, ...inflight.values()]);
      }
    },
  };
}

let active: GateQuestions | null = null;

/** Installs the daemon's service behind the module-level verbs below; null removes it. */
export function setGateQuestions(service: GateQuestions | null): void {
  active = service;
}

const NO_SERVICE = "native question completion is not running in this process";

export function bindGateQuestion(binding: QuestionBinding): Outcome<void> {
  return active ? active.bindGateQuestion(binding) : fail("not-ready", NO_SERVICE);
}

export function completeGateQuestion(gateId: string): Promise<Outcome<void>> {
  return active ? active.completeGateQuestion(gateId) : Promise.resolve(fail("not-ready", NO_SERVICE));
}

export function recoverGateQuestions(): Promise<{ completed: number; pending: number }> {
  return active ? active.recoverGateQuestions() : Promise.resolve({ completed: 0, pending: 0 });
}
