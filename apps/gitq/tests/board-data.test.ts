import { describe, test, expect } from 'bun:test';
import { fetchMrsByBranch, parseActionBody, resolveRepoProvider, shapeActivity, shapeStack } from '../src/server/data.ts';
import type { BoardMr } from '../src/server/data.ts';
import type { Stack, StackNode, StackStore } from '../src/core/types.ts';
import type { ForgeOverrides } from '../src/core/forges.ts';
import type { GitProvider, PullRequest } from '@workforge/glance-sdk';
import type { NodeDirective } from '../src/core/stack-diagnostics.ts';
import type { OperationEntry } from '../src/core/operation-log.ts';
import type { RepoEntry } from '../src/server/config.ts';

function makeNode(branch: string, parent: string, extra: Partial<StackNode> = {}): StackNode {
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
    ...extra,
  };
}

const STACK: Stack = {
  id: 'id1',
  stackName: 'mystack',
  root: 'main',
  nodes: [makeNode('a', 'main'), makeNode('b', 'a', { mrIid: 12, mrUrl: 'https://x/mr/12', mrTitle: 'stored', pipelineStatus: 'success' })],
};

function directive(branch: string): NodeDirective {
  return {
    branch,
    situation: 'behind-parent',
    statusLine: 'behind its parent',
    badge: { label: 'Behind', variant: 'caution' },
    primaryAction: null,
    secondaryActions: [],
    blocked: null,
    removal: { allowed: true },
  };
}

function entry(id: string, timestamp: number, repoPath?: string): OperationEntry {
  return { id, timestamp, operation: 'sync', commands: [], branchSnapshots: { a: 'sha1' }, stackSnapshot: STACK, ...(repoPath ? { repoPath } : {}) };
}

describe('shapeStack', () => {
  test('maps directives onto nodes and defaults missing ones to synced', () => {
    const shaped = shapeStack(STACK, new Map([['a', directive('a')]]), null, [], [], new Map());
    expect(shaped.stackName).toBe('mystack');
    expect(shaped.root).toBe('main');
    expect(shaped.nodes[0]!).toMatchObject({
      branch: 'a',
      parent: 'main',
      situation: 'behind-parent',
      statusLine: 'behind its parent',
      badge: { label: 'Behind', variant: 'caution' },
    });
    expect(shaped.nodes[1]!.situation).toBe('synced');
    expect(shaped.nodes[1]!.badge).toBeNull();
  });

  test('live MR data wins; stored node fields are the fallback', () => {
    const live: BoardMr = { iid: 99, url: 'https://x/mr/99', title: 'live', state: 'opened', pipelineStatus: 'running' };
    const shaped = shapeStack(STACK, new Map(), null, [], [], new Map([['b', live]]));
    expect(shaped.nodes[1]!.mr).toEqual(live);
    const offline = shapeStack(STACK, new Map(), null, [], [], new Map());
    expect(offline.nodes[1]!.mr).toEqual({ iid: 12, url: 'https://x/mr/12', title: 'stored', state: 'unknown', pipelineStatus: 'success' });
    expect(offline.nodes[0]!.mr).toBeNull();
  });
});

describe('shapeActivity', () => {
  test('filters by repo (legacy entries without repoPath match), sorts desc, limits', () => {
    const entries = [entry('e1', 100, '/repo'), entry('e2', 300), entry('e3', 200, '/other'), entry('e4', 400, '/repo')];
    const shaped = shapeActivity(entries, '/repo');
    expect(shaped.map((e) => e.id)).toEqual(['e4', 'e2', 'e1']);
    expect(shaped[0]!).toMatchObject({ operation: 'sync', stackName: 'mystack', branches: ['a'] });
    expect(shapeActivity(entries, '/repo', 2).length).toBe(2);
  });
});

describe('parseActionBody', () => {
  const REPOS = [{ path: '/repo', name: 'repo' }];

  test('accepts a valid body', () => {
    expect(parseActionBody({ repoPath: '/repo', stack: 's', action: 'sync' }, REPOS)).toEqual({
      repoPath: '/repo',
      stack: 's',
      action: 'sync',
    });
  });

  test('rejects unknown actions, unconfigured repos, and bad shapes', () => {
    expect(parseActionBody({ repoPath: '/repo', stack: 's', action: 'rebase' }, REPOS)).toBeNull();
    expect(parseActionBody({ repoPath: '/nope', stack: 's', action: 'sync' }, REPOS)).toBeNull();
    expect(parseActionBody({ repoPath: '/repo', stack: '', action: 'sync' }, REPOS)).toBeNull();
    expect(parseActionBody('junk', REPOS)).toBeNull();
    expect(parseActionBody(null, REPOS)).toBeNull();
  });
});

