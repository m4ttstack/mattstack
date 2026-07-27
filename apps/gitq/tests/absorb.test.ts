import { afterAll, afterEach, describe, expect, test, mock, beforeEach } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StackManager } from '../src/core/stack-manager.ts';
import { GitShell } from '../src/core/git-shell.ts';
import type { Stack } from '../src/core/types.ts';

afterAll(() => mock.restore());

const scratchDirs: string[] = [];

afterEach(async () => {
  while (scratchDirs.length > 0) await rm(scratchDirs.pop()!, { recursive: true, force: true });
});

/**
 * A real directory holding the files a mocked `getChangedFiles` calls dirty.
 * Not a git repo — git is mocked here — but it has to be a real tree: absorb
 * snapshots working-tree entries through the filesystem and refuses to stash
 * when a file git listed is not actually there.
 */
async function scratchTree(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gitq-absorb-unit-'));
  scratchDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content, 'utf-8');
  }
  return dir;
}

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
    const dir = await scratchTree({ 'api.ts': 'api\n' });

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getCurrentBranch: mock(() => Promise.resolve('branch-3')),
        getChangedFiles: mock(() =>
          Promise.resolve({ modified: ['api.ts'], staged: [], untracked: [], deleted: [] }),
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
    const result = await AbsorbEngine.absorb(dir, stack);

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

  test('drops the stash only after the unattributed files are back on disk', async () => {
    const dir = await scratchTree({ 'api.ts': 'api\n', 'notes.md': 'notes\n' });
    const notesPresentAtDrop: boolean[] = [];

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getCurrentBranch: mock(() => Promise.resolve('branch-3')),
        getChangedFiles: mock(() =>
          Promise.resolve({ modified: ['api.ts'], staged: [], untracked: ['notes.md'], deleted: [] }),
        ),
        getFilesChangedInRange: mock((_cwd: string, _from: string, to: string) => {
          if (to === 'branch-1') return Promise.resolve(['api.ts']);
          return Promise.resolve([]);
        }),
        // The stash is the real thing standing in for the tree here, so it is
        // taken to mean "notes.md is not on disk" while it is alive.
        stash: mock(async () => { await rm(join(dir, 'notes.md'), { force: true }); }),
        checkoutBranch: mock(() => Promise.resolve()),
        add: mock(() => Promise.resolve()),
        amendNoEdit: mock(() => Promise.resolve()),
        getBranchHead: mock(() => Promise.resolve('new-head')),
        getMergeBase: mock(() => Promise.resolve('new-head')),
        stashDrop: mock(() => {
          notesPresentAtDrop.push(existsSync(join(dir, 'notes.md')));
          return Promise.resolve();
        }),
        rebaseOnto: mock(() => Promise.resolve()),
      },
    }));

    const { AbsorbEngine } = await import('../src/core/absorb.ts');
    const result = await AbsorbEngine.absorb(dir, buildLinearStack());

    expect(result.unattributed).toEqual(['notes.md']);
    // A kill between the drop and the restore is what this ordering buys off:
    // while the stash is alive it is the second copy of notes.md.
    expect(notesPresentAtDrop).toEqual([true]);
  });

  test('handles single-branch stack (all files go to one branch)', async () => {
    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'only-branch', 'main');
    stack = StackManager.updateNode(stack, 'only-branch', { lastKnownHead: 'aaa' });
    const dir = await scratchTree({ 'a.ts': 'a\n', 'b.ts': 'b\n' });

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getCurrentBranch: mock(() => Promise.resolve('only-branch')),
        getChangedFiles: mock(() =>
          Promise.resolve({ modified: ['a.ts', 'b.ts'], staged: [], untracked: [], deleted: [] }),
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
    const result = await AbsorbEngine.absorb(dir, stack);

    expect(result.absorbed).toBe(true);
    expect(result.attributions).toHaveLength(1);
    expect(result.attributions[0]!.branch).toBe('only-branch');
    expect(result.attributions[0]!.files).toEqual(['a.ts', 'b.ts']);
    expect(result.attributions[0]!.success).toBe(true);
  });

  test('handles fan-out (two children of same parent, files attributed correctly)', async () => {
    const dir = await scratchTree({ 'b.txt': 'b\n', 'c.txt': 'c\n' });

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getCurrentBranch: mock(() => Promise.resolve('feat/b')),
        getChangedFiles: mock(() =>
          Promise.resolve({ modified: ['b.txt', 'c.txt'], staged: [], untracked: [], deleted: [] }),
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
    const result = await AbsorbEngine.absorb(dir, stack);

    expect(result.absorbed).toBe(true);
    const bAttr = result.attributions.find((a) => a.branch === 'feat/b');
    const cAttr = result.attributions.find((a) => a.branch === 'feat/c');
    expect(bAttr?.files).toEqual(['b.txt']);
    expect(cAttr?.files).toEqual(['c.txt']);
  });

  test('error during amend triggers cleanup (stash pop, checkout original branch)', async () => {
    const checkoutCalls: string[] = [];
    let stashPopped = false;
    const dir = await scratchTree({ 'api.ts': 'api\n' });

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getCurrentBranch: mock(() => Promise.resolve('branch-3')),
        getChangedFiles: mock(() =>
          Promise.resolve({ modified: ['api.ts'], staged: [], untracked: [], deleted: [] }),
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
    const result = await AbsorbEngine.absorb(dir, stack);

    expect(result.absorbed).toBe(false);
    expect(result.attributions[0]!.success).toBe(false);
    expect(result.attributions[0]!.error).toContain('amend failed');
    expect(checkoutCalls).toContain('branch-3');
    expect(stashPopped).toBe(true);
    expect(result.recovery).toBeUndefined();
  });

  test('a cleanup that cannot get back to the original branch says so and keeps the stash', async () => {
    const dir = await scratchTree({ 'api.ts': 'api\n' });
    let stashPopped = false;
    // Started on branch-3; the amend phase checked branch-1 out and the tree
    // is stuck there once the way back fails.
    let head = 'branch-3';

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getCurrentBranch: mock(() => Promise.resolve(head)),
        getChangedFiles: mock(() =>
          Promise.resolve({ modified: ['api.ts'], staged: [], untracked: [], deleted: [] }),
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
    const result = await AbsorbEngine.absorb(dir, buildLinearStack());

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
    const dir = await scratchTree({ 'api.ts': 'api\n' });
    let stashed = false;

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getCurrentBranch: mock(() => Promise.resolve('branch-3')),
        // What a C-quoted path looks like from here: git named a file the
        // filesystem does not have, and did not call it a deletion.
        getChangedFiles: mock(() =>
          Promise.resolve({ modified: ['api.ts', 'ghost.ts'], staged: [], untracked: [], deleted: [] }),
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
    await expect(AbsorbEngine.absorb(dir, buildLinearStack())).rejects.toThrow(/ghost\.ts/);
    expect(stashed).toBe(false);
  });

  test('a file git reports as deleted is snapshotted as a deletion, not as unreadable', async () => {
    const dir = await scratchTree({ 'api.ts': 'api\n' });
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
            deleted: ['config.json'],
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
    const result = await AbsorbEngine.absorb(dir, buildLinearStack());

    expect(stashed).toBe(true);
    expect(result.absorbed).toBe(true);
    expect(result.unattributed).toEqual(['config.json']);
    // Restored as the deletion it was, not resurrected from the stash.
    expect(existsSync(join(dir, 'config.json'))).toBe(false);
  });

  test('excludedFiles filters out files before attribution', async () => {
    const addedFiles: string[][] = [];
    const dir = await scratchTree({ 'api.ts': 'api\n', 'config.json': '{}\n' });

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
    const result = await AbsorbEngine.absorb(dir, stack, ['config.json']);

    expect(result.absorbed).toBe(true);
    expect(result.attributions).toHaveLength(1);
    expect(result.attributions[0]!.branch).toBe('branch-1');
    expect(result.attributions[0]!.files).toEqual(['api.ts']);
    expect(addedFiles.flat()).not.toContain('config.json');
  });

  test('leaves unattributed files out of the amend and reports them', async () => {
    const addedFiles: string[][] = [];
    const dir = await scratchTree({ 'api.ts': 'api\n', 'notes.md': 'notes\n' });

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getCurrentBranch: mock(() => Promise.resolve('branch-3')),
        getChangedFiles: mock(() =>
          Promise.resolve({ modified: ['api.ts'], staged: [], untracked: ['notes.md'], deleted: [] }),
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
    const result = await AbsorbEngine.absorb(dir, stack);

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
          Promise.resolve({ modified: [], staged: [], untracked: ['notes.md', 'scratch.txt'], deleted: [] }),
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
          Promise.resolve({ modified: ['api.ts'], staged: [], untracked: [], deleted: [] }),
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
