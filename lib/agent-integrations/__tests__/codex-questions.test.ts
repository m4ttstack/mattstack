import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import pino from "pino";
import type { SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import type { EventsBus } from "../../daemon/events-bus.ts";
import { createGatePush } from "../../daemon/gate-push.ts";
import { createGatesStore, type GateRow, type GatesStore } from "../../daemon/gates-store.ts";
import { createGateHandlers } from "../../daemon/handlers/gate.ts";
import type { GateSubjectResult } from "../../daemon/gate-subject.ts";
import {
  connectCodexControl, type CodexClock, type CodexControl, type CodexSocket, type CodexSocketHandlers,
} from "../codex/control.ts";
import { codexIntegration } from "../codex/integration.ts";
import {
  ANSWER_VALUE, asyncQuestionsOf, bindCodexQuestion, createCodexQuestions, gateQuestionsOf, MAX_PRESENT_ATTEMPTS, MAX_UNSEEN_RECHECKS, nativeAnswersOf,
  OTHER_VALUE, readRolloutLastTurn, readRolloutTail, rolloutEvidence, turnEndedOf, type CodexQuestionAdapter,
} from "../codex/questions.ts";
import {
  CODEX_EVIDENCE_OUTSIDE_PROTOCOL, CODEX_METHODS, CODEX_PROTOCOL_VERSION, CODEX_SERVER_REQUEST_REPLIES, type CodexQuestionRequest,
} from "../codex/protocol.ts";
import { createCodexSessions, type CodexSessionAdapter } from "../codex/sessions.ts";
import { nudgedQuestion } from "../claude/questions.ts";
import { createGateQuestions, GATE_QUESTIONS_CLIENT, gateCommandsVia, type GateCommands, type GateQuestions } from "../questions.ts";

type Message = Record<string, any>;
const log = pino({ level: "silent" });
const FIXTURES = join(import.meta.dir, "fixtures", "codex");
const ROLLOUT = readFileSync(join(FIXTURES, "rollout-questions-0.160.x.jsonl"), "utf8");
const TRUNCATED = readFileSync(join(FIXTURES, "rollout-truncated-0.160.x.jsonl"), "utf8");
/** call_ids from the live-07 rollouts the fixture was copied from. */
const CASE_M = "call_nEDoFz4S1riVZi3M1WA1a4H1";
const CASE_B3 = "call_1jXcuNc55voPBAAAM1qRKQta";
const CASE_I = "call_jClvAddqd3BAOARJaCFVTFTO";
const CASE_D = "call_0ByJeuPNz9tJEJJj9PCzEX29";
const CODEX_HOME = "/redacted/.codex";
/** Where 0.160.x keeps a thread's rollout (live-07 thread-read-while-pending.txt). */
const rolloutPath = (threadId: string) => `${CODEX_HOME}/sessions/2026/10/07/rollout-2026-10-07T08-52-20-${threadId}.jsonl`;

class FakeClock implements CodexClock {
  private seq = 0;
  private timers = new Map<number, () => void>();
  setTimeout(fn: () => void): unknown {
    const id = ++this.seq;
    this.timers.set(id, fn);
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }
  /** Every pending window passes. */
  lapse(): void {
    for (const [id, fn] of [...this.timers]) {
      this.timers.delete(id);
      fn();
    }
  }
}

/** live-07 0.160.x: the shapes one question takes on the wire. */
const PICK = [{ id: "pick", header: "Pick", question: "Which option do you choose?", isOther: true, isSecret: false,
  options: [{ label: "A", description: "Choose A." }, { label: "B", description: "Choose B." }] }];
const COLOR_SIZE = [
  { id: "color", header: "Color", question: "Which color do you choose?", isOther: true, isSecret: false,
    options: [{ label: "Red", description: "Choose Red." }, { label: "Blue", description: "Choose Blue." }] },
  { id: "size", header: "Size", question: "Which size do you choose?", isOther: true, isSecret: false,
    options: [{ label: "Small", description: "Choose Small." }, { label: "Large", description: "Choose Large." }] },
];

type Pending = { id: number; params: Message };

/**
 * One Codex app server across connections: request ids are its own, start at
 * 0 and restart at 0 with it; a connection that resumes a thread with a
 * pending question gets it replayed right after the resume reply.
 */
class FakeAppServer {
  nextId = 0;
  pending = new Map<string, Pending>();
  rollout = "";
  /** Rollout contents for the next reads, oldest first; `rollout` once it runs out. */
  rolloutQueue: string[] = [];
  /** False stands for a read that stopped at its byte cap before the start of the file. */
  rolloutWhole = true;
  sockets: FakeSocket[] = [];
  /** Answers each connection wrote, in order. */
  replies: Array<{ socket: FakeSocket; message: Message }> = [];
  resolveOnReply = true;
  status: Message = { type: "active", activeFlags: ["waitingOnUserInput"] };
  pathFor: (threadId: string) => string = rolloutPath;
  /** A status thread replies report instead of the current one, as a reply that lags the change would. */
  replyStatus: Message | undefined;
  /** How many thread/read requests still fail, as a busy app server's would. */
  readFailures = 0;
  /** How many more thread/read requests succeed before every later one fails; null never. */
  readsBeforeFailure: number | null = null;
  /** The thread's turns as thread/turns/list pages them, newest first; null answers with an error. */
  turns: Message[] | null = null;

  restart(): void {
    this.nextId = 0;
    for (const s of this.sockets) s.handlers.close();
    for (const [thread, p] of this.pending) this.pending.set(thread, { ...p, id: this.nextId++ });
  }

  ask(threadId: string, turnId: string, itemId: string, questions: Message[]): number {
    const id = this.nextId++;
    const params = { threadId, turnId, itemId, questions, isBlocking: true, autoResolutionMs: null };
    this.pending.set(threadId, { id, params });
    this.setStatus(threadId, { type: "active", activeFlags: ["waitingOnUserInput"] });
    for (const s of this.subscribers(threadId)) s.push({ method: "item/tool/requestUserInput", id, params });
    return id;
  }

  /** Every connection hears a status; `quiet` stands for one that has not reached rt yet. */
  setStatus(threadId: string, status: Message, quiet = false): void {
    this.status = status;
    if (!quiet) for (const s of this.live()) s.push({ method: "thread/status/changed", params: { threadId, status } });
  }

  /** live-07: resolved reaches subscribed connections only; the status change reaches every one. */
  resolve(threadId: string, opts: { quiet?: boolean; status?: Message } = {}): void {
    const p = this.pending.get(threadId);
    if (!p) return;
    this.pending.delete(threadId);
    for (const s of this.subscribers(threadId)) s.push({ method: "serverRequest/resolved", params: { threadId, requestId: p.id } });
    this.setStatus(threadId, opts.status ?? { type: "active", activeFlags: [] }, opts.quiet);
  }

  interrupt(threadId: string, turnId: string): void {
    for (const s of this.subscribers(threadId)) {
      s.push({ method: "turn/completed", params: { threadId, turn: { id: turnId, items: [], status: "interrupted" } } });
    }
    this.resolve(threadId, { status: { type: "idle" } });
  }

  subscribers(threadId: string): FakeSocket[] {
    return this.live().filter((s) => s.subscribed.has(threadId));
  }

  live(): FakeSocket[] {
    return this.sockets.filter((s) => !s.closed);
  }

  handle(s: FakeSocket, m: Message): void {
    if (m.method === "initialize") {
      s.push({ id: m.id, result: { codexHome: CODEX_HOME, platformFamily: "unix", platformOs: "macos", userAgent: "t" } });
      return;
    }
    if (m.method === undefined) {
      this.replies.push({ socket: s, message: m });
      const owner = [...this.pending].find(([, p]) => p.id === m.id);
      if (owner && this.resolveOnReply) this.resolve(owner[0]);
      return;
    }
    const threadId = m.params?.threadId;
    switch (m.method) {
      case "thread/read":
        if (this.readFailures > 0 || this.readsBeforeFailure === 0) {
          if (this.readFailures > 0) this.readFailures--;
          s.push({ id: m.id, error: { code: -32000, message: "the app server is busy" } });
          return;
        }
        if (this.readsBeforeFailure !== null) this.readsBeforeFailure--;
        s.push({ id: m.id, result: { thread: { id: threadId, status: this.replyStatus ?? this.status, path: this.pathFor(threadId), turns: [] } } });
        return;
      case "thread/turns/list":
        if (this.turns === null) {
          s.push({ id: m.id, error: { code: -32000, message: "the app server is busy" } });
          return;
        }
        s.push({ id: m.id, result: { data: this.turns, nextCursor: null, backwardsCursor: null } });
        return;
      case "thread/resume": {
        s.subscribed.add(threadId);
        s.push({ id: m.id, result: { thread: { id: threadId, status: this.replyStatus ?? this.status, path: this.pathFor(threadId) } } });
        const p = this.pending.get(threadId);
        if (p) s.push({ method: "item/tool/requestUserInput", id: p.id, params: p.params });
        return;
      }
      case "thread/unsubscribe":
        s.subscribed.delete(threadId);
        s.push({ id: m.id, result: { status: "unsubscribed" } });
        return;
      default:
        s.push({ id: m.id, error: { code: -32601, message: "not in this fake" } });
    }
  }
}

class FakeSocket implements CodexSocket {
  sent: Message[] = [];
  closed = false;
  subscribed = new Set<string>();
  constructor(readonly handlers: CodexSocketHandlers, private readonly server: FakeAppServer) {}
  send(text: string): void {
    if (this.closed) throw new Error("socket is closed");
    const message = JSON.parse(text);
    this.sent.push(message);
    this.server.handle(this, message);
  }
  close(): void {
    this.closed = true;
  }
  push(message: Message): void {
    if (!this.closed) this.handlers.message(JSON.stringify(message));
  }
}

const dirs: string[] = [];
const controls: CodexControl[] = [];
afterEach(() => {
  for (const c of controls.splice(0)) c.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function codexBinding(over: Partial<SessionBinding> = {}, attachment: Partial<SessionBinding["attachment"]> = {}): SessionBinding {
  return {
    key: "s1", identity: "remy.ab12", agentId: "agent-1",
    native: { harness: "codex", profile: "default", kind: "id", value: "T1" },
    attachment: { generation: 1, mode: "herdr", pane: "p1", ...attachment }, ...over,
  };
}

async function settled(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

/** A session in a running pipeline run: the subject Console and the board list. */
const RUN_SUBJECT: GateSubjectResult = { ok: true, subject: "run:r1", runId: "r1" };

async function world(opts: { enabled?: boolean; mode?: "herdr" | "headless"; paneRuns?: boolean; subject?: GateSubjectResult } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "rt-codex-questions-"));
  dirs.push(dir);
  const server = new FakeAppServer();
  const switchOn = { value: opts.enabled ?? true };
  const pane = { runs: opts.paneRuns ?? true };
  const sessions = new Map<string, SessionBinding>([["s1", codexBinding({}, { mode: opts.mode ?? "herdr", ...(opts.mode === "headless" && { pane: undefined }) })]]);
  const store: GatesStore = createGatesStore({ dbPath: join(dir, "gates.db"), log });
  const emitted: Array<{ topic: string; payload: Record<string, unknown> }> = [];
  let current: { control: CodexControl; sessions: CodexSessionAdapter; questions: CodexQuestionAdapter; clock: FakeClock } | undefined;
  let pushes = 0;
  const handlersRef: { h?: ReturnType<typeof createGateHandlers> } = {};
  const commands: GateCommands = gateCommandsVia((cmd, payload) =>
    (handlersRef.h as unknown as Record<string, (p: unknown) => Promise<{ ok: true; data?: unknown } | { ok: false; error?: unknown }>>)[cmd]!(payload));
  const service: GateQuestions = createGateQuestions({
    gates: store,
    storedBinding: (key) => sessions.get(key) ?? null,
    supports: (harness) => harness === "codex",
    questionCapabilities: async (harness, mode) => (await codexIntegration.capabilities(mode)).supported.filter(() => harness === "codex"),
    questionsFor: async () => current?.questions,
    connectionOf: () => current?.control.connection ?? null,
    harnesses: () => ["codex"],
    enabled: () => switchOn.value,
    commands,
    emit: (topic, payload) => { emitted.push({ topic, payload }); },
    log,
  });
  const push = createGatePush({
    store, log, native: service,
    deliver: async () => { pushes++; return { ok: true as const }; },
    resolveSession: (id) => ({ socketPath: id }),
  });
  let nextEvent = 1;
  const subjectFor = opts.subject ?? RUN_SUBJECT;
  handlersRef.h = createGateHandlers(store, { emitAt: () => nextEvent++ } as unknown as EventsBus, () => {}, {
    push, log,
    resolveSubject: (args) => (args.subject ? { ok: true, subject: args.subject } : args.sessionId === "T1" ? subjectFor
      : { ok: false, error: "no subject: pass --subject, or run under a recorded run/agent session" }),
  });
  /** Every rollout read, tail and last-turn alike; `tailReads` the tail reads alone. */
  const reads: string[] = [];
  const tailReads: string[] = [];
  let bindingReads = 0;
  const warned: Array<{ message: string; context: Record<string, unknown> }> = [];

  async function connect(): Promise<NonNullable<typeof current>> {
    const clock = new FakeClock();
    const control = await connectCodexControl({ socketPath: "/run/codex.sock", profile: "default" }, {
      clock, timeoutMs: 1000, log: () => {},
      openSocket: (_path, h) => {
        const socket = new FakeSocket(h, server);
        server.sockets.push(socket);
        queueMicrotask(() => h.open());
        return socket;
      },
    });
    controls.push(control);
    const adapter = createCodexSessions(control, {
      clock, now: () => 42, enabled: () => switchOn.value, lifecycle: async () => false,
      paneRuns: async () => pane.runs, unresolved: new Map(), inFlight: new Set(),
    });
    const questions = createCodexQuestions(control, {
      enabled: () => switchOn.value,
      bindingOf: (threadId) => {
        bindingReads++;
        return [...sessions.values()].find((b) => b.native.value === threadId) ?? null;
      },
      service: () => service,
      sessions: adapter,
      readRollout: async (path) => {
        reads.push(path);
        tailReads.push(path);
        return { text: server.rolloutQueue.shift() ?? server.rollout, whole: server.rolloutWhole };
      },
      readLastTurn: async (path) => {
        reads.push(path);
        return { text: server.rollout, whole: server.rolloutWhole };
      },
      sleep: async () => {},
      warn: (message, context) => {
        warned.push({ message, context });
      },
    });
    // The poller's observe owns bound threads on a new connection.
    control.adopt("T1");
    current = { control, sessions: adapter, questions, clock };
    return current;
  }

  const socket = () => server.sockets.at(-1)!;
  const sent = (s = socket()) => s.sent;
  const answersSent = (s = socket()) => sent(s).filter((m) => m.method === undefined && "result" in m);
  const gates = () => store.list({}).gates;
  return {
    server, store, service, sessions, switchOn, pane, emitted, connect, socket, sent, answersSent, gates, reads, tailReads, warned,
    handlers: () => handlersRef.h!, pushes: () => pushes, bindingReads: () => bindingReads,
    current: () => current!,
  };
}

const answerGate = (w: Awaited<ReturnType<typeof world>>, id: string, answers: Record<string, unknown>) =>
  w.handlers()["gate:answer"]({ id, answers: answers as NonNullable<GateRow["answer"]>["answers"], by: "console" });

describe("codex question routing", () => {
  test("a waitingOnUserInput status takes a question hold, which replays the request and opens one bound gate", async () => {
    const w = await world();
    const c = await w.connect();
    w.server.ask("T1", "U1", "I1", PICK);
    await settled();

    expect(w.sent().filter((m) => m.method === "thread/resume")).toEqual([
      expect.objectContaining({ params: { threadId: "T1", excludeTurns: true } }),
    ]);
    const [gate] = w.gates();
    expect(gate).toMatchObject({ status: "open", kind: "question:codex:T1" });
    expect(gate!.questions).toEqual([{
      id: "pick", label: "Pick: Which option do you choose?", multi: false,
      options: [
        { value: "A", label: "A", description: "Choose A." },
        { value: "B", label: "B", description: "Choose B." },
        { value: OTHER_VALUE, label: "Other", description: "Write your answer in the note." },
      ],
    }]);
    expect(w.store.nativeQuestions().get(gate!.id)).toEqual({
      gateId: gate!.id, sessionKey: "s1", generation: 1,
      nativeThread: "T1", nativeTurn: "U1", nativeItem: "I1", nativeQuestions: ["pick"], presentation: "form",
    });
    expect(c.sessions.held("T1", "question:T1")).toBe(true);

    // A second replay of the same request reuses the open gate.
    w.server.status = { type: "active", activeFlags: ["waitingOnUserInput"] };
    w.socket().push({ method: "item/tool/requestUserInput", id: 0, params: w.server.pending.get("T1")!.params });
    await settled();
    expect(w.gates()).toHaveLength(1);
  });

  test("request zero is valid", async () => {
    const w = await world();
    await w.connect();
    expect(w.server.ask("T1", "U1", "I1", PICK)).toBe(0);
    await settled();
    const [gate] = w.gates();
    expect((await answerGate(w, gate!.id, { pick: "B" })).ok).toBe(true);
    await settled();

    expect(w.answersSent()).toEqual([{ id: 0, result: { answers: { pick: { answers: ["B"] } } } }]);
  });

  test("multiple answers preserve IDs", async () => {
    const w = await world();
    await w.connect();
    w.server.ask("T1", "U1", CASE_M, COLOR_SIZE);
    await settled();
    const [gate] = w.gates();
    expect((await answerGate(w, gate!.id, { color: "Red", size: { value: OTHER_VALUE, text: "Medium-ish" } })).ok).toBe(true);
    await settled();

    expect(w.answersSent()).toEqual([
      { id: 0, result: { answers: { color: { answers: ["Red"] }, size: { answers: ["Medium-ish"] } } } },
    ]);
    // The rollout live-07 recorded for exactly this answer is the completion evidence.
    w.server.rollout = ROLLOUT;
    await w.service.completeGateQuestion(gate!.id);
    expect(w.service.completion(gate!.id)?.state).toBe("completed");
    expect(w.store.get(gate!.id)!.consumedAt).not.toBeNull();
  });

  test("cancelled gate sends no answer", async () => {
    const w = await world();
    const c = await w.connect();
    w.server.ask("T1", "U1", "I1", PICK);
    await settled();
    const [gate] = w.gates();
    expect((await w.handlers()["gate:close"]({ id: gate!.id, reason: "abandoned" })).ok).toBe(true);
    await settled();

    expect(w.answersSent()).toEqual([]);
    expect(w.service.completion(gate!.id)?.state).toBe("gone");
    expect(w.store.get(gate!.id)!.answer).toBeNull();
    expect(c.sessions.held("T1", "question:T1")).toBe(false);
  });

  test("reconnect answers replay, never stale request", async () => {
    const w = await world();
    await w.connect();
    w.server.ask("T1", "U1", "I1", PICK);
    await settled();
    const first = w.socket();
    const [gate] = w.gates();

    // The app server self-updates: every connection drops and ids restart at 0.
    w.server.restart();
    w.server.pending.set("T1", { id: 3, params: w.server.pending.get("T1")!.params });
    w.server.nextId = 4;
    expect((await answerGate(w, gate!.id, { pick: "A" })).ok).toBe(true);
    await settled();
    expect(w.answersSent(first)).toEqual([]);
    expect(w.service.completion(gate!.id)?.state).toBe("pending");

    // The new connection learns of the wait by reading the thread, holds it,
    // and answers only the replay that matches thread, turn, item and questions.
    await w.connect();
    w.server.resolveOnReply = false;
    await w.service.completeGateQuestion(gate!.id);
    await settled();
    expect(w.answersSent()).toEqual([{ id: 3, result: { answers: { pick: { answers: ["A"] } } } }]);
    expect(w.answersSent(first)).toEqual([]);
    expect(w.gates()).toHaveLength(1);
  });

  test("a replacement item on the new connection never takes the old gate's answer", async () => {
    const w = await world();
    await w.connect();
    w.server.ask("T1", "U1", "I1", PICK);
    await settled();
    const [gate] = w.gates();
    w.server.restart();
    w.server.pending.set("T1", { id: 0, params: { ...w.server.pending.get("T1")!.params, turnId: "U2", itemId: "I2" } });
    w.server.nextId = 1;
    expect((await answerGate(w, gate!.id, { pick: "A" })).ok).toBe(true);
    await settled();
    await w.connect();
    await w.service.completeGateQuestion(gate!.id);
    await settled();

    expect(w.answersSent()).toEqual([]);
    expect(w.service.completion(gate!.id)?.state).toBe("pending");
    // The replacement is its own question with its own gate.
    expect(w.gates().map((g) => g.status)).toEqual(["answered", "open"]);
  });

  test("numeric id reused on another connection refuses", async () => {
    const w = await world();
    const a = await w.connect();
    w.server.ask("T1", "U1", "I1", PICK);
    await settled();
    const b = await w.connect();
    const stale = { connection: a.control.connection, requestId: 0, threadId: "T1", turnId: "U1", itemId: "I1" };
    const refused = b.control.respond(stale, { pick: { answers: ["A"] } });
    expect(refused).toEqual({ ok: false, error: { code: "stale-binding", message: expect.any(String) } });
    // Same numeric id, same thread, but this connection never received it.
    const forged = { ...stale, connection: b.control.connection };
    expect(b.control.respond(forged, { pick: { answers: ["A"] } }).ok).toBe(false);
    expect(w.answersSent()).toEqual([]);
  });
});

describe("codex question completion evidence", () => {
  test("native resolution is not proof of winning answer", async () => {
    const w = await world();
    await w.connect();
    w.server.ask("T1", "U1", CASE_B3, PICK);
    await settled();
    const [gate] = w.gates();
    // The TUI's B lands first; the server still resolves the request after our A.
    w.server.rollout = "";
    expect((await answerGate(w, gate!.id, { pick: "A" })).ok).toBe(true);
    await settled();
    expect(w.answersSent()).toEqual([{ id: 0, result: { answers: { pick: { answers: ["A"] } } } }]);
    expect(w.service.completion(gate!.id)?.state).toBe("pending");

    w.server.rollout = ROLLOUT;
    await w.service.completeGateQuestion(gate!.id);
    expect(w.service.completion(gate!.id)?.state).toBe("conflict");
    expect(w.store.get(gate!.id)!.answer?.answers).toEqual({ pick: "A" });
    expect(w.emitted.map((e) => e.topic)).toContain("gate.native-conflict");
  });

  test("an interrupted turn ends the question gone, and an open gate for it closes", async () => {
    const w = await world();
    const c = await w.connect();
    w.server.ask("T1", "U1", "I1", PICK);
    await settled();
    const [gate] = w.gates();
    w.server.interrupt("T1", "U1");
    await settled();
    expect(w.store.get(gate!.id)).toMatchObject({ status: "closed", answer: null });
    expect(w.answersSent()).toEqual([]);
    expect(c.sessions.held("T1", "question:T1")).toBe(false);
  });

  test("an interrupt after the gate was answered settles gone, never completed", async () => {
    const w = await world();
    await w.connect();
    w.server.resolveOnReply = false;
    w.server.ask("T1", "U1", "I1", PICK);
    await settled();
    const [gate] = w.gates();
    expect((await answerGate(w, gate!.id, { pick: "A" })).ok).toBe(true);
    await settled();
    w.server.interrupt("T1", "U1");
    await settled();
    expect(w.service.completion(gate!.id)?.state).toBe("gone");
  });

  test("the native TUI answering an open gate first records its answer as the session's own", async () => {
    const w = await world();
    await w.connect();
    w.server.ask("T1", "U1", CASE_M, COLOR_SIZE);
    await settled();
    const [gate] = w.gates();
    w.server.rollout = ROLLOUT;
    w.server.resolve("T1");
    await settled();
    const row = w.store.get(gate!.id)!;
    expect(row.status).toBe("answered");
    expect(row.answer).toMatchObject({ answers: { color: "Red", size: { value: OTHER_VALUE, note: "Medium-ish" } }, session: "T1" });
    expect(w.service.completion(gate!.id)?.state).toBe("completed");
    expect(w.answersSent()).toEqual([]);
  });

  test("rollout evidence: same answers complete, different conflict, aborted is gone, anything else pending", () => {
    const same = { color: { answers: ["Red"] }, size: { answers: ["Medium-ish"] } };
    expect(rolloutEvidence(ROLLOUT, CASE_M, same).state).toBe("completed");
    expect(rolloutEvidence(ROLLOUT, CASE_M, { color: { answers: ["Blue"] }, size: { answers: ["Medium-ish"] } }).state).toBe("conflict");
    expect(rolloutEvidence(ROLLOUT, CASE_B3, { pick: { answers: ["A"] } }).state).toBe("conflict");
    expect(rolloutEvidence(ROLLOUT, CASE_I, { pick: { answers: ["A"] } }).state).toBe("gone");
    expect(rolloutEvidence(ROLLOUT, CASE_D, { pick: { answers: ["A"] } }).state).toBe("pending");
    expect(rolloutEvidence(ROLLOUT, "call_missing", { pick: { answers: ["A"] } }).state).toBe("pending");
    expect(rolloutEvidence(TRUNCATED, CASE_I, { pick: { answers: ["A"] } }).state).toBe("pending");
    expect(rolloutEvidence("", CASE_M, same).state).toBe("pending");
    expect(rolloutEvidence(ROLLOUT, CASE_M, null)).toMatchObject({ state: "answered", answers: same });
  });

  test("an unreadable rollout leaves the completion pending", async () => {
    const w = await world();
    await w.connect();
    w.server.ask("T1", "U1", CASE_I, PICK);
    await settled();
    const [gate] = w.gates();
    w.server.rollout = TRUNCATED;
    expect((await answerGate(w, gate!.id, { pick: "A" })).ok).toBe(true);
    await settled();
    await w.service.completeGateQuestion(gate!.id);
    expect(w.service.completion(gate!.id)?.state).toBe("pending");
  });
});

describe("codex question holds", () => {
  test("releasing the question hold keeps a delivery hold's subscription", async () => {
    const w = await world();
    const c = await w.connect();
    expect((await c.sessions.hold(codexBinding(), "delivery-1")).ok).toBe(true);
    w.server.ask("T1", "U1", "I1", PICK);
    await settled();
    expect(c.sessions.held("T1", "question:T1")).toBe(true);
    w.server.resolve("T1");
    await settled();
    expect(c.sessions.held("T1", "question:T1")).toBe(false);
    expect(c.sessions.held("T1", "delivery-1")).toBe(true);
    expect(w.sent().filter((m) => m.method === "thread/unsubscribe")).toEqual([]);
  });

  test("an unanswered question's hold lapses with the delivery window, and the thread is held again to answer it", async () => {
    const w = await world();
    const c = await w.connect();
    w.server.ask("T1", "U1", "I1", PICK);
    await settled();
    c.clock.lapse();
    expect(c.sessions.held("T1", "question:T1")).toBe(false);
    expect(w.sent().filter((m) => m.method === "thread/unsubscribe")).toHaveLength(1);

    const [gate] = w.gates();
    expect((await answerGate(w, gate!.id, { pick: "B" })).ok).toBe(true);
    await settled();
    expect(w.sent().filter((m) => m.method === "thread/resume")).toHaveLength(2);
    expect(w.answersSent()).toEqual([{ id: 0, result: { answers: { pick: { answers: ["B"] } } } }]);
  });

  test("a waiting status with nothing to replay ends its hold at once", async () => {
    const w = await world();
    const c = await w.connect();
    w.socket().push({ method: "thread/status/changed", params: { threadId: "T1", status: { type: "active", activeFlags: ["waitingOnUserInput"] } } });
    await settled();
    expect(w.sent().filter((m) => m.method === "thread/resume")).toHaveLength(1);
    expect(c.sessions.held("T1", "question:T1")).toBe(false);
    expect(w.sent().filter((m) => m.method === "thread/unsubscribe")).toHaveLength(1);
    expect(w.gates()).toEqual([]);
  });

  test("a headless thread stays subscribed after its question resolves", async () => {
    const w = await world({ mode: "headless" });
    const c = await w.connect();
    expect((await c.sessions.keep(w.sessions.get("s1")!)).ok).toBe(true);
    w.server.ask("T1", "U1", "I1", PICK);
    await settled();
    w.server.resolve("T1");
    await settled();
    expect(w.sent().filter((m) => m.method === "thread/unsubscribe")).toEqual([]);
    expect(w.sent().filter((m) => m.method === "thread/resume")).toHaveLength(1);
  });

  test("a Herdr question whose pane no longer runs codex is not answered", async () => {
    const w = await world({ paneRuns: false });
    await w.connect();
    w.server.ask("T1", "U1", "I1", PICK);
    await settled();
    const [gate] = w.gates();
    expect((await answerGate(w, gate!.id, { pick: "A" })).ok).toBe(true);
    await settled();
    expect(w.answersSent()).toEqual([]);
    expect(w.service.completion(gate!.id)?.state).toBe("pending");
  });
});

describe("codex async questions and the switch", () => {
  test("an async agentMessage question raises attention and is never an answered gate", async () => {
    const w = await world();
    await w.connect();
    const item = { type: "agentMessage", id: "call_TKpNExLkPNGamVFqWmPqfrsB", text: "Which option do you choose?\n- A\n- B",
      phase: "final_answer", memoryCitation: null, delivery: "async", questions: [{ title: "Which option do you choose?", options: ["A", "B"] }] };
    w.socket().push({ method: "item/started", params: { item, threadId: "T1", turnId: "U9" } });
    w.socket().push({ method: "item/completed", params: { item, threadId: "T1", turnId: "U9" } });
    await settled();

    expect(w.gates()).toEqual([]);
    expect(w.emitted.filter((e) => e.topic === "gate.native-attention")).toEqual([{
      topic: "gate.native-attention",
      payload: expect.objectContaining({ reason: "async-question", harness: "codex", threadId: "T1", turnId: "U9", itemId: item.id, questions: 1 }),
    }]);
    expect(w.sent().filter((m) => m.method !== "initialize" && m.method !== "initialized")).toEqual([]);
  });

  test("with the switch off nothing holds, opens, binds or answers", async () => {
    const w = await world();
    await w.connect();
    w.switchOn.value = false;
    w.server.ask("T1", "U1", "I1", PICK);
    w.socket().push({ method: "item/tool/requestUserInput", id: 0, params: w.server.pending.get("T1")!.params });
    await settled();
    expect(w.gates()).toEqual([]);
    expect(w.sent().filter((m) => m.method !== "initialize" && m.method !== "initialized")).toEqual([]);
    expect(w.emitted).toEqual([]);
  });

  test("Codex declares synchronous forms and recovery in both modes, never async questions", async () => {
    for (const mode of ["herdr", "headless"] as const) {
      const { supported } = await codexIntegration.capabilities(mode);
      expect(supported).toEqual(expect.arrayContaining(["questions-form", "question-recovery"]));
      expect(supported).not.toContain("questions-async");
    }
    expect(typeof codexIntegration.loadQuestions).toBe("function");
  });
});

describe("codex question protocol", () => {
  const schema = JSON.parse(readFileSync(join(FIXTURES, `app-server-protocol-${CODEX_PROTOCOL_VERSION}.json`), "utf8"));

  test("the answer reply and the rollout path are in the saved schema; the rollout line is recorded outside it", () => {
    for (const [method, fields] of Object.entries(CODEX_SERVER_REQUEST_REPLIES)) {
      expect(schema.serverRequests[method], method).toBeDefined();
      expect(schema.serverRequests[method].response.properties).toEqual([...fields]);
    }
    expect(schema.types.Thread.properties).toContain("path");
    expect(schema.serverNotifications["serverRequest/resolved"].params.properties).toEqual(expect.arrayContaining(["threadId", "requestId"]));
    expect(Object.keys(CODEX_EVIDENCE_OUTSIDE_PROTOCOL)).toEqual(["rollout function_call_output"]);
    expect(Object.keys(CODEX_METHODS)).not.toContain("item/tool/requestUserInput");
  });
});

describe("codex question translation", () => {
  const request = (over: Partial<CodexQuestionRequest> = {}): CodexQuestionRequest => ({
    method: "item/tool/requestUserInput", connection: "c1", threadId: "T1", turnId: "U1", itemId: "I1", isBlocking: true,
    questions: COLOR_SIZE.map((q) => ({ ...q })),
    handle: { connection: "c1", requestId: 0, threadId: "T1", turnId: "U1", itemId: "I1" }, ...over,
  });

  test("bindCodexQuestion persists thread, turn, item and every question id, and refuses a mismatch", () => {
    expect(bindCodexQuestion(codexBinding(), request(), "g1")).toEqual({ ok: true, data: {
      gateId: "g1", sessionKey: "s1", generation: 1, nativeThread: "T1", nativeTurn: "U1", nativeItem: "I1",
      nativeQuestions: ["color", "size"], presentation: "form",
    } });
    expect(bindCodexQuestion(codexBinding({ native: { harness: "codex", profile: "default", kind: "id", value: "T2" } }), request(), "g1").ok).toBe(false);
    expect(bindCodexQuestion(codexBinding({ native: { harness: "claude", profile: "", kind: "id", value: "T1" } }), request(), "g1").ok).toBe(false);
    expect(bindCodexQuestion(codexBinding(), request({ isBlocking: false }), "g1").ok).toBe(false);
  });

  test("a question with no options gets one Answer option, whose note carries the text", () => {
    for (const options of [null, []]) {
      const [q] = gateQuestionsOf([{ id: "why", header: "", question: "Why?", isOther: false, isSecret: false, options }]);
      expect(q).toEqual({ id: "why", label: "Why?", multi: false, options: [{ value: ANSWER_VALUE, label: "Answer", description: expect.any(String) }] });
      const row = { questions: [q!], answer: { answers: { why: { value: ANSWER_VALUE, note: "because" } }, by: "console", answeredAt: 1 } } as unknown as GateRow;
      expect(nativeAnswersOf(row, ["why"])).toEqual({ ok: true, data: { why: { answers: ["because"] } } });
    }
  });

  test("Other without text has nothing to send", () => {
    const qs = gateQuestionsOf(PICK);
    const row = { questions: qs, answer: { answers: { pick: OTHER_VALUE }, by: "console", answeredAt: 1 } } as unknown as GateRow;
    expect(nativeAnswersOf(row, ["pick"]).ok).toBe(false);
  });
});

describe("gate doorbells route by harness", () => {
  test("a Codex-nudged gate never rings a Claude inbox; a Claude nudge rings as before", async () => {
    const w = await world();
    const store = w.store;
    const codexGate = store.open({ subject: "run:r1", kind: "k1", questions: gateQuestionsOf(PICK), nudge: { session: "T1", harness: "codex" } }).row;
    const claudeGate = store.open({ subject: "run:r2", kind: "k2", questions: gateQuestionsOf(PICK), nudge: { session: "C1" } }).row;
    expect(nudgedQuestion(store.get(codexGate.id)!)!.binding.native.harness).toBe("codex");
    expect(nudgedQuestion(store.get(claudeGate.id)!)!.binding.native.harness).toBe("claude");
    await answerGate(w, codexGate.id, { pick: "A" });
    await settled();
    expect(w.pushes()).toBe(0);
    expect(store.get(codexGate.id)!.delivery).toBeNull();
    await answerGate(w, claudeGate.id, { pick: "A" });
    await settled();
    expect(w.pushes()).toBe(1);
  });

  test("gate:ask stamps a non-Claude caller's harness on the nudge, and nothing for Claude", async () => {
    const w = await world();
    const ask = (harness?: string) => w.handlers()["gate:ask"]({
      subject: `run:${harness ?? "claude"}`, sessionId: "S1", paneId: "p1", context: "c", questions: gateQuestionsOf(PICK).map((q) => ({ ...q, options: q.options.slice(0, 2) })),
      ...(harness && { harness }),
    });
    const codex = await ask("codex");
    const claude = await ask();
    expect(codex.ok && w.store.get(codex.data.id)!.nudge).toEqual({ session: "S1", harness: "codex" });
    expect(claude.ok && w.store.get(claude.data.id)!.nudge).toEqual({ session: "S1" });
  });
});

/** The live-07 output line for `callId`, carrying `answers` instead of what was recorded. */
function rolloutOutput(callId: string, answers: Record<string, { answers: string[] }>): string {
  const line = ROLLOUT.split("\n").find((l) => l.includes(CASE_B3) && l.includes("function_call_output"))!;
  const entry = JSON.parse(line);
  entry.payload.call_id = callId;
  entry.payload.output = JSON.stringify({ answers });
  return `${JSON.stringify(entry)}\n`;
}

describe("questions that ended while rt was not subscribed", () => {
  test("a native answer rt never heard leaves the request unwritten: the Console answer is a conflict", async () => {
    const w = await world();
    const c = await w.connect();
    w.server.ask("T1", "U1", CASE_B3, PICK);
    await settled();
    c.clock.lapse();
    expect(w.socket().subscribed.has("T1")).toBe(false);
    // The TUI answers B; rt, unsubscribed, hears neither resolved nor (yet) the status, and replies still lag it.
    w.server.rollout = ROLLOUT;
    w.server.replyStatus = { type: "active", activeFlags: ["waitingOnUserInput"] };
    w.server.resolve("T1", { quiet: true });
    const [gate] = w.gates();
    expect((await answerGate(w, gate!.id, { pick: "A" })).ok).toBe(true);
    await settled();

    expect(w.answersSent()).toEqual([]);
    expect(w.service.completion(gate!.id)?.state).toBe("conflict");
    expect(w.store.get(gate!.id)!.answer?.answers).toEqual({ pick: "A" });
  });

  test("a status without the wait ends a request rt was not subscribed to hear: the native answer becomes the session's own", async () => {
    const w = await world();
    const c = await w.connect();
    w.server.ask("T1", "U1", CASE_M, COLOR_SIZE);
    await settled();
    c.clock.lapse();
    w.server.rollout = ROLLOUT;
    w.server.resolve("T1");
    await settled();
    const [gate] = w.gates();
    expect(w.store.get(gate!.id)!.answer).toMatchObject({ answers: { color: "Red", size: { value: OTHER_VALUE, note: "Medium-ish" } }, session: "T1" });
    expect(w.service.completion(gate!.id)?.state).toBe("completed");
    expect(w.answersSent()).toEqual([]);
  });

  test("an interrupt rt was not subscribed to hear closes the open gate", async () => {
    const w = await world();
    const c = await w.connect();
    w.server.ask("T1", "U1", CASE_I, PICK);
    await settled();
    c.clock.lapse();
    w.server.rollout = ROLLOUT;
    w.server.interrupt("T1", "U1");
    await settled();
    const [gate] = w.gates();
    expect(w.store.get(gate!.id)).toMatchObject({ status: "closed", answer: null });
  });

  test("resolved and the status both arriving end the request once", async () => {
    const w = await world();
    await w.connect();
    w.server.ask("T1", "U1", CASE_M, COLOR_SIZE);
    await settled();
    w.server.rollout = ROLLOUT;
    w.server.resolve("T1");
    await settled();
    expect(w.emitted.filter((e) => e.topic === "gate.native-attention")).toEqual([]);
    expect(w.service.completion(w.gates()[0]!.id)?.state).toBe("completed");
  });

  test("a thread the app server fails to describe once is asked for again before its native answer is given up on", async () => {
    const w = await world();
    await w.connect();
    w.server.ask("T1", "U1", CASE_M, COLOR_SIZE);
    await settled();
    const [gate] = w.gates();
    w.server.rollout = ROLLOUT;
    w.server.readFailures = 1;
    const readsBefore = w.sent().filter((m) => m.method === "thread/read").length;
    w.server.resolve("T1");
    await settled();
    expect(w.store.get(gate!.id)!.answer).toMatchObject({ answers: { color: "Red", size: { value: OTHER_VALUE, note: "Medium-ish" } }, session: "T1" });
    expect(w.service.completion(gate!.id)?.state).toBe("completed");
    expect(w.emitted.filter((e) => e.topic === "gate.native-attention")).toEqual([]);
    // The failed read and the one that answered.
    expect(w.sent().filter((m) => m.method === "thread/read")).toHaveLength(readsBefore + 2);
  });

  test("a resolved question re-reads a rollout that lags, without waiting for the backoff", async () => {
    const w = await world();
    await w.connect();
    w.server.resolveOnReply = false;
    w.server.ask("T1", "U1", CASE_M, COLOR_SIZE);
    await settled();
    const [gate] = w.gates();
    expect((await answerGate(w, gate!.id, { color: "Red", size: { value: OTHER_VALUE, note: "Medium-ish" } })).ok).toBe(true);
    await settled();
    expect(w.answersSent()).toHaveLength(1);
    w.server.rolloutQueue = ["", ROLLOUT];
    w.server.resolve("T1");
    await settled();
    expect(w.service.completion(gate!.id)?.state).toBe("completed");
  });
});

describe("free-text questions", () => {
  const WHY = [{ id: "why", header: "Why", question: "Why this way?", isOther: false, isSecret: false, options: null }];

  test("an option-less question is answered through its Answer option's note", async () => {
    const w = await world();
    await w.connect();
    w.server.ask("T1", "U1", "call_why", WHY);
    await settled();
    const [gate] = w.gates();
    expect(gate!.questions[0]!.options).toEqual([expect.objectContaining({ value: ANSWER_VALUE, label: "Answer" })]);
    expect((await answerGate(w, gate!.id, { why: { value: ANSWER_VALUE, note: "fewer moving parts" } })).ok).toBe(true);
    await settled();
    expect(w.answersSent()).toEqual([{ id: 0, result: { answers: { why: { answers: ["fewer moving parts"] } } } }]);
    w.server.rollout = rolloutOutput("call_why", { why: { answers: ["fewer moving parts"] } });
    await w.service.completeGateQuestion(gate!.id);
    expect(w.service.completion(gate!.id)?.state).toBe("completed");
  });

  test("Answer or Other with no note settles conflict at once and asks for a person", async () => {
    const cases: Array<[Message[], Record<string, unknown>]> = [[WHY, { why: ANSWER_VALUE }], [PICK, { pick: OTHER_VALUE }]];
    for (const [questions, answer] of cases) {
      const w = await world();
      await w.connect();
      w.server.ask("T1", "U1", "call_empty", questions);
      await settled();
      const [gate] = w.gates();
      expect((await answerGate(w, gate!.id, answer)).ok).toBe(true);
      await settled();
      expect(w.answersSent()).toEqual([]);
      expect(w.service.completion(gate!.id)).toMatchObject({ state: "conflict", attempts: 1 });
      expect(w.emitted.filter((e) => e.topic === "gate.native-attention")).toEqual([
        { topic: "gate.native-attention", payload: expect.objectContaining({ reason: "unsendable-answer", gateId: gate!.id }) },
      ]);
    }
  });
});

describe("question gate subjects", () => {
  test("a session in a run gets its gate under the run", async () => {
    const w = await world();
    await w.connect();
    w.server.ask("T1", "U1", "I1", PICK);
    await settled();
    expect(w.gates().map((g) => g.subject)).toEqual(["run:r1"]);
  });

  const unlisted: Array<[string, GateSubjectResult, string]> = [
    ["a session no surface lists", { ok: true, subject: "agent:agent-1" }, "unlisted-subject"],
    ["a session with no subject", { ok: false, error: "no subject: pass --subject, or run under a recorded run/agent session" }, "no-subject"],
  ];
  for (const [name, subject, reason] of unlisted) {
    test(`${name} gets attention, no gate, and its native form left alone`, async () => {
      const w = await world({ subject });
      await w.connect();
      w.server.ask("T1", "U1", "I1", PICK);
      await settled();
      expect(w.gates()).toEqual([]);
      expect(w.answersSent()).toEqual([]);
      expect(w.emitted.filter((e) => e.topic === "gate.native-attention")).toEqual([
        { topic: "gate.native-attention", payload: expect.objectContaining({ reason, threadId: "T1", itemId: "I1" }) },
      ]);
    });
  }

  test("gateCommandsVia passes the handler's failure code through and names its caller", async () => {
    const seen: unknown[] = [];
    const commands = gateCommandsVia(async (_cmd, payload) => {
      seen.push(payload);
      return { ok: false, error: "no surface lists gates under agent:a", failure: { code: "unlisted-subject", message: "x" } };
    });
    const asked = await commands.ask({ questions: gateQuestionsOf(PICK), sessionId: "T1" });
    expect(asked).toEqual({ ok: false, error: { code: "refused", message: "no surface lists gates under agent:a", failure: "unlisted-subject" } });
    expect(seen).toEqual([expect.objectContaining({ _client: GATE_QUESTIONS_CLIENT })]);
  });
});

describe("rollout reads", () => {
  test("the rollout is read backward from its end, within a byte cap", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rt-codex-rollout-"));
    dirs.push(dir);
    const path = join(dir, "rollout.jsonl");
    const filler = `${JSON.stringify({ type: "event_msg", payload: { type: "token_count", note: "é".repeat(40) } })}\n`.repeat(400);
    writeFileSync(path, filler + ROLLOUT + filler);
    const same = { color: { answers: ["Red"] }, size: { answers: ["Medium-ish"] } };
    const found = await readRolloutTail(path, CASE_M, { chunkBytes: 333 });
    expect(rolloutEvidence(found.text, CASE_M, same, found.whole).state).toBe("completed");
    expect(found.text.length).toBeLessThan(filler.length * 2 + ROLLOUT.length);
    const capped = await readRolloutTail(path, CASE_M, { chunkBytes: 333, maxBytes: Buffer.byteLength(filler) / 2 });
    expect(capped.whole).toBe(false);
    const unknown = rolloutEvidence(capped.text, CASE_M, same, capped.whole);
    expect(unknown.state).toBe("pending");
    expect(unknown).not.toHaveProperty("absent");
    const whole = await readRolloutTail(path, "call_missing", { chunkBytes: 333 });
    expect(whole.whole).toBe(true);
    expect(rolloutEvidence(whole.text, "call_missing", same, whole.whole)).toMatchObject({ state: "pending", absent: true });
  });

  test("a read that stopped at its cap is no evidence the question is open: nothing is written", async () => {
    const w = await world();
    await w.connect();
    w.server.resolveOnReply = false;
    w.server.ask("T1", "U1", "I1", PICK);
    await settled();
    w.server.rolloutWhole = false;
    const [gate] = w.gates();
    expect((await answerGate(w, gate!.id, { pick: "A" })).ok).toBe(true);
    await settled();
    expect(w.reads.length).toBeGreaterThan(0);
    expect(w.answersSent()).toEqual([]);
    expect(w.service.completion(gate!.id)?.state).toBe("pending");
  });

  test("no line is missed at a chunk edge, multibyte text included", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rt-codex-rollout-"));
    dirs.push(dir);
    const path = join(dir, "rollout.jsonl");
    const lines = Array.from({ length: 600 }, (_, i) =>
      JSON.stringify({ type: "event_msg", ordinal: i, payload: { note: "ü€😀".repeat(i % 17), pad: "x".repeat((i * 7) % 113) } }));
    const body = `${lines.join("\n")}\n`;
    writeFileSync(path, body);
    for (const chunkBytes of [7, 97, 1000, 4096, 65536]) {
      const read = await readRolloutTail(path, "call_missing", { chunkBytes });
      expect(read.whole).toBe(true);
      expect(read.text).toBe(body);
    }
    // Eight MiB at the default chunk: every 64 KiB edge falls somewhere inside a line.
    const big = body.repeat(Math.ceil((8 * 1024 * 1024) / Buffer.byteLength(body)));
    writeFileSync(path, big);
    const bigRead = await readRolloutTail(path, "call_missing");
    expect(bigRead.whole).toBe(true);
    expect(bigRead.text === big).toBe(true);
    // The item's output line on every chunk edge a 97-byte read could put it on.
    const output = ROLLOUT.split("\n").find((l) => l.includes(CASE_M) && l.includes("function_call_output"))!;
    for (let at = 590; at < 600; at++) {
      writeFileSync(path, `${[...lines.slice(0, at), output, ...lines.slice(at)].join("\n")}\n`);
      const read = await readRolloutTail(path, CASE_M, { chunkBytes: 97 });
      expect(rolloutEvidence(read.text, CASE_M, { color: { answers: ["Red"] }, size: { answers: ["Medium-ish"] } }, read.whole).state).toBe("completed");
    }
  });

  test("a rollout path outside the Codex home's sessions is never read", async () => {
    for (const path of ["/etc/passwd.jsonl", `${CODEX_HOME}/sessions/../../../etc/x.jsonl`, `${CODEX_HOME}/sessions/x.txt`, "sessions/x.jsonl"]) {
      const w = await world();
      w.server.pathFor = () => path;
      await w.connect();
      w.server.resolveOnReply = false;
      w.server.ask("T1", "U1", "I1", PICK);
      await settled();
      const [gate] = w.gates();
      expect((await answerGate(w, gate!.id, { pick: "A" })).ok).toBe(true);
      await settled();
      expect(w.reads).toEqual([]);
      expect(w.answersSent()).toEqual([]);
      expect(w.service.completion(gate!.id)?.state).toBe("pending");
    }
  });
});

