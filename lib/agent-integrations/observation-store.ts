/**
 * The shared observation store: the newest normalized observation of each
 * bound session, keyed by binding key, as polled by the agent-status poller
 * or reported by a harness that pushes its own state. Supervision reads it
 * for every harness.
 *
 * In memory by design: an observation is only evidence while it is fresh, so
 * nothing older than a daemon restart is worth keeping. An observation never
 * replaces one from a later attachment generation, nor a newer one of the
 * same generation, so a late reading of a predecessor cannot overwrite what
 * the current attachment reported.
 */

import type { Observation } from "../../packages/rt-client/src/agent-integrations.ts";

const latest = new Map<string, Observation>();

export function recordObservation(bindingKey: string, observation: Observation): void {
  const held = latest.get(bindingKey);
  if (held && (held.generation > observation.generation
    || (held.generation === observation.generation && held.observedAt > observation.observedAt))) return;
  latest.set(bindingKey, observation);
}

export function latestObservation(bindingKey: string): Observation | null {
  return latest.get(bindingKey) ?? null;
}

export const __test__ = { reset: (): void => latest.clear() };
