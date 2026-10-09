import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Outcome, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import { buildCodexRemoteResumeCommand } from "../../agent-argv/codex.ts";
import type { LaunchRequest } from "../contracts.ts";
import {
  connectCodexControl, type CodexClock, type CodexControl, type CodexSocket, type CodexSocketHandlers,
} from "../codex/control.ts";
import { codexEventHub } from "../codex/events.ts";
import { codexIntegration } from "../codex/integration.ts";
import {
  attachEvidence, awaitCodexHistory, CODEX_INIT_PROMPT, codexReadiness, createCodexSessionLoader, createCodexSessions,
  DISCOVERY_BACKOFF_CAP_MS, DISCOVERY_BACKOFF_MS, type CodexSessionAdapter, type CodexSessionDeps, type CodexSessionLoaderDeps, type PaneLaunch,
  type UnresolvedLaunch,
} from "../codex/sessions.ts";
import { DELIVERY_SWEEP_INTERVAL_MS, MAX_DELIVERY_BACKOFF_TICKS } from "../delivery.ts";
import { readDelivery, recordAttempt, settleAttempt } from "../delivery-store.ts";
import { createSessionStore } from "../session-store.ts";
import { setSetting } from "../../settings/write.ts";
import { openStateDb } from "../../state/db.ts";
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
  /** live-04: `{ status: notLoaded | notSubscribed | unsubscribed }`. */
  "thread/unsubscribe": (s, m) => s.push({ id: m.id, result: { status: "unsubscribed" } }),
};

const sockets: FakeSocket[] = [];
const clocks: FakeClock[] = [];
const controls: CodexControl[] = [];
const codexHomes: string[] = [];

/** How Codex 0.160 records a folder it trusts (live-01 evidence). */
const trustEntry = (path: string) => `[projects."${path}"]\ntrust_level = "trusted"\n`;

afterEach(() => {
  for (const home of codexHomes.splice(0)) rmSync(home, { recursive: true, force: true });
  for (const control of controls.splice(0)) control.close();
  expect(sockets.splice(0).every((socket) => socket.closed)).toBe(true);
  expect(clocks.splice(0).every((clock) => clock.active === 0)).toBe(true);
});

