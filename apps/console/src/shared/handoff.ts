import type { GateRow } from '@mattstack/rt-client';

import { isWaiting } from './gate-waiting';

/** The review and respond gates the board answers: their structured contexts
    and edited replies live there, so the console hands them off. */
export const HANDOFF_KINDS: ReadonlySet<string> = new Set([
  'review-post',
  'respond-plan',
  'respond-post',
]);

export function isHandoffGate(g: GateRow): boolean {
  return g.subject.startsWith('mr:') && HANDOFF_KINDS.has(g.kind);
}

/** The oldest hand-off gate still waiting on the board, or null. */
export function waitingHandoff(gates: GateRow[]): GateRow | null {
  return (
    gates
      .filter(g => isHandoffGate(g) && isWaiting(g))
      .sort((a, b) => a.openedAt - b.openedAt)[0] ?? null
  );
}
