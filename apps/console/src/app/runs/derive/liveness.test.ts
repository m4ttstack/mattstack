import type { GateRow, RunSummary } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import { heroLiveness } from './liveness';

const MIN = 60_000;

const run = (over: Partial<RunSummary> = {}): RunSummary =>
  ({
    id: 'r1',
    status: 'running',
    ended_at: null,
    attention: { needs: false, reason: null, evidence: '' },
    agent: null,
    ...over,
  }) as RunSummary;
const gate = (openedAt: number) => ({ openedAt }) as GateRow;

describe('heroLiveness', () => {
  it('says how long a gate has waited on you', () => {
    expect(
      heroLiveness(run(), { handoff: null, mine: gate(0) }, 4 * MIN)
    ).toEqual({ tone: 'bad', label: 'waiting on you · 4m' });
  });

  it('says how long a hand-off has waited in the board', () => {
    expect(
      heroLiveness(run(), { handoff: gate(0), mine: null }, 2 * MIN)
    ).toEqual({ tone: 'warn', label: 'waiting in the board · 2m' });
  });

  it('reads a working agent as agent working', () => {
    expect(
      heroLiveness(
        run({ agent: { status: 'working', pane: 'p' } }),
        { handoff: null, mine: null },
        0
      )
    ).toEqual({ tone: 'ok', label: 'agent working' });
  });

  it('reads a run with no agent as running', () => {
    expect(heroLiveness(run(), { handoff: null, mine: null }, 0)).toEqual({
      tone: 'accent',
      label: 'running',
    });
  });

  it('keeps a stale run on its first piece of evidence', () => {
    expect(
      heroLiveness(
        run({
          attention: {
            needs: true,
            reason: 'stale',
            evidence: 'no pane, no event for 3h',
          },
        }),
        { handoff: null, mine: null },
        0
      )
    ).toEqual({ tone: 'bad', label: 'stale · no pane' });
  });
});
