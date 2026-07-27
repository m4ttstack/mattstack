import { afterAll, describe, expect, test, mock, beforeEach } from 'bun:test';
import { RebaseEngine } from '../src/core/rebase-engine.ts';
import { StackManager } from '../src/core/stack-manager.ts';
import { GitShell } from '../src/core/git-shell.ts';
import type { Stack } from '../src/core/types.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────

// Clean up all module mocks after this file's tests run so they don't leak
// into other test files (e.g. integration tests that need the real GitShell).
afterAll(() => mock.restore());

/** Build a realistic 3-level stack for testing. */
function buildTestStack(): Stack {
  let stack = StackManager.createStack('auth', 'main');
  stack = StackManager.addNode(stack, 'feat/auth-base', 'main');
  stack = StackManager.addNode(stack, 'feat/auth-oauth', 'feat/auth-base');
  stack = StackManager.addNode(stack, 'feat/auth-tests', 'feat/auth-oauth');

  // Set lastKnownHead on all nodes (simulating prior push/sync)
  stack = StackManager.updateNode(stack, 'feat/auth-base', { lastKnownHead: 'aaa111' });
  stack = StackManager.updateNode(stack, 'feat/auth-oauth', { lastKnownHead: 'bbb222' });
  stack = StackManager.updateNode(stack, 'feat/auth-tests', { lastKnownHead: 'ccc333' });

  return stack;
}

// ── rebaseSingle ─────────────────────────────────────────────────────────────

describe('RebaseEngine.rebaseSingle', () => {
  beforeEach(() => {
    // Restore originals before each test
    mock.restore();
  });

  test('returns success when rebase succeeds', async () => {
    // Mock GitShell.rebaseOnto to succeed
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        rebaseOnto: mock(() => Promise.resolve()),
      },
    }));

    // Re-import after mock
    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');
    const result = await RE.rebaseSingle('/tmp/repo', 'main', 'aaa111', 'feat/auth-oauth');

    expect(result.branch).toBe('feat/auth-oauth');
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test('returns failure with error message when rebase fails', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        rebaseOnto: mock(() => Promise.reject(new Error('CONFLICT: merge conflict in auth.ts'))),
      },
    }));

    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');
    const result = await RE.rebaseSingle('/tmp/repo', 'main', 'aaa111', 'feat/auth-oauth');

    expect(result.branch).toBe('feat/auth-oauth');
    expect(result.success).toBe(false);
    expect(result.error).toContain('CONFLICT');
  });
});

// ── needsRebase ──────────────────────────────────────────────────────────────

describe('RebaseEngine.needsRebase', () => {
  beforeEach(() => {
    mock.restore();
  });

  test('returns false when merge-base equals parent HEAD', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getBranchHead: mock(() => Promise.resolve('abc123')),
        getMergeBase: mock(() => Promise.resolve('abc123')),
      },
    }));

    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');
    const stack = buildTestStack();
    const result = await RE.needsRebase('/tmp/repo', stack, 'feat/auth-oauth');

    expect(result).toBe(false);
  });

  test('returns true when merge-base differs from parent HEAD', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        getBranchHead: mock(() => Promise.resolve('new-head-sha')),
        getMergeBase: mock(() => Promise.resolve('old-merge-base')),
      },
    }));

    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');
    const stack = buildTestStack();
    const result = await RE.needsRebase('/tmp/repo', stack, 'feat/auth-oauth');

    expect(result).toBe(true);
  });

  test('returns false for a non-existent branch', async () => {
    const stack = buildTestStack();
    const result = await RebaseEngine.needsRebase('/tmp/repo', stack, 'nonexistent');

    expect(result).toBe(false);
  });
});

// ── preflight ────────────────────────────────────────────────────────────────

