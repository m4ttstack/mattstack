/**
 * The one subscription to a Codex control connection, and what its owned
 * threads' native events say about each thread.
 *
 * The connection hands events that arrived before anyone subscribed to the
 * first subscriber only, so every consumer on a connection shares this hub
 * rather than subscribing itself.
 *
 * Execution moves only on native thread status and turn evidence. An item,
 * however final it reads (an agent message saying DONE, an async question
 * form), never ends or blocks a turn: a Stop hook can still continue that
 * turn, and an async form is emitted, not answered.
 */

import type { Observation } from "../../../packages/rt-client/src/agent-integrations.ts";
import type { CodexClock, CodexControl } from "./control.ts";
import type { CODEX_STATUS_ENUMS, CodexEvent, CodexRequestId, CodexThreadStatus } from "./protocol.ts";

export type TurnStatus = (typeof CODEX_STATUS_ENUMS)["turn"][number];
export type ThreadView = {
  connectivity: Observation["connectivity"];
  execution: Observation["execution"];
  source: "codex-events" | "codex-thread";
};

type Thread = ThreadView & {
  activeTurn: string | undefined;
  completed: Map<string, TurnStatus>;
  pending: Set<string>;
};

/** Enough to recognise a replayed turn; older turns no longer matter to execution. */
const COMPLETED_TURNS_KEPT = 64;

const requestKey = (id: CodexRequestId): string => `${typeof id}:${id}`;

export class CodexEventHub {
  private readonly threads = new Map<string, Thread>();
  private readonly waiters = new Set<{ threadId: string; turnId: string; settle(status: TurnStatus): void }>();

  constructor(control: CodexControl) {
    control.subscribe((event) => this.apply(event));
  }

  view(threadId: string): ThreadView | undefined {
    const thread = this.threads.get(threadId);
    return thread && { connectivity: thread.connectivity, execution: thread.execution, source: thread.source };
  }

  /** A status read off the thread itself counts only until the first event about it arrives. */
  seed(threadId: string, status: CodexThreadStatus): void {
    if (this.threads.has(threadId)) return;
    const thread = this.thread(threadId, "codex-thread");
    this.status(thread, status);
  }

  /** Resolves with the turn's native end, or undefined when `ms` passes first. */
  waitTurn(threadId: string, turnId: string, clock: CodexClock, ms: number): Promise<TurnStatus | undefined> {
    const done = this.threads.get(threadId)?.completed.get(turnId);
    if (done) return Promise.resolve(done);
    return new Promise((resolve) => {
      const waiter = {
        threadId, turnId,
        settle: (status: TurnStatus | undefined) => {
          this.waiters.delete(waiter);
          clock.clearTimeout(timer);
          resolve(status);
        },
      };
      const timer = clock.setTimeout(() => waiter.settle(undefined), ms);
      this.waiters.add(waiter);
    });
  }

  private thread(threadId: string, source: ThreadView["source"] = "codex-events"): Thread {
    let thread = this.threads.get(threadId);
    if (!thread) {
      thread = {
        connectivity: "unknown", execution: "unknown", source,
        activeTurn: undefined, completed: new Map(), pending: new Set(),
      };
      this.threads.set(threadId, thread);
    }
    return thread;
  }

  private status(thread: Thread, status: CodexThreadStatus): void {
    switch (status.type) {
      case "idle":
        thread.connectivity = "connected";
        thread.execution = "idle";
        thread.activeTurn = undefined;
        thread.pending.clear();
        return;
      case "active":
        thread.connectivity = "connected";
        thread.execution = status.activeFlags.length > 0 || thread.pending.size > 0 ? "blocked" : "working";
        return;
      case "systemError":
        thread.connectivity = "connected";
        thread.execution = "unknown";
        return;
      case "notLoaded":
        this.unloaded(thread);
    }
  }

  private unloaded(thread: Thread): void {
    thread.connectivity = "disconnected";
    thread.execution = "unknown";
    thread.activeTurn = undefined;
    thread.pending.clear();
  }

  private apply(event: CodexEvent): void {
    const thread = this.thread(event.threadId);
    thread.source = "codex-events";
    switch (event.method) {
      case "thread/started":
      case "thread/status/changed":
        this.status(thread, event.status);
        return;
      case "thread/closed":
        this.unloaded(thread);
        return;
      case "turn/started":
        if (thread.completed.has(event.turnId)) return;
        thread.connectivity = "connected";
        thread.activeTurn = event.turnId;
        thread.execution = thread.pending.size > 0 ? "blocked" : "working";
        return;
      case "turn/completed":
        this.complete(thread, event.threadId, event.turnId, event.status);
        return;
      case "item/tool/requestUserInput":
        thread.pending.add(requestKey(event.handle.requestId));
        thread.execution = "blocked";
        return;
      case "serverRequest/resolved":
        if (!thread.pending.delete(requestKey(event.requestId)) || thread.pending.size > 0) return;
        if (thread.execution === "blocked") thread.execution = thread.activeTurn ? "working" : "unknown";
        return;
    }
  }

  private complete(thread: Thread, threadId: string, turnId: string, status: TurnStatus): void {
    thread.completed.set(turnId, status);
    if (thread.completed.size > COMPLETED_TURNS_KEPT) thread.completed.delete(thread.completed.keys().next().value!);
    thread.connectivity = "connected";
    if (thread.activeTurn === undefined || thread.activeTurn === turnId) {
      thread.activeTurn = undefined;
      thread.pending.clear();
      thread.execution = "idle";
    }
    for (const waiter of [...this.waiters]) if (waiter.threadId === threadId && waiter.turnId === turnId) waiter.settle(status);
  }
}

const hubs = new WeakMap<CodexControl, CodexEventHub>();

export function codexEventHub(control: CodexControl): CodexEventHub {
  let hub = hubs.get(control);
  if (!hub) {
    hub = new CodexEventHub(control);
    hubs.set(control, hub);
  }
  return hub;
}
