import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';

import { clearLive, getLive } from '../../core/settings.ts';
import { FakeEdgeProxy } from '../edge/portless.ts';
import { FakeTunnelDriver } from '../edge/tunnel.ts';
import type { LiveDeps } from '../live/engine.ts';
import { clearSetup, runSetup, setupFor } from '../live/setup.ts';
import { freshChat, managerOf } from '../live/test-kit.ts';
import { startApi } from './server.ts';

const PORT = 18951;
let kit = freshChat();
const live: LiveDeps = {};
const server = startApi({
  manager: managerOf(() => kit.manager),
  edge: new FakeEdgeProxy(),
  tunnel: new FakeTunnelDriver(),
  port: PORT,
  canaryPort: PORT + 1,
  freshness: () => 'unknown',
  autoHeal: () => null,
  onRouteWrite: () => {},
  devMode: () => true,
  live,
});
beforeEach(() => {
  kit = freshChat();
  Object.assign(live, kit.deps());
});
afterEach(() => {
  clearLive('chat');
  clearSetup('chat');
});
afterAll(() => server.stop(true));

const api = (path: string, init?: RequestInit) =>
  fetch(`http://127.0.0.1:${PORT}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });

test('sources lists main with the apps live from it', async () => {
  const res = await api('/api/v1/apps/chat/live/sources');
  expect(res.status).toBe(200);
  const body = (await res.json()) as { sources: unknown[] };
  expect(body.sources[0]).toMatchObject({
    path: kit.shared,
    main: true,
    liveApps: [],
  });
});

test('PUT goes live, GET /live lists it, DELETE stops it', async () => {
  const put = await api('/api/v1/apps/chat/live', {
    method: 'PUT',
    body: JSON.stringify({ source: kit.shared }),
  });
  expect(put.status).toBe(200);
  const list = (await (await api('/api/v1/live')).json()) as {
    apps: unknown[];
  };
  expect(list.apps).toEqual([
    {
      name: 'chat',
      source: kit.shared,
      branch: 'main',
      startedAt: expect.any(String),
    },
  ]);
  expect(
    (await api('/api/v1/apps/chat/live', { method: 'DELETE' })).status
  ).toBe(200);
  expect(getLive('chat')).toBeUndefined();
});

test('restart on a live app kickstarts its live services', async () => {
  await api('/api/v1/apps/chat/live', {
    method: 'PUT',
    body: JSON.stringify({ source: kit.shared }),
  });
  kit.manager.kickstarts.length = 0;
  const res = await api('/api/v1/apps/chat/restart', { method: 'POST' });
  expect(await res.json()).toEqual({ ok: true });
  expect(kit.manager.kickstarts.sort()).toEqual([
    'com.mattstack.deck.chat.live.server',
    'com.mattstack.deck.chat.live.ui',
  ]);
});

test('sources for an unknown app is a 404', async () => {
  const res = await api('/api/v1/apps/nope/live/sources');
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'unknown app' });
});

test('a cross-origin page cannot go live', async () => {
  const res = await api('/api/v1/apps/chat/live', {
    method: 'PUT',
    body: JSON.stringify({ source: kit.shared }),
    headers: { origin: 'https://evil.example' },
  });
  expect(res.status).toBe(403);
});

test('DELETE on an app that is not live dismisses a failed setup', async () => {
  await runSetup('chat', '/wt/a', 'a', { run: async () => 1 });
  expect(
    (await api('/api/v1/apps/chat/live', { method: 'DELETE' })).status
  ).toBe(200);
  expect(setupFor('chat')).toBeUndefined();
});
