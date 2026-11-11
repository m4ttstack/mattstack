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
    byBilling: { metered: totals(0), plan: totals(0), unknown: totals(1) },
    accounts: [],
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

const STAGE = {
  attempt: 1,
  outside: null,
  status: 'done',
  startedAt: 1,
  endedAt: 2,
  firstActivity: 1,
  lastActivity: 2,
  subagentCost: 0,
  totals: totals(1),
};

describe('stepRows', () => {
  it('lists a work run with its stages under it', () => {
    const stage = {
      attempt: 1,
      status: 'done',
      outside: null,
      startedAt: 1,
      endedAt: 2,
      firstActivity: 1,
      lastActivity: 2,
      subagentCost: 0,
      totals: totals(1),
    };
    expect(
      labels([
        entry('work', {
          stages: [
            { ...stage, name: 'plan' },
            { ...stage, name: 'implement', attempt: 2 },
            { ...stage, name: null, attempt: null, outside: 'after' },
          ],
        }),
      ])
    ).toEqual([
      'Work run',
      'plan',
      'implement (attempt 2)',
      'After the last stage',
    ]);
  });

  it('says when messages outside the stages ran, and how much was subagents', () => {
    const thisYear = new Date().getFullYear();
    const outside = {
      name: null,
      attempt: null,
      outside: 'between',
      status: null,
      startedAt: null,
      endedAt: null,
      firstActivity: new Date(thisYear, 9, 9).getTime(),
      lastActivity: new Date(thisYear, 9, 10).getTime(),
      subagentCost: 1,
      totals: { ...totals(1), cost: 2 },
    } as const;
    const [, step] = stepRows(mr([entry('work', { stages: [outside] })]));
    expect(step).toMatchObject({
      label: 'Between stages',
      note: 'Oct 9 to Oct 10, 50% subagents',
    });
  });

  it('names the stage or window a row reads its activity from', () => {
    const rows = stepRows(
      mr([
        entry('work', {
          runId: 'r',
          stages: [
            { ...STAGE, name: 'ship', attempt: 2 },
            { ...STAGE, name: null, attempt: null, outside: 'after' },
          ],
        }),
      ])
    );
    expect(
      rows.map(row => (row.type === 'step' ? row.activity : null))
    ).toEqual([
      { runId: 'r' },
      { runId: 'r', stage: 'ship', attempt: 2 },
      { runId: 'r', outside: 'after' },
    ]);
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

  it('shows a run’s session outside the run under any run, marked not counted', () => {
    const session = {
      ...STAGE,
      name: null,
      attempt: null,
      outside: 'session' as const,
      status: null,
      totals: totals(1500),
    };
    const rows = stepRows(
      mr([
        entry('other', { pipeline: 'watch-ci', stages: [session] }),
        entry('work', {
          stages: [{ ...STAGE, name: 'build' }, session],
        }),
      ])
    );
    expect(
      rows.map(row => [
        row.label,
        row.type === 'step' ? (row.uncounted ?? false) : null,
      ])
    ).toEqual([
      ['watch-ci', false],
      ['Same session, outside the run', true],
      ['Work run', false],
      ['build', false],
      ['Same session, outside the run', true],
    ]);
    const outside = rows[1]!;
    expect(outside.type === 'step' && outside.activity).toEqual({
      runId: 'run-other',
      outside: 'session',
    });
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
