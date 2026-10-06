import { afterEach, describe, expect, test } from "bun:test";
import type { Outcome, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import { buildCodexRemoteResumeCommand } from "../../agent-argv/codex.ts";
import type { LaunchRequest } from "../contracts.ts";
import {
  connectCodexControl, type CodexClock, type CodexControl, type CodexSocket, type CodexSocketHandlers,
} from "../codex/control.ts";
import { codexIntegration } from "../codex/integration.ts";
import {
  awaitCodexHistory, CODEX_INIT_PROMPT, codexReadiness, createCodexSessionLoader, createCodexSessions,
  type CodexSessionDeps, type PaneLaunch, type UnresolvedLaunch,
} from "../codex/sessions.ts";

type Message = Record<string, any>;
type Handler = (socket: FakeSocket, message: Message) => void;

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
  push(message: Message): void {
    this.handlers.message(JSON.stringify(message));
  }
}

const SOCKET = "/run/codex/control.sock";
const SANDBOX = { type: "workspaceWrite", writableRoots: [], networkAccess: false };

const threadStarted = (id: string, cwd: string) => ({ method: "thread/started", params: { thread: { id, cwd, status: { type: "idle" } } } });
const turn = (method: "turn/started" | "turn/completed", threadId: string, id: string, status = method === "turn/started" ? "inProgress" : "completed") =>
  ({ method, params: { threadId, turn: { id, items: [], status } } });
const agentMessage = (threadId: string, turnId: string, extra: Message = {}) =>
  ({ method: "item/completed", params: { threadId, turnId, item: { type: "agentMessage", id: `A-${turnId}`, text: "DONE", ...extra } } });
const statusChanged = (threadId: string, status: Message) => ({ method: "thread/status/changed", params: { threadId, status } });

/** A Codex app server that answers like 0.160.0 did in the F1 follow-up. */
const DEFAULTS: Record<string, Handler> = {
  "thread/start": (s, m) => {
    s.push(threadStarted("T1", m.params.cwd));
    s.push({
      id: m.id,
      result: {
        thread: { id: "T1", cwd: m.params.cwd, status: { type: "idle" } }, cwd: m.params.cwd, sandbox: SANDBOX,
        approvalPolicy: "on-request", runtimeWorkspaceRoots: [m.params.cwd], model: "gpt", modelProvider: "openai",
      },
    });
  },
  "turn/start": (s, m) => {
    s.push({ id: m.id, result: { turn: { id: "U0", items: [], status: "inProgress" } } });
    s.push(turn("turn/started", m.params.threadId, "U0"));
    s.push(agentMessage(m.params.threadId, "U0"));
    s.push(turn("turn/completed", m.params.threadId, "U0"));
  },
  "thread/read": (s, m) => s.push({
    id: m.id, result: { thread: { id: m.params.threadId, cwd: "/work/a", status: { type: "notLoaded" }, preview: CODEX_INIT_PROMPT } },
  }),
  "thread/resume": (s, m) => s.push({
    id: m.id,
    result: { thread: { id: m.params.threadId, cwd: "/work/a", status: { type: "idle" } }, cwd: "/work/a", sandbox: SANDBOX, approvalPolicy: "never" },
  }),
};

const sockets: FakeSocket[] = [];
const clocks: FakeClock[] = [];
const controls: CodexControl[] = [];

afterEach(() => {
  for (const control of controls.splice(0)) control.close();
  expect(sockets.splice(0).every((socket) => socket.closed)).toBe(true);
  expect(clocks.splice(0).every((clock) => clock.active === 0)).toBe(true);
});

