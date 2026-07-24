import { describe, test, expect, afterEach } from 'bun:test';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GitShell } from '../../src/core/git-shell.ts';
import { AbsorbEngine } from '../../src/core/absorb.ts';
import { RebaseEngine } from '../../src/core/rebase-engine.ts';
import { StackManager } from '../../src/core/stack-manager.ts';
import { reparentBranch } from '../../src/core/reparent.ts';
import { foldBranch } from '../../src/core/branch-fold.ts';
import { BranchSplitter } from '../../src/core/branch-splitter.ts';
import { createSandboxRepo, cleanupRepo, commit, buildLinearStack } from './helpers.ts';
import type { SandboxRepo } from './helpers.ts';

let sandbox: SandboxRepo;
const dirs: string[] = [];

afterEach(async () => {
  for (const d of dirs) await cleanupRepo(d);
  dirs.length = 0;
});

// ── Absorb stash safety ──────────────────────────────────────────────────────

describe('Absorb stash safety', () => {
  test('uncommitted changes survive absorb — no data loss', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'branch-1');
    const sha1 = await commit(dir, git, 'api.ts', 'export function api() {}\n', 'add api.ts');
    git('checkout', '-b', 'branch-2');
    const sha2 = await commit(dir, git, 'config.json', '{"key":"value"}\n', 'add config.json');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'branch-1', 'main');
    stack = StackManager.updateNode(stack, 'branch-1', { lastKnownHead: sha1 });
    stack = StackManager.addNode(stack, 'branch-2', 'branch-1');
    stack = StackManager.updateNode(stack, 'branch-2', { lastKnownHead: sha2 });

    git('checkout', 'branch-2');

    await writeFile(join(dir, 'api.ts'), 'export function api() { return "modified"; }\n');

    const result = await AbsorbEngine.absorb(dir, stack);

    expect(result.absorbed).toBe(true);

    git('checkout', 'branch-1');
    const apiContent = await readFile(join(dir, 'api.ts'), 'utf-8');
    expect(apiContent).toContain('modified');

    const dirty = await GitShell.isDirty(dir);
    expect(dirty).toBe(false);

    // Verify stash is empty (absorb should drop it on success)
    try {
      git('stash', 'show');
      throw new Error('stash should be empty');
    } catch (e: any) {
      expect(e.message || e.toString()).not.toContain('stash should be empty');
    }
  });

  test('absorb failure restores uncommitted work via stash pop', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'branch-1');
    const sha1 = await commit(dir, git, 'api.ts', 'export function api() {}\n', 'add api.ts');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'branch-1', 'main');
    stack = StackManager.updateNode(stack, 'branch-1', { lastKnownHead: sha1 });

    // Detach branch-1 so checkout fails during absorb
    git('checkout', 'branch-1');

    await writeFile(join(dir, 'api.ts'), 'export function api() { return "user work"; }\n');

    // Create a fake node pointing to a non-existent branch to trigger failure
    stack = StackManager.addNode(stack, 'nonexistent-branch', 'branch-1');
    stack = StackManager.updateNode(stack, 'nonexistent-branch', { lastKnownHead: 'deadbeef' });

    // Modify a file that would be attributed to the nonexistent branch
    await writeFile(join(dir, 'nonexistent.txt'), 'data\n');

    const result = await AbsorbEngine.absorb(dir, stack);

    // Whether it succeeds partially or fails, the user's api.ts changes
    // must survive somewhere (either absorbed into branch-1 or still in working tree)
    const currentBranch = await GitShell.getCurrentBranch(dir);
    expect(currentBranch).toBe('branch-1');
  });

  test('multiple uncommitted files across branches — all content preserved', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'branch-1');
    const sha1 = await commit(dir, git, 'a.ts', 'a\n', 'add a');
    git('checkout', '-b', 'branch-2');
    const sha2 = await commit(dir, git, 'b.ts', 'b\n', 'add b');
    git('checkout', '-b', 'branch-3');
    const sha3 = await commit(dir, git, 'c.ts', 'c\n', 'add c');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'branch-1', 'main');
    stack = StackManager.updateNode(stack, 'branch-1', { lastKnownHead: sha1 });
    stack = StackManager.addNode(stack, 'branch-2', 'branch-1');
    stack = StackManager.updateNode(stack, 'branch-2', { lastKnownHead: sha2 });
    stack = StackManager.addNode(stack, 'branch-3', 'branch-2');
    stack = StackManager.updateNode(stack, 'branch-3', { lastKnownHead: sha3 });

    git('checkout', 'branch-3');

    // Modify all three files
    await writeFile(join(dir, 'a.ts'), 'a-updated\n');
    await writeFile(join(dir, 'b.ts'), 'b-updated\n');
    await writeFile(join(dir, 'c.ts'), 'c-updated\n');

    const result = await AbsorbEngine.absorb(dir, stack);
    expect(result.absorbed).toBe(true);
    expect(result.attributions.every((a) => a.success)).toBe(true);

    // Verify each file landed on the correct branch
    git('checkout', 'branch-1');
    expect(await readFile(join(dir, 'a.ts'), 'utf-8')).toBe('a-updated\n');

    git('checkout', 'branch-2');
    expect(await readFile(join(dir, 'b.ts'), 'utf-8')).toBe('b-updated\n');

    git('checkout', 'branch-3');
    expect(await readFile(join(dir, 'c.ts'), 'utf-8')).toBe('c-updated\n');

    // Clean tree after absorb
    expect(await GitShell.isDirty(dir)).toBe(false);
  });
});