describe("fix round 2", () => {
  test("a status that ends an open request does nothing once the switch is off", async () => {
    const w = await world();
    await w.connect();
    w.server.ask("T1", "U1", CASE_M, COLOR_SIZE);
    await settled();
    expect(w.gates()).toHaveLength(1);
    const sentBefore = w.sent().length;
    w.switchOn.value = false;
    w.server.rollout = ROLLOUT;
    w.server.resolve("T1");
    await settled();
    expect(w.sent().slice(sentBefore).filter((m) => m.method === "thread/read")).toEqual([]);
    expect(w.reads).toEqual([]);
    expect(w.answersSent()).toEqual([]);
    expect(w.emitted).toEqual([]);
    expect(w.gates()[0]!.status).toBe("open");
  });

  test("attention never emits with the switch off", () => {
    const store = createGatesStore({ dbPath: join(mkdtempSync(join(tmpdir(), "rt-codex-attn-")), "gates.db"), log });
    const emitted: string[] = [];
    const service = createGateQuestions({ gates: store, enabled: () => false, emit: (topic) => { emitted.push(topic); }, log });
    service.native.attention({ reason: "async-question" });
    expect(emitted).toEqual([]);
  });

  /** gate:ask refused `failures` times, then the real handler. */
  function refuseAsk(w: Awaited<ReturnType<typeof world>>, failures: number) {
    const real = w.service.native.ask;
    let calls = 0;
    (w.service.native as { ask: typeof real }).ask = async (payload) => {
      calls++;
      if (calls <= failures) return { ok: false, error: { code: "transient", message: "the daemon is busy" } };
      return real(payload);
    };
    return () => calls;
  }

  const replay = (w: Awaited<ReturnType<typeof world>>) =>
    w.socket().push({ method: "item/tool/requestUserInput", id: 0, params: w.server.pending.get("T1")!.params });

  test("a transient refusal leaves the request for the next replay, which opens the gate", async () => {
    const w = await world();
    await w.connect();
    const calls = refuseAsk(w, 1);
    w.server.ask("T1", "U1", "I1", PICK);
    await settled();
    expect(calls()).toBe(1);
    expect(w.gates()).toEqual([]);
    replay(w);
    await settled();
    expect(calls()).toBe(2);
    expect(w.gates()).toHaveLength(1);
    expect(w.emitted.filter((e) => e.topic === "gate.native-attention")).toEqual([]);
  });

  test("presentation is tried a bounded number of times, then left to the native form", async () => {
    const w = await world();
    await w.connect();
    const calls = refuseAsk(w, Number.POSITIVE_INFINITY);
    w.server.ask("T1", "U1", "I1", PICK);
    await settled();
    for (let i = 0; i < 6; i++) {
      replay(w);
      await settled();
    }
    expect(calls()).toBe(MAX_PRESENT_ATTEMPTS);
    expect(w.gates()).toEqual([]);
    expect(w.emitted.filter((e) => e.topic === "gate.native-attention")).toEqual([
      { topic: "gate.native-attention", payload: expect.objectContaining({ reason: "unpresentable-question", threadId: "T1", itemId: "I1" }) },
    ]);
  });

  test("an unlisted subject is left to the native form at once, and a replay does not ask again", async () => {
    const w = await world({ subject: { ok: true, subject: "agent:agent-1" } });
    await w.connect();
    const calls = refuseAsk(w, 0);
    w.server.ask("T1", "U1", "I1", PICK);
    await settled();
    replay(w);
    await settled();
    expect(calls()).toBe(1);
  });
});

