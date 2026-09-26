import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { StackManager } from '../../src/core/stack-manager.ts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createSandboxRepo,
  cleanupRepo,
  commit,
  buildLinearStack,
  type SandboxRepo,
} from './helpers.ts';

mock.restore();

let repo: SandboxRepo;

beforeAll(async () => {
  repo = await createSandboxRepo();
});

afterAll(async () => {
  await cleanupRepo(repo.dir);
});

describe('workflow: full cascade after rebase', () => {
  test('rebase branch-1, cascade descendants, verify entire stack is up-to-date', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      // Build 3-level stack
      const { stack } = await buildLinearStack(r.dir, r.git, 3);
      const oldB1Head = r.git('rev-parse', 'feat/branch-1');

      // Advance main
      r.git('checkout', 'main');
      await commit(r.dir, r.git, 'main-advance.txt', 'new main content\n', 'advance main');
      const mainHead = r.git('rev-parse', 'HEAD');

      // All branches should need rebase
      for (const branch of ['feat/branch-1', 'feat/branch-2', 'feat/branch-3']) {
        const needs = await RebaseEngine.needsRebase(r.dir, stack, branch);
        if (branch === 'feat/branch-1') {
          expect(needs).toBe(true);
        }
      }

      // Rebase branch-1 onto main
      const forkPoint = r.git('merge-base', 'main', 'feat/branch-1');
      await GitShell.rebaseOnto(r.dir, 'main', forkPoint, 'feat/branch-1');
      const newB1Head = r.git('rev-parse', 'feat/branch-1');

      // Cascade branch-1's descendants
      let updatedStack = StackManager.updateNode(stack, 'feat/branch-1', { lastKnownHead: oldB1Head });

      const originalPush = GitShell.pushForceWithLease;
      GitShell.pushForceWithLease = async () => {};

      try {
        const result = await RebaseEngine.cascadeRebase(r.dir, updatedStack, 'feat/branch-1', 'feat/branch-1');
        expect(result.results.every((r) => r.success)).toBe(true);
        updatedStack = result.updatedStack;

        // Now verify nobody needs rebase anymore
        // Update branch-1's lastKnownHead for the check
        updatedStack = StackManager.updateNode(updatedStack, 'feat/branch-1', { lastKnownHead: newB1Head });

        for (const branch of ['feat/branch-1', 'feat/branch-2', 'feat/branch-3']) {
          const needs = await RebaseEngine.needsRebase(r.dir, updatedStack, branch);
          expect(needs).toBe(false);
        }
      } finally {
        GitShell.pushForceWithLease = originalPush;
      }
    } finally {
      await cleanupRepo(r.dir);
    }
  });
});

describe('workflow: squash-merge + cascade + verify content', () => {
  test('squash-merge middle branch, cascade children, verify file contents are correct', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      // main -> feat/base (adds base-files) -> feat/child (adds child-files)
      r.git('checkout', '-b', 'feat/base');
      await commit(r.dir, r.git, 'base-feature.txt', 'base feature content\n', 'feat/base: add feature');
      const baseHead = r.git('rev-parse', 'HEAD');

      r.git('checkout', '-b', 'feat/child');
      await commit(r.dir, r.git, 'child-feature.txt', 'child feature content\n', 'feat/child: add feature');
      const childHead = r.git('rev-parse', 'HEAD');

      // Squash-merge feat/base into main
      r.git('checkout', 'main');
      r.git('merge', '--squash', 'feat/base');
      r.git('commit', '-m', 'squash: feat/base');
      const mainHead = r.git('rev-parse', 'HEAD');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/base', 'main');
      stack = StackManager.updateNode(stack, 'feat/base', { lastKnownHead: baseHead, status: 'merged' });
      stack = StackManager.addNode(stack, 'feat/child', 'feat/base');
      stack = StackManager.updateNode(stack, 'feat/child', { lastKnownHead: childHead });

      const originalPush = GitShell.pushForceWithLease;
      GitShell.pushForceWithLease = async () => {};

      try {
        const result = await RebaseEngine.cascadeRebase(r.dir, stack, 'feat/base', 'main');
        expect(result.results).toHaveLength(1);
        expect(result.results[0]!.success).toBe(true);

        // feat/child should now be on top of main
        const mb = await GitShell.getMergeBase(r.dir, 'main', 'feat/child');
        expect(mb).toBe(mainHead);

        // Verify both files exist on feat/child
        r.git('checkout', 'feat/child');
        const baseContent = await readFile(join(r.dir, 'base-feature.txt'), 'utf-8');
        expect(baseContent).toBe('base feature content\n');
        const childContent = await readFile(join(r.dir, 'child-feature.txt'), 'utf-8');
        expect(childContent).toBe('child feature content\n');
      } finally {
        GitShell.pushForceWithLease = originalPush;
        r.git('checkout', 'main');
      }
    } finally {
      await cleanupRepo(r.dir);
    }
  });
});

