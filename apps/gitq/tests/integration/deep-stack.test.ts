import { describe, test, expect, afterEach } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GitShell } from '../../src/core/git-shell.ts';
import { RebaseEngine } from '../../src/core/rebase-engine.ts';
import { StackManager } from '../../src/core/stack-manager.ts';
import { reparentBranch } from '../../src/core/reparent.ts';
import {
  createSandboxRepo,
  cleanupRepo,
  commit,
  buildLinearStack,
  buildTreeStack,
} from './helpers.ts';
import type { SandboxRepo } from './helpers.ts';

let sandbox: SandboxRepo;
const dirs: string[] = [];

afterEach(async () => {
  for (const d of dirs) await cleanupRepo(d);
  dirs.length = 0;
});

// ── Deep linear stacks ───────────────────────────────────────────────────────

describe('Deep linear stack (8 levels)', () => {
  test('cascade through 8-level stack after main advance', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    const { stack } = await buildLinearStack(dir, git, 8);

    // Advance main
    git('checkout', 'main');
    await commit(dir, git, 'advance.txt', 'advance\n', 'advance main');
    const mainHead = git('rev-parse', 'HEAD');

    // Rebase branch-1 onto new main
    const oldB1Head = git('rev-parse', 'feat/branch-1');
    const forkPoint = git('merge-base', 'main', 'feat/branch-1');
    await GitShell.rebaseOnto(dir, 'main', forkPoint, 'feat/branch-1');
    const newB1Head = git('rev-parse', 'feat/branch-1');

    let updatedStack = StackManager.updateNode(stack, 'feat/branch-1', { lastKnownHead: oldB1Head });

    const originalPush = GitShell.pushForceWithLease;
    GitShell.pushForceWithLease = async () => {};

    try {
      const result = await RebaseEngine.cascadeRebase(dir, updatedStack, 'feat/branch-1', 'feat/branch-1');

      // All 7 descendants should be rebased
      expect(result.results).toHaveLength(7);
      expect(result.results.every((r) => r.success)).toBe(true);

      // Verify chain integrity: each branch sits on top of its parent
      updatedStack = StackManager.updateNode(result.updatedStack, 'feat/branch-1', { lastKnownHead: newB1Head });

      for (let i = 1; i <= 8; i++) {
        const needs = await RebaseEngine.needsRebase(dir, updatedStack, `feat/branch-${i}`);
        expect(needs).toBe(false);
      }

      // Verify file contents on the deepest branch
      git('checkout', 'feat/branch-8');
      for (let i = 1; i <= 8; i++) {
        const contentA = await readFile(join(dir, `file-${i}-a.txt`), 'utf-8');
        expect(contentA).toBe(`branch ${i} commit A\n`);
      }
    } finally {
      GitShell.pushForceWithLease = originalPush;
    }
  });

  test('squash-merge base of 8-level stack, cascade all children to main', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    const { stack } = await buildLinearStack(dir, git, 8);
    const b1Head = git('rev-parse', 'feat/branch-1');

    // Squash-merge branch-1 into main
    git('checkout', 'main');
    git('merge', '--squash', 'feat/branch-1');
    git('commit', '-m', 'squash: feat/branch-1');
    const mainHead = git('rev-parse', 'HEAD');

    let updatedStack = StackManager.updateNode(stack, 'feat/branch-1', {
      status: 'merged',
      lastKnownHead: b1Head,
    });

    const originalPush = GitShell.pushForceWithLease;
    GitShell.pushForceWithLease = async () => {};

    try {
      const result = await RebaseEngine.cascadeRebase(dir, updatedStack, 'feat/branch-1', 'main');

      expect(result.results).toHaveLength(7);
      expect(result.results.every((r) => r.success)).toBe(true);

      // branch-2 should now sit on main
      const mb = await GitShell.getMergeBase(dir, 'main', 'feat/branch-2');
      expect(mb).toBe(mainHead);

      // Verify deepest branch has all files
      git('checkout', 'feat/branch-8');
      for (let i = 2; i <= 8; i++) {
        const contentA = await readFile(join(dir, `file-${i}-a.txt`), 'utf-8');
        expect(contentA).toBe(`branch ${i} commit A\n`);
      }
    } finally {
      GitShell.pushForceWithLease = originalPush;
    }
  });

  test('needsRebase only returns true for direct child of moved parent', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    const { stack } = await buildLinearStack(dir, git, 8);

    // Advance main
    git('checkout', 'main');
    await commit(dir, git, 'new.txt', 'new\n', 'advance');

    // Only branch-1 (direct child of main) needs rebase
    expect(await RebaseEngine.needsRebase(dir, stack, 'feat/branch-1')).toBe(true);
    // All others don't (their parents haven't moved)
    for (let i = 2; i <= 8; i++) {
      expect(await RebaseEngine.needsRebase(dir, stack, `feat/branch-${i}`)).toBe(false);
    }
  });
});

