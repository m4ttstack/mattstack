import { afterAll, describe, expect, test, mock, beforeEach } from 'bun:test';
import { StackManager } from '../src/core/stack-manager.ts';
import { GitShell } from '../src/core/git-shell.ts';
import type { Stack } from '../src/core/types.ts';

afterAll(() => mock.restore());

function buildFoldStack(): Stack {
  let stack = StackManager.createStack('test', 'main');
  stack = StackManager.addNode(stack, 'feat/parent', 'main');
  stack = StackManager.updateNode(stack, 'feat/parent', { lastKnownHead: 'parent-head' });
  stack = StackManager.addNode(stack, 'feat/child', 'feat/parent');
  stack = StackManager.updateNode(stack, 'feat/child', { lastKnownHead: 'child-head' });
  return stack;
}

function buildFoldStackWithGrandchildren(): Stack {
  let stack = buildFoldStack();
  stack = StackManager.addNode(stack, 'feat/gc1', 'feat/child');
  stack = StackManager.updateNode(stack, 'feat/gc1', { lastKnownHead: 'gc1-head' });
  stack = StackManager.addNode(stack, 'feat/gc2', 'feat/child');
  stack = StackManager.updateNode(stack, 'feat/gc2', { lastKnownHead: 'gc2-head' });
  return stack;
}

