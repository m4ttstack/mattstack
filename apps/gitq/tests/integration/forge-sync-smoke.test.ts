import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { ForgeSync } from '../../src/core/forge-sync.ts';
import { StackManager } from '../../src/core/stack-manager.ts';
import type { GitProvider, PullRequest } from '@workforge/glance-sdk';
import {
  createSandboxRepo,
  cleanupRepo,
  commit,
  buildLinearStack,
  buildTreeStack,
  type SandboxRepo,
} from './helpers.ts';

mock.restore();

let repo: SandboxRepo;

beforeAll(async () => {
  repo = await createSandboxRepo();
});

afterAll(async () => {
  await cleanupRepo(repo.dir);
});

// ── Mock helpers ─────────────────────────────────────────────────────────────

/** The project these fixtures' web URLs belong to; the sync entry points scope to it. */
const MOCK_PROJECT = 'acme/app';

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
    webUrl: overrides.webUrl ?? `https://gitlab.com/${MOCK_PROJECT}/-/merge_requests/${overrides.iid ?? 1}`,
    sourceBranch: overrides.sourceBranch,
    targetBranch: overrides.targetBranch,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    sha: overrides.sha ?? 'abc123',
    author: overrides.author ?? { id: 'gitlab:user:1', username: 'dev', name: 'Dev', avatarUrl: null },
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ForgeSync smoke: populateNodeData with real stack', () => {
  test('populates nodes matching real branch names with mock PR data', async () => {
    const r = await createSandboxRepo();
    try {
      const { stack } = await buildLinearStack(r.dir, r.git, 3);

      // Create mock PRs that match the real branch names
      const prs = [
        mockPR({
          iid: 10,
          sourceBranch: 'feat/branch-1',
          targetBranch: 'main',
          pipeline: { id: 'p1', status: 'success', createdAt: null, webUrl: null, jobs: [] },
          diffStats: { additions: 42, deletions: 10, filesChanged: 3 },
          unresolvedThreadCount: 2,
        }),
        mockPR({
          iid: 11,
          sourceBranch: 'feat/branch-2',
          targetBranch: 'feat/branch-1',
          pipeline: { id: 'p2', status: 'running', createdAt: null, webUrl: null, jobs: [] },
        }),
        mockPR({
          iid: 12,
          sourceBranch: 'feat/branch-3',
          targetBranch: 'feat/branch-2',
        }),
      ];

      const provider = mockProvider(prs);
      const updated = await ForgeSync.populateNodeData(provider, stack, MOCK_PROJECT);

      // Verify branch-1 has full PR data
      const b1 = StackManager.findNode(updated, 'feat/branch-1')!;
      expect(b1.mrIid).toBe(10);
      expect(b1.status).toBe('synced');
      expect(b1.pipelineStatus).toBe('success');
      expect(b1.diffStats).toEqual({ additions: 42, deletions: 10, filesChanged: 3 });
      expect(b1.unresolvedThreads).toBe(2);

      // Verify branch-2 has PR data
      const b2 = StackManager.findNode(updated, 'feat/branch-2')!;
      expect(b2.mrIid).toBe(11);
      expect(b2.status).toBe('synced');
      expect(b2.pipelineStatus).toBe('running');

      // Verify branch-3 has PR data
      const b3 = StackManager.findNode(updated, 'feat/branch-3')!;
      expect(b3.mrIid).toBe(12);
      expect(b3.status).toBe('synced');
    } finally {
      await cleanupRepo(r.dir);
    }
  });
});

describe('ForgeSync smoke: reconcile detects drift against real stack', () => {
  test('detects drift when mock PR target differs from real stack parent', async () => {
    const r = await createSandboxRepo();
    try {
      const { stack } = await buildLinearStack(r.dir, r.git, 2);

      // feat/branch-2's parent in the stack is feat/branch-1
      // But the mock PR targets main directly (drift)
      const prs = [
        mockPR({ iid: 1, sourceBranch: 'feat/branch-1', targetBranch: 'main' }),
        mockPR({ iid: 2, sourceBranch: 'feat/branch-2', targetBranch: 'main' }), // drift!
      ];

      const result = await ForgeSync.reconcile(mockProvider(prs), stack, MOCK_PROJECT);

      expect(result.drifts).toHaveLength(1);
      expect(result.drifts[0]!.branch).toBe('feat/branch-2');
      expect(result.drifts[0]!.localParent).toBe('feat/branch-1');
      expect(result.drifts[0]!.forgeTarget).toBe('main');
      expect(result.localOnly).toEqual([]);
    } finally {
      await cleanupRepo(r.dir);
    }
  });
});