async function harness(
  handlers: Record<string, Handler> = {},
  options: { threads?: string[]; unresolved?: Map<string, UnresolvedLaunch> } = {},
) {
  const clock = new FakeClock();
  clocks.push(clock);
  const ops: string[] = [];
  const server = { ...DEFAULTS, ...handlers };
  let socket!: FakeSocket;
  const openSocket = (_path: string, h: CodexSocketHandlers): CodexSocket => {
    socket = new FakeSocket(h, (s, m) => {
      if (m.method === "initialize") {
        s.push({ id: m.id, result: { codexHome: "/redacted/.codex", platformFamily: "unix", platformOs: "macos", userAgent: "t" } });
      } else if (m.method !== undefined && m.method !== "initialized") {
        ops.push(m.method);
        server[m.method]?.(s, m);
      }
    });
    sockets.push(socket);
    queueMicrotask(() => h.open());
    return socket;
  };
  const control = await connectCodexControl(
    { socketPath: SOCKET, profile: "default", ...(options.threads && { threads: options.threads }) },
    { openSocket, clock, timeoutMs: 1000, log: () => {} },
  );
  controls.push(control);
  const panes: PaneLaunch[] = [];
  const confirmed: Array<{ threadId: string; history: string }> = [];
  let confirm: Outcome<void> = { ok: true, data: undefined };
  const deps: Partial<CodexSessionDeps> = {
    now: () => 42, clock, initTurnTimeoutMs: 5000, endpoint: { socketPath: SOCKET }, unresolved: options.unresolved ?? new Map(),
    openPane: async (launch) => {
      ops.push("pane");
      panes.push(launch);
      return { ok: true, data: { pane: `p${panes.length}` } };
    },
    confirmAttached: async (_opened, expected) => {
      confirmed.push(expected);
      return confirm;
    },
  };
  return {
    clock, control, ops, panes, confirmed, deps,
    socket: () => socket,
    requests: (method: string) => socket.sent.filter((m) => m.method === method),
    blockAttach: (outcome: Outcome<void>) => { confirm = outcome; },
    sessions: (extra: Partial<CodexSessionDeps> = {}) => createCodexSessions(control, { ...deps, ...extra }),
  };
}

function request(over: Partial<LaunchRequest> = {}): LaunchRequest {
  return {
    reservationId: "res-1", cwd: "/work/a/", mode: "herdr", selection: { harness: "codex", options: {} }, required: [],
    prompt: "the real brief", access: { readRoots: ["/home/remy/.mattstack/briefs"] }, ...over,
  };
}

function binding(value: string, over: Partial<SessionBinding> = {}): SessionBinding {
  return {
    key: "k1", identity: "remy.ab12", native: { harness: "codex", profile: "default", kind: "id", value },
    attachment: { generation: 3, mode: "herdr", pane: "p1" }, ...over,
  };
}

function data<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(`${outcome.error.code}: ${outcome.error.message}`);
  return outcome.data;
}

