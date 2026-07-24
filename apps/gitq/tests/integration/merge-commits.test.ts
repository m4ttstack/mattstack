/**
 * Merge commits inside stack branches: cascade, fold, and reparent
 * when branches contain non-linear (merge commit) history.
 */
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

// ── Cascade through branch with merge commit ─────────────────────────────────

describe('Cascade through branch with merge commits', () => {
  test('cascade succeeds when a branch contains a merge commit', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    // main → feat/a (with a merge commit inside) → feat/b
    git('checkout', '-b', 'feat/a');
    await commit(dir, git, 'a1.txt', 'a1\n', 'feat/a: first');

    // Create a side branch off feat/a, then merge it back (creating a merge commit)
    git('checkout', '-b', 'feat/a-side');
    await commit(dir, git, 'a-side.txt', 'side\n', 'side branch');
    git('checkout', 'feat/a');
    git('merge', '--no-ff', 'feat/a-side', '-m', 'merge side into feat/a');
    const aHead = git('rev-parse', 'HEAD');

    git('checkout', '-b', 'feat/b');
    const bHead = await commit(dir, git, 'b1.txt', 'b1\n', 'feat/b: first');

    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: aHead });
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');
    stack = StackManager.updateNode(stack, 'feat/b', { lastKnownHead: bHead });

    // Advance main
    git('checkout', 'main');
    await commit(dir, git, 'advance.txt', 'advance\n', 'advance main');

    const oldAHead = aHead;
    const forkPoint = git('merge-base', 'main', 'feat/a');
    await GitShell.rebaseOnto(dir, 'main', forkPoint, 'feat/a');

    let updatedStack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: oldAHead });

    const originalPush = GitShell.pushForceWithLease;
    GitShell.pushForceWithLease = async () => {};

    try {
      const result = await RebaseEngine.cascadeRebase(dir, updatedStack, 'feat/a', 'feat/a');
      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.success).toBe(true);

      // Content from the merge commit should survive
      git('checkout', 'feat/b');
      expect(await readFile(join(dir, 'a-side.txt'), 'utf-8')).toBe('side\n');
      expect(await readFile(join(dir, 'b1.txt'), 'utf-8')).toBe('b1\n');
    } finally {
      GitShell.pushForceWithLease = originalPush;
    }
  });

  test('needsRebase works correctly with merge-commit branches', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/a');
    await commit(dir, git, 'a.txt', 'a\n', 'feat/a');

    // Merge commit
    git('checkout', '-b', 'feat/a-tmp');
    await commit(dir, git, 'tmp.txt', 'tmp\n', 'tmp');
    git('checkout', 'feat/a');
    git('merge', '--no-ff', 'feat/a-tmp', '-m', 'merge tmp');

    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');

    expect(await RebaseEngine.needsRebase(dir, stack, 'feat/a')).toBe(false);

    // Advance main
    await commit(dir, git, 'advance.txt', 'adv\n', 'advance');

    expect(await RebaseEngine.needsRebase(dir, stack, 'feat/a')).toBe(true);
  });
});

// ── Fold branch that contains merge commits ──────────────────────────────────

describe('Fold branch with merge commits', () => {
  test('fold cherry-picks merge-commit content correctly', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/base');
    const baseHead = await commit(dir, git, 'base.txt', 'base\n', 'add base');

    git('checkout', '-b', 'feat/child');
    await commit(dir, git, 'child.txt', 'child\n', 'child commit');

    // Create and merge a side branch into feat/child
    git('checkout', '-b', 'feat/child-side');
    await commit(dir, git, 'side.txt', 'from side\n', 'side commit');
    git('checkout', 'feat/child');
    git('merge', '--no-ff', 'feat/child-side', '-m', 'merge side into child');
    const childHead = git('rev-parse', 'HEAD');

    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/base', 'main');
    stack = StackManager.updateNode(stack, 'feat/base', { lastKnownHead: baseHead });
    stack = StackManager.addNode(stack, 'feat/child', 'feat/base');
    stack = StackManager.updateNode(stack, 'feat/child', { lastKnownHead: childHead });

    const result = await foldBranch(dir, stack, 'feat/child');

    git('checkout', 'feat/base');
    expect(await readFile(join(dir, 'child.txt'), 'utf-8')).toBe('child\n');
    expect(await readFile(join(dir, 'side.txt'), 'utf-8')).toBe('from side\n');
    expect(await readFile(join(dir, 'base.txt'), 'utf-8')).toBe('base\n');

    expect(StackManager.findNode(result.newStack, 'feat/child')).toBeUndefined();
  });
});

// ── Reparent branch with merge commits ───────────────────────────────────────

describe('Reparent branch with merge commits', () => {
  test('reparent preserves merge-commit content', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/a');
    const aHead = await commit(dir, git, 'a.txt', 'a\n', 'add a');

    git('checkout', '-b', 'feat/b');
    await commit(dir, git, 'b.txt', 'b\n', 'b commit');

    // Merge commit inside feat/b
    git('checkout', '-b', 'feat/b-side');
    await commit(dir, git, 'b-side.txt', 'b-side\n', 'b-side commit');
    git('checkout', 'feat/b');
    git('merge', '--no-ff', 'feat/b-side', '-m', 'merge b-side');
    const bHead = git('rev-parse', 'HEAD');

    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: aHead });
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');
    stack = StackManager.updateNode(stack, 'feat/b', { lastKnownHead: bHead });

    // Reparent feat/b from feat/a to main
    const result = await reparentBranch(dir, stack, 'feat/b', 'main');

    expect(result.newParent).toBe('main');

    git('checkout', 'feat/b');
    expect(await readFile(join(dir, 'b.txt'), 'utf-8')).toBe('b\n');
    expect(await readFile(join(dir, 'b-side.txt'), 'utf-8')).toBe('b-side\n');

    const files = git('ls-tree', '-r', '--name-only', 'HEAD').split('\n').filter(Boolean);
    expect(files).not.toContain('a.txt');
  });
});