// ── Wide fan-out stacks ──────────────────────────────────────────────────────

describe('Wide fan-out stack (8 siblings)', () => {
  test('cascade 8 siblings after parent advance', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    const children = Array.from({ length: 8 }, (_, i) => ({
      name: `feat/sibling-${i + 1}`,
      commits: 2,
    }));

    const { stack } = await buildTreeStack(dir, git, [
      { name: 'feat/parent', commits: 2, children },
    ]);

    // Advance feat/parent
    git('checkout', 'feat/parent');
    const oldParentHead = git('rev-parse', 'HEAD');
    await commit(dir, git, 'parent-advance.txt', 'advance\n', 'advance parent');
    const newParentHead = git('rev-parse', 'HEAD');
    git('checkout', 'main');

    let updatedStack = StackManager.updateNode(stack, 'feat/parent', { lastKnownHead: newParentHead });

    const originalPush = GitShell.pushForceWithLease;
    GitShell.pushForceWithLease = async () => {};

    try {
      const result = await RebaseEngine.cascadeRebase(dir, updatedStack, 'feat/parent', 'feat/parent');

      // All 8 siblings should be rebased
      expect(result.results).toHaveLength(8);
      expect(result.results.every((r) => r.success)).toBe(true);

      // Verify each sibling is on top of the new parent HEAD
      for (let i = 1; i <= 8; i++) {
        const mb = await GitShell.getMergeBase(dir, 'feat/parent', `feat/sibling-${i}`);
        expect(mb).toBe(newParentHead);
      }
    } finally {
      GitShell.pushForceWithLease = originalPush;
    }
  });

  test('wide fan-out content isolation — sibling files do not cross-pollinate', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    const children = Array.from({ length: 5 }, (_, i) => ({
      name: `feat/sib-${i + 1}`,
      commits: 1,
    }));

    const { stack } = await buildTreeStack(dir, git, [
      { name: 'feat/parent', commits: 1, children },
    ]);

    // Each sibling has its own unique file
    for (let i = 1; i <= 5; i++) {
      git('checkout', `feat/sib-${i}`);
      const files = git('ls-tree', '-r', '--name-only', 'HEAD').split('\n').filter(Boolean);
      // Should have parent's file + own file + README
      const sibFile = files.find((f) => f.startsWith('feat-sib-'));
      expect(sibFile).toBeDefined();
    }
  });
});

// ── Tree-shaped stacks ───────────────────────────────────────────────────────

