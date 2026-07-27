import { describe, expect, test, mock } from 'bun:test';
import { ForgeSync } from '../src/core/forge-sync.ts';
import { StackManager } from '../src/core/stack-manager.ts';
import { GitShell } from '../src/core/git-shell.ts';
import type { Stack } from '../src/core/types.ts';
import type { GitProvider, PullRequest, Pipeline, CreatePullRequestInput } from '@workforge/glance-sdk';

// ── Mock Provider ────────────────────────────────────────────────────────────

/** Build a minimal PullRequest for testing. */
function mockPR(overrides: Partial<PullRequest> & { sourceBranch: string; targetBranch: string }): PullRequest {
  return {
    id: `gitlab:${overrides.iid ?? 1}`,
    iid: overrides.iid ?? 1,
    repositoryId: 'gitlab:42',
    title: overrides.title ?? `MR for ${overrides.sourceBranch}`,
    description: null,
    state: overrides.state ?? 'opened',
    draft: false,
    conflicts: false,
    webUrl: overrides.webUrl ?? `https://gitlab.com/project/-/merge_requests/${overrides.iid ?? 1}`,
    sourceBranch: overrides.sourceBranch,
    targetBranch: overrides.targetBranch,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    sha: 'abc123',
    author: { id: 'gitlab:user:1', username: 'dev', name: 'Dev', avatarUrl: null },
    assignees: [],
    reviewers: [],
    roles: ['author'],
    pipeline: overrides.pipeline ?? null,
    unresolvedThreadCount: overrides.unresolvedThreadCount ?? 0,
    approvalsLeft: 0,
    approved: false,
    approvedBy: [],
    diffStats: overrides.diffStats ?? { additions: 10, deletions: 5, filesChanged: 3 },
    detailedMergeStatus: null,
    autoMergeEnabled: false,
    autoMergeStrategy: null,
    mergeUser: null,
    mergeAfter: null,
    divergedCommitsCount: null,
    rebaseInProgress: false,
    mergeOngoing: false,
    inProgressMergeCommitSha: null,
    mergeError: null,
    shouldBeRebased: false,
    mergeabilityChecks: [],
    blockingMergeRequestsCount: 0,
    approvalsRequired: 0,
    squash: false,
    squashOnMerge: false,
    mergeTrainIndex: null,
  };
}

/** Create a mock GitProvider that returns the given PRs. */
function mockProvider(prs: PullRequest[]): GitProvider {
  return {
    providerName: 'gitlab',
    baseURL: 'https://gitlab.com',
    validateToken: () => Promise.resolve({ id: 'gitlab:user:1', username: 'dev', name: 'Dev', avatarUrl: null }),
    fetchPullRequests: () => Promise.resolve(prs),
    fetchSingleMR: () => Promise.resolve(null),
    fetchPullRequestByBranch: () => Promise.resolve(null),
    createPullRequest: () => Promise.reject(new Error('not implemented')),
    updatePullRequest: () => Promise.reject(new Error('not implemented')),
    fetchBranchProtectionRules: () => Promise.resolve([]),
    deleteBranch: () => Promise.resolve(),
    fetchMRDiscussions: () => Promise.resolve({ mrIid: 0, repositoryId: '', discussions: [] }),
    restRequest: () => Promise.reject(new Error('not implemented')),
    capabilities: {
      canMerge: true,
      canApprove: true,
      canUnapprove: true,
      canRebase: true,
      canAutoMerge: true,
      canResolveDiscussions: true,
      canRetryPipeline: true,
      canRequestReReview: true,
    },
    mergePullRequest: () => Promise.reject(new Error('not implemented')),
    approvePullRequest: () => Promise.reject(new Error('not implemented')),
    unapprovePullRequest: () => Promise.reject(new Error('not implemented')),
    rebasePullRequest: () => Promise.reject(new Error('not implemented')),
    setAutoMerge: () => Promise.reject(new Error('not implemented')),
    cancelAutoMerge: () => Promise.reject(new Error('not implemented')),
    resolveDiscussion: () => Promise.reject(new Error('not implemented')),
    unresolveDiscussion: () => Promise.reject(new Error('not implemented')),
    retryPipeline: () => Promise.reject(new Error('not implemented')),
    retryJob: () => Promise.reject(new Error('not implemented')),
    fetchJobTrace: () => Promise.reject(new Error('not implemented')),
    fetchDownstreamPipeline: () => Promise.resolve(null),
    fetchJobDetail: () => Promise.reject(new Error('not implemented')),
    requestReReview: () => Promise.reject(new Error('not implemented')),
    watchMR: () => () => {},
  };
}

// ── discoverStacks ───────────────────────────────────────────────────────────

