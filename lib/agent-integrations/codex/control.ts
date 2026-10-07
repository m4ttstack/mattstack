/**
 * Mattstack's own connection to the already-running Codex app server.
 *
 * A control connection owns a set of native threads: those adopted after a
 * caller checked a session binding, and those its launch reservations
 * created. Only owned-thread events reach subscribers, only allowlisted
 * methods reach the server, and a question can be answered only on the
 * connection that received it. Nothing here starts, restarts or stops the
 * shared native service.
 */

import { isAbsolute } from "path";
import type { FaultCode, Outcome } from "../../../packages/rt-client/src/agent-integrations.ts";
import type { ActiveQuestionHandle } from "../contracts.ts";
import { runCapture, type RunResult } from "../../subprocess.ts";
import {
  CODEX_METHODS, isRecord, isRequestId, nativeThreadOf, parseCodexEvent,
  type CodexEvent, type CodexRequestId, type MethodSpec,
} from "./protocol.ts";

export type CodexSocketHandlers = {
  open(): void;
  message(text: string): void;
  close(): void;
  error(): void;
};
export type CodexSocket = { send(text: string): void; close(): void };
export type CodexSocketFactory = (socketPath: string, handlers: CodexSocketHandlers) => CodexSocket;
export type CodexClock = { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void };
/** Fields are deliberately narrow so a full native message can never be logged. */
export type CodexLogFields = { method?: string; reason?: string; count?: number };
export type CodexControlLog = (level: "debug" | "warn", message: string, fields?: CodexLogFields) => void;
export type CodexControlDeps = {
  openSocket: CodexSocketFactory;
  clock: CodexClock;
  timeoutMs: number;
  log: CodexControlLog;
  clientVersion: string;
};
export type CodexControlOptions = {
  socketPath: string;
  profile: string;
  /** Threads whose bindings the caller already verified, owned before the server can replay them. */
  threads?: readonly string[];
  /** Requests experimentalApi at initialize; the queue methods and experimental fields need it. */
  experimental?: boolean;
};

export type ReservationState = "reserved" | "starting" | "started" | "failed" | "unknown" | "released";
export interface LaunchReservation {
  readonly id: string;
  readonly cwd: string;
  readonly state: ReservationState;
  readonly threadId: string | undefined;
  /** The thread/start result, including one that arrived after its request timed out. */
  readonly result: Record<string, unknown> | undefined;
  release(): void;
}

export interface CodexControl {
  readonly connection: string;
  readonly profile: string;
  readonly experimental: boolean;
  readonly closed: boolean;
  /** The Codex home the app server reported at initialize; its rollouts live under `sessions/` there. */
  readonly codexHome?: string;
  request(method: string, params: unknown): Promise<unknown>;
  /** Events that arrived while nobody was subscribed go to the first subscriber. */
  subscribe(listener: (event: CodexEvent) => void): () => void;
  respond(handle: ActiveQuestionHandle, answers: Record<string, { answers: string[] }>): Outcome<void>;
  adopt(threadId: string): void;
  disown(threadId: string): void;
  /** Whether this connection owns the thread: adopted, or created by one of its active launches. */
  owns(threadId: string): boolean;
  reserveLaunch(cwd: string): Outcome<LaunchReservation>;
  close(): void;
}

export class CodexControlError extends Error {
  constructor(readonly code: FaultCode, message: string, readonly nativeCode?: number) {
    super(message);
    this.name = "CodexControlError";
  }
}

const EARLY_EVENT_LIMIT = 1000;
const HELD_EVENTS_PER_THREAD = 64;

export const openCodexUnixSocket: CodexSocketFactory = (socketPath, handlers) => {
  const ws = new WebSocket(`ws+unix://${socketPath}`);
  ws.onopen = () => handlers.open();
  ws.onmessage = (event) => {
    handlers.message(typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer));
  };
  ws.onclose = () => handlers.close();
  ws.onerror = () => handlers.error();
  return { send: (text) => ws.send(text), close: () => ws.close() };
};

