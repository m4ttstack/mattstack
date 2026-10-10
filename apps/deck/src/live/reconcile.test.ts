import { realpathSync, rmSync } from 'fs';
import { afterEach, beforeEach, expect, test } from 'bun:test';

import { clearLive, getLive, setLive } from '../../core/settings.ts';
import { reconcileLive } from './reconcile.ts';
import {
  freshChat,
  gitRepo,
  manifest,
  routes,
  SERVER,
  UI,
} from './test-kit.ts';

let { shared, manager, deps } = freshChat();
beforeEach(() => {
  ({ shared, manager, deps } = freshChat());
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

test('live state for a removed app is dropped', async () => {
  setLive('ghost', { source: shared, branch: 'main', startedAt: 'x' });
  await reconcileLive(manager, deps());
  expect(getLive('ghost')).toBeUndefined();
});
