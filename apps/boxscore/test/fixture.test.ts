import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  LeaderboardResponse,
  RefreshStatusResponse,
  UserDetailResponse,
} from '../src/shared/types';

describe('design fixture mode', () => {
  beforeEach(() => {
    process.env.BOXSCORE_FIXTURE = 'design';
    delete process.env.BOXSCORE_FIXTURE_SCENARIO;
  });

  afterAll(() => {
    delete process.env.BOXSCORE_FIXTURE;
    delete process.env.BOXSCORE_FIXTURE_SCENARIO;
  });

  it('serves the canvas leaderboard', async () => {
    const { routes } = await import('../src/server/routes');
    const res = await routes.request('/api/leaderboard?range=30d&cacheOnly=1');
    const body = await res.json();
    expect(body.users.map((u: { username: string }) => u.username)).toEqual([
      'nvance',
      'srivera',
      'pnair',
      'tberg',
      'lortiz',
      'kmorgan',
      'radeyemi',
    ]);
    expect(body.users[1].metrics.mrsMerged.value).toBe(47);
    expect(body.scope.projectPaths).toEqual(['acme/web-app']);
  });

  it('serves the stalled cold scenario', async () => {
    process.env.BOXSCORE_FIXTURE_SCENARIO = 'cold-stalled';
    const { routes } = await import('../src/server/routes');
    const res = await routes.request('/api/leaderboard?range=30d&cacheOnly=1');
    expect(await res.json()).toEqual({
      cached: false,
      window: {
        start: '2026-08-30T00:00:00.000Z',
        end: '2026-09-29T00:00:00.000Z',
        key: '30d',
      },
      scope: { type: 'projects', projectPaths: ['acme/web-app'] },
    });
  });

  it('answers the console link', async () => {
    const { routes } = await import('../src/server/routes');
    const res = await routes.request('/api/links');
    expect((await res.json()).console).toMatch(/^https?:\/\//);
  });

  it('ranks ties the way the app does and names leaders', async () => {
    const { fixtureLeaderboard } = await import('../src/server/fixture');
    const body = fixtureLeaderboard(false);
    const rank = (user: string, key: 'mrsMerged' | 'currentStreak') =>
      body.users.find(u => u.username === user)!.metrics[key].rank;
    expect(rank('tberg', 'mrsMerged')).toBe(4);
    expect(rank('lortiz', 'mrsMerged')).toBe(4);
    expect(rank('kmorgan', 'currentStreak')).toBe(3);
    const lena = body.users.find(u => u.username === 'lortiz')!;
    expect(lena.metrics.responseLatencyHours).toMatchObject({
      p50: null,
      rank: null,
    });
    expect(body.leaders.reviewLatencyHours).toBe('tberg');
    expect(body.leaders.reciprocity).toBe('pnair');
    expect(body.priorWindow).toBeNull();
    expect(body.users[0]!.metrics.issuesCompleted.delta).toBeNull();
    expect(body.users.find(u => u.isCurrentUser)!.username).toBe('srivera');
  });

  it('carries the trend board deltas in trend mode', async () => {
    const { fixtureLeaderboard } = await import('../src/server/fixture');
    const body: LeaderboardResponse = fixtureLeaderboard(true);
    const m = (user: string) =>
      body.users.find(u => u.username === user)!.metrics;
    expect(body.hasTrend).toBe(true);
    expect(body.priorWindow).not.toBeNull();
    expect(m('nvance').issuesCompleted.delta).toBe(8);
    expect(m('nvance').mrsMerged.delta).toBe(0);
    expect(m('nvance').reviewLatencyHours.deltaP50).toBe(0.2);
    expect(m('srivera').sizeHealthPct.delta).toBe(0.12);
    expect(m('srivera').reciprocity.delta).toBe(-1.1);
    expect(m('radeyemi').issuesCompleted.delta).toBe(-14);
  });

  it('pins the window to the boards dates', async () => {
    const { fixtureLeaderboard } = await import('../src/server/fixture');
    const body = fixtureLeaderboard(false);
    expect(body.window).toEqual({
      start: '2026-08-30T00:00:00.000Z',
      end: '2026-09-29T00:00:00.000Z',
      key: '30d',
    });
    const age = Date.now() - Date.parse(body.generatedAt);
    expect(Math.round(age / 60_000)).toBe(4);
  });

  it('serves the stat detail evidence drawn on the boards', async () => {
    const { routes } = await import('../src/server/routes');
    const res = await routes.request('/api/detail?user=srivera&range=30d');
    const body = (await res.json()) as UserDetailResponse;
    const ev = body.evidence;
    expect(body.user.username).toBe('srivera');

    expect(ev.issuesCompleted!.rows).toHaveLength(48);
    expect(ev.issuesCompleted!.rows[0]!.cells[0]).toBe('APP-1345');
    expect(ev.issuesCompleted!.facts).toEqual({
      counted: 48,
      excludedByState: 4,
      outsideWindow: 96,
    });

    expect(ev.pipelines!.rows).toHaveLength(212);
    expect(ev.pipelines!.facts).toEqual({
      success: 138,
      failed: 65,
      canceled: 6,
      running: 3,
    });

    expect(ev.mrsMerged!.rows).toHaveLength(47);
    const sum = (col: number) =>
      ev.mrsMerged!.rows.reduce(
        (s, r) => s + Number(r.cells[col]!.replace(/[^0-9]/g, '')),
        0
      );
    expect(sum(2)).toBe(17749);
    expect(sum(3)).toBe(3849);
    expect(ev.mrsMerged!.facts).toEqual({
      merged: 47,
      added: 17749,
      deleted: 3849,
    });

    expect(ev.reviewLatencyHours!.rows).toHaveLength(50);
    expect(ev.reviewLatencyHours!.facts).toEqual({
      p50: 0.65,
      p90: 4.29,
      count: 50,
    });
    expect(ev.reciprocity!.facts).toMatchObject({ given: 74, reviewers: 9 });
    expect(ev.codingDays!.rows).toHaveLength(21);
    expect(ev.longestStreak!.facts).toEqual({
      current: 1,
      longest: 5,
      mergeDays: 18,
    });
    expect(ev.reviewDepth!.facts).toEqual({
      reviewed: 74,
      inlineComments: 135,
    });
  });

  it('bins the drawn histograms exactly', async () => {
    const { fixtureDetail } = await import('../src/server/fixture');
    const ev = fixtureDetail('srivera', false)!.evidence;
    const bin = (values: number[], edges: number[]) =>
      edges
        .map((lo, i) => [lo, edges[i + 1] ?? Infinity] as const)
        .map(([lo, hi]) => values.filter(v => v >= lo && v < hi).length);

    const waits = ev.reviewLatencyHours!.rows.map(r =>
      Number.parseFloat(r.cells[2]!)
    );
    expect(bin(waits, [0, 0.5, 1, 2, 4, 8, 24])).toEqual([
      0, 33, 8, 3, 2, 1, 3,
    ]);

    const sizes = ev.sizeHealthPct!.rows.map(r => Number(r.cells[2]));
    expect(bin(sizes, [0, 10, 50, 100, 200, 400, 800])).toEqual([
      0, 3, 4, 8, 15, 11, 6,
    ]);
    const depth = ev.reviewDepth!.rows.map(r => Number(r.cells[2]));
    expect(bin(depth, [0, 1, 2, 3, 6])).toEqual([30, 13, 10, 16, 5]);
  });

  it('answers detail for every roster user and 404 for strangers', async () => {
    const { fixtureDetail } = await import('../src/server/fixture');
    expect(fixtureDetail('nvance', false)!.user.name).toBe('Nora Vance');
    expect(fixtureDetail('nobody', false)).toBeNull();
    const { routes } = await import('../src/server/routes');
    const res = await routes.request('/api/detail?user=nobody');
    expect(res.status).toBe(404);
  });

  it('reports a refresh job stuck in MR details', async () => {
    const { routes } = await import('../src/server/routes');
    const started = (await (
      await routes.request('/api/refresh?range=30d', { method: 'POST' })
    ).json()) as RefreshStatusResponse;
    const polled = (await (
      await routes.request(`/api/refresh/${started.jobId}`)
    ).json()) as RefreshStatusResponse;
    for (const job of [started, polled])
      expect(job).toMatchObject({
        status: 'running',
        progress: {
          phase: 'mrs-detail',
          label: 'MR details',
          done: 142,
          total: 310,
          window: 'current',
          totals: { users: 7, 'mrs-list': 1, 'mrs-detail': 310 },
        },
      });
  });
});
