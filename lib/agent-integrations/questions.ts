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
 * starts again from the durable binding and the stored row. A completion still
 * pending is retried with backoff, and after MAX_COMPLETION_ATTEMPTS it is
 * marked stuck and announced; the answer stays stored either way.
 *
 * While agent.integrations.enabled is off nothing here makes a native side
 * effect, and a gate no harness asked never causes a settings read: the
 * per-push ownership test and the periodic check each cost one gates.db read.
 */

import type { Database } from "bun:sqlite";
import { createHash } from "crypto";
import type { Logger } from "pino";
import type {
  Capability, FaultCode, Mode, Outcome, QuestionBinding, SessionBinding,
} from "../../packages/rt-client/src/agent-integrations.ts";
import { validateGateAnswers } from "../../packages/rt-client/src/gate-answers.ts";
import type { NativeQuestionSeam } from "../daemon/gate-push.ts";
import { answeredByNudgedPane, type GateRow, type GatesStore } from "../daemon/gates-store.ts";
import { getStateDb } from "../state/db.ts";
import { builtinRegistry } from "./builtins.ts";
import type { IntegrationRegistry, QuestionAdapter } from "./contracts.ts";
import type { CompletionRecord, CompletionState, RetryDue } from "./question-store.ts";
import { createSessionStore, isDetachedAttachment } from "./session-store.ts";
import { integrationsEnabled } from "./switch.ts";

/** Bound gates one recovery pass looks at; the rest wait for the next pass. */
export const RECOVER_LIMIT = 50;
/** A pending completion's first retry waits this long; each later wait doubles, up to RETRY_MAX_MS. */
export const RETRY_BASE_MS = 30_000;
export const RETRY_MAX_MS = 30 * 60_000;
/** Native attempts before a completion that never finishes is marked stuck, about two and a half hours of retries. */
export const MAX_COMPLETION_ATTEMPTS = 8;

