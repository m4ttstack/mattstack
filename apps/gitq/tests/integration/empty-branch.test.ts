import { describe, test, expect, afterEach } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GitShell } from '../../src/core/git-shell.ts';
import { RebaseEngine } from '../../src/core/rebase-engine.ts';
import { StackManager } from '../../src/core/stack-manager.ts';
import { foldBranch } from '../../src/core/branch-fold.ts';
import { reparentBranch } from '../../src/core/reparent.ts';
import { createSandboxRepo, cleanupRepo, commit } from './helpers.ts';
import type { SandboxRepo } from './helpers.ts';

const dirs: string[] = [];

afterEach(async () => {
  for (const d of dirs) await cleanupRepo(d);
  dirs.length = 0;
});

// ── Helper: create a branch at the same commit as its parent (zero own commits)

async function createEmptyBranch(dir: string, git: (...args: string[]) => string, name: string, parent: string) {
  git('checkout', parent);
  git('checkout', '-b', name);
  git('checkout', parent);
  return git('rev-parse', name);
}

// ── Cascade through empty branch ─────────────────────────────────────────────

describe('Cascade through empty branch (zero own commits)', () => {
  test('cascade correctly handles a middle branch with no unique commits', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    // main → feat/a (2 commits) → feat/empty (0 commits) → feat/b (2 commits)
    git('checkout', '-b', 'feat/a');
    const aHead = await commit(dir, git, 'a.txt', 'a\n', 'add a');

    // Create empty branch at same point as feat/a
    const emptyHead = await createEmptyBranch(dir, git, 'feat/empty', 'feat/a');

    git('checkout', 'feat/empty');
    git('checkout', '-b', 'feat/b');
    const bHead = await commit(dir, git, 'b.txt', 'b\n', 'add b');

    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: aHead });
    stack = StackManager.addNode(stack, 'feat/empty', 'feat/a');
    stack = StackManager.updateNode(stack, 'feat/empty', { lastKnownHead: emptyHead });
    stack = StackManager.addNode(stack, 'feat/b', 'feat/empty');
    stack = StackManager.updateNode(stack, 'feat/b', { lastKnownHead: bHead });

    // Advance main
    git('checkout', 'main');
    await commit(dir, git, 'advance.txt', 'advance\n', 'advance');

    // Rebase feat/a
    const oldAHead = git('rev-parse', 'feat/a');
    const forkPoint = git('merge-base', 'main', 'feat/a');
    await GitShell.rebaseOnto(dir, 'main', forkPoint, 'feat/a');
    const newAHead = git('rev-parse', 'feat/a');

    let updatedStack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: oldAHead });

    const originalPush = GitShell.pushForceWithLease;
    GitShell.pushForceWithLease = async () => {};

    try {
      const result = await RebaseEngine.cascadeRebase(dir, updatedStack, 'feat/a', 'feat/a');
      expect(result.state).toBe('completed');

      // feat/b should have its file intact
      git('checkout', 'feat/b');
      expect(await readFile(join(dir, 'b.txt'), 'utf-8')).toBe('b\n');
      expect(await readFile(join(dir, 'a.txt'), 'utf-8')).toBe('a\n');
    } finally {
      GitShell.pushForceWithLease = originalPush;
    }
  });

  test('cascade with empty branch at root of stack (first child of main)', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    // main → feat/empty (0 commits) → feat/child (1 commit)
    const emptyHead = await createEmptyBranch(dir, git, 'feat/empty', 'main');

    git('checkout', 'feat/empty');
    git('checkout', '-b', 'feat/child');
    const childHead = await commit(dir, git, 'child.txt', 'child\n', 'add child');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/empty', 'main');
    stack = StackManager.updateNode(stack, 'feat/empty', { lastKnownHead: emptyHead });
    stack = StackManager.addNode(stack, 'feat/child', 'feat/empty');
    stack = StackManager.updateNode(stack, 'feat/child', { lastKnownHead: childHead });

    // Advance main
    git('checkout', 'main');
    await commit(dir, git, 'advance.txt', 'advance\n', 'advance');
    const mainHead = git('rev-parse', 'HEAD');

    // Squash-merge the empty branch (it has no unique commits — effectively a no-op)
    let updatedStack = StackManager.updateNode(stack, 'feat/empty', {
      lastKnownHead: emptyHead,
      status: 'merged',
    });

    const originalPush = GitShell.pushForceWithLease;
    GitShell.pushForceWithLease = async () => {};

    try {
      const result = await RebaseEngine.cascadeRebase(dir, updatedStack, 'feat/empty', 'main');
      expect(result.state).toBe('completed');

      // child should be on top of main
      git('checkout', 'feat/child');
      expect(await readFile(join(dir, 'child.txt'), 'utf-8')).toBe('child\n');
    } finally {
      GitShell.pushForceWithLease = originalPush;
    }
  });
});

// ── Fold empty branch ────────────────────────────────────────────────────────

