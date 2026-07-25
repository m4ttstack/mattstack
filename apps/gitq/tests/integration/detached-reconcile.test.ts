import { describe, test, expect, afterEach } from 'bun:test';
import { join, dirname } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createSandboxRepoWithRemote, addNamedWorktree, cleanupRepo } from './helpers.ts';
import type { SandboxRepoWithRemote } from './helpers.ts';
import { RebaseEngine } from '../../src/core/rebase-engine.ts';
import { GitShell } from '../../src/core/git-shell.ts';
import type { Stack, StackNode } from '../../src/core/types.ts';

const cleanups: string[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanupRepo(cleanups.pop()!);
});

function trackRepo(repo: SandboxRepoWithRemote): SandboxRepoWithRemote {
  cleanups.push(repo.dir, repo.remoteDir);
  return repo;
}

function node(branch: string, parent: string, extra: Partial<StackNode> = {}): StackNode {
  return {
    branch, parent, mrIid: null, mrUrl: null, mrTitle: null, status: 'local-only',
    lastKnownHead: null, forkPoint: null, diffStats: null, pipelineStatus: 'unknown',
    unresolvedThreads: 0, ...extra,
  };
}

/**
 * origin/main got parent's work squash-merged; parent branch kept a review
 * commit the child never saw (the tombstone). Child branched from parent
 * before that review commit. Reconciliation must replay the child's own
 * commit onto the tombstone, then hoist onto origin/main.
 */
async function mergedParentScenario(childFile: string, conflicting: boolean): Promise<{
  repo: SandboxRepoWithRemote; stack: Stack; workDir: string;
}> {
  const repo = trackRepo(await createSandboxRepoWithRemote());
  const { dir, git } = repo;
  await writeFile(join(dir, 'app.txt'), 'alpha\nbeta\ngamma\n', 'utf-8');
  git('add', '.');
  git('commit', '-m', 'base');
  git('push', '-u', 'origin', 'main');

  git('checkout', '-b', 'feature-a');
  await writeFile(join(dir, 'app.txt'), 'alpha\nbeta by A\ngamma\n', 'utf-8');
  git('commit', '-am', 'a: beta work');

  // child branches BEFORE the review commit
  git('checkout', '-b', 'feature-b');
  if (conflicting) {
    await writeFile(join(dir, 'review.txt'), 'child view\n', 'utf-8');
  } else {
    await writeFile(join(dir, childFile), 'b work\n', 'utf-8');
  }
  git('add', '.');
  git('commit', '-m', 'b: own work');

  // parent gets a post-branch review commit (this is what reconcile picks up)
  git('checkout', 'feature-a');
  await writeFile(join(dir, 'review.txt'), 'review fix\n', 'utf-8');
  git('add', '.');
  git('commit', '-m', 'a: review fix');

  // squash-merge parent to origin/main
  git('checkout', 'main');
  await writeFile(join(dir, 'app.txt'), 'alpha\nbeta by A\ngamma\n', 'utf-8');
  await writeFile(join(dir, 'review.txt'), 'review fix\n', 'utf-8');
  git('add', '.');
  git('commit', '-m', 'squash: feature-a');
  git('push', 'origin', 'main');
  git('reset', '--hard', 'HEAD~1');
  git('fetch', 'origin');

  // pooled shape: a named human slot plus a gitq work slot
  await addNamedWorktree(repo, 'human');
  const poolParent = dirname(dir);
  const workDir = join(poolParent, `${dir.split('/').pop()}-pool-gitq-1`);
  // a plain detached worktree named like a work slot is fine for engine tests
  git('worktree', 'add', '--detach', workDir, 'HEAD');
  cleanups.push(workDir);

  const stack: Stack = {
    id: 's1', stackName: 'recon', root: 'main',
    nodes: [
      node('feature-a', 'main', { status: 'merged', lastKnownHead: git('rev-parse', 'feature-a') }),
      node('feature-b', 'feature-a'),
    ],
  };
  return { repo, stack, workDir };
}