export type GateQuestionDeps = {
  gates: Pick<GatesStore, "get" | "markConsumed" | "markDelivery" | "nativeQuestions">;
  /** The session store's binding for a key, attached or not. */
  storedBinding(key: string): SessionBinding | null;
  /** Whether the harness completes native questions, read without loading its code. */
  supports(harness: string): boolean;
  /** What the harness advertises in a mode: owning a question needs question-recovery, a form questions-form too. */
  questionCapabilities(harness: string, mode: Mode): Promise<readonly Capability[]>;
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
  bindGateQuestion(binding: QuestionBinding): Promise<Outcome<void>>;
  /** Completes the gate's native question from the stored row; ok only once it is completed. */
  completeGateQuestion(gateId: string): Promise<Outcome<void>>;
  /** One bounded pass, backoff ignored, over answered or closed bound gates whose completion is missing or pending. */
  recoverGateQuestions(): Promise<{ completed: number; pending: number }>;
  /**
   * The periodic check. With unfinished completions it retries those whose
   * backoff has passed, or all of them after a harness's native connection
   * changed; it reads the switch only when one of those applies.
   */
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

function defaultDeps(db: () => Database, registry: IntegrationRegistry): Omit<GateQuestionDeps, "gates"> {
  return {
    storedBinding: (key) => createSessionStore(db()).get(key),
    supports: (harness) => typeof registry.get(harness)?.loadQuestions === "function",
    questionCapabilities: async (harness, mode) => (await registry.get(harness)?.capabilities(mode))?.supported ?? [],
    questionsFor: async (harness) => registry.get(harness)?.loadQuestions?.(),
    connectionOf: (harness) => registry.get(harness)?.messagingConnection?.(),
    harnesses: () => registry.list().map((integration) => integration.id),
    enabled: integrationsEnabled,
    now: Date.now,
    recoverLimit: RECOVER_LIMIT,
  };
}

export function createGateQuestions(
  overrides: Partial<GateQuestionDeps> & Pick<GateQuestionDeps, "gates"> & { db?: () => Database; registry?: IntegrationRegistry },
): GateQuestions {
  const deps: GateQuestionDeps = {
    ...defaultDeps(overrides.db ?? (() => getStateDb()), overrides.registry ?? builtinRegistry()),
    ...overrides,
  };
  const store = () => deps.gates.nativeQuestions();
  const inflight = new Map<string, Promise<Outcome<void>>>();
  const tracked = new Set<Promise<unknown>>();
  const links = new Map<string, string | null | undefined>();
  let recovering: Promise<{ completed: number; pending: number }> | undefined;
  /** A pass asked for while one runs; `all` outranks `due`. */
  let recoverAgain: "all" | "due" | undefined;

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

  /** Records how this attempt ended; a pending ending on the last allowed attempt becomes stuck. */
  function finish(row: GateRow, state: CompletionState, detail: string | null, code?: FaultCode): Outcome<void> {
    const q = store();
    const attempts = q.completion(row.id)?.attempts ?? 0;
    const giveUp = state === "pending" && attempts >= MAX_COMPLETION_ATTEMPTS;
    const ending: CompletionState = giveUp ? "stuck" : state;
    const said = giveUp ? `gave up after ${attempts} attempts; the last: ${detail ?? "still pending"}` : detail;
    const moved = q.settle(row.id, ending, said, deps.now());
    const record = q.completion(row.id);
    if (record?.state === "completed" && row.status === "answered") deps.gates.markConsumed(row.id);
    if (moved && ending === "conflict") {
      deps.log?.warn({ gateId: row.id, detail: said }, "gate: native question did not take the gate's answer; the gate answer stands");
      deps.emit?.("gate.native-conflict", { gateId: row.id, subject: row.subject, kind: row.kind, detail: said });
    } else if (moved && ending === "stuck") {
      // The board reads a stuck delivery as "answer not delivered", which is
      // what this is; a closed gate has no answer to call undelivered.
      if (row.status === "answered") deps.gates.markDelivery(row.id, "stuck");
      deps.log?.warn({ gateId: row.id, detail: said }, "gate: native question never took the gate's answer; retries stopped");
      deps.emit?.("gate.native-stuck", { gateId: row.id, subject: row.subject, kind: row.kind, detail: said });
    } else {
      deps.log?.debug({ gateId: row.id, state: record?.state, detail: said }, "gate: native question completion");
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
      return finish(row, "conflict", "the gate row no longer matches the one this completion began from");
    }
    if (row.answer) {
      const invalid = validateGateAnswers(row.questions, row.answer.answers);
      if (invalid) return finish(row, "conflict", `the stored answer does not fit the gate's questions: ${invalid}`);
    }

    const session = deps.storedBinding(question.sessionKey);
    if (!session) return finish(row, "gone", "the session that asked has no binding any more");
    if (selfAnswered(row, session)) return finish(row, "completed", "the session that asked answered it");
    if (session.attachment.generation !== question.generation) {
      return finish(row, "gone", `asked under attachment ${question.generation}; the session is now on ${session.attachment.generation}`);
    }
    if (isDetachedAttachment(session)) return finish(row, "pending", "the session is detached", "not-ready");
    const harness = session.native.harness;
    if (!deps.supports(harness)) return finish(row, "gone", `${harness} no longer completes native questions`);

    let adapter: QuestionAdapter | undefined;
    try {
      adapter = await deps.questionsFor(harness);
    } catch (err) {
      return finish(row, "pending", `question completion failed to load: ${messageOf(err)}`, "transient");
    }
    if (!adapter) return finish(row, "gone", `${harness} no longer completes native questions`);
    if (deps.signal?.aborted) return fail("not-ready", STOPPING);

    const native = Promise.resolve()
      .then(() => adapter.complete(session, question, row))
      .catch((err): Outcome<"completed" | "pending" | "gone" | "conflict"> => fail("transient", messageOf(err)));
    const out = await untilAborted(native, deps.signal);
    if (out === ABORTED || deps.signal?.aborted) return fail("not-ready", STOPPING);

    const current = deps.storedBinding(question.sessionKey);
    if (!current || current.attachment.generation !== question.generation) {
      return finish(row, "pending", "the attachment changed while the question was being completed", "stale-binding");
    }
    if (!out.ok) {
      const terminal = out.error.code === "stale-binding" || out.error.code === "unsupported";
      return finish(row, terminal ? "gone" : "pending", `${out.error.code}: ${out.error.message}`, out.error.code);
    }
    return finish(row, out.data, null);
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

  const dueNow = (): RetryDue => ({ now: deps.now(), baseMs: RETRY_BASE_MS, maxMs: RETRY_MAX_MS });

  /** `all` ignores backoff: a start or a reconnect leaves nothing earlier attempts knew about. */
  async function recoverPass(mode: "all" | "due"): Promise<{ completed: number; pending: number }> {
    let completed = 0;
    let pending = 0;
    if (!deps.enabled() || deps.signal?.aborted) return { completed, pending };
    noteLinks();
    const q = store();
    q.pruneOrphans();
    for (const gateId of q.recoverable(deps.recoverLimit, mode === "due" ? dueNow() : undefined)) {
      if (deps.signal?.aborted) break;
      await completeGateQuestion(gateId);
      const state = q.completion(gateId)?.state;
      if (state === "completed") completed++;
      else if (state === undefined || state === "pending") pending++;
    }
    return { completed, pending };
  }

  function recover(mode: "all" | "due"): Promise<{ completed: number; pending: number }> {
    if (recovering) {
      if (mode === "all" || recoverAgain === undefined) recoverAgain = mode;
      return recovering;
    }
    recovering = (async () => {
      let next: "all" | "due" | undefined = mode;
      let result = { completed: 0, pending: 0 };
      while (next && !deps.signal?.aborted) {
        recoverAgain = undefined;
        result = await recoverPass(next);
        next = recoverAgain;
      }
      return result;
    })().finally(() => { recovering = undefined; recoverAgain = undefined; });
    return track(recovering);
  }

  const recoverGateQuestions = () => recover("all");

  /** Everything a binding is checked against without asking the harness: the switch, its shape, the gate and the session's current attachment. */
  function bindable(binding: QuestionBinding): Outcome<SessionBinding> {
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
    if (isDetachedAttachment(session)) return fail("not-ready", "the session is detached; bind once it is attached again");
    if (!deps.supports(session.native.harness)) return fail("unsupported", `${session.native.harness} does not complete native questions`);
    return ok(session);
  }

  return {
    async bindGateQuestion(binding) {
      const checked = bindable(binding);
      if (!checked.ok) return checked;
      const harness = checked.data.native.harness;
      let supported: readonly Capability[];
      try {
        supported = await deps.questionCapabilities(harness, checked.data.attachment.mode);
      } catch (err) {
        return fail("transient", `could not read what ${harness} supports: ${messageOf(err)}`);
      }
      const needed: Capability[] = binding.presentation === "form" ? ["question-recovery", "questions-form"] : ["question-recovery"];
      const missing = needed.filter((capability) => !supported.includes(capability));
      if (missing.length > 0) {
        return fail("unsupported", `${harness} cannot own a native question here: it does not advertise ${missing.join(", ")}`);
      }
      // The capability read awaited, so the gate and the session are checked again.
      const current = bindable(binding);
      if (!current.ok) return current;
      const q = store();
      const existing = q.get(binding.gateId);
      if (existing && sameBinding(existing, binding)) return ok(undefined);
      if (existing) {
        // Only a question from an attachment the session has since left may
        // be replaced, and only before any completion began.
        const replaceable = existing.sessionKey === binding.sessionKey && existing.generation < binding.generation
          && q.completion(binding.gateId) === null;
        if (!replaceable) return fail("refused", `gate ${binding.gateId} is already bound to another native question`);
      }
      q.bind(binding, deps.now());
      const row = deps.gates.get(binding.gateId);
      if (row && (row.status === "answered" || row.status === "closed")) void track(completeGateQuestion(row.id));
      return ok(undefined);
    },
    completeGateQuestion,
    recoverGateQuestions,
    async noteConnections() {
      if (deps.signal?.aborted) return;
      // With nothing unfinished (always the case while the switch has never
      // been on) this one gates.db read is the whole tick.
      const q = store();
      if (q.recoverable(1).length === 0) return;
      const reconnected = noteLinks();
      if (!reconnected && q.recoverable(1, dueNow()).length === 0) return;
      if (!deps.enabled()) return;
      await recover(reconnected ? "all" : "due");
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

export function bindGateQuestion(binding: QuestionBinding): Promise<Outcome<void>> {
  return active ? active.bindGateQuestion(binding) : Promise.resolve(fail("not-ready", NO_SERVICE));
}

export function completeGateQuestion(gateId: string): Promise<Outcome<void>> {
  return active ? active.completeGateQuestion(gateId) : Promise.resolve(fail("not-ready", NO_SERVICE));
}

export function recoverGateQuestions(): Promise<{ completed: number; pending: number }> {
  return active ? active.recoverGateQuestions() : Promise.resolve({ completed: 0, pending: 0 });
}
