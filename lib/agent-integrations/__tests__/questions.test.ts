import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import pino from "pino";
import type { Outcome, QuestionBinding, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import { validateGateAnswers } from "../../../packages/rt-client/src/gate-answers.ts";
import type { EventsBus } from "../../daemon/events-bus.ts";
import { createGatePush } from "../../daemon/gate-push.ts";
import { createGatesStore, type GateQuestion, type GateRow, type GatesStore } from "../../daemon/gates-store.ts";
import { createGateHandlers } from "../../daemon/handlers/gate.ts";
import type { QuestionAdapter } from "../contracts.ts";
import {
  answerFingerprint, bindGateQuestion, completeGateQuestion, createGateQuestions, recoverGateQuestions, setGateQuestions,
  type GateQuestionDeps, type GateQuestions,
} from "../questions.ts";

const log = pino({ level: "silent" });

let dirs: string[] = [];
beforeEach(() => { dirs = []; });
afterEach(() => {
  setGateQuestions(null);
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function dbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "rt-gate-questions-"));
  dirs.push(dir);
  return join(dir, "gates.db");
}

/** Two questions, one multi-select and one free-text, so an answer can never be one string. */
function twoQuestions(): GateQuestion[] {
  return [
    { id: "scope", label: "Which parts?", multi: true, options: ["api", "ui", "docs"] },
    { id: "why", label: "Why?", multi: false, options: [] },
  ];
}

type CompleteResult = Outcome<"completed" | "pending" | "gone" | "conflict">;
type Call = { binding: SessionBinding; question: QuestionBinding; row: GateRow };

/** A question adapter that answers from a script and records every native call. */
function fakeAdapter(script: (call: Call, n: number) => CompleteResult | Promise<CompleteResult> = () => ({ ok: true, data: "completed" })) {
  const calls: Call[] = [];
  const adapter: QuestionAdapter = {
    async complete(binding, question, row) {
      const call = { binding, question, row };
      calls.push(call);
      return script(call, calls.length);
    },
  };
  return { adapter, calls };
}

function session(key = "s1", generation = 1, value = "thread-1"): SessionBinding {
  return {
    key, identity: `id-${key}`,
    native: { harness: "codex", profile: "default", kind: "id", value },
    attachment: { generation, mode: "headless" },
  };
}

function setup(opts: {
  path?: string;
  adapter?: QuestionAdapter;
  enabled?: boolean;
  deps?: Partial<GateQuestionDeps>;
  runSpawnedBy?: (runId: string) => string | null;
  herdShepherd?: (herdId: string) => string | null;
} = {}) {
  const store = createGatesStore({ dbPath: opts.path ?? dbPath(), log });
  const sessions = new Map<string, SessionBinding>([["s1", session()]]);
  const switchOn = { value: opts.enabled ?? true };
  const link = { value: "conn-1" as string | null };
  const shutdown = new AbortController();
  const fake = opts.adapter ? { adapter: opts.adapter, calls: [] as Call[] } : fakeAdapter();
  const questions = createGateQuestions({
    gates: store,
    storedBinding: (key) => sessions.get(key) ?? null,
    supports: (harness) => harness === "codex",
    questionsFor: async () => fake.adapter,
    connectionOf: () => link.value,
    harnesses: () => ["codex"],
    enabled: () => switchOn.value,
    signal: shutdown.signal,
    log,
    ...opts.deps,
  });
  const pushed: Array<{ session: string; body: string }> = [];
  const push = createGatePush({
    store,
    deliver: async (socketPath, body) => { pushed.push({ session: socketPath, body }); return { ok: true as const }; },
    resolveSession: (sessionId) => ({ socketPath: sessionId }),
    log,
    native: questions,
  });
  let nextId = 1;
  const bus = { emitAt: () => nextId++ } as unknown as EventsBus;
  const handlers = createGateHandlers(store, bus, () => {}, {
    push, log, runSpawnedBy: opts.runSpawnedBy, herdShepherd: opts.herdShepherd,
  });
  return { store, questions, handlers, sessions, switchOn, link, shutdown, fake, pushed };
}

