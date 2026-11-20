import { describe, test, expect, afterEach } from 'bun:test';
import { join, dirname } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createSandboxRepoWithRemote, cleanupRepo } from './helpers.ts';
import type { SandboxRepoWithRemote } from './helpers.ts';
import { reparentBranch } from '../../src/core/reparent.ts';
import { RebaseEngine } from '../../src/core/rebase-engine.ts';
import type { Stack, StackNode } from '../../src/core/types.ts';
import type { GitProvider, PullRequest } from '@mattstack/glance';
import { setConfigDir } from '../../src/core/config-paths.ts';
import { loadStore, saveStore } from '../../src/core/persistence.ts';
import { StackManager } from '../../src/core/stack-manager.ts';
import { createContext } from '../../src/cli/context.ts';
import { syncCommand } from '../../src/cli/commands/cascade.ts';

const cleanups: string[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanupRepo(cleanups.pop()!);
});

function node(branch: string, parent: string, extra: Partial<StackNode> = {}): StackNode {
  return {
    branch, parent, mrIid: null, mrUrl: null, mrTitle: null, status: 'synced',
    lastKnownHead: null, forkPoint: null, diffStats: null, pipelineStatus: 'unknown',
    unresolvedThreads: 0, ...extra,
  };
}

/**
 * main -> feature-a (two commits) -> feature-b -> feature-c. feature-a is
 * squash-merged into origin/main; the local main is left stale, the way it
 * is when nobody has pulled since the merge. feature-b rewrites lines
 * feature-a added, so replaying it onto a trunk without the squash conflicts.
 */
async function squashMergedScenario(): Promise<{
  repo: SandboxRepoWithRemote; stack: Stack; workDir: string; heads: Record<string, string>;
}> {
  const repo = await createSandboxRepoWithRemote();
  cleanups.push(repo.dir, repo.remoteDir);
  const { dir, git } = repo;
  await writeFile(join(dir, 'app.txt'), 'alpha\nbeta\n', 'utf-8');
  git('add', '.');
  git('commit', '-m', 'base');
  git('push', '-u', 'origin', 'main');
  const base = git('rev-parse', 'main');

  git('checkout', '-b', 'feature-a');
  await writeFile(join(dir, 'app.txt'), 'alpha\nbeta\na1\n', 'utf-8');
  git('commit', '-am', 'a: one');
  await writeFile(join(dir, 'app.txt'), 'alpha\nbeta\na1\na2\n', 'utf-8');
  git('commit', '-am', 'a: two');
  const aHead = git('rev-parse', 'HEAD');

  git('checkout', '-b', 'feature-b');
  await writeFile(join(dir, 'app.txt'), 'alpha\nbeta\na1 by B\na2 by B\n', 'utf-8');
  git('commit', '-am', 'b: rework a lines');
  const bHead = git('rev-parse', 'HEAD');

  git('checkout', '-b', 'feature-c');
  await writeFile(join(dir, 'c.txt'), 'c\n', 'utf-8');
  git('add', '.');
  git('commit', '-m', 'c: add c');
  const cHead = git('rev-parse', 'HEAD');

  git('checkout', '--detach', 'main');
  git('merge', '--squash', 'feature-a');
  git('commit', '-m', 'a (squashed)');
  git('push', 'origin', 'HEAD:main');
  git('checkout', 'main');
  git('fetch', 'origin');

  const workDir = join(dirname(dir), `${dir.split('/').pop()}-wt-gitq-1`);
  git('worktree', 'add', '--detach', workDir, 'HEAD');
  cleanups.push(workDir);

  const stack: Stack = {
    id: 's1', stackName: 'sq', root: 'main',
    nodes: [
      node('feature-a', 'main', { status: 'merged', lastKnownHead: aHead, forkPoint: base }),
      node('feature-c', 'feature-b', { lastKnownHead: cHead, forkPoint: bHead }),
      node('feature-b', 'feature-a', { lastKnownHead: bHead, forkPoint: aHead }),
    ],
  };
  return { repo, stack, workDir, heads: { base, a: aHead, b: bHead, c: cHead } };
}