describe('ForgeSync.discoverStacks', () => {
  test('discovers a linear stack from forge MRs', async () => {
    const prs = [
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' }),
      mockPR({ iid: 2, sourceBranch: 'feat/b', targetBranch: 'feat/a' }),
      mockPR({ iid: 3, sourceBranch: 'feat/c', targetBranch: 'feat/b' }),
    ];

    const stacks = await ForgeSync.discoverStacks(mockProvider(prs));

    expect(stacks).toHaveLength(1);
    expect(stacks[0]!.root).toBe('main');
    expect(stacks[0]!.branches).toEqual(['feat/a', 'feat/b', 'feat/c']);
    expect(stacks[0]!.mrMap.size).toBe(3);
  });

  test('discovers branching (tree) stacks', async () => {
    const prs = [
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' }),
      mockPR({ iid: 2, sourceBranch: 'feat/b', targetBranch: 'feat/a' }),
      mockPR({ iid: 3, sourceBranch: 'feat/c', targetBranch: 'feat/a' }),
    ];

    const stacks = await ForgeSync.discoverStacks(mockProvider(prs));

    expect(stacks).toHaveLength(1);
    expect(stacks[0]!.root).toBe('main');
    expect(stacks[0]!.branches).toContain('feat/a');
    expect(stacks[0]!.branches).toContain('feat/b');
    expect(stacks[0]!.branches).toContain('feat/c');
  });

  test('discovers multiple independent stacks on different bases', async () => {
    const prs = [
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' }),
      mockPR({ iid: 2, sourceBranch: 'feat/a2', targetBranch: 'feat/a' }),
      mockPR({ iid: 3, sourceBranch: 'feat/x', targetBranch: 'develop' }),
      mockPR({ iid: 4, sourceBranch: 'feat/x2', targetBranch: 'feat/x' }),
    ];

    const stacks = await ForgeSync.discoverStacks(mockProvider(prs));

    expect(stacks).toHaveLength(2);
    const roots = stacks.map((s) => s.root).sort();
    expect(roots).toEqual(['develop', 'main']);
  });

  test('ignores non-open PRs and skips resulting standalone branches', async () => {
    const prs = [
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' }),
      mockPR({ iid: 2, sourceBranch: 'feat/b', targetBranch: 'feat/a', state: 'merged' }),
    ];

    const stacks = await ForgeSync.discoverStacks(mockProvider(prs));

    expect(stacks).toHaveLength(0);
  });

  test('returns empty array when no open PRs', async () => {
    const stacks = await ForgeSync.discoverStacks(mockProvider([]));
    expect(stacks).toEqual([]);
  });

  test('ignores standalone MRs that are not part of a chain', async () => {
    const prs = [
      mockPR({ iid: 1, sourceBranch: 'feat/auth', targetBranch: 'main' }),
      mockPR({ iid: 2, sourceBranch: 'feat/billing', targetBranch: 'main' }),
      mockPR({ iid: 3, sourceBranch: 'feat/onboarding', targetBranch: 'main' }),
    ];

    const stacks = await ForgeSync.discoverStacks(mockProvider(prs));

    expect(stacks).toHaveLength(0);
  });

  test('keeps a chain together and ignores unrelated standalone MRs', async () => {
    const prs = [
      mockPR({ iid: 1, sourceBranch: 'feat/auth', targetBranch: 'main' }),
      mockPR({ iid: 2, sourceBranch: 'feat/auth-tests', targetBranch: 'feat/auth' }),
      mockPR({ iid: 3, sourceBranch: 'feat/billing', targetBranch: 'main' }),
    ];

    const stacks = await ForgeSync.discoverStacks(mockProvider(prs));

    expect(stacks).toHaveLength(1);
    expect(stacks[0]!.root).toBe('main');
    expect(stacks[0]!.branches).toContain('feat/auth');
    expect(stacks[0]!.branches).toContain('feat/auth-tests');
  });
});

// ── reconcile ────────────────────────────────────────────────────────────────

describe('ForgeSync.reconcile', () => {
  test('detects drift when MR target differs from local parent', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');

    // feat/b's MR targets 'main' on forge, but locally its parent is 'feat/a'
    const prs = [
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' }),
      mockPR({ iid: 2, sourceBranch: 'feat/b', targetBranch: 'main' }), // drift!
    ];

    const result = await ForgeSync.reconcile(mockProvider(prs), stack);

    expect(result.drifts).toHaveLength(1);
    expect(result.drifts[0]!.branch).toBe('feat/b');
    expect(result.drifts[0]!.localParent).toBe('feat/a');
    expect(result.drifts[0]!.forgeTarget).toBe('main');
    expect(result.localOnly).toEqual([]);
  });

  test('identifies local-only branches (no MR)', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a'); // no MR for this

    const prs = [mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' })];

    const result = await ForgeSync.reconcile(mockProvider(prs), stack);

    expect(result.localOnly).toEqual(['feat/b']);
    expect(result.drifts).toEqual([]);
  });

  test('finds unmatched MRs targeting stack branches', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');

    // An MR from a branch we don't track, targeting 'feat/a' which we do track
    const prs = [
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' }),
      mockPR({ iid: 99, sourceBranch: 'feat/unknown', targetBranch: 'feat/a' }),
    ];

    const result = await ForgeSync.reconcile(mockProvider(prs), stack);

    expect(result.unmatchedMRs).toHaveLength(1);
    expect(result.unmatchedMRs[0]!.sourceBranch).toBe('feat/unknown');
  });
});

// ── populateNodeData ─────────────────────────────────────────────────────────

describe('ForgeSync.populateNodeData', () => {
  test('populates MR data onto matching nodes', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');

    const prs = [
      mockPR({
        iid: 142,
        sourceBranch: 'feat/a',
        targetBranch: 'main',
        webUrl: 'https://gitlab.com/-/mr/142',
        unresolvedThreadCount: 3,
        pipeline: {
          id: 'gitlab:pipeline:1',
          status: 'success',
          createdAt: null,
          webUrl: null,
          jobs: [],
        },
        diffStats: { additions: 50, deletions: 20, filesChanged: 5 },
      }),
    ];

    const updated = await ForgeSync.populateNodeData(mockProvider(prs), stack);
    const node = StackManager.findNode(updated, 'feat/a')!;

    expect(node.mrIid).toBe(142);
    expect(node.mrUrl).toBe('https://gitlab.com/-/mr/142');
    expect(node.pipelineStatus).toBe('success');
    expect(node.unresolvedThreads).toBe(3);
    expect(node.diffStats).toEqual({ additions: 50, deletions: 20, filesChanged: 5 });
    expect(node.status).toBe('synced');
  });

  test('marks status as drift when forge target mismatches', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');

    const prs = [
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' }),
      mockPR({ iid: 2, sourceBranch: 'feat/b', targetBranch: 'main' }), // targets main, not feat/a
    ];

    const updated = await ForgeSync.populateNodeData(mockProvider(prs), stack);
    const node = StackManager.findNode(updated, 'feat/b')!;

    expect(node.status).toBe('drift');
  });

  test('marks status as merged when MR state is merged', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');

    const prs = [mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main', state: 'merged' })];

    const updated = await ForgeSync.populateNodeData(mockProvider(prs), stack);
    const node = StackManager.findNode(updated, 'feat/a')!;

    expect(node.status).toBe('merged');
  });

  test('normalizes pipeline statuses correctly', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');

    // Test with 'canceled' → should normalize to 'failed'
    const prs = [
      mockPR({
        iid: 1,
        sourceBranch: 'feat/a',
        targetBranch: 'main',
        pipeline: { id: 'p1', status: 'canceled', createdAt: null, webUrl: null, jobs: [] },
      }),
    ];

    const updated = await ForgeSync.populateNodeData(mockProvider(prs), stack);
    const node = StackManager.findNode(updated, 'feat/a')!;

    expect(node.pipelineStatus).toBe('failed');
  });
});

