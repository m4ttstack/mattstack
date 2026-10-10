import { settingsHandler } from '@mattstack/settings-kit/server';
import { Hono } from 'hono';

/**
 * Who you are and your org and team, for the top bar's scope pills and
 * role. Only settings-kit's read-only viewer route is mounted: chat edits no
 * settings.
 */
export const viewer = new Hono().get('/api/settings/viewer', async c => {
  const res = await settingsHandler(c.req.raw, {});
  return res ?? c.json({ error: 'not found' }, 404);
});