function questionFor(gateId: string, over: Partial<QuestionBinding> = {}): QuestionBinding {
  return {
    gateId, sessionKey: "s1", generation: 1,
    nativeThread: "thread-1", nativeTurn: "turn-1", nativeItem: "item-1",
    nativeQuestions: ["scope", "why"], presentation: "form",
    ...over,
  };
}

function openGate(store: GatesStore, subject = "run:r1", extra: Parameters<GatesStore["open"]>[0] extends infer P ? Partial<P> : never = {}): GateRow {
  return store.open({ subject, kind: "clarify", questions: twoQuestions(), ...extra }).row;
}

const ANSWERS = { scope: ["api", "docs"], why: { value: "", text: "the docs drifted from the api" } };

describe("answer survives failed completion", () => {
  test("a failed native completion keeps the winning answer and leaves completion pending", async () => {
    const fake = fakeAdapter(() => ({ ok: false, error: { code: "transient", message: "socket closed" } }));
    const { store, questions, handlers, pushed } = setup({ adapter: fake.adapter });
    const gate = openGate(store);
    expect(questions.bindGateQuestion(questionFor(gate.id))).toEqual({ ok: true, data: undefined });

    const res = await handlers["gate:answer"]({ id: gate.id, answers: ANSWERS, by: "console" });
    expect(res.ok).toBe(true);
    const winningAnswer = res.ok ? res.data.row.answer : null;
    await questions.idle();

    expect(store.get(gate.id)!.answer).toEqual(winningAnswer);
    const completion = questions.completion(gate.id)!;
    expect(completion.state).toBe("pending");
    expect(completion.fingerprint).toBe(answerFingerprint(store.get(gate.id)!));
    expect(store.get(gate.id)!.consumedAt).toBeNull();
    // The native question owns the pane: no doorbell went to an inbox.
    expect(pushed).toEqual([]);
  });

  test("the adapter receives every question's structured answer, never one flattened string", async () => {
    const fake = fakeAdapter();
    const { store, questions, handlers } = setup({ adapter: fake.adapter });
    const gate = openGate(store);
    questions.bindGateQuestion(questionFor(gate.id));

    await handlers["gate:answer"]({ id: gate.id, answers: ANSWERS, by: "console" });
    await questions.idle();

    expect(fake.calls).toHaveLength(1);
    const sent = fake.calls[0]!.row.answer!.answers;
    expect(sent).toEqual(ANSWERS);
    expect(validateGateAnswers(fake.calls[0]!.row.questions, sent)).toBeNull();
    expect(fake.calls[0]!.question.nativeQuestions).toEqual(["scope", "why"]);
    expect(questions.completion(gate.id)!.state).toBe("completed");
    expect(store.get(gate.id)!.consumedAt).not.toBeNull();
  });

  test("intent is persisted, with the answer's fingerprint, before the native side effect", async () => {
    let seen: ReturnType<GateQuestions["completion"]> = null;
    let questionsRef: GateQuestions | undefined;
    const fake = fakeAdapter((call) => {
      seen = questionsRef!.completion(call.row.id);
      return { ok: true, data: "completed" };
    });
    const { store, questions, handlers } = setup({ adapter: fake.adapter });
    questionsRef = questions;
    const gate = openGate(store);
    questions.bindGateQuestion(questionFor(gate.id));

    await handlers["gate:answer"]({ id: gate.id, answers: ANSWERS, by: "console" });
    await questions.idle();

    expect(seen).not.toBeNull();
    expect(seen!.state).toBe("pending");
    expect(seen!.fingerprint).toBe(answerFingerprint(store.get(gate.id)!));
  });

  test("a native `pending` keeps the answer and the completion pending", async () => {
    const fake = fakeAdapter(() => ({ ok: true, data: "pending" }));
    const { store, questions, handlers } = setup({ adapter: fake.adapter });
    const gate = openGate(store);
    questions.bindGateQuestion(questionFor(gate.id));
    const res = await handlers["gate:answer"]({ id: gate.id, answers: ANSWERS, by: "console" });
    await questions.idle();
    expect(store.get(gate.id)!.answer).toEqual(res.ok ? res.data.row.answer : null);
    expect(questions.completion(gate.id)!.state).toBe("pending");
  });

  test("a divergent native reply is a conflict: the winning answer stands and nothing is marked consumed", async () => {
    const fake = fakeAdapter(() => ({ ok: true, data: "conflict" }));
    const emitted: Array<{ topic: string; payload: Record<string, unknown> }> = [];
    const { store, questions, handlers } = setup({ adapter: fake.adapter, deps: { emit: (topic, payload) => emitted.push({ topic, payload }) } });
    const gate = openGate(store);
    questions.bindGateQuestion(questionFor(gate.id));
    const res = await handlers["gate:answer"]({ id: gate.id, answers: ANSWERS, by: "console" });
    await questions.idle();

    expect(store.get(gate.id)!.answer).toEqual(res.ok ? res.data.row.answer : null);
    expect(questions.completion(gate.id)!.state).toBe("conflict");
    expect(store.get(gate.id)!.consumedAt).toBeNull();
    expect(emitted).toEqual([{ topic: "gate.native-conflict", payload: expect.objectContaining({ gateId: gate.id }) }]);
    // Terminal: a later completion never re-runs the native side effect.
    await questions.completeGateQuestion(gate.id);
    expect(fake.calls).toHaveLength(1);
    expect(questions.completion(gate.id)!.state).toBe("conflict");
  });
});

