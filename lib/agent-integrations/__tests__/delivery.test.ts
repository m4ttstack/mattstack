import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { tmpdir } from "os";
import { join } from "path";
import type { Logger } from "pino";
import type { DeliveryReceipt, Outcome, PeerInput, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import type { ChatPostDelivery } from "../../../packages/rt-client/src/commands.ts";
import { createChatDeliverySweep, createChatHandlers, type InboxDeps } from "../../daemon/handlers/chat.ts";
import { backgroundUnit } from "../../daemon/lifecycle.ts";
import type { herdrRequest } from "../../herdr/client.ts";
import { setSetting } from "../../settings/write.ts";
import { listMessages, openStateDb, signIn, type RegistryDeps } from "../../state/index.ts";
import type { MessageAdapter } from "../contracts.ts";
import {
  chatDeliveryId, createDeliveryService, DELIVERY_SWEEP_INTERVAL_MS, deliveryBackoffTicks, MAX_DELIVERY_BACKOFF_TICKS, oneShotInput,
  type DeliveryDeps, type DeliveryInput,
} from "../delivery.ts";
import { readDelivery, recordAttempt, settleEvidence, supersedeDelivery, type DeliveryRow } from "../delivery-store.ts";
import { createSessionStore } from "../session-store.ts";

let n = 0;
const dbPath = () => join(tmpdir(), `delivery-${process.pid}-${n++}.db`);
const T0 = 1_700_000_000_000;

const ok = <T>(data: T): Outcome<T> => ({ ok: true, data });
const fault = <T>(code: "ambiguous" | "transient" | "not-ready" | "refused", message: string = code): Outcome<T> => ({ ok: false, error: { code, message } });

type Submit = (input: PeerInput, call: number, binding: SessionBinding) => Outcome<DeliveryReceipt> | Promise<Outcome<DeliveryReceipt>>;
type Reconcile = (binding: SessionBinding, id: string) => Outcome<DeliveryReceipt | null>;

/** A harness that answers from a script and records every native call. */
function fakeMessaging(opts: { submit?: Submit; reconcile?: Reconcile; connection?: string } = {}) {
  const submits: Array<{ input: PeerInput; generation: number; key: string }> = [];
  const reconciles: Array<{ id: string; generation: number; key: string }> = [];
  const settles: Array<{ id: string; generation: number; key: string }> = [];
  const submit: Submit = opts.submit ?? ((input) => ok({ id: input.id, evidence: "submitted" }));
  const adapter: MessageAdapter = {
    ...(opts.connection !== undefined && { connection: opts.connection }),
    settle(binding, id) {
      settles.push({ id, generation: binding.attachment.generation, key: binding.key });
    },
    async submit(binding, input) {
      submits.push({ input, generation: binding.attachment.generation, key: binding.key });
      return submit(input, submits.length, binding);
    },
    ...(opts.reconcile && {
      async reconcile(binding: SessionBinding, id: string) {
        reconciles.push({ id, generation: binding.attachment.generation, key: binding.key });
        return opts.reconcile!(binding, id);
      },
    }),
  };
  return { adapter, submits, reconciles, settles };
}

function bindSession(db: Database, value: string, harness = "codex", mode: "herdr" | "headless" = "herdr"): SessionBinding {
  const store = createSessionStore(db);
  const reservation = store.reserve({ identity: `id-${value}` });
  const bound = store.bind(reservation, { harness, profile: "default", kind: "id", value }, mode === "herdr" ? { mode, pane: "p1" } : { mode });
  if (!bound.ok) throw new Error(bound.error.message);
  return bound.data;
}

function reattach(db: Database, binding: SessionBinding): SessionBinding {
  const moved = createSessionStore(db).replaceAttachment(binding.key, binding.attachment.generation, { mode: "herdr", pane: "p2" });
  if (!moved.ok) throw new Error(moved.error.message);
  return moved.data;
}

function harness(db: Database, messaging: { adapter: MessageAdapter }, over: Partial<DeliveryDeps> = {}) {
  const clock = { now: T0 };
  const sleeps: number[] = [];
  const service = createDeliveryService({
    db: () => db,
    messagingFor: async () => messaging.adapter,
    connectionOf: () => "conn-test",
    now: () => clock.now,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.now += ms;
    },
    ...over,
  });
  return { service, clock, sleeps };
}

const peer = (id: string, over: Partial<DeliveryInput> = {}): DeliveryInput => ({
  id, sender: "max (#general)", body: "[#general] max #17: ship it", recipient: "remy", ...over,
});

const row = (db: Database, id: string): DeliveryRow => {
  const found = readDelivery(db, id);
  if (!found) throw new Error(`no delivery row ${id}`);
  return found;
};

