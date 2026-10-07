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
  private readonly listeners = new Set<(event: CodexEvent) => void>();
  private readonly statusListeners = new Set<(threadId: string, status: CodexThreadStatus) => void>();

  /** A listener that throws stops the rest hearing that event; the connection logs it. */
  constructor(control: CodexControl) {
    control.subscribe((event) => {
      this.apply(event);
      for (const listener of [...this.listeners]) listener(event);
    });
  }

  /** Another consumer on this connection hears each event after the hub applies it, through the hub's one subscription. */
  listen(listener: (event: CodexEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Every status the hub takes for a thread, whether an event announced it or a read of the thread returned it. */
  watchStatus(listener: (threadId: string, status: CodexThreadStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  view(threadId: string): ThreadView | undefined {
    const thread = this.threads.get(threadId);
    return thread && { connectivity: thread.connectivity, execution: thread.execution, source: thread.source };
  }

  /** The turn running now and whether any turn completed, as far as this connection has seen. */
  turns(threadId: string): { active: string | undefined; completed: boolean } {
    const thread = this.threads.get(threadId);
    return {
      active: thread?.activeTurn,
      completed: thread !== undefined && [...thread.completed.values()].includes("completed"),
    };
  }

  /** A status read off the thread itself counts only until the first event about it arrives. */
  seed(threadId: string, status: CodexThreadStatus): void {
    if (this.threads.has(threadId)) return;
    const thread = this.thread(threadId, "codex-thread");
    this.status(thread, status, threadId);
  }

  /** A status the thread itself just answered with, newer than anything heard about it before the reply. */
  refresh(threadId: string, status: CodexThreadStatus): void {
    const thread = this.thread(threadId, "codex-thread");
    thread.source = "codex-thread";
    this.status(thread, status, threadId);
  }

  /**
   * Whether the app server runs the thread now: loaded is live; unloaded or
   * closed is not, since nothing would take input queued to it; undefined
   * when this connection has heard nothing about it.
   */
  live(threadId: string): boolean | undefined {
    const connectivity = this.threads.get(threadId)?.connectivity;
    if (connectivity === "connected") return true;
    if (connectivity === "disconnected") return false;
    return undefined;
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

  private status(thread: Thread, status: CodexThreadStatus, threadId: string): void {
    this.applyStatus(thread, status);
    for (const listener of [...this.statusListeners]) listener(threadId, status);
  }

  private applyStatus(thread: Thread, status: CodexThreadStatus): void {
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
        this.status(thread, event.status, event.threadId);
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
