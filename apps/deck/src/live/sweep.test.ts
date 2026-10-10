import { afterEach, beforeEach, expect, test } from 'bun:test';

import { clearLive, getLive, setLive } from '../../core/settings.ts';
import {
  reresolveManagedApps,
  setLiveSweepDeps,
  setServeShapeDeps,
} from '../api/register.ts';
import { FakeEdgeProxy } from '../edge/portless.ts';
import { freshChat } from './test-kit.ts';

let { shared, manager, deps } = freshChat();
beforeEach(() => {
  ({ shared, manager, deps } = freshChat());
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
  await reresolveManagedApps({ manager, edge: new FakeEdgeProxy() });
  expect(getLive('chat')).toBeUndefined();
  expect(manager.installed.has('com.mattstack.deck.chat.live.server')).toBe(
    false
  );
});