describe("delivery evidence", () => {
  test("disconnect after submission remains ambiguous", async () => {
    const db = openStateDb(dbPath());
    const binding = bindSession(db, "T1");
    const messaging = fakeMessaging({
      submit: () => fault("ambiguous", "the connection closed before Codex acknowledged the queue"),
      reconcile: () => ok(null),
    });
    const { service, clock, sleeps } = harness(db, messaging);
    const id = chatDeliveryId(17, "remy");

    const first = await service.deliverPeerInput(binding, peer(id));
    expect(first).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    expect(messaging.submits).toHaveLength(1);
    expect(sleeps).toEqual([]);
    expect(row(db, id).state).toBe("ambiguous");
    expect(await service.settled(binding, [id])).toEqual(new Set());

    clock.now += DELIVERY_SWEEP_INTERVAL_MS;
    expect(await service.reconcileDeliveries(clock.now)).toEqual({ retried: 1, ambiguous: 1 });
    expect(messaging.reconciles.map((r) => r.generation)).toContain(binding.attachment.generation);
    expect(messaging.submits).toHaveLength(1);
    expect(row(db, id).state).toBe("ambiguous");

    const retry = await service.deliverPeerInput(binding, peer(id));
    expect(retry.ok).toBe(false);
    expect(messaging.submits.map((s) => s.input.id)).toEqual([id, id]);
    expect(row(db, id).state).not.toBe("consumed");
  });

  test("an ambiguous delivery is settled by native evidence before it is sent again", async () => {
    const db = openStateDb(dbPath());
    const binding = bindSession(db, "T1");
    let queued = false;
    const messaging = fakeMessaging({
      submit: () => fault("ambiguous"),
      reconcile: (_b, id) => ok(queued ? { id, evidence: "queued", nativeId: "T1" } : null),
    });
    const { service } = harness(db, messaging);
    const id = chatDeliveryId(17, "remy");
    await service.deliverPeerInput(binding, peer(id));
    queued = true;
    expect(await service.deliverPeerInput(binding, peer(id))).toEqual(ok({ id, evidence: "queued", nativeId: "T1" }));
    expect(messaging.submits).toHaveLength(1);
    expect(row(db, id).state).toBe("queued");
  });

  test("definite failure retries same ID", async () => {
    const db = openStateDb(dbPath());
    const binding = bindSession(db, "T1");
    const messaging = fakeMessaging({
      submit: (input, call) => (call === 1 ? fault("transient", "the inbox socket refused the connection") : ok({ id: input.id, evidence: "submitted" })),
    });
    const { service, sleeps } = harness(db, messaging);
    const id = chatDeliveryId(17, "remy");

    const result = await service.deliverPeerInput(binding, peer(id));
    const [first, retry] = messaging.submits.map((s) => s.input);
    expect(retry!.id).toBe(first!.id);
    expect(sleeps).toEqual([300]);
    expect(result).toEqual(ok({ id, evidence: "submitted" }));
    expect(row(db, id)).toMatchObject({ state: "submitted", attempts: 2 });
  });

  test("a definite failure that persists stays owed under the same id with no native claim", async () => {
    const db = openStateDb(dbPath());
    const binding = bindSession(db, "T1");
    const messaging = fakeMessaging({ submit: () => fault("transient") });
    const { service, clock } = harness(db, messaging);
    const id = chatDeliveryId(17, "remy");
    expect(await service.deliverPeerInput(binding, peer(id))).toMatchObject({ ok: false, error: { code: "transient" } });
    expect(messaging.submits).toHaveLength(2);
    expect(row(db, id)).toMatchObject({ state: "pending", attempts: 2, nextAttemptAt: clock.now + DELIVERY_SWEEP_INTERVAL_MS });
    expect(await service.reconcileDeliveries(clock.now)).toEqual({ retried: 0, ambiguous: 0 });
    expect(await service.reconcileDeliveries(clock.now + DELIVERY_SWEEP_INTERVAL_MS)).toEqual({ retried: 1, ambiguous: 0 });
  });

  test("a recipient with no live transport is left for the sweep, not retried at once", async () => {
    const db = openStateDb(dbPath());
    const binding = bindSession(db, "T1");
    const messaging = fakeMessaging({ submit: () => fault("not-ready") });
    const { service, sleeps, clock } = harness(db, messaging);
    const id = chatDeliveryId(17, "remy");
    await service.deliverPeerInput(binding, peer(id));
    expect(messaging.submits).toHaveLength(1);
    expect(sleeps).toEqual([]);
    expect(row(db, id)).toMatchObject({ state: "pending", nextAttemptAt: clock.now + DELIVERY_SWEEP_INTERVAL_MS });
  });

  test("a refusal is recorded and not retried at once", async () => {
    const db = openStateDb(dbPath());
    const binding = bindSession(db, "T1");
    const messaging = fakeMessaging({ submit: () => fault("refused", "thread busy") });
    const { service, sleeps } = harness(db, messaging);
    const id = chatDeliveryId(17, "remy");
    await service.deliverPeerInput(binding, peer(id));
    expect(messaging.submits).toHaveLength(1);
    expect(sleeps).toEqual([]);
    expect(row(db, id)).toMatchObject({ state: "refused", error: "thread busy" });
  });

  test("rt restart retains pending delivery without claiming native queue survival", async () => {
    const path = dbPath();
    let db = openStateDb(path);
    const binding = bindSession(db, "T1");
    const before = fakeMessaging({
      connection: "conn-1",
      submit: (input) => {
        if (input.id.startsWith("d-1-")) return fault("transient");
        if (input.id.startsWith("d-2-")) return fault("ambiguous");
        // The process dies while this frame is on the wire: the attempt is recorded and never settled.
        if (input.id.startsWith("d-4-")) return new Promise<Outcome<DeliveryReceipt>>(() => {});
        return ok({ id: input.id, evidence: "queued", nativeId: "T1" });
      },
      reconcile: (_b, id) => ok(id.startsWith("d-3-") ? { id, evidence: "queued", nativeId: "T1" } : null),
    });
    const first = harness(db, before);
    const [pending, ambiguous, queued, crashed] = [1, 2, 3, 4].map((m) => chatDeliveryId(m, "remy")) as [string, string, string, string];
    await first.service.deliverPeerInput(binding, peer(pending));
    await first.service.deliverPeerInput(binding, peer(ambiguous));
    await first.service.deliverPeerInput(binding, peer(queued));
    void first.service.deliverPeerInput(binding, peer(crashed));
    await waitFor(() => before.submits.some((s) => s.input.id === crashed));
    expect(row(db, crashed)).toMatchObject({ state: "pending", attempts: 1, nextAttemptAt: first.clock.now + DELIVERY_SWEEP_INTERVAL_MS });
    db.close();

    db = openStateDb(path);
    const after = fakeMessaging({
      connection: "conn-2",
      submit: (input) => ok({ id: input.id, evidence: "queued", nativeId: "T1" }),
      reconcile: () => ok(null),
    });
    const second = harness(db, after);
    second.clock.now = first.clock.now + DELIVERY_SWEEP_INTERVAL_MS;
    expect(await second.service.reconcileDeliveries(second.clock.now)).toEqual({ retried: 3, ambiguous: 2 });
    expect(row(db, pending).state).toBe("pending");
    expect(row(db, ambiguous).state).toBe("ambiguous");
    expect(row(db, queued).state).toBe("queued");
    expect(row(db, crashed)).toMatchObject({ state: "ambiguous", error: "the attempt was interrupted before its outcome was recorded" });
    expect(after.reconciles.map((r) => r.id)).toContain(crashed);
    expect(after.submits).toEqual([]);

    const resent = await second.service.deliverPeerInput(binding, peer(crashed));
    expect(resent).toEqual(ok({ id: crashed, evidence: "queued", nativeId: "T1" }));
    expect(after.reconciles.filter((r) => r.id === crashed)).toHaveLength(2);
    expect(after.submits.map((s) => s.input.id)).toEqual([crashed]);
    after.submits.length = 0;

    expect(await second.service.deliverPeerInput(binding, peer(queued))).toEqual(ok({ id: queued, evidence: "queued", nativeId: "T1" }));
    expect(after.submits).toEqual([]);
    const redelivered = await second.service.deliverPeerInput(binding, peer(ambiguous));
    expect(after.reconciles.map((r) => r.id)).toContain(ambiguous);
    expect(after.submits.map((s) => s.input.id)).toEqual([ambiguous]);
    expect(redelivered).toEqual(ok({ id: ambiguous, evidence: "queued", nativeId: "T1" }));
    expect(row(db, ambiguous).state).toBe("queued");
  });

  test("an attempt interrupted mid-submit is reconciled before it is sent again, and its evidence stops the resend", async () => {
    const db = openStateDb(dbPath());
    const binding = bindSession(db, "T1");
    const id = chatDeliveryId(17, "remy");
    const recorded = recordAttempt(db, {
      frameId: id, recipient: "remy", sessionKey: binding.key, generation: binding.attachment.generation, harness: "codex",
      constituents: [{ id }],
    }, T0 - 60_000, T0 - 30_000);
    expect(recorded.ok).toBe(true);
    const order: string[] = [];
    const messaging = fakeMessaging({
      submit: (input) => {
        order.push("submit");
        return ok({ id: input.id, evidence: "queued", nativeId: "T1" });
      },
      reconcile: (_b, rid) => {
        order.push("reconcile");
        return ok({ id: rid, evidence: "consumed", nativeId: "T1", turnId: "U1", itemId: "I1" });
      },
    });
    const { service } = harness(db, messaging);
    expect(await service.deliverPeerInput(binding, peer(id))).toEqual(ok({ id, evidence: "consumed", nativeId: "T1", turnId: "U1", itemId: "I1" }));
    expect(order).toEqual(["reconcile"]);
    expect(row(db, id).state).toBe("consumed");
  });

  test("a batched frame goes out under its newest constituent's id and records every constituent", async () => {
    const db = openStateDb(dbPath());
    const binding = bindSession(db, "T1");
    const messaging = fakeMessaging({ submit: () => fault("ambiguous"), reconcile: () => ok(null) });
    const { service } = harness(db, messaging);
    const ids = [5, 6].map((m) => chatDeliveryId(m, "remy"));
    await service.deliverPeerInput(binding, peer(ids[1]!, {
      constituents: [{ id: ids[0]!, room: "general", messageId: 5 }, { id: ids[1]!, room: "general", messageId: 6 }],
    }));
    expect(messaging.submits.map((s) => s.input.id)).toEqual([ids[1]!]);
    expect(ids.map((id) => row(db, id))).toMatchObject([
      { state: "ambiguous", frameId: ids[1], messageId: 5 },
      { state: "ambiguous", frameId: ids[1], messageId: 6 },
    ]);
    const later = chatDeliveryId(7, "remy");
    await service.deliverPeerInput(binding, peer(later, {
      constituents: [...ids.map((id, i) => ({ id, room: "general", messageId: 5 + i })), { id: later, room: "general", messageId: 7 }],
    }));
    expect(messaging.submits.map((s) => s.input.id)).toEqual([ids[1]!, later]);
    expect(row(db, ids[0]!)).toMatchObject({ frameId: later, attempts: 2 });
    expect(await service.deliverPeerInput(binding, peer("x", { constituents: [{ id: ids[0]! }] }))).toMatchObject({ ok: false, error: { code: "invalid" } });
  });
});

