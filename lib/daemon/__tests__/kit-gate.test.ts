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
    expect(guard("w1:p1")).toEqual({ id: viaOrigin.id, session: "sess-1" });
    expect(guard("w2:p2")).toEqual({ id: viaTop.id });
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

  test("refuses to type into a pane with an open kit gate, without prompting it, and delivers once the gate is answered", async () => {
    setKitGateGuard(openKitGateForPane(store));
    const row = openKit("w1:p1");
    const { herdr, seen } = pane();

    expect(await injectIntoPane({ paneId: "w1:p1", text: "hello", herdr })).toEqual(REFUSED("w1:p1"));
    expect(seen.map((s) => s.method)).toEqual(["session.snapshot"]);

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
    expect(seen.some((s) => s.method === "agent.prompt")).toBe(false);
  });

  // A pane whose snapshot names `session` as its live agent; prompts are accepted.
  function paneRunning(session: string | null) {
    return pane((method, params) => {
      if (method === "session.snapshot") {
        const agentSession = session ? { source: "hook", agent: "claude", kind: "id", value: session } : undefined;
        return { type: "session_snapshot", snapshot: { workspaces: [], panes: [{ pane_id: "w1:p1", workspace_id: "w1", tab_id: "t1", agent: "claude", agent_status: "idle", agent_session: agentSession }] } };
      }
      if (method === "agent.get") return { type: "agent_info", agent: { pane_id: "w1:p1", agent: "claude", agent_status: "idle" } };
      if (method === "agent.prompt") return { type: "agent_prompted", agent: { pane_id: "w1:p1", agent: "claude", agent_status: "working", text: params.text } };
      return new HerdrFakeError("invalid_request", method);
    });
  }

  test("a kit gate whose session is no longer the pane's live agent does not block typing, and says so in the log", async () => {
    const warned: unknown[] = [];
    setKitGateGuard(openKitGateForPane(store), { warn: (obj: unknown) => warned.push(obj) } as never);
    const row = openKit("w1:p1", "sess-old");
    const { herdr, seen } = paneRunning("sess-new");
    expect(await injectIntoPane({ paneId: "w1:p1", text: "hello", herdr })).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "accepted" } });
    expect(seen.some((s) => s.method === "agent.prompt")).toBe(true);
    expect(warned).toEqual([expect.objectContaining({ gateId: row.id, gateSession: "sess-old", paneSession: "sess-new" })]);
  });

  test("a kit gate whose session is the pane's live agent still refuses", async () => {
    setKitGateGuard(openKitGateForPane(store));
    openKit("w1:p1", "sess-1");
    const { herdr, seen } = paneRunning("sess-1");
    expect(await injectIntoPane({ paneId: "w1:p1", text: "hello", herdr })).toEqual(REFUSED("w1:p1"));
    expect(seen.some((s) => s.method === "agent.prompt")).toBe(false);
  });

  test("a pane whose live session the daemon cannot learn is still refused", async () => {
    setKitGateGuard(openKitGateForPane(store));
    openKit("w1:p1", "sess-1");
    const { herdr, seen } = paneRunning(null);
    expect(await injectIntoPane({ paneId: "w1:p1", text: "hello", herdr })).toEqual(REFUSED("w1:p1"));
    expect(seen.some((s) => s.method === "agent.prompt")).toBe(false);
  });

  test("a gate lookup that throws lets the text through, with a warning", async () => {
    const warned: unknown[] = [];
    setKitGateGuard(() => {
      throw new Error("gates.db is locked");
    }, { warn: (obj: unknown) => warned.push(obj) } as never);
    const { herdr } = pane();
    expect(await injectIntoPane({ paneId: "w1:p1", text: "hello", herdr })).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "accepted" } });
    expect(warned).toHaveLength(1);
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
    expect(openKitGateForPane(store)("w1:p1")?.id).toBe(row.id);
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