describe("codex session launch", () => {
  test("create thread before remote attach", async () => {
    const h = await harness({
      "thread/start": (s, m) => {
        s.push(threadStarted("ANNOUNCED-ELSEWHERE", m.params.cwd));
        DEFAULTS["thread/start"]!(s, m);
      },
    });
    const sessions = h.sessions();
    const launched = data(await sessions.launch(request({ selection: { harness: "codex", options: { model: "gpt-x", effort: "high" } } })));

    expect(h.ops).toEqual(["thread/start", "turn/start", "pane"]);
    expect(launched.native).toEqual({ harness: "codex", profile: "default", kind: "id", value: "T1" });
    expect(launched.attachment).toEqual({ mode: "herdr", pane: "p1" });
    expect(launched.settings).toEqual({ cwd: "/work/a", runtimeWorkspaceRoots: ["/work/a"], sandbox: SANDBOX, approvalPolicy: "on-request" });

    const [start] = h.requests("thread/start");
    expect(start!.params).toEqual({ cwd: "/work/a", model: "gpt-x", config: { model_reasoning_effort: "high" } });
    expect(h.panes).toEqual([{
      cwd: "/work/a", reservationId: "res-1",
      command: buildCodexRemoteResumeCommand("/work/a", { socketPath: SOCKET, threadId: "T1" }),
    }]);
    expect(h.confirmed).toEqual([{ threadId: "T1", history: CODEX_INIT_PROMPT }]);
    expect(JSON.stringify(h.socket().sent) + h.panes[0]!.command).not.toContain("the real brief");

    expect(h.control.reserveLaunch("/work/a").ok).toBe(true);
    await expect(h.control.request("thread/read", { threadId: "T1" })).resolves.toBeDefined();
  });

  test("headless mode uses the same owned API thread without a terminal", async () => {
    const h = await harness();
    const launched = data(await h.sessions().launch(request({ mode: "headless" })));
    expect(h.ops).toEqual(["thread/start", "turn/start"]);
    expect(launched.native.value).toBe("T1");
    expect(launched.attachment).toEqual({ mode: "headless" });
    expect(launched.settings.sandbox).toEqual(SANDBOX);
  });

  test("permissions are configured at thread/start: yolo selects Codex's own bypass, otherwise native settings stand", async () => {
    const h = await harness();
    data(await h.sessions().launch(request({ selection: { harness: "codex", options: { yolo: true } }, mode: "headless" })));
    expect(h.requests("thread/start")[0]!.params).toEqual({ cwd: "/work/a", approvalPolicy: "never", sandbox: "danger-full-access" });
  });

  test("options a thread cannot take are refused before anything starts", async () => {
    const h = await harness();
    const sessions = h.sessions();
    expect(await sessions.launch(request({ selection: { harness: "codex", options: { extraArgs: "--search" } } })))
      .toMatchObject({ ok: false, error: { code: "unsupported" } });
    expect(await sessions.launch(request({ selection: { harness: "codex", options: { account: "a@b.c" } } })))
      .toMatchObject({ ok: false, error: { code: "unsupported" } });
    expect(await sessions.launch(request({ selection: { harness: "claude", options: {} } })))
      .toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(await sessions.launch(request({ cwd: "relative" }))).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(h.ops).toEqual([]);
  });

  test("herdr launch needs the app server's endpoint for the terminal to attach to", async () => {
    const h = await harness();
    expect(await h.sessions({ endpoint: undefined }).launch(request())).toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(h.ops).toEqual([]);
  });

  test("ready history is not user work", async () => {
    const h = await harness();
    const sessions = h.sessions();
    data(await sessions.launch(request()));

    const inits = h.requests("turn/start");
    expect(inits).toHaveLength(1);
    expect(inits[0]!.params).toEqual({ threadId: "T1", input: [{ type: "text", text: CODEX_INIT_PROMPT }] });
    expect(h.panes[0]!.command.trimEnd().endsWith("resume 'T1'")).toBe(true);

    expect(data(await sessions.observe(binding("T1")))).toEqual({
      connectivity: "connected", execution: "idle", background: "unknown", observedAt: 42, source: "codex-events", generation: 3,
    });
    h.socket().push(turn("turn/started", "T1", "U0"));
    expect(data(await sessions.observe(binding("T1"))).execution).toBe("idle");
    expect(h.ops.filter((m) => m === "turn/start")).toHaveLength(1);
  });

  test("an initialization turn that does not complete leaves no attached terminal", async () => {
    const failed = await harness({
      "turn/start": (s, m) => {
        s.push({ id: m.id, result: { turn: { id: "U0", items: [], status: "inProgress" } } });
        s.push(turn("turn/completed", m.params.threadId, "U0", "failed"));
      },
    });
    expect(await failed.sessions().launch(request())).toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(failed.panes).toEqual([]);

    const silent = await harness({ "turn/start": (s, m) => s.push({ id: m.id, result: { turn: { id: "U0", items: [], status: "inProgress" } } }) });
    const pending = silent.sessions().launch(request());
    await Bun.sleep(0);
    silent.clock.advance(5000);
    const outcome = await pending;
    expect(outcome).toMatchObject({ ok: false, error: { code: "transient" } });
    expect(outcome.ok || outcome.error.message).toContain("T1");
    expect(silent.panes).toEqual([]);
    expect(silent.control.reserveLaunch("/work/a").ok).toBe(true);
  });

  test("a folder-trust prompt is a blocked attachment, not a ready launch", async () => {
    const h = await harness();
    h.blockAttach({ ok: false, error: { code: "not-ready", message: "the terminal never showed the thread's history" } });
    const outcome = await h.sessions().launch(request());
    expect(outcome).toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(outcome.ok || outcome.error.message).toContain("T1");
    expect(h.panes).toHaveLength(1);
  });

  test("a launch timeout is reconciled against its reservation and never spawns a second worker", async () => {
    let startId: number | undefined;
    const h = await harness({ "thread/start": (_s, m) => { startId = m.id; } });
    const sessions = h.sessions();

    const first = sessions.launch(request());
    await Bun.sleep(0);
    h.clock.advance(1000);
    expect(await first).toMatchObject({ ok: false, error: { code: "ambiguous" } });

    expect(await sessions.launch(request({ reservationId: "res-2" }))).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(await sessions.launch(request())).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    expect(h.requests("thread/start")).toHaveLength(1);

    h.socket().push({
      id: startId,
      result: { thread: { id: "T7", cwd: "/work/a", status: { type: "idle" } }, cwd: "/work/a", sandbox: SANDBOX, approvalPolicy: "never", runtimeWorkspaceRoots: [] },
    });
    const reconciled = data(await sessions.launch(request()));
    expect(reconciled.native.value).toBe("T7");
    expect(reconciled.settings).toEqual({ cwd: "/work/a", runtimeWorkspaceRoots: [], sandbox: SANDBOX, approvalPolicy: "never" });
    expect(h.requests("thread/start")).toHaveLength(1);
    expect(h.panes).toHaveLength(1);
    expect(h.control.reserveLaunch("/work/a").ok).toBe(true);
  });

  test("an unresolved launch outlives its connection", async () => {
    const unresolved = new Map<string, UnresolvedLaunch>();
    const first = await harness({ "thread/start": () => {} }, { unresolved });
    const pending = first.sessions().launch(request());
    await Bun.sleep(0);
    first.clock.advance(1000);
    expect(await pending).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    first.control.close();

    const second = await harness({}, { unresolved });
    const sessions = second.sessions();
    expect(await sessions.launch(request())).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    expect(await sessions.launch(request({ reservationId: "res-2" }))).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(await sessions.launch(request({ reservationId: "res-3", cwd: "/work/b" }))).toMatchObject({ ok: true });
    expect(second.requests("thread/start").map((m) => m.params.cwd)).toEqual(["/work/b"]);
  });

  test("a launch sends thread/start the cwd it reserved", async () => {
    const h = await harness();
    data(await h.sessions().launch(request({ cwd: "/work/./a//", mode: "headless" })));
    expect(h.requests("thread/start")[0]!.params.cwd).toBe("/work/a");
  });
});

