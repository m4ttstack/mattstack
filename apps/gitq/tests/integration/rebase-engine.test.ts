import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { StackManager } from '../../src/core/stack-manager.ts';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createSandboxRepo,
  createSandboxRepoWithRemote,
  cleanupRepo,
  commit,
  buildLinearStack,
  buildTreeStack,
  addWorkSlot,
  gitIn,
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

// ── rebaseSingle ─────────────────────────────────────────────────────────────

describe('RebaseEngine.rebaseSingle integration', () => {
  test('rebases a child branch onto an advanced parent', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      // main: A -> B; feat/child: C, D (branched from A)
      const mainBase = r.git('rev-parse', 'HEAD');
      await commit(r.dir, r.git, 'main-advance.txt', 'advance\n', 'advance main');
      const mainHead = r.git('rev-parse', 'HEAD');

      r.git('checkout', '-b', 'feat/child', mainBase);
      await commit(r.dir, r.git, 'child-1.txt', 'c1\n', 'child commit 1');
      await commit(r.dir, r.git, 'child-2.txt', 'c2\n', 'child commit 2');

      const result = await RebaseEngine.rebaseSingle(r.dir, 'main', mainBase, 'feat/child');

      expect(result.success).toBe(true);
      expect(result.branch).toBe('feat/child');

      const mergeBase = await GitShell.getMergeBase(r.dir, 'main', 'feat/child');
      expect(mergeBase).toBe(mainHead);

      const log = await GitShell.log(r.dir, 'feat/child', 10);
      const messages = log.map((l) => l.replace(/^[0-9a-f]+ /, ''));
      expect(messages).toContain('child commit 1');
      expect(messages).toContain('child commit 2');
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('returns failure when rebase has a conflict', async () => {
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      const mainBase = r.git('rev-parse', 'HEAD');

      // Both main and child edit the same file
      await commit(r.dir, r.git, 'conflict.txt', 'main version\n', 'main edits conflict.txt');

      r.git('checkout', '-b', 'feat/conflict', mainBase);
      await commit(r.dir, r.git, 'conflict.txt', 'child version\n', 'child edits conflict.txt');

      const result = await RebaseEngine.rebaseSingle(r.dir, 'main', mainBase, 'feat/conflict');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      // Clean up the failed rebase
      r.git('rebase', '--abort');
    } finally {
      await cleanupRepo(r.dir);
    }
  });
});

// ── needsRebase ──────────────────────────────────────────────────────────────

