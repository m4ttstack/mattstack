import { describe, test, expect, afterEach } from 'bun:test';
import { join } from 'node:path';
import { rm, writeFile } from 'node:fs/promises';
import { createSandboxRepoWithRemote, addNamedWorktree } from './helpers.ts';
import type { SandboxRepoWithRemote } from './helpers.ts';
import { RebaseEngine } from '../../src/core/rebase-engine.ts';
import { GitShell } from '../../src/core/git-shell.ts';
import type { Stack, StackNode } from '../../src/core/types.ts';

const cleanups: string[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await rm(cleanups.pop()!, { recursive: true, force: true });
});

function node(branch: string, parent: string): StackNode {
  return {
    branch, parent, mrIid: null, mrUrl: null, mrTitle: null, status: 'local-only',
    lastKnownHead: null, forkPoint: null, diffStats: null, pipelineStatus: 'unknown', unresolvedThreads: 0,
  };
}

/** main pushed, feature branch off it, then origin/main advances (no conflict). */
async function scenario(): Promise<{ repo: SandboxRepoWithRemote; stack: Stack; workDir: string }> {
  const repo = await createSandboxRepoWithRemote();
  cleanups.push(repo.dir, repo.remoteDir);
  const { dir, git } = repo;
  await writeFile(join(dir, 'app.txt'), 'a\n');
  git('add', '.');
  git('commit', '-m', 'base');
  git('push', '-u', 'origin', 'main');
  git('checkout', '-b', 'feature');
  await writeFile(join(dir, 'feat.txt'), 'f\n');
  git('add', '.');
  git('commit', '-m', 'feature work');
  git('checkout', 'main');
  git('checkout', '-b', 'up');
  await writeFile(join(dir, 'up.txt'), 'u\n');
  git('add', '.');
  git('commit', '-m', 'upstream');
  git('push', 'origin', 'up:main');
  git('checkout', 'main');
  git('branch', '-D', 'up');
  const workDir = await addNamedWorktree(repo, 'gitq-1');
  cleanups.push(workDir);
  const stack: Stack = { id: 'st', stackName: 'st', root: 'main', nodes: [node('feature', 'main')] };
  return { repo, stack, workDir };
}

describe('detached cascade', () => {
  test('rebases without checking the branch out anywhere, leaves the work slot detached, never moves cwd HEAD', async () => {
    const { repo, stack, workDir } = await scenario();
    const cwdBranchBefore = repo.git('branch', '--show-current');

    const res = await RebaseEngine.syncLocalStack(repo.dir, stack, workDir);
    expect(res.state).toBe('completed');
    expect(repo.git('rev-parse', 'feature^')).toBe(repo.git('rev-parse', 'origin/main'));
    expect(repo.git('branch', '--show-current')).toBe(cwdBranchBefore);
    const map = await GitShell.worktreeList(repo.dir);
    expect(map.find((w) => w.path === workDir)?.branch).toBeNull();
  });

  test('auto-fixes a branch checked out in a CLEAN human slot: ref moves, slot resets to new head, still clean', async () => {
    const { repo, stack, workDir } = await scenario();
    const human = await addNamedWorktree(repo, 'dobby', 'feature');
    cleanups.push(human);

    const res = await RebaseEngine.syncLocalStack(repo.dir, stack, workDir);
    expect(res.state).toBe('completed');
    const newHead = repo.git('rev-parse', 'feature');
    expect(repo.git('rev-parse', 'feature^')).toBe(repo.git('rev-parse', 'origin/main'));
    expect(repo.git('-C', human, 'rev-parse', 'HEAD')).toBe(newHead);
    expect(repo.git('-C', human, 'status', '--porcelain')).toBe('');
  });

  test('refuses a branch checked out in a DIRTY human slot with a structured per-branch failure', async () => {
    const { repo, stack, workDir } = await scenario();
    const human = await addNamedWorktree(repo, 'dobby', 'feature');
    cleanups.push(human);
    const oldHead = repo.git('rev-parse', 'feature');
    await writeFile(join(human, 'wip.txt'), 'uncommitted\n');

    const res = await RebaseEngine.syncLocalStack(repo.dir, stack, workDir);
    expect(res.state).toBe('completed');
    const failure = res.results.find((r) => r.branch === 'feature');
    expect(failure?.success).toBe(false);
    expect(failure?.error).toContain('checked out');
    expect(failure?.error).toContain('dobby');
    expect(repo.git('rev-parse', 'feature')).toBe(oldHead);
    expect(repo.git('-C', human, 'status', '--porcelain')).toContain('wip.txt');
  });

  test('conflict pauses in the work slot with worktreePath, and continue finalizes the ref', async () => {
    const repo = await createSandboxRepoWithRemote();
    cleanups.push(repo.dir, repo.remoteDir);
    const { dir, git } = repo;
    await writeFile(join(dir, 'app.txt'), 'line\n');
    git('add', '.');
    git('commit', '-m', 'base');
    git('push', '-u', 'origin', 'main');
    git('checkout', '-b', 'feature');
    await writeFile(join(dir, 'app.txt'), 'line by feature\n');
    git('commit', '-am', 'feature edit');
    git('checkout', 'main');
    git('checkout', '-b', 'up');
    await writeFile(join(dir, 'app.txt'), 'line upstream\n');
    git('commit', '-am', 'upstream edit');
    git('push', 'origin', 'up:main');
    git('checkout', 'main');
    git('branch', '-D', 'up');
    const workDir = await addNamedWorktree(repo, 'gitq-1');
    cleanups.push(workDir);
    const stack: Stack = { id: 'st', stackName: 'st', root: 'main', nodes: [node('feature', 'main')] };

    const res = await RebaseEngine.syncLocalStack(repo.dir, stack, workDir);
    expect(res.state).toBe('paused');
    expect(res.pauseInfo!.worktreePath).toBe(workDir);
    expect(GitShell.isRebaseInProgress(workDir)).toBe(true);
    expect(GitShell.isRebaseInProgress(repo.dir)).toBe(false);

    await writeFile(join(workDir, 'app.txt'), 'line upstream, by feature\n');
    repo.git('-C', workDir, 'add', 'app.txt');
    const cont = await RebaseEngine.continueCascade(repo.dir, res.updatedStack, res.pauseInfo!, workDir);
    expect(cont.state).toBe('completed');
    expect(repo.git('rev-parse', 'feature^')).toBe(repo.git('rev-parse', 'origin/main'));
    const map = await GitShell.worktreeList(repo.dir);
    expect(map.find((w) => w.path === workDir)?.branch).toBeNull();
  });
});