describe('RebaseEngine.preflight', () => {
  beforeEach(() => {
    mock.restore();
  });

  test('reports dirty when working tree has changes', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(true)),
        hasUnstagedChanges: mock(() => Promise.resolve(true)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
      },
    }));

    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');
    const stack = buildTestStack();
    const report = await RE.preflight('/tmp/repo', stack, ['feat/auth-oauth']);

    expect(report.dirty).toBe(true);
    // When dirty, conflict checks should be skipped
    expect(report.conflictBranches).toEqual([]);
  });

  test('reports clean with no conflicts when merge-tree succeeds', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        getBranchHead: mock(() => Promise.resolve('parent-head')),
        mergeTreeDryRun: mock(() => Promise.resolve(null)),
      },
    }));

    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');
    const stack = buildTestStack();
    const report = await RE.preflight('/tmp/repo', stack, ['feat/auth-oauth']);

    expect(report.dirty).toBe(false);
    expect(report.conflictBranches).toEqual([]);
  });

  test('reports conflicting branches when merge-tree fails', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        getBranchHead: mock(() => Promise.resolve('parent-head')),
        mergeTreeDryRun: mock(() => Promise.resolve([{ file: 'shared.txt', kind: 'content' }])),
      },
    }));

    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');
    const stack = buildTestStack();
    const report = await RE.preflight('/tmp/repo', stack, ['feat/auth-oauth', 'feat/auth-tests']);

    expect(report.dirty).toBe(false);
    expect(report.conflictBranches).toEqual([
      expect.objectContaining({ branch: 'feat/auth-oauth' }),
      expect.objectContaining({ branch: 'feat/auth-tests' }),
    ]);
  });

  test('returns empty threadWarnings when no unresolved threads', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        getBranchHead: mock(() => Promise.resolve('head')),
        mergeTree: mock(() => Promise.resolve('')),
      },
    }));

    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');
    const stack = buildTestStack();
    const report = await RE.preflight('/tmp/repo', stack, ['feat/auth-oauth']);

    expect(report.threadWarnings).toEqual([]);
  });

  test('reports threadWarnings for branches with unresolved threads', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        getBranchHead: mock(() => Promise.resolve('head')),
        mergeTree: mock(() => Promise.resolve('')),
      },
    }));

    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');
    let stack = buildTestStack();
    stack = StackManager.updateNode(stack, 'feat/auth-oauth', { unresolvedThreads: 3 });
    stack = StackManager.updateNode(stack, 'feat/auth-tests', { unresolvedThreads: 1 });

    const report = await RE.preflight('/tmp/repo', stack, ['feat/auth-oauth', 'feat/auth-tests']);

    expect(report.threadWarnings).toHaveLength(2);
    expect(report.threadWarnings).toContainEqual({ branch: 'feat/auth-oauth', count: 3 });
    expect(report.threadWarnings).toContainEqual({ branch: 'feat/auth-tests', count: 1 });
  });

  test('thread warnings are checked even when tree is dirty', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(true)),
        hasUnstagedChanges: mock(() => Promise.resolve(true)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
      },
    }));

    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');
    let stack = buildTestStack();
    stack = StackManager.updateNode(stack, 'feat/auth-oauth', { unresolvedThreads: 5 });

    const report = await RE.preflight('/tmp/repo', stack, ['feat/auth-oauth']);

    expect(report.dirty).toBe(true);
    expect(report.threadWarnings).toHaveLength(1);
    expect(report.threadWarnings[0]).toEqual({ branch: 'feat/auth-oauth', count: 5 });
  });

  test('warns about a branch whose thread count could not be read', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        getBranchHead: mock(() => Promise.resolve('head')),
        mergeTree: mock(() => Promise.resolve('')),
      },
    }));

    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');
    let stack = buildTestStack();
    // An unknown count is not a count of zero: staying silent here tells the
    // user this branch has nothing outstanding, which nobody established.
    stack = StackManager.updateNode(stack, 'feat/auth-oauth', { unresolvedThreads: null });

    const report = await RE.preflight('/tmp/repo', stack, ['feat/auth-oauth']);

    expect(report.threadWarnings).toHaveLength(1);
    expect(report.threadWarnings[0]).toEqual({ branch: 'feat/auth-oauth', count: null });
  });
});

// ── cascadeRebase ────────────────────────────────────────────────────────────

describe('RebaseEngine.cascadeRebase', () => {
  test('stops cascade when a node has no lastKnownHead', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');
    // feat/a has no lastKnownHead set — cascade should fail gracefully

    const result = await RebaseEngine.cascadeRebase('/tmp/repo', stack, 'feat/a', 'main');

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.success).toBe(false);
    expect(result.results[0]!.error).toContain('No lastKnownHead');
  });
});

// ── resolveOldBase (tested through cascadeRebase) ────────────────────────────

