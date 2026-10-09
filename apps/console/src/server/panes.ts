import { paneFocus } from '@mattstack/rt-client';
import { Hono } from 'hono';

import {
  FIXTURE_READ_ONLY,
  type RunsFixture,
} from './fixtures/design/runsFixture';

/** A design `fixture`'s panes are invented, so focusing one is refused. */
export const panesRoutes = (fixture: RunsFixture | null = null) =>
  new Hono().post('/api/panes/:id/focus', async c => {
    if (fixture) return c.json({ error: FIXTURE_READ_ONLY }, 409);
    const res = await paneFocus(
      { paneId: c.req.param('id') },
      { sockPath: process.env.RT_SOCK_PATH }
    );
    if (!res.ok) return c.json({ error: res.error }, 502);
    return c.json(res.data);
  });

export const panes = panesRoutes();
