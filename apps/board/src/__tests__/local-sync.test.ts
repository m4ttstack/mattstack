import { describe, expect, test } from 'bun:test';

import type { WorktreeSyncData } from '@mattstack/rt-client';
import { localSyncOutcome, syncBranchLocally } from '../local-sync.ts';

const data = (over: Partial<WorktreeSyncData>): WorktreeSyncData => ({
  kind: 'synced',
  path: '/trees/elrond',
  provisioned: false,
  pushed: true,
  oldHead: 'a',
  newHead: 'b',
  refusal: null,
  ...over,
});

describe('localSyncOutcome', () => {
  test('a pushed sync is clean', () => {
    expect(localSyncOutcome(data({}))).toEqual({
      kind: 'clean',
      message: 'rebased and pushed',
    });
  });

  test('a sync that did not push stays on the row', () => {
    expect(localSyncOutcome(data({ pushed: false }))).toEqual({
      kind: 'stopped',
      message: 'rebased, not pushed',
    });
  });

  test('nothing to do is clean', () => {
    expect(localSyncOutcome(data({ kind: 'up-to-date' })).kind).toBe('clean');
  });

  test('a conflict names the paused tree', () => {
    expect(localSyncOutcome(data({ kind: 'conflict' }))).toEqual({
      kind: 'conflict',
      tree: '/trees/elrond',
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
