import { describe, expect, it } from 'vitest';

// eslint-disable-next-line no-restricted-imports -- a test file never reaches the browser bundle, and the fixture is pure TS
import { fixtureDetail } from '../../server/fixture/index';
import type { MetricEvidence } from '../../shared/types';
import {
  calendarWeeks,
  depthBins,
  mergeDays,
  pipelinesByDay,
  reviewsByAuthor,
  sizeBins,
  waitBins,
} from './evidence-shapes';

const rows = (cells: string[][]) => cells.map(c => ({ cells: c }));

describe('waitBins', () => {
  const wait: MetricEvidence = {
    columns: ['MR', 'Title', 'Wait'],
    rows: [0.6, 0.7, 1.1, 1.5, 4.3, 44.4, 125.3].map((h, i) => ({
      cells: [`!${i}`, `Change ${i}`, `${h}h`],
    })),
    facts: { p50: 1.1, p90: 44.4, count: 7 },
  };

  it('bins waits by hour band and highlights the p50 bin', () => {
    const bins = waitBins(wait);
    expect(bins.map(b => b.label)).toEqual([
      '< 0.5h',
      '0.5–1h',
      '1–2h',
      '2–4h',
      '4–8h',
      '8–24h',
      '24h +',
    ]);
    expect(bins.map(b => b.count)).toEqual([0, 2, 2, 0, 1, 0, 2]);
    expect(bins.filter(b => b.highlight).map(b => b.label)).toEqual(['1–2h']);
  });

  it('puts a value on a bin edge in the upper bin', () => {
    const edge = { ...wait, rows: rows([['!1', 'Edge', '0.5h']]) };
    expect(waitBins(edge)[1]!.count).toBe(1);
  });
});

describe('sizeBins', () => {
  it('bins changed lines and highlights the bins inside the band', () => {
    const size: MetricEvidence = {
      columns: ['MR', 'Title', 'Changed', 'In band?'],
      rows: rows(
        [4, 12, 30, 60, 150, 250, 399, 500, 900, 2000].map((n, i) => [
          `!${i}`,
          `Change ${i}`,
          String(n),
          '✓',
        ])
      ),
      facts: { bandLow: 10, bandHigh: 400 },
    };
    const bins = sizeBins(size);
    expect(bins.map(b => b.label)).toEqual([
      '< 10',
      '10–50',
      '50–100',
      '100–200',
      '200–400',
      '400–800',
      '800 +',
    ]);
    expect(bins.map(b => b.count)).toEqual([1, 2, 1, 1, 2, 1, 2]);
    expect(bins.filter(b => b.highlight).map(b => b.label)).toEqual([
      '10–50',
      '50–100',
      '100–200',
      '200–400',
    ]);
  });
});

describe('depthBins', () => {
  it('bins inline comment counts and highlights every bin but zero', () => {
    const depth: MetricEvidence = {
      columns: ['MR', 'Title', 'Inline comments'],
      rows: rows(
        [0, 0, 1, 2, 3, 5, 6, 12].map((n, i) => [
          `!${i}`,
          `Change ${i}`,
          String(n),
        ])
      ),
    };
    const bins = depthBins(depth);
    expect(bins.map(b => b.label)).toEqual(['0', '1', '2', '3–5', '6 +']);
    expect(bins.map(b => b.count)).toEqual([2, 1, 1, 2, 2]);
    expect(bins.map(b => b.highlight)).toEqual([false, true, true, true, true]);
  });
});