const DEFAULT_DEPS: CodexControlDeps = {
  openSocket: openCodexUnixSocket,
  clock: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (handle) => clearTimeout(handle as Timer) },
  timeoutMs: 25_000,
  log: () => {},
  clientVersion: "0.0.0",
};

const fail = (code: FaultCode, message: string): { ok: false; error: { code: FaultCode; message: string } } =>
  ({ ok: false, error: { code, message } });

type Pending = { method: string; resolve(value: unknown): void; reject(error: Error): void; timer: unknown };
type Settlement = { result?: unknown; error?: unknown };
type Inbound = { threadId: string; turnId: string; itemId: string; questionIds: Set<string> };

class Reservation implements LaunchReservation {
  readonly id = crypto.randomUUID();
  state: ReservationState = "reserved";
  threadId: string | undefined;
  result: Record<string, unknown> | undefined;
  constructor(readonly cwd: string, private readonly onRelease: (reservation: Reservation) => void) {}
  get active(): boolean {
    return this.state === "reserved" || this.state === "starting" || this.state === "started";
  }
  /** An unknown start may still have created a thread, so its cwd stays taken until its owner releases it. */
  get holdsCwd(): boolean {
    return this.active || this.state === "unknown";
  }
  release(): void {
    if (this.state === "released") return;
    this.state = "released";
    this.onRelease(this);
  }
}

const requestKey = (id: CodexRequestId): string => `${typeof id}:${id}`;

function startedThread(result: unknown): string | undefined {
  return isRecord(result) && isRecord(result.thread) && typeof result.thread.id === "string" && result.thread.id
    ? result.thread.id : undefined;
}

class Control implements CodexControl {
  readonly connection = crypto.randomUUID();
  readonly profile: string;
  readonly experimental: boolean;
  codexHome: string | undefined;
  private socket: CodexSocket;
  private isClosed = false;
  private socketClosed = false;
  private seq = 0;
  private opening: { resolve(): void; reject(error: Error): void; timer: unknown } | undefined;
  private readonly pending = new Map<number, Pending>();
  private readonly inbound = new Map<string, Inbound>();
  private readonly adopted = new Set<string>();
  private readonly reservations = new Set<Reservation>();
  private readonly listeners = new Set<(event: CodexEvent) => void>();
  private early: CodexEvent[] = [];
  private readonly held = new Map<string, { reservation: Reservation; messages: Record<string, unknown>[] }>();
  private readonly ambiguous = new Set<string>();
  /** thread/start requests that timed out, kept so their late reply can settle the reservation. */
  private readonly lateStarts = new Map<number, Reservation>();
  private starting = 0;

  constructor(private readonly options: CodexControlOptions, private readonly deps: CodexControlDeps) {
    this.profile = options.profile;
    this.experimental = options.experimental ?? true;
    for (const threadId of options.threads ?? []) this.adopt(threadId);
    this.socket = deps.openSocket(options.socketPath, {
      open: () => this.opened(),
      message: (text) => this.receive(text),
      close: () => this.shutdown(new CodexControlError("transient", "The Codex control connection closed.")),
      error: () => this.shutdown(new CodexControlError("transient", "The Codex control connection failed.")),
    });
  }

  get closed(): boolean {
    return this.isClosed;
  }