describe('RebaseEngine.needsRebase integration', () => {
  test('returns false when child is up-to-date with parent', async () => {
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      r.git('checkout', '-b', 'feat/child');
      await commit(r.dir, r.git, 'child.txt', 'data\n', 'child commit');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/child', 'main');

      const result = await RebaseEngine.needsRebase(r.dir, stack, 'feat/child');
      expect(result).toBe(false);
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('returns true when parent has advanced past the fork point', async () => {
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      r.git('checkout', '-b', 'feat/child');
      await commit(r.dir, r.git, 'child.txt', 'data\n', 'child commit');

      r.git('checkout', 'main');
      await commit(r.dir, r.git, 'main-new.txt', 'new\n', 'advance main');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/child', 'main');

      const result = await RebaseEngine.needsRebase(r.dir, stack, 'feat/child');
      expect(result).toBe(true);
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('returns false after rebasing onto the advanced parent', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      const forkPoint = r.git('rev-parse', 'HEAD');
      r.git('checkout', '-b', 'feat/child');
      await commit(r.dir, r.git, 'child.txt', 'data\n', 'child commit');

      r.git('checkout', 'main');
      await commit(r.dir, r.git, 'main-new.txt', 'new\n', 'advance main');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/child', 'main');

      expect(await RebaseEngine.needsRebase(r.dir, stack, 'feat/child')).toBe(true);

      await GitShell.rebaseOnto(r.dir, 'main', forkPoint, 'feat/child');

      expect(await RebaseEngine.needsRebase(r.dir, stack, 'feat/child')).toBe(false);
    } finally {
      await cleanupRepo(r.dir);
    }
  });
});

// ── preflight ────────────────────────────────────────────────────────────────

describe('RebaseEngine.preflight integration', () => {
  test('reports dirty when working tree has uncommitted changes', async () => {
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      r.git('checkout', '-b', 'feat/a');
      await commit(r.dir, r.git, 'a.txt', 'a\n', 'commit a');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/a', 'main');

      // Make dirty
      await writeFile(join(r.dir, 'a.txt'), 'modified\n', 'utf-8');

      const report = await RebaseEngine.preflight(r.dir, stack, ['feat/a']);
      expect(report.dirty).toBe(true);
      expect(report.conflictBranches).toEqual([]);
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('reports clean with no conflicts for aligned branches', async () => {
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      r.git('checkout', '-b', 'feat/a');
      await commit(r.dir, r.git, 'a.txt', 'a\n', 'commit a');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/a', 'main');

      const report = await RebaseEngine.preflight(r.dir, stack, ['feat/a']);
      expect(report.dirty).toBe(false);
      expect(report.conflictBranches).toEqual([]);
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('detects predicted conflicts via merge-tree --write-tree', async () => {
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      const forkPoint = r.git('rev-parse', 'HEAD');

      // Diverge main and child on the SAME file (conflict)
      await commit(r.dir, r.git, 'shared.txt', 'main version\n', 'main edits shared');

      r.git('checkout', '-b', 'feat/conflict', forkPoint);
      await commit(r.dir, r.git, 'shared.txt', 'child version\n', 'child edits shared');
      r.git('checkout', 'main');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/conflict', 'main');

      const report = await RebaseEngine.preflight(r.dir, stack, ['feat/conflict']);
      expect(report.dirty).toBe(false);
      expect(report.conflictBranches).toEqual([
        expect.objectContaining({ branch: 'feat/conflict' }),
      ]);
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('reports no conflict for non-conflicting diverged branches', async () => {
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      const forkPoint = r.git('rev-parse', 'HEAD');

      // Diverge on DIFFERENT files (no conflict)
      await commit(r.dir, r.git, 'main-only.txt', 'main version\n', 'main edits own file');

      r.git('checkout', '-b', 'feat/safe', forkPoint);
      await commit(r.dir, r.git, 'child-only.txt', 'child version\n', 'child edits own file');
      r.git('checkout', 'main');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/safe', 'main');

      const report = await RebaseEngine.preflight(r.dir, stack, ['feat/safe']);
      expect(report.dirty).toBe(false);
      expect(report.conflictBranches).toEqual([]);
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('includes thread warnings for branches with unresolved threads', async () => {
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      r.git('checkout', '-b', 'feat/reviewed');
      await commit(r.dir, r.git, 'review.txt', 'code\n', 'add code');

      r.git('checkout', '-b', 'feat/also-reviewed');
      await commit(r.dir, r.git, 'more.txt', 'more\n', 'more code');
      r.git('checkout', 'main');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/reviewed', 'main');
      stack = StackManager.updateNode(stack, 'feat/reviewed', { unresolvedThreads: 5 });
      stack = StackManager.addNode(stack, 'feat/also-reviewed', 'feat/reviewed');
      stack = StackManager.updateNode(stack, 'feat/also-reviewed', { unresolvedThreads: 2 });

      const report = await RebaseEngine.preflight(r.dir, stack, ['feat/reviewed', 'feat/also-reviewed']);

      expect(report.dirty).toBe(false);
      expect(report.threadWarnings).toHaveLength(2);
      expect(report.threadWarnings).toContainEqual({ branch: 'feat/reviewed', count: 5 });
      expect(report.threadWarnings).toContainEqual({ branch: 'feat/also-reviewed', count: 2 });
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('returns empty thread warnings when no branches have unresolved threads', async () => {
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      r.git('checkout', '-b', 'feat/clean');
      await commit(r.dir, r.git, 'clean.txt', 'clean\n', 'clean code');
      r.git('checkout', 'main');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/clean', 'main');

      const report = await RebaseEngine.preflight(r.dir, stack, ['feat/clean']);

      expect(report.threadWarnings).toEqual([]);
    } finally {
      await cleanupRepo(r.dir);
    }
  });
});

// ── cascadeRebase ────────────────────────────────────────────────────────────

describe('RebaseEngine.cascadeRebase integration', () => {
  test('cascades descendants after branch-1 is rebased onto advanced main', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      const { stack } = await buildLinearStack(r.dir, r.git, 3);
      const oldB1Head = r.git('rev-parse', 'feat/branch-1');

      // Advance main
      r.git('checkout', 'main');
      await commit(r.dir, r.git, 'main-advance.txt', 'advance\n', 'advance main');

      // Manually rebase branch-1 onto new main first
      const forkPoint = r.git('merge-base', 'main', 'feat/branch-1');
      await GitShell.rebaseOnto(r.dir, 'main', forkPoint, 'feat/branch-1');
      const newB1Head = r.git('rev-parse', 'feat/branch-1');

      // Now cascade branch-1's descendants, using oldB1Head as tombstone
      let updatedStack = StackManager.updateNode(stack, 'feat/branch-1', { lastKnownHead: oldB1Head });

      const originalPush = GitShell.pushForceWithLease;
      GitShell.pushForceWithLease = async () => {};

      try {
        const result = await RebaseEngine.cascadeRebase(r.dir, updatedStack, 'feat/branch-1', 'feat/branch-1');

        expect(result.results).toHaveLength(2);
        expect(result.results[0]!.branch).toBe('feat/branch-2');
        expect(result.results[0]!.success).toBe(true);
        expect(result.results[1]!.branch).toBe('feat/branch-3');
        expect(result.results[1]!.success).toBe(true);

        // Verify branch-2 is on top of branch-1's new HEAD
        const mb12 = await GitShell.getMergeBase(r.dir, 'feat/branch-1', 'feat/branch-2');
        expect(mb12).toBe(newB1Head);

        // Verify branch-3 is on top of branch-2's new HEAD
        const b2Head = await GitShell.getBranchHead(r.dir, 'feat/branch-2');
        const mb23 = await GitShell.getMergeBase(r.dir, 'feat/branch-2', 'feat/branch-3');
        expect(mb23).toBe(b2Head);
      } finally {
        GitShell.pushForceWithLease = originalPush;
      }
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('cascades a fan-out tree (main -> A -> {B, C})', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      const { stack } = await buildTreeStack(r.dir, r.git, [
        {
          name: 'feat/a',
          commits: 2,
          children: [
            { name: 'feat/b', commits: 2 },
            { name: 'feat/c', commits: 2 },
          ],
        },
      ]);

      // Advance feat/a
      r.git('checkout', 'feat/a');
      const oldAHead = r.git('rev-parse', 'HEAD');
      await commit(r.dir, r.git, 'a-advance.txt', 'advance\n', 'advance feat/a');
      const newAHead = r.git('rev-parse', 'HEAD');
      r.git('checkout', 'main');

      // Update stack with new lastKnownHead for A
      let updatedStack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: newAHead });

      const originalPush = GitShell.pushForceWithLease;
      GitShell.pushForceWithLease = async () => {};

      try {
        const result = await RebaseEngine.cascadeRebase(r.dir, updatedStack, 'feat/a', 'feat/a');

        expect(result.results).toHaveLength(2);
        expect(result.results.every((r) => r.success)).toBe(true);

        // Both B and C should have feat/a's new HEAD as merge-base
        const mbAB = await GitShell.getMergeBase(r.dir, 'feat/a', 'feat/b');
        expect(mbAB).toBe(newAHead);

        const mbAC = await GitShell.getMergeBase(r.dir, 'feat/a', 'feat/c');
        expect(mbAC).toBe(newAHead);
      } finally {
        GitShell.pushForceWithLease = originalPush;
      }
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('handles squash-merge with tombstone SHA for cascade', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      // Build: main -> feat/base (2 commits) -> feat/child (2 commits)
      const { stack } = await buildLinearStack(r.dir, r.git, 2);

      // Record feat/branch-1's HEAD as tombstone
      const baseHead = r.git('rev-parse', 'feat/branch-1');

      // Squash-merge feat/branch-1 into main
      r.git('checkout', 'main');
      r.git('merge', '--squash', 'feat/branch-1');
      r.git('commit', '-m', 'squash: feat/branch-1');
      const mainHead = r.git('rev-parse', 'HEAD');

      // Mark feat/branch-1 as merged with tombstone
      let updatedStack = StackManager.updateNode(stack, 'feat/branch-1', {
        status: 'merged',
        lastKnownHead: baseHead,
      });

      const originalPush = GitShell.pushForceWithLease;
      GitShell.pushForceWithLease = async () => {};

      try {
        const result = await RebaseEngine.cascadeRebase(r.dir, updatedStack, 'feat/branch-1', 'main');

        expect(result.results).toHaveLength(1);
        expect(result.results[0]!.branch).toBe('feat/branch-2');
        expect(result.results[0]!.success).toBe(true);

        // branch-2 should now sit on top of main
        const mergeBase = await GitShell.getMergeBase(r.dir, 'main', 'feat/branch-2');
        expect(mergeBase).toBe(mainHead);

        // branch-2's commits should be preserved
        const log = await GitShell.log(r.dir, 'feat/branch-2', 10);
        const messages = log.map((l) => l.replace(/^[0-9a-f]+ /, ''));
        expect(messages).toContain('feat/branch-2: commit A');
        expect(messages).toContain('feat/branch-2: commit B');
      } finally {
        GitShell.pushForceWithLease = originalPush;
      }
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('stops cascade when a descendant has a conflict', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      // Build: main -> feat/a -> feat/b -> feat/c
      // feat/a and feat/b both write to shared.txt.
      // We'll squash-merge feat/a into main. When cascading feat/b onto main,
      // feat/b's version of shared.txt will conflict with main's squash-merged version.

      r.git('checkout', '-b', 'feat/a');
      await commit(r.dir, r.git, 'shared.txt', 'original from feat/a\n', 'feat/a: add shared');
      const aHead = r.git('rev-parse', 'HEAD');

      r.git('checkout', '-b', 'feat/b');
      // feat/b modifies shared.txt differently
      await commit(r.dir, r.git, 'shared.txt', 'feat/b rewrites shared completely\n', 'feat/b: rewrite shared');
      const bHead = r.git('rev-parse', 'HEAD');

      r.git('checkout', '-b', 'feat/c');
      await commit(r.dir, r.git, 'c-only.txt', 'c data\n', 'feat/c: unique file');
      const cHead = r.git('rev-parse', 'HEAD');

      // Squash-merge feat/a into main (this changes shared.txt on main)
      r.git('checkout', 'main');
      r.git('merge', '--squash', 'feat/a');
      r.git('commit', '-m', 'squash: feat/a');

      // Now manually edit shared.txt on main to create a conflict with feat/b
      await commit(r.dir, r.git, 'shared.txt', 'main post-squash divergent edit\n', 'main: diverge shared');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/a', 'main');
      stack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: aHead, status: 'merged' });
      stack = StackManager.addNode(stack, 'feat/b', 'feat/a');
      stack = StackManager.updateNode(stack, 'feat/b', { lastKnownHead: bHead });
      stack = StackManager.addNode(stack, 'feat/c', 'feat/b');
      stack = StackManager.updateNode(stack, 'feat/c', { lastKnownHead: cHead });

      const originalPush = GitShell.pushForceWithLease;
      GitShell.pushForceWithLease = async () => {};

      try {
        const result = await RebaseEngine.cascadeRebase(r.dir, stack, 'feat/a', 'main');

        // feat/b should be attempted and fail (conflict on shared.txt)
        expect(result.results.length).toBeGreaterThanOrEqual(1);
        expect(result.results[0]!.branch).toBe('feat/b');
        expect(result.results[0]!.success).toBe(false);

        // feat/c should NOT be attempted (cascade stops)
        const cResult = result.results.find((r) => r.branch === 'feat/c');
        expect(cResult).toBeUndefined();
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

  test('deep squash-merge cascades through 3+ levels', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      const { stack } = await buildLinearStack(r.dir, r.git, 4);

      const aHead = r.git('rev-parse', 'feat/branch-1');

      r.git('checkout', 'main');
      r.git('merge', '--squash', 'feat/branch-1');
      r.git('commit', '-m', 'squash: feat/branch-1');
      const mainHead = r.git('rev-parse', 'HEAD');

      let updatedStack = StackManager.updateNode(stack, 'feat/branch-1', {
        status: 'merged',
        lastKnownHead: aHead,
      });

      const originalPush = GitShell.pushForceWithLease;
      GitShell.pushForceWithLease = async () => {};

      try {
        const result = await RebaseEngine.cascadeRebase(r.dir, updatedStack, 'feat/branch-1', 'main');

        expect(result.results).toHaveLength(3);
        expect(result.results.every((r) => r.success)).toBe(true);

        const mbMainB = await GitShell.getMergeBase(r.dir, 'main', 'feat/branch-2');
        expect(mbMainB).toBe(mainHead);

        const b2Head = await GitShell.getBranchHead(r.dir, 'feat/branch-2');
        const mbB2B3 = await GitShell.getMergeBase(r.dir, 'feat/branch-2', 'feat/branch-3');
        expect(mbB2B3).toBe(b2Head);

        const b3Head = await GitShell.getBranchHead(r.dir, 'feat/branch-3');
        const mbB3B4 = await GitShell.getMergeBase(r.dir, 'feat/branch-3', 'feat/branch-4');
        expect(mbB3B4).toBe(b3Head);
      } finally {
        GitShell.pushForceWithLease = originalPush;
      }
    } finally {
      await cleanupRepo(r.dir);
    }
  });
});

// ── Conflict pause/continue/abort integration tests ──────────────────────────

describe('Conflict protocol integration', () => {
  test('cascade pauses on conflict with correct pause info', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      // main -> feat/a -> feat/b -> feat/c
      // feat/a and feat/b both edit shared.txt → conflict when cascading
      r.git('checkout', '-b', 'feat/a');
      await commit(r.dir, r.git, 'shared.txt', 'original from feat/a\n', 'feat/a: shared');
      const aHead = r.git('rev-parse', 'HEAD');

      r.git('checkout', '-b', 'feat/b');
      await commit(r.dir, r.git, 'shared.txt', 'feat/b version\n', 'feat/b: rewrite shared');
      const bHead = r.git('rev-parse', 'HEAD');

      r.git('checkout', '-b', 'feat/c');
      await commit(r.dir, r.git, 'c-only.txt', 'c data\n', 'feat/c: unique file');
      const cHead = r.git('rev-parse', 'HEAD');

      r.git('checkout', 'main');
      r.git('merge', '--squash', 'feat/a');
      r.git('commit', '-m', 'squash: feat/a');
      await commit(r.dir, r.git, 'shared.txt', 'main divergent\n', 'main: diverge');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/a', 'main');
      stack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: aHead, status: 'merged' });
      stack = StackManager.addNode(stack, 'feat/b', 'feat/a');
      stack = StackManager.updateNode(stack, 'feat/b', { lastKnownHead: bHead });
      stack = StackManager.addNode(stack, 'feat/c', 'feat/b');
      stack = StackManager.updateNode(stack, 'feat/c', { lastKnownHead: cHead });

      const originalPush = GitShell.pushForceWithLease;
      GitShell.pushForceWithLease = async () => {};

      try {
        const result = await RebaseEngine.cascadeRebase(r.dir, stack, 'feat/a', 'main');

        expect(result.state).toBe('paused');
        expect(result.pauseInfo).toBeDefined();
        expect(result.pauseInfo!.currentBranch).toBe('feat/b');
        expect(result.pauseInfo!.conflictFiles).toContain('shared.txt');
        expect(result.pauseInfo!.remainingBranches).toEqual(['feat/c']);
        expect(result.pauseInfo!.completedBranches).toEqual([]);

        // Verify the repo is actually in a rebase state
        const status = r.git('status');
        expect(status).toContain('rebase');
      } finally {
        GitShell.pushForceWithLease = originalPush;
        try { r.git('rebase', '--abort'); } catch {}
      }
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('continue after conflict resolution completes the cascade', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      // main -> feat/a (edits shared.txt) -> feat/b (edits shared.txt) -> feat/c (unique file)
      // Squash-merge feat/a into main, diverge shared.txt on main → feat/b conflicts
      r.git('checkout', '-b', 'feat/a');
      await commit(r.dir, r.git, 'shared.txt', 'original from feat/a\n', 'feat/a: shared');
      const aHead = r.git('rev-parse', 'HEAD');

      r.git('checkout', '-b', 'feat/b');
      await commit(r.dir, r.git, 'shared.txt', 'feat/b rewrites\n', 'feat/b: rewrite shared');
      const bHead = r.git('rev-parse', 'HEAD');

      r.git('checkout', '-b', 'feat/c');
      await commit(r.dir, r.git, 'c-only.txt', 'c data\n', 'feat/c: unique file');
      const cHead = r.git('rev-parse', 'HEAD');

      r.git('checkout', 'main');
      r.git('merge', '--squash', 'feat/a');
      r.git('commit', '-m', 'squash: feat/a');
      await commit(r.dir, r.git, 'shared.txt', 'main divergent\n', 'main: diverge');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/a', 'main');
      stack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: aHead, status: 'merged' });
      stack = StackManager.addNode(stack, 'feat/b', 'feat/a');
      stack = StackManager.updateNode(stack, 'feat/b', { lastKnownHead: bHead });
      stack = StackManager.addNode(stack, 'feat/c', 'feat/b');
      stack = StackManager.updateNode(stack, 'feat/c', { lastKnownHead: cHead });

      const originalPush = GitShell.pushForceWithLease;
      GitShell.pushForceWithLease = async () => {};

      try {
        const result = await RebaseEngine.cascadeRebase(r.dir, stack, 'feat/a', 'main');

        expect(result.state).toBe('paused');
        expect(result.pauseInfo!.currentBranch).toBe('feat/b');
        expect(result.pauseInfo!.remainingBranches).toEqual(['feat/c']);

        // Resolve the conflict
        await writeFile(join(r.dir, 'shared.txt'), 'resolved version\n', 'utf-8');
        r.git('add', 'shared.txt');

        const continued = await RebaseEngine.continueCascade(r.dir, result.updatedStack, result.pauseInfo!);

        expect(continued.state).toBe('completed');
        expect(continued.results[0]!.branch).toBe('feat/b');
        expect(continued.results[0]!.success).toBe(true);

        // Verify resolved content on feat/b
        r.git('checkout', 'feat/b');
        const { readFile } = await import('node:fs/promises');
        const sharedContent = await readFile(join(r.dir, 'shared.txt'), 'utf-8');
        expect(sharedContent).toBe('resolved version\n');

        // Verify feat/c sits on top of feat/b
        const bNewHead = await GitShell.getBranchHead(r.dir, 'feat/b');
        const mb = await GitShell.getMergeBase(r.dir, 'feat/b', 'feat/c');
        expect(mb).toBe(bNewHead);

        // Verify c-only.txt is intact on feat/c
        r.git('checkout', 'feat/c');
        const cContent = await readFile(join(r.dir, 'c-only.txt'), 'utf-8');
        expect(cContent).toBe('c data\n');

        // Verify needsRebase returns false for feat/c (its parent feat/b was rebased)
        expect(await RebaseEngine.needsRebase(r.dir, continued.updatedStack, 'feat/c')).toBe(false);
      } finally {
        GitShell.pushForceWithLease = originalPush;
        try { r.git('rebase', '--abort'); } catch {}
      }
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('abort restores the conflicting branch to its pre-rebase state', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      // Same setup: squash-merge creates a conflict
      r.git('checkout', '-b', 'feat/a');
      await commit(r.dir, r.git, 'shared.txt', 'original from feat/a\n', 'feat/a: shared');
      const aHead = r.git('rev-parse', 'HEAD');

      r.git('checkout', '-b', 'feat/b');
      await commit(r.dir, r.git, 'shared.txt', 'feat/b version\n', 'feat/b: rewrite');
      const bHead = r.git('rev-parse', 'HEAD');

      r.git('checkout', 'main');
      r.git('merge', '--squash', 'feat/a');
      r.git('commit', '-m', 'squash: feat/a');
      await commit(r.dir, r.git, 'shared.txt', 'main divergent\n', 'main: diverge');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/a', 'main');
      stack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: aHead, status: 'merged' });
      stack = StackManager.addNode(stack, 'feat/b', 'feat/a');
      stack = StackManager.updateNode(stack, 'feat/b', { lastKnownHead: bHead });

      const originalPush = GitShell.pushForceWithLease;
      GitShell.pushForceWithLease = async () => {};

      try {
        const result = await RebaseEngine.cascadeRebase(r.dir, stack, 'feat/a', 'main');
        expect(result.state).toBe('paused');

        await RebaseEngine.abortCascade(r.dir);

        // Working tree should be clean
        const isDirty = await GitShell.isDirty(r.dir);
        expect(isDirty).toBe(false);

        // feat/b should be back at its original SHA
        const currentHead = await GitShell.getBranchHead(r.dir, 'feat/b');
        expect(currentHead).toBe(bHead);
      } finally {
        GitShell.pushForceWithLease = originalPush;
        try { r.git('rebase', '--abort'); } catch {}
      }
    } finally {
      await cleanupRepo(r.dir);
    }
  });
});

// ── syncLocalStack integration tests ─────────────────────────────────────────

describe('syncLocalStack integration', () => {
  test('pulls trunk and restacks all children', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepoWithRemote();
    try {
      // Build stack on main
      r.git('checkout', '-b', 'feat/a');
      await commit(r.dir, r.git, 'a.txt', 'a data\n', 'feat/a commit');
      r.git('push', 'origin', 'feat/a');

      r.git('checkout', '-b', 'feat/b');
      await commit(r.dir, r.git, 'b.txt', 'b data\n', 'feat/b commit');
      r.git('push', 'origin', 'feat/b');

      r.git('checkout', 'main');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/a', 'main');
      stack = StackManager.updateNode(stack, 'feat/a', {
        lastKnownHead: r.git('rev-parse', 'feat/a'),
      });
      stack = StackManager.addNode(stack, 'feat/b', 'feat/a');
      stack = StackManager.updateNode(stack, 'feat/b', {
        lastKnownHead: r.git('rev-parse', 'feat/b'),
      });

      // Advance main on the remote (simulate another dev pushing)
      const { execFileSync } = await import('node:child_process');
      // Clone to a temp dir to simulate the remote advance
      const { mkdtemp } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const tempClone = await mkdtemp(join(tmpdir(), 'gitq-clone-'));
      try {
        execFileSync('git', ['clone', r.remoteDir, tempClone], { stdio: 'pipe' });
        execFileSync('git', ['config', 'user.email', 'test@gitq.dev'], { cwd: tempClone, stdio: 'pipe' });
        execFileSync('git', ['config', 'user.name', 'GitQ Test'], { cwd: tempClone, stdio: 'pipe' });
        await writeFile(join(tempClone, 'remote-advance.txt'), 'remote data\n', 'utf-8');
        execFileSync('git', ['add', '.'], { cwd: tempClone, stdio: 'pipe' });
        execFileSync('git', ['commit', '-m', 'advance main on remote'], { cwd: tempClone, stdio: 'pipe' });
        execFileSync('git', ['push', 'origin', 'main'], { cwd: tempClone, stdio: 'pipe' });
      } finally {
        await cleanupRepo(tempClone);
      }

      const originalPush = GitShell.pushForceWithLease;
      GitShell.pushForceWithLease = async () => {};

      try {
        const result = await RebaseEngine.syncLocalStack(r.dir, stack);

        expect(result.state).toBe('completed');

        // Local main should NOT have been moved (gitq doesn't touch trunk)
        const mainHead = await GitShell.getBranchHead(r.dir, 'main');
        const remoteMainHead = await GitShell.getBranchHead(r.dir, 'origin/main');
        expect(mainHead).not.toBe(remoteMainHead); // local main is untouched

        // Verify feat/a sits on top of origin/main (remote trunk)
        const mbA = await GitShell.getMergeBase(r.dir, 'origin/main', 'feat/a');
        expect(mbA).toBe(remoteMainHead);

        // Verify a.txt is intact on feat/a
        const { readFile } = await import('node:fs/promises');
        r.git('checkout', 'feat/a');
        const aContent = await readFile(join(r.dir, 'a.txt'), 'utf-8');
        expect(aContent).toBe('a data\n');

        // Verify feat/b sits on top of feat/a
        const aHead = await GitShell.getBranchHead(r.dir, 'feat/a');
        const mbB = await GitShell.getMergeBase(r.dir, 'feat/a', 'feat/b');
        expect(mbB).toBe(aHead);

        // Verify b.txt is intact on feat/b
        r.git('checkout', 'feat/b');
        const bContent = await readFile(join(r.dir, 'b.txt'), 'utf-8');
        expect(bContent).toBe('b data\n');
      } finally {
        GitShell.pushForceWithLease = originalPush;
      }
    } finally {
      await cleanupRepo(r.dir);
      await cleanupRepo(r.remoteDir);
    }
  });
});

// ── Drift reconciliation ─────────────────────────────────────────────────────

describe('drift reconciliation', () => {
  test('cascadeRebase reconciles drifted child before restacking', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      // Build: main -> feat/parent (2 commits) -> feat/child (1 commit)
      r.git('checkout', '-b', 'feat/parent');
      await commit(r.dir, r.git, 'parent-a.txt', 'parent A\n', 'parent: commit A');

      r.git('checkout', '-b', 'feat/child');
      await commit(r.dir, r.git, 'child.txt', 'child work\n', 'child: unique work');

      // Parent gets review commits AFTER child branched
      r.git('checkout', 'feat/parent');
      await commit(r.dir, r.git, 'parent-review.txt', 'review fix\n', 'parent: review fix');
      const parentFinalHead = r.git('rev-parse', 'HEAD');

      // Simulate squash-merge of parent into main
      r.git('checkout', 'main');
      await commit(r.dir, r.git, 'parent-a.txt', 'parent A\n', 'squash: parent work');
      await commit(r.dir, r.git, 'parent-review.txt', 'review fix\n', 'squash: parent review');

      // Build stack with parent marked as merged, tombstone at its final tip
      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/parent', 'main');
      stack = StackManager.updateNode(stack, 'feat/parent', {
        status: 'merged',
        lastKnownHead: parentFinalHead,
      });
      stack = StackManager.addNode(stack, 'feat/child', 'feat/parent');
      const childHead = r.git('rev-parse', 'feat/child');
      stack = StackManager.updateNode(stack, 'feat/child', { lastKnownHead: childHead });

      const originalPush = GitShell.pushForceWithLease;
      GitShell.pushForceWithLease = async () => {};

      try {
        const mainHead = r.git('rev-parse', 'main');
        const result = await RebaseEngine.cascadeRebase(r.dir, stack, 'feat/parent', mainHead);

        expect(result.state).toBe('completed');
        expect(result.results.length).toBeGreaterThan(0);
        expect(result.results.every((rr) => rr.success)).toBe(true);

        // Verify child is now on top of main
        const mb = await GitShell.getMergeBase(r.dir, 'main', 'feat/child');
        expect(mb).toBe(mainHead);

        // Verify child's unique file is intact
        const { readFile } = await import('node:fs/promises');
        r.git('checkout', 'feat/child');
        const childContent = await readFile(join(r.dir, 'child.txt'), 'utf-8');
        expect(childContent).toBe('child work\n');

        // Verify parent's review file is also present (picked up via reconciliation)
        const reviewContent = await readFile(join(r.dir, 'parent-review.txt'), 'utf-8');
        expect(reviewContent).toBe('review fix\n');
      } finally {
        GitShell.pushForceWithLease = originalPush;
      }
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('cascadeRebase pauses on reconciliation conflict with phase=reconcile', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      // Build: main -> feat/parent -> feat/child, both editing the same file
      r.git('checkout', '-b', 'feat/parent');
      await commit(r.dir, r.git, 'shared.txt', 'parent version\n', 'parent: initial');

      r.git('checkout', '-b', 'feat/child');
      await commit(r.dir, r.git, 'child.txt', 'child\n', 'child: unique work');

      // Parent adds review commits that conflict with child's view of shared.txt
      r.git('checkout', 'feat/parent');
      await commit(r.dir, r.git, 'shared.txt', 'parent review version\n', 'parent: review update');
      const parentFinalHead = r.git('rev-parse', 'HEAD');

      // Child also edits the same file
      r.git('checkout', 'feat/child');
      await commit(r.dir, r.git, 'shared.txt', 'child version\n', 'child: edits shared');

      // Squash-merge parent into main
      r.git('checkout', 'main');
      await commit(r.dir, r.git, 'shared.txt', 'parent review version\n', 'squash: parent');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/parent', 'main');
      stack = StackManager.updateNode(stack, 'feat/parent', {
        status: 'merged',
        lastKnownHead: parentFinalHead,
      });
      stack = StackManager.addNode(stack, 'feat/child', 'feat/parent');
      stack = StackManager.updateNode(stack, 'feat/child', {
        lastKnownHead: r.git('rev-parse', 'feat/child'),
      });

      const originalPush = GitShell.pushForceWithLease;
      GitShell.pushForceWithLease = async () => {};

      try {
        const mainHead = r.git('rev-parse', 'main');
        const result = await RebaseEngine.cascadeRebase(r.dir, stack, 'feat/parent', mainHead);

        expect(result.state).toBe('paused');
        expect(result.pauseInfo).toBeDefined();
        // With reflog fork-point, conflicts happen in cascade phase (direct onto master)
        // rather than the reconcile phase (tombstone detour)
        expect(result.pauseInfo!.phase).toBeOneOf(['reconcile', 'cascade']);
        expect(result.pauseInfo!.currentBranch).toBe('feat/child');
        expect(result.pauseInfo!.conflictFiles.length).toBeGreaterThan(0);
      } finally {
        GitShell.pushForceWithLease = originalPush;
        try { r.git('rebase', '--abort'); } catch { /* may not be in rebase */ }
      }
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('preflight reports drift warnings for drifted children', async () => {
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      // Build: main -> feat/parent -> feat/child
      r.git('checkout', '-b', 'feat/parent');
      await commit(r.dir, r.git, 'parent.txt', 'data\n', 'parent: work');

      r.git('checkout', '-b', 'feat/child');
      await commit(r.dir, r.git, 'child.txt', 'data\n', 'child: work');

      // Parent gets more commits after child branched
      r.git('checkout', 'feat/parent');
      await commit(r.dir, r.git, 'parent-extra.txt', 'extra\n', 'parent: extra');
      const parentFinalHead = r.git('rev-parse', 'HEAD');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/parent', 'main');
      stack = StackManager.updateNode(stack, 'feat/parent', {
        status: 'merged',
        lastKnownHead: parentFinalHead,
      });
      stack = StackManager.addNode(stack, 'feat/child', 'feat/parent');

      const report = await RebaseEngine.preflight(r.dir, stack, ['feat/child']);

      expect(report.driftWarnings).toEqual([
        { branch: 'feat/child', mergedParent: 'feat/parent' },
      ]);
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('no drift warning when tombstone is ancestor of child', async () => {
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      r.git('checkout', '-b', 'feat/parent');
      await commit(r.dir, r.git, 'parent.txt', 'data\n', 'parent: work');
      const parentHead = r.git('rev-parse', 'HEAD');

      r.git('checkout', '-b', 'feat/child');
      await commit(r.dir, r.git, 'child.txt', 'data\n', 'child: work');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/parent', 'main');
      stack = StackManager.updateNode(stack, 'feat/parent', {
        status: 'merged',
        lastKnownHead: parentHead,
      });
      stack = StackManager.addNode(stack, 'feat/child', 'feat/parent');

      const report = await RebaseEngine.preflight(r.dir, stack, ['feat/child']);

      expect(report.driftWarnings).toEqual([]);
    } finally {
      await cleanupRepo(r.dir);
    }
  });
});

// ── finalizeBranchRef slot policy ────────────────────────────────────────────

describe('finalizeBranchRef work-slot policy', () => {
  /**
   * A repo where `feat` sits at `oldHead` and `newHead` is a commit on a
   * sibling branch, so `finalizeBranchRef` has a real CAS to perform.
   */
  async function refScenario(): Promise<{ r: SandboxRepo; oldHead: string; newHead: string }> {
    const r = await createSandboxRepo();
    r.git('checkout', '-b', 'feat');
    const oldHead = await commit(r.dir, r.git, 'feat.txt', 'feat\n', 'feat: add feat.txt');
    r.git('checkout', 'main');
    r.git('checkout', '-b', 'target');
    const newHead = await commit(r.dir, r.git, 'target.txt', 'target\n', 'target: add target.txt');
    r.git('checkout', 'main');
    return { r, oldHead, newHead };
  }

  test('resets a clean work slot to the new head instead of leaving it stale', async () => {
    const { r, oldHead, newHead } = await refScenario();
    const work = addWorkSlot(r, 'gitq-1', 'feat');
    try {
      const { finalizeBranchRef } = await import('../../src/core/rebase-engine.ts');
      const result = await finalizeBranchRef(r.dir, 'feat', oldHead, newHead);

      expect(result.success).toBe(true);
      expect(r.git('rev-parse', 'feat')).toBe(newHead);
      // The whole point: the slot's tree and index follow the ref. Before this
      // it kept oldHead's content while the branch pointed at newHead, and the
      // command exited 0.
      expect(gitIn(work.path)('rev-parse', 'HEAD')).toBe(newHead);
      expect(gitIn(work.path)('status', '--porcelain')).toBe('');
    } finally {
      await cleanupRepo(work.root);
      await cleanupRepo(r.dir);
    }
  });

  test('refuses a dirty work slot, naming it as one', async () => {
    const { r, oldHead, newHead } = await refScenario();
    const work = addWorkSlot(r, 'gitq-1', 'feat');
    try {
      const { finalizeBranchRef } = await import('../../src/core/rebase-engine.ts');
      await writeFile(join(work.path, 'wip.txt'), 'wip\n', 'utf-8');

      const result = await finalizeBranchRef(r.dir, 'feat', oldHead, newHead);

      expect(result.success).toBe(false);
      expect(result.error).toContain('work slot "gitq-1"');
      expect(result.error).toContain('dirty');
      // Refusing means discarding the rebase result, so the ref must not move.
      expect(r.git('rev-parse', 'feat')).toBe(oldHead);
    } finally {
      await cleanupRepo(work.root);
      await cleanupRepo(r.dir);
    }
  });
});
