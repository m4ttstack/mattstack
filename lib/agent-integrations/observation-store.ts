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
 * the current attachment reported. A session's own report (a push) outranks
 * a poll of the same generation until the push goes stale: the session knows
 * its state better than a reading of its screen.
 */

import type { Observation } from "../../packages/rt-client/src/agent-integrations.ts";

/**
 * How long an observation stays evidence. The poller refreshes every bound
 * session far more often than this and the watchdog sweeps about once a
 * minute, so a reading this old means its source stopped reporting, not that
 * the worker's state is still what it said.
 */
export const STALE_OBSERVATION_MS = 2 * 60_000;

/** `push` is the session's own report of itself; `poll` is rt reading it from outside. */
export type ObservationOrigin = "poll" | "push";

const latest = new Map<string, { observation: Observation; origin: ObservationOrigin }>();
/**
 * Each binding's last pushed death, kept apart from `latest`: the end that
 * reports it also detaches the binding, and the detached generation's own
 * readings must not erase what the ended generation's session said.
 */
const deaths = new Map<string, Observation>();

export function recordObservation(bindingKey: string, observation: Observation, origin: ObservationOrigin = "poll"): void {
  if (origin === "push" && observation.execution === "dead") deaths.set(bindingKey, observation);
  const held = latest.get(bindingKey);
  if (held) {
    const h = held.observation;
    if (h.generation > observation.generation) return;
    if (h.generation === observation.generation) {
      if (h.observedAt > observation.observedAt) return;
      // A prompt the session cannot report itself (trust, relocation, permission) must not wait out the push.
      const pushHolds = held.origin === "push" && origin === "poll" && observation.execution !== "blocked";
      if (pushHolds && observation.observedAt - h.observedAt <= STALE_OBSERVATION_MS) return;
    }
  }
  latest.set(bindingKey, { observation, origin });
}

export function latestObservation(bindingKey: string): Observation | null {
  return latest.get(bindingKey)?.observation ?? null;
}

/** The session's own report that it ended at `generation`, or null. */
export function pushedDeath(bindingKey: string, generation: number): Observation | null {
  const death = deaths.get(bindingKey);
  return death && death.generation === generation ? death : null;
}

export const __test__ = { reset: (): void => { latest.clear(); deaths.clear(); } };
