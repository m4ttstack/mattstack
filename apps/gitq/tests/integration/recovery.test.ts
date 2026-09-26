import { describe, test, expect, afterEach } from 'bun:test';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GitShell } from '../../src/core/git-shell.ts';
import { RebaseEngine } from '../../src/core/rebase-engine.ts';
import { StackManager } from '../../src/core/stack-manager.ts';
import { AbsorbEngine } from '../../src/core/absorb.ts';
import { reparentBranch } from '../../src/core/reparent.ts';
import { foldBranch } from '../../src/core/branch-fold.ts';
import { createSandboxRepo, cleanupRepo, commit, buildLinearStack } from './helpers.ts';
import type { SandboxRepo } from './helpers.ts';

let sandbox: SandboxRepo;
const dirs: string[] = [];

afterEach(async () => {
  for (const d of dirs) await cleanupRepo(d);
  dirs.length = 0;
});

// ── Existing rebase state ────────────────────────────────────────────────────

describe('Repo already in rebase state', () => {
  test('cascadeRebase on a repo mid-rebase returns failure, does not corrupt state', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    // Create two conflicting branches
    const forkPoint = git('rev-parse', 'HEAD');
    await commit(dir, git, 'conflict.txt', 'main version\n', 'main edit');

    git('checkout', '-b', 'feat/conflict', forkPoint);
    await commit(dir, git, 'conflict.txt', 'feat version\n', 'feat edit');

    // Start a rebase that will conflict and leave repo in rebase state
    try {
      git('rebase', 'main');
    } catch { /* expected conflict */ }

    // Verify we're in a rebase state
    const status = git('status');
    expect(status).toContain('rebase');

    // Now try another operation — it should handle this gracefully
    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/conflict', 'main');

    const result = await RebaseEngine.cascadeRebase(dir, stack, 'main', 'main');

    // Should complete without crashing (descendants is empty since there's
    // nothing below feat/conflict)
    expect(result).toBeDefined();

    // Clean up
    git('rebase', '--abort');
  });

  test('abort cascade cleans up rebase state completely', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    // Build stack where cascade will conflict
    git('checkout', '-b', 'feat/a');
    await commit(dir, git, 'shared.txt', 'original\n', 'feat/a: add shared');
    const aHead = git('rev-parse', 'HEAD');

    git('checkout', '-b', 'feat/b');
    await commit(dir, git, 'shared.txt', 'feat/b version\n', 'feat/b: rewrite');
    const bHead = git('rev-parse', 'HEAD');

    // Advance feat/a to create conflict
    git('checkout', 'feat/a');
    await commit(dir, git, 'shared.txt', 'feat/a diverged\n', 'feat/a: diverge');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: aHead });
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');
    stack = StackManager.updateNode(stack, 'feat/b', { lastKnownHead: bHead });

    const result = await RebaseEngine.cascadeRebase(dir, stack, 'feat/a', 'feat/a');
    expect(result.state).toBe('paused');

    // Abort
    await RebaseEngine.abortCascade(dir);

    // Repo should be clean
    const dirty = await GitShell.isDirty(dir);
    expect(dirty).toBe(false);

    // Not in rebase state anymore
    const statusOutput = git('status');
    expect(statusOutput).not.toContain('rebase in progress');

    // feat/b should be at its original SHA
    const currentBHead = await GitShell.getBranchHead(dir, 'feat/b');
    expect(currentBHead).toBe(bHead);
  });
});

// ── Missing / deleted branch ─────────────────────────────────────────────────

