import { describe, expect, test } from 'vitest';

import {
  answeredGateSummary,
  type GateSummaryInput,
} from '@mattstack/gate-kit';
import type { GateQuestion } from '@mattstack/rt-client';

const QUESTIONS: GateQuestion[] = [
  { id: 'tiers', label: 'Post which findings?', multi: true, options: [] },
  {
    id: 'outcome',
    label: 'Verdict',
    multi: false,
    options: ['comment', 'approve'],
  },
];

const row = (
  answers: Record<string, unknown>,
  questions: GateQuestion[] = QUESTIONS
): GateSummaryInput => ({
  kind: 'review',
  status: 'answered',
  questions,
  answer: { answers: answers as never, by: 'pane', answeredAt: 1 },
});

describe('answeredGateSummary run controls', () => {
  test('hold names the pause, never (none)', () => {
    const s = answeredGateSummary(row({ next: 'hold' }));
    expect(s.chip).toContain('Paused the run');
    expect(s.outcome).toBe('Paused the run');
    expect(JSON.stringify(s.detail)).toContain('Paused the run');
    expect(JSON.stringify(s)).not.toContain('(none)');
  });

  test('a wrapped hold names the pause', () => {
    const s = answeredGateSummary(
      row({ next: { value: 'hold', note: 'later' } })
    );
    expect(s.chip).toContain('Paused the run');
  });

  test('go-back names the stage', () => {
    const s = answeredGateSummary(row({ next: 'go-back', to: 'plan' }));
    expect(s.chip).toContain('Went back to plan');
    expect(s.outcome).toBe('Went back to plan');
    expect(JSON.stringify(s)).not.toContain('(none)');
  });

  const PAIRS: GateQuestion[] = [
    {
      id: 'thread-1',
      label: 'Thread 1',
      multi: true,
      options: ['post:thread-1', 'resolve:thread-1'],
    },
    {
      id: 'thread-2',
      label: 'Thread 2',
      multi: true,
      options: ['post:thread-2', 'resolve:thread-2'],
    },
  ];

  test('a run control on a post-pair gate with no pair answered tallies no posting', () => {
    const s = answeredGateSummary(row({ next: 'hold' }, PAIRS));
    expect(s.chip).toContain('Paused the run');
    expect(s.chip).not.toMatch(/posted|held/);
    const back = answeredGateSummary(
      row({ next: 'go-back', to: 'plan' }, PAIRS)
    );
    expect(back.chip).not.toMatch(/posted|held/);
  });

  test('a run control keeps the tally of the pairs that were answered', () => {
    const s = answeredGateSummary(
      row({ next: 'hold', 'thread-1': ['post:thread-1'] }, PAIRS)
    );
    expect(s.chip).toContain('Paused the run');
    expect(s.chip).toContain('1 posted');
    expect(s.chip).not.toContain('held');
  });

  test('a gate with its own next question is not a run control', () => {
    const s = answeredGateSummary(
      row({ next: 'hold' }, [
        { id: 'next', label: 'Next', multi: false, options: ['hold', 'go'] },
      ])
    );
    expect(s.chip).not.toContain('Paused the run');
  });
});
