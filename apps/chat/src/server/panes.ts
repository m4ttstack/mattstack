import { paneFocus, type RtClientOptions } from '@mattstack/rt-client';
import { Hono } from 'hono';

import { fixtureFocus, fixturesEnabled } from './fixtures';

function rtOpts(): RtClientOptions {
  return { sockPath: process.env.RT_SOCK_PATH };
}

export const panes = new Hono().post('/api/panes/:id/focus', async c => {
  const paneId = c.req.param('id');
  if (fixturesEnabled()) return c.json(fixtureFocus(paneId), 200);
  const res = await paneFocus({ paneId }, rtOpts());
  if (!res.ok) return c.json({ error: res.error }, 502);
  return c.json(res.data, 200);
});
