/**
 * Network failure during forge sync: API timeout, partial failure,
 * provider errors during publish/sync/reconcile.
 *
 * Uses mock providers that simulate real failure modes.
 */
import { describe, test, expect } from 'bun:test';
import type { GitProvider, PullRequest, CreatePullRequestInput } from '@mattstack/glance';
import { ForgeSync } from '../../src/core/forge-sync.ts';
import { StackManager } from '../../src/core/stack-manager.ts';
import type { Stack } from '../../src/core/types.ts';

// ── Mock helpers ─────────────────────────────────────────────────────────────

/** The project these fixtures' web URLs belong to; the sync entry points scope to it. */
const MOCK_PROJECT = 'acme/app';

function mockPR(overrides: Partial<PullRequest> & { sourceBranch: string; targetBranch: string }): PullRequest {
  return {
    id: `mock:${overrides.iid ?? 1}`,
    iid: overrides.iid ?? 1,
    repositoryId: 'mock:1',
    title: overrides.title ?? `PR for ${overrides.sourceBranch}`,
    description: null,
    state: overrides.state ?? 'opened',
    draft: false,
    conflicts: false,
    webUrl: `https://example.com/${MOCK_PROJECT}/-/merge_requests/${overrides.iid ?? 1}`,
    sourceBranch: overrides.sourceBranch,
    targetBranch: overrides.targetBranch,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    sha: 'abc123',
    author: { id: 'mock:user:1', username: 'test', name: 'Test', avatarUrl: null },
    assignees: [],
    reviewers: [],
    roles: ['author'],
    pipeline: null,
    unresolvedThreadCount: 0,
    approvalsLeft: 0,
    approved: false,
    approvedBy: [],
    diffStats: { additions: 10, deletions: 5, filesChanged: 3 },
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

function baseProvider(): GitProvider {
  return {
    providerName: 'mock',
    baseURL: 'https://example.com',
    validateToken: () => Promise.resolve({ id: 'mock:1', username: 'test', name: 'Test', avatarUrl: null }),
    fetchPullRequests: () => Promise.resolve([]),
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
      canWatchEvents: true,
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

function makeStack(): Stack {
  let stack = StackManager.createStack('test', 'main');
  stack = StackManager.addNode(stack, 'feat/a', 'main');
  stack = StackManager.addNode(stack, 'feat/b', 'feat/a');
  return stack;
}

// ── fetchPullRequests failure ────────────────────────────────────────────────

describe('Network failure: fetchPullRequests', () => {
  test('syncStack throws when fetchPullRequests fails', async () => {
    const provider: GitProvider = {
      ...baseProvider(),
      fetchPullRequests: () => Promise.reject(new Error('Network timeout')),
    };

    await expect(ForgeSync.syncStack(provider, makeStack(), MOCK_PROJECT)).rejects.toThrow(/Network timeout/);
  });

  test('discoverStacks throws when fetchPullRequests fails', async () => {
    const provider: GitProvider = {
      ...baseProvider(),
      fetchPullRequests: () => Promise.reject(new Error('502 Bad Gateway')),
    };

    await expect(ForgeSync.discoverStacks(provider)).rejects.toThrow(/502/);
  });

  test('reconcile throws when fetchPullRequests fails', async () => {
    const provider: GitProvider = {
      ...baseProvider(),
      fetchPullRequests: () => Promise.reject(new Error('ECONNREFUSED')),
    };

    await expect(ForgeSync.reconcile(provider, makeStack(), MOCK_PROJECT)).rejects.toThrow(/ECONNREFUSED/);
  });

  test('populateNodeData throws when fetchPullRequests fails', async () => {
    const provider: GitProvider = {
      ...baseProvider(),
      fetchPullRequests: () => Promise.reject(new Error('DNS resolution failed')),
    };

    await expect(ForgeSync.populateNodeData(provider, makeStack(), MOCK_PROJECT)).rejects.toThrow(/DNS/);
  });
});

// ── createPullRequest failure during publish ─────────────────────────────────

describe('Network failure: createPullRequest during publish', () => {
  test('publishStack stops and reports error when first create fails', async () => {
    const provider: GitProvider = {
      ...baseProvider(),
      createPullRequest: () => Promise.reject(new Error('403 Forbidden')),
    };

    const stack = makeStack();
    const result = await ForgeSync.publishStack(provider, stack, 'owner/repo');

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.success).toBe(false);
    expect(result.results[0]!.error).toContain('403');
  });

  test('publishStack stops at first failure and does not attempt subsequent branches', async () => {
    let createCallCount = 0;
    const provider: GitProvider = {
      ...baseProvider(),
      createPullRequest: async () => {
        createCallCount++;
        if (createCallCount === 1) {
          return mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' });
        }
        throw new Error('Rate limited');
      },
    };

    const stack = makeStack();
    const result = await ForgeSync.publishStack(provider, stack, 'owner/repo');

    // First succeeds, second fails
    expect(result.results).toHaveLength(2);
    expect(result.results[0]!.success).toBe(true);
    expect(result.results[1]!.success).toBe(false);
    expect(result.results[1]!.error).toContain('Rate limited');
    expect(createCallCount).toBe(2);
  });

  test('publishStack returns partial results — stack updated for successful nodes only', async () => {
    let createCallCount = 0;
    const provider: GitProvider = {
      ...baseProvider(),
      createPullRequest: async (input: CreatePullRequestInput) => {
        createCallCount++;
        if (createCallCount === 1) {
          return mockPR({ iid: 10, sourceBranch: input.sourceBranch, targetBranch: input.targetBranch });
        }
        throw new Error('Server error');
      },
    };

    const stack = makeStack();
    const result = await ForgeSync.publishStack(provider, stack, 'owner/repo');

    const aNode = StackManager.findNode(result.updatedStack, 'feat/a')!;
    expect(aNode.mrIid).toBe(10);
    expect(aNode.status).toBe('synced');

    // feat/b was not published — should still be local-only
    const bNode = StackManager.findNode(result.updatedStack, 'feat/b')!;
    expect(bNode.mrIid).toBeNull();
    expect(bNode.status).toBe('local-only');
  });
});

// ── updatePullRequest failure during retarget ────────────────────────────────

describe('Network failure: updatePullRequest during retarget', () => {
  test('retargetMR throws when updatePullRequest fails', async () => {
    const provider: GitProvider = {
      ...baseProvider(),
      updatePullRequest: () => Promise.reject(new Error('422 Unprocessable Entity')),
    };

    let stack = makeStack();
    stack = StackManager.updateNode(stack, 'feat/a', { mrIid: 1 });

    await expect(
      ForgeSync.retargetMR(provider, stack, 'feat/a', 'owner/repo'),
    ).rejects.toThrow(/422/);
  });

  test('retargetMR throws when branch has no MR', async () => {
    const provider = baseProvider();
    const stack = makeStack();

    await expect(
      ForgeSync.retargetMR(provider, stack, 'feat/a', 'owner/repo'),
    ).rejects.toThrow(/no MR/);
  });
});

// ── Intermittent failure patterns ────────────────────────────────────────────

describe('Intermittent failures', () => {
  test('syncStack returns correct data when PRs have partial data', async () => {
    const pr: PullRequest = {
      ...mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' }),
      pipeline: null,
      diffStats: null as any,
    };

    const provider: GitProvider = {
      ...baseProvider(),
      fetchPullRequests: () => Promise.resolve([pr]),
    };

    const stack = makeStack();
    const result = await ForgeSync.syncStack(provider, stack, MOCK_PROJECT);

    const aNode = StackManager.findNode(result.updatedStack, 'feat/a')!;
    expect(aNode.mrIid).toBe(1);
    expect(aNode.pipelineStatus).toBe('unknown');
    expect(aNode.diffStats).toBeNull();
  });

  test('syncStack handles empty PR list gracefully', async () => {
    const provider: GitProvider = {
      ...baseProvider(),
      fetchPullRequests: () => Promise.resolve([]),
    };

    const stack = makeStack();
    const result = await ForgeSync.syncStack(provider, stack, MOCK_PROJECT);

    expect(result.updatedStack.nodes).toHaveLength(2);
    expect(result.reconcile.localOnly).toContain('feat/a');
    expect(result.reconcile.localOnly).toContain('feat/b');
  });

  test('discoverTeamStacks handles empty PR list', async () => {
    const provider: GitProvider = {
      ...baseProvider(),
      fetchPullRequests: () => Promise.resolve([]),
    };

    const result = await ForgeSync.discoverTeamStacks(provider);
    expect(result).toEqual([]);
  });

  test('populateNodeData with prefetched PRs avoids extra API call', async () => {
    let fetchCallCount = 0;
    const prs = [
      mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' }),
    ];

    const provider: GitProvider = {
      ...baseProvider(),
      fetchPullRequests: async () => {
        fetchCallCount++;
        return prs;
      },
    };

    const stack = makeStack();
    await ForgeSync.populateNodeData(provider, stack, MOCK_PROJECT, prs);

    // Should not have called fetchPullRequests since we passed prefetched
    expect(fetchCallCount).toBe(0);
  });
});

// ── validateToken failure ────────────────────────────────────────────────────

describe('Token validation failure', () => {
  test('validateToken failure does not break other operations', async () => {
    const prs = [mockPR({ iid: 1, sourceBranch: 'feat/a', targetBranch: 'main' })];

    const provider: GitProvider = {
      ...baseProvider(),
      validateToken: () => Promise.reject(new Error('Invalid token')),
      fetchPullRequests: () => Promise.resolve(prs),
    };

    // syncStack should still work — it doesn't call validateToken
    const stack = makeStack();
    const result = await ForgeSync.syncStack(provider, stack, MOCK_PROJECT);
    expect(result.updatedStack).toBeDefined();

    const aNode = StackManager.findNode(result.updatedStack, 'feat/a')!;
    expect(aNode.mrIid).toBe(1);
  });
});
