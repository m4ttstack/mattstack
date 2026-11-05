import {
  usageMr,
  usageMrs,
  usageRun,
  usageStatus,
  usageTrends,
} from '@mattstack/rt-client';
import { Hono } from 'hono';

import {
  FIXTURE_OUTAGE,
  type RunsFixture,
} from './fixtures/design/runsFixture';

/** The daemon refuses past this too; checking here makes the fixture refuse alike. */
const MAX_DAYS = 3650;
const DAYS_ERROR = `days must be a number from 1 to ${MAX_DAYS}`;

function parseDays(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const days = /^\d+$/.test(raw) ? Number(raw) : NaN;
  return days >= 1 && days <= MAX_DAYS ? days : NaN;
}

/**
 * `mrKey` rides the query string, percent-encoded once by the caller; Hono
 * decodes it back to the daemon's `remote:host%2Fpath!n` key.
 */
export function usageRoutes(fixture: RunsFixture | null = null) {
  return new Hono()
    .get('/api/usage/mrs', async c => {
      const days = parseDays(c.req.query('days'));
      const repo = c.req.query('repo');
      if (Number.isNaN(days)) return c.json({ error: DAYS_ERROR }, 400);
      if (fixture?.outage) return c.json({ error: FIXTURE_OUTAGE }, 502);
      if (fixture) return c.json(fixture.usage.mrs, 200);
      const res = await usageMrs({
        ...(days !== undefined ? { days } : {}),
        ...(repo !== undefined ? { repo } : {}),
      });
      if (!res.ok) return c.json({ error: res.error }, 502);
      return c.json(res.data ?? null, 200);
    })
    .get('/api/usage/mr', async c => {
      const mrKey = c.req.query('mrKey');
      if (!mrKey) return c.json({ error: 'mrKey is required' }, 400);
      if (fixture?.outage) return c.json({ error: FIXTURE_OUTAGE }, 502);
      if (fixture) return c.json(fixture.usage.mr(mrKey), 200);
      const res = await usageMr(mrKey);
      if (!res.ok) return c.json({ error: res.error }, 502);
      return c.json(res.data ?? null, 200);
    })
    .get('/api/usage/run', async c => {
      const runId = c.req.query('runId');
      if (!runId) return c.json({ error: 'runId is required' }, 400);
      if (fixture?.outage) return c.json({ error: FIXTURE_OUTAGE }, 502);
      if (fixture) return c.json(null, 200);
      const res = await usageRun(runId);
      if (!res.ok) return c.json({ error: res.error }, 502);
      return c.json(res.data ?? null, 200);
    })
    .get('/api/usage/trends', async c => {
      const days = parseDays(c.req.query('days'));
      const repo = c.req.query('repo');
      if (days === undefined || Number.isNaN(days))
        return c.json({ error: DAYS_ERROR }, 400);
      if (fixture?.outage) return c.json({ error: FIXTURE_OUTAGE }, 502);
      if (fixture) return c.json(fixture.usage.trends, 200);
      const res = await usageTrends({
        days,
        ...(repo !== undefined ? { repo } : {}),
      });
      if (!res.ok) return c.json({ error: res.error }, 502);
      return c.json(res.data ?? null, 200);
    })
    .get('/api/usage/status', async c => {
      if (fixture?.outage) return c.json({ error: FIXTURE_OUTAGE }, 502);
      if (fixture) return c.json(fixture.usage.status, 200);
      const res = await usageStatus();
      if (!res.ok) return c.json({ error: res.error }, 502);
      return c.json(res.data ?? null, 200);
    });
}

export const usage = usageRoutes();