/**
 * live-08 rollout lines (0.160.x), each file the question lines of one real
 * rollout in file order: A is thread 01a116fa-e88b (without the three lines
 * about the two items whose function_call lines collect.sh cut at 700 bytes),
 * B is 01a116fb-4f61 and C is 01a116fb-6678. live-07 case I is the two whole
 * lines of its turn, task_started and turn_aborted; the capture cut the seven
 * between them at 400 bytes, so they are left out.
 */
const LIVE08_A = readFileSync(join(FIXTURES, "rollout-live08-a-0.160.x.jsonl"), "utf8");
const LIVE08_B = readFileSync(join(FIXTURES, "rollout-live08-b-0.160.x.jsonl"), "utf8");
const LIVE08_C = readFileSync(join(FIXTURES, "rollout-live08-c-0.160.x.jsonl"), "utf8");
const LIVE07_I = readFileSync(join(FIXTURES, "rollout-live07-caseI-0.160.x.jsonl"), "utf8");
/** Rollout C: answered in the TUI; aborted by an app-server restart, with no output; the async question of its last turn. */
const L8_ANSWERED = { item: "call_ECu0WV1iuLbrvnlEqGnDT9NQ", turn: "01a1170c-35fd-7823-877a-1465cddd9ad9" };
const L8_ABORTED = { item: "call_nV28Qz6f899s09yaMANpMYbQ", turn: "01a1170d-51a4-7490-b25a-5ff8fd3f4cd9" };
const L8_ASYNC_LAST = { item: "call_V3pfIiWwzkU8iP5rzqEIdNST", turn: "01a11716-92d3-75d0-acff-b2a8dcd659d8" };
/** Rollout A: the TUI answered B, then the turn was interrupted (live-08 case 6: an answer that lands first stays). */
const L8_ANSWERED_THEN_ABORTED = { item: "call_HwejYU5qL9Bi0ph2lUc6TlYj", turn: "01a11709-8d70-7ce2-a6be-417c42e9fb9a" };

