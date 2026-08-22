import { afterEach, describe, expect, mock, test } from 'bun:test';
import { StackManager } from '../../src/core/stack-manager.ts';
import { createSandboxRepo, cleanupRepo, commit, type SandboxRepo } from './helpers.ts';

mock.restore();

/**
 * A parent rewritten OUTSIDE a cascade — `commit --amend`, `reset --hard` plus
 * a fresh commit, a hand-run `git rebase` between gitq invocations — is the
 * case no `preRebaseHeads` entry covers, because nothing in the run recorded
 * the pre-rewrite head. The stored `lastKnownHead` is the only remaining
 * record of where the child forked.
 *
 * Both cascades below rebuild the same shape:
 *
 *   main:        A - B
 *                     \
 *   feat/base:         C - D          (D rewritten to D' out of band)
 *                           \
 *   feat/child:              E - F
 *
 * D and D' touch the same file with different content, so a range that
 * wrongly starts below D replays D onto D' and conflicts, rather than
 * dropping silently by patch id.
 */

let repos: string[] = [];

afterEach(async () => {
  await Promise.all(repos.map(cleanupRepo));
  repos = [];
});

async function buildRewrittenParentRepo(): Promise<{
  repo: SandboxRepo;
  storedBaseHead: string;
  childCommitCount: number;
}> {
  const repo = await createSandboxRepo();
  repos.push(repo.dir);

  await commit(repo.dir, repo.git, 'file-a.txt', 'commit A\n', 'commit A');
  await commit(repo.dir, repo.git, 'file-b.txt', 'commit B\n', 'commit B');

  repo.git('checkout', '-b', 'feat/base');
  const cSha = await commit(repo.dir, repo.git, 'file-c.txt', 'commit C\n', 'commit C');
  const storedBaseHead = await commit(
    repo.dir,
    repo.git,
    'file-d.txt',
    'commit D\n',
    'commit D',
  );

  repo.git('checkout', '-b', 'feat/child');
  await commit(repo.dir, repo.git, 'file-e.txt', 'commit E\n', 'commit E');
  await commit(repo.dir, repo.git, 'file-f.txt', 'commit F\n', 'commit F');

  // The out-of-band rewrite: D is replaced by a D' that edits the same file.
  repo.git('checkout', 'feat/base');
  repo.git('reset', '--hard', cSha);
  await commit(repo.dir, repo.git, 'file-d.txt', 'commit D prime\n', 'commit D prime');

  repo.git('checkout', 'main');

  return { repo, storedBaseHead, childCommitCount: 2 };
}

function stackWithStoredHead(storedBaseHead: string) {
  let stack = StackManager.createStack('test-stack', 'main');
  stack = StackManager.addNode(stack, 'feat/base', 'main');
  stack = StackManager.updateNode(stack, 'feat/base', { lastKnownHead: storedBaseHead });
  stack = StackManager.addNode(stack, 'feat/child', 'feat/base');
  return stack;
}