// ── importFromForge ──────────────────────────────────────────────────────────

describe('ForgeSync.importFromForge', () => {
  test('reconstructs a stack store from forge MRs', async () => {
    // The MRs have to live in the project the remote points at... import
    // scopes to that repo, so mockPR's default web url would be filtered out.
    const prs = [
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main', webUrl: 'https://github.com/user/repo/pull/1' }),
      mockPR({ iid: 2, sourceBranch: 'feat/b', targetBranch: 'feat/a', webUrl: 'https://github.com/user/repo/pull/2' }),
    ];

    const { store } = await ForgeSync.importFromForge(mockProvider(prs), '/tmp/repo', 'git@github.com:user/repo.git');

    expect(store.repoPath).toBe('/tmp/repo');
    expect(store.remoteUrl).toBe('git@github.com:user/repo.git');
    expect(store.stacks).toHaveLength(1);

    const stack = store.stacks[0]!;
    expect(stack.root).toBe('main');
    expect(stack.nodes).toHaveLength(2);
    expect(StackManager.findNode(stack, 'feat/a')!.mrIid).toBe(1);
    expect(StackManager.findNode(stack, 'feat/b')!.parent).toBe('feat/a');
  });

  test('refuses a remote it cannot read a project from, rather than importing the instance', async () => {
    const prs = [
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main', webUrl: 'https://github.com/user/repo/pull/1' }),
      mockPR({ iid: 2, sourceBranch: 'feat/b', targetBranch: 'feat/a', webUrl: 'https://github.com/user/repo/pull/2' }),
    ];

    for (const degenerate of ['', 'origin', 'https://gitlab.com/']) {
      await expect(ForgeSync.importFromForge(mockProvider(prs), '/tmp/repo', degenerate)).rejects.toThrow(
        `cannot read a project path from remote "${degenerate}"`,
      );
    }
  });

  test('reports what the project scope did to the fetch', async () => {
    const prs = [
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main', webUrl: 'https://github.com/user/repo/pull/1' }),
      mockPR({ iid: 2, sourceBranch: 'feat/b', targetBranch: 'feat/a', webUrl: 'https://github.com/user/repo/pull/2' }),
      mockPR({ iid: 3, sourceBranch: 'other', targetBranch: 'main', webUrl: 'https://github.com/user/elsewhere/pull/3' }),
      mockPR({ iid: 4, sourceBranch: 'closed', targetBranch: 'main', state: 'closed', webUrl: 'https://github.com/user/repo/pull/4' }),
    ];

    const result = await ForgeSync.importFromForge(mockProvider(prs), '/tmp/repo', 'git@github.com:user/repo.git');

    expect(result.openMRs).toBe(3);
    expect(result.scopedMRs).toBe(2);
    expect(result.projectPath).toBe('user/repo');
  });

  test('a scope that matches nothing is distinguishable from a forge with nothing', async () => {
    // Both import to an empty store; only the counts say which happened. This
    // is what the CLI's stale-remote diagnostic keys off.
    const otherProject = [
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main', webUrl: 'https://github.com/user/elsewhere/pull/1' }),
      mockPR({ iid: 2, sourceBranch: 'feat/b', targetBranch: 'feat/a', webUrl: 'https://github.com/user/elsewhere/pull/2' }),
    ];

    const stale = await ForgeSync.importFromForge(mockProvider(otherProject), '/tmp/repo', 'git@github.com:user/repo.git');
    expect(stale.store.stacks).toEqual([]);
    expect(stale.openMRs).toBe(2);
    expect(stale.scopedMRs).toBe(0);

    const empty = await ForgeSync.importFromForge(mockProvider([]), '/tmp/repo', 'git@github.com:user/repo.git');
    expect(empty.store.stacks).toEqual([]);
    expect(empty.openMRs).toBe(0);
    expect(empty.scopedMRs).toBe(0);
  });
});

// ── publishStack ─────────────────────────────────────────────────────────────