describe('cascade resolveOldBase logic', () => {
  test('uses merged branch lastKnownHead for direct children', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');
    stack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: 'tombstone-sha' });
    stack = StackManager.updateNode(stack, 'feat/b', { lastKnownHead: 'bbb' });

    const rebaseCalls: { newBase: string; oldBase: string; branch: string }[] = [];

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        rebaseOnto: mock((_cwd: string, newBase: string, oldBase: string, branch: string) => {
          rebaseCalls.push({ newBase, oldBase, branch });
          return Promise.resolve();
        }),
        getBranchHead: mock(() => Promise.resolve('new-head')),
        pushForceWithLease: mock(() => Promise.resolve()),
        listConflictedFiles: mock(() => Promise.resolve([])),
        catFileType: mock(() => Promise.resolve('commit')),
        isAncestor: mock(() => Promise.resolve(true)),
      },
    }));

    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');
    await RE.cascadeRebase('/tmp/repo', stack, 'feat/a', 'main');

    expect(rebaseCalls).toHaveLength(1);
    expect(rebaseCalls[0]!.oldBase).toBe('tombstone-sha');
    expect(rebaseCalls[0]!.newBase).toBe('main');
    expect(rebaseCalls[0]!.branch).toBe('feat/b');
  });
});

// ── cascadeRebase conflict state machine ─────────────────────────────────────

describe('cascadeRebase conflict protocol', () => {
  beforeEach(() => {
    mock.restore();
  });

  test('returns paused state with conflict info when rebase conflicts', async () => {
    let stack = buildTestStack();

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        rebaseOnto: mock(() => Promise.reject(new Error('CONFLICT'))),
        listConflictedFiles: mock(() => Promise.resolve(['auth.ts', 'config.ts'])),
        listConflictedFilesWithTypes: async () => [] as { file: string; type: string }[],
        getBranchHead: mock(() => Promise.resolve('head-sha')),
        pushForceWithLease: mock(() => Promise.resolve()),
        catFileType: mock(() => Promise.resolve('commit')),
        isAncestor: mock(() => Promise.resolve(true)),
      },
    }));

    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');
    const result = await RE.cascadeRebase('/tmp/repo', stack, 'feat/auth-base', 'main');

    expect(result.state).toBe('paused');
    expect(result.pauseInfo).toBeDefined();
    expect(result.pauseInfo!.currentBranch).toBe('feat/auth-oauth');
    expect(result.pauseInfo!.conflictFiles).toEqual(['auth.ts', 'config.ts']);
    expect(result.pauseInfo!.remainingBranches).toEqual(['feat/auth-tests']);
    expect(result.pauseInfo!.completedBranches).toEqual([]);
    expect(result.pauseInfo!.mergedBranch).toBe('feat/auth-base');
    expect(result.pauseInfo!.newBase).toBe('main');
  });

  test('returns completed state when cascade succeeds', async () => {
    let stack = buildTestStack();

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        rebaseOnto: mock(() => Promise.resolve()),
        getBranchHead: mock(() => Promise.resolve('new-head')),
        pushForceWithLease: mock(() => Promise.resolve()),
        listConflictedFiles: mock(() => Promise.resolve([])),
        catFileType: mock(() => Promise.resolve('commit')),
        isAncestor: mock(() => Promise.resolve(true)),
      },
    }));

    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');
    const result = await RE.cascadeRebase('/tmp/repo', stack, 'feat/auth-base', 'main');

    expect(result.state).toBe('completed');
    expect(result.pauseInfo).toBeUndefined();
    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.success)).toBe(true);
  });
});

// ── continueCascade ──────────────────────────────────────────────────────────

