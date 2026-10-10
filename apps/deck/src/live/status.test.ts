import { afterEach, beforeEach, expect, test } from 'bun:test';

import { clearLive, setLive } from '../../core/settings.ts';
import { clearSetup, runSetup } from './setup.ts';
import { liveRowFields } from './status.ts';
import { commit, freshChat, manifest, SERVER, UI } from './test-kit.ts';

let { shared, record } = freshChat();
beforeEach(() => {
  ({ shared, record } = freshChat());
});
afterEach(() => {
  clearLive('chat');
  clearSetup('chat');
});

const ON = { devMode: true, local: true };

test('nothing for a user app, prod or a public caller', async () => {
  expect(
    await liveRowFields({ ...record(), managedBy: 'user' }, ON, [])
  ).toEqual({});
  expect(
    await liveRowFields(record(), { devMode: false, local: true }, [])
  ).toEqual({});
  expect(
    await liveRowFields(record(), { devMode: true, local: false }, [])
  ).toEqual({});
});

test('a linked app with a valid live list can go live', async () => {
  expect(await liveRowFields(record(), ON, [])).toEqual({ liveBlocked: null });
});

test('a broken live list says why', async () => {
  commit(shared, { 'apps/chat/mattstack.deck.json': manifest([UI]) });
  expect(await liveRowFields(record(), ON, [])).toEqual({
    liveBlocked: 'no server in the live list',
  });
});

test('a live app lists its processes and which are running', async () => {
  setLive('chat', {
    source: shared,
    branch: 'main',
    startedAt: 't',
    uiPort: 11140,
  });
  const f = await liveRowFields(record(), ON, [], async port => port === 11002);
  expect(f.live).toEqual({
    branch: 'main',
    main: true,
    startedAt: 't',
    uiPort: 11140,
    movedFrom: null,
    processes: [
      {
        id: 'server',
        kind: 'server',
        command: SERVER.start,
        port: 11002,
        running: true,
      },
      { id: 'ui', kind: 'ui', command: UI.start, port: 11140, running: false },
    ],
  });
});

test('a failed setup carries its log', async () => {
  await runSetup('chat', '/wt/a', 'a', {
    run: async (_c, _d, on) => (on('boom'), 1),
  });
  expect((await liveRowFields(record(), ON, [])).liveSetup).toEqual({
    state: 'failed',
    branch: 'a',
    log: ['$ bun install', 'boom'],
  });
});
