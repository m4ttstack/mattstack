import { describe, expect, it } from 'vitest';

import { parseUsageSearch } from './UsagePage';
import { averageWeek } from './WeeklyChart';

describe('parseUsageSearch', () => {
  it('keeps a repo identity exact, encoded slashes included', () => {
    const repo = 'remote:github.com%2Facme%2Fwidgets';
    expect(parseUsageSearch(`?repo=${encodeURIComponent(repo)}`).repo).toBe(
      repo
    );
  });

  it('reads an unknown range as the default', () => {
    expect(parseUsageSearch('?range=abc').range).toBe(30);
    expect(parseUsageSearch('?range=0').rangeValue).toBe('30');
    expect(parseUsageSearch('?range=all').range).toBeNull();
    expect(parseUsageSearch('?range=90').range).toBe(90);
  });

  it('defaults to the MRs view', () => {
    expect(parseUsageSearch('').view).toBe('mrs');
    expect(parseUsageSearch('?view=trends').view).toBe('trends');
  });
});

describe('parseUsageSearch order', () => {
  it('defaults to the costliest first', () => {
    expect(parseUsageSearch('').order).toEqual({ sort: 'cost', dir: 'desc' });
  });

  it('reads a sort and direction', () => {
    expect(parseUsageSearch('?sort=date&dir=asc').order).toEqual({
      sort: 'date',
      dir: 'asc',
    });
  });

  it('reads an unknown sort as the default', () => {
    expect(parseUsageSearch('?sort=nope&dir=up').order).toEqual({
      sort: 'cost',
      dir: 'desc',
    });
  });
});

describe('averageWeek', () => {
  it('counts the weeks of the range, not only the weeks with usage', () => {
    expect(averageWeek(300, 30, [])).toBeCloseTo(70, 0);
  });

  it('has no average with nothing to divide by', () => {
    expect(averageWeek(0, null, [])).toBe(0);
  });
});
