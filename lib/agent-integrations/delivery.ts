/**
 * Peer delivery with persisted evidence, shared by every harness.
 *
 * A logical delivery is one chat message to one recipient, and its id
 * (`chatDeliveryId`) never changes across retries. A batched frame goes out
 * under its newest constituent's id and records every constituent, so no
 * frame mints an identity of its own.
 *
 * Each attempt is written as pending before the native side effect and then
 * settled with exactly the evidence the harness gave. A failed push (nothing
 * sent) gets one immediate retry under the same id. An ambiguous
 * attempt is reconciled against native evidence before it is sent again, and
 * where the harness has none the redelivery keeps the same id and claims
 * nothing. A consumed delivery is never sent again, and an earlier attempt
 * under another attachment is reconciled under that attachment first.
 *
 * Redelivery itself rides the chat delivery sweep, which rebuilds frames from
 * the room log; `reconcileDeliveries` is the bounded evidence pass the sweep
 * runs each tick, at daemon start and after a harness reconnects. A queued
 * row stays in that pass, checked at doubling intervals, until its evidence
 * turns consumed or it can no longer be attributed to the attachment it went
 * to; it is never sent again from there. A row whose message the recipient's
 * read cursor passed (they read it with rt chat read) is settled superseded,
 * which claims nothing about consumption.
 */

import type { Database } from "bun:sqlite";
import type { Logger } from "pino";
import type {
  DeliveryReceipt, FaultCode, Outcome, PeerInput, SessionBinding,
} from "../../packages/rt-client/src/agent-integrations.ts";
import { getStateDb } from "../state/db.ts";
import { builtinRegistry } from "./builtins.ts";
import type { MessageAdapter } from "./contracts.ts";
import {
  isInterrupted, listDueDeliveries, listReadDeliveries, markHarnessDue, markInterrupted, ONE_SHOT_ROOM, owedByRoomLog, pruneDeliveries, readDelivery,
  readFrame, receiptOfDelivery, recordAttempt, scheduleDelivery, settleAttempt, settleEvidence, supersedeDelivery,
  type DeliveryAttempt, type DeliveryRow,
} from "./delivery-store.ts";
import { createSessionStore, isDetachedAttachment } from "./session-store.ts";

/** The chat delivery sweep's tick, in the daemon's schedule. */
export const DELIVERY_SWEEP_INTERVAL_MS = 30_000;
/** Consecutive failures a recipient tolerates before retries back off. */
export const MAX_CONSECUTIVE_DELIVERY_FAILURES = 5;
/** Backoff saturates here, about an hour of ticks; retries continue at that interval and never stop. */
export const MAX_DELIVERY_BACKOFF_TICKS = 120;
export const DEFAULT_DELIVERY_RETRY_DELAY_MS = 300;
/** Rows one reconciliation pass looks at; the rest wait for the next pass. */
export const RECONCILE_LIMIT = 50;
/** Settled rows are kept this long as evidence, then pruned. */
export const DELIVERY_RETENTION_MS = 7 * 24 * 60 * 60_000;

const SUPERSEDED_BY_READ = "the recipient read it before any evidence showed it arrived";

/** A queued row's next check: twice the interval it last waited, from one sweep tick up to the sweep's backoff cap. */
function queuedRecheckAt(now: number, last?: Pick<DeliveryRow, "nextAttemptAt" | "updatedAt">): number {
  const waited = last?.nextAttemptAt !== undefined ? last.nextAttemptAt - last.updatedAt : 0;
  const ticks = Math.min(Math.max(1, Math.round((2 * waited) / DELIVERY_SWEEP_INTERVAL_MS)), MAX_DELIVERY_BACKOFF_TICKS);
  return now + ticks * DELIVERY_SWEEP_INTERVAL_MS;
}

/** Ticks to skip after `failures` consecutive failures: none below the ceiling, then doubling up to the cap. */
export function deliveryBackoffTicks(failures: number, ceiling: number = MAX_CONSECUTIVE_DELIVERY_FAILURES): number {
  if (failures < ceiling) return 0;
  return Math.min(2 ** (failures - ceiling), MAX_DELIVERY_BACKOFF_TICKS);
}