describe('Fold empty branch', () => {
  test('folding a branch with no unique commits deletes it cleanly', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/base');
    const baseHead = await commit(dir, git, 'base.txt', 'base\n', 'add base');

    const emptyHead = await createEmptyBranch(dir, git, 'feat/empty-child', 'feat/base');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/base', 'main');
    stack = StackManager.updateNode(stack, 'feat/base', { lastKnownHead: baseHead });
    stack = StackManager.addNode(stack, 'feat/empty-child', 'feat/base');
    stack = StackManager.updateNode(stack, 'feat/empty-child', { lastKnownHead: emptyHead });

    const result = await foldBranch(dir, stack, 'feat/empty-child');

    // Branch should be gone
    const branches = git('branch', '--list').split('\n').map((b: string) => b.trim().replace('* ', ''));
    expect(branches).not.toContain('feat/empty-child');

    // Base should be unchanged (nothing to cherry-pick)
    const currentBaseHead = await GitShell.getBranchHead(dir, 'feat/base');
    expect(currentBaseHead).toBe(baseHead);

    // Stack tree updated
    expect(StackManager.findNode(result.newStack, 'feat/empty-child')).toBeUndefined();
  });

  test('fold empty branch with grandchildren re-parents them', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/base');
    const baseHead = await commit(dir, git, 'base.txt', 'base\n', 'add base');

    const emptyHead = await createEmptyBranch(dir, git, 'feat/empty', 'feat/base');

    git('checkout', 'feat/empty');
    git('checkout', '-b', 'feat/grandchild');
    const gcHead = await commit(dir, git, 'gc.txt', 'grandchild\n', 'add gc');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/base', 'main');
    stack = StackManager.updateNode(stack, 'feat/base', { lastKnownHead: baseHead });
    stack = StackManager.addNode(stack, 'feat/empty', 'feat/base');
    stack = StackManager.updateNode(stack, 'feat/empty', { lastKnownHead: emptyHead });
    stack = StackManager.addNode(stack, 'feat/grandchild', 'feat/empty');
    stack = StackManager.updateNode(stack, 'feat/grandchild', { lastKnownHead: gcHead });

    const result = await foldBranch(dir, stack, 'feat/empty');

    // Grandchild should now be child of base
    const gcNode = StackManager.findNode(result.newStack, 'feat/grandchild');
    expect(gcNode!.parent).toBe('feat/base');

    // Grandchild content intact
    git('checkout', 'feat/grandchild');
    expect(await readFile(join(dir, 'gc.txt'), 'utf-8')).toBe('grandchild\n');
  });
});

// ── Single-commit branch operations ──────────────────────────────────────────

describe('Single-commit branch', () => {
  test('reparent a single-commit branch preserves its commit', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/a');
    const aHead = await commit(dir, git, 'a.txt', 'a content\n', 'add a');

    // Single commit branch on feat/a
    git('checkout', '-b', 'feat/single');
    const singleHead = await commit(dir, git, 'single.txt', 'single content\n', 'one commit');

    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: aHead });
    stack = StackManager.addNode(stack, 'feat/single', 'feat/a');
    stack = StackManager.updateNode(stack, 'feat/single', { lastKnownHead: singleHead });

    // Reparent from feat/a to main
    const result = await reparentBranch(dir, stack, 'feat/single', 'main');

    expect(result.newParent).toBe('main');

    // Content preserved
    git('checkout', 'feat/single');
    expect(await readFile(join(dir, 'single.txt'), 'utf-8')).toBe('single content\n');

    // Should NOT have feat/a's file
    const files = git('ls-tree', '-r', '--name-only', 'HEAD').split('\n').filter(Boolean);
    expect(files).not.toContain('a.txt');
    expect(files).toContain('single.txt');
  });

  test('fold single-commit branch into parent', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/base');
    const baseHead = await commit(dir, git, 'base.txt', 'base\n', 'add base');

    git('checkout', '-b', 'feat/one');
    const oneHead = await commit(dir, git, 'one.txt', 'one commit only\n', 'single commit');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/base', 'main');
    stack = StackManager.updateNode(stack, 'feat/base', { lastKnownHead: baseHead });
    stack = StackManager.addNode(stack, 'feat/one', 'feat/base');
    stack = StackManager.updateNode(stack, 'feat/one', { lastKnownHead: oneHead });

    const result = await foldBranch(dir, stack, 'feat/one');

    // base now has one.txt
    git('checkout', 'feat/base');
    expect(await readFile(join(dir, 'one.txt'), 'utf-8')).toBe('one commit only\n');
    expect(await readFile(join(dir, 'base.txt'), 'utf-8')).toBe('base\n');
  });

  test('cascade through single-commit branch', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    // main → feat/a (1 commit) → feat/b (1 commit) → feat/c (1 commit)
    git('checkout', '-b', 'feat/a');
    const aHead = await commit(dir, git, 'a.txt', 'a\n', 'add a');

    git('checkout', '-b', 'feat/b');
    const bHead = await commit(dir, git, 'b.txt', 'b\n', 'add b');

    git('checkout', '-b', 'feat/c');
    const cHead = await commit(dir, git, 'c.txt', 'c\n', 'add c');

    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: aHead });
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');
    stack = StackManager.updateNode(stack, 'feat/b', { lastKnownHead: bHead });
    stack = StackManager.addNode(stack, 'feat/c', 'feat/b');
    stack = StackManager.updateNode(stack, 'feat/c', { lastKnownHead: cHead });

    // Advance main
    git('checkout', 'main');
    await commit(dir, git, 'advance.txt', 'advance\n', 'advance');

    const oldAHead = aHead;
    const forkPoint = git('merge-base', 'main', 'feat/a');
    await GitShell.rebaseOnto(dir, 'main', forkPoint, 'feat/a');

    let updatedStack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: oldAHead });

    const originalPush = GitShell.pushForceWithLease;
    GitShell.pushForceWithLease = async () => {};

    try {
      const result = await RebaseEngine.cascadeRebase(dir, updatedStack, 'feat/a', 'feat/a');
      expect(result.results).toHaveLength(2);
      expect(result.results.every((r) => r.success)).toBe(true);

      // All files intact on deepest branch
      git('checkout', 'feat/c');
      expect(await readFile(join(dir, 'a.txt'), 'utf-8')).toBe('a\n');
      expect(await readFile(join(dir, 'b.txt'), 'utf-8')).toBe('b\n');
      expect(await readFile(join(dir, 'c.txt'), 'utf-8')).toBe('c\n');
    } finally {
      GitShell.pushForceWithLease = originalPush;
    }
  });
});
