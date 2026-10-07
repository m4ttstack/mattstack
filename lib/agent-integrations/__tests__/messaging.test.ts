import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Outcome, PeerInput, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import { deliverToInbox, wrapCrossSession } from "../../daemon/inbox.ts";
import { builtinRegistry } from "../builtins.ts";
import { claudeTransportId, createClaudeMessaging, type ClaudeMessagingDeps } from "../claude/messaging.ts";
import {
  connectCodexControl, type CodexClock, type CodexControl, type CodexSocket, type CodexSocketHandlers,
} from "../codex/control.ts";
import { createCodexMessaging, type CodexMessagingDeps } from "../codex/messaging.ts";
import { createCodexSessionLoader, createCodexSessions, type CodexSessionAdapter } from "../codex/sessions.ts";

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
}

class FakeSocket implements CodexSocket {
  sent: Message[] = [];
  raw: string[] = [];
  closed = false;
  constructor(readonly handlers: CodexSocketHandlers, private onSend: (socket: FakeSocket, message: Message) => void) {}
  send(text: string): void {
    if (this.closed) throw new Error("socket is closed");
    this.raw.push(text);
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

const ESC = "\u001b";
const THREAD = "T1";
const input = (over: Partial<PeerInput> = {}): PeerInput => ({
  id: "d-17-remy", body: "[#general] max #17: ship it\nreply via rt chat dm max.k3f9", sender: "max (#general)", recipient: "remy.ab12", ...over,
});

/** How Codex 0.160 acknowledged thread/queue/add in the G7 spike (harness-gate-spike-evidence.json #/observations/G7). */
const queuedReply = (m: Message, over: Message = {}) => ({
  id: m.id,
  result: {
    queuedSubmission: {
      id: `Q-${m.params.clientUserMessageId}`, input: m.params.input, clientUserMessageId: m.params.clientUserMessageId, ...over,
    },
  },
});
/** The consumed userMessage, as G7 observed it: the exact clientId plus native thread, turn and item ids. */
const userStarted = (threadId: string, turnId: string, itemId: string, clientId?: string | null) => ({
  method: "item/started",
  params: {
    threadId, turnId, startedAtMs: 1,
    item: { type: "userMessage", id: itemId, ...(clientId !== undefined && { clientId }), content: [{ type: "text", text: "x" }] },
  },
});
const turnEvent = (method: "turn/started" | "turn/completed", threadId: string, id: string) =>
  ({ method, params: { threadId, turn: { id, items: [], status: method === "turn/started" ? "inProgress" : "completed" } } });

const controls: CodexControl[] = [];
afterEach(() => {
  for (const control of controls.splice(0)) control.close();
});

function codexBinding(over: Partial<SessionBinding> = {}, generation = 3): SessionBinding {
  return {
    key: "k1", identity: "remy.ab12", native: { harness: "codex", profile: "default", kind: "id", value: THREAD },
    attachment: { generation, mode: "herdr", pane: "p1" }, ...over,
  };
}

function claudeBinding(over: Partial<SessionBinding> = {}, generation = 2): SessionBinding {
  return {
    key: "c1", identity: "kai.cd34", native: { harness: "claude", profile: "default", kind: "id", value: "6f1c2c1e-3a4b-4c5d-8e9f-0a1b2c3d4e5f" },
    attachment: { generation, mode: "herdr", pane: "p2" }, ...over,
  };
}

async function codex(
  handlers: Record<string, Handler> = {},
  options: { experimental?: boolean; bare?: boolean; persisted?: CodexMessagingDeps["persisted"]; deps?: Partial<CodexMessagingDeps> } = {},
) {
  const clock = new FakeClock();
  let socket!: FakeSocket;
  const server: Record<string, Handler> = { "thread/queue/add": (s, m) => s.push(queuedReply(m)), ...handlers };
  const openSocket = (_path: string, h: CodexSocketHandlers): CodexSocket => {
    socket = new FakeSocket(h, (s, m) => {
      if (m.method === "initialize") {
        s.push({ id: m.id, result: { codexHome: "/redacted/.codex", platformFamily: "unix", platformOs: "macos", userAgent: "t" } });
      } else if (m.method !== undefined && m.method !== "initialized") {
        server[m.method]?.(s, m);
      }
    });
    queueMicrotask(() => h.open());
    return socket;
  };
  const control = await connectCodexControl(
    { socketPath: "/run/codex/control.sock", profile: "default", ...(options.experimental !== undefined && { experimental: options.experimental }) },
    { openSocket, clock, timeoutMs: 1000, log: () => {} },
  );
  controls.push(control);
  let current: SessionBinding | null = codexBinding();
  const messaging = options.bare ? undefined! : createCodexMessaging(control, {
    currentBinding: () => current, persisted: options.persisted ?? (() => null), ...options.deps,
  });
  return {
    clock, control, messaging,
    socket: () => socket,
    methods: () => socket.sent.filter((m) => m.method !== undefined && m.method !== "initialize" && m.method !== "initialized").map((m) => m.method),
    queued: () => socket.sent.filter((m) => m.method === "thread/queue/add"),
    setCurrent: (binding: SessionBinding | null) => { current = binding; },
  };
}

type Frame = { msgV: number; msg_id: string; type: string; message: { role: string; content: string }; priority: string };

/** Claude's real inbox writer against a listening socket, so the frame is the bytes Claude Code would read. */
async function claude(over: Partial<ClaudeMessagingDeps> = {}) {
  const socketPath = join(mkdtempSync(join(tmpdir(), "rt-msg-")), "s.sock");
  const lines: string[] = [];
  const server = Bun.listen({ unix: socketPath, socket: { data(_s, d) { lines.push(d.toString()); } } });
  const delivered: Array<{ socketPath: string; content: string; msgId: string | undefined }> = [];
  let current: SessionBinding | null = claudeBinding();
  const messaging = createClaudeMessaging({
    inbox: () => ({ socketPath }),
    deliver: async (path, content, opts) => {
      delivered.push({ socketPath: path, content, msgId: opts?.msgId });
      return deliverToInbox(path, content, opts);
    },
    currentBinding: () => current,
    ...over,
  });
  const frames = async (): Promise<Frame[]> => {
    await Bun.sleep(30);
    return lines.join("").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Frame);
  };
  return {
    messaging, delivered, frames, socketPath,
    setCurrent: (binding: SessionBinding | null) => { current = binding; },
    stop: () => server.stop(true),
  };
}

function data<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(`${outcome.error.code}: ${outcome.error.message}`);
  return outcome.data;
}

