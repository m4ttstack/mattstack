import { describe, test, expect, afterEach } from 'bun:test';
import { join, dirname } from 'node:path';
import { writeFile, readFile, chmod, lstat } from 'node:fs/promises';
import { createSandboxRepoWithRemote, addNamedWorktree, cleanupRepo, commit } from './helpers.ts';
import type { SandboxRepoWithRemote } from './helpers.ts';
import { AbsorbEngine } from '../../src/core/absorb.ts';
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
 * Stack: main -> feature-a (touches a.txt) -> feature-b (touches b.txt).
 * A gitq-style detached work slot is passed through, same builder pattern
 * as the other detached-* scenarios.
 */
async function absorbScenario(): Promise<{
  repo: SandboxRepoWithRemote; stack: Stack; workDir: string;
}> {
  const repo = trackRepo(await createSandboxRepoWithRemote());
  const { dir, git } = repo;
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

  const workDir = join(dirname(dir), `${dir.split('/').pop()}-wt-gitq-1`);
  git('worktree', 'add', '--detach', workDir, 'HEAD');
  cleanups.push(workDir);

  const stack: Stack = {
    id: 's1', stackName: 'absorb', root: 'main',
    nodes: [node('feature-a', 'main'), node('feature-b', 'feature-a')],
  };
  return { repo, stack, workDir };
}

/**
 * Same shape as absorbScenario, but feature-b's own commits net-zero on
 * shared.txt: a first commit rewrites the line, a second commit reverts it
 * back to feature-a's exact content (plus touches b.txt). That net-zero
 * means the file attributes to feature-a (the deepest branch whose OWN diff
 * still shows it), while feature-b's real intermediate commit is still there
 * to replay. A dirty edit to shared.txt (attributed to feature-a) amends
 * feature-a again, so replaying feature-b's intermediate "rewrite" commit
 * onto the amended feature-a conflicts.
 */
async function absorbConflictScenario(): Promise<{
  repo: SandboxRepoWithRemote; stack: Stack; workDir: string;
}> {
  const repo = trackRepo(await createSandboxRepoWithRemote());
  const { dir, git } = repo;
  git('push', '-u', 'origin', 'main');

  git('checkout', '-b', 'feature-a');
  await commit(dir, git, 'shared.txt', 'shared a\n', 'a: add shared.txt');

  git('checkout', '-b', 'feature-b');
  await writeFile(join(dir, 'shared.txt'), 'shared b\n', 'utf-8');
  git('add', '.');
  git('commit', '-m', 'b: rewrite shared line');

  // Net-zero across feature-a..feature-b: shared.txt reverts to feature-a's
  // exact content, so it does not attribute to feature-b, but the prior
  // commit (with the real rewrite) is still there to replay on cascade.
  await writeFile(join(dir, 'shared.txt'), 'shared a\n', 'utf-8');
  await writeFile(join(dir, 'b.txt'), 'b\n', 'utf-8');
  git('add', '-A');
  git('commit', '-m', 'b: revert shared line, add b.txt');

  const workDir = join(dirname(dir), `${dir.split('/').pop()}-wt-gitq-1`);
  git('worktree', 'add', '--detach', workDir, 'HEAD');
  cleanups.push(workDir);

  // Dirty edit that amends feature-a's version of the shared line again.
  await writeFile(join(dir, 'shared.txt'), 'shared a MODIFIED\n', 'utf-8');

  const stack: Stack = {
    id: 's1', stackName: 'absorb', root: 'main',
    nodes: [node('feature-a', 'main'), node('feature-b', 'feature-a')],
  };
  return { repo, stack, workDir };
}

