/**
 * The daemon is one Bun process, so a synchronous call anywhere stalls every
 * socket request behind it, and clients see that only as a timeout. A
 * repeating timer that fires late measures the stall and logs it, so the
 * log can be lined up with the requests that timed out.
 */
export interface LoopLagDeps {
  intervalMs: number;
  thresholdMs: number;
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  log: {
    warn(context: Record<string, unknown>, message: string): void;
    info(context: Record<string, unknown>, message: string): void;
  };
}

// A gap this long is the Mac asleep, not code holding the loop; logging it
// as a stall would bury the real ones.
const SLEEP_GAP_MS = 5 * 60_000;

export function startLoopLagMonitor(deps: LoopLagDeps): () => void {
  let last = deps.now();
  const handle = deps.setInterval(() => {
    const at = deps.now();
    const gapMs = at - last;
    last = at;
    if (gapMs >= SLEEP_GAP_MS) {
      deps.log.info({ gapMs }, "daemon timers resumed after a long gap, likely sleep");
      return;
    }
    const lagMs = gapMs - deps.intervalMs;
    if (lagMs >= deps.thresholdMs) deps.log.warn({ lagMs }, "daemon event loop was blocked");
  }, deps.intervalMs);
  return () => deps.clearInterval(handle);
}