describe("shared message contract", () => {
  test("idle delivery starts input", async () => {
    const c = await claude();
    const claudeReceipt = data(await c.messaging.submit(claudeBinding(), input()));
    const [frame] = await c.frames();
    c.stop();
    expect(claudeReceipt).toEqual({ id: "d-17-remy", evidence: "submitted", nativeId: claudeBinding().native.value });
    expect(frame).toMatchObject({ msgV: 1, type: "user", priority: "next", message: { role: "user" } });

    const x = await codex();
    const codexReceipt = data(await x.messaging.submit(codexBinding(), input()));
    expect(codexReceipt).toEqual({ id: "d-17-remy", evidence: "queued", nativeId: THREAD });
    expect(x.methods()).toEqual(["thread/queue/add"]);
    expect(x.queued()[0]!.params).toMatchObject({ threadId: THREAD, clientUserMessageId: "d-17-remy" });

    x.socket().push(turnEvent("turn/started", THREAD, "U1"));
    x.socket().push(userStarted(THREAD, "U1", "I1", "d-17-remy"));
    expect(data(await x.messaging.reconcile!(codexBinding(), "d-17-remy")))
      .toEqual({ id: "d-17-remy", evidence: "consumed", nativeId: THREAD, turnId: "U1", itemId: "I1" });
  });

  test("busy delivery submits immediately", async () => {
    const c = await claude();
    const claudeReceipt = data(await c.messaging.submit(claudeBinding(), input()));
    expect(c.delivered).toHaveLength(1);
    expect((await c.frames())).toHaveLength(1);
    c.stop();
    expect(claudeReceipt.evidence).toBe("submitted");

    const x = await codex();
    x.socket().push(turnEvent("turn/started", THREAD, "U1"));
    const codexReceipt = data(await x.messaging.submit(codexBinding(), input()));
    expect(codexReceipt.evidence).toBe("queued");
    // Submitted while U1 runs, without waiting for it and without interrupting or steering it.
    expect(x.methods()).toEqual(["thread/queue/add"]);
    x.socket().push(turnEvent("turn/completed", THREAD, "U1"));
    x.socket().push(turnEvent("turn/started", THREAD, "U2"));
    x.socket().push(userStarted(THREAD, "U2", "I7", "d-17-remy"));
    expect(data(await x.messaging.reconcile!(codexBinding(), "d-17-remy"))).toMatchObject({ evidence: "consumed", turnId: "U2", itemId: "I7" });
  });

  test("transport success is not consumption", async () => {
    const c = await claude();
    const claudeReceipt = data(await c.messaging.submit(claudeBinding(), input()));
    c.stop();
    expect(claudeReceipt.evidence).toBe("submitted");
    expect(c.messaging.reconcile).toBeUndefined();

    const x = await codex();
    const codexReceipt = data(await x.messaging.submit(codexBinding(), input()));
    expect(codexReceipt.evidence).not.toBe("consumed");
    x.socket().push({ method: "thread/queue/changed", params: { threadId: THREAD } });
    x.socket().push(turnEvent("turn/started", THREAD, "U1"));
    expect(data(await x.messaging.reconcile!(codexBinding(), "d-17-remy"))!.evidence).toBe("queued");
  });

  test("peer provenance, sender identity and the logical id survive translation", async () => {
    const message = input();
    const envelope = wrapCrossSession(message.sender, message.body, message.id);
    expect(envelope).toContain('from-name="max (#general)"');
    expect(envelope).toContain('delivery-id="d-17-remy"');
    expect(envelope).toContain(message.body);

    const c = await claude();
    await c.messaging.submit(claudeBinding(), message);
    await c.messaging.submit(claudeBinding(), message);
    const frames = await c.frames();
    c.stop();
    expect(frames.map((f) => f.message.content)).toEqual([envelope, envelope]);
    // A retry keeps the transport id, derived from the logical id.
    expect(frames.map((f) => f.msg_id)).toEqual([claudeTransportId(message.id), claudeTransportId(message.id)]);

    const x = await codex();
    await x.messaging.submit(codexBinding(), message);
    expect(x.queued()[0]!.params).toEqual({
      threadId: THREAD, clientUserMessageId: message.id, input: [{ type: "text", text: envelope }],
    });
  });

  test("no ordinary chat delivery sends Escape", async () => {
    const c = await claude();
    await c.messaging.submit(claudeBinding(), input());
    const frames = await c.frames();
    c.stop();
    expect(frames).toHaveLength(1);
    expect(JSON.stringify(frames)).not.toContain(ESC);
    expect(c.delivered.every((d) => !d.content.includes(ESC))).toBe(true);

    const x = await codex();
    x.socket().push(turnEvent("turn/started", THREAD, "U1"));
    await x.messaging.submit(codexBinding(), input());
    expect(x.methods()).toEqual(["thread/queue/add"]);
    expect(x.socket().raw.some((r) => r.includes(ESC) || r.includes("\\u001b"))).toBe(false);
  });
});

