/**
 * Codex's synchronous questions (`item/tool/requestUserInput`, asked only in
 * plan mode) presented as authoritative rt gates.
 *
 * Every connection hears that a bound thread is waiting on user input, but
 * only a connection subscribed to the thread receives the request (live-07).
 * So a waiting thread is held, the same `thread/resume` hold a delivery takes,
 * and the held connection gets the pending request replayed. The hold ends
 * when the question resolves, its turn ends or its gate settles, or after the
 * delivery hold's window, so an unanswered question never keeps a thread
 * loaded past its terminal for long (live-04); the thread is held again
 * before an answer is written. Ending it never drops a delivery's hold or a
 * headless keep.
 *
 * Each request opens one gate whose question ids are the native ones, or finds
 * the gate an earlier replay opened for the same thread and item; the binding
 * keeps thread, turn, item and question ids. The request handle lives only
 * here, for this connection: request ids are connection-local, start at 0 and
 * restart with the app server, so none is ever stored or sent again.
 *
 * An answer is written once, on the connection that received the request, and
 * only to a request whose thread, turn, item and question ids match the
 * durable binding; a replacement item is never answered to repair an old one.
 * Neither the write nor `serverRequest/resolved` is completion: resolved also
 * follows an interrupt and another surface's winning answer. Completion is
 * read from the thread's rollout (its function_call_output for the item), and
 * anything missing, unknown or unparseable there leaves it pending.
 *
 * A question Codex asks in default mode arrives as an async agentMessage with
 * no ids: it is announced for a person and never presented as a gate.
 */

