import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  connectCodexControl, discoverCodexEndpoint,
  type CodexClock, type CodexControl, type CodexSocket, type CodexSocketHandlers,
} from "../codex/control.ts";
import { CODEX_EVENT_FIELDS, CODEX_METHODS, CODEX_METHODS_OUTSIDE_FIXTURE, CODEX_PROTOCOL_VERSION, CODEX_STATUS_ENUMS } from "../codex/protocol.ts";

type Event = Parameters<Parameters<CodexControl["subscribe"]>[0]>[0];
type Message = Record<string, any>;

class FakeClock implements CodexClock {
  private seq = 0;
  private now = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.set(id, { at: this.now + ms, fn });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }
  advance(ms: number): void {
    this.now += ms;
    for (const [id, timer] of [...this.timers].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at > this.now || !this.timers.has(id)) continue;
      this.timers.delete(id);
      timer.fn();
    }
  }
  get active(): number {
    return this.timers.size;
  }
}

class FakeSocket implements CodexSocket {
  sent: Message[] = [];
  closed = false;
  constructor(readonly handlers: CodexSocketHandlers, private onSend: (socket: FakeSocket, message: Message) => void) {}
  send(text: string): void {
    if (this.closed) throw new Error("socket is closed");
    const message = JSON.parse(text);
    this.sent.push(message);
    this.onSend(this, message);
  }
  close(): void {
    this.closed = true;
  }
  push(message: Message | string): void {
    this.handlers.message(typeof message === "string" ? message : JSON.stringify(message));
  }
}

const INIT_RESULT = { codexHome: "/redacted/.codex", platformFamily: "unix", platformOs: "macos", userAgent: "test" };

type ServerScript = {
  open?: boolean;
  initialize?: (socket: FakeSocket, message: Message) => void;
  initialized?: (socket: FakeSocket) => void;
  request?: (socket: FakeSocket, message: Message) => void;
};

const sockets: FakeSocket[] = [];
const clocks: FakeClock[] = [];
const controls: CodexControl[] = [];

function harness(script: ServerScript = {}) {
  const clock = new FakeClock();
  clocks.push(clock);
  const logs: { level: string; message: string; fields?: unknown }[] = [];
  const openSocket = (_path: string, handlers: CodexSocketHandlers): CodexSocket => {
    const socket = new FakeSocket(handlers, (s, message) => {
      if (message.method === "initialize") {
        if (script.initialize) script.initialize(s, message);
        else s.push({ id: message.id, result: INIT_RESULT });
      } else if (message.method === "initialized") script.initialized?.(s);
      else if (message.method !== undefined) script.request?.(s, message);
    });
    sockets.push(socket);
    if (script.open !== false) queueMicrotask(() => handlers.open());
    return socket;
  };
  const deps = {
    openSocket, clock, timeoutMs: 1000,
    log: (level: "debug" | "warn", message: string, fields?: unknown) => logs.push({ level, message, fields }),
  };
  const connect = async (options: { threads?: string[]; experimental?: boolean } = {}) => {
    const control = await connectCodexControl({ socketPath: "/tmp/codex.sock", profile: "default", ...options }, deps);
    controls.push(control);
    return control;
  };
  return { clock, logs, connect, socket: () => sockets[sockets.length - 1]!, deps };
}

function collect(control: CodexControl): Event[] {
  const events: Event[] = [];
  control.subscribe((event) => events.push(event));
  return events;
}

const question = (id: number | string, threadId: string, extra: Message = {}) => ({
  id, method: "item/tool/requestUserInput",
  params: {
    threadId, turnId: "U1", itemId: "I1", isBlocking: true,
    questions: [{ id: "q1", header: "Pick", question: "Which?", isOther: false, isSecret: false, options: null }],
    ...extra,
  },
});
const threadStarted = (id: string, cwd?: string) => ({
  method: "thread/started", params: { thread: { id, cwd, status: { type: "idle" } } },
});
const turnStarted = (threadId: string) => ({
  method: "turn/started", params: { threadId, turn: { id: "U1", items: [], status: "inProgress" } },
});

async function rejection(promise: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    return error as { code?: string; message: string };
  }
  throw new Error("expected the promise to reject");
}

afterEach(() => {
  for (const control of controls.splice(0)) control.close();
  expect(sockets.splice(0).every((socket) => socket.closed)).toBe(true);
  expect(clocks.splice(0).every((clock) => clock.active === 0)).toBe(true);
});