describe("a settled row is never written back (live-05 D6)", () => {
  test("an attempt naming a superseded or consumed constituent is refused unwritten: its frame would carry what the recipient already has", async () => {
    const db = openStateDb(dbPath());
    const binding = bindSession(db, "T1");
    const messaging = fakeMessaging({ submit: () => fault("ambiguous"), reconcile: () => ok(null) });
    const { service, clock } = harness(db, messaging);
    const [a, b, c] = [5, 6, 7].map((m) => chatDeliveryId(m, "remy"));
    const constituents = (ids: string[]) => ids.map((id) => ({ id, room: "general", messageId: Number(id.split("-")[1]) }));
    await service.deliverPeerInput(binding, peer(b!, { constituents: constituents([a!, b!]) }));
    expect(supersedeDelivery(db, row(db, a!), "the recipient read it", clock.now)).toBe(true);
    const before = [a!, b!].map((id) => row(db, id));

    const attempt = { frameId: b!, recipient: "remy", sessionKey: binding.key, generation: binding.attachment.generation, harness: "codex", constituents: constituents([a!, b!]) };
    expect(recordAttempt(db, attempt, clock.now + 1, clock.now + 2)).toMatchObject({ ok: false, error: { code: "stale-frame" } });
    expect([a!, b!].map((id) => row(db, id))).toEqual(before);
    expect(await service.deliverPeerInput(binding, peer(b!, { constituents: constituents([a!, b!]) }))).toMatchObject({ ok: false, error: { code: "stale-frame" } });
    expect(messaging.submits).toHaveLength(1);
    expect([a!, b!].map((id) => row(db, id))).toEqual(before);

    settleEvidence(db, attempt, { id: b!, evidence: "consumed", nativeId: "T1", turnId: "U1", itemId: "I1" }, clock.now + 3);
    expect(row(db, b!).state).toBe("consumed");
    expect(await service.deliverPeerInput(binding, peer(c!, { constituents: constituents([b!, c!]) }))).toMatchObject({ ok: false, error: { code: "stale-frame" } });
    expect(messaging.submits).toHaveLength(1);
    expect(readDelivery(db, c!)).toBeNull();
    expect(row(db, b!)).toMatchObject({ state: "consumed", attempts: 1 });
  });
});

describe("settled evidence never weakens", () => {
  test("a submitted report for a queued row leaves it queued", async () => {
    const db = openStateDb(dbPath());
    const binding = bindSession(db, "T1");
    const messaging = fakeMessaging({ submit: () => fault("ambiguous"), reconcile: () => ok(null) });
    const { service, clock } = harness(db, messaging);
    const id = chatDeliveryId(5, "remy");
    await service.deliverPeerInput(binding, peer(id, { constituents: [{ id, room: "general", messageId: 5 }] }));
    const attempt = { frameId: id, sessionKey: binding.key, generation: binding.attachment.generation };

    settleEvidence(db, attempt, { id, evidence: "queued", nativeId: "T1" }, clock.now + 1, clock.now + 60_000);
    expect(row(db, id).state).toBe("queued");
    settleEvidence(db, attempt, { id, evidence: "submitted", nativeId: "T1", turnId: "U9" }, clock.now + 2);
    expect(row(db, id)).toMatchObject({ state: "queued", updatedAt: clock.now + 1 });
    settleEvidence(db, attempt, { id, evidence: "consumed", nativeId: "T1" }, clock.now + 3);
    expect(row(db, id).state).toBe("consumed");
  });
});

describe("one-shot deliveries", () => {
  test("a welcome, receipt or invite that fails gets its one retry and is never scheduled again, since no room log owes it", async () => {
    const db = openStateDb(dbPath());
    const binding = bindSession(db, "T1");
    const messaging = fakeMessaging({ submit: () => fault("transient") });
    const { service, clock, sleeps } = harness(db, messaging);
    const sent = await service.deliverPeerInput(binding, oneShotInput({ id: "w-remy-1", sender: "rt chat", body: "welcome", recipient: "remy" }));
    expect(sent.ok).toBe(false);
    expect(messaging.submits).toHaveLength(2);
    expect(sleeps).toEqual([300]);
    expect(row(db, "w-remy-1")).toMatchObject({ state: "pending", room: "#once" });

    clock.now += DELIVERY_SWEEP_INTERVAL_MS;
    expect(await service.reconcileDeliveries(clock.now)).toEqual({ retried: 0, ambiguous: 0 });
    expect(row(db, "w-remy-1")).toMatchObject({ state: "pending" });
    expect(row(db, "w-remy-1").nextAttemptAt).toBeUndefined();
    clock.now += 10 * DELIVERY_SWEEP_INTERVAL_MS;
    expect(await service.reconcileDeliveries(clock.now)).toEqual({ retried: 0, ambiguous: 0 });
    expect(messaging.submits).toHaveLength(2);
  });
});

describe("attachments and connections", () => {
  test("an earlier attempt under an older generation is reconciled there first, and a consumed one is never resent", async () => {
    const db = openStateDb(dbPath());
    const old = bindSession(db, "T1");
    const messaging = fakeMessaging({
      submit: () => fault("ambiguous"),
      reconcile: (b, id) => ok(b.attachment.generation === old.attachment.generation ? { id, evidence: "consumed", nativeId: "T1", turnId: "U1", itemId: "I1" } : null),
    });
    const { service } = harness(db, messaging);
    const id = chatDeliveryId(17, "remy");
    await service.deliverPeerInput(old, peer(id));
    const current = reattach(db, old);

    const result = await service.deliverPeerInput(current, peer(id));
    expect(result).toEqual(ok({ id, evidence: "consumed", nativeId: "T1", turnId: "U1", itemId: "I1" }));
    expect(messaging.reconciles[0]).toEqual({ id, generation: old.attachment.generation, key: old.key });
    expect(messaging.submits).toHaveLength(1);
    expect(row(db, id)).toMatchObject({ state: "consumed", generation: old.attachment.generation });

    expect(await service.deliverPeerInput(current, peer(id))).toEqual(ok({ id, evidence: "consumed", nativeId: "T1", turnId: "U1", itemId: "I1" }));
    expect(messaging.submits).toHaveLength(1);
    expect(await service.settled(current, [id])).toEqual(new Set([id]));
  });

  test("a queued attempt under an older generation is sent again to the current attachment", async () => {
    const db = openStateDb(dbPath());
    const old = bindSession(db, "T1");
    const messaging = fakeMessaging({
      submit: (input) => ok({ id: input.id, evidence: "queued", nativeId: "T1" }),
      reconcile: (_b, id) => ok({ id, evidence: "queued", nativeId: "T1" }),
    });
    const { service } = harness(db, messaging);
    const id = chatDeliveryId(17, "remy");
    await service.deliverPeerInput(old, peer(id));
    const current = reattach(db, old);
    expect(await service.settled(current, [id])).toEqual(new Set());
    await service.deliverPeerInput(current, peer(id));
    expect(messaging.reconciles[0]!.generation).toBe(old.attachment.generation);
    expect(messaging.submits.map((s) => [s.input.id, s.generation])).toEqual([[id, old.attachment.generation], [id, current.attachment.generation]]);
  });

  test("after a reconnect the delivery is redelivered under the same id and only a fresh echo is consumption", async () => {
    const db = openStateDb(dbPath());
    const binding = bindSession(db, "T1");
    const one = fakeMessaging({ connection: "conn-1", submit: () => fault("ambiguous"), reconcile: () => ok(null) });
    const two = fakeMessaging({
      connection: "conn-2",
      submit: (input) => ok({ id: input.id, evidence: "queued", nativeId: "T1" }),
      reconcile: () => ok(null),
    });
    let live = one;
    const { service, clock } = harness(db, one, { messagingFor: async () => live.adapter });
    const id = chatDeliveryId(17, "remy");
    await service.deliverPeerInput(binding, peer(id));
    const scheduled = row(db, id).nextAttemptAt!;
    expect(scheduled).toBeGreaterThan(clock.now);

    live = two;
    clock.now += 1;
    const redelivered = await service.deliverPeerInput(binding, peer(id));
    expect(two.reconciles.map((r) => r.id)).toContain(id);
    expect(two.submits.map((s) => s.input.id)).toEqual([id]);
    expect(redelivered).toEqual(ok({ id, evidence: "queued", nativeId: "T1" }));
    expect(row(db, id).state).toBe("queued");
  });

  test("a reconnect makes a harness's scheduled rows due and reconciles them at once", async () => {
    const db = openStateDb(dbPath());
    const binding = bindSession(db, "T1");
    const one = fakeMessaging({ connection: "conn-1", submit: () => fault("ambiguous"), reconcile: () => ok(null) });
    const two = fakeMessaging({ connection: "conn-2", reconcile: () => ok(null) });
    let live = one;
    const { service, clock } = harness(db, one, { messagingFor: async () => live.adapter });
    const id = chatDeliveryId(17, "remy");
    await service.deliverPeerInput(binding, peer(id));
    expect(row(db, id).nextAttemptAt).toBe(clock.now + DELIVERY_SWEEP_INTERVAL_MS);
    live = two;
    clock.now += 1;
    await service.settled(binding, [id]);
    await waitFor(() => two.reconciles.length >= 2);
    await waitFor(() => row(db, id).nextAttemptAt === clock.now + DELIVERY_SWEEP_INTERVAL_MS);
    expect(row(db, id).state).toBe("ambiguous");
    expect(two.submits).toEqual([]);
  });
});

