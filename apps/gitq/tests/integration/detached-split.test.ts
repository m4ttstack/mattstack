import { describe, test, expect, afterEach } from 'bun:test';
import { join, dirname } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createSandboxRepoWithRemote, addNamedWorktree, cleanupRepo } from './helpers.ts';
import type { SandboxRepoWithRemote } from './helpers.ts';
import { BranchSplitter } from '../../src/core/branch-splitter.ts';
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
 * Stack: main -> feature-x. main is pushed to origin. feature-x carries
 * three commits, one per file (one.txt, two.txt, three.txt). A gitq-style
 * detached work slot is passed through, same builder pattern as the
 * fold/reparent scenarios.
 */
async function splitScenario(): Promise<{
  repo: SandboxRepoWithRemote; stack: Stack; workDir: string;
}> {
  const repo = trackRepo(await createSandboxRepoWithRemote());
  const { dir, git } = repo;
  git('push', '-u', 'origin', 'main');

  git('checkout', '-b', 'feature-x');
  await writeFile(join(dir, 'one.txt'), 'one\n', 'utf-8');
  git('add', '.');
  git('commit', '-m', 'x: add one');

  await writeFile(join(dir, 'two.txt'), 'two\n', 'utf-8');
  git('add', '.');
  git('commit', '-m', 'x: add two');

  await writeFile(join(dir, 'three.txt'), 'three\n', 'utf-8');
  git('add', '.');
  git('commit', '-m', 'x: add three');

  git('checkout', 'main');

  const workDir = join(dirname(dir), `${dir.split('/').pop()}-wt-gitq-1`);
  git('worktree', 'add', '--detach', workDir, 'HEAD');
  cleanups.push(workDir);

  const stack: Stack = {
    id: 's1', stackName: 'split', root: 'main',
    nodes: [node('feature-x', 'main')],
  };
  return { repo, stack, workDir };
}

describe('ref-only tail split', () => {
  test('splits without touching any working tree, even a dirty one', async () => {
    const { repo, stack } = await splitScenario();
    repo.git('checkout', 'main');
    await writeFile(join(repo.dir, 'dirty.txt'), 'uncommitted\n', 'utf-8');
    const launchHead = repo.git('rev-parse', 'HEAD');
    const xHead = repo.git('rev-parse', 'feature-x');
    const splitAt = repo.git('rev-parse', 'feature-x~2'); // keep first commit

    const result = await BranchSplitter.tailSplit(repo.dir, stack, 'feature-x', 'feature-x-tail', splitAt);

    expect(repo.git('rev-parse', 'feature-x')).toBe(splitAt);
    expect(repo.git('rev-parse', 'feature-x-tail')).toBe(xHead);
    expect(result.movedCommits.length).toBe(2);
    expect(repo.git('rev-parse', 'HEAD')).toBe(launchHead);
    expect(repo.git('status', '--porcelain')).toContain('dirty.txt');
  });

  test('source checked out in a clean slot auto-resets; dirty slot refuses and rolls back', async () => {
    const { repo, stack } = await splitScenario();
    repo.git('checkout', 'main');
    const slotPath = await addNamedWorktree(repo, 'x-slot', 'feature-x');
    const splitAt = repo.git('rev-parse', 'feature-x~1');

    const result = await BranchSplitter.tailSplit(repo.dir, stack, 'feature-x', 'feature-x-tail', splitAt);
    const gitAt = (...args: string[]) =>
      Bun.spawnSync(['git', '-C', slotPath, ...args]).stdout.toString().trim();
    expect(gitAt('rev-parse', 'HEAD')).toBe(splitAt);

    // dirty case, fresh names
    await writeFile(join(slotPath, 'wip.txt'), 'wip\n', 'utf-8');
    const stack2 = result.updatedStack;
    await expect(
      BranchSplitter.tailSplit(repo.dir, stack2, 'feature-x', 'feature-x-tail2', repo.git('rev-parse', 'feature-x~1')),
    ).rejects.toThrow(/dirty|checked out/i);
    expect(() => repo.git('rev-parse', '--verify', 'refs/heads/feature-x-tail2')).toThrow();
  });
});

describe('detached file split', () => {
  test('partitions files in the work slot; launch tree untouched', async () => {
    const { repo, stack, workDir } = await splitScenario();
    repo.git('checkout', 'main');
    const launchHead = repo.git('rev-parse', 'HEAD');

    const result = await BranchSplitter.splitByFile(
      repo.dir, stack, 'feature-x', ['two.txt'], 'feature-x-two', workDir,
    );

    expect(result.movedFiles).toEqual(['two.txt']);
    // new branch contains exactly the moved file's change
    expect(repo.git('diff', '--name-only', 'main', 'feature-x-two').split('\n')).toEqual(['two.txt']);
    // source tip no longer touches the moved file
    expect(repo.git('diff', '--name-only', 'main', 'feature-x')).not.toContain('two.txt');
    expect(repo.git('rev-parse', 'HEAD')).toBe(launchHead);
    expect(repo.git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(GitShell.isRebaseInProgress(workDir)).toBe(false);
  });
});