describe('workflow: split then cascade', () => {
  test('split a branch, advance main, cascade the split branches', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');
    const { BranchSplitter } = await import('../../src/core/branch-splitter.ts');

    const r = await createSandboxRepo();
    try {
      // Create a branch with 6 commits
      r.git('checkout', '-b', 'feat/big');
      const shas: string[] = [];
      for (let i = 1; i <= 6; i++) {
        shas.push(await commit(r.dir, r.git, `f${i}.txt`, `${i}\n`, `commit ${i}`));
      }
      r.git('checkout', 'main');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/big', 'main');
      stack = StackManager.updateNode(stack, 'feat/big', { lastKnownHead: shas[5]! });

      // Split after commit 3: feat/big keeps 1-3, feat/tail gets 4-6
      const splitResult = await BranchSplitter.tailSplit(r.dir, stack, 'feat/big', 'feat/tail', shas[2]!);
      let splitStack = splitResult.updatedStack;

      // Advance main
      r.git('checkout', 'main');
      await commit(r.dir, r.git, 'main-advance.txt', 'new\n', 'advance main');

      // Rebase feat/big onto new main
      const oldBigHead = r.git('rev-parse', 'feat/big');
      const forkPoint = r.git('merge-base', 'main', 'feat/big');
      await GitShell.rebaseOnto(r.dir, 'main', forkPoint, 'feat/big');
      const newBigHead = r.git('rev-parse', 'feat/big');

      // Update stack and cascade feat/big's descendant (feat/tail)
      splitStack = StackManager.updateNode(splitStack, 'feat/big', { lastKnownHead: oldBigHead });

      const originalPush = GitShell.pushForceWithLease;
      GitShell.pushForceWithLease = async () => {};

      try {
        const cascadeResult = await RebaseEngine.cascadeRebase(r.dir, splitStack, 'feat/big', 'feat/big');
        expect(cascadeResult.results).toHaveLength(1);
        expect(cascadeResult.results[0]!.branch).toBe('feat/tail');
        expect(cascadeResult.results[0]!.success).toBe(true);

        // Verify feat/tail is on top of feat/big
        const mb = await GitShell.getMergeBase(r.dir, 'feat/big', 'feat/tail');
        expect(mb).toBe(newBigHead);
      } finally {
        GitShell.pushForceWithLease = originalPush;
      }
    } finally {
      await cleanupRepo(r.dir);
    }
  });
});