import { isAbsolute } from "path";
import type { FaultCode, Outcome, QuestionBinding, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import type { GateAnswer, GateQuestion, GateRow } from "../../../packages/rt-client/src/commands.ts";
import { unwrapGateAnswerValue } from "../../../packages/rt-client/src/gate-answers.ts";
import { gateOptionValue } from "../../../packages/rt-client/src/gate-options.ts";
import { getStateDb } from "../../state/db.ts";
import type { QuestionAdapter } from "../contracts.ts";
import { gateQuestionService, type GateQuestions } from "../questions.ts";
import { createSessionStore, isDetachedAttachment } from "../session-store.ts";
import { integrationsEnabled } from "../switch.ts";
import type { CodexControl } from "./control.ts";
import { codexEventHub } from "./events.ts";
import { isRecord, type CodexEvent, type CodexQuestion, type CodexQuestionRequest, type CodexRequestId } from "./protocol.ts";
import type { CodexSessionAdapter } from "./sessions.ts";

const HARNESS = "codex";

/** The option a free-text answer is given under, on a question that also has options. */
export const OTHER_VALUE = "(other)";
const OTHER_LABEL = "Other";
const OTHER_DESCRIPTION = "Answer in your own words.";

/** Requests remembered per connection; the oldest ended ones go first. */
const KEPT_REQUESTS = 256;
/** Reads of the thread after a hold, waiting for its pending request to be replayed. */
const REPLAY_READS = 10;
const REPLAY_READ_MS = 100;
/** Reads of the rollout after a native-first resolution, which Codex writes moments after it resolves. */
const ROLLOUT_READS = 5;
const ROLLOUT_READ_MS = 200;

export type NativeAnswers = Record<string, { answers: string[] }>;
export type RolloutEvidence =
  | { state: "completed" | "conflict" | "gone" | "pending"; detail: string }
  | { state: "answered"; answers: NativeAnswers; detail: string };

export type CodexQuestionDeps = {
  /** agent.integrations.enabled, read only when a question or a waiting thread arrives. */
  enabled(): boolean;
  /** The session store's binding for the thread, attached or not. */
  bindingOf(threadId: string): SessionBinding | null;
  /** The daemon's gate question service; null where none runs. */
  service(): Pick<GateQuestions, "bindGateQuestion" | "completeGateQuestion" | "native"> | null;
  /** The connection's session adapter, whose holds keep the thread subscribed. Without it nothing is held. */
  sessions?: Pick<CodexSessionAdapter, "hold" | "release" | "paneLive">;
  readRollout(path: string): Promise<string>;
  sleep(ms: number): Promise<void>;
};

export type CodexQuestionAdapter = QuestionAdapter;

/**
 * `dropped`: its gate closed, so rt no longer stands for it and lets the
 * native form answer it alone.
 */
type RequestState = "pending" | "submitted" | "resolved" | "interrupted" | "dropped";
type Request = { event: CodexQuestionRequest; state: RequestState };

const ok = <T>(data: T): Outcome<T> => ({ ok: true, data });
const fail = <T>(code: FaultCode, message: string): Outcome<T> => ({ ok: false, error: { code, message } });
const sameRequestId = (a: CodexRequestId, b: CodexRequestId): boolean => typeof a === typeof b && a === b;

function defaultDeps(control: CodexControl): CodexQuestionDeps {
  return {
    enabled: integrationsEnabled,
    bindingOf: (threadId) => createSessionStore(getStateDb()).find({ harness: HARNESS, profile: control.profile, kind: "id", value: threadId }),
    service: gateQuestionService,
    readRollout: (path) => Bun.file(path).text(),
    sleep: (ms) => Bun.sleep(ms),
  };
}

/** Each native question as a gate question with the same id; free text rides an Other option when the question also offers choices. */
export function gateQuestionsOf(questions: readonly CodexQuestion[]): GateQuestion[] {
  return questions.map((q) => {
    const options = (q.options ?? []).map((o) => ({ value: o.label, label: o.label, ...(o.description !== "" && { description: o.description }) }));
    const other = q.isOther && options.length > 0 && !options.some((o) => o.value === OTHER_VALUE);
    return {
      id: q.id,
      label: q.header ? `${q.header}: ${q.question}` : q.question,
      multi: false,
      options: other ? [...options, { value: OTHER_VALUE, label: OTHER_LABEL, description: OTHER_DESCRIPTION }] : options,
    };
  });
}

const takesFreeText = (q: GateQuestion): boolean =>
  q.options.length === 0 || q.options.some((o) => gateOptionValue(o) === OTHER_VALUE);

const nonBlank = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** The committed gate answer in Codex's reply shape, keyed by the bound question ids. */
export function nativeAnswersOf(row: Pick<GateRow, "questions" | "answer">, ids: readonly string[]): Outcome<NativeAnswers> {
  if (!row.answer) return fail("invalid", "the gate has no answer to send");
  const out: NativeAnswers = {};
  for (const id of ids) {
    const question = row.questions.find((q) => q.id === id);
    const raw = row.answer.answers[id];
    if (!question || raw === undefined) return fail("invalid", `the gate's answer has nothing for question ${id}`);
    const wrapper = isRecord(raw) ? raw : undefined;
    const text = nonBlank(wrapper?.text) ? wrapper.text : undefined;
    const own = text ?? (nonBlank(wrapper?.note) ? wrapper.note : undefined);
    const value = unwrapGateAnswerValue(raw);
    const values: unknown[] = Array.isArray(value) ? value : [value];
    if (!values.every((v) => typeof v === "string")) return fail("invalid", `the answer to ${id} is not text`);
    const free = takesFreeText(question);
    if (free && text !== undefined) {
      out[id] = { answers: [text] };
      continue;
    }
    const answers: string[] = [];
    for (const v of values as string[]) {
      if (v !== OTHER_VALUE || !free) answers.push(v);
      else if (own !== undefined) answers.push(own);
      else return fail("invalid", `the answer to ${id} chose ${OTHER_LABEL} with no text of its own`);
    }
    out[id] = { answers };
  }
  return ok(out);
}

/** A native answer in the gate's shape, so the gate service validates it as it would any answer. */
export function gateAnswersOf(native: NativeAnswers, row: Pick<GateRow, "questions">): Outcome<GateAnswer["answers"]> {
  const answers: GateAnswer["answers"] = {};
  if (Object.keys(native).some((id) => !row.questions.some((q) => q.id === id))) {
    return fail("invalid", "the native answer names a question the gate does not ask");
  }
  for (const q of row.questions) {
    const given = native[q.id]?.answers;
    if (!given || given.length !== 1) return fail("invalid", `the native answer to ${q.id} is not one choice`);
    const value = given[0]!;
    const member = q.options.some((o) => gateOptionValue(o) === value) && value !== OTHER_VALUE;
    if (q.options.length === 0 || member) answers[q.id] = value;
    else if (takesFreeText(q) && nonBlank(value)) answers[q.id] = { value: OTHER_VALUE, text: value };
    else return fail("invalid", `the native answer to ${q.id} is not one of its options`);
  }
  return ok(answers);
}

function answersShape(value: unknown): NativeAnswers | null {
  if (!isRecord(value) || !isRecord(value.answers)) return null;
  const out: NativeAnswers = {};
  for (const [id, answer] of Object.entries(value.answers)) {
    if (!isRecord(answer) || !Array.isArray(answer.answers) || !answer.answers.every((a) => typeof a === "string")) return null;
    out[id] = { answers: [...(answer.answers as string[])] };
  }
  return out;
}

function sameAnswers(a: NativeAnswers, b: NativeAnswers): boolean {
  const ids = Object.keys(a);
  if (ids.length !== Object.keys(b).length) return false;
  return ids.every((id) => {
    const x = a[id]!.answers;
    const y = b[id]?.answers;
    return y !== undefined && x.length === y.length && x.every((v, i) => v === y[i]);
  });
}

/**
 * What the thread's rollout says became of one question: its output for the
 * item compared with `expected`, or with none, the answer it took. Only a
 * function_call_output with exactly this call id counts.
 */
export function rolloutEvidence(text: string, itemId: string, expected: NativeAnswers | null): RolloutEvidence {
  const pending = (detail: string): RolloutEvidence => ({ state: "pending", detail });
  for (const line of text.split("\n")) {
    if (!line.includes(itemId)) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      return pending("the rollout's entry for this question is unreadable");
    }
    if (!isRecord(entry) || entry.type !== "response_item" || !isRecord(entry.payload)) continue;
    const payload = entry.payload;
    if (payload.type !== "function_call_output" || payload.call_id !== itemId) continue;
    if (typeof payload.output !== "string") return pending("the rollout's output for this question has an unknown shape");
    if (payload.output.startsWith("aborted")) return { state: "gone", detail: "the native question was aborted" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload.output);
    } catch {
      return pending("the rollout's output for this question is not an answer");
    }
    const answers = answersShape(parsed);
    if (!answers) return pending("the rollout's output for this question is not an answer");
    if (expected === null) return { state: "answered", answers, detail: "the native question took an answer" };
    return sameAnswers(answers, expected)
      ? { state: "completed", detail: "the native question took the gate's answer" }
      : { state: "conflict", detail: "the native question took a different answer than the gate's" };
  }
  return pending("the rollout has no output for this question yet");
}