describe('ForgeSync.publishStack', () => {
  /** Build a mock provider that actually accepts createPullRequest calls. */
  function publishableProvider(prs: PullRequest[]): GitProvider {
    let nextIid = 100;
    return {
      ...mockProvider(prs),
      createPullRequest: async (input) => {
        const iid = nextIid++;
        return mockPR({
          iid,
          sourceBranch: input.sourceBranch,
          targetBranch: input.targetBranch,
          title: input.title,
          webUrl: `https://gitlab.com/-/mr/${iid}`,
        });
      },
    };
  }

  test('creates MRs for all local-only nodes in dependency order', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');
    // Both are local-only by default (mrIid === null)

    const provider = publishableProvider([]);
    const result = await ForgeSync.publishStack(provider, stack, 'user/repo');

    expect(result.results).toHaveLength(2);
    expect(result.results[0]!.branch).toBe('feat/a');
    expect(result.results[0]!.success).toBe(true);
    expect(result.results[1]!.branch).toBe('feat/b');
    expect(result.results[1]!.success).toBe(true);
  });

  test('updates node status from local-only to synced', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');

    const provider = publishableProvider([]);
    const result = await ForgeSync.publishStack(provider, stack, 'user/repo');

    const node = StackManager.findNode(result.updatedStack, 'feat/a')!;
    expect(node.status).toBe('synced');
    expect(node.mrIid).toBeGreaterThan(0);
    expect(node.mrUrl).toBeTruthy();
  });

  test('skips nodes that already have an MR', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', { mrIid: 42, status: 'synced' });
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');

    const provider = publishableProvider([]);
    const result = await ForgeSync.publishStack(provider, stack, 'user/repo');

    // Only feat/b should be published
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.branch).toBe('feat/b');
  });

  test('stops on first failure', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');

    const provider: GitProvider = {
      ...mockProvider([]),
      createPullRequest: async () => {
        throw new Error('API error: 403 forbidden');
      },
    };

    const result = await ForgeSync.publishStack(provider, stack, 'user/repo');

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.branch).toBe('feat/a');
    expect(result.results[0]!.success).toBe(false);
    expect(result.results[0]!.error).toContain('403');
  });

  test('uses provided title and body from descriptions map', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');

    const capturedInputs: CreatePullRequestInput[] = [];
    let nextIid = 100;
    const provider: GitProvider = {
      ...mockProvider([]),
      createPullRequest: async (input) => {
        capturedInputs.push(input);
        const iid = nextIid++;
        return mockPR({ iid, sourceBranch: input.sourceBranch, targetBranch: input.targetBranch, title: input.title });
      },
    };

    const descriptions = {
      'feat/a': { title: 'Add auth foundation', body: '## Summary\nAuth base layer' },
      'feat/b': { title: 'Add auth tests', body: 'Test coverage for auth' },
    };

    await ForgeSync.publishStack(provider, stack, 'user/repo', undefined, descriptions);

    expect(capturedInputs).toHaveLength(2);
    expect(capturedInputs[0]!.title).toBe('Add auth foundation');
    expect(capturedInputs[0]!.description).toBe('## Summary\nAuth base layer');
    expect(capturedInputs[1]!.title).toBe('Add auth tests');
    expect(capturedInputs[1]!.description).toBe('Test coverage for auth');
  });

  test('falls back to branch name when no description provided', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');

    const capturedInputs: CreatePullRequestInput[] = [];
    const provider: GitProvider = {
      ...mockProvider([]),
      createPullRequest: async (input) => {
        capturedInputs.push(input);
        return mockPR({ iid: 100, sourceBranch: input.sourceBranch, targetBranch: input.targetBranch });
      },
    };

    await ForgeSync.publishStack(provider, stack, 'user/repo');

    expect(capturedInputs).toHaveLength(1);
    expect(capturedInputs[0]!.title).toBe('feat/a');
    expect(capturedInputs[0]!.description).toBeUndefined();
  });

  test('pushes each branch before creating MR when cwd is provided', async () => {
    const pushCalls: string[] = [];

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        pushForceWithLease: mock((_cwd: string, branch: string) => {
          pushCalls.push(branch);
          return Promise.resolve();
        }),
      },
      setCommandHook: () => {},
    }));

    const { ForgeSync: FS } = await import('../src/core/forge-sync.ts');

    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');

    const provider = publishableProvider([]);
    const result = await FS.publishStack(provider, stack, 'user/repo', '/tmp/repo');

    expect(pushCalls).toEqual(['feat/a', 'feat/b']);
    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.success)).toBe(true);
  });

  test('stops on push failure — no MR created for that branch', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        pushForceWithLease: mock(() => {
          throw new Error('rejected by remote: lease expired');
        }),
      },
      setCommandHook: () => {},
    }));

    const { ForgeSync: FS } = await import('../src/core/forge-sync.ts');

    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');

    let createCalled = false;
    const provider: GitProvider = {
      ...mockProvider([]),
      createPullRequest: async (input) => {
        createCalled = true;
        return mockPR({ iid: 100, sourceBranch: input.sourceBranch, targetBranch: input.targetBranch });
      },
    };

    const result = await FS.publishStack(provider, stack, 'user/repo', '/tmp/repo');

    expect(createCalled).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.branch).toBe('feat/a');
    expect(result.results[0]!.success).toBe(false);
    expect(result.results[0]!.error).toContain('lease expired');
  });
});

// ── publishStack: republishing an already-published stack ────────────────────