describe("answer before wait", () => {
  test("a gate answered before its native question was bound completes with the stored answer", async () => {
    const fake = fakeAdapter();
    const { store, questions, handlers } = setup({ adapter: fake.adapter });
    const gate = openGate(store);
    const res = await handlers["gate:answer"]({ id: gate.id, answers: ANSWERS, by: "console" });
    const winningAnswer = res.ok ? res.data.row.answer : null;
    await questions.idle();
    expect(fake.calls).toHaveLength(0);

    const waited = await handlers["gate:wait"]({ id: gate.id, waitMs: 10 });
    expect(waited).toMatchObject({ ok: true, data: { status: "answered" } });

    expect(questions.bindGateQuestion(questionFor(gate.id)).ok).toBe(true);
    await questions.idle();

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.row.answer).toEqual(winningAnswer);
    expect(store.get(gate.id)!.answer).toEqual(winningAnswer);
    expect(questions.completion(gate.id)!.state).toBe("completed");
  });

  test("a wait registered before the answer still returns the authoritative row", async () => {
    const { store, questions, handlers } = setup();
    const gate = openGate(store);
    questions.bindGateQuestion(questionFor(gate.id));
    const waiting = handlers["gate:wait"]({ id: gate.id, waitMs: 5_000 });
    const res = await handlers["gate:answer"]({ id: gate.id, answers: ANSWERS, by: "console" });
    const waited = await waiting;
    await questions.idle();
    expect(waited.ok && waited.data.status === "answered" ? waited.data.row?.answer : null).toEqual(res.ok ? res.data.row.answer : null);
  });
});

