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
 * keeps thread, turn, item and question ids. A gate opens only under a subject
 * an answering surface lists; any other question is left to the native form,
 * with an attention condition. The request handle lives only
 * here, for this connection: request ids are connection-local, start at 0 and
 * restart with the app server, so none is ever stored or sent again.
 *
 * An answer is written once, on the connection that received the request, and
 * only to a request whose thread, turn, item and question ids match the
 * durable binding; a replacement item is never answered to repair an old one.
 * Neither the write nor `serverRequest/resolved` is completion: resolved also
 * follows an interrupt and another surface's winning answer. Completion is
 * read from the thread's rollout (its function_call_output for the item), and
 * anything missing, unknown or unparseable there leaves it pending. A
 * connection whose hold lapsed hears only status changes, so a status without
 * the wait ends its open requests, and nothing is written unless the rollout
 * was read and holds no output for the item.
 *
 * A question Codex asks in default mode arrives as an async agentMessage with
 * no ids: it is announced for a person and never presented as a gate.
 */

import { open } from "fs/promises";
import { isAbsolute, join, resolve, sep } from "path";
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

/**
 * Free text rides an option's note: `Other` beside a question's own choices,
 * `Answer` as the one option of a question that offers none, since the
 * answering surfaces show no question without options.
 */
export const OTHER_VALUE = "(other)";
export const ANSWER_VALUE = "(answer)";
const FREE_TEXT: Readonly<Record<string, string>> = { [OTHER_VALUE]: "Other", [ANSWER_VALUE]: "Answer" };
const FREE_TEXT_DESCRIPTION = "Write your answer in the note.";

/** A rollout is read from its end in chunks of this size, and never more than ROLLOUT_MAX_BYTES of it. */
const ROLLOUT_CHUNK_BYTES = 64 * 1024;
const ROLLOUT_MAX_BYTES = 16 * 1024 * 1024;

/** Refusals of a gate that cannot open later; any other refusal is retried at the next replay, up to MAX_PRESENT_ATTEMPTS. */
const UNLISTED: ReadonlySet<string> = new Set(["no-subject", "unlisted-subject"]);
export const MAX_PRESENT_ATTEMPTS = 3;
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
  /** `absent`: the rollout was read and holds no output for the item, the one pending reading that permits a write. */
  | { state: "completed" | "conflict" | "gone" | "pending"; detail: string; absent?: true }
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
  /** The rollout's whole lines from its end back to the item's output, or as far as the byte cap allows. */
  readRollout(path: string, itemId: string): Promise<RolloutTail>;
  sleep(ms: number): Promise<void>;
};

export type CodexQuestionAdapter = QuestionAdapter;

/**
 * `dropped`: its gate closed, so rt no longer stands for it and lets the
 * native form answer it alone.
 */
type RequestState = "pending" | "submitted" | "resolved" | "interrupted" | "dropped";
/** `ended`: the native side finished with it (resolved, or a status without the wait), and that was acted on once. */
type Request = { event: CodexQuestionRequest; state: RequestState; ended?: boolean };

const ok = <T>(data: T): Outcome<T> => ({ ok: true, data });
const fail = <T>(code: FaultCode, message: string): Outcome<T> => ({ ok: false, error: { code, message } });
const sameRequestId = (a: CodexRequestId, b: CodexRequestId): boolean => typeof a === typeof b && a === b;

function defaultDeps(control: CodexControl): CodexQuestionDeps {
  return {
    enabled: integrationsEnabled,
    bindingOf: (threadId) => createSessionStore(getStateDb()).find({ harness: HARNESS, profile: control.profile, kind: "id", value: threadId }),
    service: gateQuestionService,
    readRollout: (path, itemId) => readRolloutTail(path, itemId),
    sleep: (ms) => Bun.sleep(ms),
  };
}

/** Whether `lines`, which starts at a line start, holds a line naming both the item and a function_call_output. */
function holdsOutputLine(lines: Buffer, id: Buffer, marker: Buffer): boolean {
  for (let at = lines.indexOf(id); at !== -1; at = lines.indexOf(id, at + id.length)) {
    const lineStart = lines.lastIndexOf(0x0a, at) + 1;
    const lineEnd = lines.indexOf(0x0a, at);
    const found = lines.indexOf(marker, lineStart);
    if (found !== -1 && (lineEnd === -1 || found < lineEnd)) return true;
  }
  return false;
}

