import type { UsageWeekRow } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import { fillWeeks } from './WeeklyChart';

const week = (weekStart: number, cost: number) =>
  ({ weekStart, totals: { cost }, byKind: {} }) as UsageWeekRow;

describe('fillWeeks', () => {
  it('draws a week with no usage as an empty bar', () => {
    const first = new Date(2026, 9, 5).getTime();
    const third = new Date(2026, 9, 19).getTime();
    expect(
      fillWeeks([week(first, 3), week(third, 5)]).map(w => w.cost)
    ).toEqual([3, 0, 5]);
  });

  it('keeps weeks on local Monday across a clock change', () => {
    const before = new Date(2026, 9, 26).getTime();
    const after = new Date(2026, 10, 9).getTime();
    expect(
      fillWeeks([week(before, 1), week(after, 1)]).map(w =>
        new Date(w.weekStart).getDay()
      )
    ).toEqual([1, 1, 1]);
  });

  it('has nothing to draw with no weeks', () => {
    expect(fillWeeks([])).toEqual([]);
  });
});
