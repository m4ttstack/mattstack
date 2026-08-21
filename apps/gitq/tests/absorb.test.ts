import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { restoreMockedModulesAfterAll } from './module-restore.ts';
import { StackManager } from '../src/core/stack-manager.ts';
import { GitShell } from '../src/core/git-shell.ts';
import type { Stack } from '../src/core/types.ts';

restoreMockedModulesAfterAll();

/**
 * Absorb snapshots working-tree entries through the filesystem before it
 * stashes, and these tests have no working tree: git is mocked and the cwd is
 * a path that does not exist. They also cannot make one — `operation-log.test`
 * mocks `node:fs/promises` process-wide for the whole unit suite, so a file
 * written here is not a file absorb can read.
 *
 * So every changed file below is a DELETION, the one changed-file shape whose
 * snapshot needs nothing from disk. What is under test here is absorb's
 * orchestration (attribution, call order, cleanup); content and entry
 * fidelity are covered against real git in tests/integration/absorb.test.ts.
 */
const CWD = '/tmp/gitq-absorb-unit-no-such-tree';


function buildLinearStack(): Stack {
  let stack = StackManager.createStack('test', 'main');
  stack = StackManager.addNode(stack, 'branch-1', 'main');
  stack = StackManager.addNode(stack, 'branch-2', 'branch-1');
  stack = StackManager.addNode(stack, 'branch-3', 'branch-2');
  stack = StackManager.updateNode(stack, 'branch-1', { lastKnownHead: 'aaa' });
  stack = StackManager.updateNode(stack, 'branch-2', { lastKnownHead: 'bbb' });
  stack = StackManager.updateNode(stack, 'branch-3', { lastKnownHead: 'ccc' });
  return stack;
}

function buildFanStack(): Stack {
  let stack = StackManager.createStack('test', 'main');
  stack = StackManager.addNode(stack, 'feat/a', 'main');
  stack = StackManager.addNode(stack, 'feat/b', 'feat/a');
  stack = StackManager.addNode(stack, 'feat/c', 'feat/a');
  stack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: 'aaa' });
  stack = StackManager.updateNode(stack, 'feat/b', { lastKnownHead: 'bbb' });
  stack = StackManager.updateNode(stack, 'feat/c', { lastKnownHead: 'ccc' });
  return stack;
}

// ── attributeFiles ──────────────────────────────────────────────────────────

describe('AbsorbEngine.attributeFiles', () => {
  beforeEach(() => {
    mock.restore();
  });

  test('assigns file to deepest branch that touched it', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getFilesChangedInRange: mock((_cwd: string, _from: string, to: string) => {
          if (to === 'branch-1') return Promise.resolve(['api.ts']);
          if (to === 'branch-2') return Promise.resolve(['config.json']);
          if (to === 'branch-3') return Promise.resolve(['ui.tsx']);
          return Promise.resolve([]);
        }),
      },
    }));

    const { AbsorbEngine } = await import('../src/core/absorb.ts');
    const stack = buildLinearStack();
    const result = await AbsorbEngine.attributeFiles(
      '/tmp/repo',
      stack,
      ['api.ts', 'config.json', 'ui.tsx'],
    );

    expect(result.byBranch.get('branch-1')).toEqual(['api.ts']);
    expect(result.byBranch.get('branch-2')).toEqual(['config.json']);
    expect(result.byBranch.get('branch-3')).toEqual(['ui.tsx']);
    expect(result.unattributed).toEqual([]);
  });

  test('files no branch touched are unattributed, not pinned on a branch', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getFilesChangedInRange: mock(() => Promise.resolve([])),
      },
    }));

    const { AbsorbEngine } = await import('../src/core/absorb.ts');
    const stack = buildLinearStack();
    const result = await AbsorbEngine.attributeFiles(
      '/tmp/repo',
      stack,
      ['unknown.txt', 'notes.md'],
    );

    expect(result.unattributed).toEqual(['unknown.txt', 'notes.md']);
    expect(result.byBranch.size).toBe(0);
  });

  test('an explicit target overrides attribution, taking every changed file', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getFilesChangedInRange: mock((_cwd: string, _from: string, to: string) =>
          Promise.resolve(to === 'branch-3' ? ['api.ts'] : []),
        ),
      },
    }));

    const { AbsorbEngine } = await import('../src/core/absorb.ts');
    const result = await AbsorbEngine.attributeFiles(
      '/tmp/repo',
      buildLinearStack(),
      ['api.ts', 'brand-new.txt'],
      'branch-1',
    );

    // api.ts would land on branch-3 by deepest-toucher, and brand-new.txt would
    // be unattributable. The override takes both, which is the point of it.
    expect(result.byBranch.get('branch-1')).toEqual(['api.ts', 'brand-new.txt']);
    expect(result.byBranch.size).toBe(1);
    expect(result.unattributed).toEqual([]);
  });
});

