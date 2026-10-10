import { afterEach, beforeEach, expect, test } from 'bun:test';

import { commit, freshChat, manifest, SERVER, UI } from './test-kit.ts';
import { clearLive, setLive } from '../../core/settings.ts';
import { clearSetup, runSetup } from './setup.ts';
import { liveRowFields } from './status.ts';

let { shared, record } = freshChat();
beforeEach(() => {
  ({ shared, record } = freshChat());
});
afterEach(() => {
  clearLive('chat');
  clearSetup('chat');
});

const svc = (label: string, pid: number | null) =>
  ({ label, plistPath: '', program: [], workingDirectory: null, stderrPath: null, port: null, pid, lastExitStatus: null }) as never;
const ON = { devMode: true, local: true };

test('nothing for a user app, prod or a public caller', () => {
  expect(liveRowFields({ ...record(), managedBy: 'user' }, ON, [])).toEqual({});
  expect(liveRowFields(record(), { devMode: false, local: true }, [])).toEqual({});
  expect(liveRowFields(record(), { devMode: true, local: false }, [])).toEqual({});
});

test('a linked app with a valid live list can go live', () => {
  expect(liveRowFields(record(), ON, [])).toEqual({ liveBlocked: null });
});

test('a broken live list says why', () => {
  commit(shared, { 'apps/chat/mattstack.deck.json': manifest([UI]) });
  expect(liveRowFields(record(), ON, [])).toEqual({ liveBlocked: 'no server in the live list' });
});

test('a live app lists its processes and which are running', () => {
  setLive('chat', { source: shared, branch: 'main', startedAt: 't', uiPort: 11140 });
  const f = liveRowFields(record(), ON, [
    svc('com.mattstack.deck.chat.live.server', 41),
    svc('com.mattstack.deck.chat.live.ui', null),
  ]);
  expect(f.live).toEqual({
    branch: 'main',
    main: true,
    startedAt: 't',
    uiPort: 11140,
    movedFrom: null,
    processes: [
      { id: 'server', kind: 'server', command: SERVER.start, port: 11002, running: true },
      { id: 'ui', kind: 'ui', command: UI.start, port: 11140, running: false },
    ],
  });
});

test('a failed setup carries its log', async () => {
  await runSetup('chat', '/wt/a', 'a', { run: async (_c, _d, on) => (on('boom'), 1) });
  expect(liveRowFields(record(), ON, []).liveSetup).toEqual({
    state: 'failed',
    branch: 'a',
    log: ['$ bun install', 'boom'],
  });
});
