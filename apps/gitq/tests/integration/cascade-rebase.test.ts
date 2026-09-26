import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StackManager } from '../../src/core/stack-manager.ts';
import { createSandboxRepo, cleanupRepo, commit, type SandboxRepo } from './helpers.ts';

mock.restore();

let repo: SandboxRepo;

/**
 * Set up a branch stack for testing:
 *
 *   main: A - B
 *              \
 *   feat/base:  C - D
 *                    \
 *   feat/child:       E - F
 */
beforeAll(async () => {
  repo = await createSandboxRepo();

  await commit(repo.dir, repo.git, 'file-a.txt', 'commit A\n', 'commit A');
  await commit(repo.dir, repo.git, 'file-b.txt', 'commit B\n', 'commit B');

  repo.git('checkout', '-b', 'feat/base');
  await commit(repo.dir, repo.git, 'file-c.txt', 'commit C\n', 'commit C');
  await commit(repo.dir, repo.git, 'file-d.txt', 'commit D\n', 'commit D');

  repo.git('checkout', '-b', 'feat/child');
  await commit(repo.dir, repo.git, 'file-e.txt', 'commit E\n', 'commit E');
  await commit(repo.dir, repo.git, 'file-f.txt', 'commit F\n', 'commit F');

  repo.git('checkout', 'main');
});

afterAll(async () => {
  await cleanupRepo(repo.dir);
});

describe('cascade rebase integration', () => {
  test('cascadeRebase rebases child onto main after parent squash-merge', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const baseHead = await GitShell.getBranchHead(repo.dir, 'feat/base');

    // Simulate squash-merge of feat/base into main
    repo.git('checkout', 'main');
    repo.git('merge', '--squash', 'feat/base');
    repo.git('commit', '-m', 'squash: feat/base');

    const mainHead = await GitShell.getBranchHead(repo.dir, 'main');

    let stack = StackManager.createStack('test-stack', 'main');
    stack = StackManager.addNode(stack, 'feat/base', 'main');
    stack = StackManager.updateNode(stack, 'feat/base', {
      lastKnownHead: baseHead,
      status: 'merged',
    });
    stack = StackManager.addNode(stack, 'feat/child', 'feat/base');

    const childHeadBefore = await GitShell.getBranchHead(repo.dir, 'feat/child');

    const originalPush = GitShell.pushForceWithLease;
    GitShell.pushForceWithLease = async () => {};

    try {
      const result = await RebaseEngine.cascadeRebase(repo.dir, stack, 'feat/base', 'main');

      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.branch).toBe('feat/child');
      expect(result.results[0]!.success).toBe(true);

      const childHeadAfter = await GitShell.getBranchHead(repo.dir, 'feat/child');
      expect(childHeadAfter).not.toBe(childHeadBefore);

      const mergeBase = await GitShell.getMergeBase(repo.dir, 'main', 'feat/child');
      expect(mergeBase).toBe(mainHead);

      const log = await GitShell.log(repo.dir, 'feat/child', 10);
      const messages = log.map((l) => l.replace(/^[0-9a-f]+ /, ''));
      expect(messages).toContain('commit E');
      expect(messages).toContain('commit F');

      const updatedChild = StackManager.findNode(result.updatedStack, 'feat/child');
      expect(updatedChild?.lastKnownHead).toBe(childHeadAfter);
    } finally {
      GitShell.pushForceWithLease = originalPush;
    }
  });

  test('needsRebase detects when child is behind parent', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    let stack = StackManager.createStack('check-stack', 'main');
    stack = StackManager.addNode(stack, 'feat/child', 'main');

    const needsRebase = await RebaseEngine.needsRebase(repo.dir, stack, 'feat/child');
    expect(needsRebase).toBe(false);

    // Advance main
    repo.git('checkout', 'main');
    await appendFile(join(repo.dir, 'file-a.txt'), 'new line on main\n');
    repo.git('add', '.');
    repo.git('commit', '-m', 'advance main');

    const needsRebaseNow = await RebaseEngine.needsRebase(repo.dir, stack, 'feat/child');
    expect(needsRebaseNow).toBe(true);
  });
});