describe('ForgeSync.publishStack — republish', () => {
  interface Calls {
    fetches: number;
    creates: CreatePullRequestInput[];
    updates: { iid: number; input: Record<string, unknown> }[];
  }

  /**
   * Provider that answers the iid batch-fetch with `prs` and records every
   * create/update it is asked for.
   */
  function republishProvider(prs: PullRequest[]): { provider: GitProvider; calls: Calls } {
    const calls: Calls = { fetches: 0, creates: [], updates: [] };
    let nextIid = 100;

    const provider: GitProvider = {
      ...mockProvider(prs),
      fetchPullRequests: () => {
        calls.fetches++;
        return Promise.resolve(prs);
      },
      createPullRequest: async (input) => {
        calls.creates.push(input);
        const iid = nextIid++;
        return mockPR({
          iid,
          sourceBranch: input.sourceBranch,
          targetBranch: input.targetBranch,
          title: input.title,
          webUrl: `https://gitlab.com/-/mr/${iid}`,
        });
      },
      updatePullRequest: async (_projectPath, iid, input) => {
        calls.updates.push({ iid, input: input as Record<string, unknown> });
        return mockPR({ iid, sourceBranch: 'x', targetBranch: 'y' });
      },
    };

    return { provider, calls };
  }

  /** feat/a → main, feat/b → feat/a locally, both already published. */
  function publishedStack(): Stack {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');
    stack = StackManager.updateNode(stack, 'feat/a', {
      mrIid: 1,
      mrUrl: 'https://gitlab.com/-/mr/1',
      status: 'synced',
    });
    stack = StackManager.updateNode(stack, 'feat/b', {
      mrIid: 2,
      mrUrl: 'https://gitlab.com/-/mr/2',
      status: 'synced',
    });
    return stack;
  }

  test('retargets an MR whose forge target no longer matches the local parent', async () => {
    const stack = publishedStack();

    // feat/b was reparented under feat/a locally; its MR still targets main.
    const { provider, calls } = republishProvider([
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' }),
      mockPR({ iid: 2, sourceBranch: 'feat/b', targetBranch: 'main' }),
    ]);

    const result = await ForgeSync.publishStack(provider, stack, 'user/repo');

    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0]!.iid).toBe(2);
    expect(calls.updates[0]!.input.targetBranch).toBe('feat/a');

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.branch).toBe('feat/b');
    expect(result.results[0]!.success).toBe(true);
    expect(result.results[0]!.action).toBe('updated');
    expect(result.results[0]!.changes).toEqual(['target']);
    expect(result.results[0]!.targetBranch).toBe('feat/a');
    expect(result.results[0]!.mrIid).toBe(2);
    expect(result.results[0]!.mrUrl).toBe('https://gitlab.com/-/mr/2');

    expect(StackManager.findNode(result.updatedStack, 'feat/b')!.status).toBe('synced');
  });

  test('leaves an MR alone when its target already matches the local parent', async () => {
    const stack = publishedStack();

    const { provider, calls } = republishProvider([
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' }),
      mockPR({ iid: 2, sourceBranch: 'feat/b', targetBranch: 'feat/a' }),
    ]);

    const result = await ForgeSync.publishStack(provider, stack, 'user/repo');

    expect(calls.updates).toEqual([]);
    expect(calls.creates).toEqual([]);
    expect(result.results).toEqual([]);
  });

  test('rewrites title and description when --mr-meta names an already-published branch', async () => {
    const stack = publishedStack();

    const { provider, calls } = republishProvider([
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' }),
      mockPR({ iid: 2, sourceBranch: 'feat/b', targetBranch: 'feat/a' }),
    ]);

    const result = await ForgeSync.publishStack(provider, stack, 'user/repo', undefined, {
      'feat/a': { title: 'Rewritten title', body: 'Rewritten body' },
    });

    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0]!.iid).toBe(1);
    expect(calls.updates[0]!.input.title).toBe('Rewritten title');
    expect(calls.updates[0]!.input.description).toBe('Rewritten body');
    expect(calls.updates[0]!.input.targetBranch).toBeUndefined();

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.branch).toBe('feat/a');
    expect(result.results[0]!.action).toBe('updated');
    expect(result.results[0]!.changes).toEqual(['metadata']);
  });

  test('retargets and rewrites in one pass when both apply', async () => {
    const stack = publishedStack();

    const { provider, calls } = republishProvider([
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' }),
      mockPR({ iid: 2, sourceBranch: 'feat/b', targetBranch: 'main' }),
    ]);

    const result = await ForgeSync.publishStack(provider, stack, 'user/repo', undefined, {
      'feat/b': { title: 'New title', body: 'New body' },
    });

    expect(calls.updates.map((u) => u.input.targetBranch)).toEqual(['feat/a', undefined]);
    expect(calls.updates[1]!.input.title).toBe('New title');
    expect(result.results[0]!.changes).toEqual(['target', 'metadata']);
  });

  test('never rewrites an MR the caller supplied no metadata for', async () => {
    const stack = publishedStack();

    const { provider, calls } = republishProvider([
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' }),
      mockPR({ iid: 2, sourceBranch: 'feat/b', targetBranch: 'main' }),
    ]);

    await ForgeSync.publishStack(provider, stack, 'user/repo');

    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0]!.input.title).toBeUndefined();
    expect(calls.updates[0]!.input.description).toBeUndefined();
  });

  test('skips a node whose MR is no longer open on the forge', async () => {
    const stack = publishedStack();

    const { provider, calls } = republishProvider([
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' }),
      mockPR({ iid: 2, sourceBranch: 'feat/b', targetBranch: 'main', state: 'merged' }),
    ]);

    const result = await ForgeSync.publishStack(provider, stack, 'user/repo', undefined, {
      'feat/b': { title: 'New title', body: 'New body' },
    });

    expect(calls.updates).toEqual([]);
    expect(result.results).toEqual([]);
  });

  test('skips a node whose MR the forge did not return', async () => {
    const stack = publishedStack();

    // Only feat/a's MR comes back; feat/b's iid is unreadable, so its target
    // can't be compared and it is left untouched.
    const { provider, calls } = republishProvider([mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' })]);

    const result = await ForgeSync.publishStack(provider, stack, 'user/repo');

    expect(calls.updates).toEqual([]);
    expect(result.results).toEqual([]);
  });

  test('creates and updates in one run, parents before children', async () => {
    let stack = publishedStack();
    stack = StackManager.addNode(stack, 'feat/c', 'feat/b');

    // feat/b drifted (targets main), feat/c has never been published.
    const { provider, calls } = republishProvider([
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' }),
      mockPR({ iid: 2, sourceBranch: 'feat/b', targetBranch: 'main' }),
    ]);

    const result = await ForgeSync.publishStack(provider, stack, 'user/repo');

    expect(result.results.map((r) => [r.branch, r.action])).toEqual([
      ['feat/b', 'updated'],
      ['feat/c', 'created'],
    ]);
    expect(calls.creates).toHaveLength(1);
    expect(calls.creates[0]!.sourceBranch).toBe('feat/c');
    expect(calls.creates[0]!.targetBranch).toBe('feat/b');
    expect(StackManager.findNode(result.updatedStack, 'feat/c')!.status).toBe('synced');
  });

  test('stops the walk when a retarget fails', async () => {
    let stack = publishedStack();
    stack = StackManager.addNode(stack, 'feat/c', 'feat/b');

    const { provider, calls } = republishProvider([
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' }),
      mockPR({ iid: 2, sourceBranch: 'feat/b', targetBranch: 'main' }),
    ]);
    const failing: GitProvider = {
      ...provider,
      updatePullRequest: () => Promise.reject(new Error('API error: 409 conflict')),
    };

    const result = await ForgeSync.publishStack(failing, stack, 'user/repo');

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.branch).toBe('feat/b');
    expect(result.results[0]!.success).toBe(false);
    expect(result.results[0]!.action).toBe('updated');
    expect(result.results[0]!.error).toContain('409');
    expect(calls.creates).toEqual([]);
  });

  test('reads the forge only when the stack has published nodes', async () => {
    let localOnly = StackManager.createStack('auth', 'main');
    localOnly = StackManager.addNode(localOnly, 'feat/a', 'main');

    const fresh = republishProvider([]);
    await ForgeSync.publishStack(fresh.provider, localOnly, 'user/repo');
    expect(fresh.calls.fetches).toBe(0);

    const republished = republishProvider([mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' })]);
    await ForgeSync.publishStack(republished.provider, publishedStack(), 'user/repo');
    expect(republished.calls.fetches).toBe(1);
  });

  test('does not push a branch that already has an MR', async () => {
    const pushCalls: string[] = [];

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        pushForceWithLease: mock((_cwd: string, branch: string) => {
          pushCalls.push(branch);
          return Promise.resolve();
        }),
        getBranchHead: mock(() => Promise.resolve('deadbee')),
      },
      setCommandHook: () => {},
    }));

    const { ForgeSync: FS } = await import('../src/core/forge-sync.ts');

    let stack = publishedStack();
    stack = StackManager.addNode(stack, 'feat/c', 'feat/b');

    // feat/b drifted; only feat/c is new.
    const { provider } = republishProvider([
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' }),
      mockPR({ iid: 2, sourceBranch: 'feat/b', targetBranch: 'main' }),
    ]);

    const result = await FS.publishStack(provider, stack, 'user/repo', '/tmp/repo');

    expect(pushCalls).toEqual(['feat/c']);
    expect(result.results.every((r) => r.success)).toBe(true);
  });
});

