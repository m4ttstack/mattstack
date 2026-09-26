import { afterEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GitShell } from '../../src/core/git-shell.ts';
import { StackManager } from '../../src/core/stack-manager.ts';
import { RebaseEngine } from '../../src/core/rebase-engine.ts';
import { renameBranch } from '../../src/core/branch-rename.ts';
import { createSandboxRepo, cleanupRepo, commit, buildLinearStack, buildTreeStack } from './helpers.ts';
import type { SandboxRepo } from './helpers.ts';

let repo: SandboxRepo;

afterEach(async () => {
  if (repo) await cleanupRepo(repo.dir);
});

// ── Branch Rename ────────────────────────────────────────────────────────────

describe('branch rename in a stack', () => {
  test('renames the middle branch and updates stack tree + children', async () => {
    repo = await createSandboxRepo();
    const { dir, git } = repo;
    const { stack } = await buildLinearStack(dir, git, 3);

    const result = await renameBranch(dir, stack, 'feat/branch-2', 'feat/renamed-2');

    const branches = git('branch', '--list').split('\n').map((b) => b.trim().replace('* ', ''));
    expect(branches).toContain('feat/renamed-2');
    expect(branches).not.toContain('feat/branch-2');

    const renamedNode = StackManager.findNode(result.updatedStack, 'feat/renamed-2');
    expect(renamedNode).toBeDefined();
    expect(renamedNode!.branch).toBe('feat/renamed-2');

    const child = StackManager.findNode(result.updatedStack, 'feat/branch-3');
    expect(child!.parent).toBe('feat/renamed-2');

    expect(StackManager.findNode(result.updatedStack, 'feat/branch-2')).toBeUndefined();
  });

  test('renames the current branch (HEAD follows)', async () => {
    repo = await createSandboxRepo();
    const { dir, git } = repo;
    const { stack } = await buildLinearStack(dir, git, 2);

    git('checkout', 'feat/branch-1');
    const headBefore = git('rev-parse', 'HEAD');

    await renameBranch(dir, stack, 'feat/branch-1', 'feat/new-name');

    const currentBranch = await GitShell.getCurrentBranch(dir);
    expect(currentBranch).toBe('feat/new-name');

    const headAfter = git('rev-parse', 'HEAD');
    expect(headAfter).toBe(headBefore);
  });

  test('commit history survives rename', async () => {
    repo = await createSandboxRepo();
    const { dir, git } = repo;
    const { stack } = await buildLinearStack(dir, git, 2);

    const logBefore = git('log', '--oneline', 'feat/branch-1');
    await renameBranch(dir, stack, 'feat/branch-1', 'feat/renamed');
    const logAfter = git('log', '--oneline', 'feat/renamed');

    expect(logAfter).toBe(logBefore);
  });
});

// ── Unmanaged Skip During Cascade ────────────────────────────────────────────

describe('unmanaged skip during cascade', () => {
  test('skips unmanaged B but rebases managed children', async () => {
    repo = await createSandboxRepo();
    const { dir, git } = repo;
    const { stack: initialStack } = await buildLinearStack(dir, git, 3);

    let stack = StackManager.toggleUnmanaged(initialStack, 'feat/branch-2');

    const shaB_before = git('rev-parse', 'feat/branch-2');
    const shaC_before = git('rev-parse', 'feat/branch-3');

    git('checkout', 'main');
    await commit(dir, git, 'main-advance.txt', 'new main content\n', 'advance main');

    git('checkout', 'feat/branch-1');
    const oldBase1 = await GitShell.getMergeBase(dir, 'feat/branch-1', 'main');
    await GitShell.rebaseOnto(dir, 'main', oldBase1, 'feat/branch-1');
    const newHead1 = git('rev-parse', 'feat/branch-1');
    stack = StackManager.updateNode(stack, 'feat/branch-1', { lastKnownHead: newHead1 });

    const result = await RebaseEngine.cascadeRebase(dir, stack, 'feat/branch-1', 'feat/branch-1');

    // B is unmanaged → its SHA must not change
    const shaB_after = git('rev-parse', 'feat/branch-2');
    expect(shaB_after).toBe(shaB_before);

    // C's parent is B (unchanged), so the tombstone rebase is a no-op —
    // C's SHA stays the same since B didn't move
    const shaC_after = git('rev-parse', 'feat/branch-3');
    expect(shaC_after).toBe(shaC_before);

    // Content on C is preserved
    git('checkout', 'feat/branch-3');
    const contentC = await readFile(join(dir, 'file-3-a.txt'), 'utf-8');
    expect(contentC).toContain('branch 3 commit A');

    expect(result.state).toBe('completed');
  });

  test('unmanaged node with two children — both children rebased correctly', async () => {
    repo = await createSandboxRepo();
    const { dir, git } = repo;

    const { stack: initialStack } = await buildTreeStack(dir, git, [
      {
        name: 'feat/parent',
        commits: 2,
        children: [
          { name: 'feat/child-1', commits: 2 },
          { name: 'feat/child-2', commits: 2 },
        ],
      },
    ]);

    let stack = StackManager.toggleUnmanaged(initialStack, 'feat/parent');

    const shaParent_before = git('rev-parse', 'feat/parent');

    git('checkout', 'main');
    await commit(dir, git, 'main-new.txt', 'new on main\n', 'advance main');
    const mainHead = git('rev-parse', 'main');

    const result = await RebaseEngine.cascadeRebase(dir, stack, 'main', mainHead);

    const shaParent_after = git('rev-parse', 'feat/parent');
    expect(shaParent_after).toBe(shaParent_before);

    git('checkout', 'feat/child-1');
    const child1Content = await readFile(join(dir, 'feat-child-1-1.txt'), 'utf-8');
    expect(child1Content).toContain('feat/child-1 commit 1');

    git('checkout', 'feat/child-2');
    const child2Content = await readFile(join(dir, 'feat-child-2-1.txt'), 'utf-8');
    expect(child2Content).toContain('feat/child-2 commit 1');

    expect(result.state).toBe('completed');
  });
});