describe('RebaseEngine.continueCascade', () => {
  beforeEach(() => {
    mock.restore();
  });

  test('resumes from paused branch and completes remaining', async () => {
    let stack = buildTestStack();

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        rebaseContinue: mock(() => Promise.resolve()),
        rebaseOnto: mock(() => Promise.resolve()),
        getBranchHead: mock(() => Promise.resolve('continued-head')),
        getMergeBase: mock(() => Promise.resolve('old-merge-base')),
        pushForceWithLease: mock(() => Promise.resolve()),
        listConflictedFiles: mock(() => Promise.resolve([])),
        catFileType: mock(() => Promise.resolve('commit')),
        isAncestor: mock(() => Promise.resolve(true)),
      },
    }));

    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');

    const pauseInfo = {
      currentBranch: 'feat/auth-oauth',
      conflictFiles: ['auth.ts'],
      remainingBranches: ['feat/auth-tests'],
      completedBranches: [],
      mergedBranch: 'feat/auth-base',
      newBase: 'main',
    };

    const result = await RE.continueCascade('/tmp/repo', stack, pauseInfo);

    expect(result.state).toBe('completed');
    expect(result.results).toHaveLength(2);
    expect(result.results[0]!.branch).toBe('feat/auth-oauth');
    expect(result.results[0]!.success).toBe(true);
    expect(result.results[1]!.branch).toBe('feat/auth-tests');
    expect(result.results[1]!.success).toBe(true);
  });

  test('returns paused again if rebase --continue still has conflicts', async () => {
    let stack = buildTestStack();

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        rebaseContinue: mock(() => Promise.reject(new Error('still conflicted'))),
        listConflictedFiles: mock(() => Promise.resolve(['auth.ts'])),
        listConflictedFilesWithTypes: async () => [] as { file: string; type: string }[],
      },
    }));

    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');

    const pauseInfo = {
      currentBranch: 'feat/auth-oauth',
      conflictFiles: ['auth.ts'],
      remainingBranches: ['feat/auth-tests'],
      completedBranches: [],
      mergedBranch: 'feat/auth-base',
      newBase: 'main',
    };

    const result = await RE.continueCascade('/tmp/repo', stack, pauseInfo);

    expect(result.state).toBe('paused');
    expect(result.pauseInfo).toBeDefined();
    expect(result.pauseInfo!.currentBranch).toBe('feat/auth-oauth');
    expect(result.pauseInfo!.conflictFiles).toEqual(['auth.ts']);
  });
});

// ── abortCascade ─────────────────────────────────────────────────────────────

describe('RebaseEngine.abortCascade', () => {
  beforeEach(() => {
    mock.restore();
  });

  test('calls git rebase --abort', async () => {
    const abortFn = mock(() => Promise.resolve());

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        rebaseAbort: abortFn,
      },
    }));

    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');
    await RE.abortCascade('/tmp/repo');

    expect(abortFn).toHaveBeenCalledWith('/tmp/repo');
  });
});

// ── cascadeRebase with unmanaged nodes ───────────────────────────────────────

describe('cascadeRebase skips unmanaged nodes', () => {
  beforeEach(() => {
    mock.restore();
  });

  test('skips unmanaged nodes during cascade', async () => {
    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');
    stack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: 'aaa', unmanaged: true });
    stack = StackManager.updateNode(stack, 'feat/b', { lastKnownHead: 'bbb' });

    const rebasedBranches: string[] = [];

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        rebaseOnto: mock((_cwd: string, _nb: string, _ob: string, branch: string) => {
          rebasedBranches.push(branch);
          return Promise.resolve();
        }),
        getBranchHead: mock(() => Promise.resolve('new-head')),
        pushForceWithLease: mock(() => Promise.resolve()),
        listConflictedFiles: mock(() => Promise.resolve([])),
        catFileType: mock(() => Promise.resolve('commit')),
        isAncestor: mock(() => Promise.resolve(true)),
      },
    }));

    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');
    const result = await RE.cascadeRebase('/tmp/repo', stack, 'main', 'main');

    expect(rebasedBranches).not.toContain('feat/a');
    expect(rebasedBranches).toContain('feat/b');
    expect(result.state).toBe('completed');
  });

  test('still rebases children of unmanaged nodes', async () => {
    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/unmanaged', 'main');
    stack = StackManager.addNode(stack, 'feat/child-1', 'feat/unmanaged');
    stack = StackManager.addNode(stack, 'feat/child-2', 'feat/unmanaged');
    stack = StackManager.updateNode(stack, 'feat/unmanaged', { lastKnownHead: 'uuu', unmanaged: true });
    stack = StackManager.updateNode(stack, 'feat/child-1', { lastKnownHead: 'c1' });
    stack = StackManager.updateNode(stack, 'feat/child-2', { lastKnownHead: 'c2' });

    const rebasedBranches: string[] = [];

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        rebaseOnto: mock((_cwd: string, _nb: string, _ob: string, branch: string) => {
          rebasedBranches.push(branch);
          return Promise.resolve();
        }),
        getBranchHead: mock(() => Promise.resolve('new-head')),
        pushForceWithLease: mock(() => Promise.resolve()),
        listConflictedFiles: mock(() => Promise.resolve([])),
        catFileType: mock(() => Promise.resolve('commit')),
        isAncestor: mock(() => Promise.resolve(true)),
      },
    }));

    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');
    const result = await RE.cascadeRebase('/tmp/repo', stack, 'main', 'main');

    expect(rebasedBranches).not.toContain('feat/unmanaged');
    expect(rebasedBranches).toContain('feat/child-1');
    expect(rebasedBranches).toContain('feat/child-2');
    expect(result.state).toBe('completed');
  });
});