// ── retargetMR ──────────────────────────────────────────────────────────────

describe('ForgeSync.retargetMR', () => {
  test('calls updatePullRequest and marks node as synced', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', { mrIid: 42, status: 'drift' });

    let capturedProject: string | undefined;
    let capturedIid: number | undefined;
    let capturedUpdate: Record<string, unknown> | undefined;

    const provider: GitProvider = {
      ...mockProvider([]),
      updatePullRequest: async (projectPath, iid, opts) => {
        capturedProject = projectPath;
        capturedIid = iid;
        capturedUpdate = opts as Record<string, unknown>;
        return mockPR({ iid, sourceBranch: 'feat/a', targetBranch: 'main' });
      },
    };

    const updated = await ForgeSync.retargetMR(provider, stack, 'feat/a', 'user/repo');

    expect(capturedProject).toBe('user/repo');
    expect(capturedIid).toBe(42);
    expect(capturedUpdate?.targetBranch).toBe('main');

    const node = StackManager.findNode(updated, 'feat/a')!;
    expect(node.status).toBe('synced');
  });

  test('throws when branch not found', async () => {
    const stack = StackManager.createStack('auth', 'main');

    await expect(
      ForgeSync.retargetMR(mockProvider([]), stack, 'nonexistent', 'user/repo'),
    ).rejects.toThrow('not found');
  });

  test('throws when branch has no MR', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');

    await expect(
      ForgeSync.retargetMR(mockProvider([]), stack, 'feat/a', 'user/repo'),
    ).rejects.toThrow('no MR');
  });
});

// ── syncStack ────────────────────────────────────────────────────────────────

describe('ForgeSync.syncStack', () => {
  test('populates node data and returns reconcile result in one call', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');

    const prs = [
      mockPR({
        iid: 1,
        sourceBranch: 'feat/a',
        targetBranch: 'main',
        pipeline: { id: 'p1', status: 'success', createdAt: null, webUrl: null, jobs: [] },
        diffStats: { additions: 10, deletions: 5, filesChanged: 3 },
      }),
    ];

    let fetchCount = 0;
    const countingProvider: GitProvider = {
      ...mockProvider(prs),
      fetchPullRequests: () => {
        fetchCount++;
        return Promise.resolve(prs);
      },
    };

    const result = await ForgeSync.syncStack(countingProvider, stack);

    // Should only call fetchPullRequests once (shared across populate + reconcile)
    expect(fetchCount).toBe(1);

    // populateNodeData should have updated the node
    const node = StackManager.findNode(result.updatedStack, 'feat/a')!;
    expect(node.mrIid).toBe(1);
    expect(node.pipelineStatus).toBe('success');
    expect(node.status).toBe('synced');

    // reconcile result should be present
    expect(result.reconcile.drifts).toEqual([]);
    expect(result.reconcile.localOnly).toEqual([]);
  });

  test('detects newly merged branches', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', { mrIid: 1, status: 'synced' });

    const prs = [
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main', state: 'merged' }),
    ];

    const result = await ForgeSync.syncStack(mockProvider(prs), stack);

    expect(result.newlyMerged).toEqual(['feat/a']);
    expect(StackManager.findNode(result.updatedStack, 'feat/a')!.status).toBe('merged');
  });

  test('returns empty newlyMerged when no status changes', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', { mrIid: 1, status: 'synced' });

    const prs = [
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' }),
    ];

    const result = await ForgeSync.syncStack(mockProvider(prs), stack);

    expect(result.newlyMerged).toEqual([]);
  });

  test('handles empty stack without crashing', async () => {
    const stack = StackManager.createStack('auth', 'main');

    const result = await ForgeSync.syncStack(mockProvider([]), stack);

    expect(result.updatedStack.nodes).toEqual([]);
    expect(result.newlyMerged).toEqual([]);
    expect(result.reconcile.drifts).toEqual([]);
    expect(result.reconcile.localOnly).toEqual([]);
  });

  test('handles no MRs on forge (all nodes stay local-only)', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');

    const result = await ForgeSync.syncStack(mockProvider([]), stack);

    expect(result.reconcile.localOnly).toEqual(['feat/a', 'feat/b']);
    expect(result.newlyMerged).toEqual([]);
  });

  test('tracks pipeline status changes', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', { mrIid: 1, status: 'synced', pipelineStatus: 'running' });

    const prs = [
      mockPR({
        iid: 1,
        sourceBranch: 'feat/a',
        targetBranch: 'main',
        pipeline: { id: 'p1', status: 'success', createdAt: null, webUrl: null, jobs: [] },
      }),
    ];

    const result = await ForgeSync.syncStack(mockProvider(prs), stack);

    expect(result.pipelineChanges).toHaveLength(1);
    expect(result.pipelineChanges[0]!.branch).toBe('feat/a');
    expect(result.pipelineChanges[0]!.from).toBe('running');
    expect(result.pipelineChanges[0]!.to).toBe('success');
  });

  test('ignores pipeline transitions to unknown', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', { mrIid: 1, status: 'synced', pipelineStatus: 'running' });

    // No pipeline data on the PR → normalizes to 'unknown'
    const prs = [mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' })];

    const result = await ForgeSync.syncStack(mockProvider(prs), stack);

    expect(result.pipelineChanges).toEqual([]);
  });

  test('detects branches that were synced but no longer have a matching MR', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.addNode(stack, 'feat/b', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', { mrIid: 1, status: 'synced' });
    stack = StackManager.updateNode(stack, 'feat/b', { mrIid: 2, status: 'synced' });

    // Only feat/a still has a PR — feat/b's MR was deleted
    const prs = [
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' }),
    ];

    const result = await ForgeSync.syncStack(mockProvider(prs), stack);

    expect(result.deletedBranches).toHaveLength(1);
    expect(result.deletedBranches[0]!.branch).toBe('feat/b');
    expect(result.deletedBranches[0]!.reason).toBe('deleted');
    expect(result.deletedBranches.map((d) => d.branch)).not.toContain('feat/a');
  });

  test('does not flag local-only branches as deleted', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', { status: 'local-only' });

    const result = await ForgeSync.syncStack(mockProvider([]), stack);

    expect(result.deletedBranches).toEqual([]);
  });

  test('detects merged reason when fetchSingleMR returns merged state', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', {
      mrIid: 1,
      status: 'synced',
      mrUrl: 'https://gitlab.com/group/project/-/merge_requests/1',
    });

    // No open PRs — the MR was merged
    const provider: GitProvider = {
      ...mockProvider([]),
      fetchSingleMR: (_proj: string, _iid: number) =>
        Promise.resolve(mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main', state: 'merged' })),
    };

    const result = await ForgeSync.syncStack(provider, stack);

    expect(result.deletedBranches).toHaveLength(1);
    expect(result.deletedBranches[0]!.branch).toBe('feat/a');
    expect(result.deletedBranches[0]!.reason).toBe('merged');
    expect(result.deletedBranches[0]!.mrIid).toBe(1);
  });

  test('detects closed reason when fetchSingleMR returns closed state', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', {
      mrIid: 1,
      status: 'synced',
      mrUrl: 'https://gitlab.com/group/project/-/merge_requests/1',
    });

    const provider: GitProvider = {
      ...mockProvider([]),
      fetchSingleMR: (_proj: string, _iid: number) =>
        Promise.resolve(mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main', state: 'closed' })),
    };

    const result = await ForgeSync.syncStack(provider, stack);

    expect(result.deletedBranches).toHaveLength(1);
    expect(result.deletedBranches[0]!.branch).toBe('feat/a');
    expect(result.deletedBranches[0]!.reason).toBe('closed');
  });

  test('pipelineChanges backward compat — existing populateNodeData and reconcile still work without prefetched PRs', async () => {
    let stack = StackManager.createStack('auth', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');

    const prs = [
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' }),
    ];

    // Call directly without prefetchedPRs — should still work (backward compat)
    const populated = await ForgeSync.populateNodeData(mockProvider(prs), stack);
    expect(StackManager.findNode(populated, 'feat/a')!.mrIid).toBe(1);

    const reconciled = await ForgeSync.reconcile(mockProvider(prs), stack);
    expect(reconciled.drifts).toEqual([]);
  });
});

