import { describe, expect, test } from 'bun:test';

import type { WorktreeSyncData } from '@mattstack/rt-client';
import {
  LIVE_SYNC_LOGS,
  localSyncOutcome,
  startLiveSync,
  syncBranchLocally,
  takeSyncLine,
} from '../local-sync.ts';

const data = (over: Partial<WorktreeSyncData>): WorktreeSyncData => ({
  kind: 'synced',
  path: '/trees/elrond',
  provisioned: false,
  pushed: true,
  oldHead: 'a',
  newHead: 'b',
  refusal: null,
  log: ['[ok] Fetched from origin'],
  ...over,
});

describe('localSyncOutcome', () => {
  test('a pushed sync is clean', () => {
    expect(localSyncOutcome(data({}))).toEqual({
      kind: 'clean',
      message: 'rebased and pushed',
      log: ['[ok] Fetched from origin'],
    });
  });

  test('a sync that did not push stays on the row', () => {
    expect(localSyncOutcome(data({ pushed: false }))).toEqual({
      kind: 'stopped',
      message: 'rebased, not pushed',
      log: ['[ok] Fetched from origin'],
    });
  });

  test('nothing to do is clean', () => {
    expect(localSyncOutcome(data({ kind: 'up-to-date' })).kind).toBe('clean');
  });

  test('a conflict names the paused tree', () => {
    expect(localSyncOutcome(data({ kind: 'conflict' }))).toEqual({
      kind: 'conflict',
      tree: '/trees/elrond',
      log: ['[ok] Fetched from origin'],
    });
  });

  test.each([
    'dirty-tree',
    'stacked-refused',
    'stack-unverified',
    'push-refused',
    'error',
    'no-tree',
  ] as const)('%s stops with the refusal', kind => {
    const out = localSyncOutcome(data({ kind, refusal: 'because' }));
    expect(out.kind).toBe('stopped');
    expect(out).toMatchObject({ message: expect.stringContaining('because') });
  });
});

describe('syncBranchLocally', () => {
  test('a daemon failure stops with the error', async () => {
    const out = await syncBranchLocally('r', 'feat', undefined, (async () => ({
      ok: false,
      error: 'daemon down',
    })) as never);
    expect(out).toEqual({
      kind: 'stopped',
      message: 'rt sync failed: daemon down',
      log: [],
    });
  });
});

test('a paused tree rides along as the tree to sync in', async () => {
  let payload: unknown;
  await syncBranchLocally('r', 'feat', '/trees/paused', (async (
    _verb: string,
    p: unknown
  ) => {
    payload = p;
    return { ok: false, error: 'x' };
  }) as never);
  expect(payload).toEqual({
    repoName: 'r',
    branch: 'feat',
    tree: '/trees/paused',
  });
});

describe('live sync lines', () => {
  test('files a line under the MR whose sync is running, and nothing after it ends', () => {
    const end = startLiveSync('mr-1', 'r', 'feat');
    expect(
      takeSyncLine({
        repoName: 'r',
        branch: 'feat',
        line: '[ok] Fetched from origin',
      })
    ).toEqual({ mrUrl: 'mr-1', line: '[ok] Fetched from origin' });
    expect(
      takeSyncLine({ repoName: 'r', branch: 'other', line: 'x' })
    ).toBeNull();
    expect(LIVE_SYNC_LOGS.get('mr-1')).toEqual(['[ok] Fetched from origin']);
    end();
    expect(
      takeSyncLine({ repoName: 'r', branch: 'feat', line: 'late' })
    ).toBeNull();
    expect(LIVE_SYNC_LOGS.has('mr-1')).toBe(false);
  });

  test('ignores a frame that is not a sync line', () => {
    expect(takeSyncLine(null)).toBeNull();
    expect(takeSyncLine({ repoName: 1 })).toBeNull();
  });
});
