import { describe, test, expect, afterEach } from 'bun:test';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createSandboxRepoWithRemote, cleanupRepo } from './helpers.ts';
import type { SandboxRepoWithRemote } from './helpers.ts';
import { RebaseEngine } from '../../src/core/rebase-engine.ts';
import type { Stack, StackNode } from '../../src/core/types.ts';

/**
 * Regression tests from the 2026-07-24 live gauntlet: sync's conflict
 * protocol worked, but preflight predicted against the stale local trunk,
 * a resumed cascade re-replayed the parent's pre-rebase commit into the
 * child's range, and a remaining sibling skipped its rebase entirely
 * because the resume path targeted the local trunk.
 */

const cleanups: string[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanupRepo(cleanups.pop()!);
});

function trackRepo(repo: SandboxRepoWithRemote): SandboxRepoWithRemote {
  cleanups.push(repo.dir, repo.remoteDir);
  return repo;
}

function node(branch: string, parent: string): StackNode {
  return {
    branch,
    parent,
    mrIid: null,
    mrUrl: null,
    mrTitle: null,
    status: 'local-only',
    lastKnownHead: null,
    forkPoint: null,
    diffStats: null,
    pipelineStatus: 'unknown',
    unresolvedThreads: 0,
  };
}

/**
 * A parent/child stack where origin/main has moved with a commit that
 * conflicts with the parent's commit, while the LOCAL main never moves
 * (gitq never touches trunk). The child adds an unrelated file.
 */
async function parentChildConflictScenario(): Promise<{ repo: SandboxRepoWithRemote; stack: Stack }> {
  const repo = trackRepo(await createSandboxRepoWithRemote());
  const { dir, git } = repo;
  await writeFile(join(dir, 'app.txt'), 'alpha\nbeta\ngamma\n', 'utf-8');
  git('add', '.');
  git('commit', '-m', 'base app');
  git('push', '-u', 'origin', 'main');

  git('checkout', '-b', 'feature-a');
  await writeFile(join(dir, 'app.txt'), 'alpha\nbeta improved by A\ngamma\n', 'utf-8');
  git('commit', '-am', 'a: improve beta');

  git('checkout', '-b', 'feature-b');
  await writeFile(join(dir, 'widget.txt'), 'widget\n', 'utf-8');
  git('add', '.');
  git('commit', '-m', 'b: add widget');

  git('checkout', 'main');
  git('checkout', '-b', 'upstream');
  await writeFile(join(dir, 'app.txt'), 'alpha\nbeta reworked upstream\ngamma\n', 'utf-8');
  git('commit', '-am', 'upstream: rework beta');
  git('push', 'origin', 'upstream:main');
  git('checkout', 'main');
  git('branch', '-D', 'upstream');

  const stack: Stack = {
    id: 's1',
    stackName: 'demo',
    root: 'main',
    nodes: [node('feature-a', 'main'), node('feature-b', 'feature-a')],
  };
  return { repo, stack };
}

describe('preflight against the fetched origin root', () => {
  test('predicts the conflict sync will hit, not the stale local trunk view', async () => {
    const { repo, stack } = await parentChildConflictScenario();
    repo.git('fetch', 'origin');

    const report = await RebaseEngine.preflight(repo.dir, stack, ['feature-a', 'feature-b']);

    expect(report.conflictBranches.map((c) => c.branch)).toContain('feature-a');
    const files = report.conflictBranches.find((c) => c.branch === 'feature-a')!.files;
    expect(files.some((f) => f.file === 'app.txt')).toBe(true);
  });
});

describe('continue after a resolved parent conflict', () => {
  test('does not re-replay the parent commit into the child branch', async () => {
    const { repo, stack } = await parentChildConflictScenario();

    const syncRes = await RebaseEngine.syncLocalStack(repo.dir, stack);
    expect(syncRes.state).toBe('paused');
    expect(syncRes.pauseInfo!.currentBranch).toBe('feature-a');

    // Resolve preserving BOTH intents: the resulting commit content differs
    // from the original a-commit, which is exactly what makes a re-replayed
    // stale copy conflict instead of auto-dropping.
    await writeFile(join(repo.dir, 'app.txt'), 'alpha\nbeta reworked upstream, improved by A\ngamma\n', 'utf-8');
    repo.git('add', 'app.txt');

    const contRes = await RebaseEngine.continueCascade(repo.dir, syncRes.updatedStack, syncRes.pauseInfo!);

    expect(contRes.state).toBe('completed');
    // The child holds exactly its own commit, sitting on the parent's new head.
    expect(repo.git('rev-parse', 'feature-b^')).toBe(repo.git('rev-parse', 'feature-a'));
    expect(repo.git('log', '--format=%s', 'feature-a..feature-b')).toBe('b: add widget');
  });
});

