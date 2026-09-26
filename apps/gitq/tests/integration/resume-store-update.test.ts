import { afterEach, describe, expect, mock, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GitShell } from '../../src/core/git-shell.ts';
import { StackManager } from '../../src/core/stack-manager.ts';
import {
  cleanupRepo,
  commit,
  createSandboxRepoWithRemote,
  type SandboxRepoWithRemote,
} from './helpers.ts';

mock.restore();

/**
 * A cascade that pauses records the resumed branch's new head and fork point in
 * the store. When branches remain behind the pause, the resume hands off to the
 * shared cascade loop, and the loop's own returned stack is what the caller
 * keeps — so an update applied only before the handoff is lost, leaving the
 * store pointing at pre-rebase history for the one branch the human just
 * resolved conflicts on. A later restack resolves that child against a stale
 * anchor, which is the failure the fork-point work exists to prevent.
 */

let repos: string[] = [];

afterEach(async () => {
  await Promise.all(repos.map(cleanupRepo));
  repos = [];
});

/**
 * main advances with a change that conflicts with feat/a, so a sync pauses on
 * feat/a. feat/b sits behind it and only touches its own file.
 *
 *   main:    A - (B conflicting, pushed to origin)
 *             \
 *   feat/a:    edits shared.txt
 *               \
 *   feat/b:      own file only
 */
async function conflictingSyncRepo(
  withChild: boolean,
): Promise<{ repo: SandboxRepoWithRemote; stack: ReturnType<typeof StackManager.createStack> }> {
  const repo = await createSandboxRepoWithRemote();
  repos.push(repo.dir);

  await commit(repo.dir, repo.git, 'shared.txt', 'base\n', 'base commit');
  repo.git('push', 'origin', 'main');

  repo.git('checkout', '-b', 'feat/a');
  const aHead = await commit(repo.dir, repo.git, 'shared.txt', 'feat/a version\n', 'feat/a: edit shared');

  let bHead: string | null = null;
  if (withChild) {
    repo.git('checkout', '-b', 'feat/b');
    bHead = await commit(repo.dir, repo.git, 'b-only.txt', 'b data\n', 'feat/b: own file');
  }

  // main diverges on the same file and is published, so feat/a must rebase onto it
  repo.git('checkout', 'main');
  await commit(repo.dir, repo.git, 'shared.txt', 'main version\n', 'main: diverge');
  repo.git('push', 'origin', 'main');
  repo.git('fetch', 'origin');

  let stack = StackManager.createStack('test-stack', 'main');
  stack = StackManager.addNode(stack, 'feat/a', 'main');
  stack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: aHead });
  if (withChild && bHead) {
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');
    stack = StackManager.updateNode(stack, 'feat/b', { lastKnownHead: bHead });
  }
  return { repo, stack };
}

async function resolveAndContinue(repo: SandboxRepoWithRemote, paused: Awaited<ReturnType<typeof import('../../src/core/rebase-engine.ts').RebaseEngine.syncLocalStack>>) {
  const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');
  await writeFile(join(repo.dir, 'shared.txt'), 'resolved\n', 'utf-8');
  repo.git('add', 'shared.txt');
  return RebaseEngine.continueCascade(repo.dir, paused.updatedStack, paused.pauseInfo!);
}

describe('resumed branch store update survives the handoff to remaining branches', () => {
  test('records the resumed branch new head when branches remain behind it', async () => {
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');
    const { repo, stack } = await conflictingSyncRepo(true);

    const paused = await RebaseEngine.syncLocalStack(repo.dir, stack);
    expect(paused.state).toBe('paused');
    expect(paused.pauseInfo!.currentBranch).toBe('feat/a');
    expect(paused.pauseInfo!.remainingBranches).toEqual(['feat/b']);

    const continued = await resolveAndContinue(repo, paused);
    expect(continued.state).toBe('completed');

    const aHead = await GitShell.getBranchHead(repo.dir, 'feat/a');
    expect(StackManager.findNode(continued.updatedStack, 'feat/a')?.lastKnownHead).toBe(aHead);
  });

  test('records the resumed branch fork point when branches remain behind it', async () => {
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');
    const { repo, stack } = await conflictingSyncRepo(true);

    const paused = await RebaseEngine.syncLocalStack(repo.dir, stack);
    const continued = await resolveAndContinue(repo, paused);
    expect(continued.state).toBe('completed');

    const originMain = await GitShell.getBranchHead(repo.dir, 'origin/main');
    expect(StackManager.findNode(continued.updatedStack, 'feat/a')?.forkPoint).toBe(originMain);
  });

  test('control: with no branches remaining the head is already recorded', async () => {
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');
    const { repo, stack } = await conflictingSyncRepo(false);

    const paused = await RebaseEngine.syncLocalStack(repo.dir, stack);
    expect(paused.pauseInfo!.remainingBranches).toEqual([]);

    const continued = await resolveAndContinue(repo, paused);
    expect(continued.state).toBe('completed');

    const aHead = await GitShell.getBranchHead(repo.dir, 'feat/a');
    expect(StackManager.findNode(continued.updatedStack, 'feat/a')?.lastKnownHead).toBe(aHead);
  });

  test('the remaining branch keeps its own recorded head', async () => {
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');
    const { repo, stack } = await conflictingSyncRepo(true);

    const paused = await RebaseEngine.syncLocalStack(repo.dir, stack);
    const continued = await resolveAndContinue(repo, paused);
    expect(continued.state).toBe('completed');

    const bHead = await GitShell.getBranchHead(repo.dir, 'feat/b');
    expect(StackManager.findNode(continued.updatedStack, 'feat/b')?.lastKnownHead).toBe(bHead);
  });
});