describe('parseActionBody sourceSlot', () => {
  const repos = [{ path: '/repo/a', name: 'a' }] as RepoEntry[];

  test('accepts sourceSlot for absorb', () => {
    const parsed = parseActionBody(
      { repoPath: '/repo/a', stack: 's', action: 'absorb', sourceSlot: '/repo/a-pool/tonks' },
      repos,
    );
    expect(parsed?.sourceSlot).toBe('/repo/a-pool/tonks');
  });

  test('rejects sourceSlot on non-absorb actions', () => {
    expect(
      parseActionBody({ repoPath: '/repo/a', stack: 's', action: 'sync', sourceSlot: '/x' }, repos),
    ).toBeNull();
  });

  test('rejects a non-string sourceSlot', () => {
    expect(
      parseActionBody({ repoPath: '/repo/a', stack: 's', action: 'absorb', sourceSlot: 5 }, repos),
    ).toBeNull();
  });

  test('absent sourceSlot still parses', () => {
    expect(parseActionBody({ repoPath: '/repo/a', stack: 's', action: 'absorb' }, repos)).not.toBeNull();
  });
});

describe('shapeStack worktree columns', () => {
  const ONE_NODE_STACK: Stack = {
    id: 'id2',
    stackName: 'onestack',
    root: 'main',
    nodes: [makeNode('feature-a', 'main')],
  };

  test('marks nodes with their checkout slot and its dirtiness', () => {
    const slotByBranch = new Map([['feature-a', { name: 'tonks', dirty: true }]]);
    const shaped = shapeStack(ONE_NODE_STACK, new Map(), null, [], [], new Map(), slotByBranch);
    expect(shaped.nodes[0]!.checkedOutIn).toBe('tonks');
    expect(shaped.nodes[0]!.checkedOutDirty).toBe(true);
  });

  test('nodes not checked out anywhere get null/false', () => {
    const shaped = shapeStack(ONE_NODE_STACK, new Map(), null, [], [], new Map(), new Map());
    expect(shaped.nodes[0]!.checkedOutIn).toBeNull();
    expect(shaped.nodes[0]!.checkedOutDirty).toBe(false);
  });
});

// ── Per-repo provider resolution (MAT-19) ────────────────────────────────────
//
// The board shows several repos at once and they need not share a forge. Every
// case below is offline: `createProvider` builds a client without a request, and
// a store carrying `remoteUrl` means no git call either.

function storeWith(remoteUrl: string, stacks: Stack[] = [STACK]): StackStore {
  return { repoPath: '/repo', remoteUrl, stacks };
}

const GITLAB_ENV = { GITLAB_TOKEN: 'glpat-test' };
const GITHUB_ENV = { GITHUB_TOKEN: 'ghp-test' };

function resolve(store: StackStore, env: Record<string, string | undefined>, overrides: ForgeOverrides = {}) {
  return resolveRepoProvider('/repo', store, { env, overrides, secretsFile: '/nonexistent' });
}