describe("first answer wins", () => {
  test("racing answers: the first commits, the second is a conflict, and completion carries the winner", async () => {
    const fake = fakeAdapter();
    const { store, questions, handlers } = setup({ adapter: fake.adapter });
    const gate = openGate(store);
    questions.bindGateQuestion(questionFor(gate.id));

    const [first, second] = await Promise.all([
      handlers["gate:answer"]({ id: gate.id, answers: ANSWERS, by: "console" }),
      handlers["gate:answer"]({ id: gate.id, answers: { scope: ["ui"], why: "native reply" }, by: "pane", session: "thread-1" }),
    ]);
    await questions.idle();

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true, data: { conflict: true } });
    const winner = store.get(gate.id)!;
    expect(winner.answer!.answers).toEqual(ANSWERS);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.row.answer!.answers).toEqual(ANSWERS);
    expect(questions.completion(gate.id)!.fingerprint).toBe(answerFingerprint(winner));
  });

  test("a self-answer by the bound session completes without a native side effect", async () => {
    const fake = fakeAdapter();
    const { store, questions, handlers } = setup({ adapter: fake.adapter });
    const gate = openGate(store);
    questions.bindGateQuestion(questionFor(gate.id));

    await handlers["gate:answer"]({ id: gate.id, answers: ANSWERS, by: "pane", session: "thread-1" });
    await questions.idle();

    expect(fake.calls).toHaveLength(0);
    expect(questions.completion(gate.id)!.state).toBe("completed");
    expect(store.get(gate.id)!.consumedAt).not.toBeNull();
  });

  test("an authorized override still answers a herd-owned gate, and completion carries the overridden row", async () => {
    const fake = fakeAdapter();
    const { store, questions, handlers } = setup({
      adapter: fake.adapter,
      runSpawnedBy: () => "herd:h1",
      herdShepherd: () => "shepherd-session",
    });
    const opened = await handlers["gate:open"]({
      subject: "run:r1", kind: "clarify", questions: twoQuestions(), origin: { runId: "r1" },
    });
    const id = opened.ok ? opened.data.id : "";
    questions.bindGateQuestion(questionFor(id));

    const refused = await handlers["gate:answer"]({ id, answers: ANSWERS, by: "console", session: "someone-else" });
    expect(refused).toMatchObject({ ok: false, error: "owned-by" });
    await questions.idle();
    expect(questions.completion(id)).toBeNull();
    expect(fake.calls).toHaveLength(0);

    const overridden = await handlers["gate:answer"]({ id, answers: ANSWERS, by: "human", override: true });
    expect(overridden.ok).toBe(true);
    await questions.idle();
    expect(store.get(id)!.answer!.overridden).toBe(true);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.row.answer!.overridden).toBe(true);
  });

  test("an invalid answer never commits and never starts a completion", async () => {
    const fake = fakeAdapter();
    const { store, questions, handlers } = setup({ adapter: fake.adapter });
    const gate = openGate(store);
    questions.bindGateQuestion(questionFor(gate.id));
    const res = await handlers["gate:answer"]({ id: gate.id, answers: { scope: "api", why: "x" }, by: "console" });
    expect(res).toMatchObject({ ok: false, error: "question scope expects an array (multi)" });
    await questions.idle();
    expect(store.get(gate.id)!.status).toBe("open");
    expect(questions.completion(gate.id)).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });
});

describe("closed is not answered", () => {
  test("a closed gate completes as closed: no answer, nothing consumed, and later answers are refused", async () => {
    const fake = fakeAdapter();
    const { store, questions, handlers } = setup({ adapter: fake.adapter });
    const gate = openGate(store);
    questions.bindGateQuestion(questionFor(gate.id));

    await handlers["gate:close"]({ id: gate.id, reason: "abandoned" });
    await questions.idle();

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.row.status).toBe("closed");
    expect(fake.calls[0]!.row.answer).toBeNull();
    const closed = store.get(gate.id)!;
    expect(questions.completion(gate.id)!.fingerprint).toBe(answerFingerprint(closed));
    expect(closed.consumedAt).toBeNull();

    const late = await handlers["gate:answer"]({ id: gate.id, answers: ANSWERS, by: "pane", session: "thread-1" });
    expect(late).toMatchObject({ ok: false, error: "gate-closed" });
    expect(store.get(gate.id)!.answer).toBeNull();
    const waited = await handlers["gate:wait"]({ id: gate.id, waitMs: 10 });
    expect(waited).toMatchObject({ ok: true, data: { status: "closed" } });
    await questions.idle();
    expect(fake.calls).toHaveLength(1);
  });

  test("a gate superseded from the same pane still ends its native question", async () => {
    const fake = fakeAdapter();
    const { store, questions, handlers } = setup({ adapter: fake.adapter });
    const origin = { presentation: "wait" as const, paneId: "bg:w1:p2" };
    const first = await handlers["gate:open"]({ subject: "run:r1", kind: "clarify", questions: twoQuestions(), origin });
    const firstId = first.ok ? first.data.id : "";
    questions.bindGateQuestion(questionFor(firstId));

    await handlers["gate:open"]({ subject: "run:r1", kind: "clarify", questions: twoQuestions(), origin });
    await questions.idle();

    expect(store.get(firstId)!.status).toBe("closed");
    expect(fake.calls.map((c) => c.row.id)).toEqual([firstId]);
    expect(fake.calls[0]!.row.closedReason).toBe("superseded");
  });

  test("a closed gate can be bound, and it is never presented as answered", async () => {
    const fake = fakeAdapter();
    const { store, questions } = setup({ adapter: fake.adapter });
    const gate = openGate(store);
    store.close(gate.id, "abandoned");
    expect(questions.bindGateQuestion(questionFor(gate.id)).ok).toBe(true);
    await questions.idle();
    expect(fake.calls[0]!.row.status).toBe("closed");
    expect(fake.calls[0]!.row.answer).toBeNull();
  });
});