// ── previewAbsorb ────────────────────────────────────────────────────────────

describe('AbsorbEngine.previewAbsorb', () => {
  beforeEach(() => {
    mock.restore();
  });

  test('separates attributed from unattributed files', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getCurrentBranch: mock(() => Promise.resolve('branch-3')),
        getChangedFiles: mock(() =>
          Promise.resolve({ modified: ['api.ts', 'unknown.txt'], staged: [], untracked: ['new.ts'], deleted: [] }),
        ),
        getFilesChangedInRange: mock((_cwd: string, _from: string, to: string) => {
          if (to === 'branch-1') return Promise.resolve(['api.ts']);
          return Promise.resolve([]);
        }),
        getBranchHead: mock(() => Promise.resolve('head-sha')),
        showFileRaw: mock(() => Promise.resolve(null)),
      },
    }));

    const { AbsorbEngine } = await import('../src/core/absorb.ts');
    const stack = buildLinearStack();
    const preview = await AbsorbEngine.previewAbsorb('/tmp/repo', stack);

    expect(preview.attributed).toEqual({ 'branch-1': ['api.ts'] });
    expect(preview.unattributed).toEqual(['unknown.txt', 'new.ts']);
    expect(preview.currentBranch).toBe('branch-3');
  });

  test('returns empty when no changes', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getCurrentBranch: mock(() => Promise.resolve('branch-3')),
        getChangedFiles: mock(() =>
          Promise.resolve({ modified: [], staged: [], untracked: [], deleted: [] }),
        ),
      },
    }));

    const { AbsorbEngine } = await import('../src/core/absorb.ts');
    const stack = buildLinearStack();
    const preview = await AbsorbEngine.previewAbsorb('/tmp/repo', stack);

    expect(preview.attributed).toEqual({});
    expect(preview.unattributed).toEqual([]);
  });

  test('all files attributed when every file has a branch match', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getCurrentBranch: mock(() => Promise.resolve('branch-3')),
        getChangedFiles: mock(() =>
          Promise.resolve({ modified: ['api.ts', 'config.json'], staged: [], untracked: [], deleted: [] }),
        ),
        getFilesChangedInRange: mock((_cwd: string, _from: string, to: string) => {
          if (to === 'branch-1') return Promise.resolve(['api.ts']);
          if (to === 'branch-2') return Promise.resolve(['config.json']);
          return Promise.resolve([]);
        }),
        getBranchHead: mock(() => Promise.resolve('head-sha')),
        showFileRaw: mock(() => Promise.resolve(null)),
      },
    }));

    const { AbsorbEngine } = await import('../src/core/absorb.ts');
    const stack = buildLinearStack();
    const preview = await AbsorbEngine.previewAbsorb('/tmp/repo', stack);

    expect(preview.attributed).toEqual({ 'branch-1': ['api.ts'], 'branch-2': ['config.json'] });
    expect(preview.unattributed).toEqual([]);
  });
});

// ── absorb ──────────────────────────────────────────────────────────────────

