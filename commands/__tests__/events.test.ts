import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { pollWithReconnect } from "../events.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";

type Reply = { ok: boolean; data?: any; error?: string } | null;

/** A fake daemon answering from a script, with a clock only the fake sleep moves. */
function harness(replies: Reply[]) {
  let t = 1_000;
  const sleeps: number[] = [];
  const calls: Array<{ cmd: string; payload: any }> = [];
  const deps = {
    query: (async (cmd: string, payload?: Record<string, any>) => {
      calls.push({ cmd, payload });
      return replies.length > 1 ? replies.shift()! : replies[0]!;
    }) as any,
    sleep: async (ms: number) => { sleeps.push(ms); t += ms; },
    now: () => t,
  };
  return { deps, sleeps, calls, now: () => t };
}

describe("pollWithReconnect", () => {
  let io: ReturnType<typeof captureOut>;
  beforeEach(() => { io = captureOut(); });
  afterEach(() => { io.restore(); });

  const answer = { ok: true, data: { events: [{ id: 7 }], cursor: 7 } };

  test("an answer is returned as is, with no sleep and no diagnostic", async () => {
    const h = harness([answer]);
    expect(await pollWithReconnect("job/*", 3, 240_000, null, h.deps)).toEqual({ events: [{ id: 7 }], cursor: 7 });
    expect(h.calls).toEqual([{ cmd: "events:wait", payload: { pattern: "job/*", after: 3, waitMs: 240_000 } }]);
    expect(h.sleeps).toEqual([]);
    expect(io.stderr()).toBe("");
  });

  test("a null reply is retried and the next answer is returned", async () => {
    const h = harness([null, answer]);
    expect(await pollWithReconnect("job/*", undefined, 240_000, null, h.deps)).toEqual({ events: [{ id: 7 }], cursor: 7 });
    expect(h.calls.length).toBe(2);
  });

  test("backs off 1s, 2s, 4s, then 5s for every later retry", async () => {
    const h = harness([null, null, null, null, null, answer]);
    await pollWithReconnect("job/*", undefined, 240_000, null, h.deps);
    expect(h.sleeps).toEqual([1_000, 2_000, 4_000, 5_000, 5_000]);
  });

  test("writes one diagnostic line on the first retry only", async () => {
    const h = harness([null, null, null, answer]);
    await pollWithReconnect("job/*", undefined, 240_000, null, h.deps);
    const lines = io.stderr().split("\n").filter((l) => l.includes("rt events"));
    expect(lines).toEqual(["rt events: daemon unavailable; retrying until it is back..."]);
  });

  test("stops with { budget: true } when the deadline passes, and never sleeps past it", async () => {
    const h = harness([null]);
    const deadline = h.now() + 2_500;
    expect(await pollWithReconnect("job/*", undefined, 2_500, deadline, h.deps)).toEqual({ budget: true });
    expect(h.sleeps).toEqual([1_000, 1_500]);
    expect(h.now()).toBe(deadline);
  });

  test("a retry asks the daemon to wait no longer than what is left of the deadline", async () => {
    const h = harness([null, answer]);
    await pollWithReconnect("job/*", undefined, 10_000, h.now() + 10_000, h.deps);
    expect(h.calls.map((c) => c.payload.waitMs)).toEqual([10_000, 9_000]);
  });

  test("an ok:false reply from the daemon still fails with its error", async () => {
    const h = harness([{ ok: false, error: "bad pattern" }]);
    await expect(pollWithReconnect("[", undefined, 240_000, null, h.deps)).rejects.toThrow("bad pattern");
    expect(h.sleeps).toEqual([]);
  });
});