async function harness(
  handlers: Record<string, Handler> = {},
  options: { threads?: string[]; unresolved?: Map<string, UnresolvedLaunch>; codexConfig?: string | null } = {},
) {
  const codexHome = mkdtempSync(join(tmpdir(), "rt-codex-home-"));
  codexHomes.push(codexHome);
  const config = join(codexHome, "config.toml");
  const writeConfig = (body: string | null) => {
    if (body === null) rmSync(config, { force: true });
    else writeFileSync(config, body);
  };
  writeConfig(options.codexConfig === undefined ? trustEntry("/work/a") : options.codexConfig);
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
    trustConfig: () => config,
    openPane: async (launch) => {
      ops.push("pane");
      panes.push(launch);
      return { ok: true, data: { pane: `p${panes.length}` } };
    },
    confirmAttached: async (opened, expected) => {
      confirmed.push({ ...expected, pane: opened.pane });
      return confirm;
    },
    paneRuns: async () => true,
  };
  return {
    clock, control, ops, panes, confirmed, deps, config, writeConfig,
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

  test("the terminal opens where the launch host says, and carries none of the launch's env: the thread's tools never run in it", async () => {
    const h = await harness();
    const host = { workspace: "acme", tab: "worker", env: { RT_AGENT_ID: "a1" }, unsetEnv: ["CLAUDE_CODE_SESSION_ID"] };
    const launched = data(await h.sessions().launch(request({ host })));
    expect(h.panes).toEqual([{
      cwd: "/work/a", reservationId: "res-1", host,
      command: buildCodexRemoteResumeCommand("/work/a", { socketPath: SOCKET, threadId: "T1" }),
    }]);
    expect(h.panes[0]!.command).toStartWith("cd '/work/a' && codex --remote");
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

  test("a terminal that never shows the thread's history is a blocked attachment; a same-id retry re-checks the same pane", async () => {
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

    const second = await harness({}, { unresolved, codexConfig: trustEntry("/work/a") + trustEntry("/work/b") });
    const sessions = second.sessions();
    expect(await sessions.launch(request())).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    expect(await sessions.launch(request({ reservationId: "res-2" }))).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(await sessions.launch(request({ reservationId: "res-3", cwd: "/work/b" }))).toMatchObject({ ok: true });
    expect(second.requests("thread/start").map((m) => m.params.cwd)).toEqual(["/work/b"]);
  });

  test("an unresolved launch is dropped once its persisted reservation is abandoned or bound", async () => {
    let starts = 0;
    const h = await harness({ "thread/start": (s, m) => { if (++starts > 1) DEFAULTS["thread/start"]!(s, m); } });
    const settled = new Set<string>();
    const asked: string[] = [];
    const sessions = h.sessions({ reservationSettled: (id) => { asked.push(id); return settled.has(id); } });
    const first = sessions.launch(request());
    await Bun.sleep(0);
    h.clock.advance(1000);
    expect(await first).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    expect(await sessions.launch(request({ reservationId: "res-2", mode: "headless" }))).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(asked).toContain("res-1");

    settled.add("res-1");
    expect(await sessions.launch(request({ reservationId: "res-2", mode: "headless" }))).toMatchObject({ ok: true });
    expect(h.requests("thread/start")).toHaveLength(2);
  });

  test("a launch sends thread/start the cwd it reserved", async () => {
    const h = await harness();
    data(await h.sessions().launch(request({ cwd: "/work/./a//", mode: "headless" })));
    expect(h.requests("thread/start")[0]!.params.cwd).toBe("/work/a");
  });
});

describe("folder trust", () => {
  test("a Herdr launch in a folder Codex does not already trust starts nothing, opens no pane and leaves Codex's config alone", async () => {
    const h = await harness({}, { codexConfig: trustEntry("/work/b") });
    const before = { body: readFileSync(h.config, "utf8"), mtime: statSync(h.config).mtimeMs };
    const sessions = h.sessions();

    const outcome = await sessions.launch(request());
    expect(outcome).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(outcome.ok || outcome.error.message).toContain("/work/a");
    expect(outcome.ok || outcome.error.message).toContain("trust it");
    expect(h.ops).toEqual([]);
    expect(h.panes).toEqual([]);
    expect(h.confirmed).toEqual([]);
    expect({ body: readFileSync(h.config, "utf8"), mtime: statSync(h.config).mtimeMs }).toEqual(before);
    expect(h.control.reserveLaunch("/work/a").ok).toBe(true);
  });

  test("once the person trusts the folder in Codex, a same-id retry launches and attaches once", async () => {
    const h = await harness({}, { codexConfig: null });
    const sessions = h.sessions();
    expect(await sessions.launch(request())).toMatchObject({ ok: false, error: { code: "refused" } });

    h.writeConfig(trustEntry("/work/a"));
    expect(data(await sessions.launch(request())).attachment).toEqual({ mode: "herdr", pane: "p1" });
    expect(h.ops).toEqual(["thread/start", "turn/start", "pane"]);
  });

  test("a Herdr resume in a folder Codex does not already trust reads no thread and opens no pane", async () => {
    const h = await harness({}, { codexConfig: `[projects."/work/a"]\ntrust_level = "untrusted"\n` });
    const before = readFileSync(h.config, "utf8");
    const outcome = await h.sessions().resume(binding("T1").native, request({ reservationId: "r-resume" }));
    expect(outcome).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(outcome.ok || outcome.error.message).toContain("/work/a");
    expect(h.ops).toEqual([]);
    expect(h.panes).toEqual([]);
    expect(readFileSync(h.config, "utf8")).toBe(before);
  });

  test("a Herdr resume in a trusted folder attaches", async () => {
    const h = await harness();
    expect(data(await h.sessions().resume(binding("T1").native, request({ reservationId: "r-resume" }))).attachment)
      .toEqual({ mode: "herdr", pane: "p1" });
  });

  test("a missing, unparsable or unlocatable Codex config refuses a Herdr attach", async () => {
    for (const config of [null, `[projects."/work/a"\ntrust_level = "trusted"\n`]) {
      const h = await harness({}, { codexConfig: config });
      expect(await h.sessions().launch(request())).toMatchObject({ ok: false, error: { code: "refused" } });
      expect(await h.sessions().resume(binding("T1").native, request({ reservationId: "r-resume" })))
        .toMatchObject({ ok: false, error: { code: "refused" } });
      expect(h.ops).toEqual([]);
    }
    const nowhere = await harness();
    expect(await nowhere.sessions({ trustConfig: () => undefined }).launch(request()))
      .toMatchObject({ ok: false, error: { code: "refused" } });
    expect(nowhere.ops).toEqual([]);
  });

  test("a trusted parent folder does not admit a Herdr attach in a folder inside it", async () => {
    const h = await harness({}, { codexConfig: trustEntry("/work") });
    expect(await h.sessions().launch(request())).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(h.ops).toEqual([]);
  });

  test("headless sessions need no folder trust", async () => {
    const h = await harness({}, { codexConfig: null });
    const sessions = h.sessions();
    expect(data(await sessions.launch(request({ mode: "headless" }))).attachment).toEqual({ mode: "headless" });
    expect(data(await sessions.resume(binding("T1").native, request({ mode: "headless", reservationId: "r-resume" }))).attachment)
      .toEqual({ mode: "headless" });
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

    release({ ok: false, error: { code: "not-ready", message: "no history on screen" } });
    expect(await first).toMatchObject({ ok: false, error: { code: "not-ready" } });
    h.blockAttach({ ok: true, data: undefined });
    expect(data(await sessions.resume(binding("T1").native, request({ reservationId: "r-resume" }))).attachment)
      .toEqual({ mode: "herdr", pane: "p1" });
    expect(h.panes).toHaveLength(1);
  });

  test("an unconfirmed resume keeps its pane; a same-id retry re-checks it instead of opening another", async () => {
    const h = await harness();
    const sessions = h.sessions();
    h.blockAttach({ ok: false, error: { code: "not-ready", message: "no history on screen" } });
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

    const moved = await harness({}, { codexConfig: trustEntry("/work/a") + trustEntry("/work/b") });
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

    // Synchronous plan-mode forms are owned through gates (codex-questions.test.ts); async questions never are.
    const report = await codexIntegration.capabilities("herdr");
    for (const cap of ["questions-wait", "questions-async"] as const) expect(report.supported).not.toContain(cap);
    for (const cap of ["questions-form", "question-recovery"] as const) expect(report.supported).toContain(cap);
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
    expect(await sessions.end!(binding("T1"))).toMatchObject({ ok: false, error: { code: "not-ready" } });
  });

  test("ending a headless thread interrupts its running turn, reports it ended and lets it go", async () => {
    const h = await harness({
      "turn/start": (s, m) => {
        s.push({ id: m.id, result: { turn: { id: "U0", items: [], status: "inProgress" } } });
        s.push(turn("turn/started", m.params.threadId, "U0"));
      },
      "turn/interrupt": (s, m) => {
        s.push({ id: m.id, result: {} });
        s.push(turn("turn/completed", m.params.threadId, m.params.turnId, "interrupted"));
      },
    });
    const gone: Array<{ value: string; event: string; generation?: number }> = [];
    const sessions = h.sessions({ enabled: () => true, lifecycle: async (native, event, generation) => { gone.push({ value: native.value, event, generation }); return true; } });
    const headless = binding("T1", { attachment: { generation: 1, mode: "headless" } });
    const receipt = data(await sessions.startWork(headless, { id: "w1", text: "go" }));

    data(await sessions.end!(headless));
    expect(await receipt.completion).toMatchObject({ exitCode: 1 });
    expect(h.requests("turn/interrupt").map((m) => m.params)).toEqual([{ threadId: "T1", turnId: "U0" }]);
    expect(gone).toEqual([{ value: "T1", event: "ended", generation: 1 }]);
    expect(h.requests("thread/unsubscribe").map((m) => m.params)).toEqual([{ threadId: "T1" }]);
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
    expect(typeof codexIntegration.loadQuestions).toBe("function");
    const base = ["launch", "resume", "observe", "peer-idle", "peer-working", "questions-form", "question-recovery"] as const;
    // Policy is claimed only where live checks proved it: headless threads, not terminal-attached ones.
    for (const [mode, policy] of [["herdr", []], ["headless", ["gate-policy", "continuation-policy"]]] as const) {
      const report = await codexIntegration.capabilities(mode);
      expect(report.supported).toEqual([...base, ...policy]);
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


/**
 * live-03 (probe-events.jsonl) and live-04: a connection that never started
 * or resumed a thread hears only its status changes and thread/closed; item
 * events reach only the connections subscribed to it, which thread/start and
 * thread/resume make and thread/unsubscribe ends. `loaded` is each thread's
 * native status; resuming an unloaded thread loads it. `history` is what
 * thread/read with turns returns: the clientId each turn's user message carried.
 */
function subscribingServer(loaded: Record<string, string>, history: Record<string, Array<{ turn: string; item: string; clientId: string }>> = {}) {
  const subscribed = new Set<string>();
  const status = (threadId: string) => ({ type: loaded[threadId] ?? "notLoaded", ...(loaded[threadId] === "active" && { activeFlags: [] }) });
  const handlers: Record<string, Handler> = {
    "thread/read": (s, m) => s.push({
      id: m.id,
      result: {
        thread: {
          id: m.params.threadId, cwd: "/work/a", status: status(m.params.threadId), preview: "x",
          turns: m.params.includeTurns
            ? (history[m.params.threadId] ?? []).map((h) => ({ id: h.turn, status: "completed", items: [{ type: "userMessage", id: h.item, clientId: h.clientId, content: [] }] }))
            : [],
        },
      },
    }),
    "thread/resume": (s, m) => {
      subscribed.add(m.params.threadId);
      if (loaded[m.params.threadId] === undefined || loaded[m.params.threadId] === "notLoaded") loaded[m.params.threadId] = "idle";
      s.push({ id: m.id, result: { thread: { id: m.params.threadId, cwd: "/work/a", status: status(m.params.threadId) }, cwd: "/work/a" } });
    },
    "thread/unsubscribe": (s, m) => {
      const was = subscribed.delete(m.params.threadId);
      s.push({ id: m.id, result: { status: was ? "unsubscribed" : "notSubscribed" } });
    },
    "thread/queue/add": (s, m) => s.push({ id: m.id, result: { queuedSubmission: { id: `Q-${m.params.clientUserMessageId}`, clientUserMessageId: m.params.clientUserMessageId } } }),
  };
  /** What the native server sends this connection when the thread takes a user message. */
  const userMessage = (s: FakeSocket, threadId: string, clientId: string, turnId = "U9", itemId = "I9") => {
    s.push(statusChanged(threadId, { type: "active", activeFlags: [] }));
    if (!subscribed.has(threadId)) return;
    s.push(turn("turn/started", threadId, turnId));
    s.push({ method: "item/started", params: { threadId, turnId, startedAtMs: 1, item: { type: "userMessage", id: itemId, clientId, content: [] } } });
  };
  return { handlers, subscribed, userMessage };
}

type Gone = { value: string; event: "unloaded" | "ended"; generation?: number };
const queuedAndTaken = (server: ReturnType<typeof subscribingServer>): Handler => (s, m) => {
  s.push({ id: m.id, result: { queuedSubmission: { id: "Q1", clientUserMessageId: m.params.clientUserMessageId } } });
  server.userMessage(s, "T1", m.params.clientUserMessageId);
};
const peerInput = { id: "d-5-remy", sender: "max (#general)", body: "hi", recipient: "remy" };
const peer = (id: string) => ({ ...peerInput, id });
/** How long one delivery keeps its thread subscribed: the queued recheck's saturated interval. */
const HOLD_MS = DELIVERY_SWEEP_INTERVAL_MS * MAX_DELIVERY_BACKOFF_TICKS;

function loaderOn(h: Awaited<ReturnType<typeof harness>>, over: Partial<CodexSessionLoaderDeps> = {}, sessions: Partial<CodexSessionDeps> = {}) {
  return createCodexSessionLoader({
    env: {}, now: () => 0,
    discover: async () => ({ ok: true, data: { socketPath: SOCKET } }),
    connect: async () => h.control,
    outstanding: () => [],
    headless: () => [],
    messaging: { currentBinding: () => binding("T1"), persisted: () => null },
    ...over,
    sessions: { ...h.deps, enabled: () => true, lifecycle: async () => false, ...sessions },
  });
}

describe("subscription only while deliveries are outstanding (M2b round 2)", () => {
  test("a queue/add subscribes first, and the echo that confirms it unsubscribes: nothing stays subscribed", async () => {
    const server = subscribingServer({ T1: "idle" });
    server.handlers["thread/queue/add"] = queuedAndTaken(server);
    const h = await harness(server.handlers);
    const messaging = await loaderOn(h).loadMessaging();
    expect(data(await messaging.submit(binding("T1"), peerInput)).evidence).toBe("consumed");
    expect(h.ops).toEqual(["thread/read", "thread/resume", "thread/queue/add", "thread/unsubscribe"]);
    expect(h.requests("thread/resume")[0]!.params).toEqual({ threadId: "T1", excludeTurns: true });
    expect(h.requests("thread/unsubscribe")[0]!.params).toEqual({ threadId: "T1" });
    expect([...server.subscribed]).toEqual([]);
  });

  test("two outstanding deliveries share one subscription, held until the last one is confirmed", async () => {
    const server = subscribingServer({ T1: "idle" });
    const h = await harness(server.handlers);
    const messaging = await loaderOn(h).loadMessaging();
    expect(data(await messaging.submit(binding("T1"), peer("d-1-remy"))).evidence).toBe("queued");
    expect(data(await messaging.submit(binding("T1"), peer("d-2-remy"))).evidence).toBe("queued");
    expect(h.requests("thread/resume")).toHaveLength(1);
    server.userMessage(h.socket(), "T1", "d-1-remy", "U1", "I1");
    expect(h.requests("thread/unsubscribe")).toEqual([]);
    server.userMessage(h.socket(), "T1", "d-2-remy", "U2", "I2");
    expect(h.requests("thread/unsubscribe")).toHaveLength(1);
    expect(data(await messaging.reconcile!(binding("T1"), "d-2-remy"))).toMatchObject({ evidence: "consumed", turnId: "U2", itemId: "I2" });
    expect([...server.subscribed]).toEqual([]);
  });

  test("a hold that outlasts its window lets go, and the delivery is then confirmed from the thread's history", async () => {
    const server = subscribingServer({ T1: "idle" }, { T1: [{ turn: "U7", item: "I7", clientId: "d-5-remy" }] });
    const h = await harness(server.handlers);
    const messaging = await loaderOn(h).loadMessaging();
    expect(data(await messaging.submit(binding("T1"), peerInput)).evidence).toBe("queued");
    h.clock.advance(HOLD_MS - 1);
    expect(h.requests("thread/unsubscribe")).toEqual([]);
    h.clock.advance(1);
    expect(h.requests("thread/unsubscribe")).toHaveLength(1);
    expect(data(await messaging.reconcile!(binding("T1"), "d-5-remy"))).toMatchObject({ evidence: "consumed", turnId: "U7", itemId: "I7" });
    expect(h.requests("thread/read").map((m) => m.params)).toEqual([{ threadId: "T1", includeTurns: false }, { threadId: "T1", includeTurns: true }]);
  });

  test("an unloaded thread takes nothing: nothing is queued and nothing stays subscribed", async () => {
    const server = subscribingServer({ T1: "notLoaded" });
    const h = await harness(server.handlers);
    const gone: Gone[] = [];
    const messaging = await loaderOn(h, {}, { lifecycle: async (native, event, generation) => { gone.push({ value: native.value, event, generation }); return false; } }).loadMessaging();
    expect(await messaging.submit(binding("T1"), peerInput)).toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(h.ops).toEqual(["thread/read"]);
    expect(gone).toEqual([{ value: "T1", event: "unloaded", generation: 3 }]);
  });

  test("after a reconnect only threads with outstanding rows are subscribed, and the recovered echo confirms and lets go", async () => {
    const server = subscribingServer({ T1: "idle", T2: "idle" });
    const h = await harness(server.handlers);
    const loader = loaderOn(h, {
      outstanding: () => [{ binding: binding("T1"), ids: ["d-5-remy"] }],
      messaging: {
        currentBinding: () => binding("T1"),
        persisted: (id) => (id === "d-5-remy"
          ? { inputId: id, frameId: id, state: "queued", harness: "codex", sessionKey: "k1", generation: 3, nativeId: "T1" }
          : null),
      },
    });
    const messaging = await loader.loadMessaging();
    expect(h.requests("thread/resume").map((m) => m.params)).toEqual([{ threadId: "T1", excludeTurns: true }]);
    server.userMessage(h.socket(), "T1", "d-5-remy");
    expect(data(await messaging.reconcile!(binding("T1"), "d-5-remy"))).toMatchObject({ evidence: "consumed", turnId: "U9", itemId: "I9" });
    expect(h.requests("thread/unsubscribe").map((m) => m.params)).toEqual([{ threadId: "T1" }]);
    expect(h.requests("thread/queue/add")).toEqual([]);
  });

  test("a launched Herdr thread is let go once its terminal attached; a headless one stays subscribed", async () => {
    const herdr = await harness();
    data(await herdr.sessions({ enabled: () => true }).launch(request()));
    expect(herdr.ops.at(-1)).toBe("thread/unsubscribe");
    const headless = await harness();
    data(await headless.sessions({ enabled: () => true }).launch(request({ mode: "headless" })));
    expect(headless.requests("thread/unsubscribe")).toEqual([]);
  });

  test("observe reads a thread's status once and never subscribes", async () => {
    const server = subscribingServer({ T1: "idle" });
    const h = await harness(server.handlers);
    const sessions = h.sessions({ enabled: () => true, lifecycle: async () => false });
    expect(data(await sessions.observe(binding("T1")))).toMatchObject({ connectivity: "connected", execution: "idle" });
    await sessions.observe(binding("T1"));
    expect(h.ops).toEqual(["thread/read"]);
  });
});

describe("per-thread liveness (M2b D2)", () => {
  test("an attached binding whose thread is not loaded is reported gone at its own generation, and never resumed", async () => {
    const server = subscribingServer({ T1: "notLoaded" });
    const h = await harness(server.handlers);
    const gone: Gone[] = [];
    const sessions = h.sessions({ enabled: () => true, lifecycle: async (native, event, generation) => { gone.push({ value: native.value, event, generation }); return false; } });
    expect(data(await sessions.observe(binding("T1")))).toMatchObject({ connectivity: "disconnected" });
    expect(gone).toEqual([{ value: "T1", event: "unloaded", generation: 3 }]);
    expect(h.requests("thread/resume")).toEqual([]);
  });

  test("a native unload and a close each report a thread rt owns unloaded; only the sessionEnd hook ends it, and other hooks do nothing (live-05 ruling)", async () => {
    const server = subscribingServer({ T1: "idle", T2: "idle", T3: "idle" });
    const h = await harness(server.handlers);
    const gone: Gone[] = [];
    const sessions = h.sessions({ enabled: () => true, lifecycle: async (native, event, generation) => { gone.push({ value: native.value, event, generation }); return false; } });
    for (const t of ["T1", "T2", "T3"]) await sessions.observe(binding(t));
    const s = h.socket();
    s.push({ method: "hook/completed", params: { threadId: "T3", turnId: "U1", run: { id: "h1", eventName: "stop", status: "completed" } } });
    s.push(statusChanged("T1", { type: "notLoaded" }));
    // Codex closes a thread about 60 s after its last subscriber leaves (live-04), TUI quit or not, so a close detaches and never signs out.
    s.push({ method: "thread/closed", params: { threadId: "T2" } });
    s.push({ method: "hook/started", params: { threadId: "T3", turnId: null, run: { id: "h2", eventName: "sessionEnd", status: "running" } } });
    await Bun.sleep(1);
    expect(gone).toEqual([{ value: "T1", event: "unloaded" }, { value: "T2", event: "unloaded" }, { value: "T3", event: "ended" }]);
  });

  test("with the switch off observe holds nothing and no lifecycle is reported", async () => {
    const server = subscribingServer({ T1: "idle" });
    const h = await harness(server.handlers);
    const gone: Gone[] = [];
    const sessions = h.sessions({ enabled: () => false, lifecycle: async (native, event) => { gone.push({ value: native.value, event }); return false; } });
    await sessions.observe(binding("T1"));
    h.socket().push(statusChanged("T1", { type: "notLoaded" }));
    expect(h.ops).toEqual(["thread/read"]);
    expect(gone).toEqual([]);
  });
});

describe("a Herdr attachment needs its codex pane (M2b round 2)", () => {
  test("live only while the thread is loaded and herdr shows codex in the pane; offline when the pane goes though the thread stays loaded", async () => {
    const server = subscribingServer({ T1: "idle" });
    const h = await harness(server.handlers);
    let pane = true;
    const checked: string[] = [];
    const loader = loaderOn(h, {}, { paneRuns: async (b) => { checked.push(`${b.native.value}@${b.attachment.pane}`); return pane; } });
    const sessions = await loader.load();
    expect(loader.bindingLive(binding("T1"))).toBe(false);
    await sessions.observe(binding("T1"));
    expect(loader.bindingLive(binding("T1"))).toBe(true);
    pane = false;
    await sessions.observe(binding("T1"));
    expect(loader.bindingLive(binding("T1"))).toBe(false);
    expect(codexEventHub(h.control).live("T1")).toBe(true);
    pane = true;
    await sessions.observe(binding("T1"));
    expect(loader.bindingLive(binding("T1", { attachment: { generation: 4, mode: "herdr", pane: "p2" } }))).toBe(false);
    h.socket().push(statusChanged("T1", { type: "notLoaded" }));
    expect(loader.bindingLive(binding("T1"))).toBe(false);
    expect(checked).toEqual(["T1@p1", "T1@p1", "T1@p1"]);
  });

  test("a headless attachment keeps loaded-only liveness and is never checked against a pane", async () => {
    const server = subscribingServer({ T1: "idle" });
    const h = await harness(server.handlers);
    let checks = 0;
    const loader = loaderOn(h, {}, { paneRuns: async () => { checks++; return false; } });
    const sessions = await loader.load();
    const headless = binding("T1", { attachment: { generation: 3, mode: "headless" } });
    // Only rt's own subscription keeps a headless thread loaded, so one this connection knows nothing of is not live (live-05 D7).
    expect(loader.bindingLive(headless)).toBe(false);
    await sessions.observe(headless);
    expect(loader.bindingLive(headless)).toBe(true);
    h.socket().push(statusChanged("T1", { type: "notLoaded" }));
    expect(loader.bindingLive(headless)).toBe(false);
    expect(checks).toBe(0);
  });
});

describe("unsubscribing threads rt lets go (M2b review)", () => {
  test("disowning a held thread unsubscribes it before releasing it", async () => {
    const server = subscribingServer({ T1: "idle" });
    const h = await harness(server.handlers);
    const sessions = h.sessions({ enabled: () => true, lifecycle: async () => false });
    data(await sessions.hold(binding("T1"), "d-1-remy"));
    sessions.disown(binding("T1"));
    expect(h.requests("thread/unsubscribe").map((m) => m.params)).toEqual([{ threadId: "T1" }]);
    sessions.disown(binding("T1"));
    expect(h.requests("thread/unsubscribe")).toHaveLength(1);
    expect(h.clock.active).toBe(0);
  });

  test("a detach or an end rt applied unsubscribes the thread; a report that changed nothing does not", async () => {
    const server = subscribingServer({ T1: "idle", T2: "idle", T3: "idle", T4: "notLoaded" });
    const h = await harness(server.handlers);
    const applied = new Set(["T1", "T2", "T4"]);
    const sessions = h.sessions({ enabled: () => true, lifecycle: async (native) => applied.has(native.value) });
    for (const t of ["T1", "T2", "T3"]) data(await sessions.hold(binding(t), `d-${t}`));
    const s = h.socket();
    s.push(statusChanged("T1", { type: "notLoaded" }));
    s.push({ method: "thread/closed", params: { threadId: "T2" } });
    s.push({ method: "thread/closed", params: { threadId: "T3" } });
    await Bun.sleep(1);
    await sessions.observe(binding("T4"));
    expect(h.requests("thread/unsubscribe").map((m) => m.params.threadId)).toEqual(["T1", "T2", "T4"]);
    sessions.release("T3", "d-T3");
    expect(h.clock.active).toBe(0);
  });

  test("a thread rt does not own is never unsubscribed", async () => {
    const h = await harness();
    const sessions = h.sessions({ enabled: () => true, lifecycle: async () => true });
    sessions.disown(binding("T9"));
    sessions.disown({ ...binding("T1"), native: { ...binding("T1").native, profile: "/other/.codex" } });
    h.socket().push({ method: "thread/closed", params: { threadId: "T9" } });
    await Bun.sleep(1);
    expect(h.requests("thread/unsubscribe")).toEqual([]);
  });

  test("with the switch off nothing is unsubscribed on an end", async () => {
    const h = await harness({}, { threads: ["T1"] });
    h.sessions({ enabled: () => false, lifecycle: async () => true });
    h.socket().push({ method: "thread/closed", params: { threadId: "T1" } });
    await Bun.sleep(1);
    expect(h.requests("thread/unsubscribe")).toEqual([]);
  });
});

/** A server whose thread/resume answers only when the test says, so something can happen while it is in flight. */
function deferredResume(server: ReturnType<typeof subscribingServer>) {
  const waiting: Array<() => void> = [];
  server.handlers["thread/resume"] = ((resume) => (s: FakeSocket, m: Message) => { waiting.push(() => resume(s, m)); })(server.handlers["thread/resume"]!);
  return { answer: () => waiting.shift()!(), pending: () => waiting.length };
}

describe("round 3: headless threads, hold races and every ending (M2b review)", () => {
  test("after a reconnect every attached headless binding is subscribed again, kept through releases, and stays attached", async () => {
    const server = subscribingServer({ T1: "idle", T2: "idle" });
    const h = await harness(server.handlers);
    const gone: Gone[] = [];
    const headlessT1 = binding("T1", { attachment: { generation: 3, mode: "headless" } });
    const loader = loaderOn(h, { headless: () => [headlessT1] }, {
      lifecycle: async (native, event, generation) => { gone.push({ value: native.value, event, generation }); return true; },
    });
    const sessions = (await loader.load()) as CodexSessionAdapter;
    expect(h.requests("thread/resume").map((m) => m.params)).toEqual([{ threadId: "T1", excludeTurns: true }]);
    expect([...server.subscribed]).toEqual(["T1"]);
    data(await sessions.hold(headlessT1, "d-1-remy"));
    sessions.release("T1", "d-1-remy");
    await sessions.observe(headlessT1);
    expect(h.requests("thread/unsubscribe")).toEqual([]);
    expect(gone).toEqual([]);
    expect(loader.bindingLive(headlessT1)).toBe(true);
  });

  test("a thread disowned or ended while its subscription was being made is unsubscribed at once, and the hold fails", async () => {
    for (const end of ["disown", "closed"] as const) {
      const server = subscribingServer({ T1: "idle" });
      const resume = deferredResume(server);
      const h = await harness(server.handlers);
      const sessions = h.sessions({ enabled: () => true, lifecycle: async () => true });
      const held = sessions.hold(binding("T1"), "d-1-remy");
      await Bun.sleep(1);
      expect(resume.pending()).toBe(1);
      if (end === "disown") sessions.disown(binding("T1"));
      else h.socket().push({ method: "thread/closed", params: { threadId: "T1" } });
      await Bun.sleep(1);
      resume.answer();
      expect(await held).toMatchObject({ ok: false, error: { code: "stale-binding" } });
      expect(h.requests("thread/unsubscribe").at(-1)!.params).toEqual({ threadId: "T1" });
      expect([...server.subscribed]).toEqual([]);
      expect(sessions.held("T1", "d-1-remy")).toBe(false);
      expect(h.clock.active).toBe(0);
    }
  });

  test("a subscribe that fails is not a hold: the delivery still goes out and its echo is looked for in the history", async () => {
    const server = subscribingServer({ T1: "idle" }, { T1: [{ turn: "U3", item: "I3", clientId: "d-5-remy" }] });
    server.handlers["thread/resume"] = (s, m) => s.push({ id: m.id, error: { code: -32603, message: "resume failed" } });
    const h = await harness(server.handlers);
    const loader = loaderOn(h);
    const sessions = (await loader.load()) as CodexSessionAdapter;
    const messaging = await loader.loadMessaging();
    expect(data(await messaging.submit(binding("T1"), peerInput)).evidence).toBe("queued");
    expect(sessions.held("T1", "d-5-remy")).toBe(false);
    expect(h.clock.active).toBe(0);
    expect(data(await messaging.reconcile!(binding("T1"), "d-5-remy"))).toMatchObject({ evidence: "consumed", turnId: "U3", itemId: "I3" });
  });

  test("a Herdr launch whose terminal never attached lets go of its thread/start subscription", async () => {
    const h = await harness();
    h.blockAttach({ ok: false, error: { code: "not-ready", message: "the terminal never showed the thread's history" } });
    expect(await h.sessions({ enabled: () => true }).launch(request())).toMatchObject({ ok: false });
    expect(h.requests("thread/unsubscribe").map((m) => m.params)).toEqual([{ threadId: "T1" }]);
  });

  test("work on a Herdr binding needs codex in its pane: without it the turn is refused, and a headless binding is unaffected", async () => {
    const h = await harness();
    let pane = false;
    const sessions = h.sessions({ enabled: () => true, paneRuns: async () => pane });
    const refused = await sessions.startWork(binding("T1"), { id: "w1", text: "the real brief" });
    expect(refused).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(refused.ok ? "" : refused.error.message).toContain("pane p1");
    expect(h.requests("turn/start")).toEqual([]);
    pane = true;
    expect(data(await sessions.startWork(binding("T1"), { id: "w2", text: "the real brief" })).turnId).toBe("U0");
    pane = false;
    const headless = binding("T2", { attachment: { generation: 3, mode: "headless" } });
    const done = data(await sessions.startWork(headless, { id: "w3", text: "the real brief" }));
    expect(done.turnId).toBe("U0");
    await done.completion;
    expect(h.requests("turn/start").map((m) => m.params.threadId)).toEqual(["T1", "T2"]);
  });
});

describe("round 4: headless bindings as the store records them, keep retries, close detaches (live-05)", () => {
  const headlessBinding = (value: string, key = "k1") => binding(value, { key, attachment: { generation: 3, mode: "headless" } });

  test("a connection keeps and holds the headless bindings the state db records, bound as rt agent start --surface headless binds them", async () => {
    setSetting("agent.integrations.enabled", true, "machine");
    const dir = mkdtempSync(join(tmpdir(), "rt-codex-loader-db-"));
    try {
      const db = openStateDb(join(dir, "state.db"));
      const store = createSessionStore(db);
      const bindHeadless = (identity: string, value: string) =>
        data(store.bind(store.reserve({ identity }), { harness: "codex", profile: "default", kind: "id", value }, { mode: "headless" }));
      const kept = bindHeadless("m5head.2ocd", "T1");
      const owed = bindHeadless("m5head.3pqr", "T2");
      const paned = data(store.bind(store.reserve({ identity: "m5worker.1405" }), { harness: "codex", profile: "default", kind: "id", value: "T3" }, { mode: "herdr", pane: "w1:p1" }));
      const attempt = { frameId: "d-5-remy", recipient: "remy", sessionKey: owed.key, generation: 1, harness: "codex", constituents: [{ id: "d-5-remy" }] };
      data(recordAttempt(db, attempt, 1, 2));
      settleAttempt(db, attempt, "queued", 1, { receipt: { nativeId: "T2" } });

      const server = subscribingServer({ T1: "idle", T2: "idle", T3: "idle" });
      const h = await harness(server.handlers);
      const loader = createCodexSessionLoader({
        env: {}, now: () => 0, discover: async () => ({ ok: true, data: { socketPath: SOCKET } }), connect: async () => h.control,
        db: () => db, messaging: { currentBinding: (key) => store.get(key), persisted: (id) => readDelivery(db, id) },
        sessions: { ...h.deps, enabled: () => true, lifecycle: async () => false },
      });
      const messaging = await loader.loadMessaging();
      expect(h.requests("thread/resume").map((m) => m.params.threadId).sort()).toEqual(["T1", "T2"]);
      expect([...server.subscribed].sort()).toEqual(["T1", "T2"]);
      server.userMessage(h.socket(), "T2", "d-5-remy");
      expect(data(await messaging.reconcile!(owed, "d-5-remy"))).toMatchObject({ evidence: "consumed" });
      expect(h.requests("thread/unsubscribe")).toEqual([]);
      expect(loader.bindingLive(kept)).toBe(true);
      expect(loader.bindingLive(owed)).toBe(true);
      expect(loader.bindingLive(paned)).toBe(false);
    } finally {
      setSetting("agent.integrations.enabled", false, "machine");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("observe subscribes a headless thread again when its keep failed at connect, once, and never an unloaded one", async () => {
    const server = subscribingServer({ T1: "idle", T2: "notLoaded" });
    let failing = 1;
    const resume = server.handlers["thread/resume"]!;
    server.handlers["thread/resume"] = (s, m) => {
      if (failing-- > 0) s.push({ id: m.id, error: { code: -32603, message: "resume failed" } });
      else resume(s, m);
    };
    const h = await harness(server.handlers);
    const gone: Gone[] = [];
    const headlessT1 = headlessBinding("T1");
    const headlessT2 = headlessBinding("T2", "k2");
    const loader = loaderOn(h, { headless: () => [headlessT1] }, {
      lifecycle: async (native, event, generation) => { gone.push({ value: native.value, event, generation }); return true; },
    });
    const sessions = (await loader.load()) as CodexSessionAdapter;
    expect(h.requests("thread/resume")).toHaveLength(1);
    expect([...server.subscribed]).toEqual([]);

    await sessions.observe(headlessT1);
    expect(h.requests("thread/resume").map((m) => m.params)).toEqual([{ threadId: "T1", excludeTurns: true }, { threadId: "T1", excludeTurns: true }]);
    expect([...server.subscribed]).toEqual(["T1"]);
    await sessions.observe(headlessT1);
    expect(h.requests("thread/resume")).toHaveLength(2);
    data(await sessions.hold(headlessT1, "d-1-remy"));
    sessions.release("T1", "d-1-remy");
    expect(h.requests("thread/unsubscribe")).toEqual([]);
    expect(loader.bindingLive(headlessT1)).toBe(true);
    expect(gone).toEqual([]);

    await sessions.observe(headlessT2);
    expect(gone).toEqual([{ value: "T2", event: "unloaded", generation: 3 }]);
    expect(h.requests("thread/resume")).toHaveLength(2);
    expect(h.requests("thread/unsubscribe").map((m) => m.params.threadId)).toEqual(["T2"]);
    expect(loader.bindingLive(headlessT2)).toBe(false);
  });

  test("a keep that fails leaves alone the headless mark a launch set meanwhile, so the launched thread is never let go", async () => {
    const server = subscribingServer({ T1: "idle" });
    const pending: Array<{ s: FakeSocket; m: Message }> = [];
    server.handlers["thread/resume"] = (s, m) => { pending.push({ s, m }); };
    const h = await harness(server.handlers);
    const sessions = h.sessions({ enabled: () => true, lifecycle: async () => false });
    const headlessT1 = headlessBinding("T1");
    const kept = sessions.keep(headlessT1);
    await Bun.sleep(1);
    expect(pending).toHaveLength(1);
    data(await sessions.launch(request({ mode: "headless" })));
    const { s, m } = pending.shift()!;
    s.push({ id: m.id, error: { code: -32603, message: "resume failed" } });
    expect(await kept).toMatchObject({ ok: false, error: { code: "transient" } });

    data(await sessions.hold(headlessT1, "d-1-remy"));
    sessions.release("T1", "d-1-remy");
    expect(h.requests("thread/unsubscribe")).toEqual([]);
    expect(h.clock.active).toBe(0);
  });
});

describe("hooks Codex loads for a folder", () => {
  const hook = (eventName: string, sourcePath: string) => ({
    key: `${sourcePath}:${eventName}:0:0`, eventName, handlerType: "command", command: "'/opt/rt' agent policy-hook", async: false,
    matcher: null, timeoutSec: 10, sourcePath, source: "project", pluginId: null, displayOrder: 0, enabled: true, isManaged: false,
    currentHash: "sha256:x", trustStatus: "trusted",
  });

  test("asks hooks/list for exactly that folder and returns each hook's event, handler, command and file", async () => {
    const h = await harness({
      "hooks/list": (s, m) => s.push({
        id: m.id,
        result: { data: [{ cwd: m.params.cwds[0], hooks: [hook("preToolUse", "/work/main/.codex/hooks.json")], warnings: [], errors: [] }] },
      }),
    });
    const listed = data(await h.sessions().listHooks("/pool/t1"));
    expect(h.requests("hooks/list").map((m) => m.params)).toEqual([{ cwds: ["/pool/t1"] }]);
    expect(listed).toEqual([{
      eventName: "preToolUse", handlerType: "command", command: "'/opt/rt' agent policy-hook",
      sourcePath: "/work/main/.codex/hooks.json", source: "project", enabled: true,
    }]);
  });

  test("an answer naming the folder by its real path is that folder's", async () => {
    const real = realpathSync(mkdtempSync(join(tmpdir(), "rt-hooks-list-")));
    const link = `${real}-link`;
    symlinkSync(real, link);
    try {
      const h = await harness({
        "hooks/list": (s, m) => s.push({ id: m.id, result: { data: [{ cwd: "/elsewhere", hooks: [] }, { cwd: real, hooks: [hook("stop", "/m/.codex/hooks.json")] }] } }),
      });
      expect(data(await h.sessions().listHooks(link)).map((x) => x.eventName)).toEqual(["stop"]);
    } finally {
      rmSync(link, { force: true });
      rmSync(real, { recursive: true, force: true });
    }
  });

  test("an answer for another folder or of another shape is not ready", async () => {
    const answers: unknown[] = [
      { data: [{ cwd: "/elsewhere", hooks: [] }] },
      { data: [{ cwd: "/elsewhere", hooks: [] }, { cwd: "/also-elsewhere", hooks: [] }] },
      { data: "nope" },
      { data: [{ cwd: "/pool/t1", hooks: "nope" }] },
    ];
    for (const result of answers) {
      const h = await harness({ "hooks/list": (s, m) => s.push({ id: m.id, result }) });
      expect(await h.sessions().listHooks("/pool/t1")).toMatchObject({ ok: false, error: { code: "not-ready" } });
    }
  });
});

describe("policy check turn (M6c)", () => {
  function checkRun(log: string[]) {
    return {
      prompt: "check", timeoutMs: 5000,
      issue: (turnId: string) => { log.push(`issue ${turnId}`); },
      settle: async () => { log.push("settle"); },
    };
  }

  test("subscribes, runs one turn, issues its id, settles, then lets the subscription go", async () => {
    const server = subscribingServer({ T1: "idle" });
    const h = await harness({ ...server.handlers, "turn/start": DEFAULTS["turn/start"]! });
    const sessions = h.sessions({ enabled: () => true, lifecycle: async () => false });
    const log: string[] = [];
    expect(data(await sessions.policyCheck(binding("T1"), checkRun(log)))).toEqual({ turnId: "U0", status: "completed" });
    expect(log).toEqual(["issue U0", "settle"]);
    expect(h.ops.filter((op) => op !== "thread/read")).toEqual(["thread/resume", "turn/start", "thread/unsubscribe"]);
    expect(h.requests("turn/start").map((m) => m.params)).toEqual([{ threadId: "T1", input: [{ type: "text", text: "check" }] }]);
    expect(h.clock.active).toBe(0);
  });

  test("a check turn that does not finish in time is interrupted before the hold goes, so the next check is not refused as busy", async () => {
    const server = subscribingServer({ T1: "idle" });
    const h = await harness({
      ...server.handlers,
      "turn/start": (s, m) => {
        s.push({ id: m.id, result: { turn: { id: "U7", items: [], status: "inProgress" } } });
        s.push(turn("turn/started", m.params.threadId, "U7"));
      },
      "turn/interrupt": (s, m) => {
        s.push({ id: m.id, result: {} });
        s.push(turn("turn/completed", m.params.threadId, m.params.turnId, "interrupted"));
      },
    });
    const sessions = h.sessions({ enabled: () => true, lifecycle: async () => false });
    const log: string[] = [];
    const pending = sessions.policyCheck(binding("T1"), checkRun(log));
    await Bun.sleep(1);
    h.clock.advance(5000);
    expect(await pending).toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining("rt asked Codex to interrupt it") } });
    expect(h.requests("turn/interrupt").map((m) => m.params)).toEqual([{ threadId: "T1", turnId: "U7" }]);
    expect(log).toEqual(["issue U7"]);
    expect(sessions.activeTurn(binding("T1"))).toBeUndefined();
    expect(h.ops.at(-1)).toBe("thread/unsubscribe");
    expect(h.clock.active).toBe(0);
  });

  test("a timed-out check whose interrupt Codex refuses says so and is not ready", async () => {
    const server = subscribingServer({ T1: "idle" });
    const h = await harness({
      ...server.handlers,
      "turn/start": (s, m) => {
        s.push({ id: m.id, result: { turn: { id: "U8", items: [], status: "inProgress" } } });
        s.push(turn("turn/started", m.params.threadId, "U8"));
      },
      "turn/interrupt": (s, m) => s.push({ id: m.id, error: { code: -32603, message: "interrupt refused" } }),
    });
    const sessions = h.sessions({ enabled: () => true, lifecycle: async () => false });
    const pending = sessions.policyCheck(binding("T1"), checkRun([]));
    await Bun.sleep(1);
    h.clock.advance(5000);
    const result = await pending;
    expect(result).toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringMatching(/rt could not interrupt it \(.*interrupt refused/) } });
    expect(h.requests("turn/interrupt").map((m) => m.params)).toEqual([{ threadId: "T1", turnId: "U8" }]);
    expect(h.clock.active).toBe(0);
  });

  test("a check rt cannot observe, one beside a running turn, or one with the switch off starts nothing", async () => {
    const log: string[] = [];
    const unreadable = await harness({ "thread/read": (s, m) => s.push({ id: m.id, error: { code: -32600, message: "boom" } }) });
    expect(await unreadable.sessions({ enabled: () => true, lifecycle: async () => false }).policyCheck(binding("T1"), checkRun(log)))
      .toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining("cannot be observed") } });
    expect(unreadable.requests("turn/start")).toEqual([]);

    const server = subscribingServer({ T2: "idle" });
    const busy = await harness(server.handlers);
    const sessions = busy.sessions({ enabled: () => true, lifecycle: async () => false });
    data(await sessions.hold(binding("T2"), "d-work"));
    busy.socket().push(turn("turn/started", "T2", "W1"));
    expect(await sessions.policyCheck(binding("T2"), checkRun(log))).toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining("W1") } });
    expect(busy.requests("turn/start")).toEqual([]);
    sessions.release("T2", "d-work");

    const off = await harness();
    expect(await off.sessions({ enabled: () => false }).policyCheck(binding("T1"), checkRun(log))).toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(off.requests("turn/start")).toEqual([]);
    expect(log).toEqual([]);
    for (const h of [unreadable, busy, off]) expect(h.clock.active).toBe(0);
  });
});
