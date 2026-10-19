import type { Logger } from "pino";
import { testRunSignal } from "../../packages/rt-client/src/test-isolation.ts";
import { safeInterval } from "../daemon/safe-timers.ts";
import { makeTelemetryTick, type TickDeps } from "./tick.ts";

const TICK_MS = 5 * 60_000;

/** A test run or a CI job boots real daemons on throwaway HOMEs; each would report as a new Mac. */
export function telemetrySuppressed(env: NodeJS.ProcessEnv, main: string | undefined): boolean {
  return testRunSignal(env, main) !== null || (env.CI !== undefined && env.CI !== "");
}

/** Pings once now and every five minutes; returns null, scheduling nothing, in a test run or CI. */
export function startTelemetry(deps: TickDeps, log: Logger, env: NodeJS.ProcessEnv = process.env, main: string | undefined = Bun.main): ReturnType<typeof setInterval> | null {
  if (telemetrySuppressed(env, main)) return null;
  const tick = makeTelemetryTick(deps);
  void tick();
  return safeInterval(() => void tick(), TICK_MS, "telemetry", log);
}
