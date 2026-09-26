import { describe, expect, test } from "bun:test";
import type { IndicatorTarget } from "../indicator-refresh.ts";
import { INITIAL_DELAY_MS, IndicatorUpdater, REFRESH_INTERVAL_MS } from "../indicator-updater.ts";

const SKEW = 1_000;

function harness(initial: IndicatorTarget[]) {
  let targets = initial;
  let now = 0;
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const started: string[] = [];
  const pending: (() => void)[] = [];
  let passStarts = 0;
  const updater = new IndicatorUpdater({
    targets: () => targets,
    refreshOne: (t) => {
      started.push(t.id);
      return new Promise<void>((resolve) => { pending.push(resolve); });
    },
    onPassStart: () => { passStarts++; },
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (h) => { (h as { cleared: boolean }).cleared = true; },
    now: () => now,
    skewMs: SKEW,
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return {
    updater, timers, started, pending, flush,
    setTargets: (t: IndicatorTarget[]) => { targets = t; },
    setNow: (n: number) => { now = n; },
    passStarts: () => passStarts,
    finishNext: async () => { pending.shift()!(); await flush(); },
  };
}

const A = { id: "a", path: "/a" };
const B = { id: "b", path: "/b" };
const C = { id: "c", path: "/c" };

describe("IndicatorUpdater", () => {
  test("first pass waits the initial delay plus skew", async () => {
    const h = harness([A]);
    h.updater.start();
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]!.ms).toBe(INITIAL_DELAY_MS + SKEW);
    expect(h.started).toEqual([]);
  });

  test("refreshes one repo at a time, in order", async () => {
    const h = harness([A, B]);
    h.updater.start();
    h.timers[0]!.fn();
    await h.flush();
    expect(h.started).toEqual(["a"]);
    await h.finishNext();
    expect(h.started).toEqual(["a", "b"]);
    expect(h.passStarts()).toBe(1);
  });

  test("schedules the next pass one interval after the last pass started", async () => {
    const h = harness([A]);
    h.updater.start();
    h.setNow(500);
    h.timers[0]!.fn();
    await h.flush();
    h.setNow(2_500);
    await h.finishNext();
    expect(h.timers).toHaveLength(2);
    expect(h.timers[1]!.ms).toBe(REFRESH_INTERVAL_MS - 2_000 + SKEW);
  });

  test("targets are re-read per repo", async () => {
    const h = harness([A, B, C]);
    h.updater.start();
    h.timers[0]!.fn();
    await h.flush();
    h.setTargets([A, C]);
    await h.finishNext();
    expect(h.started).toEqual(["a", "c"]);
  });

  test("pause holds the pass between repos; resume continues it", async () => {
    const h = harness([A, B]);
    h.updater.start();
    h.timers[0]!.fn();
    await h.flush();
    h.updater.pause();
    await h.finishNext();
    expect(h.started).toEqual(["a"]);
    h.updater.resume();
    await h.flush();
    expect(h.started).toEqual(["a", "b"]);
  });

  test("a pass whose timer fires while paused waits for resume", async () => {
    const h = harness([A]);
    h.updater.start();
    h.updater.pause();
    h.timers[0]!.fn();
    await h.flush();
    expect(h.started).toEqual([]);
    h.updater.resume();
    await h.flush();
    expect(h.started).toEqual(["a"]);
  });

  test("stop clears the timer and ends a paused pass without refreshing more", async () => {
    const h = harness([A, B]);
    h.updater.start();
    h.timers[0]!.fn();
    await h.flush();
    h.updater.pause();
    h.updater.stop();
    await h.finishNext();
    expect(h.started).toEqual(["a"]);
    expect(h.timers.filter((t) => !t.cleared)).toHaveLength(1);
    expect(h.timers).toHaveLength(1);
  });

  test("a refresh that throws does not end the pass", async () => {
    const started: string[] = [];
    const timers: (() => void)[] = [];
    const updater = new IndicatorUpdater({
      targets: () => [A, B],
      refreshOne: async (t) => { started.push(t.id); if (t.id === "a") throw new Error("boom"); },
      setTimer: (fn) => { timers.push(fn); return fn; },
      clearTimer: () => {},
      now: () => 0,
      skewMs: 0,
    });
    updater.start();
    timers[0]!();
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual(["a", "b"]);
  });
});