describe('AbsorbEngine.absorb', () => {
  beforeEach(() => {
    mock.restore();
  });

  test('returns early with no-changes when working tree is clean', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getCurrentBranch: mock(() => Promise.resolve('branch-3')),
        getChangedFiles: mock(() =>
          Promise.resolve({ modified: [], staged: [], untracked: [], deleted: [] }),
        ),
      },
    }));

    const { AbsorbEngine } = await import('../src/core/absorb.ts');
    const stack = buildLinearStack();
    const result = await AbsorbEngine.absorb('/tmp/repo', stack);

    expect(result.absorbed).toBe(false);
    expect(result.reason).toBe('no-changes');
    expect(result.attributions).toEqual([]);
  });

  test('calls stash → checkout → add → amend → cascade in correct order', async () => {
    const callOrder: string[] = [];

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getCurrentBranch: mock(() => Promise.resolve('branch-3')),
        getChangedFiles: mock(() =>
          Promise.resolve({ modified: ['api.ts'], staged: [], untracked: [], deleted: ['api.ts'] }),
        ),
        getFilesChangedInRange: mock((_cwd: string, _from: string, to: string) => {
          if (to === 'branch-1') return Promise.resolve(['api.ts']);
          return Promise.resolve([]);
        }),
        stash: mock(() => {
          callOrder.push('stash');
          return Promise.resolve();
        }),
        checkoutBranch: mock((_cwd: string, branch: string) => {
          callOrder.push(`checkout:${branch}`);
          return Promise.resolve();
        }),
        add: mock(() => {
          callOrder.push('add');
          return Promise.resolve();
        }),
        amendNoEdit: mock(() => {
          callOrder.push('amend');
          return Promise.resolve();
        }),
        getBranchHead: mock(() => Promise.resolve('new-head')),
        getMergeBase: mock(() => Promise.resolve('new-head')),
        stashDrop: mock(() => {
          callOrder.push('stashDrop');
          return Promise.resolve();
        }),
        rebaseOnto: mock(() => Promise.resolve()),
        pushForceWithLease: mock(() => Promise.resolve()),
      },
    }));

    const { AbsorbEngine } = await import('../src/core/absorb.ts');
    const stack = buildLinearStack();
    const result = await AbsorbEngine.absorb(CWD, stack);

    expect(result.absorbed).toBe(true);
    expect(callOrder).toEqual([
      'stash',
      'checkout:branch-1',
      'add',
      'amend',
      'checkout:branch-3',
      'stashDrop',
    ]);
  });

  test('handles single-branch stack (all files go to one branch)', async () => {
    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'only-branch', 'main');
    stack = StackManager.updateNode(stack, 'only-branch', { lastKnownHead: 'aaa' });

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getCurrentBranch: mock(() => Promise.resolve('only-branch')),
        getChangedFiles: mock(() =>
          Promise.resolve({ modified: ['a.ts', 'b.ts'], staged: [], untracked: [], deleted: ['a.ts', 'b.ts'] }),
        ),
        getFilesChangedInRange: mock(() => Promise.resolve(['a.ts', 'b.ts'])),
        stash: mock(() => Promise.resolve()),
        checkoutBranch: mock(() => Promise.resolve()),
        add: mock(() => Promise.resolve()),
        amendNoEdit: mock(() => Promise.resolve()),
        getBranchHead: mock(() => Promise.resolve('new-head')),
        getMergeBase: mock(() => Promise.resolve('new-head')),
        stashDrop: mock(() => Promise.resolve()),
        rebaseOnto: mock(() => Promise.resolve()),
        pushForceWithLease: mock(() => Promise.resolve()),
      },
    }));

    const { AbsorbEngine } = await import('../src/core/absorb.ts');
    const result = await AbsorbEngine.absorb(CWD, stack);

    expect(result.absorbed).toBe(true);
    expect(result.attributions).toHaveLength(1);
    expect(result.attributions[0]!.branch).toBe('only-branch');
    expect(result.attributions[0]!.files).toEqual(['a.ts', 'b.ts']);
    expect(result.attributions[0]!.success).toBe(true);
  });

  test('handles fan-out (two children of same parent, files attributed correctly)', async () => {

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getCurrentBranch: mock(() => Promise.resolve('feat/b')),
        getChangedFiles: mock(() =>
          Promise.resolve({ modified: ['b.txt', 'c.txt'], staged: [], untracked: [], deleted: ['b.txt', 'c.txt'] }),
        ),
        getFilesChangedInRange: mock((_cwd: string, _from: string, to: string) => {
          if (to === 'feat/a') return Promise.resolve([]);
          if (to === 'feat/b') return Promise.resolve(['b.txt']);
          if (to === 'feat/c') return Promise.resolve(['c.txt']);
          return Promise.resolve([]);
        }),
        stash: mock(() => Promise.resolve()),
        checkoutBranch: mock(() => Promise.resolve()),
        add: mock(() => Promise.resolve()),
        amendNoEdit: mock(() => Promise.resolve()),
        getBranchHead: mock(() => Promise.resolve('new-head')),
        getMergeBase: mock(() => Promise.resolve('new-head')),
        stashDrop: mock(() => Promise.resolve()),
        rebaseOnto: mock(() => Promise.resolve()),
        pushForceWithLease: mock(() => Promise.resolve()),
      },
    }));

    const { AbsorbEngine } = await import('../src/core/absorb.ts');
    const stack = buildFanStack();
    const result = await AbsorbEngine.absorb(CWD, stack);

    expect(result.absorbed).toBe(true);
    const bAttr = result.attributions.find((a) => a.branch === 'feat/b');
    const cAttr = result.attributions.find((a) => a.branch === 'feat/c');
    expect(bAttr?.files).toEqual(['b.txt']);
    expect(cAttr?.files).toEqual(['c.txt']);
  });

  test('error during amend triggers cleanup (stash pop, checkout original branch)', async () => {
    const checkoutCalls: string[] = [];
    let stashPopped = false;

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getCurrentBranch: mock(() => Promise.resolve('branch-3')),
        getChangedFiles: mock(() =>
          Promise.resolve({ modified: ['api.ts'], staged: [], untracked: [], deleted: ['api.ts'] }),
        ),
        getFilesChangedInRange: mock((_cwd: string, _from: string, to: string) => {
          if (to === 'branch-1') return Promise.resolve(['api.ts']);
          return Promise.resolve([]);
        }),
        stash: mock(() => Promise.resolve()),
        checkoutBranch: mock((_cwd: string, branch: string) => {
          checkoutCalls.push(branch);
          return Promise.resolve();
        }),
        add: mock(() => Promise.resolve()),
        amendNoEdit: mock(() => Promise.reject(new Error('amend failed: empty commit'))),
        getBranchHead: mock(() => Promise.resolve('head')),
        stashPop: mock(() => {
          stashPopped = true;
          return Promise.resolve();
        }),
      },
    }));

    const { AbsorbEngine } = await import('../src/core/absorb.ts');
    const stack = buildLinearStack();
    const result = await AbsorbEngine.absorb(CWD, stack);

    expect(result.absorbed).toBe(false);
    expect(result.attributions[0]!.success).toBe(false);
    expect(result.attributions[0]!.error).toContain('amend failed');
    expect(checkoutCalls).toContain('branch-3');
    expect(stashPopped).toBe(true);
    expect(result.recovery).toBeUndefined();
  });

  test('a cleanup that cannot get back to the original branch says so and keeps the stash', async () => {
    let stashPopped = false;
    // Started on branch-3; the amend phase checked branch-1 out and the tree
    // is stuck there once the way back fails.
    let head = 'branch-3';

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getCurrentBranch: mock(() => Promise.resolve(head)),
        getChangedFiles: mock(() =>
          Promise.resolve({ modified: ['api.ts'], staged: [], untracked: [], deleted: ['api.ts'] }),
        ),
        getFilesChangedInRange: mock((_cwd: string, _from: string, to: string) => {
          if (to === 'branch-1') return Promise.resolve(['api.ts']);
          return Promise.resolve([]);
        }),
        stash: mock(() => Promise.resolve()),
        // The hook that fails the amend fails the way back out too.
        checkoutBranch: mock((_cwd: string, branch: string) => {
          if (branch === 'branch-3') return Promise.reject(new Error('error: pre-checkout hook refused'));
          head = branch;
          return Promise.resolve();
        }),
        add: mock(() => Promise.resolve()),
        amendNoEdit: mock(() => Promise.reject(new Error('amend failed: pre-commit hook'))),
        getBranchHead: mock(() => Promise.resolve('head')),
        stashPop: mock(() => {
          stashPopped = true;
          return Promise.resolve();
        }),
      },
    }));

    const { AbsorbEngine } = await import('../src/core/absorb.ts');
    const result = await AbsorbEngine.absorb(CWD, buildLinearStack());

    expect(result.absorbed).toBe(false);
    // Names the branch it could not get back to, the branch you are on, and
    // where the dirty tree actually is.
    expect(result.recovery).toContain('branch-3');
    expect(result.recovery).toContain('branch-1');
    expect(result.recovery).toContain('stash@{0}');
    // Popping onto a branch the caller never chose would make it worse.
    expect(stashPopped).toBe(false);
  });

  test('a changed file that is not on disk aborts before anything is stashed', async () => {
    let stashed = false;

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getCurrentBranch: mock(() => Promise.resolve('branch-3')),
        // What a C-quoted path looks like from here: git named a file the
        // filesystem does not have, and did not call it a deletion.
        getChangedFiles: mock(() =>
          Promise.resolve({ modified: ['api.ts', 'ghost.ts'], staged: [], untracked: [], deleted: ['api.ts'] }),
        ),
        getFilesChangedInRange: mock((_cwd: string, _from: string, to: string) => {
          if (to === 'branch-1') return Promise.resolve(['api.ts']);
          return Promise.resolve([]);
        }),
        stash: mock(() => {
          stashed = true;
          return Promise.resolve();
        }),
        checkoutBranch: mock(() => Promise.resolve()),
        add: mock(() => Promise.resolve()),
        amendNoEdit: mock(() => Promise.resolve()),
        getBranchHead: mock(() => Promise.resolve('head')),
      },
    }));

    const { AbsorbEngine } = await import('../src/core/absorb.ts');
    await expect(AbsorbEngine.absorb(CWD, buildLinearStack())).rejects.toThrow(/ghost\.ts/);
    expect(stashed).toBe(false);
  });

  test('a file git reports as deleted is snapshotted as a deletion, not as unreadable', async () => {
    let stashed = false;

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getCurrentBranch: mock(() => Promise.resolve('branch-3')),
        getChangedFiles: mock(() =>
          Promise.resolve({
            modified: ['api.ts', 'config.json'],
            staged: [],
            untracked: [],
            deleted: ['api.ts', 'config.json'],
          }),
        ),
        getFilesChangedInRange: mock((_cwd: string, _from: string, to: string) => {
          if (to === 'branch-1') return Promise.resolve(['api.ts']);
          return Promise.resolve([]);
        }),
        stash: mock(() => {
          stashed = true;
          return Promise.resolve();
        }),
        checkoutBranch: mock(() => Promise.resolve()),
        add: mock(() => Promise.resolve()),
        amendNoEdit: mock(() => Promise.resolve()),
        getBranchHead: mock(() => Promise.resolve('new-head')),
        getMergeBase: mock(() => Promise.resolve('new-head')),
        stashDrop: mock(() => Promise.resolve()),
      },
    }));

    const { AbsorbEngine } = await import('../src/core/absorb.ts');
    const result = await AbsorbEngine.absorb(CWD, buildLinearStack());

    expect(stashed).toBe(true);
    expect(result.absorbed).toBe(true);
    expect(result.unattributed).toEqual(['config.json']);
    expect(result.recovery).toBeUndefined();
  });

  test('excludedFiles filters out files before attribution', async () => {
    const addedFiles: string[][] = [];

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getCurrentBranch: mock(() => Promise.resolve('branch-3')),
        getChangedFiles: mock(() =>
          Promise.resolve({ modified: ['api.ts', 'config.json'], staged: [], untracked: [], deleted: ['api.ts', 'config.json'] }),
        ),
        getFilesChangedInRange: mock((_cwd: string, _from: string, to: string) => {
          if (to === 'branch-1') return Promise.resolve(['api.ts']);
          if (to === 'branch-2') return Promise.resolve(['config.json']);
          return Promise.resolve([]);
        }),
        stash: mock(() => Promise.resolve()),
        checkoutBranch: mock(() => Promise.resolve()),
        add: mock((_cwd: string, files: string[]) => {
          addedFiles.push(files);
          return Promise.resolve();
        }),
        amendNoEdit: mock(() => Promise.resolve()),
        getBranchHead: mock(() => Promise.resolve('new-head')),
        getMergeBase: mock(() => Promise.resolve('new-head')),
        stashDrop: mock(() => Promise.resolve()),
        rebaseOnto: mock(() => Promise.resolve()),
        pushForceWithLease: mock(() => Promise.resolve()),
      },
    }));

    const { AbsorbEngine } = await import('../src/core/absorb.ts');
    const stack = buildLinearStack();
    const result = await AbsorbEngine.absorb(CWD, stack, ['config.json']);

    expect(result.absorbed).toBe(true);
    expect(result.attributions).toHaveLength(1);
    expect(result.attributions[0]!.branch).toBe('branch-1');
    expect(result.attributions[0]!.files).toEqual(['api.ts']);
    expect(addedFiles.flat()).not.toContain('config.json');
  });

  test('leaves unattributed files out of the amend and reports them', async () => {
    const addedFiles: string[][] = [];

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getCurrentBranch: mock(() => Promise.resolve('branch-3')),
        getChangedFiles: mock(() =>
          Promise.resolve({ modified: ['api.ts'], staged: [], untracked: ['notes.md'], deleted: ['api.ts', 'notes.md'] }),
        ),
        getFilesChangedInRange: mock((_cwd: string, _from: string, to: string) => {
          if (to === 'branch-1') return Promise.resolve(['api.ts']);
          return Promise.resolve([]);
        }),
        stash: mock(() => Promise.resolve()),
        checkoutBranch: mock(() => Promise.resolve()),
        add: mock((_cwd: string, files: string[]) => {
          addedFiles.push(files);
          return Promise.resolve();
        }),
        amendNoEdit: mock(() => Promise.resolve()),
        getBranchHead: mock(() => Promise.resolve('new-head')),
        getMergeBase: mock(() => Promise.resolve('new-head')),
        stashDrop: mock(() => Promise.resolve()),
        rebaseOnto: mock(() => Promise.resolve()),
        pushForceWithLease: mock(() => Promise.resolve()),
      },
    }));

    const { AbsorbEngine } = await import('../src/core/absorb.ts');
    const stack = buildLinearStack();
    const result = await AbsorbEngine.absorb(CWD, stack);

    expect(result.absorbed).toBe(true);
    expect(result.unattributed).toEqual(['notes.md']);
    expect(result.attributions).toHaveLength(1);
    expect(result.attributions[0]!.branch).toBe('branch-1');
    expect(result.attributions[0]!.files).toEqual(['api.ts']);
    expect(addedFiles.flat()).not.toContain('notes.md');
    // Nothing was committed to the branch the worktree happened to be on.
    expect(result.attributions.some((a) => a.branch === 'branch-3')).toBe(false);
  });

  test('nothing attributable: no stash, no commit, files reported back', async () => {
    let stashed = false;
    let amended = false;

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getCurrentBranch: mock(() => Promise.resolve('branch-3')),
        getChangedFiles: mock(() =>
          Promise.resolve({ modified: [], staged: [], untracked: ['notes.md', 'scratch.txt'], deleted: ['notes.md', 'scratch.txt'] }),
        ),
        getFilesChangedInRange: mock(() => Promise.resolve([])),
        stash: mock(() => {
          stashed = true;
          return Promise.resolve();
        }),
        amendNoEdit: mock(() => {
          amended = true;
          return Promise.resolve();
        }),
      },
    }));

    const { AbsorbEngine } = await import('../src/core/absorb.ts');
    const stack = buildLinearStack();
    const result = await AbsorbEngine.absorb('/tmp/repo', stack);

    expect(result.absorbed).toBe(false);
    expect(result.reason).toBe('nothing-attributable');
    expect(result.attributions).toEqual([]);
    expect(result.unattributed).toEqual(['notes.md', 'scratch.txt']);
    expect(stashed).toBe(false);
    expect(amended).toBe(false);
  });

  test('excludedFiles returns no-changes when all files excluded', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getCurrentBranch: mock(() => Promise.resolve('branch-3')),
        getChangedFiles: mock(() =>
          Promise.resolve({ modified: ['api.ts'], staged: [], untracked: [], deleted: ['api.ts'] }),
        ),
      },
    }));

    const { AbsorbEngine } = await import('../src/core/absorb.ts');
    const stack = buildLinearStack();
    const result = await AbsorbEngine.absorb('/tmp/repo', stack, ['api.ts']);

    expect(result.absorbed).toBe(false);
    expect(result.reason).toBe('no-changes');
  });
});
