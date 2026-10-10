import '../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { GateRow } from '@mattstack/rt-client';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { GateRecordView } from './GateRecord';

const gate = (over: Partial<GateRow>): GateRow =>
  ({
    id: 'g1',
    subject: 'run:r1',
    kind: 'plan',
    questions: [],
    meta: null,
    context: null,
    origin: null,
    status: 'answered',
    answer: null,
    openedAt: 1,
    parkedAt: null,
    closedAt: null,
    closedReason: null,
    supersededBy: null,
    agent: null,
    pane: null,
    nudge: null,
    ...over,
  }) as GateRow;

const answered = (answers: Record<string, unknown>) => ({
  answers: answers as never,
  by: 'pane',
  answeredAt: Date.UTC(2026, 9, 9, 14, 0),
});

describe('GateRecordView', () => {
  it('draws a review post as its verdict and findings', () => {
    renderWithProviders(
      <GateRecordView
        gate={gate({
          kind: 'review-post',
          questions: [
            {
              id: 'findings-1',
              label: 'Post which findings to !12?',
              multi: true,
              options: ['f1', 'f2'],
              context: JSON.stringify({
                'gate-ctx': 'findings@1',
                findings: [
                  {
                    id: 'f1',
                    severity: 'critical',
                    title: 'Totals skip the discount',
                  },
                  { id: 'f2', severity: 'minor', title: 'Name reads oddly' },
                ],
              }),
            },
            {
              id: 'outcome',
              label: 'Verdict on !12: ready once totals round late',
              multi: false,
              options: ['comment', 'approve'],
            },
          ],
          answer: answered({ 'findings-1': ['f1'], outcome: 'comment' }),
        })}
      />
    );
    expect(
      screen.getByText('Ready once totals round late')
    ).toBeInTheDocument();
    expect(screen.getByText('1 of 2 posted')).toBeInTheDocument();
    expect(screen.getByText('Not posted')).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });

  it('folds the Then? move into the stamp and leads with the agent summary', () => {
    renderWithProviders(
      <GateRecordView
        gate={gate({
          kind: 'mark-ready',
          context: 'Pipeline green for head abc1234.',
          questions: [
            {
              id: 'ready',
              label: 'Mark it ready?',
              multi: false,
              options: ['yes', 'no'],
            },
            {
              id: 'next',
              label: 'Then?',
              multi: false,
              options: ['proceed', 'hold'],
            },
          ],
          answer: answered({ ready: 'yes', next: 'proceed' }),
        })}
      />
    );
    expect(screen.getByText('What the agent found')).toBeInTheDocument();
    expect(
      screen.getByText('Pipeline green for head abc1234.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Then?')).toBeNull();
    expect(screen.getByText('proceed')).toBeInTheDocument();
    expect(screen.getByText('yes').closest('[data-picked]')).not.toBeNull();
  });

  it('marks an escalation and says why a closed gate ended', () => {
    renderWithProviders(
      <GateRecordView
        gate={gate({
          kind: 'review-escalation',
          status: 'closed',
          closedReason: 'abandoned',
          context: 'The comment was refused twice.',
          questions: [
            {
              id: 'action',
              label: 'What now?',
              multi: false,
              options: ['take', 'hold'],
            },
          ],
        })}
      />
    );
    expect(screen.getByText('The agent hit a wall')).toBeInTheDocument();
    expect(screen.getByText('Closed: abandoned')).toBeInTheDocument();
  });
});
