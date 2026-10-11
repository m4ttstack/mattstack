/**
 * The real Codex session adapter over a fake app server that answers like
 * Codex 0.160, with a recorder in place of Herdr, for tests above the adapter
 * (the shared launcher, the daemon's agent handlers).
 */

import type { Database } from "bun:sqlite";
import type { CapabilityReport, Mode } from "../../../packages/rt-client/src/agent-integrations.ts";
import { connectCodexControl, type CodexControl, type CodexSocket, type CodexSocketHandlers } from "../codex/control.ts";
import { codexIntegration } from "../codex/integration.ts";
import { createCodexSessions, type CodexSessionAdapter, type PaneLaunch } from "../codex/sessions.ts";
import type { HarnessIntegration } from "../contracts.ts";
import { readReservation } from "../session-store.ts";

type Message = Record<string, any>;

/** How one initialization turn ends; `hang` never ends. */
export type FakeTurnEnd = { status: "completed" | "failed" | "interrupted"; error?: string } | "hang";

/** The answers each test needs: one thread, an initialization turn that ends as `end` says. */
function answer(push: (m: Message) => void, m: Message, end: FakeTurnEnd = { status: "completed" }): void {
  switch (m.method) {
    case "initialize":
      push({ id: m.id, result: { codexHome: "/redacted/.codex", platformFamily: "unix", platformOs: "macos", userAgent: "t" } });
      return;
    case "thread/start":
      push({ method: "thread/started", params: { thread: { id: "T1", cwd: m.params.cwd, status: { type: "idle" } } } });
      push({ id: m.id, result: { thread: { id: "T1", cwd: m.params.cwd, status: { type: "idle" } }, cwd: m.params.cwd } });
      return;
    case "turn/start":
      push({ id: m.id, result: { turn: { id: "U0", items: [], status: "inProgress" } } });
      push({ method: "turn/started", params: { threadId: m.params.threadId, turn: { id: "U0", items: [], status: "inProgress" } } });
      if (end === "hang") return;
      push({
        method: "turn/completed",
        params: { threadId: m.params.threadId, turn: { id: "U0", items: [], status: end.status, error: end.error === undefined ? null : { message: end.error } } },
      });
      return;
  }
}

export type FakeCodexOptions = {
  /** How each initialization turn ends, in order; the last repeats. Every one completes by default. */
  initTurns?: FakeTurnEnd[];
  initTurnTimeoutMs?: number;
};

export type FakeCodex = {
  integration: HarnessIntegration;
  /** Every app-server method and every pane, in order. */
  ops: string[];
  panes: PaneLaunch[];
  close(): void;
};

/** `config` is where the fake profile's Codex records folder trust. */
export async function fakeCodex(db: Database, config: string, options: FakeCodexOptions = {}): Promise<FakeCodex> {
  const ops: string[] = [];
  const panes: PaneLaunch[] = [];
  const ends = options.initTurns ?? [];
  let turns = 0;
  const openSocket = (_path: string, h: CodexSocketHandlers): CodexSocket => {
    const push = (m: Message) => h.message(JSON.stringify(m));
    queueMicrotask(() => h.open());
    return {
      send(text) {
        const m = JSON.parse(text) as Message;
        if (m.method !== "initialize" && m.method !== "initialized" && m.method !== undefined) ops.push(m.method);
        answer(push, m, m.method === "turn/start" && ends.length > 0 ? ends[Math.min(turns++, ends.length - 1)] : undefined);
      },
      close() {},
    };
  };
  const control: CodexControl = await connectCodexControl(
    { socketPath: "/run/codex/control.sock", profile: "default" },
    { openSocket, timeoutMs: 1000, log: () => {} },
  );
  const adapter: CodexSessionAdapter = createCodexSessions(control, {
    endpoint: { socketPath: "/run/codex/control.sock" },
    unresolved: new Map(),
    inFlight: new Set(),
    ...(options.initTurnTimeoutMs !== undefined && { initTurnTimeoutMs: options.initTurnTimeoutMs }),
    trustConfig: () => config,
    reservationSettled: (id) => {
      const state = readReservation(db, id)?.state;
      return state === "bound" || state === "abandoned";
    },
    openPane: async (launch) => {
      ops.push("pane");
      panes.push(launch);
      return { ok: true, data: { pane: `w9:p${panes.length}`, tabId: `w9:t${panes.length}`, workspaceId: "w9" } };
    },
    confirmAttached: async () => ({ ok: true, data: undefined }),
    paneRuns: async () => true,
  });
  const integration = {
    ...codexIntegration,
    capabilities: async (mode: Mode): Promise<CapabilityReport> => ({ mode, supported: ["launch", "resume", "observe"], readiness: { ready: true } }),
    loadSessions: async () => adapter,
  } as HarnessIntegration;
  return { integration, ops, panes, close: () => control.close() };
}
