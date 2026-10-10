import { realpathSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, expect, test } from 'bun:test';

import { commit, freshChat, gitRepo, manifest, routes, SERVER, UI } from './test-kit.ts';
import { clearLive, getLive, getOverride, setOverride } from '../../core/settings.ts';
import { clearSetup, setupFor } from './setup.ts';
import { goLive, liveRefusal, liveSpecs, stopLive } from './engine.ts';

let { shared, manager, trees, deps } = freshChat();
beforeEach(() => {
  ({ shared, manager, trees, deps } = freshChat());
});

afterEach(() => {
  clearLive('chat');
  clearSetup('chat');
});

test('only a linked mattstack app in dev mode can go live', () => {
  expect(liveRefusal(undefined, true)).toBe('unknown app');
  const rec = { name: 'chat', managedBy: 'rt', port: 1, kind: 'service', createdAt: '' } as never;
  expect(liveRefusal(rec, false)).toBe('live mode only runs in the dev app');
  expect(liveRefusal({ ...(rec as object), managedBy: 'user' } as never, true)).toBe('only mattstack apps can go live');
  expect(liveRefusal({ ...(rec as object), managedBy: 'deck' } as never, true)).toBe('deck itself cannot go live');
  expect(liveRefusal(rec, true)).toBe('chat has no linked source');
});

test('going live swaps the normal service for one per process and moves both routes', async () => {
  const r = await goLive('chat', shared, manager, deps());
  expect(r.status).toBe(200);
  expect([...manager.installed.keys()].sort()).toEqual([
    'com.mattstack.deck.chat.live.server',
    'com.mattstack.deck.chat.live.ui',
  ]);
  const live = getLive('chat')!;
  expect(live).toMatchObject({ source: shared, branch: 'main', startedAt: '2026-10-09T21:12:00.000Z' });
  expect(routes().map(x => x.port)).toEqual([live.uiPort!, live.uiPort!]);
  const ui = manager.installed.get('com.mattstack.deck.chat.live.ui')!;
  expect(ui.workingDirectory).toBe(join(shared, 'apps/chat'));
  expect(ui.environment.PORT).toBe(String(live.uiPort));
  expect(ui.environment.SERVER_PORT).toBe('11002');
  const server = manager.installed.get('com.mattstack.deck.chat.live.server')!;
  expect(server.environment.PORT).toBe('11002');
});

test('an app with no ui keeps its routes on its own port', async () => {
  commit(shared, { 'apps/chat/mattstack.deck.json': manifest([SERVER]) });
  expect((await goLive('chat', shared, manager, deps())).status).toBe(200);
  expect(getLive('chat')!.uiPort).toBeUndefined();
  expect(routes().map(x => x.port)).toEqual([11002, 11002]);
});

test('a manual override is cleared and stopping leaves both routes on the app port', async () => {
  setOverride('chat', { devPort: 5173, basePort: 11002 });
  await goLive('chat', shared, manager, deps());
  expect(getOverride('chat')).toBeUndefined();
  const r = await stopLive('chat', manager, deps());
  expect(r.status).toBe(200);
  expect(routes().map(x => x.port)).toEqual([11002, 11002]);
  expect(getLive('chat')).toBeUndefined();
  expect([...manager.installed.keys()]).toEqual([]);
});

test('stop removes every live label, even one the manifest no longer names', async () => {
  await goLive('chat', shared, manager, deps());
  manager.installed.set('com.mattstack.deck.chat.live.worker-1', {} as never);
  await stopLive('chat', manager, deps());
  expect([...manager.installed.keys()]).toEqual([]);
});

test('a source with no valid live list is refused and nothing changes', async () => {
  commit(shared, { 'apps/chat/mattstack.deck.json': manifest([UI]) });
  const r = await goLive('chat', shared, manager, deps());
  expect(r).toEqual({ status: 400, body: { error: "can't go live: no server in the live list" } });
  expect([...manager.installed.keys()]).toEqual(['com.mattstack.deck.chat']);
  expect(getLive('chat')).toBeUndefined();
});

test('a worktree without the app is refused', async () => {
  const wt = realpathSync(gitRepo({ 'README.md': 'x' }));
  const r = await goLive('chat', wt, manager, deps({
    sources: {
      exists: () => true,
      listTrees: async () => [...trees(), { path: wt, branch: 'wt', kind: 'unmanaged', state: null, repoName: 'r' }],
    },
  }));
  expect(r).toEqual({ status: 400, body: { error: 'that checkout has no apps/chat' } });
});

test('a path that is not one of the listed sources is refused', async () => {
  const r = await goLive('chat', '/tmp/elsewhere', manager, deps());
  expect(r.status).toBe(400);
});

test('a worktree that needs setup answers 202, then goes live when setup passes', async () => {
  const wt = realpathSync(gitRepo({ 'apps/chat/mattstack.deck.json': manifest([SERVER, UI]) }));
  let finish!: (code: number) => void;
  const r = await goLive('chat', wt, manager, deps({
    sources: {
      exists: () => false,
      listTrees: async () => [...trees(), { path: wt, branch: 'main', kind: 'unmanaged', state: null, repoName: 'r', readyAt: null }],
    },
    setup: { run: () => new Promise<number>(res => (finish = res)) },
  }));
  expect(r.status).toBe(202);
  expect(setupFor('chat')?.state).toBe('running');
  expect(manager.installed.has('com.mattstack.deck.chat')).toBe(true);
  finish(0);
  await new Promise(res => setTimeout(res, 20));
  expect(getLive('chat')?.source).toBe(wt);
  expect(manager.installed.has('com.mattstack.deck.chat')).toBe(false);
});

test('liveSpecs gives workers no PORT and numbers them', () => {
  const rec = { name: 'chat', managedBy: 'rt', port: 11002, kind: 'service', createdAt: '' } as never;
  const specs = liveSpecs(rec, [{ kind: 'server', start: 'echo a' }, { kind: 'worker', start: 'echo b' }], '/x', null);
  expect(specs.map(s => s.label)).toEqual([
    'com.mattstack.deck.chat.live.server',
    'com.mattstack.deck.chat.live.worker-1',
  ]);
  expect(specs[1]!.environment.PORT).toBeUndefined();
  expect(specs[1]!.environment.SERVER_PORT).toBe('11002');
});

test('a failed install stops live and asks for the normal service back', async () => {
  let reinstalled = 0;
  manager.failNext = 'com.mattstack.deck.chat.live.server';
  const r = await goLive('chat', shared, manager, deps({ reinstall: async () => void reinstalled++ }));
  expect(r.status).toBe(500);
  expect(getLive('chat')).toBeUndefined();
  expect(reinstalled).toBe(1);
});
