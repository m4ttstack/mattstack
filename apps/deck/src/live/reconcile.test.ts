import { realpathSync, rmSync } from 'fs';
import { afterEach, beforeEach, expect, test } from 'bun:test';

import { clearLive, getLive, setLive } from '../../core/settings.ts';
import { putRecord } from '../registry/records.ts';
import { stopLive } from './engine.ts';
import { reconcileLive } from './reconcile.ts';
import {
  freshChat,
  gitRepo,
  manifest,
  routes,
  SERVER,
  UI,
} from './test-kit.ts';

let { shared, manager, deps, record } = freshChat();
beforeEach(() => {
  ({ shared, manager, deps, record } = freshChat());
});
afterEach(() => clearLive('chat'));

test('a deleted worktree moves the app to live from main and remembers the branch', async () => {
  const wt = realpathSync(
    gitRepo({ 'apps/chat/mattstack.deck.json': manifest([SERVER, UI]) })
  );
  setLive('chat', {
    source: wt,
    branch: 'deck-live-mode',
    startedAt: 'x',
    uiPort: 11140,
  });
  rmSync(wt, { recursive: true, force: true });
  await reconcileLive(manager, deps());
  expect(getLive('chat')).toMatchObject({
    source: shared,
    branch: 'main',
    uiPort: 11140,
    movedFrom: 'deck-live-mode',
  });
  expect(manager.installed.has('com.mattstack.deck.chat.live.ui')).toBe(true);
  expect(routes().map(r => r.port)).toEqual([11140, 11140]);
});

test('a live app whose routes drifted is pointed back at its UI', async () => {
  setLive('chat', {
    source: shared,
    branch: 'main',
    startedAt: 'x',
    uiPort: 11140,
  });
  await reconcileLive(manager, deps());
  expect(routes().map(r => r.port)).toEqual([11140, 11140]);
});

test('live state for a removed app is dropped and its live processes stop', async () => {
  setLive('ghost', { source: shared, branch: 'main', startedAt: 'x' });
  manager.installed.set('com.mattstack.deck.ghost.live.server', {} as never);
  await reconcileLive(manager, deps());
  expect(getLive('ghost')).toBeUndefined();
  expect(manager.installed.has('com.mattstack.deck.ghost.live.server')).toBe(
    false
  );
});

const liveLabels = () =>
  [...manager.installed.keys()].filter(l => l.includes('.live.'));

test('a disabled live app is stopped instead of reinstalled', async () => {
  setLive('chat', {
    source: shared,
    branch: 'main',
    startedAt: 'x',
    uiPort: 11140,
  });
  putRecord({ ...record(), enabled: false });
  await reconcileLive(manager, deps());
  expect(getLive('chat')).toBeUndefined();
  expect(liveLabels()).toEqual([]);
  expect(routes().map(r => r.port)).toEqual([11002, 11002]);
});

test('a stop racing a tick leaves no live services and routes on the app port', async () => {
  setLive('chat', {
    source: shared,
    branch: 'main',
    startedAt: 'x',
    uiPort: 11140,
  });
  await Promise.all([
    reconcileLive(manager, deps()),
    stopLive('chat', manager, deps()),
  ]);
  expect(getLive('chat')).toBeUndefined();
  expect(liveLabels()).toEqual([]);
  expect(routes().map(r => r.port)).toEqual([11002, 11002]);
});

test('a live app whose normal service reappears loses it on the next tick', async () => {
  setLive('chat', {
    source: shared,
    branch: 'main',
    startedAt: 'x',
    uiPort: 11140,
  });
  await reconcileLive(manager, deps());
  manager.installed.set('com.mattstack.deck.chat', {} as never);
  await reconcileLive(manager, deps());
  expect(manager.installed.has('com.mattstack.deck.chat')).toBe(false);
  expect(liveLabels().length).toBe(2);
});