  async start(): Promise<void> {
    if (this.isClosed) throw new CodexControlError("transient", "The Codex control connection closed.");
    await new Promise<void>((resolve, reject) => {
      const timer = this.deps.clock.setTimeout(
        () => this.shutdown(new CodexControlError("transient", "Timed out connecting to the Codex app server.")),
        this.deps.timeoutMs,
      );
      this.opening = { resolve, reject, timer };
    });
    const result = await this.call("initialize", {
      clientInfo: { name: "mattstack", version: this.deps.clientVersion },
      capabilities: { experimentalApi: this.experimental },
    });
    if (!isRecord(result) || !["codexHome", "platformFamily", "platformOs", "userAgent"].every((k) => typeof result[k] === "string")) {
      throw new CodexControlError("invalid", "The Codex app server answered initialize with an unexpected shape.");
    }
    this.codexHome = result.codexHome as string;
    this.write({ method: "initialized", params: {} });
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.isClosed) return Promise.reject(new CodexControlError("transient", "The Codex control connection is closed."));
    const admitted = this.admit(method, params);
    if (!admitted.ok) return Promise.reject(new CodexControlError(admitted.error.code, admitted.error.message));
    const { spec, fields, reservation } = admitted.data;
    if (spec.scope !== "create" || !reservation) return this.call(method, fields);
    return this.launch(reservation, fields);
  }

  subscribe(listener: (event: CodexEvent) => void): () => void {
    this.listeners.add(listener);
    for (const event of this.early.splice(0)) this.deliverTo(listener, event);
    return () => {
      this.listeners.delete(listener);
    };
  }

  respond(handle: ActiveQuestionHandle, answers: Record<string, { answers: string[] }>): Outcome<void> {
    if (this.isClosed) return fail("transient", "The Codex control connection is closed.");
    if (handle.connection !== this.connection) {
      return fail("stale-binding", "This question arrived on another Codex control connection.");
    }
    const key = isRequestId(handle.requestId) ? requestKey(handle.requestId) : undefined;
    const request = key === undefined ? undefined : this.inbound.get(key);
    if (!request || request.threadId !== handle.threadId || request.turnId !== handle.turnId || request.itemId !== handle.itemId) {
      return fail("stale-binding", "This question is no longer pending on this connection.");
    }
    if (!this.owns(request.threadId)) return fail("refused", "This connection does not own the question's thread.");
    const result: Record<string, { answers: string[] }> = {};
    for (const [questionId, answer] of Object.entries(isRecord(answers) ? answers : {})) {
      if (!request.questionIds.has(questionId)) return fail("invalid", "An answer names a question this request did not ask.");
      if (!isRecord(answer) || !Array.isArray(answer.answers) || !answer.answers.every((a) => typeof a === "string")) {
        return fail("invalid", "Each answer must be a list of strings.");
      }
      result[questionId] = { answers: [...answer.answers] };
    }
    if (Object.keys(result).length === 0) return fail("invalid", "There are no answers to send.");
    this.inbound.delete(key!);
    try {
      this.write({ id: handle.requestId, result: { answers: result } });
    } catch {
      return fail("transient", "The answer could not be written to the Codex control connection.");
    }
    return { ok: true, data: undefined };
  }

  adopt(threadId: string): void {
    if (typeof threadId === "string" && threadId !== "") this.adopted.add(threadId);
  }

  disown(threadId: string): void {
    this.adopted.delete(threadId);
    this.forget(threadId);
  }

  reserveLaunch(cwd: string): Outcome<LaunchReservation> {
    if (this.isClosed) return fail("transient", "The Codex control connection is closed.");
    if (typeof cwd !== "string" || !isAbsolute(cwd)) return fail("invalid", "A launch needs an absolute working directory.");
    if ([...this.reservations].some((r) => r.holdsCwd && r.cwd === cwd)) {
      return fail("refused", "Another launch already holds this working directory.");
    }
    const reservation = new Reservation(cwd, (released) => {
      this.reservations.delete(released);
      for (const [id, r] of this.lateStarts) if (r === released) this.lateStarts.delete(id);
      if (released.threadId) this.forget(released.threadId);
    });
    this.reservations.add(reservation);
    return { ok: true, data: reservation };
  }

  close(): void {
    this.shutdown(new CodexControlError("transient", "The Codex control connection is closed."));
  }

  owns(threadId: string): boolean {
    if (this.adopted.has(threadId)) return true;
    for (const r of this.reservations) if (r.active && r.threadId === threadId) return true;
    return false;
  }

  private forget(threadId: string): void {
    if (this.owns(threadId)) return;
    this.early = this.early.filter((event) => event.threadId !== threadId);
    for (const [key, request] of this.inbound) if (request.threadId === threadId) this.inbound.delete(key);
  }

  private admit(method: string, params: unknown): Outcome<{
    spec: MethodSpec; fields: Record<string, unknown>; reservation?: Reservation;
  }> {
    const spec = Object.hasOwn(CODEX_METHODS, method) ? CODEX_METHODS[method] : undefined;
    if (!spec) return fail("refused", `${method} is not a method Mattstack may call on Codex.`);
    if (params !== undefined && !isRecord(params)) return fail("invalid", `${method} takes an object of parameters.`);
    const fields = { ...(params ?? {}) };
    if (spec.experimental && !this.experimental) {
      return fail("unsupported", `${method} needs the experimental Codex API, which this connection did not negotiate.`);
    }
    for (const key of Object.keys(fields)) {
      if (!spec.fields.includes(key)) return fail("unsupported", `${method} does not accept ${key} here.`);
      if (!this.experimental && spec.experimentalFields.includes(key)) {
        return fail("unsupported", `${method}.${key} needs the experimental Codex API, which this connection did not negotiate.`);
      }
    }
    for (const key of spec.required) {
      if (fields[key] === undefined || fields[key] === null) return fail("invalid", `${method} needs ${key}.`);
    }
    for (const key of ["threadId", "cwd", "clientUserMessageId"]) {
      if (key in fields && (typeof fields[key] !== "string" || fields[key] === "")) {
        return fail("invalid", `${method}.${key} must be a non-empty string.`);
      }
    }
    if ("input" in fields && !Array.isArray(fields.input)) return fail("invalid", `${method}.input must be a list.`);
    if ("threadId" in fields && !this.owns(fields.threadId as string)) {
      return fail("refused", `${method} names a thread this connection does not own.`);
    }
    if (spec.scope !== "create") return { ok: true, data: { spec, fields } };
    const reservation = [...this.reservations].find((r) => r.state === "reserved" && r.cwd === fields.cwd);
    if (!reservation) return fail("refused", `${method} needs an unused launch reservation for its working directory.`);
    return { ok: true, data: { spec, fields, reservation } };
  }

  private async launch(reservation: Reservation, fields: Record<string, unknown>): Promise<unknown> {
    reservation.state = "starting";
    this.starting++;
    try {
      const result = await this.call("thread/start", fields, (id) => this.lateStarts.set(id, reservation));
      const threadId = startedThread(result);
      if (!threadId) {
        if (reservation.state === "starting") reservation.state = "unknown";
        throw new CodexControlError("invalid", "Codex answered thread/start without a thread id.");
      }
      const announced = this.held.get(threadId);
      this.dropHeld(reservation);
      if (reservation.state === "starting") {
        reservation.state = "started";
        reservation.threadId = threadId;
        reservation.result = result as Record<string, unknown>;
        if (announced?.reservation === reservation) for (const message of announced.messages) this.accept(message);
      }
      return result;
    } catch (error) {
      this.dropHeld(reservation);
      if (reservation.state === "starting") {
        reservation.state = error instanceof CodexControlError && error.code === "refused" ? "failed" : "unknown";
      }
      throw error;
    } finally {
      this.starting--;
      if (this.starting === 0) {
        this.held.clear();
        this.ambiguous.clear();
      }
    }
  }

  private dropHeld(reservation: Reservation): void {
    for (const [threadId, entry] of this.held) if (entry.reservation === reservation) this.held.delete(threadId);
  }

  /**
   * A new thread can announce itself before its thread/start reply names it.
   * Only a thread/started whose cwd matches exactly one in-flight reservation
   * admits its id; nothing else about an unowned thread is retained.
   */
  private hold(threadId: string, message: Record<string, unknown>): void {
    const entry = this.held.get(threadId);
    if (entry) {
      if (entry.messages.length < HELD_EVENTS_PER_THREAD) entry.messages.push(message);
      return;
    }
    if (message.method !== "thread/started") return;
    const params = message.params as Record<string, unknown>;
    const cwd = isRecord(params.thread) ? params.thread.cwd : undefined;
    if (typeof cwd !== "string") return;
    const matches = [...this.reservations].filter((r) => r.state === "starting" && r.cwd === cwd);
    if (matches.length === 1) {
      this.held.set(threadId, { reservation: matches[0]!, messages: [message] });
    } else if (matches.length > 1 && !this.ambiguous.has(threadId)) {
      this.ambiguous.add(threadId);
      this.deps.log("warn", "Ignored a new Codex thread that matches more than one launch.", { count: matches.length });
    }
  }

  private call(method: string, params: Record<string, unknown>, onTimeout?: (id: number) => void): Promise<unknown> {
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      const timer = this.deps.clock.setTimeout(() => {
        this.pending.delete(id);
        onTimeout?.(id);
        reject(new CodexControlError("transient", `${method} timed out.`));
      }, this.deps.timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      try {
        this.write({ id, method, params });
      } catch {
        this.deps.clock.clearTimeout(timer);
        this.pending.delete(id);
        reject(new CodexControlError("transient", `${method} could not be written to the Codex control connection.`));
      }
    });
  }

  private write(message: unknown): void {
    if (this.isClosed) throw new CodexControlError("transient", "The Codex control connection is closed.");
    this.socket.send(JSON.stringify(message));
  }

  private opened(): void {
    const opening = this.opening;
    if (!opening) return;
    this.opening = undefined;
    this.deps.clock.clearTimeout(opening.timer);
    opening.resolve();
  }

  private receive(text: string): void {
    if (this.isClosed) return;
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      this.deps.log("warn", "Dropped a Codex message that is not JSON.");
      return;
    }
    if (!isRecord(message)) {
      this.deps.log("warn", "Dropped a Codex message that is not an object.");
      return;
    }
    if (message.method === undefined) {
      this.settle(message);
      return;
    }
    if (typeof message.method !== "string") {
      this.deps.log("warn", "Dropped a Codex message with a malformed method.");
      return;
    }
    const threadId = nativeThreadOf(message);
    if (threadId === undefined) return;
    if (this.owns(threadId)) {
      this.accept(message);
      return;
    }
    if (this.starting > 0) this.hold(threadId, message);
  }

  private settle(message: Record<string, unknown>): void {
    const id = message.id;
    const pending = typeof id === "number" ? this.pending.get(id) : undefined;
    if (!pending) {
      const late = typeof id === "number" ? this.lateStarts.get(id) : undefined;
      if (late) {
        this.lateStarts.delete(id as number);
        this.reconcile(late, message);
        return;
      }
      this.deps.log("debug", "Dropped a Codex response with no pending request.");
      return;
    }
    this.pending.delete(id as number);
    this.deps.clock.clearTimeout(pending.timer);
    if (isRecord(message.error)) {
      const nativeCode = typeof message.error.code === "number" ? message.error.code : undefined;
      const reason = typeof message.error.message === "string" ? message.error.message : "no reason given";
      pending.reject(new CodexControlError("refused", `Codex refused ${pending.method}: ${reason}`, nativeCode));
    } else if ("result" in message) {
      pending.resolve(message.result);
    } else {
      this.deps.log("warn", "Dropped a malformed Codex response.", { method: pending.method });
      pending.reject(new CodexControlError("invalid", `Codex answered ${pending.method} with neither a result nor an error.`));
    }
  }

  /** A late thread/start reply is the native answer to that launch: it names the thread, or proves none was created. */
  private reconcile(reservation: Reservation, message: Settlement): void {
    if (reservation.state !== "unknown") return;
    const threadId = isRecord(message.error) ? undefined : startedThread(message.result);
    if (isRecord(message.error)) {
      reservation.state = "failed";
    } else if (threadId) {
      reservation.state = "started";
      reservation.threadId = threadId;
      reservation.result = message.result as Record<string, unknown>;
    } else {
      this.deps.log("warn", "A late Codex thread/start reply named no thread.");
    }
  }

  private accept(message: Record<string, unknown>): void {
    const parsed = parseCodexEvent(message, this.connection);
    if (parsed.kind === "ignored") return;
    if (parsed.kind === "malformed") {
      this.deps.log("warn", "Dropped a malformed Codex event.", { method: message.method as string, reason: parsed.reason });
      return;
    }
    const event = parsed.event;
    if (event.method === "item/tool/requestUserInput") {
      this.inbound.set(requestKey(event.handle.requestId), {
        threadId: event.threadId, turnId: event.turnId, itemId: event.itemId,
        questionIds: new Set(event.questions.map((q) => q.id)),
      });
    } else if (event.method === "serverRequest/resolved") {
      const key = requestKey(event.requestId);
      if (this.inbound.get(key)?.threadId === event.threadId) this.inbound.delete(key);
    }
    if (this.listeners.size === 0) {
      this.early.push(event);
      if (this.early.length > EARLY_EVENT_LIMIT) {
        this.early.shift();
        this.deps.log("warn", "Dropped the oldest unread Codex event.", { count: EARLY_EVENT_LIMIT });
      }
      return;
    }
    for (const listener of [...this.listeners]) this.deliverTo(listener, event);
  }

  private deliverTo(listener: (event: CodexEvent) => void, event: CodexEvent): void {
    try {
      listener(event);
    } catch {
      this.deps.log("warn", "A Codex event listener threw.", { method: event.method });
    }
  }

  private shutdown(error: CodexControlError): void {
    if (this.isClosed) return;
    this.isClosed = true;
    if (this.opening) {
      this.deps.clock.clearTimeout(this.opening.timer);
      this.opening.reject(error);
      this.opening = undefined;
    }
    for (const pending of this.pending.values()) {
      this.deps.clock.clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.inbound.clear();
    this.early = [];
    this.held.clear();
    this.ambiguous.clear();
    this.lateStarts.clear();
    for (const r of this.reservations) if (r.state === "starting") r.state = "unknown";
    if (!this.socketClosed) {
      this.socketClosed = true;
      try {
        this.socket.close();
      } catch {
        this.deps.log("debug", "The Codex socket was already closed.");
      }
    }
  }
}

