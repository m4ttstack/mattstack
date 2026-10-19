import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import { startTelemetry, telemetrySuppressed } from "../start.ts";
import type { TickDeps } from "../tick.ts";

const MAIN = "/usr/local/bin/rt";

describe("telemetrySuppressed", () => {
  test("a plain daemon environment is not suppressed", () => {
    expect(telemetrySuppressed({}, MAIN)).toBe(false);
    expect(telemetrySuppressed({ CI: "" }, MAIN)).toBe(false);
  });

  test.each([
    ["CI set (an e2e-spawned compiled daemon)", { CI: "true" }, MAIN],
    ["NODE_ENV=test", { NODE_ENV: "test" }, MAIN],
    ["VITEST set", { VITEST: "1" }, MAIN],
    ["a test file as entry module", {}, "/repo/lib/daemon/__tests__/boot-order.test.ts"],
  ])("%s is suppressed", (_name, env, main) => {
    expect(telemetrySuppressed(env, main)).toBe(true);
  });
});

describe("startTelemetry", () => {
  function deps() {
    const calls = { enabled: 0, collect: 0, post: 0 };
    const d: TickDeps = {
      enabled: () => (calls.enabled++, true),
      versions: async () => ({ appVersion: null, rtVersion: "1" }),
      collect: async () => (calls.collect++, {} as never),
      token: async () => null,
      post: async () => (calls.post++, 200),
      url: () => "https://relay.test/telemetry/ping",
      now: () => 0,
      log: {} as Logger,
    };
    return { d, calls };
  }

  test("under CI it schedules nothing and sends nothing", async () => {
    const { d, calls } = deps();
    expect(startTelemetry(d, {} as Logger, { CI: "true" }, MAIN)).toBeNull();
    await Bun.sleep(10);
    expect(calls).toEqual({ enabled: 0, collect: 0, post: 0 });
  });

  test("outside a test run it pings once at start and returns the interval", async () => {
    const { d, calls } = deps();
    const handle = startTelemetry(d, {} as Logger, {}, MAIN);
    try {
      expect(handle).not.toBeNull();
      await Bun.sleep(10);
      expect(calls.post).toBe(1);
    } finally {
      if (handle) clearInterval(handle);
    }
  });
});
