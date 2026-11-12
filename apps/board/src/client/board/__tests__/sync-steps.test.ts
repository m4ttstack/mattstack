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

describe('syncSteps with a forge step', () => {
  const gitlab = (
    state: 'running' | 'done' | 'failed' | 'skipped',
    detail?: string
  ) => ({ forge: 'gitlab' as const, state, ...(detail ? { detail } : {}) });

  test('forge running leads the steps', () => {
    const v = syncSteps([], true, gitlab('running'));
    expect(v.steps[0]).toEqual({
      key: 'forge',
      label: 'GitLab rebase',
      state: 'running',
    });
    expect(v.steps.map(s => s.key)).toEqual([
      'forge',
      'fetch',
      'backup',
      'rebase',
      'push',
    ]);
    expect(v.title).toBe('Rebasing on GitLab');
    expect(v.phase).toEqual({ word: 'rebasing', detail: 'on GitLab' });
    expect(v.outcome).toBe('running');
  });

  test('a GitHub forge step is labelled for GitHub', () => {
    const v = syncSteps([], true, { forge: 'github', state: 'running' });
    expect(v.steps[0]!.label).toBe('GitHub rebase');
    expect(v.forge).toBe('github');
    expect(v.title).toBe('Rebasing on GitHub');
  });

  test('forge done skips the local steps', () => {
    const v = syncSteps([], false, gitlab('done', 'rebased'));
    expect(v.outcome).toBe('forge-done');
    expect(v.title).toBe('Rebased on GitLab');
    expect(v.steps[0]).toMatchObject({ state: 'done', detail: 'rebased' });
    expect(states({ ...v, steps: v.steps.slice(1) })).toEqual([
      'skipped',
      'skipped',
      'skipped',
      'skipped',
    ]);
  });

  test('forge done with nothing to rebase reads as already up to date', () => {
    const v = syncSteps([], false, gitlab('done', 'already current'));
    expect(v.outcome).toBe('forge-done');
    expect(v.title).toBe('Already up to date on GitLab');
    const gh = syncSteps([], false, {
      forge: 'github',
      state: 'done',
      detail: 'already current',
    });
    expect(gh.title).toBe('Already up to date on GitHub');
  });

  test('a cancelled forge step is its own outcome', () => {
    const v = syncSteps([], false, gitlab('failed', 'cancelled'));
    expect(v.outcome).toBe('cancelled');
    expect(v.title).toBe('Rebase cancelled');
    expect(v.steps[0]).toMatchObject({ state: 'failed', detail: 'cancelled' });
    expect(v.steps.slice(1).every(s => s.state === 'skipped')).toBe(true);
  });

  test('raw output is hidden only while the forge has written no sync lines', () => {
    expect(syncSteps([], true, gitlab('running')).noRaw).toBe(true);
    expect(syncSteps([], false, gitlab('done', 'rebased')).noRaw).toBe(true);
    expect(syncSteps([], false, gitlab('failed', 'cancelled')).noRaw).toBe(
      true
    );
    expect(
      syncSteps([L.tree, L.fetched], true, gitlab('failed', 'x')).noRaw
    ).toBeUndefined();
    expect(syncSteps([], true).noRaw).toBeUndefined();
  });

  test('forge failed then local steps run', () => {
    const v = syncSteps(
      [L.tree, L.fetched, L.backup, L.rebasing],
      true,
      gitlab('failed', 'Rebase failed: conflict')
    );
    expect(v.steps[0]).toEqual({
      key: 'forge',
      label: 'GitLab rebase',
      state: 'failed',
      detail: 'Rebase failed: conflict',
    });
    expect(states({ ...v, steps: v.steps.slice(1) })).toEqual([
      'done',
      'done',
      'running',
      'pending',
    ]);
    expect(v.phase).toEqual({
      word: 'rebasing',
      detail: '110 commits onto main',
    });
  });

  test('forge failed, local sync finished: the outcome is the local one', () => {
    const v = syncSteps(
      [L.tree, L.fetched, L.backup, L.rebasing, L.rebased, L.pushed],
      false,
      gitlab('failed', 'Rebase failed: conflict')
    );
    expect(v.outcome).toBe('pushed');
    expect(v.steps[0]!.state).toBe('failed');
  });

  test("no forge keeps today's four steps", () => {
    const lines = [L.tree, L.fetched, L.backup, L.rebasing];
    const v = syncSteps(lines, true);
    expect(v.steps.map(s => s.key)).toEqual([
      'fetch',
      'backup',
      'rebase',
      'push',
    ]);
    expect(v.forge).toBeUndefined();
    expect(v).toEqual(syncSteps(lines, true, undefined));
  });
});
