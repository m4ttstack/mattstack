import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { restoreMockedModulesAfterAll } from './module-restore.ts';
import { StackManager } from '../src/core/stack-manager.ts';
import { GitShell } from '../src/core/git-shell.ts';
import type { Stack } from '../src/core/types.ts';

restoreMockedModulesAfterAll();

function buildLinearStack(): Stack {
  let stack = StackManager.createStack('test', 'main');
  stack = StackManager.addNode(stack, 'feat/A', 'main');
  stack = StackManager.updateNode(stack, 'feat/A', { lastKnownHead: 'sha-a' });
  stack = StackManager.addNode(stack, 'feat/B', 'feat/A');
  stack = StackManager.updateNode(stack, 'feat/B', { lastKnownHead: 'sha-b' });
  stack = StackManager.addNode(stack, 'feat/C', 'feat/B');
  stack = StackManager.updateNode(stack, 'feat/C', { lastKnownHead: 'sha-c' });
  return stack;
}

function buildFanOutStack(): Stack {
  let stack = StackManager.createStack('test', 'main');
  stack = StackManager.addNode(stack, 'feat/A', 'main');
  stack = StackManager.updateNode(stack, 'feat/A', { lastKnownHead: 'sha-a' });
  stack = StackManager.addNode(stack, 'feat/B', 'feat/A');
  stack = StackManager.updateNode(stack, 'feat/B', { lastKnownHead: 'sha-b' });
  stack = StackManager.addNode(stack, 'feat/C', 'feat/A');
  stack = StackManager.updateNode(stack, 'feat/C', { lastKnownHead: 'sha-c' });
  return stack;
}

describe('reparentBranch', () => {
  beforeEach(() => {
    mock.restore();
  });

  test('calls rebaseOnto with correct args', async () => {
    const rebaseOntoCalls: { newBase: string; oldBase: string; branch: string }[] = [];

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        getMergeBase: mock(() => Promise.resolve('merge-base-sha')),
        getBranchHead: mock((_, branch: string) => {
          if (branch === 'main') return Promise.resolve('main-head');
          return Promise.resolve('new-head');
        }),
        rebaseOnto: mock((_: string, newBase: string, oldBase: string, branch: string) => {
          rebaseOntoCalls.push({ newBase, oldBase, branch });
          return Promise.resolve();
        }),
      },
    }));

    const { reparentBranch } = await import('../src/core/reparent.ts');
    const stack = buildLinearStack();
    const result = await reparentBranch('/tmp/repo', stack, 'feat/C', 'main');

    expect(rebaseOntoCalls).toHaveLength(1);
    expect(rebaseOntoCalls[0]!.newBase).toBe('main-head');
    expect(rebaseOntoCalls[0]!.oldBase).toBe('merge-base-sha');
    expect(rebaseOntoCalls[0]!.branch).toBe('feat/C');
    expect(result.branch).toBe('feat/C');
    expect(result.oldParent).toBe('feat/B');
    expect(result.newParent).toBe('main');
  });

  test('updates the stack tree after reparent', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        getMergeBase: mock(() => Promise.resolve('mb')),
        getBranchHead: mock(() => Promise.resolve('new-head')),
        rebaseOnto: mock(() => Promise.resolve()),
      },
    }));

    const { reparentBranch } = await import('../src/core/reparent.ts');
    const stack = buildLinearStack();
    const result = await reparentBranch('/tmp/repo', stack, 'feat/C', 'main');

    const cNode = StackManager.findNode(result.newStack, 'feat/C');
    expect(cNode!.parent).toBe('main');
    expect(cNode!.lastKnownHead).toBe('new-head');
  });

  test('cascades descendants of the moved branch', async () => {
    const rebaseOntoCalls: string[] = [];

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        getMergeBase: mock(() => Promise.resolve('old-mb')),
        getBranchHead: mock(() => Promise.resolve('new-head')),
        rebaseOnto: mock((_: string, _nb: string, _ob: string, branch: string) => {
          rebaseOntoCalls.push(branch);
          return Promise.resolve();
        }),
      },
    }));

    const { reparentBranch } = await import('../src/core/reparent.ts');
    const stack = buildLinearStack();

    // Reparent B (which has child C) under main
    const result = await reparentBranch('/tmp/repo', stack, 'feat/B', 'main');

    // B itself + C should be rebased (B by reparent, C by cascade)
    expect(rebaseOntoCalls).toContain('feat/B');
    expect(rebaseOntoCalls).toContain('feat/C');
    expect(result.cascadeResult).not.toBeNull();
  });

  test('same parent is a no-op', async () => {
    const { reparentBranch } = await import('../src/core/reparent.ts');
    const stack = buildLinearStack();
    const result = await reparentBranch('/tmp/repo', stack, 'feat/B', 'feat/A');

    expect(result.newStack).toBe(stack);
    expect(result.cascadeResult).toBeNull();
  });

  test('reparent to descendant throws (cycle detection)', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
      },
    }));

    const { reparentBranch } = await import('../src/core/reparent.ts');
    const stack = buildLinearStack();

    await expect(reparentBranch('/tmp/repo', stack, 'feat/A', 'feat/C')).rejects.toThrow(
      /cycle/,
    );
  });

  test('reparent to non-existent branch throws', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
      },
    }));

    const { reparentBranch } = await import('../src/core/reparent.ts');
    const stack = buildLinearStack();

    await expect(reparentBranch('/tmp/repo', stack, 'feat/A', 'nonexistent')).rejects.toThrow(
      /not found/,
    );
  });

  test('reparent nonexistent branch throws', async () => {
    const { reparentBranch } = await import('../src/core/reparent.ts');
    const stack = buildLinearStack();

    await expect(reparentBranch('/tmp/repo', stack, 'nonexistent', 'main')).rejects.toThrow(
      /not found/,
    );
  });

  test('rejects dirty working tree', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(true)),
        hasUnstagedChanges: mock(() => Promise.resolve(true)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
      },
    }));

    const { reparentBranch } = await import('../src/core/reparent.ts');
    const stack = buildLinearStack();

    await expect(reparentBranch('/tmp/repo', stack, 'feat/B', 'main')).rejects.toThrow(
      /uncommitted changes/,
    );
  });
});