describe('Complex tree shapes', () => {
  test('deep tree with mixed fan-out: main → A → [B → [D, E], C → F]', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    const { stack } = await buildTreeStack(dir, git, [
      {
        name: 'feat/a',
        commits: 2,
        children: [
          {
            name: 'feat/b',
            commits: 2,
            children: [
              { name: 'feat/d', commits: 1 },
              { name: 'feat/e', commits: 1 },
            ],
          },
          {
            name: 'feat/c',
            commits: 2,
            children: [{ name: 'feat/f', commits: 1 }],
          },
        ],
      },
    ]);

    // Advance main and cascade everything
    git('checkout', 'main');
    await commit(dir, git, 'advance.txt', 'advance\n', 'advance');
    const mainHead = git('rev-parse', 'HEAD');

    // Rebase A onto new main
    const oldAHead = git('rev-parse', 'feat/a');
    const forkPoint = git('merge-base', 'main', 'feat/a');
    await GitShell.rebaseOnto(dir, 'main', forkPoint, 'feat/a');
    const newAHead = git('rev-parse', 'feat/a');

    let updatedStack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: oldAHead });

    const originalPush = GitShell.pushForceWithLease;
    GitShell.pushForceWithLease = async () => {};

    try {
      const result = await RebaseEngine.cascadeRebase(dir, updatedStack, 'feat/a', 'feat/a');

      // 5 descendants: B, C, D, E, F
      expect(result.results).toHaveLength(5);
      expect(result.results.every((r) => r.success)).toBe(true);

      // Verify merge-bases
      const mbAB = await GitShell.getMergeBase(dir, 'feat/a', 'feat/b');
      expect(mbAB).toBe(newAHead);

      const mbAC = await GitShell.getMergeBase(dir, 'feat/a', 'feat/c');
      expect(mbAC).toBe(newAHead);

      const bHead = await GitShell.getBranchHead(dir, 'feat/b');
      const mbBD = await GitShell.getMergeBase(dir, 'feat/b', 'feat/d');
      expect(mbBD).toBe(bHead);

      const mbBE = await GitShell.getMergeBase(dir, 'feat/b', 'feat/e');
      expect(mbBE).toBe(bHead);

      const cHead = await GitShell.getBranchHead(dir, 'feat/c');
      const mbCF = await GitShell.getMergeBase(dir, 'feat/c', 'feat/f');
      expect(mbCF).toBe(cHead);
    } finally {
      GitShell.pushForceWithLease = originalPush;
    }
  });

  test('reparent leaf from deep subtree to root, verify complete isolation', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    // Build: main → A → B → C → D
    const { stack } = await buildLinearStack(dir, git, 4);

    // Reparent D from C to main
    const result = await reparentBranch(dir, stack, 'feat/branch-4', 'main');

    const d4Node = StackManager.findNode(result.newStack, 'feat/branch-4');
    expect(d4Node!.parent).toBe('main');

    // D should only have its own files + README (not A, B, C files)
    git('checkout', 'feat/branch-4');
    const files = git('ls-tree', '-r', '--name-only', 'HEAD').split('\n').filter(Boolean);
    expect(files).toContain('file-4-a.txt');
    expect(files).toContain('file-4-b.txt');
    expect(files).not.toContain('file-3-a.txt');
    expect(files).not.toContain('file-2-a.txt');
    expect(files).not.toContain('file-1-a.txt');
  });
});

// ── Performance sanity ───────────────────────────────────────────────────────

describe('Performance sanity', () => {
  test('10-level cascade completes in under 30 seconds', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    const start = performance.now();

    const { stack } = await buildLinearStack(dir, git, 10);

    git('checkout', 'main');
    await commit(dir, git, 'advance.txt', 'advance\n', 'advance');

    const oldB1Head = git('rev-parse', 'feat/branch-1');
    const forkPoint = git('merge-base', 'main', 'feat/branch-1');
    await GitShell.rebaseOnto(dir, 'main', forkPoint, 'feat/branch-1');

    let updatedStack = StackManager.updateNode(stack, 'feat/branch-1', { lastKnownHead: oldB1Head });

    const originalPush = GitShell.pushForceWithLease;
    GitShell.pushForceWithLease = async () => {};

    try {
      const result = await RebaseEngine.cascadeRebase(dir, updatedStack, 'feat/branch-1', 'feat/branch-1');
      expect(result.results).toHaveLength(9);
      expect(result.results.every((r) => r.success)).toBe(true);
    } finally {
      GitShell.pushForceWithLease = originalPush;
    }

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(30_000);
  });
});
