import { eventsHead } from "./client.ts";
import type { RtClientOptions } from "./transport.ts";

/**
 * A daemon-down result is a successful probe, not a failure of this call —
 * eventsHead already never throws (transport.ts degrades every fetch to
 * `{ ok: false, error }`), so this only reshapes that envelope for callers
 * who want a boolean, not `{ ok, data, error }`.
 */
export async function daemonHealth(
  opts: RtClientOptions = {},
): Promise<{ reachable: boolean; error?: string }> {
  // No retry: this is polled to say whether the daemon is there right now.
  const res = await eventsHead({ ...opts, retryBudgetMs: opts.retryBudgetMs ?? 0 });
  return { reachable: res.ok, error: res.ok ? undefined : res.error };
}
