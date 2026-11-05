// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@mattstack/rt-client', () => ({
  usageMrs: vi.fn(),
  usageMr: vi.fn(),
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