describe("binding", () => {
  test("refuses with the switch off, an unknown gate, a stale generation, or a question the gate does not ask", () => {
    const { store, questions, switchOn, sessions } = setup();
    const gate = openGate(store);
    expect(questions.bindGateQuestion(questionFor("nope")).ok).toBe(false);
    expect(questions.bindGateQuestion(questionFor(gate.id, { nativeQuestions: ["scope", "other"] }))).toMatchObject({ ok: false, error: { code: "invalid" } });
    sessions.set("s1", session("s1", 2));
    expect(questions.bindGateQuestion(questionFor(gate.id))).toMatchObject({ ok: false, error: { code: "stale-binding" } });
    sessions.set("s1", session("s1", 1));
    switchOn.value = false;
    expect(questions.bindGateQuestion(questionFor(gate.id))).toMatchObject({ ok: false, error: { code: "unsupported" } });
    switchOn.value = true;
    expect(questions.bindGateQuestion(questionFor(gate.id)).ok).toBe(true);
    // The same binding again is a no-op; a different native item for the same gate is refused.
    expect(questions.bindGateQuestion(questionFor(gate.id)).ok).toBe(true);
    expect(questions.bindGateQuestion(questionFor(gate.id, { nativeItem: "item-2" }))).toMatchObject({ ok: false, error: { code: "refused" } });
  });

  test("refuses a harness with no native question completion", () => {
    const { store, questions, sessions } = setup();
    const gate = openGate(store);
    sessions.set("s1", { ...session(), native: { ...session().native, harness: "claude" } });
    expect(questions.bindGateQuestion(questionFor(gate.id))).toMatchObject({ ok: false, error: { code: "unsupported" } });
  });

  test("the module-level verbs reach the installed service, and refuse without one", async () => {
    const { store, questions } = setup();
    const gate = openGate(store);
    expect(bindGateQuestion(questionFor(gate.id))).toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(await recoverGateQuestions()).toEqual({ completed: 0, pending: 0 });
    setGateQuestions(questions);
    expect(bindGateQuestion(questionFor(gate.id)).ok).toBe(true);
    store.answer(gate.id, ANSWERS, "console");
    expect((await completeGateQuestion(gate.id)).ok).toBe(true);
  });
});