describe('siblings remaining after a pause', () => {
  test('still rebase onto the fetched origin root, not the local trunk', async () => {
    const repo = trackRepo(await createSandboxRepoWithRemote());
    const { dir, git } = repo;
    await writeFile(join(dir, 'app.txt'), 'alpha\nbeta\ngamma\n', 'utf-8');
    git('add', '.');
    git('commit', '-m', 'base app');
    git('push', '-u', 'origin', 'main');

    git('checkout', '-b', 'feature-a');
    await writeFile(join(dir, 'app.txt'), 'alpha\nbeta improved by A\ngamma\n', 'utf-8');
    git('commit', '-am', 'a: improve beta');

    git('checkout', 'main');
    git('checkout', '-b', 'feature-c');
    await writeFile(join(dir, 'c.txt'), 'c\n', 'utf-8');
    git('add', '.');
    git('commit', '-m', 'c: add c');

    git('checkout', 'main');
    git('checkout', '-b', 'upstream');
    await writeFile(join(dir, 'app.txt'), 'alpha\nbeta reworked upstream\ngamma\n', 'utf-8');
    git('commit', '-am', 'upstream: rework beta');
    git('push', 'origin', 'upstream:main');
    git('checkout', 'main');
    git('branch', '-D', 'upstream');

    const stack: Stack = {
      id: 's2',
      stackName: 'siblings',
      root: 'main',
      nodes: [node('feature-a', 'main'), node('feature-c', 'main')],
    };

    const syncRes = await RebaseEngine.syncLocalStack(repo.dir, stack);
    expect(syncRes.state).toBe('paused');
    expect(syncRes.pauseInfo!.currentBranch).toBe('feature-a');
    expect(syncRes.pauseInfo!.remainingBranches).toEqual(['feature-c']);

    await writeFile(join(dir, 'app.txt'), 'alpha\nbeta reworked upstream, improved by A\ngamma\n', 'utf-8');
    git('add', 'app.txt');

    const contRes = await RebaseEngine.continueCascade(repo.dir, syncRes.updatedStack, syncRes.pauseInfo!);

    expect(contRes.state).toBe('completed');
    expect(repo.git('rev-parse', 'feature-c^')).toBe(repo.git('rev-parse', 'origin/main'));
  });
});

describe('pause reporting', () => {
  test('a pause on a child branch reports the actual rebase target', async () => {
    const repo = trackRepo(await createSandboxRepoWithRemote());
    const { dir, git } = repo;
    await writeFile(join(dir, 'app.txt'), 'alpha\nbeta\ngamma\n', 'utf-8');
    await writeFile(join(dir, 'notes.txt'), 'n1\n', 'utf-8');
    git('add', '.');
    git('commit', '-m', 'base app and notes');
    git('push', '-u', 'origin', 'main');

    git('checkout', '-b', 'feature-a');
    await writeFile(join(dir, 'app.txt'), 'alpha\nbeta improved by A\ngamma\n', 'utf-8');
    git('commit', '-am', 'a: improve beta');

    git('checkout', '-b', 'feature-b');
    await writeFile(join(dir, 'notes.txt'), 'n1 by B\n', 'utf-8');
    git('commit', '-am', 'b: edit notes');

    git('checkout', 'main');
    git('checkout', '-b', 'upstream');
    await writeFile(join(dir, 'app.txt'), 'alpha\nbeta reworked upstream\ngamma\n', 'utf-8');
    await writeFile(join(dir, 'notes.txt'), 'n1 upstream\n', 'utf-8');
    git('commit', '-am', 'upstream: rework beta and notes');
    git('push', 'origin', 'upstream:main');
    git('checkout', 'main');
    git('branch', '-D', 'upstream');

    const stack: Stack = {
      id: 's3',
      stackName: 'childpause',
      root: 'main',
      nodes: [node('feature-a', 'main'), node('feature-b', 'feature-a')],
    };

    const syncRes = await RebaseEngine.syncLocalStack(repo.dir, stack);
    expect(syncRes.state).toBe('paused');
    expect(syncRes.pauseInfo!.currentBranch).toBe('feature-a');
    expect(syncRes.pauseInfo!.currentTarget).toBe('origin/main');

    await writeFile(join(dir, 'app.txt'), 'alpha\nbeta reworked upstream, improved by A\ngamma\n', 'utf-8');
    git('add', 'app.txt');

    const contRes = await RebaseEngine.continueCascade(repo.dir, syncRes.updatedStack, syncRes.pauseInfo!);

    // feature-b genuinely conflicts on notes.txt (its own edit vs upstream's).
    expect(contRes.state).toBe('paused');
    expect(contRes.pauseInfo!.currentBranch).toBe('feature-b');
    expect(contRes.pauseInfo!.currentTarget).toBe('feature-a');

    await writeFile(join(dir, 'notes.txt'), 'n1 upstream, by B\n', 'utf-8');
    git('add', 'notes.txt');
    const finalRes = await RebaseEngine.continueCascade(repo.dir, contRes.updatedStack, contRes.pauseInfo!);
    expect(finalRes.state).toBe('completed');
    expect(repo.git('rev-parse', 'feature-b^')).toBe(repo.git('rev-parse', 'feature-a'));
  });
});
