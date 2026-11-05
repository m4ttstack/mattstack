import type {
  UsageKind,
  UsageMrData,
  UsageMrEntry,
  UsageTotals,
} from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import { stepRows } from './steps';

const totals = (cost: number): UsageTotals => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  messages: 1,
  cost,
  unpricedTokens: 0,
});

function entry(
  kind: UsageKind,
  over: Partial<UsageMrEntry> = {}
): UsageMrEntry {
  return {
    runId: `run-${kind}`,
    sessionId: null,
    kind,
    round: null,
    pipeline: kind,
    status: 'done',
    startedAt: 1,
    endedAt: 2,
    firstActivity: 1,
    lastActivity: 2,
    totals: totals(1),
    byModel: [],
    main: totals(1),
    subagent: totals(0),
    stages: [],
    ...over,
  };
}

const mr = (runs: UsageMrEntry[]) => ({ runs }) as UsageMrData;
const labels = (runs: UsageMrEntry[]) =>
  stepRows(mr(runs)).map(row => row.label);

describe('stepRows', () => {
  it('lists a work run with its stages under it', () => {
    const stage = {
      attempt: 1,
      status: 'done',
      startedAt: 1,
      endedAt: 2,
      totals: totals(1),
    };
    expect(
      labels([
        entry('work', {
          stages: [
            { ...stage, name: 'plan' },
            { ...stage, name: 'implement', attempt: 2 },
            { ...stage, name: null, attempt: null },
          ],
        }),
      ])
    ).toEqual(['Work run', 'plan', 'implement (attempt 2)', 'Outside stages']);
  });

  it('shows the teammate review a round answers, then the response', () => {
    const rows = stepRows(mr([entry('respond', { round: 2 })]));
    expect(rows.map(row => [row.type, row.label])).toEqual([
      ['step', 'Round 2'],
      ['elsewhere', 'Teammate review'],
      ['step', 'Your response'],
    ]);
  });

  it('keeps review, doctor and other runs to one row', () => {
    expect(
      labels([
        entry('review'),
        entry('doctor', { runId: null, sessionId: 's-1', pipeline: null }),
        entry('other', { pipeline: 'ship' }),
      ])
    ).toEqual(['Your review', 'Doctor', 'ship']);
  });

  it('gives two run-less sessions their own keys', () => {
    const rows = stepRows(
      mr([
        entry('doctor', { runId: null, sessionId: 's-1' }),
        entry('doctor', { runId: null, sessionId: 's-2' }),
      ])
    );
    expect(new Set(rows.map(row => row.key)).size).toBe(2);
  });
});