describe('foldBranch', () => {
  beforeEach(() => {
    mock.restore();
  });

  test('rebases branch commits onto parent via rebaseOnto', async () => {
    const rebaseCalls: { newBase: string; oldBase: string; branch: string }[] = [];

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        checkoutBranch: mock(() => Promise.resolve()),
        rebaseOnto: mock((_: string, newBase: string, oldBase: string, branch: string) => {
          rebaseCalls.push({ newBase, oldBase, branch });
          return Promise.resolve();
        }),
        getMergeBase: mock(() => Promise.resolve('merge-base-sha')),
        resetHard: mock(() => Promise.resolve()),
        deleteBranch: mock(() => Promise.resolve()),
        getBranchHead: mock((_: string, branch: string) => {
          if (branch === 'feat/parent') return Promise.resolve('parent-sha');
          if (branch === 'feat/child') return Promise.resolve('child-sha');
          return Promise.resolve('new-parent-head');
        }),
      },
    }));

    const { foldBranch } = await import('../src/core/branch-fold.ts');
    const stack = buildFoldStack();
    const result = await foldBranch('/tmp/repo', stack, 'feat/child');

    expect(rebaseCalls).toHaveLength(1);
    expect(rebaseCalls[0]!.newBase).toBe('feat/parent');
    expect(rebaseCalls[0]!.branch).toBe('feat/child');
    expect(result.foldedBranch).toBe('feat/child');
    expect(result.intoParent).toBe('feat/parent');
  });

  test('re-parents children of folded branch to its parent', async () => {
    let callIdx = 0;
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        checkoutBranch: mock(() => Promise.resolve()),
        rebaseOnto: mock(() => Promise.resolve()),
        getMergeBase: mock(() => Promise.resolve('mb')),
        resetHard: mock(() => Promise.resolve()),
        deleteBranch: mock(() => Promise.resolve()),
        getBranchHead: mock(() => Promise.resolve(`head-${callIdx++}`)),
      },
    }));

    const { foldBranch } = await import('../src/core/branch-fold.ts');
    const stack = buildFoldStackWithGrandchildren();
    const result = await foldBranch('/tmp/repo', stack, 'feat/child');

    expect(result.reParentedChildren).toEqual(['feat/gc1', 'feat/gc2']);

    const gc1 = StackManager.findNode(result.newStack, 'feat/gc1');
    const gc2 = StackManager.findNode(result.newStack, 'feat/gc2');
    expect(gc1!.parent).toBe('feat/parent');
    expect(gc2!.parent).toBe('feat/parent');
  });

  test('deletes the folded branch', async () => {
    const deleteCalls: string[] = [];
    let callIdx = 0;

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        checkoutBranch: mock(() => Promise.resolve()),
        rebaseOnto: mock(() => Promise.resolve()),
        getMergeBase: mock(() => Promise.resolve('mb')),
        resetHard: mock(() => Promise.resolve()),
        deleteBranch: mock((_: string, branch: string) => {
          deleteCalls.push(branch);
          return Promise.resolve();
        }),
        getBranchHead: mock(() => Promise.resolve(`head-${callIdx++}`)),
      },
    }));

    const { foldBranch } = await import('../src/core/branch-fold.ts');
    const stack = buildFoldStack();
    await foldBranch('/tmp/repo', stack, 'feat/child');

    expect(deleteCalls).toContain('feat/child');
  });

  test('removes folded node from the stack tree', async () => {
    let callIdx = 0;
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        checkoutBranch: mock(() => Promise.resolve()),
        rebaseOnto: mock(() => Promise.resolve()),
        getMergeBase: mock(() => Promise.resolve('mb')),
        resetHard: mock(() => Promise.resolve()),
        deleteBranch: mock(() => Promise.resolve()),
        getBranchHead: mock(() => Promise.resolve(`head-${callIdx++}`)),
      },
    }));

    const { foldBranch } = await import('../src/core/branch-fold.ts');
    const stack = buildFoldStack();
    const result = await foldBranch('/tmp/repo', stack, 'feat/child');

    expect(StackManager.findNode(result.newStack, 'feat/child')).toBeUndefined();
  });

  test('throws on nonexistent branch', async () => {
    const { foldBranch } = await import('../src/core/branch-fold.ts');
    const stack = buildFoldStack();

    await expect(foldBranch('/tmp/repo', stack, 'nonexistent')).rejects.toThrow(/not found/);
  });

  test('throws when working tree is dirty', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(true)),
        hasUnstagedChanges: mock(() => Promise.resolve(true)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
      },
    }));

    const { foldBranch } = await import('../src/core/branch-fold.ts');
    const stack = buildFoldStack();

    await expect(foldBranch('/tmp/repo', stack, 'feat/child')).rejects.toThrow(/uncommitted changes/);
  });

  test('fold on leaf node works (no children to re-parent)', async () => {
    let callIdx = 0;
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        checkoutBranch: mock(() => Promise.resolve()),
        rebaseOnto: mock(() => Promise.resolve()),
        getMergeBase: mock(() => Promise.resolve('mb')),
        resetHard: mock(() => Promise.resolve()),
        deleteBranch: mock(() => Promise.resolve()),
        getBranchHead: mock(() => Promise.resolve(`head-${callIdx++}`)),
      },
    }));

    const { foldBranch } = await import('../src/core/branch-fold.ts');
    const stack = buildFoldStack();
    const result = await foldBranch('/tmp/repo', stack, 'feat/child');

    expect(result.reParentedChildren).toEqual([]);
    expect(result.newStack.nodes).toHaveLength(1);
    expect(result.newStack.nodes[0]!.branch).toBe('feat/parent');
  });

  test('updates lastKnownHead on parent after fold', async () => {
    let callIdx = 0;
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        checkoutBranch: mock(() => Promise.resolve()),
        rebaseOnto: mock(() => Promise.resolve()),
        getMergeBase: mock(() => Promise.resolve('mb')),
        resetHard: mock(() => Promise.resolve()),
        deleteBranch: mock(() => Promise.resolve()),
        getBranchHead: mock(() => {
          callIdx++;
          // Last call is the post-fold parent head update
          if (callIdx >= 3) return Promise.resolve('updated-parent-head');
          return Promise.resolve(`head-${callIdx}`);
        }),
      },
    }));

    const { foldBranch } = await import('../src/core/branch-fold.ts');
    const stack = buildFoldStack();
    const result = await foldBranch('/tmp/repo', stack, 'feat/child');

    const parent = StackManager.findNode(result.newStack, 'feat/parent');
    expect(parent!.lastKnownHead).toBe('updated-parent-head');
  });
});