// ── discoverTeamStacks ───────────────────────────────────────────────────────

describe('ForgeSync.discoverTeamStacks', () => {
  test('groups MRs by author and discovers stack chains', async () => {
    const prs = [
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' }),
      mockPR({ iid: 2, sourceBranch: 'feat/b', targetBranch: 'feat/a' }),
      {
        ...mockPR({ iid: 3, sourceBranch: 'feat/x', targetBranch: 'main' }),
        author: { id: 'gitlab:user:2', username: 'alice', name: 'Alice', avatarUrl: null },
      },
      {
        ...mockPR({ iid: 4, sourceBranch: 'feat/x2', targetBranch: 'feat/x' }),
        author: { id: 'gitlab:user:2', username: 'alice', name: 'Alice', avatarUrl: null },
      },
    ];

    const teamStacks = await ForgeSync.discoverTeamStacks(mockProvider(prs));

    expect(teamStacks).toHaveLength(2);

    const devTeam = teamStacks.find((ts) => ts.author.username === 'dev');
    expect(devTeam).toBeTruthy();
    expect(devTeam!.stacks).toHaveLength(1);
    expect(devTeam!.stacks[0]!.branches).toContain('feat/a');
    expect(devTeam!.stacks[0]!.branches).toContain('feat/b');

    const aliceTeam = teamStacks.find((ts) => ts.author.username === 'alice');
    expect(aliceTeam).toBeTruthy();
    expect(aliceTeam!.stacks).toHaveLength(1);
    expect(aliceTeam!.stacks[0]!.branches).toContain('feat/x');
    expect(aliceTeam!.stacks[0]!.branches).toContain('feat/x2');
  });

  test('returns empty array when no open MRs', async () => {
    const teamStacks = await ForgeSync.discoverTeamStacks(mockProvider([]));
    expect(teamStacks).toEqual([]);
  });

  test('ignores closed/merged MRs', async () => {
    const prs = [
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main', state: 'merged' }),
      mockPR({ iid: 2, sourceBranch: 'feat/b', targetBranch: 'main' }),
      mockPR({ iid: 3, sourceBranch: 'feat/c', targetBranch: 'feat/b' }),
    ];

    const teamStacks = await ForgeSync.discoverTeamStacks(mockProvider(prs));

    expect(teamStacks).toHaveLength(1);
    const branches = teamStacks[0]!.stacks[0]!.branches;
    expect(branches).toContain('feat/b');
    expect(branches).toContain('feat/c');
    expect(branches).not.toContain('feat/a');
  });

  test('handles multiple stacks per author', async () => {
    const prs = [
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' }),
      mockPR({ iid: 2, sourceBranch: 'feat/a2', targetBranch: 'feat/a' }),
      mockPR({ iid: 3, sourceBranch: 'feat/x', targetBranch: 'develop' }),
      mockPR({ iid: 4, sourceBranch: 'feat/x2', targetBranch: 'feat/x' }),
    ];

    const teamStacks = await ForgeSync.discoverTeamStacks(mockProvider(prs));

    expect(teamStacks).toHaveLength(1);
    expect(teamStacks[0]!.stacks).toHaveLength(2);
  });
});

// ── repo scoping (MAT-18) ────────────────────────────────────────────────────

/**
 * Build a PR that belongs to a specific forge project.
 *
 * Sets both identity carriers a real MR has: `repositoryId` (the forge's own
 * repo id) and `webUrl` (the only place a project path can be read from).
 */
function mockRepoPR(
  projectPath: string,
  repositoryId: string,
  pr: { iid: number; sourceBranch: string; targetBranch: string; author?: PullRequest['author'] },
): PullRequest {
  return {
    ...mockPR({
      iid: pr.iid,
      sourceBranch: pr.sourceBranch,
      targetBranch: pr.targetBranch,
      webUrl: `https://gitlab.com/${projectPath}/-/merge_requests/${pr.iid}`,
    }),
    repositoryId,
    ...(pr.author ? { author: pr.author } : {}),
  };
}

