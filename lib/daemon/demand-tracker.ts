/**
 * "A consumer is watching" signal for the background port scan. A tray/CLI/
 * console call to ports or system-processes stamps demand here (via the
 * command-router wrapper); pollers skip the 30s port scan when nothing has
 * asked recently, so an idle machine stops paying the lsof tax (S058, S093).
 * tray:status does not stamp: the tray polls it for liveness alone.
 */
let lastDemandAt = 0;

/**
 * Only the wrapped command handlers (ports / system-processes, via
 * wrapWithDemand) stamp demand. WS relay and SSE topic subscriptions do
 * not: a push-only consumer that subscribes to a broadcast topic but never
 * calls a command gets no demand credit and can starve past the demand
 * window. A subscribe-side stamp would live in api-server.ts, out of scope
 * this phase.
 */
export function recordDemand(): void {
  lastDemandAt = Date.now();
}

/** True when a consumer read a port-backed command within `ms`. */
export function demandedWithin(ms: number): boolean {
  return lastDemandAt !== 0 && Date.now() - lastDemandAt < ms;
}

/** The commands whose reads mean "someone is watching the port data". */
export const DEMAND_COMMANDS = ["ports", "system-processes"] as const;

/** Wrap the named handler entries so each call stamps demand, then delegates. */
export function wrapWithDemand<T extends Record<string, any>>(handlers: T, cmds: string[]): T {
  for (const cmd of cmds) {
    const inner = handlers[cmd];
    if (typeof inner !== "function") continue;
    (handlers as any)[cmd] = (...args: any[]) => { recordDemand(); return inner(...args); };
  }
  return handlers;
}
