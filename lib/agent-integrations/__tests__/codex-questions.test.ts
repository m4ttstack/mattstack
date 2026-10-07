import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import pino from "pino";
import type { SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import type { EventsBus } from "../../daemon/events-bus.ts";
import { createGatePush } from "../../daemon/gate-push.ts";
import { createGatesStore, type GateRow, type GatesStore } from "../../daemon/gates-store.ts";
import { createGateHandlers } from "../../daemon/handlers/gate.ts";
import {
  connectCodexControl, type CodexClock, type CodexControl, type CodexSocket, type CodexSocketHandlers,
} from "../codex/control.ts";
import { codexIntegration } from "../codex/integration.ts";
import {
  bindCodexQuestion, createCodexQuestions, gateQuestionsOf, nativeAnswersOf, OTHER_VALUE, rolloutEvidence,
  type CodexQuestionAdapter,
} from "../codex/questions.ts";
import {
  CODEX_EVIDENCE_OUTSIDE_PROTOCOL, CODEX_METHODS, CODEX_PROTOCOL_VERSION, CODEX_SERVER_REQUEST_REPLIES, type CodexQuestionRequest,
} from "../codex/protocol.ts";
import { createCodexSessions, type CodexSessionAdapter } from "../codex/sessions.ts";
import { nudgedQuestion } from "../claude/questions.ts";
import { createGateQuestions, gateCommandsVia, type GateCommands, type GateQuestions } from "../questions.ts";

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
  sockets: FakeSocket[] = [];
  /** Answers each connection wrote, in order. */
  replies: Array<{ socket: FakeSocket; message: Message }> = [];
  resolveOnReply = true;
  status: Message = { type: "active", activeFlags: ["waitingOnUserInput"] };

  restart(): void {
    this.nextId = 0;
    for (const s of this.sockets) s.handlers.close();
    for (const [thread, p] of this.pending) this.pending.set(thread, { ...p, id: this.nextId++ });
  }

  ask(threadId: string, turnId: string, itemId: string, questions: Message[]): number {
    const id = this.nextId++;
    const params = { threadId, turnId, itemId, questions, isBlocking: true, autoResolutionMs: null };
    this.pending.set(threadId, { id, params });
    for (const s of this.live()) s.push({ method: "thread/status/changed", params: { threadId, status: { type: "active", activeFlags: ["waitingOnUserInput"] } } });
    for (const s of this.live()) if (s.subscribed.has(threadId)) s.push({ method: "item/tool/requestUserInput", id, params });
    return id;
  }

  resolve(threadId: string): void {
    const p = this.pending.get(threadId);
    if (!p) return;
    this.pending.delete(threadId);
    for (const s of this.live()) s.push({ method: "serverRequest/resolved", params: { threadId, requestId: p.id } });
  }

  interrupt(threadId: string, turnId: string): void {
    for (const s of this.live()) s.push({ method: "turn/completed", params: { threadId, turn: { id: turnId, items: [], status: "interrupted" } } });
    this.resolve(threadId);
  }

  live(): FakeSocket[] {
    return this.sockets.filter((s) => !s.closed);
  }

  handle(s: FakeSocket, m: Message): void {
    if (m.method === "initialize") {
      s.push({ id: m.id, result: { codexHome: "/redacted/.codex", platformFamily: "unix", platformOs: "macos", userAgent: "t" } });
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
        s.push({ id: m.id, result: { thread: { id: threadId, status: this.status, path: `/rollouts/${threadId}.jsonl`, turns: [] } } });
        return;
      case "thread/resume": {
        s.subscribed.add(threadId);
        s.push({ id: m.id, result: { thread: { id: threadId, status: this.status, path: `/rollouts/${threadId}.jsonl` } } });
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

async function world(opts: { enabled?: boolean; mode?: "herdr" | "headless"; paneRuns?: boolean } = {}) {
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
  handlersRef.h = createGateHandlers(store, { emitAt: () => nextEvent++ } as unknown as EventsBus, () => {}, { push, log });

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
      readRollout: async () => server.rollout,
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
    server, store, service, sessions, switchOn, pane, emitted, connect, socket, sent, answersSent, gates,
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
        { value: OTHER_VALUE, label: "Other", description: "Answer in your own words." },
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
    expect(row.answer).toMatchObject({ answers: { color: "Red", size: { value: OTHER_VALUE, text: "Medium-ish" } }, session: "T1" });
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

  test("a question with no options is free text, and answers map back verbatim", () => {
    const [q] = gateQuestionsOf([{ id: "why", header: "", question: "Why?", isOther: false, isSecret: false, options: null }]);
    expect(q).toEqual({ id: "why", label: "Why?", multi: false, options: [] });
    const row = { questions: [q!], answer: { answers: { why: "because" }, by: "console", answeredAt: 1 } } as unknown as GateRow;
    expect(nativeAnswersOf(row, ["why"])).toEqual({ ok: true, data: { why: { answers: ["because"] } } });
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
