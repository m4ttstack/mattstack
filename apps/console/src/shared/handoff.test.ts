import type { GateRow } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import { isHandoffGate, waitingHandoff } from './handoff';

const g = (
  id: string,
  subject: string,
  kind: string,
  status: string,
  openedAt: number
): GateRow => ({ id, subject, kind, status, openedAt }) as unknown as GateRow;

describe('handoff gates', () => {
  it('are the board-owned kinds on mr: subjects', () => {
    expect(
      isHandoffGate(g('a', 'mr:acme/web!1', 'review-post', 'open', 0))
    ).toBe(true);
    expect(isHandoffGate(g('b', 'run:r1', 'review-post', 'open', 0))).toBe(
      false
    );
    expect(isHandoffGate(g('c', 'mr:acme/web!1', 'plan', 'open', 0))).toBe(
      false
    );
  });

  it('picks the oldest one still waiting', () => {
    const gates = [
      g('answered', 'mr:x!1', 'review-post', 'answered', 0),
      g('newer', 'mr:x!1', 'respond-post', 'parked', 20),
      g('older', 'mr:x!1', 'respond-plan', 'open', 10),
    ];
    expect(waitingHandoff(gates)?.id).toBe('older');
    expect(waitingHandoff([gates[0]!])).toBeNull();
  });
});