describe("codex control", () => {
  test("buffers early owned events", async () => {
    const h = harness({
      initialized: (s) => {
        s.push(turnStarted("T1"));
        s.push(question(5, "T1"));
      },
    });
    const control = await h.connect({ threads: ["T1"] });
    const first = collect(control);
    expect(first.map((e) => e.method)).toEqual(["turn/started", "item/tool/requestUserInput"]);

    h.socket().push({ method: "thread/closed", params: { threadId: "T1" } });
    expect(first.map((e) => e.method)).toEqual(["turn/started", "item/tool/requestUserInput", "thread/closed"]);

    const second = collect(control);
    expect(second).toEqual([]);
  });

  test("request zero survives", async () => {
    const h = harness({ initialized: (s) => s.push(question(0, "T1")) });
    const control = await h.connect({ threads: ["T1"] });
    expect(h.socket().sent[0]).toMatchObject({ id: 0, method: "initialize" });

    const events = collect(control);
    expect(events).toHaveLength(1);
    const asked = events[0]!;
    if (asked.method !== "item/tool/requestUserInput") throw new Error("expected a question");
    expect(asked.handle).toEqual({ connection: control.connection, requestId: 0, threadId: "T1", turnId: "U1", itemId: "I1" });

    h.socket().push(question("0", "T1", { itemId: "I2" }));
    const answered = control.respond(asked.handle, { q1: { answers: ["Beta"] } });
    expect(answered.ok).toBe(true);
    expect(h.socket().sent.at(-1)).toEqual({ id: 0, result: { answers: { q1: { answers: ["Beta"] } } } });

    const textual = events[1]!;
    if (textual.method !== "item/tool/requestUserInput") throw new Error("expected a question");
    expect(textual.handle.requestId).toBe("0");
    expect(control.respond(textual.handle, { q1: { answers: ["Gamma"] } }).ok).toBe(true);
    expect(h.socket().sent.at(-1)).toEqual({ id: "0", result: { answers: { q1: { answers: ["Gamma"] } } } });
  });

  test("old connection cannot answer replay", async () => {
    const h = harness({ initialized: (s) => s.push(question(1, "T1")) });
    const old = await h.connect({ threads: ["T1"] });
    const oldSocket = h.socket();
    const oldEvents = collect(old);
    const fresh = await h.connect({ threads: ["T1"] });
    const freshSocket = h.socket();
    const freshEvents = collect(fresh);
    expect(fresh.connection).not.toBe(old.connection);

    const oldHandle = (oldEvents[0] as Extract<Event, { method: "item/tool/requestUserInput" }>).handle;
    const replay = (freshEvents[0] as Extract<Event, { method: "item/tool/requestUserInput" }>).handle;
    expect(replay.requestId).toBe(oldHandle.requestId);
    old.close();

    const answer = { q1: { answers: ["Beta"] } };
    const sentBefore = freshSocket.sent.length;
    const crossed = fresh.respond(oldHandle, answer);
    expect(crossed.ok).toBe(false);
    expect(old.respond(oldHandle, answer).ok).toBe(false);
    expect(fresh.respond({ ...replay, itemId: "I-other" }, answer).ok).toBe(false);
    expect(freshSocket.sent.length).toBe(sentBefore);
    expect(oldSocket.sent.some((m) => "result" in m)).toBe(false);

    expect(fresh.respond(replay, answer).ok).toBe(true);
    expect(freshSocket.sent.length).toBe(sentBefore + 1);
  });

  test("foreign events never escape", async () => {
    const h = harness({
      initialized: (s) => {
        s.push(question(9, "FOREIGN", { secret: "do-not-log" }));
        s.push(turnStarted("FOREIGN"));
        s.push({ method: "thread/started", params: { threadId: "T1", thread: { id: "FOREIGN", status: { type: "idle" } } } });
        s.push({ method: "item/started", params: { threadId: "FOREIGN", turnId: "U9", startedAtMs: 1, item: { type: "userMessage", id: "I9", content: [], clientId: "c1" } } });
        s.push({ method: "serverRequest/resolved", params: { threadId: "FOREIGN", requestId: 9 } });
        s.push(turnStarted("T1"));
      },
    });
    const control = await h.connect({ threads: ["T1"] });
    const events = collect(control);
    expect(events.map((e) => [e.method, e.threadId])).toEqual([["turn/started", "T1"]]);

    const forged = { connection: control.connection, requestId: 9, threadId: "FOREIGN", turnId: "U1", itemId: "I1" };
    const sentBefore = h.socket().sent.length;
    expect(control.respond(forged, { q1: { answers: ["x"] } }).ok).toBe(false);
    expect(control.respond({ ...forged, threadId: "T1" }, { q1: { answers: ["x"] } }).ok).toBe(false);
    expect(h.socket().sent.length).toBe(sentBefore);
    expect(JSON.stringify(h.logs)).not.toContain("do-not-log");
    expect(JSON.stringify(h.logs)).not.toContain("FOREIGN");
  });

  test("method allowlist cannot be bypassed by adding threadId", async () => {
    const h = harness();
    const control = await h.connect({ threads: ["T1"] });
    const sentBefore = h.socket().sent.length;

    for (const [method, params] of [
      ["fs/readFile", { threadId: "T1", path: "/etc/hosts" }],
      ["thread/archive", { threadId: "T1" }],
      ["command/exec", { threadId: "T1", command: ["true"] }],
      ["initialize", { threadId: "T1", clientInfo: { name: "x", version: "1" } }],
      ["thread/resume", { threadId: "FOREIGN" }],
      ["thread/read", { threadId: "FOREIGN", includeTurns: false }],
      ["thread/unsubscribe", { threadId: "FOREIGN" }],
      ["experimentalFeature/list", { threadId: "FOREIGN" }],
      ["thread/start", { cwd: "/elsewhere" }],
    ] as const) {
      const error = await rejection(control.request(method, params));
      expect(error.code).toBe("refused");
    }
    expect((await rejection(control.request("thread/loaded/list", { threadId: "T1" }))).code).toBe("unsupported");
    expect((await rejection(control.request("thread/start", { threadId: "T1", cwd: "/elsewhere" }))).code).toBe("unsupported");
    expect((await rejection(control.request("thread/resume", { threadId: "T1", path: "/x.jsonl" }))).code).toBe("unsupported");
    expect((await rejection(control.request("thread/read", { includeTurns: false }))).code).toBe("invalid");
    expect((await rejection(control.request("thread/unsubscribe", { threadId: "T1", force: true }))).code).toBe("unsupported");
    expect(h.socket().sent.length).toBe(sentBefore);
  });

  test("a pending request rejects on timeout and close", async () => {
    const h = harness();
    const control = await h.connect({ threads: ["T1"] });

    const timed = control.request("thread/read", { threadId: "T1", includeTurns: false });
    h.clock.advance(1000);
    expect(await rejection(timed)).toMatchObject({ code: "transient" });
    expect(h.clock.active).toBe(0);

    const closing = control.request("thread/read", { threadId: "T1", includeTurns: false });
    control.close();
    expect(await rejection(closing)).toMatchObject({ code: "transient" });
    expect(await rejection(control.request("thread/loaded/list", {}))).toMatchObject({ code: "transient" });
    expect(h.socket().closed).toBe(true);
  });

  test("a dropped socket rejects pending requests and refuses answers", async () => {
    const h = harness({ initialized: (s) => s.push(question(3, "T1")) });
    const control = await h.connect({ threads: ["T1"] });
    const [asked] = collect(control) as Extract<Event, { method: "item/tool/requestUserInput" }>[];
    const pending = control.request("thread/read", { threadId: "T1", includeTurns: false });
    h.socket().handlers.close();
    expect(await rejection(pending)).toMatchObject({ code: "transient" });
    expect(control.respond(asked!.handle, { q1: { answers: ["x"] } }).ok).toBe(false);
    expect(h.clock.active).toBe(0);
  });

  test("a duplicate response refuses", async () => {
    let reads = 0;
    const h = harness({
      initialized: (s) => s.push(question(4, "T1")),
      request: (s, m) => {
        reads++;
        s.push({ id: m.id, result: { thread: { id: "T1" }, n: reads } });
        s.push({ id: m.id, result: { thread: { id: "T1" }, n: 99 } });
      },
    });
    const control = await h.connect({ threads: ["T1"] });
    expect(await control.request("thread/read", { threadId: "T1", includeTurns: false })).toMatchObject({ n: 1 });
    expect(await control.request("thread/read", { threadId: "T1", includeTurns: false })).toMatchObject({ n: 2 });
    expect(h.logs.some((l) => l.message.includes("no pending request"))).toBe(true);

    const [asked] = collect(control) as Extract<Event, { method: "item/tool/requestUserInput" }>[];
    expect(control.respond(asked!.handle, { q1: { answers: ["a"] } }).ok).toBe(true);
    const again = control.respond(asked!.handle, { q1: { answers: ["a"] } });
    expect(again).toMatchObject({ ok: false });
  });

  test("a resolved request can no longer be answered", async () => {
    const h = harness({ initialized: (s) => s.push(question(6, "T1")) });
    const control = await h.connect({ threads: ["T1"] });
    const events = collect(control);
    h.socket().push({ method: "serverRequest/resolved", params: { threadId: "T1", requestId: 6 } });
    expect(events.map((e) => e.method)).toEqual(["item/tool/requestUserInput", "serverRequest/resolved"]);
    const asked = events[0] as Extract<Event, { method: "item/tool/requestUserInput" }>;
    expect(control.respond(asked.handle, { q1: { answers: ["late"] } }).ok).toBe(false);
  });

  test("answers must name the request's questions", async () => {
    const h = harness({ initialized: (s) => s.push(question(7, "T1")) });
    const control = await h.connect({ threads: ["T1"] });
    const [asked] = collect(control) as Extract<Event, { method: "item/tool/requestUserInput" }>[];
    expect(control.respond(asked!.handle, { other: { answers: ["x"] } })).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(control.respond(asked!.handle, {})).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(control.respond(asked!.handle, { q1: { answers: [1 as unknown as string] } })).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(control.respond(asked!.handle, { q1: { answers: ["ok"] } }).ok).toBe(true);
  });

  test("malformed owned events are rejected and the connection survives", async () => {
    const h = harness({
      initialized: (s) => {
        s.push("{not json");
        s.push(question(8, "T1", { turnId: undefined }));
        s.push({ method: "turn/completed", params: { threadId: "T1", turn: { id: "U1", items: [], status: "exploded" } } });
        s.push({ method: "item/started", params: { threadId: "T1", turnId: "U1", startedAtMs: 1, item: { type: "userMessage", id: "I1", content: [], clientId: 7 } } });
        s.push({ method: "item/agentMessage/delta", params: { threadId: "T1", turnId: "U1", itemId: "I1", delta: "hi" } });
        s.push({ method: "turn/completed", params: { threadId: "T1", turn: { id: "U1", items: [], status: "completed" } } });
      },
    });
    const control = await h.connect({ threads: ["T1"] });
    const events = collect(control);
    expect(events.map((e) => e.method)).toEqual(["turn/completed"]);
    expect(h.logs.filter((l) => l.level === "warn").length).toBeGreaterThanOrEqual(4);
    expect(control.respond({ connection: control.connection, requestId: 8, threadId: "T1", turnId: "U1", itemId: "I1" }, { q1: { answers: ["x"] } }).ok).toBe(false);
  });

  test("a launch reservation owns only the thread its start created", async () => {
    const h = harness({
      request: (s, m) => {
        if (m.method !== "thread/start") return;
        s.push(threadStarted("X", "/work/elsewhere"));
        s.push(threadStarted("T9", "/work/a"));
        s.push({ id: m.id, result: { thread: { id: "T9" }, cwd: "/work/a" } });
        s.push(turnStarted("X"));
      },
    });
    const control = await h.connect();
    const events = collect(control);

    expect(control.reserveLaunch("relative/dir")).toMatchObject({ ok: false, error: { code: "invalid" } });
    const reserved = control.reserveLaunch("/work/a");
    if (!reserved.ok) throw new Error(reserved.error.message);
    const reservation = reserved.data;
    expect(control.reserveLaunch("/work/a")).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(reservation.state).toBe("reserved");

    expect((await rejection(control.request("thread/start", { cwd: "/work/b" }))).code).toBe("refused");
    await control.request("thread/start", { cwd: "/work/a" });
    expect(reservation.state).toBe("started");
    expect(reservation.threadId).toBe("T9");
    expect(events.map((e) => [e.method, e.threadId])).toEqual([["thread/started", "T9"]]);
    expect((await rejection(control.request("thread/start", { cwd: "/work/a" }))).code).toBe("refused");

    const owned = control.request("thread/read", { threadId: "T9", includeTurns: false });
    h.clock.advance(1000);
    expect((await rejection(owned)).code).toBe("transient");
    reservation.release();
    expect(reservation.state).toBe("released");
    h.socket().push(turnStarted("T9"));
    expect(events).toHaveLength(1);
    expect((await rejection(control.request("thread/read", { threadId: "T9" }))).code).toBe("refused");
  });

  test("a foreign flood during a launch cannot evict the new thread's announcement", async () => {
    const h = harness({
      request: (s, m) => {
        if (m.method !== "thread/start") return;
        s.push(threadStarted("T9", "/work/a"));
        for (let i = 0; i < 2000; i++) {
          s.push({ method: "item/agentMessage/delta", params: { threadId: "F", turnId: "U", itemId: "I", delta: `secret ${i}` } });
          s.push(turnStarted("F"));
        }
        for (let i = 0; i < 200; i++) s.push(turnStarted("T9"));
        s.push({ id: m.id, result: { thread: { id: "T9" } } });
      },
    });
    const control = await h.connect();
    const events = collect(control);
    const reserved = control.reserveLaunch("/work/a");
    if (!reserved.ok) throw new Error(reserved.error.message);
    await control.request("thread/start", { cwd: "/work/a" });
    expect(events[0]).toMatchObject({ method: "thread/started", threadId: "T9" });
    expect(events.every((e) => e.threadId === "T9")).toBe(true);
    expect(events.length).toBeGreaterThan(1);
    expect(JSON.stringify(h.logs)).not.toContain("secret");
  });

  test("an unmatched thread announcement during a launch is not retained", async () => {
    const h = harness({
      request: (s, m) => {
        if (m.method !== "thread/start") return;
        s.push(threadStarted("T9", "/work/b"));
        s.push(turnStarted("T9"));
        s.push(threadStarted("T8"));
        s.push({ id: m.id, result: { thread: { id: "T9" } } });
      },
    });
    const control = await h.connect();
    const events = collect(control);
    const reserved = control.reserveLaunch("/work/a");
    if (!reserved.ok) throw new Error(reserved.error.message);
    await control.request("thread/start", { cwd: "/work/a" });
    expect(reserved.data.threadId).toBe("T9");
    expect(events).toEqual([]);
    h.socket().push(turnStarted("T9"));
    expect(events.map((e) => [e.method, e.threadId])).toEqual([["turn/started", "T9"]]);
  });

  test("a launch that times out leaves its reservation unknown", async () => {
    const h = harness();
    const control = await h.connect();
    const reserved = control.reserveLaunch("/work/a");
    if (!reserved.ok) throw new Error(reserved.error.message);
    const start = control.request("thread/start", { cwd: "/work/a" });
    h.clock.advance(1000);
    expect(await rejection(start)).toMatchObject({ code: "transient" });
    expect(reserved.data.state).toBe("unknown");
    expect((await rejection(control.request("thread/start", { cwd: "/work/a" }))).code).toBe("refused");
  });

  test("an unresolved launch holds its cwd until a late reply reconciles it", async () => {
    let startId: number | undefined;
    const h = harness({ request: (_s, m) => { if (m.method === "thread/start") startId = m.id; } });
    const control = await h.connect();
    const events = collect(control);
    const reserved = control.reserveLaunch("/work/a");
    if (!reserved.ok) throw new Error(reserved.error.message);
    const start = control.request("thread/start", { cwd: "/work/a" });
    h.clock.advance(1000);
    await rejection(start);

    expect(control.reserveLaunch("/work/a")).toMatchObject({ ok: false, error: { code: "refused" } });
    h.socket().push(turnStarted("T9"));
    h.socket().push({ id: startId, result: { thread: { id: "T9" }, cwd: "/work/a", sandbox: { type: "readOnly" } } });
    expect(reserved.data.state).toBe("started");
    expect(reserved.data.threadId).toBe("T9");
    expect(reserved.data.result).toMatchObject({ cwd: "/work/a", sandbox: { type: "readOnly" } });
    expect(events).toEqual([]);
    h.socket().push(turnStarted("T9"));
    expect(events.map((e) => [e.method, e.threadId])).toEqual([["turn/started", "T9"]]);
    expect(control.reserveLaunch("/work/a")).toMatchObject({ ok: false, error: { code: "refused" } });
    reserved.data.release();
    expect(control.reserveLaunch("/work/a").ok).toBe(true);
  });

  test("a late refusal settles an unresolved launch as failed", async () => {
    let startId: number | undefined;
    const h = harness({ request: (_s, m) => { if (m.method === "thread/start") startId = m.id; } });
    const control = await h.connect();
    const reserved = control.reserveLaunch("/work/a");
    if (!reserved.ok) throw new Error(reserved.error.message);
    const start = control.request("thread/start", { cwd: "/work/a" });
    h.clock.advance(1000);
    await rejection(start);
    h.socket().push({ id: startId, error: { code: -32600, message: "no" } });
    expect(reserved.data.state).toBe("failed");
    expect(reserved.data.threadId).toBeUndefined();
  });

  test("thread/resume never carries permission or retargeting overrides", async () => {
    const h = harness();
    const control = await h.connect({ threads: ["T1"] });
    const sentBefore = h.socket().sent.length;
    for (const field of [
      "approvalPolicy", "approvalsReviewer", "sandbox", "permissions", "cwd", "config", "runtimeWorkspaceRoots",
      "model", "modelProvider", "baseInstructions", "developerInstructions", "personality", "serviceTier",
    ]) {
      const error = await rejection(control.request("thread/resume", { threadId: "T1", [field]: "x" }));
      expect(error.code, field).toBe("unsupported");
    }
    expect(h.socket().sent.length).toBe(sentBefore);
    expect(CODEX_METHODS["thread/resume"]!.refused).toEqual(expect.arrayContaining([
      "approvalPolicy", "sandbox", "permissions", "cwd", "config", "runtimeWorkspaceRoots",
    ]));
  });

  test("experimental queue methods need the negotiated capability", async () => {
    const stable = harness();
    const plain = await stable.connect({ threads: ["T1"], experimental: false });
    expect(stable.socket().sent[0]!.params.capabilities).toEqual({ experimentalApi: false });
    expect(plain.experimental).toBe(false);
    const input = [{ type: "text", text: "hi", text_elements: [] }];
    expect((await rejection(plain.request("thread/queue/add", { threadId: "T1", clientUserMessageId: "m1", input }))).code).toBe("unsupported");
    expect((await rejection(plain.request("turn/start", { threadId: "T1", input, collaborationMode: { mode: "plan" } }))).code).toBe("unsupported");

    const exp = harness({ request: (s, m) => s.push({ id: m.id, result: { queuedSubmission: { id: "q", clientUserMessageId: "m1", input } } }) });
    const queued = await exp.connect({ threads: ["T1"] });
    expect(exp.socket().sent[0]!.params.capabilities).toEqual({ experimentalApi: true });
    expect(await queued.request("thread/queue/add", { threadId: "T1", clientUserMessageId: "m1", input })).toMatchObject({ queuedSubmission: { id: "q" } });
    expect((await rejection(queued.request("turn/start", { threadId: "T1", input, sandboxPolicy: { type: "dangerFullAccess" } }))).code).toBe("unsupported");
  });

  test("adopt and disown scope ownership", async () => {
    const h = harness();
    const control = await h.connect();
    const events = collect(control);
    h.socket().push(turnStarted("T2"));
    control.adopt("T2");
    h.socket().push(turnStarted("T2"));
    control.disown("T2");
    h.socket().push(turnStarted("T2"));
    expect(events.map((e) => e.threadId)).toEqual(["T2"]);
  });

  test("a connection that never opens or initializes fails cleanly", async () => {
    const silent = harness({ open: false });
    const opening = silent.connect();
    await Promise.resolve();
    silent.clock.advance(1000);
    expect(await rejection(opening)).toMatchObject({ code: "transient" });

    const refusing = harness({ initialize: (s, m) => s.push({ id: m.id, error: { code: -32600, message: "nope" } }) });
    expect(await rejection(refusing.connect())).toMatchObject({ code: "refused" });

    const malformed = harness({ initialize: (s, m) => s.push({ id: m.id, result: { codexHome: 7 } }) });
    expect(await rejection(malformed.connect())).toMatchObject({ code: "invalid" });
  });

  test("a throwing listener does not stop delivery", async () => {
    const h = harness();
    const control = await h.connect({ threads: ["T1"] });
    control.subscribe(() => {
      throw new Error("listener bug");
    });
    const events = collect(control);
    h.socket().push(turnStarted("T1"));
    expect(events).toHaveLength(1);
    expect(h.logs.some((l) => l.level === "warn")).toBe(true);
  });
});

