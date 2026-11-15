import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import pino from "pino";
import { herdrRequest } from "../../herdr/client.ts";
import { fakeHerdr, HerdrFakeError, type FakeHerdrHandler } from "../../herdr/__tests__/fake-herdr.ts";
import { createGatesStore, type GatesStore, type GateQuestion } from "../gates-store.ts";
import { injectIntoPane, setKitGateGuard } from "../inject.ts";
import { bgSocketPath } from "../bg-service.ts";
import { openKitGateFor, openKitGateForPane } from "../kit-gate.ts";
import { createGatePush, GATE_ANSWERED_PHRASE } from "../gate-push.ts";
import { wrapCrossSession } from "../inbox.ts";

const log = pino({ level: "silent" });
const Q: GateQuestion[] = [{ id: "q", label: "Pick", multi: false, options: ["a", "b"] }];
const REFUSED = (paneId: string) => ({ ok: true as const, data: { paneId, delivered: "refused" as const, reason: "a kit form is open here" } });

let dir: string;
let store: GatesStore;
const stops: Array<() => void> = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-kit-gate-"));
  store = createGatesStore({ dbPath: join(dir, "gates.db"), log });
});
afterEach(() => {
  setKitGateGuard(null);
  for (const s of stops) s();
  stops.length = 0;
  rmSync(dir, { recursive: true, force: true });
});

const openKit = (paneId: string, session = "sess-1") =>
  store.open({ subject: "run:r1", kind: "clarify", questions: Q, nudge: { session }, origin: { paneId, presentation: "kit" } }).row;

describe("openKitGateFor", () => {
  test("finds the open kit gate nudging a session, and nothing once it is answered", () => {
    const row = openKit("w1:p1");
    expect(openKitGateFor(store)("sess-1")).toBe(row.id);
    expect(openKitGateFor(store)("sess-2")).toBeNull();
    store.answer(row.id, { q: "a" }, "board");
    expect(openKitGateFor(store)("sess-1")).toBeNull();
  });
});

describe("openKitGateForPane", () => {
  test("matches the gate's origin.paneId, else its top-level pane, in the same ref space", () => {
    const viaOrigin = openKit("w1:p1");
    const viaTop = store.open({ subject: "run:r2", kind: "clarify", questions: Q, pane: "w2:p2", origin: { presentation: "kit" } }).row;
    const guard = openKitGateForPane(store);
    expect(guard("w1:p1")).toBe(viaOrigin.id);
    expect(guard("w2:p2")).toBe(viaTop.id);
    expect(guard("bg:w1:p1")).toBeNull();
    expect(guard("w9:p9")).toBeNull();
  });

  test("ignores form gates: only a kit form leaves its pane idle", () => {
    store.open({ subject: "run:r1", kind: "clarify", questions: Q, origin: { paneId: "w1:p1", presentation: "form" } });
    expect(openKitGateForPane(store)("w1:p1")).toBeNull();
  });
});

describe("the injector's kit-gate guard", () => {
  function pane(handler?: FakeHerdrHandler) {
    const fake = fakeHerdr(handler ?? ((method, params) => {
      if (method === "agent.get") return { type: "agent_info", agent: { pane_id: "w1:p1", agent: "claude", agent_status: "idle" } };
      if (method === "agent.prompt") return { type: "agent_prompted", agent: { pane_id: "w1:p1", agent: "claude", agent_status: "working", text: params.text } };
      return new HerdrFakeError("invalid_request", method);
    }));
    stops.push(fake.stop);
    const herdr: typeof herdrRequest = (m, p, o) => herdrRequest(m, p, { ...o, sockPath: fake.sock });
    return { herdr, seen: fake.seen };
  }

  test("refuses to type into a pane with an open kit gate, before any herdr call, and delivers once the gate is answered", async () => {
    setKitGateGuard(openKitGateForPane(store));
    const row = openKit("w1:p1");
    const { herdr, seen } = pane();

    expect(await injectIntoPane({ paneId: "w1:p1", text: "hello", herdr })).toEqual(REFUSED("w1:p1"));
    expect(seen).toEqual([]);

    store.answer(row.id, { q: "a" }, "board");
    expect(await injectIntoPane({ paneId: "w1:p1", text: "hello", herdr })).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "accepted" } });
    expect(seen.some((s) => s.method === "agent.prompt")).toBe(true);
  });

  test("a bg-server pane is matched by its bg: ref, not by the bare id", async () => {
    setKitGateGuard(openKitGateForPane(store));
    openKit("bg:w1:p1");
    const { herdr, seen } = pane();
    expect(await injectIntoPane({ paneId: "w1:p1", text: "hello", herdr })).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "accepted" } });
    seen.length = 0;
    expect(await injectIntoPane({ paneId: "w1:p1", text: "hello", herdr, sockPath: bgSocketPath() })).toEqual(REFUSED("w1:p1"));
    expect(seen).toEqual([]);
  });

  test("a kit gate raised by an earlier session in the pane still refuses, since a /clear or resume can change the session id under a live form", async () => {
    setKitGateGuard(openKitGateForPane(store));
    openKit("w1:p1", "sess-old");
    const { herdr, seen } = pane();
    expect(await injectIntoPane({ paneId: "w1:p1", text: "hello", herdr })).toEqual(REFUSED("w1:p1"));
    expect(seen).toEqual([]);
  });

  test("a gate lookup that throws lets the text through, with a warning at each of its two checks", async () => {
    const warned: unknown[] = [];
    setKitGateGuard(() => {
      throw new Error("gates.db is locked");
    }, { warn: (obj: unknown) => warned.push(obj) } as never);
    const { herdr } = pane();
    expect(await injectIntoPane({ paneId: "w1:p1", text: "hello", herdr })).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "accepted" } });
    expect(warned).toHaveLength(2);
  });

  test("with no guard installed nothing changes", async () => {
    openKit("w1:p1");
    const { herdr } = pane();
    expect(await injectIntoPane({ paneId: "w1:p1", text: "hello", herdr })).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "accepted" } });
  });
});

describe("the gate doorbell", () => {
  test("still reaches the agent after its kit gate is answered, with the pane guard installed", async () => {
    setKitGateGuard(openKitGateForPane(store));
    const row = openKit("w1:p1");
    expect(openKitGateForPane(store)("w1:p1")).toBe(row.id);
    const delivered: Array<{ socketPath: string; body: string }> = [];
    const push = createGatePush({
      store,
      deliver: async (socketPath, body) => { delivered.push({ socketPath, body }); return { ok: true as const }; },
      resolveSession: (session) => ({ socketPath: session }),
      log,
    });

    store.answer(row.id, { q: "a" }, "board");
    await push.onAnswered(store.get(row.id)!);

    expect(delivered).toEqual([{ socketPath: "sess-1", body: wrapCrossSession("gate-facility", GATE_ANSWERED_PHRASE(row.id, "board")) }]);
    expect(store.get(row.id)!.delivery!.outcome).toBe("delivered");
  });
});
