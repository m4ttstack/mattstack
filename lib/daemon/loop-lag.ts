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
  log: { warn(context: Record<string, unknown>, message: string): void };
}

export function startLoopLagMonitor(deps: LoopLagDeps): () => void {
  let last = deps.now();
  const handle = deps.setInterval(() => {
    const at = deps.now();
    const lagMs = at - last - deps.intervalMs;
    last = at;
    if (lagMs >= deps.thresholdMs) deps.log.warn({ lagMs }, "daemon event loop was blocked");
  }, deps.intervalMs);
  return () => deps.clearInterval(handle);
}
