import { describe, test, expect, afterEach } from 'bun:test';
import { writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { GitShell } from '../../src/core/git-shell.ts';
import { RebaseEngine } from '../../src/core/rebase-engine.ts';
import { StackManager } from '../../src/core/stack-manager.ts';
import { reparentBranch } from '../../src/core/reparent.ts';
import { foldBranch } from '../../src/core/branch-fold.ts';
import { BranchSplitter } from '../../src/core/branch-splitter.ts';
import { renameBranch } from '../../src/core/branch-rename.ts';
import { createSandboxRepo, cleanupRepo, commit, buildLinearStack } from './helpers.ts';
import type { SandboxRepo } from './helpers.ts';

const dirs: string[] = [];

afterEach(async () => {
  for (const d of dirs) await cleanupRepo(d);
  dirs.length = 0;
});

// ── checkoutBranch error handling ────────────────────────────────────────────

describe('GitShell.checkoutBranch edge cases', () => {
  test('checkout to nonexistent branch throws', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);

    await expect(
      GitShell.checkoutBranch(sandbox.dir, 'does-not-exist'),
    ).rejects.toThrow();
  });

  test('checkout to current branch is a no-op', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);

    const before = await GitShell.getCurrentBranch(sandbox.dir);
    await GitShell.checkoutBranch(sandbox.dir, 'main');
    const after = await GitShell.getCurrentBranch(sandbox.dir);
    expect(after).toBe(before);
  });
});

// ── Branch delete safety ─────────────────────────────────────────────────────

describe('Branch deletion safety', () => {
  test('deleteBranch removes a branch that is not checked out', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/deleteme');
    await commit(dir, git, 'temp.txt', 'temp\n', 'temp');
    git('checkout', 'main');

    await GitShell.deleteBranch(dir, 'feat/deleteme');

    expect(await GitShell.branchExists(dir, 'feat/deleteme')).toBe(false);
  });

  test('branchExists returns false after deletion', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/ephemeral');
    await commit(dir, git, 'e.txt', 'e\n', 'add e');
    git('checkout', 'main');

    expect(await GitShell.branchExists(dir, 'feat/ephemeral')).toBe(true);

    await GitShell.deleteBranch(dir, 'feat/ephemeral');

    expect(await GitShell.branchExists(dir, 'feat/ephemeral')).toBe(false);
  });
});

// ── createBranch safety ──────────────────────────────────────────────────────

describe('createBranch edge cases', () => {
  test('creating a branch from a specific ref works', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    const mainHead = git('rev-parse', 'HEAD');
    await commit(dir, git, 'advance.txt', 'advance\n', 'advance');

    // Create branch from old main HEAD (not current)
    await GitShell.createBranch(dir, 'feat/old-base', mainHead);

    const branchHead = await GitShell.getBranchHead(dir, 'feat/old-base');
    expect(branchHead).toBe(mainHead);
  });

  test('creating a branch with duplicate name throws', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);

    await expect(
      GitShell.createBranch(sandbox.dir, 'main', 'main'),
    ).rejects.toThrow();
  });
});

// ── renameBranch safety ──────────────────────────────────────────────────────

describe('Branch rename edge cases', () => {
  test('rename to an existing branch name throws', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/a');
    await commit(dir, git, 'a.txt', 'a\n', 'add a');

    git('checkout', '-b', 'feat/b');
    await commit(dir, git, 'b.txt', 'b\n', 'add b');

    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');

    // Try to rename feat/a to feat/b — should fail
    await expect(
      renameBranch(dir, stack, 'feat/a', 'feat/b'),
    ).rejects.toThrow();
  });
});

// ── getRepoRoot from subdirectory ────────────────────────────────────────────

describe('getRepoRoot from subdirectory', () => {
  test('returns repo root when called from a nested directory', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir } = sandbox;
    const { realpathSync } = await import('node:fs');

    const subDir = join(dir, 'subdir');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(subDir, { recursive: true });

    const root = await GitShell.getRepoRoot(subDir);
    expect(realpathSync(root)).toBe(realpathSync(dir));
  });
});

// ── resetHard safety ─────────────────────────────────────────────────────────

describe('resetHard safety', () => {
  test('resetHard to a valid SHA restores branch to that commit', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/test');
    const sha1 = await commit(dir, git, 'f1.txt', '1\n', 'first');
    const sha2 = await commit(dir, git, 'f2.txt', '2\n', 'second');
    const sha3 = await commit(dir, git, 'f3.txt', '3\n', 'third');

    // Reset to sha1
    await GitShell.resetHard(dir, sha1);

    const head = await GitShell.getBranchHead(dir, 'feat/test');
    expect(head).toBe(sha1);

    // f2.txt and f3.txt should not exist
    try {
      await access(join(dir, 'f2.txt'));
      throw new Error('f2.txt should not exist');
    } catch (e: any) {
      expect(e.code || e.message).not.toBe('f2.txt should not exist');
    }
  });

  test('resetHard to invalid ref throws', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);

    await expect(
      GitShell.resetHard(sandbox.dir, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'),
    ).rejects.toThrow();
  });
});

// ── diff and diffNameOnly ────────────────────────────────────────────────────

describe('GitShell.diff and diffNameOnly', () => {
  test('diff shows content changes between commits', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    const sha1 = git('rev-parse', 'HEAD');
    await commit(dir, git, 'new-file.txt', 'new content\n', 'add file');
    const sha2 = git('rev-parse', 'HEAD');

    const diffOutput = await GitShell.diff(dir, sha1, sha2);
    expect(diffOutput).toContain('new-file.txt');
    expect(diffOutput).toContain('new content');
  });

  test('diffNameOnly returns only file paths', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    const sha1 = git('rev-parse', 'HEAD');
    await commit(dir, git, 'alpha.txt', 'a\n', 'add alpha');
    await commit(dir, git, 'beta.txt', 'b\n', 'add beta');
    const sha2 = git('rev-parse', 'HEAD');

    const files = await GitShell.diffNameOnly(dir, sha1, sha2);
    expect(files).toContain('alpha.txt');
    expect(files).toContain('beta.txt');
    expect(files).toHaveLength(2);
  });
});

// ── getChangedFiles (working tree) ───────────────────────────────────────────

describe('GitShell.getChangedFiles', () => {
  test('detects modified, staged, and untracked files', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    // Modify tracked file
    await writeFile(join(dir, 'README.md'), 'modified\n');

    // Stage a new file
    await writeFile(join(dir, 'staged.txt'), 'staged\n');
    git('add', 'staged.txt');

    // Create untracked file
    await writeFile(join(dir, 'untracked.txt'), 'untracked\n');

    const result = await GitShell.getChangedFiles(dir);

    expect(result.modified).toContain('README.md');
    expect(result.staged).toContain('staged.txt');
    expect(result.untracked).toContain('untracked.txt');
  });

  test('returns empty arrays on clean tree', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);

    const result = await GitShell.getChangedFiles(sandbox.dir);

    expect(result.modified).toEqual([]);
    expect(result.staged).toEqual([]);
    expect(result.untracked).toEqual([]);
  });
});

// ── lsTree ───────────────────────────────────────────────────────────────────

describe('GitShell.lsTree', () => {
  test('lists all files at a ref', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/list');
    await commit(dir, git, 'file1.txt', '1\n', 'add 1');
    await commit(dir, git, 'file2.txt', '2\n', 'add 2');

    const files = await GitShell.lsTree(dir, 'feat/list');
    expect(files).toContain('README.md');
    expect(files).toContain('file1.txt');
    expect(files).toContain('file2.txt');
  });
});