/** The stable logical id of one chat message delivered to one recipient. */
export function chatDeliveryId(messageId: number, recipient: string): string {
  return `d-${messageId}-${recipient}`;
}

export type DeliveryConstituent = { id: string; room?: string; messageId?: number };
/** Peer input plus the logical deliveries its frame carries; without constituents the frame is its own one delivery. */
export type DeliveryInput = PeerInput & { constituents?: readonly DeliveryConstituent[] };

/** A delivery no room log owes (a welcome, a receipt, an invite): one attempt and its one retry, and nothing redelivers it after. */
export function oneShotInput(input: PeerInput): DeliveryInput {
  return { ...input, constituents: [{ id: input.id, room: ONE_SHOT_ROOM }] };
}

export type DeliveryDeps = {
  db(): Database;
  messagingFor(binding: SessionBinding): Promise<MessageAdapter | undefined>;
  /** The store's binding for a key, attached or not. */
  storedBinding(key: string): SessionBinding | null;
  /** The harness's messaging connection now, without connecting: an id, null while it has none, undefined when it has no connection to wait for. */
  connectionOf(harness: string): string | null | undefined;
  /** Whether the harness says the bound session can take input now, without connecting: false when nothing would run it, undefined when unknown. */
  liveOf(binding: SessionBinding): boolean | undefined;
  now(): number;
  sleep(ms: number): Promise<void>;
  retryDelayMs: number;
  reconcileLimit: number;
  /** Cancels reconciliation passes, including those a reconnect starts, at daemon shutdown. */
  signal?: AbortSignal;
  log?: Pick<Logger, "warn" | "info" | "debug">;
};

export interface DeliveryService {
  deliverPeerInput(binding: SessionBinding, input: DeliveryInput): Promise<Outcome<DeliveryReceipt>>;
  /**
   * One bounded pass over unresolved rows due by `now`. An ambiguous row is
   * reconciled under the attachment it was sent to; one with evidence is
   * settled. Every other row the room log still owes is rescheduled with
   * backoff and left for the sweep to redeliver under its stable id:
   * `retried` counts those, and `ambiguous` the ones among them whose
   * outcome is still unknown. A chat row the recipient's read cursor passed
   * is settled superseded once any evidence it has is recorded; a one-shot
   * row stops being scheduled. A due queued row is only checked for
   * consumption and rescheduled; neither is counted.
   */
  reconcileDeliveries(now: number, opts?: { signal?: AbortSignal }): Promise<{ retried: number; ambiguous: number }>;
  /**
   * Which of `ids` already reached this binding's session: consumed anywhere,
   * or submitted or queued to this attachment. An ambiguous frame among them
   * is reconciled against native evidence first, so a frame is rebuilt only
   * from what is still owed.
   */
  settled(binding: SessionBinding, ids: readonly string[]): Promise<Set<string>>;
  /** Settles once a reconciliation pass a reconnect started has finished. */
  idle(): Promise<void>;
  /** The harness's messaging connection now, read without connecting (see DeliveryDeps.connectionOf). */
  connection(harness: string): string | null | undefined;
  /** Whether the bound session can take input now, read without connecting (see DeliveryDeps.liveOf). */
  live(binding: SessionBinding): boolean | undefined;
  /** Settles superseded every unresolved row whose message `recipient`'s read cursor has passed; returns how many. */
  supersedeRead(recipient: string): number;
}

/** Nothing was sent and a later attempt may succeed. */
const DEFINITE_FAILURES: ReadonlySet<FaultCode> = new Set(["transient", "not-ready"]);
/** A failed push worth the one immediate retry; a recipient with no live transport waits for the sweep, as the inbox path does. */
const RETRY_AT_ONCE: ReadonlySet<FaultCode> = new Set(["transient"]);

const fail = <T>(code: FaultCode, message: string): Outcome<T> => ({ ok: false, error: { code, message } });
const ok = <T>(data: T): Outcome<T> => ({ ok: true, data });
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function defaultDeps(db: () => Database): DeliveryDeps {
  const registry = builtinRegistry();
  return {
    db,
    messagingFor: async (binding) => registry.get(binding.native.harness)?.loadMessaging?.(),
    storedBinding: (key) => createSessionStore(db()).get(key),
    connectionOf: (harness) => registry.get(harness)?.messagingConnection?.(),
    liveOf: (binding) => registry.get(binding.native.harness)?.sessionLive?.(binding),
    now: Date.now,
    sleep: (ms) => Bun.sleep(ms),
    retryDelayMs: DEFAULT_DELIVERY_RETRY_DELAY_MS,
    reconcileLimit: RECONCILE_LIMIT,
  };
}