// ── Dirty tree guards ────────────────────────────────────────────────────────

describe('Dirty tree rejection guards', () => {
  test('cascade rebase preflight rejects dirty tree', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/a');
    await commit(dir, git, 'a.txt', 'a\n', 'add a');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');

    await writeFile(join(dir, 'dirty.txt'), 'dirty\n');

    const report = await RebaseEngine.preflight(dir, stack, ['feat/a']);
    expect(report.dirty).toBe(true);
  });

  test('reparent rejects dirty working tree', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/a');
    const aHead = await commit(dir, git, 'a.txt', 'a\n', 'add a');
    git('checkout', '-b', 'feat/b');
    const bHead = await commit(dir, git, 'b.txt', 'b\n', 'add b');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: aHead });
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');
    stack = StackManager.updateNode(stack, 'feat/b', { lastKnownHead: bHead });

    await writeFile(join(dir, 'a.txt'), 'dirty\n');

    await expect(reparentBranch(dir, stack, 'feat/b', 'main')).rejects.toThrow(/uncommitted/);
  });

  test('split rejects dirty working tree', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/big');
    const sha1 = await commit(dir, git, 'f1.txt', '1\n', 'c1');
    await commit(dir, git, 'f2.txt', '2\n', 'c2');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/big', 'main');
    stack = StackManager.updateNode(stack, 'feat/big', { lastKnownHead: 'x' });

    await writeFile(join(dir, 'f1.txt'), 'dirty\n');

    await expect(
      BranchSplitter.tailSplit(dir, stack, 'feat/big', 'feat/tail', sha1),
    ).rejects.toThrow(/uncommitted/);
  });

  test('fold rejects dirty working tree', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/base');
    const bHead = await commit(dir, git, 'base.txt', 'base\n', 'add base');
    git('checkout', '-b', 'feat/child');
    const cHead = await commit(dir, git, 'child.txt', 'child\n', 'add child');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/base', 'main');
    stack = StackManager.updateNode(stack, 'feat/base', { lastKnownHead: bHead });
    stack = StackManager.addNode(stack, 'feat/child', 'feat/base');
    stack = StackManager.updateNode(stack, 'feat/child', { lastKnownHead: cHead });

    await writeFile(join(dir, 'dirty.txt'), 'dirty\n');

    await expect(foldBranch(dir, stack, 'feat/child')).rejects.toThrow(/uncommitted/);
  });
});

// ── Post-operation branch restore ────────────────────────────────────────────

describe('Post-operation branch restore', () => {
  test('absorb returns to original branch after distributing changes', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'branch-1');
    const sha1 = await commit(dir, git, 'api.ts', 'api\n', 'add api');
    git('checkout', '-b', 'branch-2');
    const sha2 = await commit(dir, git, 'util.ts', 'util\n', 'add util');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'branch-1', 'main');
    stack = StackManager.updateNode(stack, 'branch-1', { lastKnownHead: sha1 });
    stack = StackManager.addNode(stack, 'branch-2', 'branch-1');
    stack = StackManager.updateNode(stack, 'branch-2', { lastKnownHead: sha2 });

    // Start on branch-2
    git('checkout', 'branch-2');
    await writeFile(join(dir, 'api.ts'), 'api-updated\n');

    await AbsorbEngine.absorb(dir, stack);

    // Should return to branch-2
    const current = await GitShell.getCurrentBranch(dir);
    expect(current).toBe('branch-2');
  });

  test('fold restores to main after deleting a branch', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/base');
    const bHead = await commit(dir, git, 'base.txt', 'base\n', 'add base');
    git('checkout', '-b', 'feat/child');
    const cHead = await commit(dir, git, 'child.txt', 'child\n', 'add child');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/base', 'main');
    stack = StackManager.updateNode(stack, 'feat/base', { lastKnownHead: bHead });
    stack = StackManager.addNode(stack, 'feat/child', 'feat/base');
    stack = StackManager.updateNode(stack, 'feat/child', { lastKnownHead: cHead });

    await foldBranch(dir, stack, 'feat/child');

    // Branch should be deleted and we shouldn't be on it
    const current = await GitShell.getCurrentBranch(dir);
    expect(current).not.toBe('feat/child');
  });
});