describe("codex session resume", () => {
  test("remote resume omits permission overrides", async () => {
    const h = await harness({}, { threads: [] });
    const resumed = data(await h.sessions().resume(binding("T1").native, request({
      selection: { harness: "codex", options: { yolo: true, model: "gpt-x", effort: "high" } },
    })));
    expect(resumed.native).toEqual(binding("T1").native);
    expect(resumed.attachment).toEqual({ mode: "herdr", pane: "p1" });
    expect(h.ops).toEqual(["thread/read", "pane"]);
    expect(h.requests("thread/read")[0]!.params).toEqual({ threadId: "T1", includeTurns: false });
    const command = h.panes[0]!.command;
    expect(command).toBe(buildCodexRemoteResumeCommand("/work/a", { socketPath: SOCKET, threadId: "T1" }));
    for (const flag of ["--add-dir", "-s", "-a", "-m", "-c", "--dangerously-bypass-approvals-and-sandbox"]) {
      expect(command.split(" "), flag).not.toContain(flag);
    }
    expect(h.confirmed).toEqual([{ threadId: "T1", history: CODEX_INIT_PROMPT }]);
  });

  test("headless resume reattaches the exact thread with its persisted options", async () => {
    const h = await harness();
    const resumed = data(await h.sessions().resume(binding("T1").native, request({
      mode: "headless", selection: { harness: "codex", options: { yolo: true, model: "other" } },
    })));
    expect(h.ops).toEqual(["thread/read", "thread/resume"]);
    expect(h.requests("thread/resume")[0]!.params).toEqual({ threadId: "T1", excludeTurns: true });
    expect(resumed).toEqual({
      native: binding("T1").native, attachment: { mode: "headless" },
      settings: { cwd: "/work/a", sandbox: SANDBOX, approvalPolicy: "never" },
    });
  });

  test("resume cannot silently replace a thread", async () => {
    const swapped = await harness({
      "thread/resume": (s, m) => s.push({ id: m.id, result: { thread: { id: "T-NEW", cwd: "/work/a", status: { type: "idle" } }, cwd: "/work/a" } }),
    });
    expect(await swapped.sessions().resume(binding("T1").native, request({ mode: "headless" })))
      .toMatchObject({ ok: false, error: { code: "ambiguous" } });

    const missing = await harness({ "thread/read": (s, m) => s.push({ id: m.id, error: { code: -32600, message: "thread not found" } }) });
    expect(await missing.sessions().resume(binding("T1").native, request())).toMatchObject({ ok: false });

    const moved = await harness();
    expect(await moved.sessions().resume(binding("T1").native, request({ cwd: "/work/b" })))
      .toMatchObject({ ok: false, error: { code: "invalid" } });

    const other = await harness();
    expect(await other.sessions().resume({ ...binding("T1").native, profile: "/x/.codex-work" }, request()))
      .toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(await other.sessions().resume({ ...binding("T1").native, harness: "claude" }, request()))
      .toMatchObject({ ok: false, error: { code: "invalid" } });

    for (const h of [swapped, missing, moved, other]) {
      expect(h.requests("thread/start")).toEqual([]);
      expect(h.requests("turn/start")).toEqual([]);
    }
    expect(missing.panes).toEqual([]);
    expect(moved.panes).toEqual([]);
    expect(other.ops).toEqual([]);
  });
});