/**
 * Two unrelated projects whose branch names collide: `fix-tests` exists in
 * both, and each has one branch stacked on top of it.
 */
function twoReposSharingABranchName(author?: PullRequest['author']): PullRequest[] {
  return [
    mockRepoPR('acme/web', 'gitlab:1', { iid: 1, sourceBranch: 'fix-tests', targetBranch: 'main', ...(author && { author }) }),
    mockRepoPR('acme/web', 'gitlab:1', { iid: 2, sourceBranch: 'web-only', targetBranch: 'fix-tests', ...(author && { author }) }),
    mockRepoPR('acme/api', 'gitlab:2', { iid: 3, sourceBranch: 'fix-tests', targetBranch: 'main', ...(author && { author }) }),
    mockRepoPR('acme/api', 'gitlab:2', { iid: 4, sourceBranch: 'api-only', targetBranch: 'fix-tests', ...(author && { author }) }),
  ];
}

describe('ForgeSync.discoverStacks: repo scoping', () => {
  test('scoped to one project, MRs from other projects are not in the stack', async () => {
    const stacks = await ForgeSync.discoverStacks(mockProvider(twoReposSharingABranchName()), 'acme/web');

    expect(stacks).toHaveLength(1);
    expect(stacks[0]!.branches.sort()).toEqual(['fix-tests', 'web-only']);
    // The MR attached to the shared branch name must be this project's MR.
    expect(stacks[0]!.mrMap.get('fix-tests')!.iid).toBe(1);
  });

  test('a chain in another project does not extend this project\'s stack', async () => {
    const prs = [
      mockRepoPR('acme/web', 'gitlab:1', { iid: 1, sourceBranch: 'fix-tests', targetBranch: 'main' }),
      mockRepoPR('acme/api', 'gitlab:2', { iid: 2, sourceBranch: 'update-deps', targetBranch: 'fix-tests' }),
    ];

    const stacks = await ForgeSync.discoverStacks(mockProvider(prs), 'acme/web');

    // 'fix-tests' alone is not a stack; 'update-deps' belongs to another repo.
    expect(stacks).toEqual([]);
  });

  test('project paths compare case-insensitively', async () => {
    const stacks = await ForgeSync.discoverStacks(mockProvider(twoReposSharingABranchName()), 'ACME/Web');

    expect(stacks).toHaveLength(1);
    expect(stacks[0]!.branches.sort()).toEqual(['fix-tests', 'web-only']);
  });

  test('without a project path, branches from different repos are still never spliced', async () => {
    const stacks = await ForgeSync.discoverStacks(mockProvider(twoReposSharingABranchName()));

    expect(stacks).toHaveLength(2);
    for (const stack of stacks) {
      expect(stack.branches.includes('web-only') && stack.branches.includes('api-only')).toBe(false);
    }
  });

  test('an unscoped call still includes MRs whose project cannot be read', async () => {
    // The other half of the drop-what-we-cannot-place rule: scoping drops an
    // MR with no readable project, but a caller who asked for no scope is
    // asking for everything, so nothing is dropped on identity grounds.
    const prs = [
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main', webUrl: null }),
      mockPR({ iid: 2, sourceBranch: 'feat/b', targetBranch: 'feat/a', webUrl: null }),
    ];

    expect(await ForgeSync.discoverStacks(mockProvider(prs))).toHaveLength(1);
    expect(await ForgeSync.discoverStacks(mockProvider(prs), 'acme/web')).toEqual([]);
  });
});

describe('ForgeSync.importFromForge: repo scoping', () => {
  test('imports only the stacks of the repo the remote points at', async () => {
    const { store } = await ForgeSync.importFromForge(
      mockProvider(twoReposSharingABranchName()),
      '/tmp/web',
      'git@gitlab.com:acme/web.git',
    );

    expect(store.stacks).toHaveLength(1);
    const branches = store.stacks[0]!.nodes.map((n) => n.branch).sort();
    expect(branches).toEqual(['fix-tests', 'web-only']);
    expect(StackManager.findNode(store.stacks[0]!, 'fix-tests')!.mrIid).toBe(1);
  });

  test('https remotes scope the same way as ssh remotes', async () => {
    const { store } = await ForgeSync.importFromForge(
      mockProvider(twoReposSharingABranchName()),
      '/tmp/api',
      'https://gitlab.com/acme/api.git',
    );

    expect(store.stacks).toHaveLength(1);
    expect(store.stacks[0]!.nodes.map((n) => n.branch).sort()).toEqual(['api-only', 'fix-tests']);
  });

  test('the same path on another forge host is not this project', async () => {
    // acme/web exists on gitlab.com and on github.com; the remote names which.
    const { store, openMRs, scopedMRs } = await ForgeSync.importFromForge(
      mockProvider(twoReposSharingABranchName()),
      '/tmp/web',
      'git@github.com:acme/web.git',
    );

    expect(store.stacks).toEqual([]);
    expect(openMRs).toBe(4);
    expect(scopedMRs).toBe(0);
  });
});

describe('ForgeSync.discoverTeamStacks: repo scoping', () => {
  const alice = { id: 'gitlab:user:2', username: 'alice', name: 'Alice', avatarUrl: null };

  test('an author working in two repos gets one stack per repo, not a merged one', async () => {
    const teamStacks = await ForgeSync.discoverTeamStacks(mockProvider(twoReposSharingABranchName(alice)), 'acme/web');

    expect(teamStacks).toHaveLength(1);
    expect(teamStacks[0]!.author.username).toBe('alice');
    expect(teamStacks[0]!.stacks).toHaveLength(1);
    expect(teamStacks[0]!.stacks[0]!.branches.sort()).toEqual(['fix-tests', 'web-only']);
  });

  test('without a project path, an author\'s repos stay separate stacks', async () => {
    const teamStacks = await ForgeSync.discoverTeamStacks(mockProvider(twoReposSharingABranchName(alice)));

    expect(teamStacks).toHaveLength(1);
    expect(teamStacks[0]!.stacks).toHaveLength(2);
    for (const stack of teamStacks[0]!.stacks) {
      expect(stack.branches.includes('web-only') && stack.branches.includes('api-only')).toBe(false);
    }
  });
});