/**
 * A rollout's whole lines from its end back to the item's output line, or as
 * far as the byte cap allowed. `whole` is true only when the read reached the
 * start of the file, so an output missing from `text` is missing from the file.
 */
export type RolloutTail = { text: string; whole: boolean };

/**
 * Reads a rollout backward from its end, a chunk at a time, until it holds
 * the item's output line or `maxBytes` were read. Each chunk is scanned once,
 * with only the partial line it completes carried over, and lines are split
 * at newline bytes, which never fall inside a multibyte character. The file
 * is opened read-only and never written.
 */
export async function readRolloutTail(
  path: string, itemId: string, opts: { chunkBytes?: number; maxBytes?: number } = {},
): Promise<RolloutTail> {
  const chunkBytes = opts.chunkBytes ?? ROLLOUT_CHUNK_BYTES;
  const maxBytes = opts.maxBytes ?? ROLLOUT_MAX_BYTES;
  const id = Buffer.from(itemId);
  const marker = Buffer.from("function_call_output");
  const file = await open(path, "r");
  try {
    const { size } = await file.stat();
    const floor = Math.max(0, size - maxBytes);
    let start = size;
    /** Whole lines read so far, the latest in the file first. */
    const lines: Buffer[] = [];
    /** The bytes before the first newline read so far: a line whose start is not read yet. */
    let partial = Buffer.alloc(0);
    while (start > floor) {
      const from = Math.max(floor, start - chunkBytes);
      const chunk = Buffer.alloc(start - from);
      const { bytesRead } = await file.read(chunk, 0, chunk.length, from);
      start = from;
      const span = Buffer.concat([chunk.subarray(0, bytesRead), partial]);
      const firstBreak = span.indexOf(0x0a);
      const completed = start === 0 ? span : firstBreak === -1 ? Buffer.alloc(0) : span.subarray(firstBreak + 1);
      partial = start === 0 ? Buffer.alloc(0) : firstBreak === -1 ? span : span.subarray(0, firstBreak + 1);
      if (completed.length > 0) lines.push(completed);
      if (holdsOutputLine(completed, id, marker)) break;
    }
    return { text: Buffer.concat(lines.reverse()).toString("utf8"), whole: start === 0 };
  } finally {
    await file.close();
  }
}

/** Only a JSONL file under the Codex home's own `sessions/` is read as a rollout. */
function rolloutPathOf(path: unknown, codexHome: string | undefined): string | null {
  if (typeof path !== "string" || !codexHome || !isAbsolute(path) || !isAbsolute(codexHome) || !path.endsWith(".jsonl")) return null;
  const resolved = resolve(path);
  return resolved.startsWith(join(resolve(codexHome), "sessions") + sep) ? resolved : null;
}

/** Each native question as a gate question with the same id; free text rides the note of an Other or Answer option. */
export function gateQuestionsOf(questions: readonly CodexQuestion[]): GateQuestion[] {
  const freeText = (value: string) => ({ value, label: FREE_TEXT[value]!, description: FREE_TEXT_DESCRIPTION });
  return questions.map((q) => {
    const options = (q.options ?? []).map((o) => ({ value: o.label, label: o.label, ...(o.description !== "" && { description: o.description }) }));
    const other = q.isOther && !options.some((o) => o.value === OTHER_VALUE);
    return {
      id: q.id,
      label: q.header ? `${q.header}: ${q.question}` : q.question,
      multi: false,
      options: options.length === 0 ? [freeText(ANSWER_VALUE)] : other ? [...options, freeText(OTHER_VALUE)] : options,
    };
  });
}

