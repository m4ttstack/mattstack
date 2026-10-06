// @vitest-environment node
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { EMBED_FRAME_ANCESTORS, routes } from './routes';

const app = new Hono().route('/', routes).get('*', c => c.text('spa'));

describe('embed framing', () => {
  it("limits who may frame the embed page to the suite's own pages", async () => {
    const res = await app.request('/embed/settings/board');
    expect(res.headers.get('content-security-policy')).toBe(
      EMBED_FRAME_ANCESTORS
    );
  });

  it('leaves every other page alone', async () => {
    const res = await app.request('/settings');
    expect(res.headers.get('content-security-policy')).toBeNull();
  });
});
