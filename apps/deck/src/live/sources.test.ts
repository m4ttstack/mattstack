import { mkdirSync, realpathSync, writeFileSync } from 'fs';
import { join } from 'path';
import { expect, test } from 'bun:test';

import { gitRepo } from '../../test/git-fixture.ts';
import type { AppRecord } from '../registry/records.ts';
import { readyMarker } from './setup.ts';
import {
  appDirIn,
  branchOf,
  listLiveSources,
  sharedRootFor,
  type TreeRow,
} from './sources.ts';

const root = realpathSync(gitRepo({ 'apps/chat/mattstack.deck.json': '{}' }));
const record = {
  name: 'chat',
  managedBy: 'rt',
  port: 11002,
  kind: 'service',
  createdAt: '',
  dev: { workingDirectory: join(root, 'apps/chat') },
} as AppRecord;

const row = (over: Partial<TreeRow>): TreeRow => ({
  path: '/wt/x',
  branch: 'x',
  kind: 'ephemeral',
  state: 'claimed',
  repoName: 'remote:mattstack',
  readyAt: '2026-10-01T00:00:00Z',
  lastActiveAt: null,
  ...over,
});

test('sharedRootFor is the git toplevel of the linked source', () => {
  expect(sharedRootFor(record)).toBe(root);
  expect(sharedRootFor({ ...record, dev: undefined })).toBeNull();
});

test('appDirIn keeps the app path relative to the checkout', () => {
  expect(appDirIn(record, '/wt/feature', root)).toBe('/wt/feature/apps/chat');
});

test('branchOf reads the checked out branch', () => {
  expect(branchOf(root)).toBe('main');
  expect(branchOf('/no/such/dir')).toBeNull();
});

test('main first, then claimed and unmanaged trees of the same repo by last use', async () => {
  const { sources, error } = await listLiveSources(root, {
    exists: p => !p.endsWith('.deck-live-ready') && p !== '/wt/missing',
    list: async () => [
      row({ path: root, kind: 'main', state: null, branch: 'main' }),
      row({
        path: '/wt/old',
        branch: 'old',
        lastActiveAt: '2026-10-01T00:00:00Z',
      }),
      row({
        path: '/wt/new',
        branch: 'new',
        lastActiveAt: '2026-10-09T00:00:00Z',
      }),
      row({ path: '/wt/golden', kind: 'golden', state: null, branch: null }),
      row({ path: '/wt/spare', state: 'on-deck', branch: 'on-deck/spare' }),
      row({ path: '/wt/fresh', state: 'creating', branch: 'fresh' }),
      row({ path: '/wt/done', state: 'disposable', branch: 'done' }),
      row({ path: '/gitq/work/abc/gitq-3', branch: 'surgery' }),
      row({ path: '/wt/.trash-x-123', branch: 'trashed' }),
      row({ path: '/wt/missing', branch: 'missing' }),
      row({
        path: '/wt/hand',
        kind: 'unmanaged',
        state: null,
        readyAt: null,
        branch: 'hand',
      }),
      row({ path: '/other', repoName: 'remote:other', branch: 'other' }),
    ],
  });
  expect(error).toBeNull();
  expect(sources.map(s => [s.branch, s.main, s.needsSetup])).toEqual([
    ['main', true, false],
    ['new', false, false],
    ['old', false, false],
    ['hand', false, true],
  ]);
});

test('an unready tree needs setup until a finished install marks it ready', async () => {
  const wt = realpathSync(gitRepo({ 'a.txt': 'a' }));
  mkdirSync(join(wt, 'node_modules'));
  const list = async () =>
    (
      await listLiveSources(root, {
        list: async () => [
          row({ path: root, kind: 'main', state: null, branch: 'main' }),
          row({ path: wt, kind: 'unmanaged', state: null, readyAt: null }),
        ],
      })
    ).sources[1]!.needsSetup;
  expect(await list()).toBe(true);
  writeFileSync(readyMarker(wt), '');
  expect(await list()).toBe(false);
});

test('an unreachable rt daemon still offers main', async () => {
  const { sources, error } = await listLiveSources(root, {
    list: async () => {
      throw new Error('rt daemon unreachable');
    },
  });
  expect(sources).toEqual([
    {
      path: root,
      branch: 'main',
      main: true,
      needsSetup: false,
      lastActiveAt: null,
    },
  ]);
  expect(error).toBe('rt daemon unreachable');
});