export async function connectCodexControl(
  options: CodexControlOptions,
  deps: Partial<CodexControlDeps> = {},
): Promise<CodexControl> {
  let control: Control;
  try {
    control = new Control(options, { ...DEFAULT_DEPS, ...deps });
  } catch {
    throw new CodexControlError("transient", "Could not open the Codex control socket.");
  }
  try {
    await control.start();
    return control;
  } catch (error) {
    control.close();
    throw error;
  }
}

export type CodexEndpoint = { socketPath: string };
type Runner = (argv: [string, ...string[]], opts?: { timeoutMs?: number; env?: Record<string, string | undefined> }) =>
  Promise<RunResult>;

/** Reads where the running native app server listens. It never starts one. */
export async function discoverCodexEndpoint(
  deps: { run?: Runner; env?: Record<string, string | undefined> } = {},
): Promise<Outcome<CodexEndpoint>> {
  const run = deps.run ?? runCapture;
  const result = await run(["codex", "app-server", "daemon", "version"], { timeoutMs: 10_000, env: deps.env });
  if (result.exitCode !== 0) return fail("not-ready", "Codex could not report its app server.");
  let status: unknown;
  try {
    status = JSON.parse(result.stdout);
  } catch {
    return fail("not-ready", "Codex reported its app server in a form Mattstack does not recognise.");
  }
  if (!isRecord(status) || status.status !== "running") return fail("not-ready", "The Codex app server is not running.");
  if (typeof status.socketPath !== "string" || !isAbsolute(status.socketPath)) {
    return fail("not-ready", "The Codex app server did not report its control socket.");
  }
  return { ok: true, data: { socketPath: status.socketPath } };
}
