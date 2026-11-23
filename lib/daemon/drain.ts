/**
 * Shutdown's first step: stop taking socket requests, end the long-polls, and
 * give the requests already running a bounded time to answer before the
 * servers are force-closed.
 */

import type { SocketAvailability } from "./socket-availability.ts";

// launchd SIGKILLs the daemon 30s after SIGTERM (ExitTimeOut); the rest of
// the teardown has to fit in what this leaves.
export const DRAIN_CAP_MS = 5_000;
const POLL_MS = 50;

export async function drainSocket(
  availability: SocketAvailability,
  deps: { settleWaiters(): void; sleep(ms: number): Promise<void>; now(): number; capMs?: number },
): Promise<{ drained: boolean; left: number }> {
  availability.state = "stopping";
  // A long-poll would otherwise hold its request in flight for the whole cap.
  try { deps.settleWaiters(); } catch { /* a store that is already closed has no waiters left */ }
  const deadline = deps.now() + (deps.capMs ?? DRAIN_CAP_MS);
  while (availability.inFlight > 0 && deps.now() < deadline) {
    await deps.sleep(POLL_MS);
  }
  const left = availability.inFlight;
  // inFlight drops when a reply is built, not when it is written. The unit
  // stops that follow are synchronous and end in a force-close, so without
  // this turn of the event loop a large reply would be cut off.
  if (left === 0) await deps.sleep(POLL_MS);
  return { drained: left === 0, left };
}