describe("codex observations", () => {
  test("an async-form event must not advertise synchronous request completion", async () => {
    const h = await harness({}, { threads: ["T1"] });
    const sessions = h.sessions();
    const s = h.socket();
    s.push(turn("turn/started", "T1", "U1"));
    s.push({
      id: 0, method: "item/tool/requestUserInput",
      params: { threadId: "T1", turnId: "U1", itemId: "I1", isBlocking: true, questions: [{ id: "q1", header: "h", question: "q?", isOther: false, isSecret: false, options: null }] },
    });
    expect(data(await sessions.observe(binding("T1"))).execution).toBe("blocked");
    s.push(agentMessage("T1", "U1", { delivery: "async", questions: [{ id: "q1" }] }));
    expect(data(await sessions.observe(binding("T1"))).execution).toBe("blocked");
    s.push({ method: "serverRequest/resolved", params: { threadId: "T1", requestId: 0 } });
    expect(data(await sessions.observe(binding("T1"))).execution).toBe("working");

    s.push(agentMessage("T1", "U1", { id: "A2", delivery: "async", questions: [{ id: "q2" }] }));
    expect(data(await sessions.observe(binding("T1"))).execution).toBe("working");

    const report = await codexIntegration.capabilities("herdr");
    for (const cap of ["questions-form", "questions-wait", "question-recovery", "questions-async"] as const) {
      expect(report.supported).not.toContain(cap);
    }
  });

  test("an agentMessage saying DONE cannot mark execution idle", async () => {
    const h = await harness({}, { threads: ["T1"] });
    const sessions = h.sessions();
    const s = h.socket();
    s.push(turn("turn/started", "T1", "U2"));
    s.push(agentMessage("T1", "U2"));
    expect(data(await sessions.observe(binding("T1"))).execution).toBe("working");
    s.push({ method: "hook/completed", params: { threadId: "T1", turnId: "U2", run: { id: "h1", eventName: "stop", status: "blocked" } } });
    expect(data(await sessions.observe(binding("T1"))).execution).toBe("working");
    s.push(turn("turn/completed", "T1", "U2"));
    expect(data(await sessions.observe(binding("T1"))).execution).toBe("idle");
    expect(h.requests("thread/read")).toEqual([]);
  });

  test("native thread status maps to observations and missing channels stay unknown", async () => {
    const h = await harness({
      "thread/read": (s, m) => s.push({ id: m.id, result: { thread: { id: m.params.threadId, cwd: "/w", status: { type: "idle" }, preview: "x" } } }),
    });
    const sessions = h.sessions();
    expect(data(await sessions.observe(binding("T1")))).toEqual({
      connectivity: "connected", execution: "idle", background: "unknown", observedAt: 42, source: "codex-thread", generation: 3,
    });
    const s = h.socket();
    s.push(statusChanged("T1", { type: "active", activeFlags: ["waitingOnApproval"] }));
    expect(data(await sessions.observe(binding("T1")))).toMatchObject({ connectivity: "connected", execution: "blocked", source: "codex-events" });
    s.push(statusChanged("T1", { type: "active", activeFlags: [] }));
    expect(data(await sessions.observe(binding("T1"))).execution).toBe("working");
    s.push(statusChanged("T1", { type: "systemError" }));
    expect(data(await sessions.observe(binding("T1")))).toMatchObject({ connectivity: "connected", execution: "unknown" });
    s.push(statusChanged("T1", { type: "notLoaded" }));
    expect(data(await sessions.observe(binding("T1")))).toMatchObject({ connectivity: "disconnected", execution: "unknown" });
    s.push({ method: "thread/closed", params: { threadId: "T1" } });
    expect(data(await sessions.observe(binding("T1")))).toMatchObject({ connectivity: "disconnected", execution: "unknown", background: "unknown" });
    expect(h.requests("thread/read")).toHaveLength(1);
  });

  test("an unreadable thread is unknown, a closed connection is transient, a foreign binding is refused", async () => {
    const h = await harness({ "thread/read": (s, m) => s.push({ id: m.id, error: { code: -1, message: "nope" } }) });
    const sessions = h.sessions();
    expect(data(await sessions.observe(binding("T1")))).toMatchObject({ connectivity: "unknown", execution: "unknown", source: "none" });
    expect(await sessions.observe({ ...binding("T1"), native: { ...binding("T1").native, profile: "work" } }))
      .toMatchObject({ ok: false, error: { code: "invalid" } });
    h.control.close();
    expect(await sessions.observe(binding("T1"))).toMatchObject({ ok: false, error: { code: "transient" } });
  });

  test("one event subscription serves every adapter on a connection", async () => {
    const h = await harness({}, { threads: ["T1"] });
    h.socket().push(turn("turn/started", "T1", "U5"));
    let subscriptions = 0;
    const counted = new Proxy(h.control, {
      get(target, key) {
        if (key === "subscribe") return (listener: Parameters<CodexControl["subscribe"]>[0]) => { subscriptions++; return target.subscribe(listener); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as CodexControl;
    const one = createCodexSessions(counted, h.deps);
    const two = createCodexSessions(counted, h.deps);
    expect(subscriptions).toBe(1);
    expect(data(await one.observe(binding("T1"))).execution).toBe("working");
    expect(data(await two.observe(binding("T1"))).execution).toBe("working");
    expect(h.requests("thread/read")).toEqual([]);
  });

  test("the adapter never discovers, starts work or writes a binding", async () => {
    const h = await harness();
    const sessions = h.sessions();
    expect(await sessions.discover()).toEqual([]);
    expect(await sessions.startWork(binding("T1"), { id: "w1", text: "go" })).toMatchObject({ ok: false, error: { code: "unsupported" } });
    expect(h.ops).toEqual([]);
  });
});

describe("terminal attachment", () => {
  test("only the thread's own history on screen counts as attached", async () => {
    const screens = ["", "Do you trust the files in this folder?\n> 1. Yes", `› ${CODEX_INIT_PROMPT.replace(" and", "\n and")}\n\n• READY`];
    let reads = 0;
    const read = async () => screens[Math.min(reads++, screens.length - 1)] ?? null;
    expect(await awaitCodexHistory(read, CODEX_INIT_PROMPT, { attempts: 5, sleep: async () => {} })).toEqual({ ok: true, data: undefined });
    expect(reads).toBe(3);

    const trust = async () => "Do you trust the files in this folder?";
    expect(await awaitCodexHistory(trust, CODEX_INIT_PROMPT, { attempts: 3, sleep: async () => {} }))
      .toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(await awaitCodexHistory(async () => null, CODEX_INIT_PROMPT, { attempts: 2, sleep: async () => {} }))
      .toMatchObject({ ok: false, error: { code: "not-ready" } });
  });
});

describe("registration", () => {
  test("codex loads its session adapter and advertises only what it provides", async () => {
    expect(typeof codexIntegration.loadSessions).toBe("function");
    for (const mode of ["herdr", "headless"] as const) {
      const report = await codexIntegration.capabilities(mode);
      expect(report.supported).toEqual(["launch", "resume", "observe"]);
      expect(typeof report.readiness.ready).toBe("boolean");
    }
  });

  test("readiness follows the codex binary", () => {
    expect(codexReadiness(() => null, () => false)).toMatchObject({ ready: false });
    expect(codexReadiness(() => "/usr/bin/codex", () => false)).toEqual({ ready: true });
    expect(codexReadiness(() => null, () => true)).toEqual({ ready: true });
    expect(codexReadiness(() => "/usr/bin/codex", () => false, "The Codex app server is not running."))
      .toEqual({ ready: false, reason: "rt cannot reach the Codex app server: The Codex app server is not running." });
  });

  test("the loader shares one live connection, reconnects a closed one, and reports an absent app server", async () => {
    const h = await harness();
    const connects: Array<{ socketPath: string; profile: string }> = [];
    const outcomes: unknown[] = [];
    const load = createCodexSessionLoader({
      onConnection: (failure) => outcomes.push(failure),
      env: { HOME: "/Users/remy", CODEX_HOME: "/Users/remy/.codex/" },
      discover: async () => ({ ok: true, data: { socketPath: SOCKET } }),
      connect: async (options) => { connects.push(options); return h.control; },
      sessions: h.deps,
    });
    const [a, b] = await Promise.all([load(), load()]);
    expect(a).toBe(b);
    expect(connects).toEqual([{ socketPath: SOCKET, profile: "default" }]);
    h.control.close();
    await load();
    expect(connects).toHaveLength(2);
    expect(outcomes).toEqual([null, null]);

    const down = createCodexSessionLoader({
      env: {}, discover: async () => ({ ok: false, error: { code: "not-ready", message: "The Codex app server is not running." } }),
      connect: async () => { throw new Error("must not connect"); },
      onConnection: (failure) => outcomes.push(failure),
    });
    const unavailable = await down();
    expect(await unavailable.launch(request())).toMatchObject({ ok: false, error: { code: "not-ready", message: "The Codex app server is not running." } });
    expect(await unavailable.observe(binding("T1"))).toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(await unavailable.discover()).toEqual([]);
    expect(outcomes.at(-1)).toEqual({ code: "not-ready", message: "The Codex app server is not running." });
  });
});