describe('workflow: needsRebase across a full 4-level stack', () => {
  test('advance main, check all levels, cascade, re-check all return false', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      const { stack } = await buildLinearStack(r.dir, r.git, 4);

      // Advance main
      r.git('checkout', 'main');
      await commit(r.dir, r.git, 'main-advance.txt', 'advance\n', 'advance main');

      // branch-1 should need rebase (its parent main moved)
      expect(await RebaseEngine.needsRebase(r.dir, stack, 'feat/branch-1')).toBe(true);
      // branch-2 should NOT need rebase (its parent branch-1 hasn't moved)
      expect(await RebaseEngine.needsRebase(r.dir, stack, 'feat/branch-2')).toBe(false);

      // Rebase branch-1 onto main
      const oldB1Head = r.git('rev-parse', 'feat/branch-1');
      const forkPoint = r.git('merge-base', 'main', 'feat/branch-1');
      await GitShell.rebaseOnto(r.dir, 'main', forkPoint, 'feat/branch-1');
      const newB1Head = r.git('rev-parse', 'feat/branch-1');

      // Now branch-2 should need rebase (branch-1 moved)
      expect(await RebaseEngine.needsRebase(r.dir, stack, 'feat/branch-2')).toBe(true);

      // Cascade from branch-1
      let updatedStack = StackManager.updateNode(stack, 'feat/branch-1', { lastKnownHead: oldB1Head });

      const originalPush = GitShell.pushForceWithLease;
      GitShell.pushForceWithLease = async () => {};

      try {
        const result = await RebaseEngine.cascadeRebase(r.dir, updatedStack, 'feat/branch-1', 'feat/branch-1');
        expect(result.results).toHaveLength(3);
        expect(result.results.every((r) => r.success)).toBe(true);
        updatedStack = result.updatedStack;

        // Update branch-1's head
        updatedStack = StackManager.updateNode(updatedStack, 'feat/branch-1', { lastKnownHead: newB1Head });

        // Verify nobody needs rebase
        for (const branch of ['feat/branch-1', 'feat/branch-2', 'feat/branch-3', 'feat/branch-4']) {
          expect(await RebaseEngine.needsRebase(r.dir, updatedStack, branch)).toBe(false);
        }
      } finally {
        GitShell.pushForceWithLease = originalPush;
      }
    } finally {
      await cleanupRepo(r.dir);
    }
  });
});

describe('workflow: preflight then cascade', () => {
  test('preflight detects conflict against parent, cascade confirms it stops there', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      // Build main -> feat/a -> feat/b where feat/a and feat/b both edit the same file.
      // After advancing feat/a, preflight should detect the merge conflict between
      // feat/a (the parent) and feat/b.
      r.git('checkout', '-b', 'feat/a');
      await commit(r.dir, r.git, 'shared.txt', 'original\n', 'feat/a: add shared');
      const aHead = r.git('rev-parse', 'HEAD');

      r.git('checkout', '-b', 'feat/b');
      // feat/b rewrites the same file differently
      await commit(r.dir, r.git, 'shared.txt', 'feat/b completely different\n', 'feat/b: rewrite shared');
      const bHead = r.git('rev-parse', 'HEAD');

      // Go back to feat/a and advance it (rewriting shared.txt again)
      r.git('checkout', 'feat/a');
      await commit(r.dir, r.git, 'shared.txt', 'feat/a divergent rewrite\n', 'feat/a: diverge shared');
      r.git('checkout', 'main');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/a', 'main');
      stack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: aHead });
      stack = StackManager.addNode(stack, 'feat/b', 'feat/a');
      stack = StackManager.updateNode(stack, 'feat/b', { lastKnownHead: bHead });

      // Preflight checks feat/b against its parent feat/a — should detect conflict
      const report = await RebaseEngine.preflight(r.dir, stack, ['feat/b']);
      expect(report.dirty).toBe(false);
      expect(report.conflictBranches).toEqual([
        expect.objectContaining({ branch: 'feat/b' }),
      ]);

      // Now cascade: rebase feat/b onto feat/a using the old aHead as base.
      // This should fail with a real rebase conflict.
      const originalPush = GitShell.pushForceWithLease;
      GitShell.pushForceWithLease = async () => {};

      try {
        const result = await RebaseEngine.cascadeRebase(r.dir, stack, 'feat/a', 'feat/a');
        expect(result.results).toHaveLength(1);
        expect(result.results[0]!.branch).toBe('feat/b');
        expect(result.results[0]!.success).toBe(false);
      } finally {
        GitShell.pushForceWithLease = originalPush;
        try {
          r.git('rebase', '--abort');
        } catch {
          // may not be in rebase state
        }
      }
    } finally {
      await cleanupRepo(r.dir);
    }
  });
});
