/**
 * Very large diffs: branches with many changed files.
 * Verifies that cascade, split, fold, and absorb handle volume correctly.
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { GitShell } from '../../src/core/git-shell.ts';
import { RebaseEngine } from '../../src/core/rebase-engine.ts';
import { StackManager } from '../../src/core/stack-manager.ts';
import { BranchSplitter } from '../../src/core/branch-splitter.ts';
import { foldBranch } from '../../src/core/branch-fold.ts';
import { AbsorbEngine } from '../../src/core/absorb.ts';
import { createSandboxRepo, cleanupRepo, commit } from './helpers.ts';
import type { SandboxRepo } from './helpers.ts';

const dirs: string[] = [];

afterEach(async () => {
  for (const d of dirs) await cleanupRepo(d);
  dirs.length = 0;
});

async function commitManyFiles(
  dir: string,
  git: (...args: string[]) => string,
  prefix: string,
  count: number,
  message: string,
): Promise<string> {
  for (let i = 0; i < count; i++) {
    await writeFile(join(dir, `${prefix}-${i.toString().padStart(3, '0')}.txt`), `file ${prefix}-${i}\n`);
  }
  git('add', '.');
  git('commit', '-m', message);
  return git('rev-parse', 'HEAD');
}

// ── Cascade with 100+ files ──────────────────────────────────────────────────

describe('Cascade with large number of files', () => {
  test('cascade rebase with 100 files per branch preserves all content', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/bulk-a');
    const aHead = await commitManyFiles(dir, git, 'a', 100, 'feat/bulk-a: 100 files');

    git('checkout', '-b', 'feat/bulk-b');
    const bHead = await commitManyFiles(dir, git, 'b', 100, 'feat/bulk-b: 100 files');

    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/bulk-a', 'main');
    stack = StackManager.updateNode(stack, 'feat/bulk-a', { lastKnownHead: aHead });
    stack = StackManager.addNode(stack, 'feat/bulk-b', 'feat/bulk-a');
    stack = StackManager.updateNode(stack, 'feat/bulk-b', { lastKnownHead: bHead });

    // Advance main
    git('checkout', 'main');
    await commit(dir, git, 'advance.txt', 'advance\n', 'advance main');

    const oldAHead = aHead;
    const forkPoint = git('merge-base', 'main', 'feat/bulk-a');
    await GitShell.rebaseOnto(dir, 'main', forkPoint, 'feat/bulk-a');

    let updatedStack = StackManager.updateNode(stack, 'feat/bulk-a', { lastKnownHead: oldAHead });

    const originalPush = GitShell.pushForceWithLease;
    GitShell.pushForceWithLease = async () => {};

    try {
      const result = await RebaseEngine.cascadeRebase(dir, updatedStack, 'feat/bulk-a', 'feat/bulk-a');
      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.success).toBe(true);

      // Spot-check files from both branches
      git('checkout', 'feat/bulk-b');
      expect(await readFile(join(dir, 'a-000.txt'), 'utf-8')).toBe('file a-0\n');
      expect(await readFile(join(dir, 'a-099.txt'), 'utf-8')).toBe('file a-99\n');
      expect(await readFile(join(dir, 'b-000.txt'), 'utf-8')).toBe('file b-0\n');
      expect(await readFile(join(dir, 'b-099.txt'), 'utf-8')).toBe('file b-99\n');
    } finally {
      GitShell.pushForceWithLease = originalPush;
    }
  });
});

// ── Split with many files ────────────────────────────────────────────────────

describe('Split by file with large file count', () => {
  test('splitByFile on branch with 200 files correctly separates by pattern', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/big');
    // 100 .ts files + 100 .json files
    for (let i = 0; i < 100; i++) {
      await writeFile(join(dir, `module-${i.toString().padStart(3, '0')}.ts`), `export const m${i} = ${i};\n`);
    }
    for (let i = 0; i < 100; i++) {
      await writeFile(join(dir, `config-${i.toString().padStart(3, '0')}.json`), `{"id": ${i}}\n`);
    }
    git('add', '.');
    git('commit', '-m', 'add 200 files');
    const bigHead = git('rev-parse', 'HEAD');

    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/big', 'main');
    stack = StackManager.updateNode(stack, 'feat/big', { lastKnownHead: bigHead });

    const result = await BranchSplitter.splitByFile(dir, stack, 'feat/big', ['*.ts'], 'feat/ts-only');

    expect(result.movedFiles).toHaveLength(100);
    expect(result.remainingFiles).toHaveLength(100);

    // Verify .ts files on new branch
    git('checkout', 'feat/ts-only');
    expect(await readFile(join(dir, 'module-000.ts'), 'utf-8')).toContain('export const m0');
    expect(await readFile(join(dir, 'module-099.ts'), 'utf-8')).toContain('export const m99');

    // Verify .json files stayed on source
    git('checkout', 'feat/big');
    expect(await readFile(join(dir, 'config-000.json'), 'utf-8')).toContain('"id": 0');
    expect(await readFile(join(dir, 'config-099.json'), 'utf-8')).toContain('"id": 99');
  });
});

// ── Fold with many files ─────────────────────────────────────────────────────

describe('Fold with many files', () => {
  test('fold 50-file branch into parent preserves all files', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/parent');
    const parentHead = await commitManyFiles(dir, git, 'p', 50, 'parent: 50 files');

    git('checkout', '-b', 'feat/child');
    const childHead = await commitManyFiles(dir, git, 'c', 50, 'child: 50 files');

    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/parent', 'main');
    stack = StackManager.updateNode(stack, 'feat/parent', { lastKnownHead: parentHead });
    stack = StackManager.addNode(stack, 'feat/child', 'feat/parent');
    stack = StackManager.updateNode(stack, 'feat/child', { lastKnownHead: childHead });

    await foldBranch(dir, stack, 'feat/child');

    git('checkout', 'feat/parent');
    // All 100 files should be present
    expect(await readFile(join(dir, 'p-000.txt'), 'utf-8')).toBe('file p-0\n');
    expect(await readFile(join(dir, 'p-049.txt'), 'utf-8')).toBe('file p-49\n');
    expect(await readFile(join(dir, 'c-000.txt'), 'utf-8')).toBe('file c-0\n');
    expect(await readFile(join(dir, 'c-049.txt'), 'utf-8')).toBe('file c-49\n');
  });
});

// ── Absorb with many changed files ───────────────────────────────────────────

describe('Absorb with many files', () => {
  test('absorb distributes 30 modified files across 3 branches', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    // 3 branches, each owning 10 files
    git('checkout', '-b', 'branch-1');
    for (let i = 0; i < 10; i++) {
      await writeFile(join(dir, `set-a-${i}.txt`), `original-a-${i}\n`);
    }
    git('add', '.');
    git('commit', '-m', 'branch-1: 10 files');
    const sha1 = git('rev-parse', 'HEAD');

    git('checkout', '-b', 'branch-2');
    for (let i = 0; i < 10; i++) {
      await writeFile(join(dir, `set-b-${i}.txt`), `original-b-${i}\n`);
    }
    git('add', '.');
    git('commit', '-m', 'branch-2: 10 files');
    const sha2 = git('rev-parse', 'HEAD');

    git('checkout', '-b', 'branch-3');
    for (let i = 0; i < 10; i++) {
      await writeFile(join(dir, `set-c-${i}.txt`), `original-c-${i}\n`);
    }
    git('add', '.');
    git('commit', '-m', 'branch-3: 10 files');
    const sha3 = git('rev-parse', 'HEAD');

    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'branch-1', 'main');
    stack = StackManager.updateNode(stack, 'branch-1', { lastKnownHead: sha1 });
    stack = StackManager.addNode(stack, 'branch-2', 'branch-1');
    stack = StackManager.updateNode(stack, 'branch-2', { lastKnownHead: sha2 });
    stack = StackManager.addNode(stack, 'branch-3', 'branch-2');
    stack = StackManager.updateNode(stack, 'branch-3', { lastKnownHead: sha3 });

    // Modify all 30 files from branch-3
    git('checkout', 'branch-3');
    for (let i = 0; i < 10; i++) {
      await writeFile(join(dir, `set-a-${i}.txt`), `updated-a-${i}\n`);
      await writeFile(join(dir, `set-b-${i}.txt`), `updated-b-${i}\n`);
      await writeFile(join(dir, `set-c-${i}.txt`), `updated-c-${i}\n`);
    }

    const result = await AbsorbEngine.absorb(dir, stack);
    expect(result.absorbed).toBe(true);
    expect(result.attributions.every((a) => a.success)).toBe(true);

    // Verify correct distribution
    git('checkout', 'branch-1');
    expect(await readFile(join(dir, 'set-a-0.txt'), 'utf-8')).toBe('updated-a-0\n');

    git('checkout', 'branch-2');
    expect(await readFile(join(dir, 'set-b-0.txt'), 'utf-8')).toBe('updated-b-0\n');

    git('checkout', 'branch-3');
    expect(await readFile(join(dir, 'set-c-0.txt'), 'utf-8')).toBe('updated-c-0\n');

    expect(await GitShell.isDirty(dir)).toBe(false);
  });
});

// ── getChangedFileList with many files ───────────────────────────────────────

describe('getChangedFileList with large count', () => {
  test('returns all 200 changed files', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/many');
    await commitManyFiles(dir, git, 'file', 200, '200 files');

    const files = await BranchSplitter.getChangedFileList(dir, 'feat/many', 'main');
    expect(files).toHaveLength(200);
  });
});

// ── Performance with many files ──────────────────────────────────────────────

describe('Performance with large file counts', () => {
  test('cascade with 500 files per branch completes in under 30 seconds', async () => {
    const sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    const start = performance.now();

    git('checkout', '-b', 'feat/huge');
    await commitManyFiles(dir, git, 'h', 500, 'huge branch');
    const hugeHead = git('rev-parse', 'HEAD');

    git('checkout', 'main');
    await commit(dir, git, 'advance.txt', 'advance\n', 'advance');

    const forkPoint = git('merge-base', 'main', 'feat/huge');
    await GitShell.rebaseOnto(dir, 'main', forkPoint, 'feat/huge');

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(30_000);

    git('checkout', 'feat/huge');
    expect(await readFile(join(dir, 'h-000.txt'), 'utf-8')).toBe('file h-0\n');
    expect(await readFile(join(dir, 'h-499.txt'), 'utf-8')).toBe('file h-499\n');
  });
});
