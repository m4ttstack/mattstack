import { describe, expect, test } from "bun:test";
import type { SupportRelay } from "../relay.ts";
import { startSupportLoop, type SupportLoopDeps } from "../loop.ts";

type Wait = { woke: boolean; cursor: number } | null;

function harness(waits: Wait[], over: Partial<SupportLoopDeps> = {}) {
  const events: string[] = [];
  const sleeps: number[] = [];
  let handle: ReturnType<typeof startSupportLoop> | undefined;
  const relay = {
    wait: async (_kind: string, since: number, signal: AbortSignal) => {
      events.push(`wait ${since}`);
      const next = waits.shift();
      if (next === undefined) {
        handle!.stop();
        return new Promise<Wait>((r) => (signal.aborted ? r(null) : signal.addEventListener("abort", () => r(null), { once: true })));
      }
      return next;
    },
  } as unknown as SupportRelay;
  handle = startSupportLoop({
    kind: "request",
    active: () => true,
    relay: async () => relay,
    pull: async () => void events.push("pull"),
    log: { warn: () => events.push("warn"), info: () => events.push("info") } as unknown as SupportLoopDeps["log"],
    sleep: async (ms) => {
      sleeps.push(ms);
      if (sleeps.length >= 6) handle!.stop();
    },
    ...over,
  });
  return { handle, events, sleeps };
}

describe("the support loop", () => {
  test("it pulls at the start, after a wake, and after a wait that timed out", async () => {
    const h = harness([
      { woke: true, cursor: 5 },
      { woke: false, cursor: 5 },
    ]);
    await h.handle.done;
    expect(h.events).toEqual(["pull", "wait 0", "pull", "wait 5", "pull", "wait 5"]);
    expect(h.sleeps).toEqual([]);
  });

  test("the cursor never goes back", async () => {
    const h = harness([
      { woke: true, cursor: 5 },
      { woke: true, cursor: 3 },
    ]);
    await h.handle.done;
    expect(h.events.filter((e) => e.startsWith("wait"))).toEqual(["wait 0", "wait 5", "wait 5"]);
  });

  test("a relay that stops answering is backed off from, and said once", async () => {
    const h = harness([null, null, null, { woke: false, cursor: 0 }]);
    await h.handle.done;
    expect(h.sleeps).toEqual([1_000, 2_000, 4_000]);
    expect(h.events.filter((e) => e === "warn")).toHaveLength(1);
    expect(h.events.filter((e) => e === "info")).toHaveLength(1);
  });

  test("while it is not active it makes no relay call", async () => {
    const h = harness([], { active: () => false });
    await h.handle.done;
    expect(h.events).toEqual([]);
    expect(h.sleeps.length).toBe(6);
  });

  test("with no relay to call, it waits", async () => {
    const h = harness([], { relay: async () => null });
    await h.handle.done;
    expect(h.events).toEqual([]);
    expect(h.sleeps.length).toBe(6);
  });

  test("a pull or a check that throws does not end the loop", async () => {
    let n = 0;
    const h = harness([{ woke: true, cursor: 1 }, { woke: true, cursor: 2 }], {
      active: () => {
        if (n++ === 1) throw new Error("settings are unreadable");
        return true;
      },
      pull: async () => {
        throw new Error("boom");
      },
    });
    await h.handle.done;
    expect(h.events.filter((e) => e.startsWith("wait"))).toEqual(["wait 0", "wait 1", "wait 2"]);
  });

  test("a poke while the loop is reading its settings is not lost", async () => {
    let poked = false;
    const started = Date.now();
    const handle = startSupportLoop({
      kind: "status",
      active: () => true,
      relay: async () => {
        if (poked) {
          handle.stop();
          return null;
        }
        await Bun.sleep(1);
        poked = true;
        handle.poke();
        return null;
      },
      pull: async () => {},
      log: { warn() {}, info() {} } as unknown as SupportLoopDeps["log"],
    });
    await handle.done;
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test("a poke ends an idle sleep at once", async () => {
    let active = false;
    const events: string[] = [];
    const relay = {
      wait: async (_k: string, _s: number, signal: AbortSignal) => new Promise<Wait>((r) => signal.addEventListener("abort", () => r(null), { once: true })),
    } as unknown as SupportRelay;
    const handle = startSupportLoop({
      kind: "status",
      active: () => active,
      relay: async () => relay,
      pull: async () => {
        events.push("pull");
        handle.stop();
      },
      log: { warn() {}, info() {} } as unknown as SupportLoopDeps["log"],
    });
    await Bun.sleep(5);
    active = true;
    handle.poke();
    await handle.done;
    expect(events).toEqual(["pull"]);
  });
});
