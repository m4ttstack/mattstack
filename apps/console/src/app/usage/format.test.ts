import type { UsageMrRow } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import {
  compact,
  modelName,
  mrParts,
  mrSummary,
  nextMrOrder,
  shortDate,
  sortMrs,
  usageMrHref,
  usd,
} from './format';

const KEY = 'remote:github.com%2Facme%2Fwidgets!123';

function row(over: Partial<UsageMrRow>): UsageMrRow {
  return {
    costByKind: { work: 0, review: 0, respond: 0, doctor: 0, other: 0 },
    roundCount: 0,
    ...over,
  } as UsageMrRow;
}

describe('MR sorting', () => {
  const rows = [
    row({ mrKey: 'a', lastActivity: 1, totals: { cost: 5 } as never }),
    row({ mrKey: 'b', lastActivity: 3, totals: { cost: 1 } as never }),
    row({ mrKey: 'c', lastActivity: 2, totals: { cost: 5 } as never }),
  ];
  const keys = (list: UsageMrRow[]) => list.map(r => r.mrKey);

  it('sorts by date both ways', () => {
    expect(keys(sortMrs(rows, { sort: 'date', dir: 'desc' }))).toEqual([
      'b',
      'c',
      'a',
    ]);
    expect(keys(sortMrs(rows, { sort: 'date', dir: 'asc' }))).toEqual([
      'a',
      'c',
      'b',
    ]);
  });

  it('breaks a tie by key and leaves the input alone', () => {
    expect(keys(sortMrs(rows, { sort: 'cost', dir: 'desc' }))).toEqual([
      'a',
      'c',
      'b',
    ]);
    expect(keys(rows)).toEqual(['a', 'b', 'c']);
  });

  it('starts a new column highest first, then flips it', () => {
    const date = nextMrOrder({ sort: 'cost', dir: 'asc' }, 'date');
    expect(date).toEqual({ sort: 'date', dir: 'desc' });
    expect(nextMrOrder(date, 'date')).toEqual({ sort: 'date', dir: 'asc' });
  });
});

describe('shortDate', () => {
  const now = new Date(2026, 10, 5).getTime();

  it('drops the year when it is this one', () => {
    expect(shortDate(new Date(2026, 9, 8).getTime(), now)).toBe('Oct 8');
  });

  it('keeps an older year', () => {
    expect(shortDate(new Date(2025, 9, 8).getTime(), now)).toBe('Oct 8, 2025');
  });
});

describe('usage format', () => {
  it('reads the repo and number out of an MR key', () => {
    expect(mrParts(KEY)).toEqual({
      repoKey: 'remote:github.com%2Facme%2Fwidgets',
      repo: 'acme/widgets',
      number: '!123',
    });
  });

  it('encodes a key once for its link', () => {
    expect(usageMrHref(KEY)).toBe(
      '/usage/remote%3Agithub.com%252Facme%252Fwidgets!123'
    );
  });

  it('names models the way people say them', () => {
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5');
    expect(modelName('claude-sonnet-5')).toBe('Sonnet 5');
    expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(modelName('gpt-thing')).toBe('gpt-thing');
    expect(modelName(null)).toBe('Unknown');
  });

  it('says what an MR spent on', () => {
    const cost = row({}).costByKind;
    expect(
      mrSummary(row({ costByKind: { ...cost, work: 1 }, roundCount: 3 }))
    ).toBe('work run, 3 rounds');
    expect(
      mrSummary(row({ costByKind: { ...cost, work: 1 }, roundCount: 1 }))
    ).toBe('work run, 1 round');
    expect(mrSummary(row({ costByKind: { ...cost, review: 1 } }))).toBe(
      'review only'
    );
  });

  it('formats money and counts', () => {
    expect(usd(4.6)).toBe('$4.60');
    expect(usd(1284.2)).toBe('$1,284');
    expect(compact(950)).toBe('950');
    expect(compact(9000)).toBe('9.0K');
    expect(compact(96000)).toBe('96K');
    expect(compact(11_400_000)).toBe('11.4M');
  });
});
