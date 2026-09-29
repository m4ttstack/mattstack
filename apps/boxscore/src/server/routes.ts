import { Hono } from 'hono';
import type { Context } from 'hono';

import { deckAppUrl } from '@mattstack/app-server/event-bridge';
import type { CacheStatsResponse, ColdCacheResponse } from '../shared/types.js';
import { ConfigError, readSettings } from './config/index.js';
import {
  fixtureColdCache,
  fixtureDetail,
  fixtureLeaderboard,
  fixtureMode,
  fixtureRefresh,
  fixtureScenario,
} from './fixture/index.js';
import {
  ColdCacheError,
  getLeaderboard,
  getUserDetail,
  UnknownUserError,
} from './leaderboard.js';
import {
  cancelRefresh,
  getRefresh,
  startRefresh,
  toStatusResponse,
} from './refresh/index.js';
import { getStore } from './store/index.js';
import { resolveWindowArgs } from './util/window.js';

const boolQuery = (c: Context, name: string): boolean =>
  c.req.query(name) === '1' || c.req.query(name) === 'true';

/** The window from query params, or the 400 response to return for bad bounds.
    No return-type annotation: an explicit `TimeWindow | Response` union collapses
    Hono's response-schema inference for every handler using it. */
function windowFromQuery(c: Context) {
  try {
    return resolveWindowArgs(
      c.req.query('range'),
      c.req.query('start'),
      c.req.query('end'),
      readSettings().defaultRange
    );
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
}

const leaderboard = new Hono()
  .get('/api/leaderboard', async c => {
    if (fixtureMode())
      return fixtureScenario() === 'cold-stalled'
        ? c.json(fixtureColdCache(), 200)
        : c.json(fixtureLeaderboard(boolQuery(c, 'trend')));
    const window = windowFromQuery(c);
    if (window instanceof Response) return window;

    const refresh = boolQuery(c, 'refresh');
    const trend = boolQuery(c, 'trend');
    const cacheOnly = boolQuery(c, 'cacheOnly');

    try {
      const result = await getLeaderboard({
        window,
        refresh,
        trend,
        cacheOnly,
      });
      return c.json(result);
    } catch (err) {
      if (err instanceof ColdCacheError) {
        const cold: ColdCacheResponse = {
          cached: false,
          window,
          scope: err.scope,
        };
        return c.json(cold, 200);
      }
      if (err instanceof ConfigError)
        return c.json({ error: err.message }, 400);
      console.error('[leaderboard] failed:', err);
      return c.json({ error: (err as Error).message ?? 'Internal error' }, 500);
    }
  })
  .get('/api/detail', async c => {
    const user = c.req.query('user');
    if (!user) return c.json({ error: 'user query param is required' }, 400);
    if (fixtureMode()) {
      const detail = fixtureDetail(user, boolQuery(c, 'trend'));
      return detail
        ? c.json(detail)
        : c.json({ error: `unknown user: ${user}` }, 404);
    }

    const window = windowFromQuery(c);
    if (window instanceof Response) return window;

    const refresh = boolQuery(c, 'refresh');
    const trend = boolQuery(c, 'trend');

    try {
      const result = await getUserDetail({ window, refresh, trend, user });
      return c.json(result);
    } catch (err) {
      if (err instanceof UnknownUserError)
        return c.json({ error: err.message }, 404);
      if (err instanceof ConfigError)
        return c.json({ error: err.message }, 400);
      console.error('[detail] failed:', err);
      return c.json({ error: (err as Error).message ?? 'Internal error' }, 500);
    }
  })
  .get('/api/links', async c => {
    const url = fixtureMode() ? null : await deckAppUrl('console');
    return c.json({ console: url ?? 'https://console.mattstack' });
  });

const jobs = new Hono()
  .post('/api/refresh', c => {
    if (fixtureMode()) return c.json(fixtureRefresh());
    const window = windowFromQuery(c);
    if (window instanceof Response) return window;
    const trend = boolQuery(c, 'trend');
    const job = startRefresh({
      window,
      trend,
      selection: {
        range: c.req.query('range') ?? readSettings().defaultRange,
        start: c.req.query('start'),
        end: c.req.query('end'),
        trend,
      },
    });
    return c.json(toStatusResponse(job));
  })
  .get('/api/refresh/:id', async c => {
    if (fixtureMode()) return c.json(fixtureRefresh());
    const job = getRefresh(c.req.param('id'));
    if (!job) return c.json({ error: 'unknown job' }, 404);
    return c.json(toStatusResponse(job));
  })
  .post('/api/refresh/:id/cancel', c => {
    if (fixtureMode())
      return c.json({ ...fixtureRefresh(), status: 'cancelled' as const });
    const job = cancelRefresh(c.req.param('id'));
    if (!job) return c.json({ error: 'unknown job' }, 404);
    return c.json(toStatusResponse(job));
  });

const cache = new Hono()
  .get('/api/cache/stats', async c => {
    const store = getStore();
    const counts = store.counts();
    const stats: CacheStatsResponse = {
      mrDetails: counts.mrMetrics,
      mrList: counts.mrIndex,
      linearIds: store.linearIdStats(),
    };
    return c.json(stats);
  })
  .post('/api/cache/clear', async c => {
    getStore().clear();
    return c.json({ cleared: true });
  });

// Routes are CHAINED and handlers INLINE, both load-bearing for Hono's RPC inference:
// a handler lifted into a named function loses path-param typing, and an unchained
// app.get(...) never reaches `typeof routes`.
export const routes = leaderboard.route('/', jobs).route('/', cache);
export type AppType = typeof routes;
