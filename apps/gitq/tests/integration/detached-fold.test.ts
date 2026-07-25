import { describe, test, expect, afterEach } from 'bun:test';
import { join, dirname } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createSandboxRepoWithRemote, addNamedWorktree, cleanupRepo } from './helpers.ts';
import type { SandboxRepoWithRemote } from './helpers.ts';
import { foldBranch } from '../../src/core/branch-fold.ts';
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
 * Stack: main -> feature-a -> feature-b. feature-a has one commit (a.txt),
 * feature-b has one commit (b.txt) on top. A gitq-style detached work slot
 * is passed through, same builder pattern as the reparent scenario.
 */
async function foldScenario(): Promise<{
  repo: SandboxRepoWithRemote; stack: Stack; workDir: string;
}> {
  const repo = trackRepo(await createSandboxRepoWithRemote());
  const { dir, git } = repo;

  git('checkout', '-b', 'feature-a');
  await writeFile(join(dir, 'a.txt'), 'a\n', 'utf-8');
  git('add', '.');
  git('commit', '-m', 'a: add a');

  git('checkout', '-b', 'feature-b');
  await writeFile(join(dir, 'b.txt'), 'b\n', 'utf-8');
  git('add', '.');
  git('commit', '-m', 'b: add b');

  git('checkout', 'main');

  const workDir = join(dirname(dir), `${dir.split('/').pop()}-wt-gitq-1`);
  git('worktree', 'add', '--detach', workDir, 'HEAD');
  cleanups.push(workDir);

  const stack: Stack = {
    id: 's1', stackName: 'fold', root: 'main',
    nodes: [node('feature-a', 'main'), node('feature-b', 'feature-a')],
  };
  return { repo, stack, workDir };
}

/**
 * Same shape as foldScenario, but feature-a gets a second commit AFTER
 * feature-b has branched off, touching b.txt with different content, so
 * replaying feature-b's "add b" commit onto the amended feature-a conflicts.
 */
async function foldConflictScenario(): Promise<{
  repo: SandboxRepoWithRemote; stack: Stack; workDir: string;
}> {
  const repo = trackRepo(await createSandboxRepoWithRemote());
  const { dir, git } = repo;

  git('checkout', '-b', 'feature-a');
  await writeFile(join(dir, 'a.txt'), 'a\n', 'utf-8');
  git('add', '.');
  git('commit', '-m', 'a: add a');

  git('checkout', '-b', 'feature-b');
  await writeFile(join(dir, 'b.txt'), 'b\n', 'utf-8');
  git('add', '.');
  git('commit', '-m', 'b: add b');

  // feature-a amended AFTER feature-b branched: adds b.txt with conflicting
  // content so folding feature-b's "add b" commit onto it hits a conflict.
  git('checkout', 'feature-a');
  await writeFile(join(dir, 'b.txt'), 'conflicting b\n', 'utf-8');
  git('add', '.');
  git('commit', '-m', 'a: also add b (conflicting)');

  git('checkout', 'main');

  const workDir = join(dirname(dir), `${dir.split('/').pop()}-wt-gitq-1`);
  git('worktree', 'add', '--detach', workDir, 'HEAD');
  cleanups.push(workDir);

  const stack: Stack = {
    id: 's1', stackName: 'fold', root: 'main',
    nodes: [node('feature-a', 'main'), node('feature-b', 'feature-a')],
  };
  return { repo, stack, workDir };
}

describe('detached fold', () => {
  test('folds via the slot: parent CAS-moved, branch deleted, launch untouched', async () => {
    const { repo, stack, workDir } = await foldScenario();
    repo.git('checkout', 'main');
    const launchHead = repo.git('rev-parse', 'HEAD');
    const bHead = repo.git('rev-parse', 'feature-b');

    const result = await foldBranch(repo.dir, stack, 'feature-b', workDir);

    expect(result.intoParent).toBe('feature-a');
    expect(repo.git('rev-parse', 'feature-a')).toBe(bHead);
    expect(() => repo.git('rev-parse', '--verify', 'refs/heads/feature-b')).toThrow();
    expect(repo.git('rev-parse', 'HEAD')).toBe(launchHead);
    expect(repo.git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(GitShell.isRebaseInProgress(workDir)).toBe(false);
  });

  test('fold conflict refuses cleanly: refs unmoved, branch kept, slot clean', async () => {
    // feature-a amended AFTER feature-b branched so the fold rebase conflicts
    const { repo, stack, workDir } = await foldConflictScenario();
    const heads = { a: repo.git('rev-parse', 'feature-a'), b: repo.git('rev-parse', 'feature-b') };

    await expect(foldBranch(repo.dir, stack, 'feature-b', workDir)).rejects.toThrow(/conflict/i);

    expect(repo.git('rev-parse', 'feature-a')).toBe(heads.a);
    expect(repo.git('rev-parse', 'feature-b')).toBe(heads.b);
    expect(GitShell.isRebaseInProgress(repo.dir)).toBe(false);
    expect(GitShell.isRebaseInProgress(workDir)).toBe(false);
  });

  test('folded branch checked out in a CLEAN slot: slot switches to the parent', async () => {
    const { repo, stack, workDir } = await foldScenario();
    repo.git('checkout', 'main');
    const slotPath = await addNamedWorktree(repo, 'b-slot', 'feature-b');

    await foldBranch(repo.dir, stack, 'feature-b', workDir);

    const gitAt = (...args: string[]) =>
      Bun.spawnSync(['git', '-C', slotPath, ...args]).stdout.toString().trim();
    expect(gitAt('rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature-a');
    expect(() => repo.git('rev-parse', '--verify', 'refs/heads/feature-b')).toThrow();
  });

  test('folded branch checked out in a DIRTY slot: refuses, nothing changed', async () => {
    const { repo, stack, workDir } = await foldScenario();
    repo.git('checkout', 'main');
    const slotPath = await addNamedWorktree(repo, 'b-slot', 'feature-b');
    await writeFile(join(slotPath, 'wip.txt'), 'wip\n', 'utf-8');
    const heads = { a: repo.git('rev-parse', 'feature-a'), b: repo.git('rev-parse', 'feature-b') };

    await expect(foldBranch(repo.dir, stack, 'feature-b', workDir)).rejects.toThrow(/dirty|checked out/i);

    expect(repo.git('rev-parse', 'feature-a')).toBe(heads.a);
    expect(repo.git('rev-parse', 'feature-b')).toBe(heads.b);
  });

  test('parent checked out in a clean slot auto-resets to the folded head', async () => {
    const { repo, stack, workDir } = await foldScenario();
    repo.git('checkout', 'main');
    const slotPath = await addNamedWorktree(repo, 'a-slot', 'feature-a');

    await foldBranch(repo.dir, stack, 'feature-b', workDir);

    const gitAt = (...args: string[]) =>
      Bun.spawnSync(['git', '-C', slotPath, ...args]).stdout.toString().trim();
    expect(gitAt('rev-parse', 'HEAD')).toBe(repo.git('rev-parse', 'feature-a'));
  });
});
