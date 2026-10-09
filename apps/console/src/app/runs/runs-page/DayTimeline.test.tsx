import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { RunSummary } from '@mattstack/rt-client';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '../../icons';

import { dayAxis, type DayRow } from '../derive/day';
import { DayTimeline } from './DayTimeline';

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

  it('says it is loading before the runs land, not that none ran', () => {
    renderTimeline([], true);
    expect(screen.getByTestId('timeline-loading')).toBeInTheDocument();
    expect(screen.queryByText(/No runs were active/)).toBeNull();
    expect(screen.queryByText(/waiting for you:/)).toBeNull();
  });
});