describe("queued evidence across a reconnect (M2b review)", () => {
  test("a reconnect makes queued rows due at once, so the new connection's recovered evidence settles them", async () => {
    const db = openStateDb(dbPath());
    const binding = bindSession(db, "T1");
    const one = fakeMessaging({ connection: "conn-1", submit: (input) => ok({ id: input.id, evidence: "queued", nativeId: "T1" }) });
    const two = fakeMessaging({
      connection: "conn-2",
      submit: (input) => ok({ id: input.id, evidence: "queued", nativeId: "T1" }),
      reconcile: (_b, id) => ok({ id, evidence: "consumed", nativeId: "T1", turnId: "U1", itemId: "I1" }),
    });
    let live = one;
    const { service, clock } = harness(db, one, { messagingFor: async () => live.adapter });
    const id = chatDeliveryId(17, "remy");
    await service.deliverPeerInput(binding, peer(id));
    expect(row(db, id)).toMatchObject({ state: "queued", nextAttemptAt: clock.now + DELIVERY_SWEEP_INTERVAL_MS });
    live = two;
    clock.now += 1;
    await service.deliverPeerInput(binding, peer(chatDeliveryId(18, "remy")));
    await service.idle();
    expect(row(db, id)).toMatchObject({ state: "consumed", turnId: "U1", itemId: "I1" });
    expect(two.submits.map((s) => s.input.id)).toEqual([chatDeliveryId(18, "remy")]);
  });
});

describe("queued evidence (M2b D3)", () => {
  test("a queued delivery is rechecked with doubling backoff until its echo makes it consumed, and is never sent again", async () => {
    const db = openStateDb(dbPath());
    const binding = bindSession(db, "T1");
    let consumed = false;
    const messaging = fakeMessaging({
      submit: (input) => ok({ id: input.id, evidence: "queued", nativeId: "T1" }),
      reconcile: (_b, id) => ok(consumed ? { id, evidence: "consumed", nativeId: "T1", turnId: "U1", itemId: "I1" } : { id, evidence: "queued", nativeId: "T1" }),
    });
    const { service, clock } = harness(db, messaging);
    const id = chatDeliveryId(17, "remy");
    await service.deliverPeerInput(binding, peer(id));
    expect(row(db, id)).toMatchObject({ state: "queued", nextAttemptAt: T0 + DELIVERY_SWEEP_INTERVAL_MS });

    const checkedAt: number[] = [];
    for (let tick = 1; tick <= 16; tick++) {
      clock.now = T0 + tick * DELIVERY_SWEEP_INTERVAL_MS;
      const before = messaging.reconciles.length;
      expect(await service.reconcileDeliveries(clock.now)).toEqual({ retried: 0, ambiguous: 0 });
      if (messaging.reconciles.length > before) checkedAt.push(tick);
    }
    expect(checkedAt).toEqual([1, 3, 7, 15]);
    expect(row(db, id).state).toBe("queued");

    consumed = true;
    clock.now = T0 + 31 * DELIVERY_SWEEP_INTERVAL_MS;
    await service.reconcileDeliveries(clock.now);
    expect(row(db, id)).toMatchObject({ state: "consumed", turnId: "U1", itemId: "I1" });
    expect(row(db, id).nextAttemptAt).toBeUndefined();
    expect(messaging.submits).toHaveLength(1);
    expect(messaging.reconciles.every((r) => r.generation === binding.attachment.generation)).toBe(true);
  });

  test("the recheck interval saturates at the sweep's backoff cap", async () => {
    const db = openStateDb(dbPath());
    const binding = bindSession(db, "T1");
    const messaging = fakeMessaging({
      submit: (input) => ok({ id: input.id, evidence: "queued", nativeId: "T1" }),
      reconcile: (_b, id) => ok({ id, evidence: "queued", nativeId: "T1" }),
    });
    const { service, clock } = harness(db, messaging);
    const id = chatDeliveryId(17, "remy");
    await service.deliverPeerInput(binding, peer(id));
    const gaps: number[] = [];
    for (let i = 0; i < 12; i++) {
      const due = row(db, id).nextAttemptAt!;
      gaps.push((due - clock.now) / DELIVERY_SWEEP_INTERVAL_MS);
      clock.now = due;
      await service.reconcileDeliveries(clock.now);
    }
    expect(gaps).toEqual([1, 2, 4, 8, 16, 32, 64, 120, 120, 120, 120, 120]);
  });

  test("a queued row whose attachment was replaced or detached stops being checked and stays queued", async () => {
    for (const end of ["replaced", "detached"] as const) {
      const db = openStateDb(dbPath());
      const binding = bindSession(db, "T1");
      const messaging = fakeMessaging({
        submit: (input) => ok({ id: input.id, evidence: "queued", nativeId: "T1" }),
        reconcile: (_b, id) => ok({ id, evidence: "queued", nativeId: "T1" }),
      });
      const { service, clock } = harness(db, messaging);
      const id = chatDeliveryId(17, "remy");
      await service.deliverPeerInput(binding, peer(id));
      if (end === "replaced") reattach(db, binding);
      else expect(createSessionStore(db).detach(binding.key, binding.attachment.generation).ok).toBe(true);
      clock.now += DELIVERY_SWEEP_INTERVAL_MS;
      await service.reconcileDeliveries(clock.now);
      expect(row(db, id)).toMatchObject({ state: "queued" });
      expect(row(db, id).nextAttemptAt).toBeUndefined();
      expect(messaging.reconciles).toEqual([]);
    }
  });

  test("a queued row is never settled by the cursor its own delivery moved", async () => {
    const db = openStateDb(dbPath());
    const binding = bindSession(db, "T1");
    db.run("INSERT INTO chat_members (room, handle, joined_at, last_read_id) VALUES ('general', 'remy', 0, 9)");
    const messaging = fakeMessaging({
      submit: (input) => ok({ id: input.id, evidence: "queued", nativeId: "T1" }),
      reconcile: (_b, id) => ok({ id, evidence: "queued", nativeId: "T1" }),
    });
    const { service, clock } = harness(db, messaging);
    const id = chatDeliveryId(5, "remy");
    await service.deliverPeerInput(binding, peer(id, { constituents: [{ id, room: "general", messageId: 5 }] }));
    clock.now += DELIVERY_SWEEP_INTERVAL_MS;
    await service.reconcileDeliveries(clock.now);
    expect(service.supersedeRead("remy")).toBe(0);
    expect(row(db, id)).toMatchObject({ state: "queued", nextAttemptAt: clock.now + 2 * DELIVERY_SWEEP_INTERVAL_MS });
  });
});

