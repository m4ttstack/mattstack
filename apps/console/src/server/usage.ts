import {
  usageMr,
  usageMrs,
  usageStatus,
  usageTrends,
} from '@mattstack/rt-client';
import { Hono } from 'hono';

import {
  FIXTURE_OUTAGE,
  type RunsFixture,
} from './fixtures/design/runsFixture';

/** `days` off the query string: absent is undefined, junk is NaN. */
function parseDays(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  return /^\d+$/.test(raw) ? Number(raw) : NaN;
}

/**
 * The usage reads, proxied to the daemon. Like `runsRoutes`, every
 * `ok: false` is a 502 with the daemon's error. `mrKey` rides the query
 * string, percent-encoded once by the caller; Hono decodes it back to the
 * daemon's `remote:host%2Fpath!n` key. An unknown key is a 200 with null
 * data, as the daemon answers.
 */
export function usageRoutes(fixture: RunsFixture | null = null) {
  return new Hono()
    .get('/api/usage/mrs', async c => {
      const days = parseDays(c.req.query('days'));
      const repo = c.req.query('repo');
      if (Number.isNaN(days))
        return c.json({ error: 'days must be a number' }, 400);
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
    .get('/api/usage/trends', async c => {
      const days = parseDays(c.req.query('days'));
      const repo = c.req.query('repo');
      if (days === undefined || Number.isNaN(days))
        return c.json({ error: 'days is required and must be a number' }, 400);
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
