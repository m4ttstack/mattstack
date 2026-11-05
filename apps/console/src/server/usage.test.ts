// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@mattstack/rt-client', () => ({
  usageMrs: vi.fn(),
  usageMr: vi.fn(),
  usageRun: vi.fn(),
  usageTrends: vi.fn(),
  usageStatus: vi.fn(),
}));

const { usageRoutes } = await import('./usage');
const { runsFixture } = await import('./fixtures/design/runsFixture');
const rt = await import('@mattstack/rt-client');

const get = (app: ReturnType<typeof usageRoutes>, path: string) =>
  app.fetch(new Request(`http://localhost${path}`));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('usage api', () => {
  it('passes days and repo through', async () => {
    vi.mocked(rt.usageMrs).mockResolvedValue({ ok: true, data: undefined });
    vi.mocked(rt.usageTrends).mockResolvedValue({ ok: true, data: undefined });
    const app = usageRoutes();
    await get(app, '/api/usage/mrs?days=30&repo=acme%2Fwidgets');
    expect(rt.usageMrs).toHaveBeenCalledWith({
      days: 30,
      repo: 'acme/widgets',
    });
    await get(app, '/api/usage/mrs');
    expect(rt.usageMrs).toHaveBeenLastCalledWith({});
    await get(app, '/api/usage/trends?days=7&repo=acme%2Fwidgets');
    expect(rt.usageTrends).toHaveBeenCalledWith({
      days: 7,
      repo: 'acme/widgets',
    });
  });

  it('an mrKey with %, ! and : survives one round of encoding', async () => {
    vi.mocked(rt.usageMr).mockResolvedValue({ ok: true, data: null });
    const key = 'remote:gitlab.com%2Facme%2Fwidgets!12';
    const res = await get(
      usageRoutes(),
      `/api/usage/mr?mrKey=${encodeURIComponent(key)}`
    );
    expect(rt.usageMr).toHaveBeenCalledWith(key);
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it('reads one run and refuses a missing run id', async () => {
    vi.mocked(rt.usageRun).mockResolvedValue({ ok: true, data: null });
    const res = await get(usageRoutes(), '/api/usage/run?runId=run-1');
    expect(rt.usageRun).toHaveBeenCalledWith('run-1');
    expect(res.status).toBe(200);
    expect((await get(usageRoutes(), '/api/usage/run')).status).toBe(400);
  });

  it('answers 400 for a missing mrKey, a missing trends days or a junk days', async () => {
    const app = usageRoutes();
    expect((await get(app, '/api/usage/mr')).status).toBe(400);
    expect((await get(app, '/api/usage/trends')).status).toBe(400);
    expect((await get(app, '/api/usage/trends?days=abc')).status).toBe(400);
    expect((await get(app, '/api/usage/mrs?days=abc')).status).toBe(400);
    expect(rt.usageMr).not.toHaveBeenCalled();
    expect(rt.usageTrends).not.toHaveBeenCalled();
    expect(rt.usageMrs).not.toHaveBeenCalled();
  });

  it('refuses days outside 1 to 3650, live and under the fixture', async () => {
    for (const app of [usageRoutes(), usageRoutes(runsFixture('runs'))]) {
      for (const days of ['0', '-1', '3651', '99999999999999999999'])
        for (const route of ['mrs', 'trends'])
          expect(
            (await get(app, `/api/usage/${route}?days=${days}`)).status
          ).toBe(400);
    }
    expect(rt.usageTrends).not.toHaveBeenCalled();
    expect(rt.usageMrs).not.toHaveBeenCalled();
    vi.mocked(rt.usageTrends).mockResolvedValue({ ok: true, data: undefined });
    await get(usageRoutes(), '/api/usage/trends?days=3650');
    expect(rt.usageTrends).toHaveBeenCalledWith({ days: 3650 });
  });

  it('a daemon refusal answers 502 with its error', async () => {
    vi.mocked(rt.usageStatus).mockResolvedValue({ ok: false, error: 'boom' });
    const res = await get(usageRoutes(), '/api/usage/status');
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'boom' });
  });

  it('the fixture answers without a daemon', async () => {
    const app = usageRoutes(runsFixture('runs'));
    const mrs = (await (await get(app, '/api/usage/mrs')).json()) as {
      mrs: { mrKey: string }[];
    };
    expect(mrs.mrs.length).toBe(2);
    const key = 'remote:github.com%2Facme%2Fwidgets!123';
    const mr = (await (
      await get(app, `/api/usage/mr?mrKey=${encodeURIComponent(key)}`)
    ).json()) as {
      ticket: string;
      totals: { cost: number };
      costByKind: Record<string, number>;
      runs: { totals: { cost: number } }[];
    };
    expect(mr.ticket).toBe('WEB-123');
    const runsSum = mr.runs.reduce((a, r) => a + r.totals.cost, 0);
    expect(mr.totals.cost).toBeCloseTo(runsSum, 6);
    const kindSum = Object.values(mr.costByKind).reduce((a, n) => a + n, 0);
    expect(kindSum).toBeCloseTo(mr.totals.cost, 6);
    const unknown = await get(app, '/api/usage/mr?mrKey=nope');
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toBeNull();
    expect((await get(app, '/api/usage/trends?days=30')).status).toBe(200);
    expect((await get(app, '/api/usage/status')).status).toBe(200);
    expect(rt.usageMrs).not.toHaveBeenCalled();
  });

  describe("the fixture matches the daemon's shapes", () => {
    const { usage } = runsFixture('runs');
    const entries = usage.mrs.mrs.flatMap(r => usage.mr(r.mrKey)!.runs);

    it('lists MRs newest first', () => {
      const last = usage.mrs.mrs.map(r => r.lastActivity);
      expect(last).toEqual(last.toSorted((a, b) => b - a));
    });

    it('lists only the models it saw', () => {
      const rows = [
        ...entries.flatMap(e => e.byModel),
        ...usage.mrs.mrs.flatMap(r => usage.mr(r.mrKey)!.byModel),
        ...usage.trends.byModel,
      ];
      for (const { totals } of rows)
        expect(totals.output + totals.cacheRead).toBeGreaterThan(0);
    });

    it('gives a null stage no times, and recorded stages their own', () => {
      const stages = entries.flatMap(e => e.stages);
      for (const s of stages.filter(x => x.name === null)) {
        expect(s.startedAt).toBeNull();
        expect(s.endedAt).toBeNull();
      }
      const work = entries.find(e => e.kind === 'work')!;
      const [plan, implement] = work.stages;
      expect(plan!.startedAt).toBe(work.startedAt);
      expect(plan!.endedAt).toBe(implement!.startedAt);
      expect(implement!.endedAt).toBe(work.endedAt);
    });

    it('starts its week at local Monday midnight', () => {
      const week = new Date(usage.trends.weeks[0]!.weekStart);
      expect(week.getDay()).toBe(1);
      expect(week.getHours()).toBe(0);
    });

    it('counts its runs from the data', () => {
      const runs = new Set(entries.map(e => e.runId).filter(Boolean));
      expect(usage.status.runs).toBe(runs.size);
    });
  });

  it('the empty fixture answers empty usage', async () => {
    const app = usageRoutes(runsFixture('runs-empty'));
    const body = async (path: string) => (await get(app, path)).json();
    const zero = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      messages: 0,
      cost: 0,
      unpricedTokens: 0,
    };
    expect(await body('/api/usage/mrs')).toEqual({
      mrs: [],
      summary: { mrCount: 0, totals: zero, medianCost: 0 },
    });
    expect(await body('/api/usage/mr?mrKey=x')).toBeNull();
    expect(await body('/api/usage/trends?days=30')).toEqual({
      weeks: [],
      totals: zero,
      byPipeline: [],
      byModel: [],
    });
    expect(await body('/api/usage/status')).toMatchObject({
      lastSweepAt: null,
      lastSweepMs: null,
      messages: 0,
      runs: 0,
    });
  });

  it('the outage fixture answers 502', async () => {
    const app = usageRoutes(runsFixture('runs-outage'));
    for (const p of [
      '/api/usage/mrs',
      '/api/usage/mr?mrKey=x',
      '/api/usage/trends?days=7',
      '/api/usage/status',
    ])
      expect((await get(app, p)).status).toBe(502);
  });
});