const attentionFor = (w: Awaited<ReturnType<typeof world>>, reason: string) =>
  w.emitted.filter((e) => e.topic === "gate.native-attention" && e.payload.reason === reason);

/** A gate opened for a question, then the app server goes away; it comes back with the question ended as `ending` says. */
async function endedWhileAway(
  question: { item: string; turn: string },
  ending: { status: Record<string, unknown>; rollout: string; whole?: boolean; turns?: Message[] | null },
  whileAway?: (w: Awaited<ReturnType<typeof world>>, gate: GateRow) => Promise<void>,
) {
  const w = await world();
  await w.connect();
  w.server.ask("T1", question.turn, question.item, PICK);
  await settled();
  const [gate] = w.gates();
  w.server.restart();
  w.server.pending.delete("T1");
  w.server.status = ending.status;
  w.server.rollout = ending.rollout;
  w.server.rolloutWhole = ending.whole ?? true;
  w.server.turns = ending.turns ?? null;
  if (whileAway) await whileAway(w, gate!);
  const c = await w.connect();
  return { w, c, gate: gate! };
}

describe("live-08: questions that ended while rt was not connected", () => {
  test("a turn_aborted covering the item's turn is aborted; without the turn it stays unknown", () => {
    expect(rolloutEvidence(LIVE08_C, L8_ABORTED.item, { pick: { answers: ["A"] } }, true, L8_ABORTED.turn).state).toBe("gone");
    expect(rolloutEvidence(LIVE08_C, L8_ABORTED.item, null, true, L8_ABORTED.turn).state).toBe("gone");
    expect(rolloutEvidence(LIVE08_C, L8_ABORTED.item, { pick: { answers: ["A"] } }, true, "another-turn")).toMatchObject({ state: "pending" });
  });

  test("an output written before its turn was aborted still decides", () => {
    const { item, turn } = L8_ANSWERED_THEN_ABORTED;
    expect(rolloutEvidence(LIVE08_A, item, null, true, turn)).toMatchObject({ state: "answered", answers: { pick: { answers: ["B"] } } });
    expect(rolloutEvidence(LIVE08_A, item, { pick: { answers: ["B"] } }, true, turn).state).toBe("completed");
    expect(rolloutEvidence(LIVE08_A, item, { pick: { answers: ["A"] } }, true, turn).state).toBe("conflict");
  });

  test("a read that stopped at its cap with the turn aborted is unknown, since the output may lie beyond it", () => {
    const capped = rolloutEvidence(LIVE08_C, L8_ABORTED.item, null, false, L8_ABORTED.turn);
    expect(capped.state).toBe("pending");
    expect(capped).not.toHaveProperty("absent");
  });

  test("answered in the TUI while rt was away: the reconnect records the native answer and writes nothing", async () => {
    const { w, c, gate } = await endedWhileAway(L8_ANSWERED, { status: { type: "active", activeFlags: [] }, rollout: LIVE08_C });
    await c.sessions.observe(w.sessions.get("s1")!);
    await settled();
    expect(w.store.get(gate.id)).toMatchObject({ status: "answered", answer: { answers: { pick: "A" }, session: "T1" } });
    expect(w.service.completion(gate.id)?.state).toBe("completed");
    expect(w.answersSent()).toEqual([]);
  });

  test("the rollout is read again before an ending is announced as unseen, since Codex writes it moments after resolving", async () => {
    const { w, c, gate } = await endedWhileAway(L8_ANSWERED, { status: { type: "active", activeFlags: [] }, rollout: LIVE08_C });
    w.server.rolloutQueue = ["", ""];
    await c.sessions.observe(w.sessions.get("s1")!);
    await settled();
    expect(w.store.get(gate.id)).toMatchObject({ status: "answered", answer: { answers: { pick: "A" }, session: "T1" } });
    expect(w.emitted.filter((e) => e.topic === "gate.native-attention")).toEqual([]);
  });

  test("aborted with no re-ask: the reconnect closes the gate, and a later answer is refused", async () => {
    const { w, c, gate } = await endedWhileAway(L8_ABORTED, { status: { type: "idle" }, rollout: LIVE08_C });
    await c.sessions.observe(w.sessions.get("s1")!);
    await settled();
    expect(w.store.get(gate.id)).toMatchObject({ status: "closed", answer: null });
    expect(w.service.completion(gate.id)?.state).toBe("gone");
    expect((await answerGate(w, gate.id, { pick: "A" })).ok).toBe(false);
    expect(w.answersSent()).toEqual([]);
  });

  test("a gate answered while the app server was down, whose turn it aborted and never asked again, ends gone", async () => {
    const { w, c, gate } = await endedWhileAway(L8_ABORTED, { status: { type: "idle" }, rollout: LIVE08_C }, async (w, gate) => {
      expect((await answerGate(w, gate.id, { pick: "A" })).ok).toBe(true);
      await settled();
      expect(w.service.completion(gate.id)?.state).toBe("pending");
    });
    await c.sessions.observe(w.sessions.get("s1")!);
    await settled();
    // M4's recovery retries the completion on the new connection, where no replay matches the item.
    await w.service.completeGateQuestion(gate.id);
    expect(w.service.completion(gate.id)?.state).toBe("gone");
    expect(w.answersSent()).toEqual([]);
  });

  test("an aborted turn in a read that stopped at its cap leaves the gate open and asks for a person", async () => {
    const { w, c, gate } = await endedWhileAway(L8_ABORTED, { status: { type: "idle" }, rollout: LIVE08_C, whole: false });
    await c.sessions.observe(w.sessions.get("s1")!);
    await settled();
    expect(w.store.get(gate.id)!.status).toBe("open");
    expect(attentionFor(w, "question-ended-unseen")).toEqual([
      { topic: "gate.native-attention", payload: expect.objectContaining({ gateId: gate.id, threadId: "T1" }) },
    ]);
  });

  test("an ending the rollout cannot account for leaves the gate open and asks for a person once", async () => {
    const { w, c, gate } = await endedWhileAway({ item: "I1", turn: "U1" }, { status: { type: "idle" }, rollout: "" });
    await c.sessions.observe(w.sessions.get("s1")!);
    await settled();
    for (let i = 0; i < 2; i++) {
      w.socket().push({ method: "thread/status/changed", params: { threadId: "T1", status: { type: "idle" } } });
      await settled();
    }
    expect(w.store.get(gate.id)!.status).toBe("open");
    expect(w.emitted.filter((e) => e.topic === "gate.native-attention")).toEqual([
      { topic: "gate.native-attention", payload: expect.objectContaining({ reason: "question-ended-unseen", gateId: gate.id, threadId: "T1" }) },
    ]);
  });

  test("an ending the rollout cannot account for is looked at again only when a turn ends, a bounded number of times", async () => {
    const { w, c, gate } = await endedWhileAway({ item: "I1", turn: "U1" }, { status: { type: "idle" }, rollout: "" });
    await c.sessions.observe(w.sessions.get("s1")!);
    await settled();
    expect(attentionFor(w, "question-ended-unseen")).toHaveLength(1);
    const looked = w.tailReads.length;
    expect(looked).toBeGreaterThan(1);
    const status = async (s: Message) => {
      w.socket().push({ method: "thread/status/changed", params: { threadId: "T1", status: s } });
      await settled();
    };
    // A status that ends no turn reads nothing more.
    await status({ type: "idle" });
    await status({ type: "active", activeFlags: [] });
    await status({ type: "active", activeFlags: [] });
    expect(w.tailReads.length).toBe(looked);
    // Each turn end looks once more, up to the bound.
    for (let i = 1; i <= MAX_UNSEEN_RECHECKS; i++) {
      await status({ type: "idle" });
      expect(w.tailReads.length).toBe(looked + i);
      await status({ type: "active", activeFlags: [] });
    }
    await status({ type: "idle" });
    expect(w.tailReads.length).toBe(looked + MAX_UNSEEN_RECHECKS);
    expect(w.store.get(gate.id)!.status).toBe("open");
    expect(attentionFor(w, "question-ended-unseen")).toHaveLength(1);
  });

  test("a gates store fault inside the status listener is warned about and skipped, never thrown into observe", async () => {
    const w = await world();
    const c = await w.connect();
    (w.service.native as { openFor: typeof w.service.native.openFor }).openFor = () => {
      throw new Error("database is locked");
    };
    w.server.status = { type: "idle" };
    const seen = await c.sessions.observe(w.sessions.get("s1")!);
    expect(seen.ok).toBe(true);
    w.socket().push({ method: "thread/status/changed", params: { threadId: "T1", status: { type: "idle" } } });
    await settled();
    expect(w.warned).toEqual([
      { message: expect.any(String), context: expect.objectContaining({ threadId: "T1", err: expect.any(Error) }) },
      { message: expect.any(String), context: expect.objectContaining({ threadId: "T1", err: expect.any(Error) }) },
    ]);
    expect(w.emitted).toEqual([]);
  });

  test("a status for a thread with no bound gate and no binding this connection knows costs no session-store read", async () => {
    const w = await world();
    await w.connect();
    const status = async (threadId: string, s: Message) => {
      w.socket().push({ method: "thread/status/changed", params: { threadId, status: s } });
      await settled();
    };
    await status("T9", { type: "active", activeFlags: [] });
    await status("T9", { type: "idle" });
    expect(w.bindingReads()).toBe(0);
    // A thread this connection owns is read only when its turn ends, for the async scan.
    await status("T1", { type: "active", activeFlags: [] });
    expect(w.bindingReads()).toBe(0);
    await status("T1", { type: "idle" });
    expect(w.bindingReads()).toBe(1);
  });

  test("a thread still waiting on its question is not reconciled", async () => {
    const { w, c, gate } = await endedWhileAway(L8_ANSWERED, { status: { type: "active", activeFlags: ["waitingOnUserInput"] }, rollout: LIVE08_C });
    w.server.pending.set("T1", { id: 0, params: { threadId: "T1", turnId: L8_ANSWERED.turn, itemId: L8_ANSWERED.item, questions: PICK, isBlocking: true, autoResolutionMs: null } });
    await c.sessions.observe(w.sessions.get("s1")!);
    await settled();
    expect(w.store.get(gate.id)!.status).toBe("open");
    expect(w.emitted).toEqual([]);
  });

  test("with the switch off a reconnect reconciles nothing", async () => {
    const { w, c, gate } = await endedWhileAway(L8_ANSWERED, { status: { type: "active", activeFlags: [] }, rollout: LIVE08_C });
    w.switchOn.value = false;
    await c.sessions.observe(w.sessions.get("s1")!);
    await settled();
    expect(w.store.get(gate.id)!.status).toBe("open");
    expect(w.reads).toEqual([]);
    expect(w.emitted).toEqual([]);
  });
});