describe("claude messaging", () => {
  test("the transport id is the logical id when it is a uuid, else a stable uuid derived from it", () => {
    const uuid = "6F1C2C1E-3A4B-4C5D-8E9F-0A1B2C3D4E5F";
    expect(claudeTransportId(uuid)).toBe(uuid.toLowerCase());
    expect(claudeTransportId("d-17-remy")).toBe(claudeTransportId("d-17-remy"));
    expect(claudeTransportId("d-17-remy")).not.toBe(claudeTransportId("d-18-remy"));
    expect(claudeTransportId("d-17-remy")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test("a session with no live inbox is not ready and nothing is written", async () => {
    const c = await claude({ inbox: () => null });
    const outcome = await c.messaging.submit(claudeBinding(), input());
    c.stop();
    expect(outcome).toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(c.delivered).toHaveLength(0);
  });

  test("a failed write is a definite transient failure, never a receipt", async () => {
    const c = await claude({ deliver: async () => ({ ok: false, error: "timeout" }) });
    const outcome = await c.messaging.submit(claudeBinding(), input());
    c.stop();
    expect(outcome).toMatchObject({ ok: false, error: { code: "transient" } });
  });

  test("a replaced or detached attachment is refused before anything is written", async () => {
    const c = await claude();
    c.setCurrent(claudeBinding({}, 3));
    expect(await c.messaging.submit(claudeBinding(), input())).toMatchObject({ ok: false, error: { code: "stale-binding" } });
    c.setCurrent({ ...claudeBinding(), attachment: { ...claudeBinding().attachment, detached: true } as SessionBinding["attachment"] });
    expect(await c.messaging.submit(claudeBinding(), input())).toMatchObject({ ok: false, error: { code: "stale-binding" } });
    c.setCurrent(null);
    expect(await c.messaging.submit(claudeBinding(), input())).toMatchObject({ ok: false, error: { code: "stale-binding" } });
    c.stop();
    expect(c.delivered).toHaveLength(0);
  });

  test("only a Claude session id takes peer input here", async () => {
    const c = await claude();
    expect(await c.messaging.submit(codexBinding(), input())).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(await c.messaging.submit(claudeBinding(), input({ id: "" }))).toMatchObject({ ok: false, error: { code: "invalid" } });
    c.stop();
    expect(c.delivered).toHaveLength(0);
  });
});

describe("codex messaging evidence", () => {
  const consumed = async (x: Awaited<ReturnType<typeof codex>>, binding = codexBinding()) =>
    data(await x.messaging.reconcile!(binding, "d-17-remy"))?.evidence;

  test("an item/started without a clientId is not consumption", async () => {
    const x = await codex();
    await x.messaging.submit(codexBinding(), input());
    x.socket().push(userStarted(THREAD, "U1", "I1"));
    x.socket().push(userStarted(THREAD, "U1", "I2", null));
    expect(await consumed(x)).toBe("queued");
  });

  test("an item/started with another clientId is not consumption", async () => {
    const x = await codex();
    await x.messaging.submit(codexBinding(), input());
    x.socket().push(userStarted(THREAD, "U1", "I1", "d-18-remy"));
    expect(await consumed(x)).toBe("queued");
  });

  test("the exact clientId on another owned thread is not consumption", async () => {
    const x = await codex();
    x.control.adopt("T2");
    await x.messaging.submit(codexBinding(), input());
    x.socket().push(userStarted("T2", "U1", "I1", "d-17-remy"));
    expect(await consumed(x)).toBe("queued");
  });

  test("an item that is not a user message is not consumption", async () => {
    const x = await codex();
    await x.messaging.submit(codexBinding(), input());
    x.socket().push({
      method: "item/started",
      params: { threadId: THREAD, turnId: "U1", startedAtMs: 1, item: { type: "agentMessage", id: "d-17-remy", text: "d-17-remy", clientId: "d-17-remy" } },
    });
    x.socket().push({ method: "item/completed", params: { threadId: THREAD, turnId: "U1", completedAtMs: 1, item: { type: "userMessage", id: "I1", clientId: "d-17-remy", content: [] } } });
    expect(await consumed(x)).toBe("queued");
  });

  test("a replaced attachment's echo cannot promote the receipt", async () => {
    const x = await codex();
    await x.messaging.submit(codexBinding(), input());
    x.setCurrent(codexBinding({}, 4));
    x.socket().push(userStarted(THREAD, "U1", "I1", "d-17-remy"));
    expect(await consumed(x)).toBe("queued");
    expect(await x.messaging.reconcile!(codexBinding({}, 4), "d-17-remy")).toMatchObject({ ok: false, error: { code: "stale-binding" } });
  });

  test("a detached or rebound session's echo cannot promote the receipt", async () => {
    const x = await codex();
    await x.messaging.submit(codexBinding(), input());
    x.setCurrent({ ...codexBinding(), attachment: { ...codexBinding().attachment, detached: true } as SessionBinding["attachment"] });
    x.socket().push(userStarted(THREAD, "U1", "I1", "d-17-remy"));
    expect(await consumed(x)).toBe("queued");
    x.setCurrent(codexBinding({ native: { ...codexBinding().native, value: "T9" } }));
    x.socket().push(userStarted(THREAD, "U1", "I1", "d-17-remy"));
    expect(await consumed(x)).toBe("queued");
  });

  test("a duplicate item/started keeps the first consumption's identity", async () => {
    const x = await codex();
    await x.messaging.submit(codexBinding(), input());
    x.socket().push(userStarted(THREAD, "U1", "I1", "d-17-remy"));
    x.socket().push(userStarted(THREAD, "U1", "I1", "d-17-remy"));
    x.socket().push(userStarted(THREAD, "U9", "I9", "d-17-remy"));
    expect(data(await x.messaging.reconcile!(codexBinding(), "d-17-remy"))).toMatchObject({ evidence: "consumed", turnId: "U1", itemId: "I1" });
  });

  test("an echo for a delivery this connection never submitted is ignored", async () => {
    const x = await codex();
    x.control.adopt(THREAD);
    x.socket().push(userStarted(THREAD, "U1", "I1", "d-17-remy"));
    expect(data(await x.messaging.reconcile!(codexBinding(), "d-17-remy"))).toBeNull();
    expect(data(await x.messaging.submit(codexBinding(), input())).evidence).toBe("queued");
  });

  test("an echo that arrives before the acknowledgement is consumption", async () => {
    const x = await codex({
      "thread/queue/add": (s, m) => {
        s.push(userStarted(THREAD, "U1", "I1", m.params.clientUserMessageId));
        s.push(queuedReply(m));
      },
    });
    expect(data(await x.messaging.submit(codexBinding(), input()))).toMatchObject({ evidence: "consumed", turnId: "U1", itemId: "I1" });
  });

  test("an unrecognised acknowledgement is ambiguous, never a receipt", async () => {
    for (const reply of [
      (m: Message) => ({ id: m.id, result: {} }),
      (m: Message) => ({ id: m.id, result: { queuedSubmission: { id: "", clientUserMessageId: m.params.clientUserMessageId } } }),
      (m: Message) => queuedReply(m, { clientUserMessageId: "someone-else" }),
      (m: Message) => ({ id: m.id, result: null }),
    ]) {
      const x = await codex({
        "thread/queue/add": (s, m) => s.push(reply(m)),
        "thread/read": (s, m) => s.push({ id: m.id, result: { thread: { id: m.params.threadId, turns: [] } } }),
      });
      expect(await x.messaging.submit(codexBinding(), input())).toMatchObject({ ok: false, error: { code: "ambiguous" } });
      expect(data(await x.messaging.reconcile!(codexBinding(), "d-17-remy"))).toBeNull();
    }
  });

  test("an ambiguous submission is promoted only by its own echo", async () => {
    const x = await codex({ "thread/queue/add": (s, m) => s.push({ id: m.id, result: {} }) });
    await x.messaging.submit(codexBinding(), input());
    x.socket().push(userStarted(THREAD, "U1", "I1", "d-17-remy"));
    expect(await consumed(x)).toBe("consumed");
  });

  test("Codex refusing the queue is a definite failure", async () => {
    const x = await codex({ "thread/queue/add": (s, m) => s.push({ id: m.id, error: { code: -32600, message: "thread busy" } }) });
    expect(await x.messaging.submit(codexBinding(), input())).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(data(await x.messaging.reconcile!(codexBinding(), "d-17-remy"))).toBeNull();
  });

  test("an unanswered queue request is ambiguous", async () => {
    const x = await codex({ "thread/queue/add": () => {} });
    const pending = x.messaging.submit(codexBinding(), input());
    x.clock.advance(1000);
    expect(await pending).toMatchObject({ ok: false, error: { code: "ambiguous" } });
  });

  test("a resubmission under the same attachment returns its queued receipt without queueing again", async () => {
    const x = await codex();
    const first = data(await x.messaging.submit(codexBinding(), input()));
    const retry = data(await x.messaging.submit(codexBinding(), input()));
    expect(retry).toEqual(first);
    expect(x.queued()).toHaveLength(1);
  });

  test("a resubmission after an ambiguous attempt keeps the logical id", async () => {
    let calls = 0;
    const x = await codex({ "thread/queue/add": (s, m) => s.push(++calls === 1 ? { id: m.id, result: {} } : queuedReply(m)) });
    await x.messaging.submit(codexBinding(), input());
    expect(data(await x.messaging.submit(codexBinding(), input())).evidence).toBe("queued");
    expect(x.queued().map((m) => m.params.clientUserMessageId)).toEqual(["d-17-remy", "d-17-remy"]);
  });

  test("a resubmission under a new attachment cannot be promoted by the old attempt's echo", async () => {
    const x = await codex();
    await x.messaging.submit(codexBinding(), input());
    x.setCurrent(codexBinding({}, 4));
    expect(data(await x.messaging.submit(codexBinding({}, 4), input())).evidence).toBe("queued");
    x.socket().push(userStarted(THREAD, "U1", "I1", "d-17-remy"));
    expect(await consumed(x, codexBinding({}, 4))).toBe("queued");
  });

  test("a consumed delivery asked for under a new attachment returns its consumed receipt and is never queued again", async () => {
    const x = await codex();
    await x.messaging.submit(codexBinding(), input());
    x.socket().push(userStarted(THREAD, "U1", "I1", "d-17-remy"));
    x.setCurrent(codexBinding({}, 4));
    expect(data(await x.messaging.submit(codexBinding({}, 4), input()))).toMatchObject({ evidence: "consumed", turnId: "U1", itemId: "I1" });
    expect(x.queued()).toHaveLength(1);
    expect(data(await x.messaging.reconcile!(codexBinding(), "d-17-remy"))).toMatchObject({ evidence: "consumed", turnId: "U1", itemId: "I1" });
  });

  test("the connection names the evidence it holds", async () => {
    const x = await codex();
    expect(x.messaging.connection).toBe(x.control.connection);
  });

  test("a submission from a replaced attachment is refused before anything is sent", async () => {
    const x = await codex();
    x.setCurrent(codexBinding({}, 4));
    expect(await x.messaging.submit(codexBinding(), input())).toMatchObject({ ok: false, error: { code: "stale-binding" } });
    expect(x.methods()).toEqual([]);
  });

  test("a connection without the experimental queue refuses before anything is sent", async () => {
    const x = await codex({}, { experimental: false });
    expect(await x.messaging.submit(codexBinding(), input())).toMatchObject({ ok: false, error: { code: "unsupported" } });
    expect(x.methods()).toEqual([]);
  });

  test("a closed connection sends nothing", async () => {
    const x = await codex();
    x.control.close();
    expect(await x.messaging.submit(codexBinding(), input())).toMatchObject({ ok: false, error: { code: "not-ready" } });
  });

  test("a thread Codex reports unloaded or closed takes nothing, since nothing would run it (live-03 step 7)", async () => {
    for (const gone of [
      { method: "thread/status/changed", params: { threadId: THREAD, status: { type: "notLoaded" } } },
      { method: "thread/closed", params: { threadId: THREAD } },
    ]) {
      const x = await codex();
      x.control.adopt(THREAD);
      x.socket().push(gone);
      expect(await x.messaging.submit(codexBinding(), input())).toMatchObject({ ok: false, error: { code: "not-ready" } });
      expect(x.methods()).toEqual([]);
      x.socket().push({ method: "thread/status/changed", params: { threadId: THREAD, status: { type: "idle" } } });
      expect(data(await x.messaging.submit(codexBinding(), input())).evidence).toBe("queued");
    }
  });

  test("only a thread of this connection's profile takes peer input", async () => {
    const x = await codex();
    const other = codexBinding({ native: { ...codexBinding().native, profile: "work" } });
    expect(await x.messaging.submit(other, input())).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(await x.messaging.submit(claudeBinding(), input())).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(x.methods()).toEqual([]);
  });

  test("messaging and sessions share the connection's one subscription", async () => {
    const fresh = await codex({}, { bare: true });
    let subscriptions = 0;
    const subscribe = fresh.control.subscribe.bind(fresh.control);
    fresh.control.subscribe = (listener) => {
      subscriptions++;
      return subscribe(listener);
    };
    createCodexSessions(fresh.control);
    createCodexMessaging(fresh.control, { currentBinding: () => codexBinding() });
    createCodexMessaging(fresh.control, { currentBinding: () => codexBinding() });
    expect(subscriptions).toBe(1);
  });
});

describe("queued deliveries an earlier connection submitted (M2b review)", () => {
  const ID = "d-17-remy";
  type Persisted = NonNullable<ReturnType<CodexMessagingDeps["persisted"]>>;
  const row = (over: Partial<Persisted> = {}): Persisted => ({
    inputId: ID, frameId: ID, state: "queued", harness: "codex", sessionKey: "k1", generation: 3, nativeId: THREAD, ...over,
  });
  const persisted = (r: Persisted) => (id: string) => (id === r.inputId ? r : null);
  const history = (clientId: string): Handler => (s, m) => s.push({
    id: m.id,
    result: {
      thread: {
        id: m.params.threadId,
        turns: [
          { id: "U0", status: "completed", items: [{ type: "userMessage", id: "I0", clientId: "someone-else", content: [] }] },
          { id: "U1", status: "completed", items: [{ type: "userMessage", id: "I1", clientId, content: [] }, { type: "agentMessage", id: "A1", text: "ok" }] },
        ],
      },
    },
  });

  test("the resubscribed connection's echo of a persisted queued delivery is consumption", async () => {
    const x = await codex({}, { persisted: persisted(row()) });
    x.control.adopt(THREAD);
    x.socket().push(userStarted(THREAD, "U1", "I1", ID));
    expect(data(await x.messaging.reconcile!(codexBinding(), ID))).toEqual({ id: ID, evidence: "consumed", nativeId: THREAD, turnId: "U1", itemId: "I1" });
    expect(x.methods()).toEqual([]);
  });

  test("an echo that landed while rt was away is found by its exact clientId in the thread's history", async () => {
    const x = await codex({ "thread/read": history(ID) }, { persisted: persisted(row()) });
    expect(data(await x.messaging.reconcile!(codexBinding(), ID))).toEqual({ id: ID, evidence: "consumed", nativeId: THREAD, turnId: "U1", itemId: "I1" });
    expect(x.socket().sent.filter((m) => m.method === "thread/read").map((m) => m.params)).toEqual([{ threadId: THREAD, includeTurns: true }]);
    expect(x.methods()).toEqual(["thread/read"]);
  });

  test("another clientId, another thread, or a replaced attachment is never consumption", async () => {
    const other = await codex({ "thread/read": history("d-99-remy") }, { persisted: persisted(row()) });
    other.control.adopt(THREAD);
    other.control.adopt("T2");
    other.socket().push(userStarted(THREAD, "U2", "I2", "d-99-remy"));
    other.socket().push(userStarted("T2", "U3", "I3", ID));
    expect(data(await other.messaging.reconcile!(codexBinding(), ID))).toEqual({ id: ID, evidence: "queued", nativeId: THREAD });

    const replaced = await codex({ "thread/read": history(ID) }, { persisted: persisted(row()) });
    replaced.setCurrent(codexBinding({}, 4));
    replaced.control.adopt(THREAD);
    replaced.socket().push(userStarted(THREAD, "U1", "I1", ID));
    expect(data(await replaced.messaging.reconcile!(codexBinding(), ID))).toEqual({ id: ID, evidence: "queued", nativeId: THREAD });
  });

  test("a row from another generation is stale, and a row that is not this thread's queued delivery seeds nothing", async () => {
    const stale = await codex({ "thread/read": history(ID) }, { persisted: persisted(row({ generation: 2 })) });
    expect(await stale.messaging.reconcile!(codexBinding(), ID)).toMatchObject({ ok: false, error: { code: "stale-binding" } });
    for (const over of [
      { state: "ambiguous" }, { state: "consumed" }, { harness: "claude" }, { nativeId: "T2" }, { frameId: "d-18-remy" }, { sessionKey: "k9" },
    ] as Array<Partial<Persisted>>) {
      const x = await codex({ "thread/read": history(ID) }, { persisted: persisted(row(over)) });
      expect(await x.messaging.reconcile!(codexBinding(), ID)).toEqual({ ok: true, data: null });
      expect(x.methods()).toEqual([]);
    }
  });
});

describe("holding the thread only while a delivery is outstanding (M2b round 2)", () => {
  test("a hold is taken before the queue and released by the echo that confirms the delivery", async () => {
    const calls: string[] = [];
    const x = await codex({}, {
      deps: {
        hold: async (b, id) => { calls.push(`hold ${b.native.value} ${id}`); return { ok: true, data: undefined }; },
        release: (threadId, id) => { calls.push(`release ${threadId} ${id}`); },
      },
    });
    expect(data(await x.messaging.submit(codexBinding(), input())).evidence).toBe("queued");
    expect(calls).toEqual([`hold ${THREAD} d-17-remy`]);
    x.socket().push(userStarted(THREAD, "U1", "I1", "d-17-remy"));
    expect(calls).toEqual([`hold ${THREAD} d-17-remy`, `release ${THREAD} d-17-remy`]);
  });

  test("a hold the session adapter refuses sends nothing", async () => {
    const x = await codex({}, { deps: { hold: async () => ({ ok: false, error: { code: "not-ready", message: "thread T1 is not loaded" } }) } });
    expect(await x.messaging.submit(codexBinding(), input())).toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(x.methods()).toEqual([]);
  });

  test("a refused queue releases its hold", async () => {
    const released: string[] = [];
    const x = await codex({ "thread/queue/add": (s, m) => s.push({ id: m.id, error: { code: -32600, message: "no" } }) }, {
      deps: { release: (_t, id) => { released.push(id); } },
    });
    await x.messaging.submit(codexBinding(), input());
    expect(released).toEqual(["d-17-remy"]);
  });

  test("once a delivery's hold has lapsed, its echo is looked for in the thread's history", async () => {
    let held = true;
    const x = await codex({
      "thread/read": (s, m) => s.push({
        id: m.id,
        result: { thread: { id: m.params.threadId, turns: [{ id: "U4", items: [{ type: "userMessage", id: "I4", clientId: "d-17-remy", content: [] }] }] } },
      }),
    }, { deps: { held: () => held } });
    await x.messaging.submit(codexBinding(), input());
    expect(data(await x.messaging.reconcile!(codexBinding(), "d-17-remy"))).toMatchObject({ evidence: "queued" });
    expect(x.methods()).toEqual(["thread/queue/add"]);
    held = false;
    expect(data(await x.messaging.reconcile!(codexBinding(), "d-17-remy"))).toMatchObject({ evidence: "consumed", turnId: "U4", itemId: "I4" });
  });
});

describe("every ending releases its hold (M2b round 3)", () => {
  const recorder = () => {
    const released: string[] = [];
    return { released, deps: { release: (_t: string, id: string) => { released.push(id); } } };
  };

  test("a binding replaced while its hold was taken releases it and queues nothing", async () => {
    const r = recorder();
    let x!: Awaited<ReturnType<typeof codex>>;
    x = await codex({}, {
      deps: {
        ...r.deps,
        hold: async () => {
          x.setCurrent(codexBinding({}, 4));
          return { ok: true, data: undefined };
        },
      },
    });
    expect(await x.messaging.submit(codexBinding(), input())).toMatchObject({ ok: false, error: { code: "stale-binding" } });
    expect(x.methods()).toEqual([]);
    expect(r.released).toEqual(["d-17-remy"]);
  });

  test("an echo that can no longer count releases the hold without consuming", async () => {
    const r = recorder();
    const x = await codex({}, { deps: r.deps });
    await x.messaging.submit(codexBinding(), input());
    x.setCurrent(codexBinding({}, 4));
    x.socket().push(userStarted(THREAD, "U1", "I1", "d-17-remy"));
    expect(r.released).toEqual(["d-17-remy"]);
    expect(data(await x.messaging.reconcile!(codexBinding(), "d-17-remy"))).toMatchObject({ evidence: "queued" });
  });

  test("a contested submission's echo releases its hold", async () => {
    const r = recorder();
    const x = await codex({}, { deps: r.deps });
    await x.messaging.submit(codexBinding(), input());
    x.setCurrent(codexBinding({}, 4));
    await x.messaging.submit(codexBinding({}, 4), input());
    r.released.length = 0;
    x.socket().push(userStarted(THREAD, "U1", "I1", "d-17-remy"));
    expect(r.released).toEqual(["d-17-remy"]);
  });

  test("an ambiguous add that the thread's history resolves is consumed and releases its hold", async () => {
    const r = recorder();
    const x = await codex({
      "thread/queue/add": (s, m) => s.push({ id: m.id, result: {} }),
      "thread/read": (s, m) => s.push({
        id: m.id,
        result: { thread: { id: m.params.threadId, turns: [{ id: "U5", items: [{ type: "userMessage", id: "I5", clientId: "d-17-remy", content: [] }] }] } },
      }),
    }, { deps: r.deps });
    expect(await x.messaging.submit(codexBinding(), input())).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    expect(data(await x.messaging.reconcile!(codexBinding(), "d-17-remy"))).toMatchObject({ evidence: "consumed", turnId: "U5", itemId: "I5" });
    expect(r.released).toEqual(["d-17-remy"]);
  });

  test("settling a delivery rt stopped waiting on releases its hold", async () => {
    const r = recorder();
    const x = await codex({}, { deps: r.deps });
    await x.messaging.submit(codexBinding(), input());
    x.messaging.settle!(codexBinding(), "d-17-remy");
    expect(r.released).toEqual(["d-17-remy"]);
  });
});

describe("messaging wiring", () => {
  test("both built-ins load messaging and advertise peer delivery only where it works", async () => {
    const registry = builtinRegistry();
    const claudeIntegration = registry.get("claude")!;
    const codexIntegration = registry.get("codex")!;
    expect(typeof claudeIntegration.loadMessaging).toBe("function");
    expect(typeof codexIntegration.loadMessaging).toBe("function");
    expect((await claudeIntegration.capabilities("herdr")).supported).toEqual(["launch", "resume", "observe", "peer-idle", "peer-working"]);
    expect((await claudeIntegration.capabilities("headless")).supported).toEqual(["launch", "resume", "observe"]);
    for (const mode of ["herdr", "headless"] as const) {
      expect((await codexIntegration.capabilities(mode)).supported).toEqual(["launch", "resume", "observe", "peer-idle", "peer-working"]);
    }
  });

  test("the Codex loader's messaging rides the sessions' connection", async () => {
    let connects = 0;
    const x = await codex();
    const loader = createCodexSessionLoader({
      env: {}, now: () => 0,
      discover: async () => ({ ok: true, data: { socketPath: "/run/codex/control.sock" } }),
      connect: async () => {
        connects++;
        return x.control;
      },
      messaging: { currentBinding: () => codexBinding() },
    });
    await loader.load();
    const messaging = await loader.loadMessaging();
    expect(await loader.loadMessaging()).toBe(messaging);
    expect(connects).toBe(1);
    expect(data(await messaging.submit(codexBinding(), input())).evidence).toBe("queued");
  });

  test("the Codex loader's messaging takes threads through the session adapter, which keeps a released thread released", async () => {
    const x = await codex();
    const adopted: string[] = [];
    const adopt = x.control.adopt.bind(x.control);
    x.control.adopt = (threadId) => {
      adopted.push(threadId);
      adopt(threadId);
    };
    let current = codexBinding();
    const loader = createCodexSessionLoader({
      env: {}, now: () => 0,
      discover: async () => ({ ok: true, data: { socketPath: "/run/codex/control.sock" } }),
      connect: async () => x.control,
      messaging: { currentBinding: () => current },
    });
    const sessions = (await loader.load()) as CodexSessionAdapter;
    const messaging = await loader.loadMessaging();

    sessions.disown(codexBinding());
    expect(await messaging.submit(codexBinding(), input())).toMatchObject({ ok: false, error: { code: "stale-binding" } });
    expect(x.queued()).toHaveLength(0);
    expect(adopted).toEqual([]);

    current = codexBinding({}, 4);
    expect(data(await messaging.submit(current, input())).evidence).toBe("queued");
    expect(adopted).toEqual([THREAD]);
  });

  test("the Codex loader's messaging without a connection sends nothing", async () => {
    const loader = createCodexSessionLoader({
      env: {}, now: () => 0,
      discover: async () => ({ ok: false, error: { code: "not-ready", message: "The Codex app server is not running." } }),
      connect: async () => {
        throw new Error("never connects");
      },
    });
    const messaging = await loader.loadMessaging();
    expect(await messaging.submit(codexBinding(), input())).toMatchObject({ ok: false, error: { code: "not-ready" } });
  });
});