describe('calendarWeeks', () => {
  const pushes: MetricEvidence = {
    columns: ['Date', 'Pushes'],
    rows: rows(
      [
        ['2026-06-29', 20],
        ['2026-06-15', 6],
        ['2026-06-02', 5],
        ['2026-05-31', 1],
        ['2026-05-20', 9],
      ].map(([d, n]) => [String(d), String(n)])
    ),
  };

  it('lays a Sunday-start 30 day window out as five Sun to Sat rows', () => {
    const weeks = calendarWeeks(
      pushes,
      '2026-05-31T12:00:00.000Z',
      '2026-06-30T12:00:00.000Z'
    );
    expect(weeks).toHaveLength(5);
    for (const w of weeks) expect(w).toHaveLength(7);
    expect(weeks[0]![0]).toEqual({
      date: '2026-05-31',
      count: 1,
      inWindow: true,
      level: 1,
    });
    expect(weeks[0]![2]).toMatchObject({
      date: '2026-06-02',
      count: 5,
      level: 1,
    });
    expect(weeks[2]![1]).toMatchObject({
      date: '2026-06-15',
      count: 6,
      level: 2,
    });
    expect(weeks[4]![1]).toMatchObject({
      date: '2026-06-29',
      count: 20,
      inWindow: true,
      level: 3,
    });
    expect(weeks[4]!.map(d => d.inWindow)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(weeks[4]![2]).toEqual({
      date: '2026-06-30',
      count: 0,
      inWindow: false,
      level: 0,
    });
    expect(weeks.flat().find(d => d.date === '2026-06-03')?.level).toBe(0);
  });

  it('pads a mid-week start back to Sunday with out-of-window days', () => {
    const weeks = calendarWeeks(
      pushes,
      '2026-06-03T00:00:00.000Z',
      '2026-06-10T00:00:00.000Z'
    );
    expect(weeks[0]![0]).toMatchObject({
      date: '2026-05-31',
      inWindow: false,
      count: 0,
    });
    expect(weeks[0]![3]).toMatchObject({ date: '2026-06-03', inWindow: true });
    expect(weeks.flat().filter(d => d.inWindow)).toHaveLength(7);
  });
});

describe('mergeDays', () => {
  it('marks the longest run, the current run and other merge days', () => {
    const merges: MetricEvidence = {
      columns: ['Date', 'MRs merged'],
      rows: rows(
        [
          ['2026-06-12', 1],
          ['2026-06-09', 2],
          ['2026-06-08', 1],
          ['2026-06-07', 1],
          ['2026-06-06', 3],
          ['2026-06-05', 1],
          ['2026-06-02', 1],
          ['2026-06-01', 1],
        ].map(([d, n]) => [String(d), String(n)])
      ),
    };
    const days = mergeDays(
      merges,
      '2026-05-31T12:00:00.000Z',
      '2026-06-14T12:00:00.000Z'
    );
    expect(days).toHaveLength(14);
    expect(days[0]).toEqual({ date: '2026-05-31', count: 0, run: 'none' });
    expect(days.map(d => d.run)).toEqual([
      'none',
      'other',
      'other',
      'none',
      'none',
      'longest',
      'longest',
      'longest',
      'longest',
      'longest',
      'none',
      'none',
      'current',
      'none',
    ]);
    expect(days.find(d => d.date === '2026-06-06')?.count).toBe(3);
  });

  it('keeps longest when the current run is also the longest', () => {
    const merges: MetricEvidence = {
      columns: ['Date', 'MRs merged'],
      rows: rows([
        ['2026-06-05', '1'],
        ['2026-06-04', '1'],
        ['2026-06-01', '1'],
      ]),
    };
    const days = mergeDays(
      merges,
      '2026-06-01T00:00:00.000Z',
      '2026-06-06T00:00:00.000Z'
    );
    expect(days.map(d => d.run)).toEqual([
      'other',
      'none',
      'none',
      'longest',
      'longest',
    ]);
  });
});

describe('pipelinesByDay', () => {
  it('groups pipelines by created day, newest first, capped at the day count', () => {
    const pipes: MetricEvidence = {
      columns: ['Status', 'Created'],
      rows: rows([
        ['success', '2026-06-10'],
        ['running', '2026-06-10'],
        ['failed', '2026-06-08'],
        ['success', '2026-06-08'],
        ['canceled', '2026-06-08'],
        ['pending', '2026-06-08'],
        ['success', '2026-06-03'],
        ['success', '2026-06-01'],
      ]),
    };
    expect(pipelinesByDay(pipes, 3)).toEqual([
      { date: '2026-06-10', success: 1, failed: 0, canceled: 0, running: 1 },
      { date: '2026-06-08', success: 1, failed: 1, canceled: 1, running: 1 },
      { date: '2026-06-03', success: 1, failed: 0, canceled: 0, running: 0 },
    ]);
  });
});

describe('reviewsByAuthor', () => {
  it('counts reviewed MRs per author, most first, ties by name', () => {
    const reviewed: MetricEvidence = {
      columns: ['MR', 'Author', 'Title', 'Comments', 'Inline'],
      rows: rows([
        ['!1', 'bkim', 'One', '1', '0'],
        ['!2', 'azhou', 'Two', '1', '0'],
        ['!3', 'cfox', 'Three', '1', '0'],
        ['!4', 'cfox', 'Four', '1', '0'],
      ]),
    };
    expect(reviewsByAuthor(reviewed)).toEqual([
      { author: 'cfox', count: 2 },
      { author: 'azhou', count: 1 },
      { author: 'bkim', count: 1 },
    ]);
  });
});

describe('the design fixture reproduces the drawn panels', () => {
  const detail = fixtureDetail('srivera', false)!;
  const ev = detail.evidence;
  const { start, end } = detail.window;

  it('wait for review', () => {
    const bins = waitBins(ev.reviewLatencyHours!);
    expect(bins.map(b => b.count)).toEqual([0, 33, 8, 3, 2, 1, 3]);
    expect(ev.reviewLatencyHours!.facts?.p50).toBe(0.65);
    expect(bins.find(b => b.highlight)?.label).toBe('0.5–1h');
  });

  it('size health', () => {
    const bins = sizeBins(ev.sizeHealthPct!);
    expect(bins.map(b => b.count)).toEqual([0, 3, 4, 8, 15, 11, 6]);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(47);
    expect(bins.filter(b => b.highlight).map(b => b.label)).toEqual([
      '10–50',
      '50–100',
      '100–200',
      '200–400',
    ]);
  });

  it('review depth', () => {
    expect(depthBins(ev.reviewDepth!).map(b => b.count)).toEqual([
      30, 13, 10, 16, 5,
    ]);
  });

  it('pipelines', () => {
    const days = pipelinesByDay(ev.pipelines!, 365);
    const total = (k: 'success' | 'failed' | 'canceled' | 'running') =>
      days.reduce((s, d) => s + d[k], 0);
    expect([
      total('success'),
      total('failed'),
      total('canceled'),
      total('running'),
    ]).toEqual([138, 65, 6, 3]);
    expect(pipelinesByDay(ev.pipelines!, 7).map(d => d.date)).toEqual([
      '2026-09-28',
      '2026-09-27',
      '2026-09-25',
      '2026-09-24',
      '2026-09-23',
      '2026-09-22',
      '2026-09-21',
    ]);
  });

  it('push calendar', () => {
    const weeks = calendarWeeks(ev.codingDays!, start, end);
    const days = weeks.flat();
    expect(weeks).toHaveLength(5);
    expect(weeks[0]![0]!.date).toBe('2026-08-30');
    expect(days.filter(d => d.inWindow)).toHaveLength(30);
    expect(days.filter(d => d.inWindow).at(-1)?.date).toBe('2026-09-28');
    expect(Math.max(...days.map(d => d.count))).toBe(28);
    expect(days.find(d => d.count === 28)?.date).toBe('2026-09-17');
    expect(days.filter(d => d.count > 0)).toHaveLength(21);
  });

  it('merge days', () => {
    const days = mergeDays(ev.longestStreak!, start, end);
    expect(days).toHaveLength(30);
    expect(days.filter(d => d.run === 'longest').map(d => d.date)).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
    ]);
    expect(days.filter(d => d.run === 'current').map(d => d.date)).toEqual([
      '2026-09-28',
    ]);
    expect(days.filter(d => d.count > 0)).toHaveLength(18);
  });

  it('reviews by author', () => {
    expect(reviewsByAuthor(ev.mrsReviewed!)).toEqual([
      { author: 'nvance', count: 46 },
      { author: 'pnair', count: 11 },
      { author: 'kmorgan', count: 6 },
      { author: 'tberg', count: 5 },
      { author: 'lortiz', count: 4 },
      { author: 'radeyemi', count: 2 },
    ]);
  });
});