/**
 * live-09 (0.161.x): the question lines of thread 01a11751's rollout in file
 * order. Case 3b's question was interrupted when the app server stopped and
 * started again, and Codex wrote neither an output nor a turn_aborted for it.
 */
const LIVE09 = readFileSync(join(FIXTURES, "rollout-live09-0.161.x.jsonl"), "utf8");
const L9_D5 = { item: "call_vOI4J9MVsgwTzCjooH3Tb82F", turn: "01a11759-17e1-72b2-9bb3-bd9b7164e843" };
/** live-07 thread/turns/list pages: `default` is the reply to { threadId } alone, `notLoaded` the TUI's. */
const TURNS = JSON.parse(readFileSync(join(FIXTURES, "thread-turns-list-0.160.x.json"), "utf8"));
const L7_INTERRUPTED = "01a116a7-f32b-7921-90b3-13b29bc7054c";
/** live-07's interrupted turn as the list pages it, under the question's turn id and the given status. */
const listedTurn = (id: string, status: string): Message => ({ ...TURNS.notLoaded.data.find((t: Message) => t.id === L7_INTERRUPTED), id, status });
const turnLists = (w: Awaited<ReturnType<typeof world>>) => w.sent().filter((m) => m.method === "thread/turns/list");

describe("live-09: a turn that ended with no rollout evidence", () => {
  test("a listed turn has ended only when it completed, was interrupted or failed", () => {
    expect(turnEndedOf(TURNS.notLoaded, L7_INTERRUPTED)).toBe("interrupted");
    expect(turnEndedOf(TURNS.notLoaded, TURNS.notLoaded.data[0].id)).toBe("completed");
    expect(TURNS.default.data[0].status).toBe("inProgress");
    expect(turnEndedOf(TURNS.default, TURNS.default.data[0].id)).toBeNull();
    expect(turnEndedOf(TURNS.default, L9_D5.turn)).toBeNull();
    expect(turnEndedOf({ data: [listedTurn("U1", "failed")] }, "U1")).toBe("failed");
    expect(turnEndedOf({ data: [listedTurn("U1", "paused")] }, "U1")).toBeNull();
    expect(turnEndedOf({ data: "U1" }, "U1")).toBeNull();
    expect(turnEndedOf(null, "U1")).toBeNull();
  });

  test("a notLoaded page's turns are read by id and status alone, with their items empty or absent", () => {
    const { items: _items, ...bare } = listedTurn("U1", "interrupted");
    expect(TURNS.notLoaded.data[2].items).toEqual([]);
    expect(turnEndedOf({ data: [bare], nextCursor: null, backwardsCursor: null }, "U1")).toBe("interrupted");
    expect(turnEndedOf({ data: [{ ...bare, items: [] }] }, "U1")).toBe("interrupted");
  });

  test("the D5 rollout holds no output and no turn_aborted for the question", () => {
    expect(rolloutEvidence(LIVE09, L9_D5.item, null, true, L9_D5.turn)).toMatchObject({ state: "pending", absent: true });
  });

  // live-10: before the TUI resumes the thread it reads notLoaded, and the turn already reads interrupted.
  const d5: Array<[string, Message]> = [
    ...["interrupted", "completed", "failed"].map((status): [string, Message] => [status, { type: "idle" }]),
    ["interrupted", { type: "notLoaded" }],
  ];
  for (const [status, thread] of d5) {
    test(`D5: the turn ${status} with no output and the thread ${thread.type}: the reconnect closes the gate, and a later answer is refused`, async () => {
      const { w, c, gate } = await endedWhileAway(L9_D5, { status: thread, rollout: LIVE09, turns: [listedTurn(L9_D5.turn, status)] });
      await c.sessions.observe(w.sessions.get("s1")!);
      await settled();
      expect(w.store.get(gate.id)).toMatchObject({ status: "closed", answer: null });
      expect(w.service.completion(gate.id)?.state).toBe("gone");
      expect(attentionFor(w, "question-ended-unseen")).toEqual([]);
      expect((await answerGate(w, gate.id, { pick: "A" })).ok).toBe(false);
      expect(w.answersSent()).toEqual([]);
      expect(turnLists(w).map((m) => m.params)).toEqual([{ threadId: "T1", limit: 20, sortDirection: "desc", itemsView: "notLoaded" }]);
    });
  }

  test("a gate answered before the reconnect, whose turn ended with no rollout evidence, ends gone with nothing written", async () => {
    const turns = [listedTurn(L9_D5.turn, "interrupted")];
    const { w, c, gate } = await endedWhileAway(L9_D5, { status: { type: "idle" }, rollout: LIVE09, turns }, async (w, gate) => {
      expect((await answerGate(w, gate.id, { pick: "A" })).ok).toBe(true);
      await settled();
      expect(w.service.completion(gate.id)?.state).toBe("pending");
    });
    await c.sessions.observe(w.sessions.get("s1")!);
    await settled();
    await w.service.completeGateQuestion(gate.id);
    expect(w.service.completion(gate.id)?.state).toBe("gone");
    expect(w.answersSent()).toEqual([]);
  });

  test("a request rt held whose turn ended unheard, with no rollout evidence, closes its open gate", async () => {
    const w = await world();
    const c = await w.connect();
    w.server.ask("T1", L9_D5.turn, L9_D5.item, PICK);
    await settled();
    const [gate] = w.gates();
    c.clock.lapse();
    w.server.rollout = LIVE09;
    w.server.turns = [listedTurn(L9_D5.turn, "interrupted")];
    w.server.pending.delete("T1");
    w.server.setStatus("T1", { type: "idle" });
    await settled();
    expect(w.store.get(gate!.id)).toMatchObject({ status: "closed", answer: null });
    expect(attentionFor(w, "native-answer-unrecorded")).toEqual([]);
    expect(w.answersSent()).toEqual([]);
  });

  test("an answer to a request whose turn ended before rt heard of it is never written", async () => {
    const w = await world();
    await w.connect();
    w.server.ask("T1", L9_D5.turn, L9_D5.item, PICK);
    await settled();
    const [gate] = w.gates();
    w.server.rollout = LIVE09;
    w.server.turns = [listedTurn(L9_D5.turn, "interrupted")];
    w.server.pending.delete("T1");
    w.server.setStatus("T1", { type: "idle" }, true);
    expect((await answerGate(w, gate!.id, { pick: "A" })).ok).toBe(true);
    await settled();
    expect(w.answersSent()).toEqual([]);
    expect(w.service.completion(gate!.id)?.state).toBe("gone");
  });

  test("a question still waiting is answered whatever the turn list says, and the list is not asked before the write", async () => {
    const w = await world();
    await w.connect();
    w.server.resolveOnReply = false;
    w.server.turns = [listedTurn("U1", "interrupted")];
    w.server.ask("T1", "U1", "I1", PICK);
    await settled();
    const [gate] = w.gates();
    expect((await answerGate(w, gate!.id, { pick: "A" })).ok).toBe(true);
    await settled();
    expect(w.answersSent()).toEqual([{ id: 0, result: { answers: { pick: { answers: ["A"] } } } }]);
    expect(w.store.get(gate!.id)!.status).toBe("answered");
    expect(turnLists(w)).toEqual([]);
  });

  test("an idle status for a thread that reads as waiting again closes nothing", async () => {
    const { w, gate } = await endedWhileAway(L9_D5, { status: { type: "active", activeFlags: ["waitingOnUserInput"] }, rollout: LIVE09, turns: [listedTurn(L9_D5.turn, "interrupted")] });
    w.socket().push({ method: "thread/status/changed", params: { threadId: "T1", status: { type: "idle" } } });
    await settled();
    expect(w.store.get(gate.id)!.status).toBe("open");
    expect(turnLists(w)).toEqual([]);
  });

  test("a re-asked question's gate is never closed by the earlier turn's ending", async () => {
    const w = await world();
    await w.connect();
    w.server.ask("T1", "U1", "I1", PICK);
    await settled();
    const [first] = w.gates();
    w.server.turns = [listedTurn("U2", "inProgress"), listedTurn("U1", "interrupted")];
    w.server.ask("T1", "U2", "I2", PICK);
    await settled();
    const second = w.gates().find((g) => g.id !== first!.id)!;
    expect(second.status).toBe("open");
    const superseded = { status: "closed", answer: null, closedReason: "superseded", supersededBy: second.id };
    expect(w.store.get(first!.id)).toMatchObject(superseded);
    // A native answer whose output the rollout has not caught up with.
    w.server.rollout = LIVE09;
    w.server.resolve("T1");
    await settled();
    expect(w.store.get(second.id)!.status).toBe("open");
    expect(w.store.get(first!.id)).toMatchObject(superseded);
    expect(turnLists(w).length).toBeGreaterThan(0);
  });

  const unknown: Array<[string, (w: Awaited<ReturnType<typeof world>>) => void]> = [
    ["the turn list fails", (w) => { w.server.turns = null; }],
    ["the thread read for the turn check fails", (w) => { w.server.readsBeforeFailure = 1; }],
    ["the thread's status is unknown", (w) => { w.server.status = { type: "mystery" }; }],
    ["the turn's status is unknown", (w) => { w.server.turns = [listedTurn(L9_D5.turn, "paused")]; }],
    ["the turn is not listed", (w) => { w.server.turns = [listedTurn("another-turn", "interrupted")]; }],
    ["the turn is still in progress", (w) => { w.server.turns = [listedTurn(L9_D5.turn, "inProgress")]; }],
  ];
  for (const [name, arrange] of unknown) {
    test(`${name}: the gate stays open and a person is asked to look once`, async () => {
      const { w, gate } = await endedWhileAway(L9_D5, { status: { type: "idle" }, rollout: LIVE09, turns: [listedTurn(L9_D5.turn, "interrupted")] });
      arrange(w);
      w.socket().push({ method: "thread/status/changed", params: { threadId: "T1", status: { type: "idle" } } });
      await settled();
      expect(w.store.get(gate.id)!.status).toBe("open");
      expect(attentionFor(w, "question-ended-unseen")).toHaveLength(1);
    });
  }

  test("a read that stopped at its cap is not settled by the turn's ending", async () => {
    const { w, c, gate } = await endedWhileAway(L9_D5, { status: { type: "idle" }, rollout: LIVE09, whole: false, turns: [listedTurn(L9_D5.turn, "interrupted")] });
    await c.sessions.observe(w.sessions.get("s1")!);
    await settled();
    expect(w.store.get(gate.id)!.status).toBe("open");
    expect(turnLists(w)).toEqual([]);
  });

  test("an output the rollout catches up with after the turn list wins over the turn's ending", async () => {
    const { w, c, gate } = await endedWhileAway(L8_ANSWERED, { status: { type: "idle" }, rollout: LIVE08_C, turns: [listedTurn(L8_ANSWERED.turn, "completed")] });
    w.server.rolloutQueue = ["", "", "", "", ""];
    await c.sessions.observe(w.sessions.get("s1")!);
    await settled();
    expect(w.store.get(gate.id)).toMatchObject({ status: "answered", answer: { answers: { pick: "A" }, session: "T1" } });
  });

  test("with the switch off nothing asks for the turn list", async () => {
    const { w, c, gate } = await endedWhileAway(L9_D5, { status: { type: "idle" }, rollout: LIVE09, turns: [listedTurn(L9_D5.turn, "interrupted")] });
    w.switchOn.value = false;
    await c.sessions.observe(w.sessions.get("s1")!);
    await settled();
    expect(w.store.get(gate.id)!.status).toBe("open");
    expect(turnLists(w)).toEqual([]);
    expect(w.reads).toEqual([]);
    expect(w.emitted).toEqual([]);
  });
});