// ── drift reconciliation (unit) ──────────────────────────────────────────────

describe('cascadeRebase drift reconciliation', () => {
  beforeEach(() => {
    mock.restore();
  });

  test('reconciles drifted child before cascade rebase', async () => {
    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/parent', 'main');
    stack = StackManager.addNode(stack, 'feat/child', 'feat/parent');
    stack = StackManager.updateNode(stack, 'feat/parent', {
      status: 'merged',
      lastKnownHead: 'parent-tombstone',
    });
    stack = StackManager.updateNode(stack, 'feat/child', { lastKnownHead: 'child-head' });

    const rebaseCalls: { newBase: string; oldBase: string; branch: string }[] = [];

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isAncestor: mock(() => Promise.resolve(false)),
        getMergeBase: mock(() => Promise.resolve('actual-fork-point')),
        getMergeBaseForkPoint: mock(() => Promise.resolve('actual-fork-point')),
        rebaseOnto: mock((_cwd: string, newBase: string, oldBase: string, branch: string) => {
          rebaseCalls.push({ newBase, oldBase, branch });
          return Promise.resolve();
        }),
        getBranchHead: mock((_cwd: string, branch: string) => {
          if (branch === 'feat/parent') return Promise.resolve('parent-tombstone');
          return Promise.resolve('new-head');
        }),
        pushForceWithLease: mock(() => Promise.resolve()),
        listConflictedFiles: mock(() => Promise.resolve([])),
        catFileType: mock(() => Promise.resolve('commit')),
        cherry: mock(() => Promise.resolve([{ sha: 'unique-1', unique: true }])),
        checkoutBranch: mock(() => Promise.resolve()),
        resetHard: mock(() => Promise.resolve()),
        listConflictedFilesWithTypes: mock(() => Promise.resolve([])),
      },
    }));

    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');
    const result = await RE.cascadeRebase('/tmp/repo', stack, 'feat/parent', 'main');

    expect(result.state).toBe('completed');
    expect(rebaseCalls).toHaveLength(2);
    expect(rebaseCalls[0]).toEqual({
      newBase: 'parent-tombstone',
      oldBase: 'actual-fork-point',
      branch: 'feat/child',
    });
    expect(rebaseCalls[1]).toEqual({
      newBase: 'main',
      oldBase: 'parent-tombstone',
      branch: 'feat/child',
    });
  });

  test('skips reconciliation when tombstone is ancestor of child', async () => {
    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/parent', 'main');
    stack = StackManager.addNode(stack, 'feat/child', 'feat/parent');
    stack = StackManager.updateNode(stack, 'feat/parent', {
      status: 'merged',
      lastKnownHead: 'parent-tombstone',
    });
    stack = StackManager.updateNode(stack, 'feat/child', { lastKnownHead: 'child-head' });

    const rebaseCalls: { newBase: string; oldBase: string; branch: string }[] = [];

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isAncestor: mock(() => Promise.resolve(true)),
        getMergeBaseForkPoint: mock(() => Promise.resolve(null)),
        rebaseOnto: mock((_cwd: string, newBase: string, oldBase: string, branch: string) => {
          rebaseCalls.push({ newBase, oldBase, branch });
          return Promise.resolve();
        }),
        getBranchHead: mock((_cwd: string, branch: string) => {
          if (branch === 'feat/parent') return Promise.resolve('parent-tombstone');
          return Promise.resolve('new-head');
        }),
        pushForceWithLease: mock(() => Promise.resolve()),
        listConflictedFiles: mock(() => Promise.resolve([])),
        catFileType: mock(() => Promise.resolve('commit')),
        cherry: mock(() => Promise.resolve([{ sha: 'unique-1', unique: true }])),
        listConflictedFilesWithTypes: mock(() => Promise.resolve([])),
      },
    }));

    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');
    const result = await RE.cascadeRebase('/tmp/repo', stack, 'feat/parent', 'main');

    expect(result.state).toBe('completed');
    expect(rebaseCalls).toHaveLength(1);
    expect(rebaseCalls[0]).toEqual({
      newBase: 'main',
      oldBase: 'parent-tombstone',
      branch: 'feat/child',
    });
  });

  test('pauses with phase=reconcile when reconciliation conflicts', async () => {
    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/parent', 'main');
    stack = StackManager.addNode(stack, 'feat/child', 'feat/parent');
    stack = StackManager.updateNode(stack, 'feat/parent', {
      status: 'merged',
      lastKnownHead: 'parent-tombstone',
    });
    stack = StackManager.updateNode(stack, 'feat/child', { lastKnownHead: 'child-head' });

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isAncestor: mock(() => Promise.resolve(false)),
        getMergeBase: mock(() => Promise.resolve('actual-fork-point')),
        getMergeBaseForkPoint: mock(() => Promise.resolve('actual-fork-point')),
        rebaseOnto: mock(() => Promise.reject(new Error('CONFLICT'))),
        getBranchHead: mock((_cwd: string, branch: string) => {
          if (branch === 'feat/parent') return Promise.resolve('parent-tombstone');
          return Promise.resolve('head');
        }),
        pushForceWithLease: mock(() => Promise.resolve()),
        listConflictedFiles: mock(() => Promise.resolve(['shared.txt'])),
        listConflictedFilesWithTypes: mock(() => Promise.resolve([{ file: 'shared.txt', type: 'UU' }])),
        catFileType: mock(() => Promise.resolve('commit')),
      },
    }));

    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');
    const result = await RE.cascadeRebase('/tmp/repo', stack, 'feat/parent', 'main');

    expect(result.state).toBe('paused');
    expect(result.pauseInfo).toBeDefined();
    expect(result.pauseInfo!.phase).toBe('reconcile');
    expect(result.pauseInfo!.currentBranch).toBe('feat/child');
    expect(result.pauseInfo!.conflictFiles).toContain('shared.txt');
  });

  test('preflight reports drift warnings for drifted children', async () => {
    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/parent', 'main');
    stack = StackManager.addNode(stack, 'feat/child', 'feat/parent');
    stack = StackManager.updateNode(stack, 'feat/parent', {
      status: 'merged',
      lastKnownHead: 'parent-tombstone',
    });

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        isAncestor: mock(() => Promise.resolve(false)),
        getMergeBase: mock(() => Promise.resolve('fork')),
        getMergeBaseForkPoint: mock(() => Promise.resolve(null)),
        getBranchHead: mock(() => Promise.resolve('head')),
        mergeTreeDryRun: mock(() => Promise.resolve(null)),
      },
    }));

    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');
    const report = await RE.preflight('/tmp/repo', stack, ['feat/child']);

    expect(report.driftWarnings).toEqual([
      { branch: 'feat/child', mergedParent: 'feat/parent' },
    ]);
  });

  test('preflight reports no drift when tombstone is ancestor', async () => {
    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/parent', 'main');
    stack = StackManager.addNode(stack, 'feat/child', 'feat/parent');
    stack = StackManager.updateNode(stack, 'feat/parent', {
      status: 'merged',
      lastKnownHead: 'parent-tombstone',
    });

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        isAncestor: mock(() => Promise.resolve(true)),
        getBranchHead: mock(() => Promise.resolve('head')),
        mergeTreeDryRun: mock(() => Promise.resolve(null)),
      },
    }));

    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');
    const report = await RE.preflight('/tmp/repo', stack, ['feat/child']);

    expect(report.driftWarnings).toEqual([]);
  });

  test('uses stored forkPoint over merge-base when available', async () => {
    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/parent', 'main');
    stack = StackManager.addNode(stack, 'feat/child', 'feat/parent');
    stack = StackManager.updateNode(stack, 'feat/parent', {
      status: 'merged',
      lastKnownHead: 'parent-tombstone',
    });
    stack = StackManager.updateNode(stack, 'feat/child', {
      lastKnownHead: 'child-head',
      forkPoint: 'stored-fork-point',
    });

    const rebaseCalls: { newBase: string; oldBase: string; branch: string }[] = [];

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isAncestor: mock(() => Promise.resolve(false)),
        catFileType: mock(() => Promise.resolve('commit')),
        getMergeBaseForkPoint: mock(() => Promise.resolve('stored-fork-point')),
        rebaseOnto: mock((_cwd: string, newBase: string, oldBase: string, branch: string) => {
          rebaseCalls.push({ newBase, oldBase, branch });
          return Promise.resolve();
        }),
        getBranchHead: mock((_cwd: string, branch: string) => {
          if (branch === 'feat/parent') return Promise.resolve('parent-tombstone');
          return Promise.resolve('new-head');
        }),
        pushForceWithLease: mock(() => Promise.resolve()),
        listConflictedFiles: mock(() => Promise.resolve([])),
        cherry: mock(() => Promise.resolve([{ sha: 'unique-1', unique: true }])),
        checkoutBranch: mock(() => Promise.resolve()),
        resetHard: mock(() => Promise.resolve()),
        listConflictedFilesWithTypes: mock(() => Promise.resolve([])),
      },
    }));

    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');
    const result = await RE.cascadeRebase('/tmp/repo', stack, 'feat/parent', 'main');

    expect(result.state).toBe('completed');
    expect(rebaseCalls).toHaveLength(2);
    expect(rebaseCalls[0]).toEqual({
      newBase: 'parent-tombstone',
      oldBase: 'stored-fork-point',
      branch: 'feat/child',
    });
    expect(rebaseCalls[1]).toEqual({
      newBase: 'main',
      oldBase: 'parent-tombstone',
      branch: 'feat/child',
    });
  });
});

