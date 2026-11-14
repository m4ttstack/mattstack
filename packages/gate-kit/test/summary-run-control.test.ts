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

  test('a gate with its own next question is not a run control', () => {
    const s = answeredGateSummary(
      row({ next: 'hold' }, [
        { id: 'next', label: 'Next', multi: false, options: ['hold', 'go'] },
      ])
    );
    expect(s.chip).not.toContain('Paused the run');
  });
});
