import { afterEach, describe, expect, mock, test } from 'bun:test';
import { StackManager } from '../../src/core/stack-manager.ts';
import { cleanupRepo, commit, createSandboxRepo, type SandboxRepo } from './helpers.ts';

mock.restore();

/**
 * A child whose parent was REWRITTEN between the child's last restack and the
 * current cascade has no usable merge-base: every candidate collapses to the
 * trunk fork, so the replay range sweeps the parent's whole pre-rewrite chain
 * into the child's rebase. Patch-id auto-drop absorbs the identical commits,
 * but any commit whose content drifted during the rewrite conflicts spuriously.
 *
 * Shape used throughout (the drifted-sweep shape):
 *
 *   main:        A
 *                 \
 *   feat/base:    T1 - T2          rewritten to  T1 - T2'  (T2' drifts)
 *                       \
 *   feat/child:          E
 *
 * T1 survives the rewrite patch-identical (cherry-picked), T2 drifts. A range
 * that wrongly starts at A replays T1 (drops) then T2 (conflicts with T2').
 */

let repos: string[] = [];

afterEach(async () => {
  await Promise.all(repos.map(cleanupRepo));
  repos = [];
});

async function buildDriftedSweepRepo(): Promise<{ repo: SandboxRepo; forkSha: string }> {
  const repo = await createSandboxRepo();
  repos.push(repo.dir);

  await commit(repo.dir, repo.git, 'file-a.txt', 'commit A\n', 'commit A');

  repo.git('checkout', '-b', 'feat/base');
  const t1Sha = await commit(repo.dir, repo.git, 'file-t1.txt', 'commit T1\n', 'commit T1');
  const forkSha = await commit(repo.dir, repo.git, 'file-t2.txt', 'commit T2\n', 'commit T2');

  repo.git('checkout', '-b', 'feat/child');
  await commit(repo.dir, repo.git, 'file-e.txt', 'commit E\n', 'commit E');

  // The rewrite: T1 survives patch-identical, T2 is replaced by a drifted T2'.
  repo.git('checkout', 'feat/base');
  repo.git('reset', '--hard', 'main');
  repo.git('cherry-pick', t1Sha);
  await commit(repo.dir, repo.git, 'file-t2.txt', 'commit T2 prime\n', 'commit T2 prime');

  repo.git('checkout', 'main');
  return { repo, forkSha };
}

function sweepStack(forkPoint: string | null) {
  let stack = StackManager.createStack('test-stack', 'main');
  stack = StackManager.addNode(stack, 'feat/base', 'main');
  stack = StackManager.addNode(stack, 'feat/child', 'feat/base');
  if (forkPoint) {
    stack = StackManager.updateNode(stack, 'feat/child', { forkPoint });
  }
  return stack;
}

describe('stored forkPoint recovery', () => {
  test('a recorded forkPoint rescues the child across a rewritten parent', async () => {
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');
    const { repo, forkSha } = await buildDriftedSweepRepo();

    const result = await RebaseEngine.restackFrom(repo.dir, sweepStack(forkSha), 'feat/base');

    expect(result.state).toBe('completed');
    expect(result.results.every((r) => r.success)).toBe(true);
    const childLog = repo.git('log', '--format=%s', 'feat/base..feat/child').split('\n');
    expect(childLog).toEqual(['commit E']);
  });

  test('a successful cascade records the child forkPoint at the new base', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');
    const { repo, forkSha } = await buildDriftedSweepRepo();

    const result = await RebaseEngine.restackFrom(repo.dir, sweepStack(forkSha), 'feat/base');

    expect(result.state).toBe('completed');
    const baseHead = await GitShell.getBranchHead(repo.dir, 'feat/base');
    expect(StackManager.findNode(result.updatedStack, 'feat/child')?.forkPoint).toBe(baseHead);
  });

  test('a skipped node catches its recorded forkPoint up like lastKnownHead', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');
    const repo = await createSandboxRepo();
    repos.push(repo.dir);

    await commit(repo.dir, repo.git, 'file-a.txt', 'commit A\n', 'commit A');
    repo.git('checkout', '-b', 'feat/base');
    await commit(repo.dir, repo.git, 'file-t1.txt', 'commit T1\n', 'commit T1');
    repo.git('checkout', '-b', 'feat/child');
    await commit(repo.dir, repo.git, 'file-e.txt', 'commit E\n', 'commit E');
    repo.git('checkout', 'main');

    const result = await RebaseEngine.restackFrom(repo.dir, sweepStack(null), 'feat/base');

    expect(result.state).toBe('completed');
    const baseHead = await GitShell.getBranchHead(repo.dir, 'feat/base');
    expect(StackManager.findNode(result.updatedStack, 'feat/child')?.forkPoint).toBe(baseHead);
  });
});

describe('unrecoverable fork point refuses instead of conflicting', () => {
  test('sweep with drifted duplicates fails fast with a fork-point error, branch untouched', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');
    const { repo } = await buildDriftedSweepRepo();
    const childHeadBefore = await GitShell.getBranchHead(repo.dir, 'feat/child');

    const result = await RebaseEngine.restackFrom(repo.dir, sweepStack(null), 'feat/base');

    expect(result.state).toBe('completed');
    const childResult = result.results.find((r) => r.branch === 'feat/child');
    expect(childResult?.success).toBe(false);
    expect(childResult?.error).toMatch(/fork point/i);
    expect(await GitShell.getBranchHead(repo.dir, 'feat/child')).toBe(childHeadBefore);
    expect(repo.git('status', '--porcelain')).toBe('');
  });
});

describe('preflight fork-point warnings', () => {
  test('warns about a child whose fork point cannot be recovered', async () => {
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');
    const { repo } = await buildDriftedSweepRepo();

    const report = await RebaseEngine.preflight(repo.dir, sweepStack(null), [
      'feat/base',
      'feat/child',
    ]);

    expect(report.forkPointWarnings).toEqual([{ branch: 'feat/child', parent: 'feat/base' }]);
  });

  test('a recorded forkPoint silences the warning', async () => {
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');
    const { repo, forkSha } = await buildDriftedSweepRepo();

    const report = await RebaseEngine.preflight(repo.dir, sweepStack(forkSha), [
      'feat/base',
      'feat/child',
    ]);

    expect(report.forkPointWarnings).toEqual([]);
  });

  test('a correctly stacked child produces no warning', async () => {
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');
    const repo = await createSandboxRepo();
    repos.push(repo.dir);

    await commit(repo.dir, repo.git, 'file-a.txt', 'commit A\n', 'commit A');
    repo.git('checkout', '-b', 'feat/base');
    await commit(repo.dir, repo.git, 'file-t1.txt', 'commit T1\n', 'commit T1');
    repo.git('checkout', '-b', 'feat/child');
    await commit(repo.dir, repo.git, 'file-e.txt', 'commit E\n', 'commit E');
    repo.git('checkout', 'main');

    const report = await RebaseEngine.preflight(repo.dir, sweepStack(null), [
      'feat/base',
      'feat/child',
    ]);

    expect(report.forkPointWarnings).toEqual([]);
  });
});