describe("bounded recovery", () => {
  test("one pass looks at a bounded number of rows and leaves the rest for the next", async () => {
    const db = openStateDb(dbPath());
    const binding = bindSession(db, "T1");
    const messaging = fakeMessaging({ submit: () => fault("ambiguous"), reconcile: () => ok(null) });
    const { service, clock } = harness(db, messaging, { reconcileLimit: 2 });
    for (const m of [1, 2, 3]) await service.deliverPeerInput(binding, peer(chatDeliveryId(m, "remy")));
    clock.now += DELIVERY_SWEEP_INTERVAL_MS;
    expect(await service.reconcileDeliveries(clock.now)).toEqual({ retried: 2, ambiguous: 2 });
    expect(await service.reconcileDeliveries(clock.now)).toEqual({ retried: 1, ambiguous: 1 });
  });

  test("a cancelled pass does no work", async () => {
    const db = openStateDb(dbPath());
    const binding = bindSession(db, "T1");
    const messaging = fakeMessaging({ submit: () => fault("ambiguous"), reconcile: () => ok(null) });
    const { service, clock } = harness(db, messaging);
    await service.deliverPeerInput(binding, peer(chatDeliveryId(1, "remy")));
    const controller = new AbortController();
    controller.abort();
    const reconciled = messaging.reconciles.length;
    expect(await service.reconcileDeliveries(clock.now + DELIVERY_SWEEP_INTERVAL_MS, { signal: controller.signal })).toEqual({ retried: 0, ambiguous: 0 });
    expect(messaging.reconciles).toHaveLength(reconciled);
  });

  test("a row the room log no longer owes is settled superseded and stops being scheduled (M2b D4)", async () => {
    const db = openStateDb(dbPath());
    const binding = bindSession(db, "T1");
    db.run("INSERT INTO chat_members (room, handle, joined_at, last_read_id) VALUES ('general', 'remy', 0, 9)");
    const messaging = fakeMessaging({ submit: () => fault("ambiguous"), reconcile: () => ok(null) });
    const { service, clock } = harness(db, messaging);
    const id = chatDeliveryId(5, "remy");
    await service.deliverPeerInput(binding, peer(id, { constituents: [{ id, room: "general", messageId: 5 }] }));
    expect(await service.reconcileDeliveries(clock.now + DELIVERY_SWEEP_INTERVAL_MS)).toEqual({ retried: 0, ambiguous: 0 });
    expect(row(db, id)).toMatchObject({ state: "superseded" });
    expect(row(db, id).nextAttemptAt).toBeUndefined();
    expect(messaging.reconciles.map((r) => r.id)).toEqual([id]);
    expect(messaging.submits).toHaveLength(1);
    await waitFor(() => messaging.settles.length === 1);
    expect(messaging.settles.map((s) => s.id)).toEqual([id]);
  });

  test("an ambiguous row the recipient read is still settled by evidence first", async () => {
    const db = openStateDb(dbPath());
    const binding = bindSession(db, "T1");
    db.run("INSERT INTO chat_members (room, handle, joined_at, last_read_id) VALUES ('general', 'remy', 0, 9)");
    const messaging = fakeMessaging({
      submit: () => fault("ambiguous"),
      reconcile: (_b, id) => ok({ id, evidence: "consumed", nativeId: "T1", turnId: "U1", itemId: "I1" }),
    });
    const { service, clock } = harness(db, messaging);
    const id = chatDeliveryId(5, "remy");
    await service.deliverPeerInput(binding, peer(id, { constituents: [{ id, room: "general", messageId: 5 }] }));
    await service.reconcileDeliveries(clock.now + DELIVERY_SWEEP_INTERVAL_MS);
    expect(row(db, id)).toMatchObject({ state: "consumed", turnId: "U1" });
  });

  test("backoff saturates at 120 ticks and never stops", () => {
    expect([1, 4].map((f) => deliveryBackoffTicks(f))).toEqual([0, 0]);
    expect([5, 6, 11].map((f) => deliveryBackoffTicks(f))).toEqual([1, 2, 64]);
    const backoffTicks = deliveryBackoffTicks(12);
    expect(backoffTicks).toBe(120);
    expect(deliveryBackoffTicks(40)).toBe(MAX_DELIVERY_BACKOFF_TICKS);
  });

  test("a background unit cancels its work at stop and waits for it to settle", async () => {
    const controller = new AbortController();
    const seen: string[] = [];
    const unit = backgroundUnit("t", controller, async (signal) => {
      while (!signal.aborted) await Bun.sleep(1);
      seen.push("cancelled");
    }, () => seen.push("error"));
    await unit.start();
    expect(seen).toEqual([]);
    await unit.stop();
    expect(seen).toEqual(["cancelled"]);
  });

  test("idle waits out a pass a reconnect started", async () => {
    const db = openStateDb(dbPath());
    const binding = bindSession(db, "T1");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const one = fakeMessaging({ connection: "conn-1", submit: () => fault("ambiguous"), reconcile: () => ok(null) });
    const two = fakeMessaging({ connection: "conn-2" });
    two.adapter.reconcile = async () => {
      await gate;
      return ok(null);
    };
    let live = one;
    const { service, clock } = harness(db, one, { messagingFor: async () => live.adapter });
    await service.deliverPeerInput(binding, peer(chatDeliveryId(1, "remy")));
    live = two;
    clock.now += 1;
    const checking = service.settled(binding, [chatDeliveryId(1, "remy")]);
    await Bun.sleep(1);
    let idle = false;
    const waiting = service.idle().then(() => { idle = true; });
    await Bun.sleep(5);
    expect(idle).toBe(false);
    release();
    await Promise.all([checking, waiting]);
    expect(idle).toBe(true);
  });
});

// ─── Chat through harness delivery ──────────────────────────────────────────

const quietLog = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} } as unknown as Logger;
const noHerdr: typeof herdrRequest = (async () => ({ ok: false, code: "unreachable", message: "no herdr in this test" })) as unknown as typeof herdrRequest;
const noInbox: InboxDeps = {
  resolve: () => null,
  deliver: async () => {
    throw new Error("the inbox path must not run for a bound recipient");
  },
};

function lastReadId(db: Database, room: string, handle: string): number {
  return (db.query("SELECT last_read_id FROM chat_members WHERE room = ? AND handle = ?;").get(room, handle) as { last_read_id: number }).last_read_id;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 2000) throw new Error("waitFor: timed out");
    await Bun.sleep(2);
  }
}

/**
 * Room "general" with author "a" and recipient "b", whose session is bound in
 * `harnessId`. `link` is the harness's messaging connection; `claudeInbox`
 * gives a Claude session a live registry inbox. `paneAgent` is the agent herdr
 * shows in the binding's pane (`null`: no such pane), the harness by default.
 */