describe("codex protocol", () => {
  const fixture = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "codex", `app-server-protocol-${CODEX_PROTOCOL_VERSION}.json`), "utf8"));

  test("the method table matches the saved schema fixture", () => {
    expect(fixture.codexVersion).toBe(CODEX_PROTOCOL_VERSION);
    const outside: Record<string, string[]> = { "thread/unsubscribe": ["threadId"], "thread/turns/list": ["itemsView", "limit", "sortDirection", "threadId"] };
    expect(Object.keys(CODEX_METHODS_OUTSIDE_FIXTURE)).toEqual(Object.keys(outside));
    for (const [method, fields] of Object.entries(outside)) {
      expect(fixture.clientRequests[method], method).toBeUndefined();
      expect(CODEX_METHODS[method]).toEqual({
        scope: "owned", experimental: false, required: ["threadId"], fields, experimentalFields: [], refused: [],
      });
    }
    for (const [method, spec] of Object.entries(CODEX_METHODS)) {
      if (Object.hasOwn(CODEX_METHODS_OUTSIDE_FIXTURE, method)) continue;
      const native = fixture.clientRequests[method];
      expect(native, method).toBeDefined();
      for (const field of [...spec.fields, ...spec.refused]) expect(native.params.properties, `${method}.${field}`).toContain(field);
      for (const field of native.params.required) expect(spec.required, `${method}.${field}`).toContain(field);
      expect(spec.experimental, method).toBe(native.experimental);
      expect([...spec.experimentalFields].sort(), method).toEqual(native.params.experimental.filter((f: string) => spec.fields.includes(f)).sort());
    }
  });

  test("validated events read only fields the schema requires or defines", () => {
    const sources: Record<string, { properties: string[]; required: string[] }> = {
      ...Object.fromEntries(Object.entries(fixture.serverNotifications).map(([m, v]: [string, any]) => [m, v.params])),
      "item/tool/requestUserInput": fixture.serverRequests["item/tool/requestUserInput"].params,
    };
    for (const [method, fields] of Object.entries(CODEX_EVENT_FIELDS)) {
      const native = sources[method];
      expect(native, method).toBeDefined();
      for (const field of fields) expect(native!.properties, `${method}.${field}`).toContain(field);
    }
    expect(CODEX_STATUS_ENUMS.thread).toEqual(fixture.types.ThreadStatus);
    expect(CODEX_STATUS_ENUMS.activeFlag).toEqual(fixture.types.ThreadActiveFlag);
    expect(CODEX_STATUS_ENUMS.turn).toEqual(fixture.types.TurnStatus);
    expect(CODEX_STATUS_ENUMS.hookEvent).toEqual(fixture.types.HookEventName);
    expect(CODEX_STATUS_ENUMS.hookRun).toEqual(fixture.types.HookRunStatus);
    expect(fixture.types.userMessage.properties).toContain("clientId");
    expect(fixture.types.agentMessage.properties).toEqual(expect.arrayContaining(["delivery", "questions"]));
    expect(fixture.serverRequests["item/tool/requestUserInput"].response.answer.required).toEqual(["answers"]);
    expect(fixture.responses["thread/start"].required).toContain("thread");
    expect(fixture.initializeCapabilities).toContain("experimentalApi");
  });
});

describe("codex endpoint discovery", () => {
  test("reads the running endpoint and never starts one", async () => {
    const calls: string[][] = [];
    const run = async (argv: string[]) => {
      calls.push(argv);
      return { stdout: JSON.stringify({ status: "running", socketPath: "/run/codex.sock" }), stderr: "", exitCode: 0 };
    };
    expect(await discoverCodexEndpoint({ run })).toEqual({ ok: true, data: { socketPath: "/run/codex.sock" } });
    expect(calls).toEqual([["codex", "app-server", "daemon", "version"]]);

    const stopped = async () => ({ stdout: JSON.stringify({ status: "stopped" }), stderr: "", exitCode: 0 });
    expect(await discoverCodexEndpoint({ run: stopped })).toMatchObject({ ok: false, error: { code: "not-ready" } });
    const broken = async () => ({ stdout: "garbage", stderr: "", exitCode: 0 });
    expect(await discoverCodexEndpoint({ run: broken })).toMatchObject({ ok: false, error: { code: "not-ready" } });
    const failed = async () => ({ stdout: "", stderr: "", exitCode: 1 });
    expect(await discoverCodexEndpoint({ run: failed })).toMatchObject({ ok: false, error: { code: "not-ready" } });
  });
});
