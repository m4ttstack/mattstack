/**
 * Whether a bound session's herd job attempt was ended or replaced, so
 * nothing should bring its session back. herds.db belongs to the daemon,
 * which installs the reader; without one no attempt reads retired.
 */

import type { SessionBinding } from "../../packages/rt-client/src/agent-integrations.ts";

let probe: ((attemptId: string) => boolean) | undefined;

export function setRetiredAttemptProbe(next: ((attemptId: string) => boolean) | undefined): void {
  probe = next;
}

export function attemptRetired(binding: SessionBinding): boolean {
  return binding.attemptId !== undefined && probe?.(binding.attemptId) === true;
}
