import { describe, expect, test } from "bun:test";
import { startLoopLagMonitor } from "../loop-lag.ts";

function harness(thresholdMs = 2_000) {
  let clock = 0;
  let tick: (() => void) | undefined;
  const warned: Array<{ context: Record<string, unknown>; message: string }> = [];
  const stop = startLoopLagMonitor({
    intervalMs: 1_000,
    thresholdMs,
    now: () => clock,
    setInterval: (fn) => { tick = fn; return 1; },
    clearInterval: () => { tick = undefined; },
    log: { warn: (context, message) => warned.push({ context, message }) },
  });
  return {
    warned,
    stop,
    elapse(ms: number) { clock += ms; tick?.(); },
  };
}

describe("startLoopLagMonitor", () => {
  test("a tick on time logs nothing", () => {
    const h = harness();
    h.elapse(1_000);
    h.elapse(1_050);
    expect(h.warned).toEqual([]);
  });

  test("a tick that arrives late past the threshold logs how long the loop was blocked", () => {
    const h = harness();
    h.elapse(1_000);
    h.elapse(61_000);
    expect(h.warned).toEqual([{ context: { lagMs: 60_000 }, message: "daemon event loop was blocked" }]);
  });

  test("stop ends the ticks", () => {
    const h = harness();
    h.stop();
    h.elapse(61_000);
    expect(h.warned).toEqual([]);
  });
});
