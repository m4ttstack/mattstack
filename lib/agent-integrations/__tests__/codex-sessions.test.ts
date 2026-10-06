import { afterEach, describe, expect, test } from "bun:test";
import type { Outcome, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import { buildCodexRemoteResumeCommand } from "../../agent-argv/codex.ts";
import type { LaunchRequest } from "../contracts.ts";
import {
  connectCodexControl, type CodexClock, type CodexControl, type CodexSocket, type CodexSocketHandlers,
} from "../codex/control.ts";
import { codexIntegration } from "../codex/integration.ts";
import {
  attachEvidence, awaitCodexHistory, CODEX_INIT_PROMPT, codexReadiness, createCodexSessionLoader, createCodexSessions,
  DISCOVERY_BACKOFF_CAP_MS, DISCOVERY_BACKOFF_MS, type CodexSessionDeps, type PaneLaunch, type UnresolvedLaunch,
} from "../codex/sessions.ts";
import { workDigest } from "../work-submissions.ts";

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

const userItem = (id: string, text: string) => ({ type: "userMessage", id, content: [{ type: "text", text }] });
const agentItem = (id: string, text: string) => ({ type: "agentMessage", id, text });
const readyTurn = { id: "U0", status: "completed", items: [userItem("i0", CODEX_INIT_PROMPT), agentItem("a0", "READY")] };

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
    id: m.id,
    result: {
      thread: {
        id: m.params.threadId, cwd: "/work/a", status: { type: "notLoaded" }, preview: CODEX_INIT_PROMPT,
        turns: m.params.includeTurns ? [readyTurn] : [],
      },
    },
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
  const confirmed: Array<{ threadId: string; evidence: string[]; pane: string }> = [];
  let confirm: Outcome<void> | Promise<Outcome<void>> = { ok: true, data: undefined };
  const deps: Partial<CodexSessionDeps> = {
    now: () => 42, clock, initTurnTimeoutMs: 5000, endpoint: { socketPath: SOCKET }, unresolved: options.unresolved ?? new Map(), inFlight: new Set(),
    openPane: async (launch) => {
      ops.push("pane");
      panes.push(launch);
      return { ok: true, data: { pane: `p${panes.length}` } };
    },
    confirmAttached: async (opened, expected) => {
      confirmed.push({ ...expected, pane: opened.pane });
      return confirm;
    },
  };
  return {
    clock, control, ops, panes, confirmed, deps,
    socket: () => socket,
    requests: (method: string) => socket.sent.filter((m) => m.method === method),
    blockAttach: (outcome: Outcome<void> | Promise<Outcome<void>>) => { confirm = outcome; },
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
    expect(h.confirmed).toEqual([{ threadId: "T1", evidence: [CODEX_INIT_PROMPT], pane: "p1" }]);
    expect(JSON.stringify(h.socket().sent) + h.panes[0]!.command).not.toContain("the real brief");

    expect(h.control.reserveLaunch("/work/a").ok).toBe(true);
    await expect(h.control.request("thread/read", { threadId: "T1" })).resolves.toBeDefined();
  });

  test("the terminal opens where the launch host says, with its environment and without another harness's session variable", async () => {
    const h = await harness();
    const host = { workspace: "acme", tab: "worker", env: { RT_AGENT_ID: "a1" }, unsetEnv: ["CLAUDE_CODE_SESSION_ID"] };
    const launched = data(await h.sessions().launch(request({ host })));
    expect(h.panes).toEqual([{
      cwd: "/work/a", reservationId: "res-1", host,
      command: buildCodexRemoteResumeCommand("/work/a", { socketPath: SOCKET, threadId: "T1", env: { RT_AGENT_ID: "a1" }, unsetEnv: ["CLAUDE_CODE_SESSION_ID"] }),
    }]);
    expect(h.panes[0]!.command).toStartWith("cd '/work/a' && unset CLAUDE_CODE_SESSION_ID && RT_AGENT_ID='a1' codex --remote");
    expect(launched.attachment).toEqual({ mode: "herdr", pane: "p1" });
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

  test("a failed initialization turn keeps the thread; a same-id retry initializes that thread again", async () => {
    let turns = 0;
    const h = await harness({
      "turn/start": (s, m) => {
        const id = `U${turns++}`;
        s.push({ id: m.id, result: { turn: { id, items: [], status: "inProgress" } } });
        s.push(turn("turn/completed", m.params.threadId, id, turns === 1 ? "failed" : "completed"));
      },
    });
    const sessions = h.sessions();
    const outcome = await sessions.launch(request());
    expect(outcome).toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(outcome.ok || outcome.error.message).toContain("T1");
    expect(h.panes).toEqual([]);
    expect(h.control.reserveLaunch("/work/a").ok).toBe(false);
    expect(await sessions.launch(request({ reservationId: "res-2" }))).toMatchObject({ ok: false, error: { code: "refused" } });

    expect(data(await sessions.launch(request())).native.value).toBe("T1");
    expect(h.requests("thread/start")).toHaveLength(1);
    expect(h.requests("turn/start")).toHaveLength(2);
    expect(h.panes).toHaveLength(1);
    expect(h.control.reserveLaunch("/work/a").ok).toBe(true);
  });

  test("an initialization turn that outlasts the wait is ambiguous; a same-id retry waits on the same turn", async () => {
    const h = await harness({ "turn/start": (s, m) => s.push({ id: m.id, result: { turn: { id: "U0", items: [], status: "inProgress" } } }) });
    const sessions = h.sessions();
    const pending = sessions.launch(request());
    await Bun.sleep(0);
    h.clock.advance(5000);
    const outcome = await pending;
    expect(outcome).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    expect(outcome.ok || outcome.error.message).toContain("T1");
    expect(h.panes).toEqual([]);
    expect(h.control.reserveLaunch("/work/a").ok).toBe(false);

    h.socket().push(turn("turn/completed", "T1", "U0"));
    expect(data(await sessions.launch(request())).native.value).toBe("T1");
    expect(h.requests("thread/start")).toHaveLength(1);
    expect(h.requests("turn/start")).toHaveLength(1);
    expect(h.panes).toHaveLength(1);
  });

  test("a folder-trust prompt is a blocked attachment; a same-id retry re-checks the same pane", async () => {
    const h = await harness();
    const sessions = h.sessions();
    h.blockAttach({ ok: false, error: { code: "not-ready", message: "the terminal never showed the thread's history" } });
    const outcome = await sessions.launch(request());
    expect(outcome).toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(outcome.ok || outcome.error.message).toContain("T1");
    expect(outcome.ok || outcome.error.message).toContain("p1");
    expect(h.control.reserveLaunch("/work/a").ok).toBe(false);

    h.blockAttach({ ok: true, data: undefined });
    expect(data(await sessions.launch(request())).attachment).toEqual({ mode: "herdr", pane: "p1" });
    expect(h.requests("thread/start")).toHaveLength(1);
    expect(h.requests("turn/start")).toHaveLength(1);
    expect(h.panes).toHaveLength(1);
    expect(h.confirmed.map((c) => c.pane)).toEqual(["p1", "p1"]);
  });

  test("a same-id launch while one is in flight is refused and starts nothing", async () => {
    const h = await harness({ "turn/start": (s, m) => s.push({ id: m.id, result: { turn: { id: "U0", items: [], status: "inProgress" } } }) });
    const sessions = h.sessions();
    const first = sessions.launch(request());
    await Bun.sleep(0);
    expect(h.requests("thread/start")).toHaveLength(1);

    const second = await sessions.launch(request());
    expect(second).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    expect(second.ok || second.error.message).toContain("still in progress");
    expect(await sessions.resume(binding("T1").native, request())).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    expect(h.requests("thread/start")).toHaveLength(1);

    h.clock.advance(5000);
    expect(await first).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    h.socket().push(turn("turn/completed", "T1", "U0"));
    expect(data(await sessions.launch(request())).native.value).toBe("T1");
    expect(h.requests("thread/start")).toHaveLength(1);
    expect(h.requests("turn/start")).toHaveLength(1);
    expect(h.panes).toHaveLength(1);
  });

  test("a same-id launch while its pane is being checked opens no second pane", async () => {
    const h = await harness();
    const sessions = h.sessions();
    let release!: (outcome: Outcome<void>) => void;
    h.blockAttach(new Promise((r) => { release = r; }));
    const first = sessions.launch(request());
    while (h.confirmed.length === 0) await Bun.sleep(0);

    expect(await sessions.launch(request())).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    expect(h.panes).toHaveLength(1);
    release({ ok: true, data: undefined });
    expect(data(await first).attachment).toEqual({ mode: "herdr", pane: "p1" });
    expect(h.requests("thread/start")).toHaveLength(1);
    expect(h.panes).toHaveLength(1);
    expect(h.confirmed).toHaveLength(1);
  });

  test("a pane that fails to open keeps the thread; a same-id retry opens one pane for it", async () => {
    const h = await harness();
    let opens = 0;
    const sessions = h.sessions({
      openPane: async (launch) => {
        opens++;
        if (opens === 1) return { ok: false, error: { code: "transient", message: "herdr unavailable" } };
        h.panes.push(launch);
        return { ok: true, data: { pane: "p9" } };
      },
    });
    expect(await sessions.launch(request())).toMatchObject({ ok: false, error: { code: "transient" } });
    expect(data(await sessions.launch(request())).attachment).toEqual({ mode: "herdr", pane: "p9" });
    expect(h.requests("thread/start")).toHaveLength(1);
    expect(h.requests("turn/start")).toHaveLength(1);
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
    expect(h.requests("thread/read")[0]!.params).toEqual({ threadId: "T1", includeTurns: true });
    const command = h.panes[0]!.command;
    expect(command).toBe(buildCodexRemoteResumeCommand("/work/a", { socketPath: SOCKET, threadId: "T1" }));
    for (const flag of ["--add-dir", "-s", "-a", "-m", "-c", "--dangerously-bypass-approvals-and-sandbox"]) {
      expect(command.split(" "), flag).not.toContain(flag);
    }
    expect(h.confirmed).toEqual([{ threadId: "T1", evidence: [CODEX_INIT_PROMPT, "READY"], pane: "p1" }]);
  });

  test("resuming a thread after real work looks for its latest messages, not its first", async () => {
    const long = Array.from({ length: 80 }, (_, i) => `step ${i} of the investigation`).join("\n");
    const worked = [
      readyTurn,
      { id: "U1", status: "completed", items: [userItem("i1", "Look into the login flake"), agentItem("a1", long)] },
      {
        id: "U2", status: "completed",
        items: [
          userItem("i2", "Fix the flaky login test in auth.spec.ts\nand run the suite"),
          { type: "commandExecution", id: "c2" },
          agentItem("a2", "I updated **auth.spec.ts**.\n\nAll `12` tests pass now."),
        ],
      },
    ];
    const h = await harness({
      "thread/read": (s, m) => s.push({
        id: m.id, result: { thread: { id: m.params.threadId, cwd: "/work/a", status: { type: "notLoaded" }, preview: CODEX_INIT_PROMPT, turns: worked } },
      }),
    });
    const screen = `${long.split("\n").slice(-20).join("\n")}\n› Fix the flaky login test in auth.spec.ts\n  and run the suite\n\n• I updated auth.spec.ts.\n\n  All 12 tests pass now.\n`;
    expect(screen).not.toContain(CODEX_INIT_PROMPT);
    const sessions = h.sessions({
      openPane: async (launch) => { h.panes.push(launch); return { ok: true, data: { pane: "p1" } }; },
      confirmAttached: (_opened, expected) => {
        h.confirmed.push({ ...expected, pane: "p1" });
        return awaitCodexHistory(async () => screen, expected.evidence, { attempts: 1, sleep: async () => {} });
      },
    });
    const resumed = data(await sessions.resume(binding("T1").native, request()));
    expect(resumed.attachment).toEqual({ mode: "herdr", pane: "p1" });
    expect(h.confirmed[0]!.evidence).toEqual(["Fix the flaky login test in auth.spec.ts", "All 12 tests pass now."]);
  });

  test("a same-id resume while one is in flight is refused and opens nothing", async () => {
    const h = await harness();
    const sessions = h.sessions();
    let release!: (outcome: Outcome<void>) => void;
    h.blockAttach(new Promise((r) => { release = r; }));
    const first = sessions.resume(binding("T1").native, request({ reservationId: "r-resume" }));
    while (h.confirmed.length === 0) await Bun.sleep(0);

    const second = await sessions.resume(binding("T1").native, request({ reservationId: "r-resume" }));
    expect(second).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    expect(await sessions.launch(request({ reservationId: "r-resume" }))).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    expect(h.requests("thread/read")).toHaveLength(1);
    expect(h.panes).toHaveLength(1);
    expect(h.requests("thread/start")).toEqual([]);

    release({ ok: false, error: { code: "not-ready", message: "trust prompt" } });
    expect(await first).toMatchObject({ ok: false, error: { code: "not-ready" } });
    h.blockAttach({ ok: true, data: undefined });
    expect(data(await sessions.resume(binding("T1").native, request({ reservationId: "r-resume" }))).attachment)
      .toEqual({ mode: "herdr", pane: "p1" });
    expect(h.panes).toHaveLength(1);
  });

  test("an unconfirmed resume keeps its pane; a same-id retry re-checks it instead of opening another", async () => {
    const h = await harness();
    const sessions = h.sessions();
    h.blockAttach({ ok: false, error: { code: "not-ready", message: "trust prompt" } });
    expect(await sessions.resume(binding("T1").native, request({ reservationId: "r-resume" })))
      .toMatchObject({ ok: false, error: { code: "not-ready" } });
    h.blockAttach({ ok: true, data: undefined });
    expect(await sessions.resume(binding("T2").native, request({ reservationId: "r-resume" })))
      .toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(data(await sessions.resume(binding("T1").native, request({ reservationId: "r-resume" }))).attachment)
      .toEqual({ mode: "herdr", pane: "p1" });
    expect(h.panes).toHaveLength(1);
    expect(h.confirmed.map((c) => c.pane)).toEqual(["p1", "p1"]);
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

  test("the adapter never discovers or writes a binding", async () => {
    const h = await harness();
    const sessions = h.sessions();
    expect(await sessions.discover()).toEqual([]);
    expect(h.ops).toEqual([]);
  });
});

describe("work on a bound thread", () => {
  test("work is one turn on the bound thread, with the text as its only input", async () => {
    const h = await harness();
    const receipt = data(await h.sessions().startWork(binding("T1"), { id: "w1", text: "the real brief" }));
    expect(h.requests("turn/start").map((m) => m.params)).toEqual([{ threadId: "T1", input: [{ type: "text", text: "the real brief" }] }]);
    expect(receipt).toEqual({ id: "w1", evidence: "submitted", nativeId: "T1", turnId: "U0" });
  });

  test("a headless turn completes the run when Codex reports the turn's end", async () => {
    const h = await harness();
    const receipt = data(await h.sessions().startWork(binding("T1", { attachment: { generation: 1, mode: "headless" } }), { id: "w1", text: "go" }));
    expect(await receipt.completion).toEqual({ exitCode: 0, body: JSON.stringify({ threadId: "T1", turnId: "U0", status: "completed" }) });
  });

  test("Codex refusing the turn is definite; no answer at all is ambiguous", async () => {
    const refused = await harness({ "turn/start": (s, m) => s.push({ id: m.id, error: { code: -32600, message: "thread is busy" } }) });
    expect(await refused.sessions().startWork(binding("T1"), { id: "w1", text: "go" })).toMatchObject({ ok: false, error: { code: "refused" } });

    const silent = await harness({ "turn/start": () => {} });
    const pending = silent.sessions().startWork(binding("T1"), { id: "w2", text: "go" });
    silent.clock.advance(1000);
    expect(await pending).toMatchObject({ ok: false, error: { code: "ambiguous" } });
  });

  test("a closed connection sends nothing", async () => {
    const h = await harness();
    const sessions = h.sessions();
    h.control.close();
    expect(await sessions.startWork(binding("T1"), { id: "w1", text: "go" })).toMatchObject({ ok: false, error: { code: "not-ready" } });
  });

  test("an interrupted submission is found in the thread's own history, or not at all", async () => {
    const withTurn = await harness({
      "thread/read": (s, m) => s.push({
        id: m.id,
        result: { thread: { id: m.params.threadId, cwd: "/work/a", turns: [readyTurn, { id: "U5", status: "completed", items: [userItem("i5", "the real brief")] }] } },
      }),
    });
    expect(data(await withTurn.sessions().reconcileWork!(binding("T1"), { id: "w1", digest: workDigest("the real brief") })))
      .toEqual({ id: "w1", evidence: "submitted", nativeId: "T1", turnId: "U5" });
    expect(data(await withTurn.sessions().reconcileWork!(binding("T1"), { id: "w2", digest: workDigest("another brief") }))).toBeNull();
  });
});

describe("terminal attachment", () => {
  test("only the thread's own history on screen counts as attached", async () => {
    const screens = ["", "Do you trust the files in this folder?\n> 1. Yes", `› ${CODEX_INIT_PROMPT.replace(" and", "\n and")}\n\n• READY`];
    let reads = 0;
    const read = async () => screens[Math.min(reads++, screens.length - 1)] ?? null;
    expect(await awaitCodexHistory(read, [CODEX_INIT_PROMPT], { attempts: 5, sleep: async () => {} })).toEqual({ ok: true, data: undefined });
    expect(reads).toBe(3);

    const trust = async () => "Do you trust the files in this folder?";
    expect(await awaitCodexHistory(trust, [CODEX_INIT_PROMPT, "READY"], { attempts: 3, sleep: async () => {} }))
      .toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(await awaitCodexHistory(async () => null, [CODEX_INIT_PROMPT], { attempts: 2, sleep: async () => {} }))
      .toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(await awaitCodexHistory(async () => "anything", ["", "  "], { attempts: 2, sleep: async () => {} }))
      .toMatchObject({ ok: false, error: { code: "not-ready" } });
  });

  test("attach evidence comes from the newest turn that has messages", () => {
    expect(attachEvidence({ turns: [readyTurn, { id: "U1", status: "inProgress", items: [] }] })).toEqual([CODEX_INIT_PROMPT, "READY"]);
    expect(attachEvidence({ turns: [readyTurn, { id: "U1", status: "inProgress", items: [userItem("i1", "  Ship it  ")] }] })).toEqual(["Ship it"]);
    expect(attachEvidence({ turns: [] })).toEqual([]);
    expect(attachEvidence({})).toEqual([]);
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

  test("readiness needs the codex binary and a live connection to its app server", () => {
    const live = { state: "live" } as const;
    expect(codexReadiness(() => null, () => false, live)).toMatchObject({ ready: false, reason: expect.stringContaining("not installed") });
    expect(codexReadiness(() => "/usr/bin/codex", () => false, live)).toEqual({ ready: true });
    expect(codexReadiness(() => null, () => true, live)).toEqual({ ready: true });
    expect(codexReadiness(() => "/usr/bin/codex", () => false, { state: "never" }))
      .toEqual({ ready: false, reason: "rt has no connection to the Codex app server yet" });
    expect(codexReadiness(() => "/usr/bin/codex", () => false, { state: "closed" }))
      .toEqual({ ready: false, reason: "rt's connection to the Codex app server closed" });
    expect(codexReadiness(() => "/usr/bin/codex", () => false, { state: "failed", message: "The Codex app server is not running." }))
      .toEqual({ ready: false, reason: "rt cannot reach the Codex app server: The Codex app server is not running." });
  });

  test("the loader shares one live connection, reconnects a closed one, and reports each state", async () => {
    const h = await harness();
    const connects: Array<{ socketPath: string; profile: string }> = [];
    const loader = createCodexSessionLoader({
      env: { HOME: "/Users/remy", CODEX_HOME: "/Users/remy/.codex/" },
      now: () => 0,
      discover: async () => ({ ok: true, data: { socketPath: SOCKET } }),
      connect: async (options) => { connects.push(options); return h.control; },
      sessions: h.deps,
    });
    const ready = () => codexReadiness(() => "/usr/bin/codex", () => false, loader.status());
    expect(loader.status()).toEqual({ state: "never" });
    expect(ready().ready).toBe(false);
    const [a, b] = await Promise.all([loader.load(), loader.load()]);
    expect(a).toBe(b);
    expect(connects).toEqual([{ socketPath: SOCKET, profile: "default" }]);
    expect(loader.status()).toEqual({ state: "live" });
    expect(ready()).toEqual({ ready: true });

    h.control.close();
    expect(loader.status()).toEqual({ state: "closed" });
    expect(ready()).toMatchObject({ ready: false });
    await loader.load();
    expect(connects).toHaveLength(2);
  });

  test("a failed discovery backs off: ticks during the wait spawn and connect nothing", async () => {
    let now = 0;
    let discovers = 0;
    let connects = 0;
    let running = false;
    const h = await harness();
    const loader = createCodexSessionLoader({
      env: {}, now: () => now,
      discover: async () => {
        discovers++;
        return running ? { ok: true, data: { socketPath: SOCKET } } : { ok: false, error: { code: "not-ready", message: "The Codex app server is not running." } };
      },
      connect: async () => { connects++; return h.control; },
      sessions: h.deps,
    });
    const tick = async (at: number) => { now = at; return loader.load(); };

    const unavailable = await tick(0);
    expect(await unavailable.launch(request())).toMatchObject({ ok: false, error: { code: "not-ready", message: "The Codex app server is not running." } });
    expect(await unavailable.observe(binding("T1"))).toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(await unavailable.discover()).toEqual([]);
    expect(loader.status()).toEqual({ state: "failed", message: "The Codex app server is not running." });
    expect(discovers).toBe(1);

    for (const at of [5_000, 10_000, 14_999]) await tick(at);
    expect(discovers).toBe(1);
    await tick(15_000);
    expect(discovers).toBe(2);
    for (const at of [25_000, 35_000, 44_999]) await tick(at);
    expect(discovers).toBe(2);
    await tick(45_000);
    expect(discovers).toBe(3);

    for (let i = 0; i < 12; i++) await tick(now + DISCOVERY_BACKOFF_CAP_MS);
    const capped = discovers;
    await tick(now + DISCOVERY_BACKOFF_CAP_MS - 1);
    expect(discovers).toBe(capped);
    expect(connects).toBe(0);

    running = true;
    await tick(now + DISCOVERY_BACKOFF_CAP_MS);
    expect(loader.status()).toEqual({ state: "live" });
    expect(connects).toBe(1);

    running = false;
    h.control.close();
    const before = discovers;
    await tick(now + 1);
    expect(discovers).toBe(before + 1);
    await tick(now + DISCOVERY_BACKOFF_MS - 1);
    expect(discovers).toBe(before + 1);
  });
});