describe('detached absorb restack', () => {
  test('restacks the child through the slot; launch tree never switches branches', async () => {
    const { repo, stack, workDir } = await absorbScenario();
    // dirty edit belonging to feature-a, while standing on feature-b
    repo.git('checkout', 'feature-b');
    await writeFile(join(repo.dir, 'a.txt'), 'a v2\n', 'utf-8');

    const result = await AbsorbEngine.absorb(repo.dir, stack, undefined, workDir);

    expect(result.absorbed).toBe(true);
    expect(result.cascadeResult?.results.every((r) => r.success)).toBe(true);
    // feature-b rebased onto the amended feature-a
    expect(repo.git('rev-parse', 'feature-b^')).toBe(repo.git('rev-parse', 'feature-a'));
    // launch tree ends where it started, clean
    expect(repo.git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature-b');
    expect(GitShell.isRebaseInProgress(repo.dir)).toBe(false);
    expect(GitShell.isRebaseInProgress(workDir)).toBe(false);
  });

  test('unattributed work comes back in the launch tree, entry state and all', async () => {
    // The production path: a work slot, a real cascade, and files no branch
    // owns riding through the stash alongside the one that gets committed.
    const { repo, stack, workDir } = await absorbScenario();
    repo.git('checkout', 'feature-b');
    await writeFile(join(repo.dir, 'a.txt'), 'a v2\n', 'utf-8');
    await writeFile(join(repo.dir, 'notes.txt'), 'scratch\n', 'utf-8');
    await writeFile(join(repo.dir, 'deploy.sh'), '#!/bin/sh\necho deploy\n', 'utf-8');
    await chmod(join(repo.dir, 'deploy.sh'), 0o755);

    const result = await AbsorbEngine.absorb(repo.dir, stack, undefined, workDir);

    expect(result.absorbed).toBe(true);
    expect(result.cascadeResult?.results.every((r) => r.success)).toBe(true);
    expect(result.unattributed.sort()).toEqual(['deploy.sh', 'notes.txt']);
    expect(result.recovery).toBeUndefined();

    // Both back, byte- and mode-identical, still untracked.
    expect(await readFile(join(repo.dir, 'notes.txt'), 'utf-8')).toBe('scratch\n');
    expect((await lstat(join(repo.dir, 'deploy.sh'))).mode & 0o777).toBe(0o755);
    expect(repo.git('status', '--short')).toBe('?? deploy.sh\n?? notes.txt');
    // a.txt landed on feature-a and feature-b was restacked onto it.
    expect(repo.git('show', 'feature-a:a.txt')).toBe('a v2');
    expect(repo.git('rev-parse', 'feature-b^')).toBe(repo.git('rev-parse', 'feature-a'));
    // The restore landed, so the stash absorb took is gone rather than kept.
    expect(repo.git('stash', 'list')).toBe('');
  });

  test('restacked child checked out in a clean slot auto-fixes', async () => {
    const { repo, stack, workDir } = await absorbScenario();
    const slotPath = await addNamedWorktree(repo, 'b-slot', 'feature-b');
    repo.git('checkout', 'feature-a');
    await writeFile(join(repo.dir, 'a.txt'), 'a v2\n', 'utf-8');

    const result = await AbsorbEngine.absorb(repo.dir, stack, undefined, workDir);

    expect(result.cascadeResult?.results.every((r) => r.success)).toBe(true);
    const gitAt = (...args: string[]) =>
      Bun.spawnSync(['git', '-C', slotPath, ...args]).stdout.toString().trim();
    expect(gitAt('rev-parse', 'HEAD')).toBe(repo.git('rev-parse', 'feature-b'));
  });

  test('restack conflict backs out in the slot, not the launch tree', async () => {
    const { repo, stack, workDir } = await absorbConflictScenario();
    // Dirty edit that amends feature-a in a way feature-b's commit conflicts
    // with. Reached through --at: blame attributes the shared line to
    // feature-b's revert commit, which is the last one to touch it, so plain
    // attribution now sends this to feature-b and replays clean. Forcing it
    // onto feature-a is what still exercises the cascade-conflict backout.
    const result = await AbsorbEngine.absorb(repo.dir, stack, undefined, workDir, [{ branch: 'feature-a' }]);

    expect(result.absorbed).toBe(true);
    const failure = result.cascadeResult?.results.find((r) => !r.success);
    expect(failure).toBeDefined();
    // slot cleaned; launch tree untouched and not mid-rebase
    expect(GitShell.isRebaseInProgress(workDir)).toBe(false);
    expect(GitShell.isRebaseInProgress(repo.dir)).toBe(false);
  });
});
