import { test, expect } from "bun:test";
import { DRAIN_CAP_MS, drainSocket } from "../drain.ts";
import { createSocketAvailability } from "../socket-availability.ts";

function serving(inFlight: number) {
  const availability = createSocketAvailability();
  availability.state = "serving";
  availability.inFlight = inFlight;
  return availability;
}

/** A clock that only moves when the fake sleep is called. */
function fakeClock(onSleep?: (calls: number) => void) {
  let t = 0;
  let calls = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    sleep: async (ms: number) => { t += ms; calls++; sleeps.push(ms); onSleep?.(calls); },
  };
}

test("the drain cap is 5 seconds", () => {
  expect(DRAIN_CAP_MS).toBe(5_000);
});

test("sets state to stopping before anything else", async () => {
  const availability = serving(0);
  const seen: string[] = [];
  const clock = fakeClock();
  await drainSocket(availability, { settleWaiters: () => { seen.push(availability.state); }, ...clock });
  expect(seen).toEqual(["stopping"]);
  expect(availability.state).toBe("stopping");
});

test("calls settleWaiters once, after state is stopping", async () => {
  const availability = serving(1);
  let settled = 0;
  const clock = fakeClock(() => { availability.inFlight = 0; });
  await drainSocket(availability, {
    settleWaiters: () => { settled++; expect(availability.state).toBe("stopping"); },
    ...clock,
  });
  expect(settled).toBe(1);
});

test("returns { drained: true, left: 0 } as soon as inFlight reaches 0", async () => {
  const availability = serving(2);
  const clock = fakeClock((calls) => { if (calls === 2) availability.inFlight = 0; });
  const result = await drainSocket(availability, { settleWaiters: () => {}, ...clock });
  expect(result).toEqual({ drained: true, left: 0 });
  expect(clock.sleeps).toEqual([50, 50]);
});

test("gives up at the cap: returns { drained: false, left: 1 } once now() passes 5_000ms", async () => {
  const availability = serving(1);
  const clock = fakeClock();
  const result = await drainSocket(availability, { settleWaiters: () => {}, ...clock });
  expect(result).toEqual({ drained: false, left: 1 });
  expect(clock.now()).toBe(5_000);
});

test("honours a shorter capMs", async () => {
  const availability = serving(3);
  const clock = fakeClock();
  const result = await drainSocket(availability, { settleWaiters: () => {}, ...clock, capMs: 200 });
  expect(result).toEqual({ drained: false, left: 3 });
  expect(clock.now()).toBe(200);
});

test("returns at once when nothing is in flight", async () => {
  const availability = serving(0);
  const clock = fakeClock();
  const result = await drainSocket(availability, { settleWaiters: () => {}, ...clock });
  expect(result).toEqual({ drained: true, left: 0 });
  expect(clock.sleeps).toEqual([]);
});

test("a settleWaiters that throws does not stop the drain", async () => {
  const availability = serving(0);
  const clock = fakeClock();
  const result = await drainSocket(availability, { settleWaiters: () => { throw new Error("db closed"); }, ...clock });
  expect(result).toEqual({ drained: true, left: 0 });
  expect(availability.state).toBe("stopping");
});
