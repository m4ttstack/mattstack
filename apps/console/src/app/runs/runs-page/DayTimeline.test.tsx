import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { GateRow, RunSummary } from '@mattstack/rt-client';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import '../../icons';

import { dayAxis, type DayRow } from '../derive/day';
import { DayTimeline } from './DayTimeline';
import { DecisionsToday } from './DecisionsToday';

const NOW = new Date(2026, 9, 8, 16, 23).getTime();
const at = (h: number, m = 0) => new Date(2026, 9, 8, h, m).getTime();

const row: DayRow = {
  run: { id: 'r', repo: 'remote:acme%2Fweb', ticket: 'WEB-1' } as RunSummary,
  sub: { text: 'plan · waiting on you', waiting: true },
  bars: [
    { kind: 'done', from: at(9), to: at(10), stages: ['plan'], gates: [] },
    { kind: 'you', from: at(10), to: at(10, 1), stages: ['plan'], gates: [] },
  ],
};

function renderTimeline(rows: DayRow[], loading = false) {
  return renderWithProviders(
    <DayTimeline
      rows={rows}
      axis={dayAxis(rows, '2026-10-08', NOW)}
      youMs={60_000}
      isToday
      loading={loading}
      titleOf={() => 'A title'}
    />
  );
}

describe('DayTimeline', () => {
  it('keeps a one-minute wait on the axis, reachable by keyboard', () => {
    renderTimeline([row]);
    const bars = screen.getAllByTestId('timeline-bar');
    expect(bars.map(b => b.dataset.kind)).toEqual(['done', 'you']);
    expect(bars[1]).toHaveAttribute('tabindex', '0');
    expect(bars[1]).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/^plan · waiting on you · 10:00 AM to 10:01 AM$/)
    );
    expect(screen.getByRole('img', { name: /^plan · waiting on you/ })).toBe(
      bars[1]
    );
  });

  it('opens a card on hover or focus with the stage, span and gate pick', async () => {
    const gate = {
      id: 'g',
      subject: 'run:r',
      kind: 'plan',
      status: 'answered',
      openedAt: at(10),
      questions: [
        {
          id: 'q',
          label: 'Which approach?',
          multi: false,
          options: [{ value: 'a', label: 'Backend first' }],
        },
      ],
      answer: { answers: { q: 'a' }, by: 'console', answeredAt: at(10, 1) },
    } as unknown as GateRow;
    renderTimeline([
      { ...row, bars: [row.bars[0]!, { ...row.bars[1]!, gates: [gate] }] },
    ]);
    const [done, waiting] = screen.getAllByTestId('timeline-bar');

    await userEvent.hover(waiting!);
    const card = await screen.findByTestId('bar-card');
    expect(card).toHaveTextContent('plan · waiting on you');
    expect(card).toHaveTextContent('10:00 AM → 10:01 AM · 1m');
    expect(card).toHaveTextContent(
      'Gate: Which approach? You picked Backend first.'
    );
    await userEvent.unhover(waiting!);
    await waitFor(() => expect(screen.queryByTestId('bar-card')).toBeNull());

    act(() => done!.focus());
    expect(await screen.findByTestId('bar-card')).toHaveTextContent(
      'plan · stage done'
    );
    expect(screen.getByTestId('bar-card')).not.toHaveTextContent('Gate:');
  });

  it('counts the questions you answered today, not the gates', () => {
    const gate = {
      id: 'g',
      subject: 'run:r',
      kind: 'plan',
      status: 'answered',
      openedAt: at(10),
      questions: [
        { id: 'q', label: 'Approach?', multi: false, options: [] },
        { id: 'r', label: 'Scope?', multi: false, options: [] },
      ],
      answer: {
        answers: { q: 'a', r: 'b' },
        by: 'console',
        answeredAt: at(10, 1),
      },
    } as unknown as GateRow;
    renderWithProviders(
      <DecisionsToday
        decisions={[{ gate, run: row.run }]}
        isToday
        loading={false}
      />
    );
    expect(screen.getByTestId('decisions-today')).toHaveTextContent(
      'Decisions you made today · 2'
    );
  });

  it('says it is loading before the runs land, not that none ran', () => {
    renderTimeline([], true);
    expect(screen.getByTestId('timeline-loading')).toBeInTheDocument();
    expect(screen.queryByText(/No runs were active/)).toBeNull();
    expect(screen.queryByText(/waiting for you:/)).toBeNull();
  });
});