describe("live-08: async questions from Herdr TUI turns", () => {
  test("only the last turn's async questions are found in the rollout", () => {
    expect(asyncQuestionsOf(LIVE08_C)).toEqual([{ itemId: L8_ASYNC_LAST.item, turnId: L8_ASYNC_LAST.turn, questions: 1 }]);
    // Rollout B's async question sits two turns before its end.
    expect(asyncQuestionsOf(LIVE08_B)).toEqual([]);
  });

  test("an unsubscribed Herdr thread going idle raises async-question attention once per item", async () => {
    const w = await world();
    await w.connect();
    w.server.rollout = LIVE08_C;
    for (let i = 0; i < 2; i++) {
      w.server.setStatus("T1", { type: "active", activeFlags: [] });
      w.server.setStatus("T1", { type: "idle" });
      await settled();
    }
    expect(w.emitted.filter((e) => e.topic === "gate.native-attention")).toEqual([{
      topic: "gate.native-attention",
      payload: expect.objectContaining({ reason: "async-question", threadId: "T1", turnId: L8_ASYNC_LAST.turn, itemId: L8_ASYNC_LAST.item, questions: 1 }),
    }]);
    expect(w.gates()).toEqual([]);
    expect(w.sent().filter((m) => m.method !== "initialize" && m.method !== "initialized" && m.method !== "thread/read")).toEqual([]);
  });

  /** The item event for rollout C's last async question, as a subscribed connection hears it. */
  const asyncItem = (w: Awaited<ReturnType<typeof world>>) => {
    const item = { type: "agentMessage", id: L8_ASYNC_LAST.item, text: "Which option do you choose? (id: pick)\n- A\n- B",
      phase: "final_answer", memoryCitation: null, delivery: "async", questions: [{ title: "Which option do you choose? (id: pick)", options: ["A", "B"] }] };
    w.socket().push({ method: "item/completed", params: { item, threadId: "T1", turnId: L8_ASYNC_LAST.turn } });
  };

  test("a delivery hold taken after the question was asked does not skip the scan at the turn's end", async () => {
    const w = await world();
    const c = await w.connect();
    w.server.setStatus("T1", { type: "active", activeFlags: [] });
    expect((await c.sessions.hold(codexBinding(), "delivery-1")).ok).toBe(true);
    await settled();
    w.server.rollout = LIVE08_C;
    w.server.setStatus("T1", { type: "idle" });
    await settled();
    expect(attentionFor(w, "async-question")).toEqual([
      { topic: "gate.native-attention", payload: expect.objectContaining({ threadId: "T1", itemId: L8_ASYNC_LAST.item }) },
    ]);
    expect(w.gates()).toEqual([]);
  });

  test("the item event and the scan announce one item once", async () => {
    const w = await world();
    const c = await w.connect();
    w.server.setStatus("T1", { type: "active", activeFlags: [] });
    expect((await c.sessions.hold(codexBinding(), "delivery-1")).ok).toBe(true);
    await settled();
    asyncItem(w);
    await settled();
    w.server.rollout = LIVE08_C;
    w.server.setStatus("T1", { type: "idle" });
    await settled();
    expect(w.reads).toHaveLength(1);
    expect(attentionFor(w, "async-question")).toHaveLength(1);
  });

  test("with the switch off a turn's end reads nothing", async () => {
    const w = await world();
    await w.connect();
    w.server.rollout = LIVE08_C;
    w.switchOn.value = false;
    w.server.setStatus("T1", { type: "active", activeFlags: [] });
    w.server.setStatus("T1", { type: "idle" });
    await settled();
    expect(w.reads).toEqual([]);
    expect(w.emitted).toEqual([]);
  });
});