function sameAttachment(row: DeliveryRow, binding: SessionBinding): boolean {
  return row.sessionKey === binding.key && row.generation === binding.attachment.generation;
}

/** The next reconciliation after `attempts` native attempts: the next tick, then the sweep's backoff. */
function nextAttemptAt(now: number, attempts: number): number {
  return now + Math.max(1, deliveryBackoffTicks(attempts)) * DELIVERY_SWEEP_INTERVAL_MS;
}

export function createDeliveryService(overrides: Partial<DeliveryDeps> = {}): DeliveryService {
  const deps: DeliveryDeps = { ...defaultDeps(overrides.db ?? (() => getStateDb())), ...overrides };
  const connections = new Map<string, string>();
  let reconnectPass: Promise<unknown> | undefined;
  /** Frames this process is sending now; their pending rows are not interrupted. */
  const sending = new Set<string>();

  /** An interrupted attempt is ambiguous from here on; returns the row as it now stands. */
  function settleInterrupted(row: DeliveryRow): DeliveryRow {
    if (!isInterrupted(row) || sending.has(row.frameId)) return row;
    const db = deps.db();
    markInterrupted(db, row, deps.now());
    return readDelivery(db, row.inputId) ?? row;
  }

  async function adapterFor(binding: SessionBinding): Promise<MessageAdapter | undefined> {
    let adapter: MessageAdapter | undefined;
    try {
      adapter = await deps.messagingFor(binding);
    } catch (err) {
      deps.log?.warn({ err, harness: binding.native.harness }, "delivery: messaging failed to load");
      return undefined;
    }
    if (adapter) noteAdapter(binding.native.harness, adapter);
    return adapter;
  }

  /** A harness on a new connection starts with empty native records, so its owed and queued rows are reconciled now. */
  function noteAdapter(harness: string, adapter: MessageAdapter): void {
    if (adapter.connection === undefined) return;
    const seen = connections.get(harness);
    connections.set(harness, adapter.connection);
    if (seen === undefined || seen === adapter.connection) return;
    const now = deps.now();
    if (markHarnessDue(deps.db(), harness, now) === 0 || reconnectPass) return;
    reconnectPass = reconcile(now, deps.signal)
      .catch((err) => deps.log?.warn({ err, harness }, "delivery: reconciliation after a reconnect failed"))
      .finally(() => { reconnectPass = undefined; });
  }

  /** Native evidence for `row`'s frame from the attachment that sent it; null when the harness has none. */
  async function nativeEvidence(row: DeliveryRow): Promise<DeliveryReceipt | null> {
    const stored = deps.storedBinding(row.sessionKey);
    if (!stored) return null;
    const sent: SessionBinding = { ...stored, attachment: { ...stored.attachment, generation: row.generation } };
    const adapter = await adapterFor(sent);
    if (!adapter?.reconcile) return null;
    let found: Outcome<DeliveryReceipt | null>;
    try {
      found = await adapter.reconcile(sent, row.frameId);
    } catch (err) {
      deps.log?.warn({ err, id: row.frameId }, "delivery: reconciling native evidence threw");
      return null;
    }
    if (!found.ok || !found.data || found.data.id !== row.frameId) return null;
    return found.data;
  }

  /** Native evidence for `row`'s frame, recorded on every row of the frame; null when the harness has none. */
  async function evidenceFrom(row: DeliveryRow): Promise<DeliveryReceipt | null> {
    const found = await nativeEvidence(row);
    if (!found) return null;
    const now = deps.now();
    settleEvidence(deps.db(), row, found, now, found.evidence === "queued" ? queuedRecheckAt(now) : null);
    return found;
  }

  /**
   * A queued frame is checked for consumption under the attachment it went
   * to. Once that attachment is gone or replaced, or the row has outlived
   * the retention window, no evidence can be attributed to it any more: it
   * stays queued and is no longer scheduled.
   */
  async function recheckQueued(rows: DeliveryRow[], now: number): Promise<void> {
    const db = deps.db();
    const head = rows.find((row) => row.inputId === row.frameId) ?? rows[0]!;
    const stored = deps.storedBinding(head.sessionKey);
    const attributable = stored !== null && !isDetachedAttachment(stored) && stored.attachment.generation === head.generation
      && now - head.createdAt <= DELIVERY_RETENTION_MS;
    if (attributable) {
      const found = await nativeEvidence(head);
      if (found?.evidence === "consumed") {
        settleEvidence(db, head, found, deps.now());
        return;
      }
    }
    for (const row of rows) scheduleDelivery(db, row, attributable ? queuedRecheckAt(now, row) : null, now);
  }

  /** Rows the recipient's read cursor passed: evidence first for any that may have gone out, then superseded. */
  async function supersedePassed(rows: DeliveryRow[]): Promise<void> {
    const db = deps.db();
    const idle = rows.filter((row) => !sending.has(row.frameId));
    for (const frameId of new Set(idle.filter((row) => row.state === "ambiguous" || isInterrupted(row)).map((row) => row.frameId))) {
      const head = readFrame(db, frameId).find((row) => row.inputId === frameId) ?? idle.find((row) => row.frameId === frameId)!;
      await evidenceFrom(head);
    }
    for (const row of idle) {
      const current = readDelivery(db, row.inputId);
      if (current && (current.state === "pending" || current.state === "ambiguous")) supersedeDelivery(db, current, SUPERSEDED_BY_READ, deps.now());
    }
  }

  async function attempt(adapter: MessageAdapter, binding: SessionBinding, input: DeliveryInput, peer: PeerInput): Promise<Outcome<DeliveryReceipt>> {
    const db = deps.db();
    const record: DeliveryAttempt = {
      frameId: input.id, recipient: input.recipient, sessionKey: binding.key,
      generation: binding.attachment.generation, harness: binding.native.harness,
      constituents: input.constituents?.length ? input.constituents : [{ id: input.id }],
    };
    const startedAt = deps.now();
    const recorded = recordAttempt(db, record, startedAt, startedAt + DELIVERY_SWEEP_INTERVAL_MS);
    if (!recorded.ok) return recorded;
    let out: Outcome<DeliveryReceipt>;
    sending.add(input.id);
    try {
      out = await adapter.submit(binding, peer);
    } catch (err) {
      out = fail("ambiguous", `the ${binding.native.harness} transport threw while sending delivery ${input.id}: ${messageOf(err)}`);
    } finally {
      sending.delete(input.id);
    }
    const now = deps.now();
    const attempts = readDelivery(db, input.id)?.attempts ?? 1;
    if (out.ok) {
      settleAttempt(db, record, out.data.evidence, now, {
        receipt: out.data, ...(out.data.evidence === "queued" && { nextAttemptAt: queuedRecheckAt(now) }),
      });
    } else if (out.error.code === "ambiguous") {
      settleAttempt(db, record, "ambiguous", now, { error: out.error.message, nextAttemptAt: nextAttemptAt(now, attempts) });
    } else if (DEFINITE_FAILURES.has(out.error.code)) {
      settleAttempt(db, record, "pending", now, { error: out.error.message, nextAttemptAt: nextAttemptAt(now, attempts) });
    } else {
      settleAttempt(db, record, "refused", now, { error: out.error.message });
    }
    return out;
  }

  async function deliverPeerInput(binding: SessionBinding, input: DeliveryInput): Promise<Outcome<DeliveryReceipt>> {
    if (input.constituents?.length && !input.constituents.some((c) => c.id === input.id)) {
      return fail("invalid", `frame ${input.id} must go out under one of its constituents' ids`);
    }
    const peer: PeerInput = { id: input.id, sender: input.sender, body: input.body, recipient: input.recipient };
    const stored = readDelivery(deps.db(), input.id);
    const prior = stored ? settleInterrupted(stored) : null;
    if (prior?.state === "consumed") return ok(receiptOfDelivery(prior));
    if (prior && prior.frameId === input.id && (prior.state === "submitted" || prior.state === "queued" || prior.state === "ambiguous")) {
      if (sameAttachment(prior, binding) && prior.state !== "ambiguous") return ok(receiptOfDelivery(prior));
      const earlier = await evidenceFrom(prior);
      if (earlier?.evidence === "consumed") return ok(earlier);
      if (earlier && sameAttachment(prior, binding)) return ok(earlier);
    }

    const adapter = await adapterFor(binding);
    if (!adapter) return fail("unsupported", `${binding.native.harness} has no peer messaging, so delivery ${input.id} was not sent`);
    let out = await attempt(adapter, binding, input, peer);
    if (!out.ok && RETRY_AT_ONCE.has(out.error.code)) {
      await deps.sleep(deps.retryDelayMs);
      out = await attempt(adapter, binding, input, peer);
    }
    return out;
  }

  async function reconcile(now: number, signal?: AbortSignal): Promise<{ retried: number; ambiguous: number }> {
    const db = deps.db();
    let retried = 0;
    let ambiguous = 0;
    if (signal?.aborted) return { retried, ambiguous };
    pruneDeliveries(db, now - DELIVERY_RETENTION_MS, deps.reconcileLimit);
    const frames = new Map<string, DeliveryRow[]>();
    for (const row of listDueDeliveries(db, now, deps.reconcileLimit)) {
      frames.set(row.frameId, [...(frames.get(row.frameId) ?? []), row]);
    }
    for (const [frameId, rows] of frames) {
      if (signal?.aborted) break;
      const queued = rows.filter((row) => row.state === "queued");
      if (queued.length > 0) await recheckQueued(queued, now);
      const open = rows.filter((row) => row.state !== "queued");
      let owed = open.filter((row) => owedByRoomLog(db, row));
      const passed = open.filter((row) => !owed.includes(row));
      for (const row of passed) if (row.room === ONE_SHOT_ROOM) scheduleDelivery(db, row, null, now);
      const read = passed.filter((row) => row.room !== ONE_SHOT_ROOM);
      if (read.length > 0) await supersedePassed(read);
      if (owed.length === 0) continue;
      if (owed.some((row) => isInterrupted(row) && !sending.has(frameId))) {
        markInterrupted(db, owed[0]!, now);
        owed = owed.map((row) => readDelivery(db, row.inputId) ?? row);
      }
      const head = readFrame(db, frameId).find((row) => row.inputId === frameId) ?? owed[0]!;
      if (owed.some((row) => row.state === "ambiguous") && (await evidenceFrom(head))) continue;
      for (const row of owed) {
        scheduleDelivery(db, row, nextAttemptAt(now, row.attempts), now);
        retried++;
        if (row.state === "ambiguous") ambiguous++;
      }
    }
    return { retried, ambiguous };
  }

  return {
    deliverPeerInput,
    reconcileDeliveries: (now, opts = {}) => reconcile(now, opts.signal ?? deps.signal),
    idle: async () => {
      await reconnectPass;
    },
    connection: (harness) => deps.connectionOf(harness),
    live(binding) {
      try {
        return deps.liveOf(binding);
      } catch {
        return undefined;
      }
    },
    supersedeRead(recipient) {
      const db = deps.db();
      let settledCount = 0;
      for (const row of listReadDeliveries(db, recipient)) {
        if (sending.has(row.frameId)) continue;
        if (supersedeDelivery(db, row, SUPERSEDED_BY_READ, deps.now())) settledCount++;
      }
      return settledCount;
    },
    async settled(binding, ids) {
      const db = deps.db();
      const held = new Set<string>();
      const checked = new Set<string>();
      for (const id of ids) {
        const stored = readDelivery(db, id);
        let row = stored ? settleInterrupted(stored) : null;
        if (row?.state === "ambiguous" && !checked.has(row.frameId)) {
          checked.add(row.frameId);
          if (await evidenceFrom(row)) row = readDelivery(db, id);
        }
        if (!row) continue;
        if (row.state === "consumed" || ((row.state === "submitted" || row.state === "queued") && sameAttachment(row, binding))) held.add(id);
      }
      return held;
    },
  };
}