describe('reparent off a squash-merged parent', () => {
  test('lands on the fetched trunk, not the stale local one', async () => {
    const { repo, stack, workDir } = await squashMergedScenario();

    const result = await reparentBranch(repo.dir, stack, 'feature-b', 'main', workDir);

    expect(result.newParent).toBe('main');
    expect(repo.git('rev-parse', 'feature-b^')).toBe(repo.git('rev-parse', 'origin/main'));
    expect(repo.git('log', '--format=%s', 'origin/main..feature-b')).toBe('b: rework a lines');
    expect(repo.git('log', '--format=%s', 'feature-b..feature-c')).toBe('c: add c');
  });

  test('works after the merged parent branch is deleted, replaying from the recorded fork point', async () => {
    const { repo, stack, workDir } = await squashMergedScenario();
    repo.git('branch', '-D', 'feature-a');

    await reparentBranch(repo.dir, stack, 'feature-b', 'main', workDir);

    expect(repo.git('log', '--format=%s', 'origin/main..feature-b')).toBe('b: rework a lines');
    expect(repo.git('log', '--format=%s', 'feature-b..feature-c')).toBe('c: add c');
  });
});

describe('sync with a squash-merged parent', () => {
  test('leaves the merged branch alone and restacks its children onto the trunk', async () => {
    const { repo, stack, workDir, heads } = await squashMergedScenario();

    const result = await RebaseEngine.syncLocalStack(repo.dir, stack, workDir, { noFetch: true });

    expect(result.state).toBe('completed');
    expect(repo.git('rev-parse', 'feature-a')).toBe(heads.a!);
    expect(repo.git('rev-parse', 'feature-b^')).toBe(repo.git('rev-parse', 'origin/main'));
    expect(repo.git('log', '--format=%s', 'origin/main..feature-b')).toBe('b: rework a lines');
    expect(repo.git('log', '--format=%s', 'feature-b..feature-c')).toBe('c: add c');
  });

  test('restacks the children when the merged branch is already deleted', async () => {
    const { repo, stack, workDir } = await squashMergedScenario();
    repo.git('branch', '-D', 'feature-a');

    const result = await RebaseEngine.syncLocalStack(repo.dir, stack, workDir, { noFetch: true });

    expect(result.state).toBe('completed');
    expect(repo.git('log', '--format=%s', 'origin/main..feature-b')).toBe('b: rework a lines');
    expect(repo.git('log', '--format=%s', 'feature-b..feature-c')).toBe('c: add c');
  });
});

/** A store where feature-a is still published as MR !1, the way gitq left it before the merge. */
async function publishedStore(repo: SandboxRepoWithRemote, stack: Stack): Promise<void> {
  const published: Stack = {
    ...stack,
    nodes: stack.nodes.map((n) => (n.branch === 'feature-a' ? { ...n, status: 'synced' as const, mrIid: 1 } : n)),
  };
  const configDir = `${repo.dir}-config`;
  cleanups.push(configDir);
  setConfigDir(configDir);
  await saveStore(repo.dir, { repoPath: repo.dir, remoteUrl: 'https://gitlab.com/acme/app.git', stacks: [published] });
}

function mergedMR(sha: string, iid = 1, sourceBranch = 'feature-a'): PullRequest {
  return {
    iid, state: 'merged', sourceBranch, targetBranch: 'main', sha,
    title: 'a', webUrl: `https://gitlab.com/acme/app/-/merge_requests/${iid}`,
    pipeline: null, unresolvedThreadCount: 0, diffStats: null,
  } as unknown as PullRequest;
}

/** A provider that answers only an iid read scoped to acme/app. */
function iidProvider(prs: PullRequest[], calls: unknown[] = []): GitProvider {
  return {
    fetchPullRequests: (opts: { projectPath?: string; iids?: number[] } = {}) => {
      calls.push(opts);
      if (opts.projectPath !== 'acme/app' || !opts.iids) return Promise.reject(new Error('unscoped read'));
      return Promise.resolve(prs.filter((p) => opts.iids!.includes(p.iid)));
    },
  } as unknown as GitProvider;
}

