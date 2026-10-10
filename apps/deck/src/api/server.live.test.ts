import { mkdirSync, realpathSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';

import { clearLive, getLive } from '../../core/settings.ts';
import { FakeEdgeProxy } from '../edge/portless.ts';
import { FakeTunnelDriver } from '../edge/tunnel.ts';
import type { LiveDeps } from '../live/engine.ts';
import { clearSetup, runSetup, setupFor } from '../live/setup.ts';
import {
  freshChat,
  gitRepo,
  managerOf,
  manifest,
  SERVER,
  UI,
} from '../live/test-kit.ts';
import { setServeShapeDeps } from './register.ts';
import { startApi } from './server.ts';
import { logsDir } from './state.ts';

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
  for (const k of Object.keys(live)) delete live[k as keyof LiveDeps];
  Object.assign(live, kit.deps());
});
afterEach(() => {
  clearLive('chat');
  clearSetup('chat');
  setServeShapeDeps({});
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

test('DELETE of a live app brings the normal service back', async () => {
  setServeShapeDeps({ devMode: () => true, catalog: null, helpersDir: null });
  writeFileSync(
    join(kit.shared, 'apps/chat/mattstack.deck.json'),
    JSON.stringify({
      name: 'chat',
      port: 11002,
      dev: { start: 'bun src/server/index.ts' },
      live: [SERVER, UI],
    })
  );
  await api('/api/v1/apps/chat/live', {
    method: 'PUT',
    body: JSON.stringify({ source: kit.shared }),
  });
  expect(kit.manager.installed.has('com.mattstack.deck.chat')).toBe(false);
  await api('/api/v1/apps/chat/live', { method: 'DELETE' });
  expect(kit.manager.installed.has('com.mattstack.deck.chat')).toBe(true);
  expect(
    [...kit.manager.installed.keys()].filter(l => l.includes('.live.'))
  ).toEqual([]);
});

test('DELETE during a running setup cancels the go-live', async () => {
  const wt = realpathSync(
    gitRepo({ 'apps/chat/mattstack.deck.json': manifest([SERVER, UI]) })
  );
  let finish!: (code: number) => void;
  Object.assign(live, {
    sources: {
      exists: p => !p.endsWith('.deck-live-ready'),
      list: async () => [
        ...kit.trees(),
        {
          path: wt,
          branch: 'main',
          kind: 'unmanaged',
          state: null,
          repoName: 'r',
          readyAt: null,
        },
      ],
    },
    setup: { run: () => new Promise<number>(res => (finish = res)) },
  } satisfies LiveDeps);
  const put = await api('/api/v1/apps/chat/live', {
    method: 'PUT',
    body: JSON.stringify({ source: wt }),
  });
  expect(put.status).toBe(202);
  expect(
    (await api('/api/v1/apps/chat/live', { method: 'DELETE' })).status
  ).toBe(200);
  expect(setupFor('chat')).toBeUndefined();
  finish(0);
  await new Promise(res => setTimeout(res, 20));
  expect(getLive('chat')).toBeUndefined();
  expect(kit.manager.installed.has('com.mattstack.deck.chat')).toBe(true);
});

test('the live reads answer 403 to a caller that is not local', async () => {
  const remote = { headers: { 'cf-connecting-ip': '203.0.113.9' } };
  expect((await api('/api/v1/live', remote)).status).toBe(403);
  expect((await api('/api/v1/apps/chat/live/sources', remote)).status).toBe(
    403
  );
});

test('PUT refuses outside dev mode', async () => {
  live.devMode = () => false;
  const res = await api('/api/v1/apps/chat/live', {
    method: 'PUT',
    body: JSON.stringify({ source: kit.shared }),
  });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({
    error: 'live mode only runs in the dev app',
  });
  expect(getLive('chat')).toBeUndefined();
});

test('logs of a live process: the tail for a known id, 400 otherwise', async () => {
  await api('/api/v1/apps/chat/live', {
    method: 'PUT',
    body: JSON.stringify({ source: kit.shared }),
  });
  mkdirSync(logsDir(), { recursive: true });
  writeFileSync(join(logsDir(), 'chat.live.ui.out.log'), 'ready\n');
  writeFileSync(join(logsDir(), 'chat.live.ui.err.log'), 'one\ntwo\n');
  const ok = await api('/api/v1/apps/chat/logs?process=ui');
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({
    lines: ['stdout', 'ready', 'stderr', 'one', 'two'],
  });
  writeFileSync(join(logsDir(), 'chat.live.ui.out.log'), '');
  expect(await (await api('/api/v1/apps/chat/logs?process=ui')).json()).toEqual(
    { lines: ['stderr', 'one', 'two'] }
  );
  for (const bad of ['nope', '../x', 'ui/../../x'])
    expect(
      (await api(`/api/v1/apps/chat/logs?process=${encodeURIComponent(bad)}`))
        .status
    ).toBe(400);
});

test('logs of a live process: 400 when the app is not live', async () => {
  expect((await api('/api/v1/apps/chat/logs?process=ui')).status).toBe(400);
});

test('DELETE live/setup dismisses a failed setup and leaves the app live', async () => {
  await api('/api/v1/apps/chat/live', {
    method: 'PUT',
    body: JSON.stringify({ source: kit.shared }),
  });
  await runSetup('chat', '/wt/a', 'a', { run: async () => 1 });
  expect(setupFor('chat')?.state).toBe('failed');
  const res = await api('/api/v1/apps/chat/live/setup', { method: 'DELETE' });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(setupFor('chat')).toBeUndefined();
  expect(getLive('chat')).toBeDefined();
});

test('DELETE live/setup answers 409 while setup is running', async () => {
  let finish!: (code: number) => void;
  const running = runSetup('chat', '/wt/a', 'a', {
    run: () => new Promise<number>(res => (finish = res)),
  });
  const res = await api('/api/v1/apps/chat/live/setup', { method: 'DELETE' });
  expect(res.status).toBe(409);
  finish(0);
  await running;
});