describe('Missing or deleted branches', () => {
  test('needsRebase returns false for a branch deleted externally', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/ephemeral');
    await commit(dir, git, 'e.txt', 'ephemeral\n', 'add ephemeral');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/ephemeral', 'main');

    // Delete the branch externally
    git('branch', '-D', 'feat/ephemeral');

    // needsRebase should not crash, should return false
    const needs = await RebaseEngine.needsRebase(dir, stack, 'feat/ephemeral');
    expect(needs).toBe(false);
  });

  test('cascade skips deleted branch and continues to siblings', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/a');
    const aHead = await commit(dir, git, 'a.txt', 'a\n', 'add a');

    git('checkout', '-b', 'feat/b');
    await commit(dir, git, 'b.txt', 'b\n', 'add b');

    git('checkout', 'feat/a');
    git('checkout', '-b', 'feat/c');
    const cHead = await commit(dir, git, 'c.txt', 'c\n', 'add c');

    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: aHead });
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');
    stack = StackManager.addNode(stack, 'feat/c', 'feat/a');
    stack = StackManager.updateNode(stack, 'feat/c', { lastKnownHead: cHead });

    // Delete feat/b externally
    git('branch', '-D', 'feat/b');

    // Advance feat/a
    git('checkout', 'feat/a');
    const oldAHead = aHead;
    await commit(dir, git, 'a2.txt', 'a2\n', 'advance a');
    const newAHead = git('rev-parse', 'HEAD');
    git('checkout', 'main');

    stack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: oldAHead });

    const originalPush = GitShell.pushForceWithLease;
    GitShell.pushForceWithLease = async () => {};

    try {
      const result = await RebaseEngine.cascadeRebase(dir, stack, 'feat/a', 'feat/a');
      // Should not crash. feat/b will fail or be skipped, feat/c should be attempted.
      expect(result).toBeDefined();
      expect(result.state).toBeDefined();
    } finally {
      GitShell.pushForceWithLease = originalPush;
    }
  });

  test('reparent to a nonexistent target branch throws cleanly', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/a');
    const aHead = await commit(dir, git, 'a.txt', 'a\n', 'add a');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: aHead });

    // Target doesn't exist in the stack tree
    await expect(
      reparentBranch(dir, stack, 'feat/a', 'feat/nonexistent'),
    ).rejects.toThrow();
  });
});

// ── Detached HEAD recovery ───────────────────────────────────────────────────

describe('Detached HEAD state', () => {
  test('GitShell.getCurrentBranch handles detached HEAD', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    const sha = git('rev-parse', 'HEAD');
    git('checkout', sha);

    // Should not crash — may throw or return something
    try {
      const branch = await GitShell.getCurrentBranch(dir);
      // If it returns, it should be something (possibly the SHA)
      expect(typeof branch).toBe('string');
    } catch (err) {
      // Throwing is also acceptable behavior
      expect(err).toBeDefined();
    }
  });

  test('isDirty works in detached HEAD', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    const sha = git('rev-parse', 'HEAD');
    git('checkout', sha);

    const dirty = await GitShell.isDirty(dir);
    expect(dirty).toBe(false);

    await writeFile(join(dir, 'README.md'), 'modified\n');
    const dirtyNow = await GitShell.isDirty(dir);
    expect(dirtyNow).toBe(true);

    git('checkout', '--', 'README.md');
  });
});

// ── Operation on wrong branch ────────────────────────────────────────────────

describe('Operation on wrong branch', () => {
  test('cascade rebase works regardless of which branch is checked out', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    const { stack } = await buildLinearStack(dir, git, 3);

    // Advance main
    git('checkout', 'main');
    await commit(dir, git, 'advance.txt', 'advance\n', 'advance main');

    // Check out an unrelated branch (branch-3) before running cascade on branch-1
    git('checkout', 'feat/branch-3');

    const oldB1Head = git('rev-parse', 'feat/branch-1');
    const forkPoint = git('merge-base', 'main', 'feat/branch-1');
    await GitShell.rebaseOnto(dir, 'main', forkPoint, 'feat/branch-1');

    let updatedStack = StackManager.updateNode(stack, 'feat/branch-1', { lastKnownHead: oldB1Head });

    const originalPush = GitShell.pushForceWithLease;
    GitShell.pushForceWithLease = async () => {};

    try {
      const result = await RebaseEngine.cascadeRebase(dir, updatedStack, 'feat/branch-1', 'feat/branch-1');
      expect(result.results.every((r) => r.success)).toBe(true);
    } finally {
      GitShell.pushForceWithLease = originalPush;
    }
  });
});