async function chatFixture(
  messaging: { adapter: MessageAdapter }, harnessId = "codex",
  opts: {
    link?: () => string | null; claudeInbox?: boolean; live?: () => boolean | undefined;
    paneAgent?: () => string | null; mode?: "herdr" | "headless";
  } = {},
) {
  const db = openStateDb(dbPath());
  const { service, clock } = harness(db, messaging, {
    log: quietLog, connectionOf: opts.link ?? (() => "conn-test"), liveOf: () => opts.live?.(),
  });
  const sock = join(tmpdir(), `delivery-inbox-${process.pid}-${n++}`);
  await Bun.write(sock, "");
  const inbox = { pid: process.pid, socketPath: sock, status: "idle" as const };
  const inboxDeps: InboxDeps = opts.claudeInbox ? { ...noInbox, resolve: (id) => (id === "sess-b" ? inbox : null) } : noInbox;
  const registryDeps: RegistryDeps = opts.claudeInbox
    ? { resolve: (id) => (id === "sess-b" ? inbox : null), alive: () => true, resolveAll: () => new Map([["sess-b", inbox]]) }
    : { resolve: () => null, alive: () => false, resolveAll: () => new Map() };
  const herdrCalls: string[] = [];
  const paneAgent = opts.paneAgent ?? (() => harnessId);
  const herdr = (async (method: string, params: { target?: string }) => {
    herdrCalls.push(method);
    const agent = method === "agent.get" && params.target === "p1" ? paneAgent() : null;
    if (agent !== null) return { ok: true, result: { agent: { agent, agent_status: "idle" } } };
    return { ok: false, code: "unreachable", message: "no herdr in this test" };
  }) as unknown as typeof herdrRequest;
  const h = createChatHandlers({ db, emitEvent: () => 0, inboxDeps, herdr, log: quietLog, retryDelayMs: 0, delivery: service });
  await h["chat:join"]({ room: "general", handle: "a", wakeOn: "all" });
  await h["chat:join"]({ room: "general", handle: "b", wakeOn: "all" });
  signIn({ sessionId: "sess-b", continueId: "b" }, db);
  const binding = bindSession(db, "sess-b", harnessId, opts.mode);
  const sweep = createChatDeliverySweep({
    db, deliveryChains: new Map(), inboxDeps, herdr, log: quietLog, retryDelayMs: 0,
    registryDeps, delivery: service, now: () => clock.now,
  });
  const posted = async (body: string) => {
    const res = await h["chat:post"]({ room: "general", handle: "a", body });
    if (!res.ok) throw new Error(res.error);
    return res.data;
  };
  const post = async (body: string) => (await posted(body)).id;
  return { db, h, service, clock, binding, sweep, post, posted, herdrCalls };
}