/** The question's free-text option, Answer or Other, when it has one. */
const freeTextOf = (q: GateQuestion): string | undefined =>
  q.options.map(gateOptionValue).find((value) => Object.hasOwn(FREE_TEXT, value));

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
    const own = nonBlank(wrapper?.note) ? wrapper.note : nonBlank(wrapper?.text) ? wrapper.text : undefined;
    const value = unwrapGateAnswerValue(raw);
    const values: unknown[] = Array.isArray(value) ? value : [value];
    if (!values.every((v) => typeof v === "string")) return fail("invalid", `the answer to ${id} is not text`);
    const free = freeTextOf(question);
    const answers: string[] = [];
    for (const v of values as string[]) {
      if (v !== free) answers.push(v);
      else if (own !== undefined) answers.push(own);
      else return fail("invalid", `the answer to ${id} chose ${FREE_TEXT[v]} with nothing in its note`);
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
    const free = freeTextOf(q);
    if (value !== free && q.options.some((o) => gateOptionValue(o) === value)) answers[q.id] = value;
    else if (free !== undefined && nonBlank(value)) answers[q.id] = { value: free, note: value };
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
 * function_call_output with exactly this call id counts. With `whole` false
 * the text is only the tail rt read, so an output missing from it is unknown,
 * never absent.
 */
export function rolloutEvidence(text: string, itemId: string, expected: NativeAnswers | null, whole = true): RolloutEvidence {
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
  return whole
    ? { state: "pending", detail: "the rollout has no output for this question yet", absent: true }
    : { state: "pending", detail: "the part of the rollout rt read holds no output for this question" };
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
  /** Refused presentations per request, by thread and item. */
  const presentTries = new Map<string, number>();
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
      if (r.state !== "pending" && r.state !== "submitted") {
        requests.delete(old);
        presentTries.delete(old);
      }
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

  /**
   * Opens the gate only under a subject an answering surface lists, or one
   * its owner subscribes to; anywhere else no one would see it, and the
   * native form is the only place the question can be answered.
   */
  function openGate(service: NonNullable<ReturnType<CodexQuestionDeps["service"]>>, binding: SessionBinding, event: CodexQuestionRequest) {
    return service.native.ask({
      questions: gateQuestionsOf(event.questions),
      kind: `question:${HARNESS}:${event.threadId}`,
      sessionId: event.threadId,
      requireListedSubject: true,
      context: contextOf(event.questions),
      meta: { label: event.questions[0]?.header || "Codex question", harness: HARNESS, thread: event.threadId, turn: event.turnId, item: event.itemId },
      ...(binding.agentId !== undefined && { agent: binding.agentId }),
    });
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
    const key = keyOf(event.threadId, event.itemId);
    const opened = await openGate(service, binding, event);
    if (!opened.ok) {
      const failure = opened.error.failure;
      const tries = (presentTries.get(key) ?? 0) + 1;
      presentTries.set(key, tries);
      // Only a subject no surface lists is final; anything else is tried again at the next replay, up to the cap.
      if ((failure !== undefined && UNLISTED.has(failure)) || tries >= MAX_PRESENT_ATTEMPTS) {
        leaveToNative(binding, event, failure !== undefined && UNLISTED.has(failure) ? failure : "unpresentable-question", opened.error.message);
      }
      return;
    }
    presentTries.delete(key);
    const bound = await bind(service, binding, event, opened.data.id);
    if (!bound.ok) {
      // An unbound gate could be answered with nothing to carry the answer to Codex.
      await service.native.close(opened.data.id);
      leaveToNative(binding, event, "unpresentable-question", bound.error.message);
    }
  }

  /** A question rt does not present is the native form's alone: rt asks for a person and stops holding its thread. */
  function leaveToNative(binding: SessionBinding, event: CodexQuestionRequest, reason: string, detail?: string): void {
    const request = requests.get(keyOf(event.threadId, event.itemId));
    if (request && open(request)) request.state = "dropped";
    letGo(event.threadId);
    attention({ reason, sessionKey: binding.key, threadId: event.threadId, itemId: event.itemId, ...(detail !== undefined && { detail }) });
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
    const replay = prior !== undefined && sameRequestId(prior.event.handle.requestId, event.handle.requestId) && prior.event.turnId === event.turnId;
    if (replay && prior.state === "dropped") return;
    if (!replay) remember(key, { event, state: "pending" });
    if (event.questions.some((q) => q.isSecret)) {
      // A gate stores and shows its answer; a secret stays in the native form.
      leaveToNative(binding, event, "secret-question");
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
    const rollout = rolloutPathOf(path, control.codexHome);
    if (!rollout) return pending("Codex named no rollout under its sessions for the thread");
    let tail: RolloutTail;
    try {
      tail = await deps.readRollout(rollout, itemId);
    } catch {
      return pending("the thread's rollout could not be read");
    }
    return rolloutEvidence(tail.text, itemId, expected, tail.whole);
  }

  /** The rollout is written moments after a question resolves, so a pending reading is taken again a few times. */
  async function settledEvidence(threadId: string, itemId: string, expected: NativeAnswers | null): Promise<RolloutEvidence> {
    let found = await evidence(threadId, itemId, expected);
    for (let read = 1; read < ROLLOUT_READS && found.state === "pending"; read++) {
      await deps.sleep(ROLLOUT_READ_MS);
      found = await evidence(threadId, itemId, expected);
    }
    return found;
  }

  /** The native side ended a question whose gate is still open: its answer becomes the session's own, an abort closes the gate. */
  async function endedNatively(threadId: string, request: Request, gate: GateRow): Promise<void> {
    const service = deps.service();
    if (!service) return;
    if (request.state === "interrupted") {
      await service.native.close(gate.id);
      return;
    }
    const found = await settledEvidence(threadId, request.event.itemId, null);
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

  function onResolved(threadId: string, requestId: CodexRequestId): void {
    const request = [...requests.values()].find((r) => r.event.threadId === threadId && sameRequestId(r.event.handle.requestId, requestId));
    if (request) void ended(request).catch(() => undefined);
  }

  /**
   * The native side is done with a request: resolved reached this connection,
   * or a status without the wait did, which is all an unsubscribed connection
   * hears (live-07). Acted on once, however many of those arrive.
   */
  async function ended(request: Request): Promise<void> {
    if (request.ended || !deps.enabled()) return;
    request.ended = true;
    const threadId = request.event.threadId;
    if (open(request)) request.state = "resolved";
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
      for (const request of [...requests.values()]) {
        if (request.event.threadId === threadId && (open(request) || request.state === "interrupted")) void ended(request).catch(() => undefined);
      }
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
        onResolved(event.threadId, event.requestId);
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
        for (const [key, request] of requests) if (request.event.threadId === event.threadId) {
          requests.delete(key);
          presentTries.delete(key);
        }
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
        return settled(threadId, await settledEvidence(threadId, itemId, expected));
      }
    }
    switch (request.state) {
      case "interrupted":
        letGo(threadId);
        return ok("gone");
      case "resolved":
      case "dropped":
        return settled(threadId, await settledEvidence(threadId, itemId, expected));
    }
    // A connection whose hold lapsed hears neither resolved nor the turn's end
    // (live-07), so a request that looks pending here may have taken an answer
    // already: the rollout is read before anything is written.
    const before = await evidence(threadId, itemId, expected);
    if (before.state !== "pending") {
      request.state = "resolved";
      request.ended = true;
      return settled(threadId, before);
    }
    if (request.state === "submitted" || !before.absent) return ok("pending");
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
      if (sent.error.code === "stale-binding") return settled(threadId, await settledEvidence(threadId, itemId, expected));
      return sent;
    }
    if (request.state === "pending") {
      request.state = "submitted";
      return ok("pending");
    }
    return settled(threadId, await settledEvidence(threadId, itemId, expected));
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
      if (!expected.ok) {
        // No retry can send it: the gate's answer stands, and the native form waits for a person.
        const request = requests.get(keyOf(nativeThread, nativeItem));
        if (request && open(request)) request.state = "dropped";
        letGo(nativeThread);
        attention({ reason: "unsendable-answer", gateId: row.id, threadId: nativeThread, itemId: nativeItem, detail: expected.error.message });
        return ok("conflict");
      }
      completing.add(row.id);
      try {
        return await answer(binding, question, expected.data);
      } finally {
        completing.delete(row.id);
      }
    },
  };
}
