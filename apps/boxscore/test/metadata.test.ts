import { describe, expect, it } from 'vitest';

import { GROUP_ORDER, GROUPS, METRICS } from '../src/shared/metrics.js';
import { makeMetrics } from './builders.js';

describe('metric metadata coherence', () => {
  const sample = makeMetrics();

  it('has no duplicate metric keys', () => {
    const keys = METRICS.map(d => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every descriptor key exists on UserMetrics with the matching shape', () => {
    for (const d of METRICS) {
      const cell = sample[d.key] as unknown as Record<string, unknown>;
      expect(cell, `missing cell for ${d.key}`).toBeDefined();
      if (d.kind === 'scalar') {
        expect(
          'value' in cell,
          `${d.key} declared scalar but has no value`
        ).toBe(true);
      } else {
        expect('p50' in cell, `${d.key} declared dist but has no p50`).toBe(
          true
        );
      }
    }
  });

  it('every descriptor has a label, description, and valid group', () => {
    for (const d of METRICS) {
      expect(d.label.length, `${d.key} label`).toBeGreaterThan(0);
      expect(d.description.length, `${d.key} description`).toBeGreaterThan(0);
      expect(GROUP_ORDER).toContain(d.group);
      expect(['asc', 'desc']).toContain(d.better);
    }
  });

  it("direction matches the metric's meaning (lower-is-better for cost-like metrics)", () => {
    const better = (key: string) => METRICS.find(d => d.key === key)!.better;
    // lower is better
    expect(better('revertRate')).toBe('asc');
    expect(better('reviewLatencyHours')).toBe('asc');
    expect(better('responseLatencyHours')).toBe('asc');
    // higher is better
    expect(better('mrsMerged')).toBe('desc');
    expect(better('codingDays')).toBe('desc');
    expect(better('reviewDepth')).toBe('desc');
    expect(better('sizeHealthPct')).toBe('desc');
    expect(better('issuesCompleted')).toBe('desc');
  });

  it('rate/health metrics are flagged as percentages', () => {
    expect(METRICS.find(d => d.key === 'revertRate')!.percent).toBe(true);
    expect(METRICS.find(d => d.key === 'sizeHealthPct')!.percent).toBe(true);
  });

  it('every group is represented', () => {
    for (const g of GROUP_ORDER) {
      expect(
        METRICS.some(d => d.group === g),
        g
      ).toBe(true);
    }
  });

  it('computed metrics are also described, so they display and rank', () => {
    const reverted = METRICS.find(d => d.key === 'revertedCount');
    const current = METRICS.find(d => d.key === 'currentStreak');
    expect(reverted?.better).toBe('asc');
    expect(reverted?.group).toBe('quality');
    expect(current?.better).toBe('desc');
    expect(current?.group).toBe('consistency');
  });

  it('every rankable UserMetrics key has exactly one descriptor', () => {
    const rankable = Object.entries(sample)
      .filter(
        ([, cell]) =>
          typeof cell === 'object' && cell !== null && 'rank' in cell
      )
      .map(([key]) => key)
      .sort();
    const described = METRICS.map(d => d.key).sort();
    expect(described).toEqual(rankable);
  });
});

describe('metric groups', () => {
  it('uses the five design groups in board order', () => {
    expect(GROUP_ORDER).toEqual([
      'delivery',
      'volume',
      'quality',
      'consistency',
      'collaboration',
    ]);
    expect(GROUPS.consistency).toEqual({ label: 'Consistency', hue: 'gold' });
  });
  it('places each metric in its design group', () => {
    const by = Object.fromEntries(METRICS.map(m => [m.key, m.group]));
    expect(by.codingDays).toBe('consistency');
    expect(by.currentStreak).toBe('consistency');
    expect(by.longestStreak).toBe('consistency');
    expect(by.reciprocity).toBe('collaboration');
    expect(by.reviewDepth).toBe('quality');
    expect(by.pipelines).toBe('volume');
  });
});