async function runSync(repo: SandboxRepoWithRemote, provider: GitProvider, flags: Record<string, string | boolean> = {}): Promise<number> {
  const ctx = await createContext(repo.dir, [], { stack: 'sq', ...flags });
  try {
    return await syncCommand(ctx, {
      createForgeProvider: () => Promise.resolve({ provider, projectPath: 'acme/app' }),
    });
  } finally {
    const slots = repo.git('worktree', 'list', '--porcelain').split('\n')
      .filter((l) => l.startsWith('worktree ')).map((l) => l.slice('worktree '.length))
      .filter((p) => p !== repo.dir);
    cleanups.push(...slots);
  }
}

describe('gitq sync reads merged MRs from the forge', () => {
  test('marks the squash-merged parent merged and restacks its children past it', async () => {
    const { repo, stack, heads } = await squashMergedScenario();
    await publishedStore(repo, stack);
    const calls: unknown[] = [];

    const code = await runSync(repo, iidProvider([mergedMR(heads.a!)], calls));

    expect(code).toBe(0);
    expect(calls).toEqual([{ projectPath: 'acme/app', iids: [1] }]);
    const saved = (await loadStore(repo.dir)).stacks[0]!;
    expect(StackManager.findNode(saved, 'feature-a')!.status).toBe('merged');
    expect(repo.git('rev-parse', 'feature-a')).toBe(heads.a!);
    expect(repo.git('log', '--format=%s', 'origin/main..feature-b')).toBe('b: rework a lines');
    expect(repo.git('log', '--format=%s', 'feature-b..feature-c')).toBe('c: add c');
  });

  test('a branch with commits after its MR merged is not marked merged', async () => {
    const { repo, stack, heads } = await squashMergedScenario();
    repo.git('checkout', 'feature-a');
    await writeFile(join(repo.dir, 'late.txt'), 'late\n', 'utf-8');
    repo.git('add', '.');
    repo.git('commit', '-m', 'a: after the merge');
    repo.git('checkout', 'main');
    await publishedStore(repo, stack);

    await runSync(repo, iidProvider([mergedMR(heads.a!)]));

    const saved = (await loadStore(repo.dir)).stacks[0]!;
    expect(StackManager.findNode(saved, 'feature-a')!.status).not.toBe('merged');
  });

  test('a node with no recorded MR is never matched to a merged MR by branch name', async () => {
    const { repo, stack, heads } = await squashMergedScenario();
    await publishedStore(repo, stack);
    const calls: unknown[] = [];

    await runSync(repo, iidProvider([mergedMR(heads.b!, 7, 'feature-b')], calls));

    const saved = (await loadStore(repo.dir)).stacks[0]!;
    expect(StackManager.findNode(saved, 'feature-b')!.status).not.toBe('merged');
    expect(calls).toEqual([{ projectPath: 'acme/app', iids: [1] }]);
  });

  test('an unreadable forge leaves the stack as stored and still restacks', async () => {
    const { repo, stack } = await squashMergedScenario();
    await publishedStore(repo, stack);
    const failing = { fetchPullRequests: () => Promise.reject(new Error('503')) } as unknown as GitProvider;

    const code = await runSync(repo, failing);

    expect(code).not.toBe(1);
    const saved = (await loadStore(repo.dir)).stacks[0]!;
    expect(StackManager.findNode(saved, 'feature-a')!.status).toBe('synced');
  });

  test('--no-fetch does not read the forge', async () => {
    const { repo, stack, heads } = await squashMergedScenario();
    await publishedStore(repo, stack);
    const calls: unknown[] = [];

    await runSync(repo, iidProvider([mergedMR(heads.a!)], calls), { 'no-fetch': true });

    expect(calls).toEqual([]);
  });
});
