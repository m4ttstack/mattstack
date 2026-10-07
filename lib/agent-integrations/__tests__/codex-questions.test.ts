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
  ANSWER_VALUE, bindCodexQuestion, createCodexQuestions, gateQuestionsOf, MAX_PRESENT_ATTEMPTS, nativeAnswersOf, OTHER_VALUE, readRolloutTail, rolloutEvidence,
  type CodexQuestionAdapter,
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
        s.push({ id: m.id, result: { thread: { id: threadId, status: this.replyStatus ?? this.status, path: this.pathFor(threadId), turns: [] } } });
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
  const reads: string[] = [];

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
      bindingOf: (threadId) => [...sessions.values()].find((b) => b.native.value === threadId) ?? null,
      service: () => service,
      sessions: adapter,
      readRollout: async (path) => {
        reads.push(path);
        return { text: server.rolloutQueue.shift() ?? server.rollout, whole: server.rolloutWhole };
      },
      sleep: async () => {},
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
    server, store, service, sessions, switchOn, pane, emitted, connect, socket, sent, answersSent, gates, reads,
    handlers: () => handlersRef.h!, pushes: () => pushes,
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