describe('ForgeSync smoke: syncStack end-to-end with real stack', () => {
  test('detects newly merged branches and pipeline changes against real stack', async () => {
    const r = await createSandboxRepo();
    try {
      const { stack: rawStack } = await buildLinearStack(r.dir, r.git, 2);

      // Pre-set branch-1 as synced with a running pipeline
      let stack = StackManager.updateNode(rawStack, 'feat/branch-1', {
        mrIid: 1,
        status: 'synced',
        pipelineStatus: 'running',
      });
      stack = StackManager.updateNode(stack, 'feat/branch-2', {
        mrIid: 2,
        status: 'synced',
        pipelineStatus: 'pending',
      });

      // Mock: branch-1 is now merged, branch-2 pipeline changed to success
      const prs = [
        mockPR({ iid: 1, sourceBranch: 'feat/branch-1', targetBranch: 'main', state: 'merged' }),
        mockPR({
          iid: 2,
          sourceBranch: 'feat/branch-2',
          targetBranch: 'feat/branch-1',
          pipeline: { id: 'p1', status: 'success', createdAt: null, webUrl: null, jobs: [] },
        }),
      ];

      const result = await ForgeSync.syncStack(mockProvider(prs), stack, MOCK_PROJECT);

      // branch-1 should be newly merged
      expect(result.newlyMerged).toEqual(['feat/branch-1']);
      expect(StackManager.findNode(result.updatedStack, 'feat/branch-1')!.status).toBe('merged');

      // pipeline change: branch-2 went from pending to success
      expect(result.pipelineChanges).toHaveLength(1);
      expect(result.pipelineChanges[0]!.branch).toBe('feat/branch-2');
      expect(result.pipelineChanges[0]!.from).toBe('pending');
      expect(result.pipelineChanges[0]!.to).toBe('success');
    } finally {
      await cleanupRepo(r.dir);
    }
  });
});

describe('ForgeSync smoke: publishStack with real stack structure', () => {
  test('creates MRs in topological order matching the real branch graph', async () => {
    const r = await createSandboxRepo();
    try {
      const { stack } = await buildTreeStack(r.dir, r.git, [
        {
          name: 'feat/a',
          commits: 1,
          children: [
            { name: 'feat/b', commits: 1 },
            { name: 'feat/c', commits: 1 },
          ],
        },
      ]);

      const createdOrder: string[] = [];
      let nextIid = 100;

      const provider: GitProvider = {
        ...mockProvider([]),
        createPullRequest: async (input) => {
          createdOrder.push(input.sourceBranch);
          const iid = nextIid++;
          return mockPR({
            iid,
            sourceBranch: input.sourceBranch,
            targetBranch: input.targetBranch,
            webUrl: `https://gitlab.com/-/mr/${iid}`,
          });
        },
      };

      const result = await ForgeSync.publishStack(provider, stack, 'owner/repo');

      // All 3 branches should be published
      expect(result.results).toHaveLength(3);
      expect(result.results.every((r) => r.success)).toBe(true);

      // feat/a must be created before feat/b and feat/c (topological order)
      expect(createdOrder.indexOf('feat/a')).toBeLessThan(createdOrder.indexOf('feat/b'));
      expect(createdOrder.indexOf('feat/a')).toBeLessThan(createdOrder.indexOf('feat/c'));

      // Verify updated stack has MR data
      const aNode = StackManager.findNode(result.updatedStack, 'feat/a')!;
      expect(aNode.mrIid).toBe(100);
      expect(aNode.status).toBe('synced');
    } finally {
      await cleanupRepo(r.dir);
    }
  });
});
