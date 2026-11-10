import { describe, expect, test } from 'bun:test';

import { syncSteps } from '../sync-steps.ts';

const B = 'web-412-show-hide-ternaries';
const L = {
  tree: '[ok] Syncing in worktree george',
  fetching: '[running] Fetching from origin…',
  fetched: '[ok] Fetched from origin',
  backup: `[ok] Saved a backup  rt-backup/rebase/${B}/2026-11-10T04-31-54`,
  rebasing: `[running] Rebasing ${B} onto origin/main  110 commits behind`,
  rebased: `[ok] Rebased ${B} onto origin/main`,
  pushing: '[running] Pushing…',
  pushed: '[ok] Pushed',
  upToDate: `[ok] ${B} is up to date with origin/main`,
  conflicts:
    '[needs you] 3 files have conflicts rt cannot resolve  the rebase is paused',
  pushFailed: `[failed] Could not push ${B}`,
  refused: `[refused] rt will not sync ${B} on its own`,
};

const states = (v: ReturnType<typeof syncSteps>) => v.steps.map(s => s.state);

describe('syncSteps while running', () => {
  test('before any line: preparing, every step pending', () => {
    const v = syncSteps([], true);
    expect(v.phase).toEqual({ word: 'preparing' });
    expect(v.title).toBe('Starting');
    expect(states(v)).toEqual(['pending', 'pending', 'pending', 'pending']);
  });

  test('the worktree line names the tree and the preparing detail', () => {
    const v = syncSteps([L.tree], true);
    expect(v.tree).toBe('george');
    expect(v.phase).toEqual({ word: 'preparing', detail: 'worktree george' });
  });

  test('a rebase in flight: the word, the commit count and the target', () => {
    const v = syncSteps([L.tree, L.fetched, L.backup, L.rebasing], true);
    expect(states(v)).toEqual(['done', 'done', 'running', 'pending']);
    expect(v.phase).toEqual({
      word: 'rebasing',
      detail: '110 commits onto main',
    });
    expect(v.title).toBe('Rebasing onto main');
    expect(v.steps[1]!.ref).toBe(`rt-backup/rebase/${B}/2026-11-10T04-31-54`);
    expect(v.steps[2]!.detail).toBe('110 commits');
  });

  test('between lines, the step after the last finished one is at work', () => {
    const v = syncSteps([L.tree, L.fetched], true);
    expect(states(v)).toEqual(['done', 'running', 'pending', 'pending']);
    expect(v.phase).toEqual({ word: 'backing up' });
  });

  test('a running line that later lines moved past is done', () => {
    const v = syncSteps(
      [L.fetching, L.fetched, L.backup, L.rebasing, L.rebased, L.pushing],
      true
    );
    expect(states(v)).toEqual(['done', 'done', 'done', 'running']);
    expect(v.phase).toEqual({ word: 'pushing' });
  });
});

describe('syncSteps once finished', () => {
  test('rebased and pushed', () => {
    const v = syncSteps(
      [L.tree, L.fetched, L.backup, L.rebasing, L.rebased, L.pushed],
      false
    );
    expect(v.outcome).toBe('pushed');
    expect(v.title).toBe('Rebased and pushed');
    expect(states(v)).toEqual(['done', 'done', 'done', 'done']);
    expect(v.phase).toBeUndefined();
  });

  test('already up to date: nothing to back up or push', () => {
    const v = syncSteps([L.tree, L.fetched, L.upToDate], false);
    expect(v.outcome).toBe('up-to-date');
    expect(v.title).toBe('Already up to date');
    expect(states(v)).toEqual(['done', 'skipped', 'done', 'skipped']);
    expect(v.steps[1]!.detail).toBe('nothing to back up');
    expect(v.steps[3]!.detail).toBe('nothing to push');
  });

  test('a rejected push names the step, not the branch', () => {
    const v = syncSteps(
      [
        L.tree,
        L.fetched,
        L.backup,
        L.rebasing,
        L.rebased,
        L.pushing,
        L.pushFailed,
      ],
      false
    );
    expect(v.outcome).toBe('failed');
    expect(v.title).toBe('Rebased, not pushed');
    expect(v.steps[3]).toMatchObject({ state: 'failed', detail: 'failed' });
    expect(v.failure).toBe(`Could not push ${B}`);
  });

  test('conflicts pause the rebase and leave push pending', () => {
    const v = syncSteps(
      [L.tree, L.fetched, L.backup, L.rebasing, L.conflicts],
      false
    );
    expect(v.outcome).toBe('paused');
    expect(v.title).toBe('Rebase paused on conflicts');
    expect(v.steps[2]).toMatchObject({
      state: 'paused',
      detail: 'conflicts in 3 files',
    });
    expect(v.steps[3]!.state).toBe('pending');
  });

  test('a refusal no step owns fails the first pending step', () => {
    const v = syncSteps([L.tree, L.refused], false);
    expect(v.outcome).toBe('failed');
    expect(v.steps[0]!.state).toBe('failed');
    expect(v.failure).toBe(`rt will not sync ${B} on its own`);
  });

  test('plain text lines are ignored', () => {
    const v = syncSteps([L.tree, 'some stray child output', L.fetched], false);
    expect(v.steps[0]!.state).toBe('done');
  });

  test('a branch named like a step still lands each line on its own step', () => {
    const b = 'acme-12-backup-conflict-job';
    const v = syncSteps(
      [
        L.tree,
        L.fetched,
        `[ok] Saved a backup  rt-backup/rebase/${b}/2026-11-10T04-31-54`,
        `[running] Rebasing ${b} onto origin/main  50 commits behind`,
        `[ok] Rebased ${b} onto origin/main`,
        L.pushing,
        `[failed] Could not push ${b}`,
      ],
      false
    );
    expect(states(v)).toEqual(['done', 'done', 'done', 'failed']);
    expect(v.steps[1]!.ref).toBe(`rt-backup/rebase/${b}/2026-11-10T04-31-54`);
    expect(v.steps[2]!.detail).toBe('50 commits');
  });
});