describe("chat through harness delivery", () => {
  beforeEach(() => setSetting("agent.integrations.enabled", true, "machine"));
  afterEach(() => setSetting("agent.integrations.enabled", false, "machine"));

  test("an ambiguous delivery keeps the room message and the cursor, and the sweep redelivers the same id", async () => {
    const messaging = fakeMessaging({ submit: () => fault("ambiguous"), reconcile: () => ok(null) });
    const x = await chatFixture(messaging);
    const id = await x.post("ship it");
    await waitFor(() => messaging.submits.length === 1);
    await Bun.sleep(5);
    expect(listMessages({ room: "general", limit: 10 }, x.db).map((m) => m.body)).toEqual(["ship it"]);
    expect(lastReadId(x.db, "general", "b")).toBeLessThan(id);
    expect(row(x.db, chatDeliveryId(id, "b")).state).toBe("ambiguous");

    x.clock.now += DELIVERY_SWEEP_INTERVAL_MS;
    expect(await x.sweep()).toEqual({ sweptPairs: 1, recoveredMessages: 0 });
    expect(messaging.submits.map((s) => s.input.id)).toEqual([chatDeliveryId(id, "b"), chatDeliveryId(id, "b")]);
    expect(listMessages({ room: "general", limit: 10 }, x.db)).toHaveLength(1);
    expect(lastReadId(x.db, "general", "b")).toBeLessThan(id);
  });

  test("a frame carries the reply guidance and batches what is owed under the newest message's id", async () => {
    let fail = true;
    const messaging = fakeMessaging({
      submit: (input) => (fail ? fault("transient") : ok({ id: input.id, evidence: "queued", nativeId: "sess-b" })),
    });
    const x = await chatFixture(messaging);
    const first = await x.post("one");
    await waitFor(() => messaging.submits.length === 2);
    fail = false;
    const second = await x.post("two");
    await waitFor(() => lastReadId(x.db, "general", "b") === second);
    const frame = messaging.submits.at(-1)!.input;
    expect(frame.id).toBe(chatDeliveryId(second, "b"));
    expect(frame.sender).toBe("rt chat (2 messages)");
    expect(frame.body).toContain(`[#general] a #${first}: one\n[#general] a #${second}: two\n`);
    expect(frame.body).toContain("(never SendMessage; this arrived through rt chat)");
    expect([first, second].map((m) => row(x.db, chatDeliveryId(m, "b")))).toMatchObject([
      { state: "queued", frameId: chatDeliveryId(second, "b") },
      { state: "queued", frameId: chatDeliveryId(second, "b") },
    ]);
  });

  test("a Claude-bound recipient whose registry inbox is dead is skipped, as today", async () => {
    const messaging = fakeMessaging({ submit: () => fault("not-ready") });
    const x = await chatFixture(messaging, "claude");
    const id = await x.post("hi");
    await Bun.sleep(10);
    x.clock.now += DELIVERY_SWEEP_INTERVAL_MS;
    expect(await x.sweep()).toEqual({ sweptPairs: 0, recoveredMessages: 0 });
    expect(messaging.submits).toEqual([]);
    expect(x.herdrCalls).toEqual([]);
    expect(lastReadId(x.db, "general", "b")).toBeLessThan(id);
  });

  test("while a bound harness has no connection nothing is attempted and no backoff builds", async () => {
    let link: string | null = null;
    const messaging = fakeMessaging({ submit: (input) => ok({ id: input.id, evidence: "queued", nativeId: "sess-b" }) });
    const x = await chatFixture(messaging, "codex", { link: () => link });
    const id = await x.post("hi");
    await Bun.sleep(10);
    for (let tick = 0; tick < 200; tick++) {
      x.clock.now += DELIVERY_SWEEP_INTERVAL_MS;
      expect(await x.sweep()).toEqual({ sweptPairs: 0, recoveredMessages: 0 });
    }
    expect(messaging.submits).toEqual([]);
    expect(x.herdrCalls).toEqual([]);
    link = "conn-1";
    x.clock.now += DELIVERY_SWEEP_INTERVAL_MS;
    expect(await x.sweep()).toEqual({ sweptPairs: 1, recoveredMessages: 1 });
    expect(lastReadId(x.db, "general", "b")).toBe(id);
  });

  test("outage, then reconnect with no new post, delivers on the next tick", async () => {
    let link: string | null = "conn-1";
    let up = false;
    const messaging = fakeMessaging({
      submit: (input) => (up ? ok({ id: input.id, evidence: "queued", nativeId: "sess-b" }) : fault("transient")),
    });
    const x = await chatFixture(messaging, "codex", { link: () => link });
    const id = await x.post("hi");
    await waitFor(() => messaging.submits.length === 2);
    await Bun.sleep(5);
    for (let tick = 0; tick < 150; tick++) {
      x.clock.now += DELIVERY_SWEEP_INTERVAL_MS;
      await x.sweep();
    }
    link = null;
    for (let tick = 0; tick < 10; tick++) {
      x.clock.now += DELIVERY_SWEEP_INTERVAL_MS;
      await x.sweep();
    }
    const beforeReconnect = messaging.submits.length;
    link = "conn-2";
    up = true;
    x.clock.now += DELIVERY_SWEEP_INTERVAL_MS;
    expect(await x.sweep()).toEqual({ sweptPairs: 1, recoveredMessages: 1 });
    expect(messaging.submits.length).toBe(beforeReconnect + 1);
    expect(lastReadId(x.db, "general", "b")).toBe(id);
  });

  test("Claude's submitted evidence moves the cursor as today and is never relabelled consumed", async () => {
    const messaging = fakeMessaging({ submit: (input) => ok({ id: input.id, evidence: "submitted", nativeId: "sess-b" }) });
    const x = await chatFixture(messaging, "claude", { claudeInbox: true });
    const id = await x.post("hi");
    await waitFor(() => lastReadId(x.db, "general", "b") === id);
    expect(row(x.db, chatDeliveryId(id, "b")).state).toBe("submitted");
    x.clock.now += DELIVERY_SWEEP_INTERVAL_MS * 200;
    await x.sweep();
    expect(row(x.db, chatDeliveryId(id, "b")).state).toBe("submitted");
  });

  test("evidence that arrives later moves the cursor without sending the frame again", async () => {
    let queued = false;
    const messaging = fakeMessaging({
      submit: () => fault("ambiguous"),
      reconcile: (_b, id) => ok(queued ? { id, evidence: "queued", nativeId: "sess-b" } : null),
    });
    const x = await chatFixture(messaging);
    const id = await x.post("hi");
    await waitFor(() => messaging.submits.length === 1);
    await Bun.sleep(5);
    queued = true;
    x.clock.now += DELIVERY_SWEEP_INTERVAL_MS;
    await x.sweep();
    expect(lastReadId(x.db, "general", "b")).toBe(id);
    expect(messaging.submits).toHaveLength(1);
  });

  test("the sweep backs off a failing recipient up to 120 ticks, keeps retrying, and a newer message resets the streak", async () => {
    const messaging = fakeMessaging({ submit: () => fault("transient") });
    const x = await chatFixture(messaging);
    await x.post("hi");
    await waitFor(() => messaging.submits.length === 2);
    await Bun.sleep(5);

    const attemptTicks: number[] = [];
    for (let tick = 1; tick <= 400; tick++) {
      const before = messaging.submits.length;
      x.clock.now += DELIVERY_SWEEP_INTERVAL_MS;
      await x.sweep();
      if (messaging.submits.length > before) attemptTicks.push(tick);
    }
    const gaps = attemptTicks.slice(1).map((t, i) => t - attemptTicks[i]!);
    expect(gaps.slice(0, 4)).toEqual([1, 1, 1, 1]);
    expect(gaps.slice(4, 11)).toEqual([2, 3, 5, 9, 17, 33, 65]);
    const backoffTicks = gaps[11]! - 1;
    expect(backoffTicks).toBe(120);
    expect(gaps[12]! - 1).toBe(120);

    const lastAttempt = attemptTicks.at(-1)!;
    expect(400 - lastAttempt).toBeLessThan(121);
    const before = messaging.submits.length;
    await x.post("newer");
    await waitFor(() => messaging.submits.length === before + 2);
    await Bun.sleep(5);
    const afterPost = messaging.submits.length;
    x.clock.now += DELIVERY_SWEEP_INTERVAL_MS;
    await x.sweep();
    expect(messaging.submits.length).toBeGreaterThan(afterPost);
  });

  test("a bound thread its harness reports not live is not targeted: no attempt, no row, the cursor stays and no backoff builds (M2b D2)", async () => {
    let live: boolean | undefined = false;
    const messaging = fakeMessaging({ submit: (input) => ok({ id: input.id, evidence: "queued", nativeId: "sess-b" }) });
    const x = await chatFixture(messaging, "codex", { live: () => live });
    const id = await x.post("hi");
    await Bun.sleep(10);
    for (let tick = 0; tick < 200; tick++) {
      x.clock.now += DELIVERY_SWEEP_INTERVAL_MS;
      expect(await x.sweep()).toEqual({ sweptPairs: 0, recoveredMessages: 0 });
    }
    expect(messaging.submits).toEqual([]);
    expect(readDelivery(x.db, chatDeliveryId(id, "b"))).toBeNull();
    expect(lastReadId(x.db, "general", "b")).toBeLessThan(id);
    live = undefined;
    x.clock.now += DELIVERY_SWEEP_INTERVAL_MS;
    expect(await x.sweep()).toEqual({ sweptPairs: 1, recoveredMessages: 1 });
    expect(lastReadId(x.db, "general", "b")).toBe(id);
  });

  test("a queued ack from a thread that went down meanwhile never moves the cursor (M2b D2)", async () => {
    let live: boolean | undefined = true;
    const messaging = fakeMessaging({
      submit: (input) => {
        live = false;
        return ok({ id: input.id, evidence: "queued", nativeId: "sess-b" });
      },
    });
    const x = await chatFixture(messaging, "codex", { live: () => live });
    const id = await x.post("hi");
    await waitFor(() => messaging.submits.length === 1);
    await Bun.sleep(5);
    expect(row(x.db, chatDeliveryId(id, "b")).state).toBe("queued");
    expect(lastReadId(x.db, "general", "b")).toBeLessThan(id);
    x.clock.now += DELIVERY_SWEEP_INTERVAL_MS;
    expect(await x.sweep()).toEqual({ sweptPairs: 0, recoveredMessages: 0 });
    expect(lastReadId(x.db, "general", "b")).toBeLessThan(id);
  });

  test("what the recipient already read is settled superseded, never consumed, and never sent again (M2b D4)", async () => {
    const messaging = fakeMessaging({ submit: () => fault("ambiguous"), reconcile: () => ok(null) });
    const x = await chatFixture(messaging);
    const id = await x.post("hi");
    await waitFor(() => messaging.submits.length === 1);
    await Bun.sleep(5);
    expect(row(x.db, chatDeliveryId(id, "b")).state).toBe("ambiguous");
    const read = await x.h["chat:read"]({ handle: "b", room: "general" });
    expect(read.ok).toBe(true);
    expect(row(x.db, chatDeliveryId(id, "b"))).toMatchObject({ state: "superseded" });
    expect(row(x.db, chatDeliveryId(id, "b")).nextAttemptAt).toBeUndefined();
    for (let tick = 0; tick < 5; tick++) {
      x.clock.now += DELIVERY_SWEEP_INTERVAL_MS;
      await x.sweep();
    }
    expect(messaging.submits).toHaveLength(1);
    expect(row(x.db, chatDeliveryId(id, "b")).state).toBe("superseded");
  });

  test("a read that lands while an attempt waits on evidence wins: nothing is sent, and the rows it settled stay superseded (live-05 D6)", async () => {
    let gate: Promise<void> | null = null;
    let reconciles = 0;
    const messaging = fakeMessaging({ submit: () => fault("ambiguous"), reconcile: () => ok(null) });
    messaging.adapter.reconcile = async () => {
      reconciles++;
      if (gate) await gate;
      return ok(null);
    };
    const x = await chatFixture(messaging);
    const first = await x.post("one");
    await waitFor(() => messaging.submits.length === 1);
    const second = await x.post("two");
    await waitFor(() => messaging.submits.length === 2);
    await Bun.sleep(5);
    const rows = () => [first, second].map((m) => row(x.db, chatDeliveryId(m, "b")));
    expect(rows().map((r) => r.state)).toEqual(["ambiguous", "ambiguous"]);
    const attempts = rows().map((r) => r.attempts);

    let release!: () => void;
    gate = new Promise<void>((resolve) => { release = resolve; });
    const seen = reconciles;
    // The clock has not moved, so the evidence pass finds nothing due: the sweep's attempt is what reads evidence, and it blocks there.
    const sweeping = x.sweep();
    await waitFor(() => reconciles === seen + 1);
    expect(messaging.submits).toHaveLength(2);
    expect((await x.h["chat:read"]({ handle: "b", room: "general" })).ok).toBe(true);
    expect(rows().map((r) => r.state)).toEqual(["superseded", "superseded"]);
    release();
    await sweeping;

    expect(messaging.submits).toHaveLength(2);
    expect(rows()).toMatchObject([{ state: "superseded", attempts: attempts[0] }, { state: "superseded", attempts: attempts[1] }]);
    expect(rows().map((r) => r.nextAttemptAt)).toEqual([undefined, undefined]);
    expect(lastReadId(x.db, "general", "b")).toBe(second);
    gate = null;
    x.clock.now += DELIVERY_SWEEP_INTERVAL_MS * 3;
    await x.sweep();
    expect(messaging.submits).toHaveLength(2);
    expect(rows().map((r) => r.state)).toEqual(["superseded", "superseded"]);
  });

  test("a delivery settled superseded tells its harness to stop waiting on it, under the attachment it went to (M2b round 3)", async () => {
    const messaging = fakeMessaging({ submit: () => fault("ambiguous"), reconcile: () => ok(null) });
    const x = await chatFixture(messaging);
    const id = await x.post("hi");
    await waitFor(() => messaging.submits.length === 1);
    await Bun.sleep(5);
    await x.h["chat:read"]({ handle: "b", room: "general" });
    await waitFor(() => messaging.settles.length === 1);
    expect(messaging.settles).toEqual([{ id: chatDeliveryId(id, "b"), generation: x.binding.attachment.generation, key: x.binding.key }]);
  });

  test("chat:mark settles what it marks read the same way", async () => {
    const messaging = fakeMessaging({ submit: () => fault("transient") });
    const x = await chatFixture(messaging);
    const first = await x.post("one");
    await waitFor(() => messaging.submits.length === 2);
    const second = await x.post("two");
    await waitFor(() => messaging.submits.length === 4);
    await Bun.sleep(5);
    await x.h["chat:mark"]({ handle: "b", room: "general", upto: first });
    expect(row(x.db, chatDeliveryId(first, "b")).state).toBe("superseded");
    expect(row(x.db, chatDeliveryId(second, "b")).state).toBe("pending");
  });

  test("nothing is queued once the pane has gone or no longer runs codex: rows stay pending and the cursor stays (M2b round 2)", async () => {
    for (const after of [null, "claude"]) {
      let agent: string | null = "codex";
      let up = false;
      const messaging = fakeMessaging({ submit: (input) => (up ? ok({ id: input.id, evidence: "queued", nativeId: "sess-b" }) : fault("transient")) });
      const x = await chatFixture(messaging, "codex", { paneAgent: () => agent });
      const first = await x.post("one");
      await waitFor(() => messaging.submits.length === 2);
      await Bun.sleep(5);
      expect(row(x.db, chatDeliveryId(first, "b")).state).toBe("pending");

      agent = after;
      up = true;
      const second = await x.post("two");
      await Bun.sleep(10);
      x.clock.now += DELIVERY_SWEEP_INTERVAL_MS;
      await x.sweep();
      expect(messaging.submits).toHaveLength(2);
      expect(row(x.db, chatDeliveryId(first, "b")).state).toBe("pending");
      expect(readDelivery(x.db, chatDeliveryId(second, "b"))).toBeNull();
      expect(lastReadId(x.db, "general", "b")).toBeLessThan(first);
      expect((await x.posted("three")).delivery).toEqual({ b: "later" });

      agent = "codex";
      x.clock.now += DELIVERY_SWEEP_INTERVAL_MS;
      await x.sweep();
      await waitFor(() => lastReadId(x.db, "general", "b") >= second);
    }
  });

  test("a headless Codex binding takes delivery with no pane to check (M2b round 2)", async () => {
    const messaging = fakeMessaging({ submit: (input) => ok({ id: input.id, evidence: "queued", nativeId: "sess-b" }) });
    const x = await chatFixture(messaging, "codex", { mode: "headless", paneAgent: () => null });
    const id = await x.post("hi");
    await waitFor(() => lastReadId(x.db, "general", "b") === id);
    expect(x.herdrCalls).not.toContain("agent.get");
  });

  test("chat:post reports each recipient's delivery evidence (sent, queued, later)", async () => {
    const cases: Array<{ submit: Submit; live?: boolean; expected: ChatPostDelivery }> = [
      { submit: (input) => ok({ id: input.id, evidence: "queued", nativeId: "sess-b" }), expected: "queued" },
      { submit: (input) => ok({ id: input.id, evidence: "consumed", nativeId: "sess-b", turnId: "U1", itemId: "I1" }), expected: "sent" },
      { submit: (input) => ok({ id: input.id, evidence: "submitted", nativeId: "sess-b" }), expected: "sent" },
      { submit: () => fault("ambiguous"), expected: "sending" },
      { submit: () => fault("transient"), expected: "later" },
      { submit: (input) => ok({ id: input.id, evidence: "queued", nativeId: "sess-b" }), live: false, expected: "later" },
    ];
    for (const c of cases) {
      const messaging = fakeMessaging({ submit: c.submit, reconcile: () => ok(null) });
      const x = await chatFixture(messaging, "codex", { live: () => c.live });
      const data = await x.posted("hi");
      expect(data.delivery).toEqual({ b: c.expected });
    }
  });
});