describe("switch and binding gates", () => {
  test("with the switch off a bound gate is pushed as today and no adapter runs", async () => {
    const fake = fakeAdapter();
    const { store, questions, handlers, switchOn, pushed } = setup({ adapter: fake.adapter });
    const gate = openGate(store, "run:r1", { nudge: { session: "sess-1" } });
    questions.bindGateQuestion(questionFor(gate.id));
    switchOn.value = false;

    await handlers["gate:answer"]({ id: gate.id, answers: ANSWERS, by: "console" });
    await questions.idle();
    await new Promise((r) => setTimeout(r, 0));

    expect(fake.calls).toHaveLength(0);
    expect(questions.completion(gate.id)).toBeNull();
    expect(pushed.map((p) => p.session)).toEqual(["sess-1"]);
    expect(await questions.recoverGateQuestions()).toEqual({ completed: 0, pending: 0 });
  });

  test("a gate no harness asked never reads the switch on its way through the gate verbs", async () => {
    let reads = 0;
    const { store, questions, handlers } = setup({ deps: { enabled: () => { reads++; return false; } } });
    const gate = openGate(store, "run:r1", { nudge: { session: "sess-1" }, origin: { presentation: "wait", paneId: "w1:p1" } });
    await handlers["gate:open"]({ subject: "run:r1", kind: "clarify", questions: twoQuestions(), origin: { presentation: "wait", paneId: "w1:p1" } });
    const next = store.list({ open: true }).gates[0]!;
    await handlers["gate:answer"]({ id: next.id, answers: ANSWERS, by: "console" });
    await handlers["gate:close"]({ id: openGate(store, "run:r2").id, reason: "abandoned" });
    await questions.idle();
    await new Promise((r) => setTimeout(r, 0));
    expect(store.get(gate.id)!.status).toBe("closed");
    expect(reads).toBe(0);
  });

  test("an unbound gate with the switch on is pushed as today", async () => {
    const fake = fakeAdapter();
    const { store, questions, handlers, pushed } = setup({ adapter: fake.adapter });
    const gate = openGate(store, "run:r1", { nudge: { session: "sess-1" } });
    await handlers["gate:answer"]({ id: gate.id, answers: ANSWERS, by: "console" });
    await questions.idle();
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.calls).toHaveLength(0);
    expect(pushed.map((p) => p.session)).toEqual(["sess-1"]);
  });
});

describe("attachment and generation", () => {
  test("a question from a replaced attachment is gone, never answered against the new one", async () => {
    const fake = fakeAdapter();
    const { store, questions, sessions } = setup({ adapter: fake.adapter });
    const gate = openGate(store);
    questions.bindGateQuestion(questionFor(gate.id));
    sessions.set("s1", session("s1", 2));
    store.answer(gate.id, ANSWERS, "console");

    const out = await questions.completeGateQuestion(gate.id);
    expect(out).toMatchObject({ ok: false, error: { code: "stale-binding" } });
    expect(fake.calls).toHaveLength(0);
    expect(questions.completion(gate.id)!.state).toBe("gone");
    expect(store.get(gate.id)!.answer!.answers).toEqual(ANSWERS);
  });

  test("a result that comes back after the attachment changed is not applied", async () => {
    let sessionsRef: Map<string, SessionBinding> | undefined;
    const fake = fakeAdapter(() => {
      sessionsRef!.set("s1", session("s1", 2));
      return { ok: true, data: "completed" };
    });
    const { store, questions, sessions } = setup({ adapter: fake.adapter });
    sessionsRef = sessions;
    const gate = openGate(store);
    questions.bindGateQuestion(questionFor(gate.id));
    store.answer(gate.id, ANSWERS, "console");

    await questions.completeGateQuestion(gate.id);
    expect(questions.completion(gate.id)!.state).toBe("pending");
    expect(store.get(gate.id)!.consumedAt).toBeNull();
  });

  test("shutdown cancels an in-flight completion and its late result is never applied", async () => {
    let release: (r: CompleteResult) => void = () => {};
    const fake = fakeAdapter(() => new Promise<CompleteResult>((resolve) => { release = resolve; }));
    const { store, questions, shutdown } = setup({ adapter: fake.adapter });
    const gate = openGate(store);
    questions.bindGateQuestion(questionFor(gate.id));
    store.answer(gate.id, ANSWERS, "console");

    const running = questions.completeGateQuestion(gate.id);
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.calls).toHaveLength(1);
    shutdown.abort();
    expect(await running).toMatchObject({ ok: false, error: { code: "not-ready" } });
    await questions.idle();
    release({ ok: true, data: "completed" });
    await new Promise((r) => setTimeout(r, 0));
    expect(questions.completion(gate.id)!.state).toBe("pending");
    expect(store.get(gate.id)!.consumedAt).toBeNull();
  });
});

