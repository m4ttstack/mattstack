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

describe('gitq sync reads merged MRs from the forge', () => {
  test('marks the squash-merged parent merged and restacks its children past it', async () => {
    const { repo, stack, heads } = await squashMergedScenario();
    const published: Stack = {
      ...stack,
      nodes: stack.nodes.map((n) => (n.branch === 'feature-a' ? { ...n, status: 'synced' as const } : n)),
    };
    const configDir = `${repo.dir}-config`;
    cleanups.push(configDir);
    setConfigDir(configDir);
    await saveStore(repo.dir, { repoPath: repo.dir, remoteUrl: 'https://gitlab.com/acme/app.git', stacks: [published] });

    const mergedMR = {
      iid: 1, state: 'merged', sourceBranch: 'feature-a', targetBranch: 'main', sha: heads.a,
      title: 'a', webUrl: 'https://gitlab.com/acme/app/-/merge_requests/1',
      pipeline: null, unresolvedThreadCount: 0, diffStats: null,
    } as unknown as PullRequest;
    const provider = {
      fetchPullRequests: () => Promise.resolve([mergedMR]),
      fetchSingleMR: () => Promise.resolve(null),
    } as unknown as GitProvider;

    const ctx = await createContext(repo.dir, [], { stack: 'sq' });
    let code: number;
    try {
      code = await syncCommand(ctx, {
        createForgeProvider: () => Promise.resolve({ provider, projectPath: 'acme/app' }),
      });
    } finally {
      const slots = repo.git('worktree', 'list', '--porcelain').split('\n')
        .filter((l) => l.startsWith('worktree ')).map((l) => l.slice('worktree '.length))
        .filter((p) => p !== repo.dir);
      cleanups.push(...slots);
    }

    expect(code).toBe(0);
    const saved = (await loadStore(repo.dir)).stacks[0]!;
    expect(StackManager.findNode(saved, 'feature-a')!.status).toBe('merged');
    expect(repo.git('rev-parse', 'feature-a')).toBe(heads.a!);
    expect(repo.git('log', '--format=%s', 'origin/main..feature-b')).toBe('b: rework a lines');
    expect(repo.git('log', '--format=%s', 'feature-b..feature-c')).toBe('c: add c');
  });
});