describe("switch-off parity", () => {
  test("with the switch off a bound recipient takes today's inbox path and no evidence is recorded", async () => {
    const db = openStateDb(dbPath());
    const messaging = fakeMessaging({ submit: () => { throw new Error("harness delivery must not run with the switch off"); } });
    let reconciled = 0;
    const { service } = harness(db, messaging);
    const spied = { ...service, reconcileDeliveries: async (now: number) => { reconciled++; return service.reconcileDeliveries(now); } };
    const frames: Array<[string, string, string | undefined]> = [];
    const sock = join(tmpdir(), `delivery-sock-${process.pid}-${n++}`);
    await Bun.write(sock, "");
    const inboxDeps: InboxDeps = {
      resolve: (sessionId) => (sessionId === "sess-b" ? { pid: process.pid, socketPath: sock, status: "idle" } : null),
      deliver: async (socketPath, content, opts) => { frames.push([socketPath, content, opts?.msgId]); return { ok: true }; },
    };
    const h = createChatHandlers({ db, emitEvent: () => 0, inboxDeps, herdr: noHerdr, log: quietLog, retryDelayMs: 0, delivery: spied });
    await h["chat:join"]({ room: "general", handle: "a", wakeOn: "all" });
    await h["chat:join"]({ room: "general", handle: "b", wakeOn: "all" });
    signIn({ sessionId: "sess-b", continueId: "b" }, db);
    bindSession(db, "sess-b", "claude");
    await Bun.sleep(5);
    frames.length = 0;
    const posted = await h["chat:post"]({ room: "general", handle: "a", body: "@b hi" });
    if (!posted.ok) throw new Error(posted.error);
    expect(Object.keys(posted.data).sort()).toEqual(["id", "others", "recipientNames", "recipients"]);
    await waitFor(() => frames.length === 1);
    expect(frames).toEqual([[
      sock,
      `<cross-session-message from-name="a (#general)">\n[#general] a #1: @b hi\nreply via rt chat post <room> "..." or rt chat dm a "..." (never SendMessage; this arrived through rt chat)\n</cross-session-message>`,
      undefined,
    ]]);
    expect(lastReadId(db, "general", "b")).toBe(posted.data.id);
    const sweep = createChatDeliverySweep({ db, deliveryChains: new Map(), inboxDeps, herdr: noHerdr, log: quietLog, retryDelayMs: 0, delivery: spied });
    await sweep();
    expect(reconciled).toBe(0);
    expect(messaging.submits).toEqual([]);
    expect(db.query("SELECT COUNT(*) AS n FROM agent_deliveries").get()).toEqual({ n: 0 });
  });
});