describe('detached reconciliation', () => {
  test('reconciles and hoists in the work slot; launch checkout untouched', async () => {
    const { repo, stack, workDir } = await mergedParentScenario('b.txt', false);
    const launchHead = repo.git('rev-parse', 'HEAD');
    const launchBranch = repo.git('rev-parse', '--abbrev-ref', 'HEAD');

    const res = await RebaseEngine.syncLocalStack(repo.dir, stack, workDir);

    expect(res.state).toBe('completed');
    expect(res.results.every((r) => r.success)).toBe(true);
    // reconcile picked up the review commit, then hoisted onto origin/main
    const originMain = repo.git('rev-parse', 'origin/main');
    expect(repo.git('merge-base', 'feature-b', 'origin/main')).toBe(originMain);
    expect(repo.git('log', '--format=%s', 'origin/main..feature-b')).toBe('b: own work');
    // launch tree never moved
    expect(repo.git('rev-parse', 'HEAD')).toBe(launchHead);
    expect(repo.git('rev-parse', '--abbrev-ref', 'HEAD')).toBe(launchBranch);
    expect(GitShell.isRebaseInProgress(repo.dir)).toBe(false);
    // slot back to detached idle
    expect(GitShell.isRebaseInProgress(workDir)).toBe(false);
  });

  test('reconcile conflict pauses with worktreePath and resumes to completion', async () => {
    const { repo, stack, workDir } = await mergedParentScenario('review.txt', true);
    const oldChildHead = repo.git('rev-parse', 'feature-b');

    const res = await RebaseEngine.syncLocalStack(repo.dir, stack, workDir);

    expect(res.state).toBe('paused');
    expect(res.pauseInfo!.phase).toBe('reconcile');
    expect(res.pauseInfo!.worktreePath).toBe(workDir);
    expect(res.pauseInfo!.currentBranch).toBe('feature-b');
    // the branch ref has NOT moved yet
    expect(repo.git('rev-parse', 'feature-b')).toBe(oldChildHead);
    // launch tree is not the conflict site
    expect(GitShell.isRebaseInProgress(repo.dir)).toBe(false);
    expect(GitShell.isRebaseInProgress(workDir)).toBe(true);

    // resolve in the SLOT
    await writeFile(join(workDir, 'review.txt'), 'review fix\nchild view\n', 'utf-8');
    const gitAt = (...args: string[]) =>
      Bun.spawnSync(['git', '-C', workDir, ...args]).stdout.toString().trim();
    gitAt('add', 'review.txt');

    const cont = await RebaseEngine.continueCascade(repo.dir, res.updatedStack, res.pauseInfo!, workDir);

    expect(cont.state).toBe('completed');
    const originMain = repo.git('rev-parse', 'origin/main');
    // resume ran the main rebase onto the LIVE target, not back onto the tombstone
    expect(repo.git('merge-base', 'feature-b', 'origin/main')).toBe(originMain);
    expect(repo.git('rev-parse', 'feature-b')).not.toBe(oldChildHead);
    expect(GitShell.isRebaseInProgress(workDir)).toBe(false);
  });

  test('child checked out in a clean human slot auto-fixes instead of refusing', async () => {
    const { repo, stack, workDir } = await mergedParentScenario('b.txt', false);
    const slotPath = await addNamedWorktree(repo, 'child-slot', 'feature-b');

    const res = await RebaseEngine.syncLocalStack(repo.dir, stack, workDir);

    expect(res.state).toBe('completed');
    expect(res.results.every((r) => r.success)).toBe(true);
    const gitAt = (...args: string[]) =>
      Bun.spawnSync(['git', '-C', slotPath, ...args]).stdout.toString().trim();
    expect(gitAt('rev-parse', 'HEAD')).toBe(repo.git('rev-parse', 'feature-b'));
    expect(gitAt('status', '--porcelain')).toBe('');
  });
});