describe('resolveRepoProvider', () => {
  test('resolves a GitLab remote to the gitlab provider', async () => {
    const ctx = await resolve(storeWith('git@gitlab.com:acme/web.git'), GITLAB_ENV);

    expect(ctx?.provider.providerName).toBe('gitlab');
    expect(ctx?.projectPath).toBe('acme/web');
  });

  test('resolves a GitHub remote to the github provider', async () => {
    // The whole point of the ticket: this repo needs no GitLab token, and gets
    // the right client rather than none.
    const ctx = await resolve(storeWith('git@github.com:acme/web.git'), GITHUB_ENV);

    expect(ctx?.provider.providerName).toBe('github');
    expect(ctx?.provider.baseURL).toBe('https://github.com');
  });

  test('a board holding both forges resolves each repo independently', async () => {
    const env = { ...GITLAB_ENV, ...GITHUB_ENV };

    const gitlab = await resolve(storeWith('https://gitlab.com/acme/web.git'), env);
    const github = await resolve(storeWith('https://github.com/acme/api.git'), env);

    expect(gitlab?.provider.providerName).toBe('gitlab');
    expect(github?.provider.providerName).toBe('github');
  });

  test('resolves a self-hosted host through the forges override', async () => {
    const ctx = await resolve(storeWith('git@gitlab.acme.com:acme/web.git'), GITLAB_ENV, {
      'gitlab.acme.com': { provider: 'gitlab' },
    });

    expect(ctx?.provider.baseURL).toBe('https://gitlab.acme.com');
  });

  test('degrades to no provider when this forge has no token', async () => {
    // A GitLab token is not a GitHub credential. Before MAT-19 the presence of
    // one was what decided whether ANY repo got enrichment.
    expect(await resolve(storeWith('git@github.com:acme/web.git'), GITLAB_ENV)).toBeNull();
  });

  test('degrades to no provider when the remote names no forge gitq knows', async () => {
    expect(await resolve(storeWith('git@git.acme.com:acme/web.git'), GITLAB_ENV)).toBeNull();
    expect(await resolve(storeWith('/srv/git/acme/web.git'), GITLAB_ENV)).toBeNull();
  });

  test('resolves nothing for a repo with no tracked stacks', async () => {
    // No stacks means nothing to enrich, so the remote is never even read.
    expect(await resolve(storeWith('git@gitlab.com:acme/web.git', []), GITLAB_ENV)).toBeNull();
  });

  test("one repo's missing token does not withhold another repo's MRs", async () => {
    const env = GITLAB_ENV;

    const ok = await resolve(storeWith('git@gitlab.com:acme/web.git'), env);
    const notOk = await resolve(storeWith('git@github.com:acme/api.git'), env);

    expect(ok?.provider.providerName).toBe('gitlab');
    expect(notOk).toBeNull();
  });
});

// ── fetchMrsByBranch provider-capability fallback ────────────────────────────

describe('fetchMrsByBranch', () => {
  function mockPR(iid: number, sourceBranch: string) {
    return {
      iid,
      webUrl: `https://gitlab.com/acme/web/-/merge_requests/${iid}`,
      title: `MR ${iid}`,
      state: 'opened',
      sourceBranch,
      pipeline: null,
    } as unknown as PullRequest;
  }

  test('uses the batch fetch when the provider offers one', async () => {
    const calls: string[][] = [];
    const provider = {
      fetchPullRequestsByBranches: (_p: string, branches: string[]) => {
        calls.push(branches);
        return Promise.resolve(new Map([['a', mockPR(1, 'a')], ['b', null]]));
      },
      fetchPullRequestByBranch: () => Promise.reject(new Error('should not be called')),
    } as unknown as GitProvider;

    const out = await fetchMrsByBranch({ provider, projectPath: 'acme/web' }, ['a', 'b']);

    expect(calls).toEqual([['a', 'b']]);
    expect([...out.keys()]).toEqual(['a']);
    expect(out.get('a')!.iid).toBe(1);
  });

  test('falls back to one call per branch when it does not', async () => {
    // GitHubProvider does not implement the batch method, and the guard is
    // feature detection on an optional interface member, not a slug check.
    const asked: string[] = [];
    const provider = {
      fetchPullRequestByBranch: (_p: string, branch: string) => {
        asked.push(branch);
        return Promise.resolve(branch === 'a' ? mockPR(7, 'a') : null);
      },
    } as unknown as GitProvider;

    const out = await fetchMrsByBranch({ provider, projectPath: 'acme/web' }, ['a', 'b']);

    expect(asked).toEqual(['a', 'b']);
    expect([...out.keys()]).toEqual(['a']);
    expect(out.get('a')!.iid).toBe(7);
  });

  test('asks for nothing when there are no branches', async () => {
    const provider = {
      fetchPullRequestsByBranches: () => Promise.reject(new Error('should not be called')),
      fetchPullRequestByBranch: () => Promise.reject(new Error('should not be called')),
    } as unknown as GitProvider;

    expect((await fetchMrsByBranch({ provider, projectPath: 'acme/web' }, [])).size).toBe(0);
  });
});