// ── syncLocalStack ───────────────────────────────────────────────────────────

describe('RebaseEngine.syncLocalStack', () => {
  beforeEach(() => {
    mock.restore();
  });

  test('fetches, updates trunk, and cascades descendants', async () => {
    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: 'aaa' });

    const fetchFn = mock(() => Promise.resolve());
    let callCount = 0;

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        fetch: fetchFn,
        getBranchHead: mock((_cwd: string, branch: string) => {
          if (branch === 'main') return Promise.resolve('old-main');
          if (branch === 'origin/main') return Promise.resolve('new-main');
          return Promise.resolve('branch-head');
        }),
        getMergeBase: mock((_cwd: string, _a: string, _b: string) => {
          callCount++;
          if (callCount === 1) return Promise.resolve('old-main');
          return Promise.resolve('old-merge-base');
        }),
        rebaseOnto: mock(() => Promise.resolve()),
        pushForceWithLease: mock(() => Promise.resolve()),
        listConflictedFiles: mock(() => Promise.resolve([])),
        catFileType: mock(() => Promise.resolve('commit')),
        isAncestor: mock(() => Promise.resolve(true)),
      },
    }));

    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');
    const result = await RE.syncLocalStack('/tmp/repo', stack);

    expect(fetchFn).toHaveBeenCalled();
    expect(result.state).toBe('completed');
  });

  test('pauses when a stack branch rebase has a conflict', async () => {
    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: 'aaa' });

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        fetch: mock(() => Promise.resolve()),
        getBranchHead: mock((_cwd: string, branch: string) => {
          if (branch === 'origin/main') return Promise.resolve('new-main');
          if (branch === 'feat/a') return Promise.resolve('feat-a-head');
          return Promise.resolve('head');
        }),
        getMergeBase: mock(() => Promise.resolve('fork-point')),
        rebaseOnto: mock(() => Promise.reject(new Error('CONFLICT'))),
        listConflictedFiles: mock(() => Promise.resolve(['README.md'])),
        listConflictedFilesWithTypes: async () => [] as { file: string; type: string }[],
      },
    }));

    const { RebaseEngine: RE } = await import('../src/core/rebase-engine.ts');
    const result = await RE.syncLocalStack('/tmp/repo', stack);

    expect(result.state).toBe('paused');
    expect(result.pauseInfo).toBeDefined();
    expect(result.pauseInfo!.currentBranch).toBe('feat/a');
    expect(result.pauseInfo!.conflictFiles).toEqual(['README.md']);
  });
});
