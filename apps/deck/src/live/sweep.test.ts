import { writeFileSync } from 'fs';
import { afterEach, beforeEach, expect, test } from 'bun:test';

import { clearLive, getLive, setLive } from '../../core/settings.ts';
import { applyManifest } from '../api/register-manifest.ts';
import {
  reresolveManagedApps,
  restartManagedApps,
  setLiveSweepDeps,
  setServeShapeDeps,
  unregisterApp,
} from '../api/register.ts';
import { FakeEdgeProxy } from '../edge/portless.ts';
import { getRecord, putRecord } from '../registry/records.ts';
import { goLive } from './engine.ts';
import { freshChat, managerOf, routes } from './test-kit.ts';

let { shared, manager, deps, record } = freshChat();
beforeEach(() => {
  ({ shared, manager, deps, record } = freshChat());
  setLive('chat', {
    source: shared,
    branch: 'main',
    startedAt: 'x',
    uiPort: 11140,
  });
  setLiveSweepDeps(deps());
});
afterEach(() => {
  clearLive('chat');
  setServeShapeDeps({});
  setLiveSweepDeps({});
});

test('the sweep keeps a live app live and its normal service off', async () => {
  setServeShapeDeps({ devMode: () => true, catalog: null, helpersDir: null });
  const r = await reresolveManagedApps({ manager, edge: new FakeEdgeProxy() });
  expect((r.body as { failed: unknown[] }).failed).toEqual([]);
  expect(manager.installed.has('com.mattstack.deck.chat')).toBe(false);
  expect(manager.installed.has('com.mattstack.deck.chat.live.server')).toBe(
    true
  );
  expect(manager.installed.has('com.mattstack.deck.chat.live.ui')).toBe(true);
});

test('prod drops live state and serves normally', async () => {
  setServeShapeDeps({ devMode: () => false, catalog: null, helpersDir: null });
  manager.installed.set('com.mattstack.deck.chat.live.server', {} as never);
  pointRoutesAtLiveUi();
  await reresolveManagedApps({ manager, edge: new FakeEdgeProxy() });
  expect(getLive('chat')).toBeUndefined();
  expect(manager.installed.has('com.mattstack.deck.chat.live.server')).toBe(
    false
  );
  expect(routes().map(r => r.port)).toEqual([11002, 11002]);
});

test('a disabled live app is stopped by the sweep', async () => {
  setServeShapeDeps({ devMode: () => true, catalog: null, helpersDir: null });
  putRecord({ ...record(), enabled: false });
  manager.installed.set('com.mattstack.deck.chat.live.server', {} as never);
  pointRoutesAtLiveUi();
  const r = await reresolveManagedApps({ manager, edge: new FakeEdgeProxy() });
  expect((r.body as { disabled: string[] }).disabled).toEqual(['chat']);
  expect(getLive('chat')).toBeUndefined();
  expect(manager.installed.has('com.mattstack.deck.chat.live.server')).toBe(
    false
  );
  expect(routes().map(r => r.port)).toEqual([11002, 11002]);
});

test('a failed go-live can re-run the sweep without deadlocking', async () => {
  setServeShapeDeps({ devMode: () => true, catalog: null, helpersDir: null });
  clearLive('chat');
  const failing = managerOf(() => manager);
  failing.install = async spec => {
    if (spec.label.includes('.live.')) throw new Error('install refused');
    await manager.install(spec);
  };
  let swept = false;
  const attempt = goLive(
    'chat',
    shared,
    failing,
    deps({
      reinstall: async () => {
        await reresolveManagedApps({
          manager: failing,
          edge: new FakeEdgeProxy(),
        });
        swept = true;
      },
    })
  );
  const timeout = new Promise<'deadlock'>(resolve =>
    setTimeout(() => resolve('deadlock'), 3000)
  );
  const r = await Promise.race([attempt, timeout]);
  expect(r).not.toBe('deadlock');
  expect(swept).toBe(true);
  expect(getLive('chat')).toBeUndefined();
});

function pointRoutesAtLiveUi(): void {
  writeFileSync(
    process.env.LOCAL_APPS_ROUTES_PATH!,
    JSON.stringify([
      { hostname: 'chat.mattstack', port: 11140, pid: 0 },
      { hostname: 'chat.localhost', port: 11140, pid: 0 },
    ])
  );
}

const LIVE_LABELS = [
  'com.mattstack.deck.chat.live.server',
  'com.mattstack.deck.chat.live.ui',
];

function installLiveLabels(): void {
  manager.installed.delete('com.mattstack.deck.chat');
  for (const label of LIVE_LABELS) manager.installed.set(label, {} as never);
}

test('a release restart kickstarts a live app through its live processes', async () => {
  setServeShapeDeps({ devMode: () => true, catalog: null, helpersDir: null });
  installLiveLabels();
  const r = await restartManagedApps({ manager, edge: new FakeEdgeProxy() });
  expect(r.body).toEqual({ ok: true, restarted: ['chat'], failed: [] });
  expect(manager.kickstarts.sort()).toEqual(LIVE_LABELS);
});

test('relinking a live app updates its link without touching its services or routes', async () => {
  setServeShapeDeps({ devMode: () => true, catalog: null, helpersDir: null });
  installLiveLabels();
  pointRoutesAtLiveUi();
  const appDir = record().dev!.workingDirectory;
  putRecord({ ...record(), dev: undefined });
  const edge = new FakeEdgeProxy();
  const r = await applyManifest(appDir, undefined, { manager, edge });
  expect(r.status).toBe(200);
  expect(record().dev?.workingDirectory).toBe(appDir);
  expect([...manager.installed.keys()].sort()).toEqual(LIVE_LABELS);
  expect(edge.aliases.has('chat')).toBe(false);
  expect(routes().map(r => r.port)).toEqual([11140, 11140]);
});

test('removing a live app stops its live processes first', async () => {
  installLiveLabels();
  pointRoutesAtLiveUi();
  const r = await unregisterApp('chat', 'rt', true, {
    manager,
    edge: new FakeEdgeProxy(),
  });
  expect(r.body).toEqual({ ok: true });
  expect(getLive('chat')).toBeUndefined();
  expect([...manager.installed.keys()]).toEqual([]);
  expect(getRecord('chat')).toBeUndefined();
});