/** The durable binding for a request, under the session's current attachment. */
export function bindCodexQuestion(binding: SessionBinding, event: CodexQuestionRequest, gateId: string): Outcome<QuestionBinding> {
  if (binding.native.harness !== HARNESS || binding.native.kind !== "id") {
    return fail("invalid", "only a Codex thread binding asks Codex questions");
  }
  if (binding.native.value !== event.threadId) {
    return fail("stale-binding", `the question belongs to thread ${event.threadId}, not ${binding.native.value}`);
  }
  if (isDetachedAttachment(binding)) return fail("not-ready", "the session is detached");
  if (!event.isBlocking) return fail("unsupported", "a non-blocking request is not a synchronous form");
  if (!gateId) return fail("invalid", "a question binding needs a gate id");
  return ok({
    gateId, sessionKey: binding.key, generation: binding.attachment.generation,
    nativeThread: event.threadId, nativeTurn: event.turnId, nativeItem: event.itemId,
    nativeQuestions: event.questions.map((q) => q.id), presentation: "form",
  });
}

function contextOf(questions: readonly CodexQuestion[]): string {
  return questions.map((q) => [
    q.header ? `${q.header}: ${q.question}` : q.question,
    ...(q.options ?? []).map((o) => (o.description ? `- ${o.label}: ${o.description}` : `- ${o.label}`)),
  ].join("\n")).join("\n\n");
}