describe("recovery", () => {
  test("a restart between answer commit and native completion recovers from the stored winning row", async () => {
    const path = dbPath();
    const first = setup({ path, adapter: fakeAdapter(() => ({ ok: false, error: { code: "transient", message: "app server went away" } })).adapter });
    const gate = openGate(first.store);
    first.questions.bindGateQuestion(questionFor(gate.id));
    const res = await first.handlers["gate:answer"]({ id: gate.id, answers: ANSWERS, by: "console" });
    const winningAnswer = res.ok ? res.data.row.answer : null;
    await first.questions.idle();
    const fingerprint = first.questions.completion(gate.id)!.fingerprint;
    first.shutdown.abort();
    first.store.close_();

    const fake = fakeAdapter();
    const second = setup({ path, adapter: fake.adapter });
    expect(second.questions.completion(gate.id)!.state).toBe("pending");
    expect(await second.questions.recoverGateQuestions()).toEqual({ completed: 1, pending: 0 });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.row.answer).toEqual(winningAnswer);
    expect(fake.calls[0]!.question).toEqual(questionFor(gate.id));
    expect(second.store.get(gate.id)!.answer).toEqual(winningAnswer);
    expect(second.questions.completion(gate.id)).toMatchObject({ state: "completed", fingerprint });
    expect(second.store.get(gate.id)!.consumedAt).not.toBeNull();
    second.store.close_();
  });

  test("a crash before the intent was written is recovered too", async () => {
    const path = dbPath();
    const first = setup({ path });
    const gate = openGate(first.store);
    first.questions.bindGateQuestion(questionFor(gate.id));
    first.store.answer(gate.id, ANSWERS, "console");
    first.store.close_();

    const fake = fakeAdapter();
    const second = setup({ path, adapter: fake.adapter });
    expect(second.questions.completion(gate.id)).toBeNull();
    expect(await second.questions.recoverGateQuestions()).toEqual({ completed: 1, pending: 0 });
    expect(fake.calls[0]!.row.answer!.answers).toEqual(ANSWERS);
    second.store.close_();
  });

  test("recovery leaves open gates alone and counts what stays pending", async () => {
    const fake = fakeAdapter(() => ({ ok: true, data: "pending" }));
    const { store, questions } = setup({ adapter: fake.adapter });
    const open = openGate(store, "run:a");
    const answered = openGate(store, "run:b");
    questions.bindGateQuestion(questionFor(open.id));
    questions.bindGateQuestion(questionFor(answered.id));
    store.answer(answered.id, ANSWERS, "console");

    expect(await questions.recoverGateQuestions()).toEqual({ completed: 0, pending: 1 });
    expect(fake.calls.map((c) => c.row.id)).toEqual([answered.id]);
  });

  test("a native reconnect retries pending completions; an unchanged connection does not", async () => {
    let n = 0;
    const fake = fakeAdapter(() => (++n === 1 ? { ok: true, data: "pending" } : { ok: true, data: "completed" }));
    const { store, questions, link } = setup({ adapter: fake.adapter });
    const gate = openGate(store);
    questions.bindGateQuestion(questionFor(gate.id));
    store.answer(gate.id, ANSWERS, "console");
    expect(await questions.recoverGateQuestions()).toEqual({ completed: 0, pending: 1 });

    await questions.noteConnections();
    expect(fake.calls).toHaveLength(1);

    link.value = "conn-2";
    await questions.noteConnections();
    await questions.idle();
    expect(fake.calls).toHaveLength(2);
    expect(questions.completion(gate.id)!.state).toBe("completed");
  });

  test("the reconnect tick reads the switch only when a connection changed, and recovers nothing while it is off", async () => {
    let reads = 0;
    const switchOn = { value: true };
    const fake = fakeAdapter(() => ({ ok: true, data: "pending" }));
    const { store, questions, link } = setup({ adapter: fake.adapter, deps: { enabled: () => { reads++; return switchOn.value; } } });
    const gate = openGate(store);
    questions.bindGateQuestion(questionFor(gate.id));
    store.answer(gate.id, ANSWERS, "console");
    await questions.recoverGateQuestions();
    switchOn.value = false;
    reads = 0;

    await questions.noteConnections();
    expect(reads).toBe(0);
    link.value = "conn-2";
    await questions.noteConnections();
    expect(reads).toBe(1);
    expect(fake.calls).toHaveLength(1);
  });
});