describe('cascading over a parent rewritten outside the cascade', () => {
  test('restackFrom replays only the child commits, not the parent pre-rewrite one', async () => {
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');
    const { repo, storedBaseHead, childCommitCount } = await buildRewrittenParentRepo();

    const result = await RebaseEngine.restackFrom(
      repo.dir,
      stackWithStoredHead(storedBaseHead),
      'feat/base',
    );

    expect(result.state).toBe('completed');
    expect(result.results.every((r) => r.success)).toBe(true);

    // The child must sit on the rewritten parent, carrying its own two
    // commits and no copy of the pre-rewrite D.
    const childLog = repo.git('log', '--format=%s', 'feat/base..feat/child').split('\n');
    expect(childLog).toEqual(['commit F', 'commit E']);
    expect(childLog).toHaveLength(childCommitCount);
    expect(repo.git('log', '--format=%s', 'feat/child')).toContain('commit D prime');
    expect(repo.git('log', '--format=%s', 'feat/base..feat/child')).not.toContain('commit D');
  });

  test('the stored lastKnownHead is what anchors it: without one, the range falls too far back', async () => {
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');
    const { repo } = await buildRewrittenParentRepo();

    // Same stack, but gitq never recorded where the child forked. There is
    // nothing left to distinguish the parent's pre-rewrite commit from the
    // child's own, so the cascade cannot help but conflict on it. This pins
    // that the fix reads the stored head rather than getting lucky.
    let stack = StackManager.createStack('test-stack', 'main');
    stack = StackManager.addNode(stack, 'feat/base', 'main');
    stack = StackManager.addNode(stack, 'feat/child', 'feat/base');

    const result = await RebaseEngine.restackFrom(repo.dir, stack, 'feat/base');

    expect(result.state).not.toBe('completed');
  });

  test('a cascade that skips a node still catches its recorded head up', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');
    const repo = await createSandboxRepo();
    repos.push(repo.dir);

    await commit(repo.dir, repo.git, 'file-a.txt', 'commit A\n', 'commit A');
    repo.git('checkout', '-b', 'feat/base');
    await commit(repo.dir, repo.git, 'file-c.txt', 'commit C\n', 'commit C');
    repo.git('checkout', '-b', 'feat/child');
    await commit(repo.dir, repo.git, 'file-e.txt', 'commit E\n', 'commit E');
    repo.git('checkout', 'main');

    // Already correctly stacked, so every node skips — but the store still
    // holds heads from some earlier state, the shape a hand-run rebase leaves
    // behind. Left uncorrected, those stale anchors are what a later
    // out-of-band rewrite would be resolved against.
    let stack = StackManager.createStack('test-stack', 'main');
    stack = StackManager.addNode(stack, 'feat/base', 'main');
    stack = StackManager.updateNode(stack, 'feat/base', { lastKnownHead: 'staleaaa' });
    stack = StackManager.addNode(stack, 'feat/child', 'feat/base');
    stack = StackManager.updateNode(stack, 'feat/child', { lastKnownHead: 'stalebbb' });

    const result = await RebaseEngine.restackFrom(repo.dir, stack, 'feat/base');

    expect(result.state).toBe('completed');
    const childHead = await GitShell.getBranchHead(repo.dir, 'feat/child');
    expect(
      StackManager.findNode(result.updatedStack, 'feat/child')?.lastKnownHead,
    ).toBe(childHead);
  });

  test('a grandchild rides the cascade: recovered fork point, then in-cascade heads', async () => {
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');
    const repo = await createSandboxRepo();
    repos.push(repo.dir);

    await commit(repo.dir, repo.git, 'file-a.txt', 'commit A\n', 'commit A');

    repo.git('checkout', '-b', 'feat/base');
    const cSha = await commit(repo.dir, repo.git, 'file-c.txt', 'commit C\n', 'commit C');
    const storedBaseHead = await commit(
      repo.dir,
      repo.git,
      'file-d.txt',
      'commit D\n',
      'commit D',
    );

    repo.git('checkout', '-b', 'feat/child');
    await commit(repo.dir, repo.git, 'file-e.txt', 'commit E\n', 'commit E');

    repo.git('checkout', '-b', 'feat/grandchild');
    await commit(repo.dir, repo.git, 'file-g.txt', 'commit G\n', 'commit G');

    repo.git('checkout', 'feat/base');
    repo.git('reset', '--hard', cSha);
    await commit(repo.dir, repo.git, 'file-d.txt', 'commit D prime\n', 'commit D prime');
    repo.git('checkout', 'main');

    let stack = StackManager.createStack('test-stack', 'main');
    stack = StackManager.addNode(stack, 'feat/base', 'main');
    stack = StackManager.updateNode(stack, 'feat/base', { lastKnownHead: storedBaseHead });
    stack = StackManager.addNode(stack, 'feat/child', 'feat/base');
    stack = StackManager.addNode(stack, 'feat/grandchild', 'feat/child');

    const result = await RebaseEngine.restackFrom(repo.dir, stack, 'feat/base');

    expect(result.state).toBe('completed');
    // The child's base came from the recovered fork point; the grandchild's
    // came from the child's in-cascade pre-rebase head. Both must yield
    // exactly one own commit and one copy of the rewrite beneath them.
    expect(repo.git('log', '--format=%s', 'feat/base..feat/child').split('\n')).toEqual([
      'commit E',
    ]);
    expect(repo.git('log', '--format=%s', 'feat/child..feat/grandchild').split('\n')).toEqual([
      'commit G',
    ]);
    const grandchildLog = repo.git('log', '--format=%s', 'feat/grandchild').split('\n');
    expect(grandchildLog.filter((s) => s === 'commit D prime')).toHaveLength(1);
    expect(grandchildLog).not.toContain('commit D');
  });
});
