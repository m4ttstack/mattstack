import { describe, test, expect, afterEach } from 'bun:test';
import { join, dirname } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createSandboxRepoWithRemote, addNamedWorktree, cleanupRepo } from './helpers.ts';
import type { SandboxRepoWithRemote } from './helpers.ts';
import { reparentBranch } from '../../src/core/reparent.ts';
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
 * Stack: main -> feature-a -> feature-b, plus main -> feature-c.
 * Reparent feature-c onto feature-a (clean), and feature-a onto feature-c
 * for the conflict case. A gitq-style detached work slot is passed through.
 */
async function reparentScenario(): Promise<{
  repo: SandboxRepoWithRemote; stack: Stack; workDir: string;
}> {
  const repo = trackRepo(await createSandboxRepoWithRemote());
  const { dir, git } = repo;
  await writeFile(join(dir, 'app.txt'), 'alpha\nbeta\ngamma\n', 'utf-8');
  git('add', '.');
  git('commit', '-m', 'base');
  git('push', '-u', 'origin', 'main');

  git('checkout', '-b', 'feature-a');
  await writeFile(join(dir, 'a.txt'), 'a\n', 'utf-8');
  git('add', '.');
  git('commit', '-m', 'a: add a');

  git('checkout', '-b', 'feature-b');
  await writeFile(join(dir, 'b.txt'), 'b\n', 'utf-8');
  git('add', '.');
  git('commit', '-m', 'b: add b');

  git('checkout', 'main');
  git('checkout', '-b', 'feature-c');
  await writeFile(join(dir, 'app.txt'), 'alpha\nbeta by C\ngamma\n', 'utf-8');
  git('commit', '-am', 'c: rework beta');
  git('checkout', 'main');

  const workDir = join(dirname(dir), `${dir.split('/').pop()}-wt-gitq-1`);
  git('worktree', 'add', '--detach', workDir, 'HEAD');
  cleanups.push(workDir);

  const stack: Stack = {
    id: 's1', stackName: 'rep', root: 'main',
    nodes: [node('feature-a', 'main'), node('feature-b', 'feature-a'), node('feature-c', 'main')],
  };
  return { repo, stack, workDir };
}

describe('detached reparent', () => {
  test('moves the branch by CAS and cascades descendants without touching the launch tree', async () => {
    const { repo, stack, workDir } = await reparentScenario();
    const launchHead = repo.git('rev-parse', 'HEAD');
    const oldCHead = repo.git('rev-parse', 'feature-c');

    const result = await reparentBranch(repo.dir, stack, 'feature-c', 'feature-a', workDir);

    expect(result.newParent).toBe('feature-a');
    expect(repo.git('rev-parse', 'feature-c^')).toBe(repo.git('rev-parse', 'feature-a'));
    expect(repo.git('rev-parse', 'feature-c')).not.toBe(oldCHead);
    expect(repo.git('rev-parse', 'HEAD')).toBe(launchHead);
    expect(repo.git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(GitShell.isRebaseInProgress(repo.dir)).toBe(false);
    expect(GitShell.isRebaseInProgress(workDir)).toBe(false);
  });

  test('descendants replay only their own commits (seeded fork point)', async () => {
    const { repo, stack, workDir } = await reparentScenario();

    const result = await reparentBranch(repo.dir, stack, 'feature-a', 'feature-c', workDir);

    expect(result.cascadeResult?.state).toBe('completed');
    // feature-b holds exactly its own commit atop the moved feature-a
    expect(repo.git('rev-parse', 'feature-b^')).toBe(repo.git('rev-parse', 'feature-a'));
    expect(repo.git('log', '--format=%s', 'feature-a..feature-b')).toBe('b: add b');
  });

  test('own-rebase conflict refuses cleanly: nothing moved, no tree stranded', async () => {
    const { repo, stack, workDir } = await reparentScenario();
    // make feature-a conflict with feature-c on app.txt
    repo.git('checkout', 'feature-a');
    await writeFile(join(repo.dir, 'app.txt'), 'alpha\nbeta by A\ngamma\n', 'utf-8');
    repo.git('commit', '-am', 'a: also rework beta');
    repo.git('checkout', 'main');
    const heads = {
      a: repo.git('rev-parse', 'feature-a'),
      b: repo.git('rev-parse', 'feature-b'),
      c: repo.git('rev-parse', 'feature-c'),
    };

    await expect(reparentBranch(repo.dir, stack, 'feature-a', 'feature-c', workDir))
      .rejects.toThrow(/conflict/i);

    expect(repo.git('rev-parse', 'feature-a')).toBe(heads.a);
    expect(repo.git('rev-parse', 'feature-b')).toBe(heads.b);
    expect(repo.git('rev-parse', 'feature-c')).toBe(heads.c);
    expect(GitShell.isRebaseInProgress(repo.dir)).toBe(false);
    expect(GitShell.isRebaseInProgress(workDir)).toBe(false);
  });

  test('moved branch checked out in a clean slot auto-fixes', async () => {
    const { repo, stack, workDir } = await reparentScenario();
    const slotPath = await addNamedWorktree(repo, 'c-slot', 'feature-c');

    await reparentBranch(repo.dir, stack, 'feature-c', 'feature-a', workDir);

    const gitAt = (...args: string[]) =>
      Bun.spawnSync(['git', '-C', slotPath, ...args]).stdout.toString().trim();
    expect(gitAt('rev-parse', 'HEAD')).toBe(repo.git('rev-parse', 'feature-c'));
    expect(gitAt('status', '--porcelain')).toBe('');
  });
});
