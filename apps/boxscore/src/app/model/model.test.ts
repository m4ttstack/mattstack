import { describe, expect, it } from 'vitest';

// eslint-disable-next-line no-restricted-imports -- a test file never reaches the browser bundle, and the fixture is pure TS
import { fixtureLeaderboard } from '../../server/fixture/index';
import { metricByKey, METRICS, setMetricRank } from '../../shared/metrics';
import type { UserRow } from '../../shared/types';
import { deltaTone, formatDelta } from './delta';
import { HEADLINE, hueVar, OVERVIEW, statsInGroup } from './groups';
import { isFullTie, leaderOf, rankedFor, you } from './standings';
import { personSummary } from './summary';

function users(): UserRow[] {
  return structuredClone(fixtureLeaderboard(false).users);
}

describe('groups', () => {
  it('names a headline stat per group and the overview columns', () => {
    expect(HEADLINE).toEqual({
      delivery: 'issuesCompleted',
      volume: 'mrsMerged',
      quality: 'reviewLatencyHours',
      consistency: 'codingDays',
      collaboration: 'reciprocity',
    });
    expect(OVERVIEW).toEqual([
      'issuesCompleted',
      'mrsMerged',
      'mrsReviewed',
      'lines',
      'reviewDepth',
      'reviewLatencyHours',
      'sizeHealthPct',
      'codingDays',
      'reciprocity',
    ]);
  });
  it('lists a group in metric table order', () => {
    expect(statsInGroup('consistency')).toEqual([
      'codingDays',
      'currentStreak',
      'longestStreak',
    ]);
    expect(statsInGroup('delivery')).toEqual(['issuesCompleted']);
  });
  it('maps a group hue to role tokens', () => {
    expect(hueVar('consistency', 'swatch')).toBe('var(--tk-text-gold)');
    expect(hueVar('consistency', 'small')).toBe('var(--tk-text-gold-small)');
    expect(hueVar('volume', 'swatch')).toBe('var(--tk-muted)');
    expect(hueVar('volume', 'text')).toBe('var(--tk-text-2)');
    expect(hueVar('volume', 'small')).toBe('var(--tk-text-2)');
    expect(hueVar('quality', 'text')).toBe('var(--tk-text-accent)');
  });
});

describe('standings', () => {
  it('orders by server rank and marks leader and you', () => {
    const r = rankedFor(users(), 'mrsMerged');
    expect(r[0]).toMatchObject({ isLeader: true, rank: 1 });
    expect(r.find(x => x.user.username === 'srivera')).toMatchObject({
      isYou: true,
      isLeader: false,
    });
    const ranks = r.map(x => x.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });
  it('has no leader on a full tie', () => {
    expect(leaderOf(users(), 'revertRate')).toBeNull();
    expect(isFullTie(users(), 'revertRate')).toBe(true);
    expect(rankedFor(users(), 'revertRate').some(x => x.isLeader)).toBe(false);
  });
  it('names the leader otherwise', () => {
    expect(leaderOf(users(), 'mrsReviewed')?.username).toBe('srivera');
    expect(isFullTie(users(), 'mrsReviewed')).toBe(false);
  });
  it('drops unresolved users and sinks null values', () => {
    const us = users();
    us[3].resolved = false;
    const r = rankedFor(us, 'responseLatencyHours');
    expect(r.some(x => x.user.username === us[3].username)).toBe(false);
    expect(r.at(-1)?.value).toBeNull();
    expect(r.at(-1)?.isLeader).toBe(false);
  });
  it('finds the current user', () => {
    expect(you(users())?.username).toBe('srivera');
    expect(you(users().map(u => ({ ...u, isCurrentUser: false })))).toBeNull();
  });
});

describe('person summary', () => {
  it('counts leads, top 3 and median rank', () => {
    const s = personSummary(users(), 'srivera');
    expect(s.statCount).toBe(16);
    expect(s.leads).toContain('mrsReviewed');
    expect(s.medianRank).toBe(2);
  });
  it('counts a full tie as no lead and not top 3', () => {
    const s = personSummary(users(), 'srivera');
    expect(s.leads).toEqual(['mrsReviewed']);
    expect(s.top3).toBe(13);
  });
  it('takes the lower middle rank for an even count, skipping unranked stats', () => {
    const us = users();
    const me = us.find(u => u.username === 'srivera')!;
    METRICS.forEach((d, i) => setMetricRank(me.metrics, d, i < 8 ? 1 : 5));
    expect(personSummary(us, 'srivera').medianRank).toBe(1);
    setMetricRank(me.metrics, metricByKey('issuesCompleted')!, null);
    expect(personSummary(us, 'srivera').medianRank).toBe(5);
  });
  it('is empty for an unknown person', () => {
    expect(personSummary(users(), 'nobody')).toEqual({
      leads: [],
      top3: 0,
      statCount: 16,
      medianRank: null,
    });
  });
});

describe('deltas', () => {
  it('reads direction from the metric', () => {
    expect(deltaTone('mrsMerged', 3)).toBe('better');
    expect(deltaTone('reviewLatencyHours', 0.2)).toBe('worse');
    expect(deltaTone('mrsMerged', 0)).toBe('none');
    expect(deltaTone('mrsMerged', null)).toBe('none');
  });
  it('formats like the board', () => {
    expect(formatDelta('mrsMerged', 7)).toBe('▲7');
    expect(formatDelta('reviewLatencyHours', -0.24)).toBe('▼0.2h');
    expect(formatDelta('sizeHealthPct', 0.12)).toBe('▲12%');
    expect(formatDelta('reviewDepth', 0.53)).toBe('▲0.5');
    expect(formatDelta('reciprocity', 0.1)).toBe('▲0.1');
    expect(formatDelta('additions', -1200)).toBe(`▼${(1200).toLocaleString()}`);
  });
});