export function createCodexQuestions(control: CodexControl, overrides: Partial<CodexQuestionDeps> = {}): CodexQuestionAdapter {
  const deps: CodexQuestionDeps = { ...defaultDeps(control), ...overrides };
  const hub = codexEventHub(control);
  const requests = new Map<string, Request>();
  const presenting = new Map<string, Promise<void>>();
  const holding = new Set<string>();
  /** Gates whose completion runs in `complete` now, so a request event chains another rather than joining it. */
  const completing = new Set<string>();
  const announced = new Set<string>();
  const keyOf = (threadId: string, itemId: string) => `${threadId}\0${itemId}`;
  const holdOf = (threadId: string) => `question:${threadId}`;

  /** The thread's binding while it is attached here, on this connection's profile. */
  function boundSession(threadId: string): SessionBinding | null {
    let binding: SessionBinding | null;
    try {
      binding = deps.bindingOf(threadId);
    } catch {
      return null;
    }
    if (!binding || isDetachedAttachment(binding)) return null;
    const { native } = binding;
    return native.harness === HARNESS && native.kind === "id" && native.profile === control.profile && native.value === threadId
      ? binding : null;
  }

  function remember(key: string, request: Request): void {
    requests.delete(key);
    requests.set(key, request);
    for (const [old, r] of requests) {
      if (requests.size <= KEPT_REQUESTS) return;
      if (r.state !== "pending" && r.state !== "submitted") requests.delete(old);
    }
  }

  const open = (r: Request): boolean => r.state === "pending" || r.state === "submitted";

  async function takeHold(binding: SessionBinding): Promise<void> {
    const threadId = binding.native.value;
    if (!deps.sessions || holding.has(threadId)) return;
    holding.add(threadId);
    try {
      await deps.sessions.hold(binding, holdOf(threadId));
    } catch {
      // A failed hold is no subscription; the completion stays pending and is retried.
    } finally {
      holding.delete(threadId);
    }
  }

  /** Ends the question hold unless a request on the thread still waits here; `force` ends it regardless. */
  function letGo(threadId: string, force = false): void {
    if (!force && [...requests.values()].some((r) => r.event.threadId === threadId && open(r))) return;
    deps.sessions?.release(threadId, holdOf(threadId));
  }

  function kick(service: NonNullable<ReturnType<CodexQuestionDeps["service"]>>, gateId: string): void {
    const running = service.completeGateQuestion(gateId);
    if (completing.has(gateId)) void running.then(() => service.completeGateQuestion(gateId));
  }

  const attention = (detail: Record<string, unknown> & { reason: string }) =>
    deps.service()?.native.attention({ harness: HARNESS, ...detail });

  async function bind(service: NonNullable<ReturnType<CodexQuestionDeps["service"]>>, binding: SessionBinding, event: CodexQuestionRequest, gateId: string) {
    const question = bindCodexQuestion(binding, event, gateId);
    return question.ok ? service.bindGateQuestion(question.data) : question;
  }

  async function openGate(service: NonNullable<ReturnType<CodexQuestionDeps["service"]>>, binding: SessionBinding, event: CodexQuestionRequest) {
    const payload = {
      questions: gateQuestionsOf(event.questions),
      kind: `question:${HARNESS}:${event.threadId}`,
      sessionId: event.threadId,
      context: contextOf(event.questions),
      meta: { label: event.questions[0]?.header || "Codex question", harness: HARNESS, thread: event.threadId, turn: event.turnId, item: event.itemId },
      ...(binding.agentId !== undefined && { agent: binding.agentId }),
    };
    const asked = await service.native.ask(payload);
    if (asked.ok || !asked.error.message.startsWith("no subject")) return asked;
    // A thread with no run or agent record of its own files under its session.
    return service.native.ask({ ...payload, subject: binding.agentId ? `agent:${binding.agentId}` : `${HARNESS}:${event.threadId}` });
  }

  async function presentOnce(binding: SessionBinding, event: CodexQuestionRequest): Promise<void> {
    const service = deps.service();
    if (!service) return;
    const existing = service.native.find(event.threadId, event.itemId);
    if (existing) {
      if (existing.status === "answered" || existing.status === "closed") kick(service, existing.id);
      // An open gate is bound again under the attachment that replayed it; the same binding is a no-op.
      else await bind(service, binding, event, existing.id);
      return;
    }
    const opened = await openGate(service, binding, event);
    if (!opened.ok) {
      attention({ reason: "unpresentable-question", sessionKey: binding.key, threadId: event.threadId, itemId: event.itemId, detail: opened.error.message });
      return;
    }
    const bound = await bind(service, binding, event, opened.data.id);
    if (!bound.ok) {
      // An unbound gate could be answered with nothing to carry the answer to Codex.
      await service.native.close(opened.data.id);
      attention({ reason: "unpresentable-question", sessionKey: binding.key, threadId: event.threadId, itemId: event.itemId, detail: bound.error.message });
    }
  }

  function present(binding: SessionBinding, event: CodexQuestionRequest): Promise<void> {
    const key = keyOf(event.threadId, event.itemId);
    const running = presenting.get(key);
    if (running) return running;
    const work = presentOnce(binding, event).catch(() => undefined).finally(() => presenting.delete(key));
    presenting.set(key, work);
    return work;
  }

  function onRequest(event: CodexQuestionRequest): void {
    if (!event.isBlocking || !deps.enabled()) return;
    const binding = boundSession(event.threadId);
    if (!binding) return;
    const key = keyOf(event.threadId, event.itemId);
    const prior = requests.get(key);
    // A replay of a request this connection already holds keeps what rt did with it.
    if (!prior || !sameRequestId(prior.event.handle.requestId, event.handle.requestId) || prior.event.turnId !== event.turnId) {
      remember(key, { event, state: "pending" });
    }
    if (event.questions.some((q) => q.isSecret)) {
      // A gate stores and shows its answer; a secret stays in the native form.
      attention({ reason: "secret-question", sessionKey: binding.key, threadId: event.threadId, itemId: event.itemId });
      return;
    }
    void present(binding, event);
  }

  async function evidence(threadId: string, itemId: string, expected: NativeAnswers | null): Promise<RolloutEvidence> {
    const pending = (detail: string): RolloutEvidence => ({ state: "pending", detail });
    let path: unknown;
    try {
      const read = await control.request("thread/read", { threadId, includeTurns: false });
      path = isRecord(read) && isRecord(read.thread) ? read.thread.path : undefined;
    } catch {
      return pending("rt could not read the thread");
    }
    if (typeof path !== "string" || !isAbsolute(path) || !path.endsWith(".jsonl")) return pending("Codex named no rollout for the thread");
    let text: string;
    try {
      text = await deps.readRollout(path);
    } catch {
      return pending("the thread's rollout could not be read");
    }
    return rolloutEvidence(text, itemId, expected);
  }

  /** The native side ended a question whose gate is still open: its answer becomes the session's own, an abort closes the gate. */
  async function endedNatively(threadId: string, request: Request, gate: GateRow): Promise<void> {
    const service = deps.service();
    if (!service) return;
    if (request.state === "interrupted") {
      await service.native.close(gate.id);
      return;
    }
    let found: RolloutEvidence = { state: "pending", detail: "" };
    for (let read = 0; read < ROLLOUT_READS; read++) {
      if (read > 0) await deps.sleep(ROLLOUT_READ_MS);
      found = await evidence(threadId, request.event.itemId, null);
      if (found.state !== "pending") break;
    }
    if (found.state === "gone") {
      await service.native.close(gate.id);
      return;
    }
    const answers = found.state === "answered" ? gateAnswersOf(found.answers, gate) : fail<GateAnswer["answers"]>("ambiguous", found.detail);
    const recorded = answers.ok ? await service.native.answer(gate.id, answers.data, threadId) : answers;
    if (!recorded.ok) {
      attention({ reason: "native-answer-unrecorded", gateId: gate.id, threadId, itemId: request.event.itemId, detail: recorded.error.message });
    }
  }

  async function onResolved(threadId: string, requestId: CodexRequestId): Promise<void> {
    const request = [...requests.values()].find((r) => r.event.threadId === threadId && sameRequestId(r.event.handle.requestId, requestId));
    if (!request) return;
    if (request.state !== "interrupted") request.state = "resolved";
    letGo(threadId);
    const service = deps.service();
    const gate = service?.native.find(threadId, request.event.itemId);
    if (!service || !gate) return;
    if (gate.status === "answered" || gate.status === "closed") kick(service, gate.id);
    else await endedNatively(threadId, request, gate);
  }

  function onTurnEnd(threadId: string, turnId: string, status: string): void {
    let ended = false;
    for (const request of requests.values()) {
      if (request.event.threadId !== threadId || request.event.turnId !== turnId) continue;
      if (status === "interrupted" && open(request)) request.state = "interrupted";
      ended = true;
    }
    if (ended) letGo(threadId);
  }

  function onAsync(threadId: string, turnId: string, itemId: string, questions: number): void {
    const key = keyOf(threadId, itemId);
    if (announced.has(key) || !deps.enabled()) return;
    const binding = boundSession(threadId);
    if (!binding) return;
    announced.add(key);
    if (announced.size > KEPT_REQUESTS) announced.delete(announced.values().next().value!);
    attention({ reason: "async-question", sessionKey: binding.key, threadId, turnId, itemId, questions });
  }

  const waitingHere = (threadId: string): boolean => [...requests.values()].some((r) => r.event.threadId === threadId && open(r));

  /** Holds a waiting thread for its replay; a hold that brings no request ends, since nothing else would end it. */
  async function holdWaiting(binding: SessionBinding): Promise<void> {
    const threadId = binding.native.value;
    await takeHold(binding);
    for (let read = 0; read < REPLAY_READS && !waitingHere(threadId); read++) await deps.sleep(REPLAY_READ_MS);
    letGo(threadId);
  }

  hub.watchStatus((threadId, status) => {
    if (status.type !== "active" || !status.activeFlags.includes("waitingOnUserInput")) {
      letGo(threadId);
      return;
    }
    if (!deps.enabled()) return;
    const binding = boundSession(threadId);
    if (binding) void holdWaiting(binding);
  });

  hub.listen((event: CodexEvent) => {
    if (event.connection !== control.connection) return;
    switch (event.method) {
      case "item/tool/requestUserInput":
        onRequest(event);
        return;
      case "serverRequest/resolved":
        void onResolved(event.threadId, event.requestId).catch(() => undefined);
        return;
      case "turn/completed":
        onTurnEnd(event.threadId, event.turnId, event.status);
        return;
      case "item/started":
      case "item/completed":
        if (event.item.type === "agentMessage" && event.item.delivery === "async") {
          onAsync(event.threadId, event.turnId, event.item.id, event.item.questionCount);
        }
        return;
      case "thread/closed":
        for (const [key, request] of requests) if (request.event.threadId === event.threadId) requests.delete(key);
        return;
    }
  });

  /** The request this connection holds for exactly the bound thread, turn, item and question ids. */
  function matching(question: QuestionBinding): Request | null {
    const request = requests.get(keyOf(question.nativeThread!, question.nativeItem!));
    if (!request || request.event.connection !== control.connection || request.event.turnId !== question.nativeTurn) return null;
    const ids = request.event.questions.map((q) => q.id);
    const bound = question.nativeQuestions!;
    return ids.length === bound.length && bound.every((id) => ids.includes(id)) ? request : null;
  }

  /** After a hold, the pending request arrives as a replay just after the resume reply; none means nothing is pending. */
  async function replayed(question: QuestionBinding): Promise<Request | null> {
    for (let read = 0; read < REPLAY_READS; read++) {
      const request = matching(question);
      if (request) return request;
      await deps.sleep(REPLAY_READ_MS);
    }
    return matching(question);
  }

  type Ending = Outcome<"completed" | "pending" | "gone" | "conflict">;
  const settled = (threadId: string, found: RolloutEvidence): Ending => {
    if (found.state === "pending" || found.state === "answered") return ok("pending");
    letGo(threadId);
    return ok(found.state);
  };

  async function answer(binding: SessionBinding, question: QuestionBinding, expected: NativeAnswers): Promise<Ending> {
    const threadId = question.nativeThread!;
    const itemId = question.nativeItem!;
    let request = matching(question);
    if (!request) {
      await takeHold(binding);
      request = await replayed(question);
      if (!request) {
        letGo(threadId);
        return settled(threadId, await evidence(threadId, itemId, expected));
      }
    }
    switch (request.state) {
      case "interrupted":
        letGo(threadId);
        return ok("gone");
      case "submitted":
        return ok("pending");
      case "resolved":
      case "dropped":
        return settled(threadId, await evidence(threadId, itemId, expected));
    }
    // A Herdr thread whose terminal quit can stay loaded, and an answer would run its turn headless (live-04).
    if (binding.attachment.mode === "herdr" && deps.sessions && !(await deps.sessions.paneLive(binding))) {
      letGo(threadId, true);
      return ok("pending");
    }
    // Answered only while held, as every connection that answered in live-07 was subscribed.
    await takeHold(binding);
    if (request.state !== "pending") return ok("pending");
    const sent = control.respond(request.event.handle, expected);
    if (!sent.ok) {
      // The request ended before the write: what it took is in the rollout.
      if (sent.error.code === "stale-binding") return settled(threadId, await evidence(threadId, itemId, expected));
      return sent;
    }
    if (request.state === "pending") {
      request.state = "submitted";
      return ok("pending");
    }
    return settled(threadId, await evidence(threadId, itemId, expected));
  }

  return {
    async complete(binding, question, row) {
      const { nativeThread, nativeTurn, nativeItem, nativeQuestions } = question;
      if (binding.native.harness !== HARNESS || binding.native.profile !== control.profile) {
        return fail("stale-binding", "the question belongs to another harness or Codex profile");
      }
      if (!nativeThread || !nativeTurn || !nativeItem || !nativeQuestions?.length) {
        return fail("unsupported", "the gate was not bound to a Codex question request");
      }
      if (question.gateId !== row.id || question.sessionKey !== binding.key || binding.native.value !== nativeThread
        || question.generation !== binding.attachment.generation) {
        return fail("stale-binding", "the question was asked under another session or attachment");
      }
      if (row.status === "closed") {
        const request = requests.get(keyOf(nativeThread, nativeItem));
        if (request && open(request)) request.state = "dropped";
        letGo(nativeThread);
        return ok("gone");
      }
      if (row.status !== "answered") return fail("not-ready", `gate ${row.id} is still ${row.status}`);
      if (control.closed) return fail("transient", "the Codex control connection is closed");
      const expected = nativeAnswersOf(row, nativeQuestions);
      if (!expected.ok) return expected;
      completing.add(row.id);
      try {
        return await answer(binding, question, expected.data);
      } finally {
        completing.delete(row.id);
      }
    },
  };
}