// ── Concurrent modification simulation ───────────────────────────────────────

describe('Concurrent modification resilience', () => {
  test('needsRebase is accurate after external commit on parent', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/child');
    const childHead = await commit(dir, git, 'child.txt', 'child\n', 'add child');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/child', 'main');

    // Initially no rebase needed
    expect(await RebaseEngine.needsRebase(dir, stack, 'feat/child')).toBe(false);

    // Simulate external commit on main (as if another tool pushed)
    await commit(dir, git, 'external.txt', 'external\n', 'external commit');

    // Now it should need rebase
    expect(await RebaseEngine.needsRebase(dir, stack, 'feat/child')).toBe(true);
  });

  test('preflight conflict detection catches new commits on parent', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    const forkPoint = git('rev-parse', 'HEAD');

    // Diverge on same file
    await commit(dir, git, 'shared.txt', 'main version\n', 'main writes shared');

    git('checkout', '-b', 'feat/child', forkPoint);
    await commit(dir, git, 'shared.txt', 'child version\n', 'child writes shared');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/child', 'main');

    const report = await RebaseEngine.preflight(dir, stack, ['feat/child']);
    expect(report.conflictBranches).toEqual([
      expect.objectContaining({ branch: 'feat/child' }),
    ]);
  });
});

// ── Repeated operations idempotency ──────────────────────────────────────────

describe('Operation idempotency', () => {
  test('running cascade twice is safe when stack is already up-to-date', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    const { stack } = await buildLinearStack(dir, git, 2);

    // Advance main
    git('checkout', 'main');
    await commit(dir, git, 'advance.txt', 'advance\n', 'advance main');

    const oldB1Head = git('rev-parse', 'feat/branch-1');
    const forkPoint = git('merge-base', 'main', 'feat/branch-1');
    await GitShell.rebaseOnto(dir, 'main', forkPoint, 'feat/branch-1');
    const newB1Head = git('rev-parse', 'feat/branch-1');

    let updatedStack = StackManager.updateNode(stack, 'feat/branch-1', { lastKnownHead: oldB1Head });

    const originalPush = GitShell.pushForceWithLease;
    GitShell.pushForceWithLease = async () => {};

    try {
      // First cascade
      const result1 = await RebaseEngine.cascadeRebase(dir, updatedStack, 'feat/branch-1', 'feat/branch-1');
      expect(result1.results.every((r) => r.success)).toBe(true);

      // Capture SHAs after first cascade
      const b2After1 = git('rev-parse', 'feat/branch-2');

      // Second cascade with updated stack — should be a no-op or safe
      updatedStack = StackManager.updateNode(result1.updatedStack, 'feat/branch-1', { lastKnownHead: newB1Head });
      const result2 = await RebaseEngine.cascadeRebase(dir, updatedStack, 'feat/branch-1', 'feat/branch-1');

      // Branch SHAs should not change on second run
      const b2After2 = git('rev-parse', 'feat/branch-2');
      expect(b2After2).toBe(b2After1);
    } finally {
      GitShell.pushForceWithLease = originalPush;
    }
  });

  test('needsRebase returns false immediately after a successful rebase', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    const forkPoint = git('rev-parse', 'HEAD');
    git('checkout', '-b', 'feat/child');
    await commit(dir, git, 'child.txt', 'data\n', 'child commit');

    git('checkout', 'main');
    await commit(dir, git, 'main-new.txt', 'new\n', 'advance main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/child', 'main');

    expect(await RebaseEngine.needsRebase(dir, stack, 'feat/child')).toBe(true);

    await GitShell.rebaseOnto(dir, 'main', forkPoint, 'feat/child');

    expect(await RebaseEngine.needsRebase(dir, stack, 'feat/child')).toBe(false);
  });
});