describe("rollout last-turn reads", () => {
  /** A task_started line in the shape live-07 recorded, for `turnId`: collect.sh kept no such lines from live-08. */
  function taskStarted(turnId: string): string {
    const entry = JSON.parse(LIVE07_I.split("\n")[0]!);
    entry.payload.turn_id = turnId;
    entry.payload.root_turn_id = turnId;
    return JSON.stringify(entry);
  }

  test("readRolloutLastTurn stops at the last task_started of a file with several turns", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rt-codex-rollout-"));
    dirs.push(dir);
    const path = join(dir, "rollout.jsonl");
    // Rollout A's turns in file order, each under its task_started line.
    const turns: Array<[string, string[]]> = [];
    for (const line of LIVE08_A.split("\n").filter(Boolean)) {
      const { payload } = JSON.parse(line);
      const turn: string = payload.turn_id ?? payload.internal_chat_message_metadata_passthrough.turn_id;
      if (turns.at(-1)?.[0] !== turn) turns.push([turn, []]);
      turns.at(-1)![1].push(line);
    }
    expect(turns.length).toBeGreaterThan(3);
    const body = `${turns.map(([turn, lines]) => [taskStarted(turn), ...lines].join("\n")).join("\n")}\n`;
    writeFileSync(path, body);
    const read = await readRolloutLastTurn(path, { chunkBytes: 100 });
    const [last, previous] = [turns.at(-1)![0], turns.at(-2)![0]];
    expect(read.whole).toBe(false);
    expect(read.text.startsWith(taskStarted(last))).toBe(true);
    expect(body.endsWith(read.text)).toBe(true);
    expect(read.text).not.toContain(taskStarted(previous));
    // A turn's start and end in one small file read whole.
    writeFileSync(path, LIVE07_I);
    expect(await readRolloutLastTurn(path)).toEqual({ text: LIVE07_I, whole: true });
  });
});
