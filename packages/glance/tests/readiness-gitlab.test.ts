#!/usr/bin/env bun
/**
 * `readiness` is the forge-neutral merge verdict. For GitLab it is derived
 * from signals the PullRequest already carries; nothing new is fetched.
 */
import { describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';
import { gitlabReadiness } from '../src/readiness.ts';
import { TRANSITIONAL_MERGE_STATUSES } from '../src/types.ts';
import type { PullRequest, UserRef } from '../src/types.ts';

const user: UserRef = { id: 'gitlab:user:1', username: 'a', name: 'a', avatarUrl: null };

function stubPR(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 'gitlab:mr:1',
    iid: 1,
    repositoryId: 'gitlab:1',
    title: 'MR 1',
    description: null,
    state: 'opened',
    draft: false,
    conflicts: false,
    webUrl: null,
    sourceBranch: 'feat/1',
    targetBranch: 'main',
    createdAt: null,
    updatedAt: null,
    sha: null,
    author: user,
    assignees: [],
    reviewers: [],
    roles: ['author'],
    pipeline: null,
    unresolvedThreadCount: 0,
    approvalsLeft: 0,
    approved: true,
    approvedBy: [user],
    diffStats: null,
    detailedMergeStatus: 'mergeable',
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
    approvalsRequired: 1,
    squash: false,
    squashOnMerge: false,
    mergeTrainIndex: null,
    ...overrides,
  };
}

const pipeline = (status: string) =>
  ({ id: 'p', status, jobs: [] }) as unknown as PullRequest['pipeline'];

describe('gitlabReadiness', () => {
  test('mergeable status reads ready with no reasons', () => {
    expect(gitlabReadiness(stubPR())).toEqual({ state: 'ready', reasons: [] });
  });

  test('each transitional status reads checking', () => {
    for (const status of TRANSITIONAL_MERGE_STATUSES) {
      expect(gitlabReadiness(stubPR({ detailedMergeStatus: status })).state).toBe('checking');
    }
  });

  test('not_approved reads blocked with approvals', () => {
    const r = gitlabReadiness(stubPR({ detailedMergeStatus: 'not_approved', approved: false }));
    expect(r.state).toBe('blocked');
    expect(r.reasons).toContain('approvals');
  });

  test('conflict plus failed pipeline names both', () => {
    const r = gitlabReadiness(
      stubPR({ detailedMergeStatus: 'conflict', conflicts: true, pipeline: pipeline('failed') }),
    );
    expect(r).toEqual({ state: 'blocked', reasons: ['conflicts', 'checks-failing'] });
  });

  test('behind, running checks and a merge error are named in union order', () => {
    const r = gitlabReadiness(
      stubPR({
        detailedMergeStatus: 'need_rebase',
        shouldBeRebased: true,
        pipeline: pipeline('running'),
        mergeError: 'boom',
      }),
    );
    expect(r.reasons).toEqual(['behind', 'checks-running', 'merge-error']);
  });

  test('DISCUSSIONS_NOT_RESOLVED FAILED names threads; INACTIVE with open threads does not', () => {
    const failed = gitlabReadiness(
      stubPR({
        detailedMergeStatus: 'discussions_not_resolved',
        mergeabilityChecks: [{ identifier: 'DISCUSSIONS_NOT_RESOLVED', status: 'FAILED' }],
      }),
    );
    expect(failed.reasons).toEqual(['threads']);

    const inactive = gitlabReadiness(
      stubPR({
        detailedMergeStatus: 'jira_association_missing',
        unresolvedThreadCount: 3,
        mergeabilityChecks: [{ identifier: 'DISCUSSIONS_NOT_RESOLVED', status: 'INACTIVE' }],
      }),
    );
    expect(inactive.reasons).not.toContain('threads');
  });

  test('a blocked status with no known cause reads other', () => {
    expect(gitlabReadiness(stubPR({ detailedMergeStatus: 'jira_association_missing' }))).toEqual({
      state: 'blocked',
      reasons: ['other'],
    });
  });

  test('draft, merged and closed take their own state with empty reasons', () => {
    expect(gitlabReadiness(stubPR({ draft: true, conflicts: true }))).toEqual({
      state: 'draft',
      reasons: [],
    });
    expect(gitlabReadiness(stubPR({ state: 'merged', detailedMergeStatus: null }))).toEqual({
      state: 'merged',
      reasons: [],
    });
    expect(gitlabReadiness(stubPR({ state: 'closed', detailedMergeStatus: null }))).toEqual({
      state: 'closed',
      reasons: [],
    });
  });
});

describe('GitLabProvider attaches readiness', () => {
  test('toMR attaches readiness', async () => {
    const gqlUser = { id: 'gid://gitlab/User/1', username: 'a', name: 'a', avatarUrl: null };
    const node = {
      id: 'gid://gitlab/MergeRequest/9',
      iid: '9',
      projectId: 3,
      title: 't',
      description: null,
      state: 'opened',
      draft: false,
      sourceBranch: 's',
      targetBranch: 'main',
      webUrl: 'https://gitlab.example/g/p/-/merge_requests/9',
      diffHeadSha: null,
      updatedAt: '2026-01-01T00:00:00Z',
      createdAt: '2026-01-01T00:00:00Z',
      conflicts: true,
      detailedMergeStatus: 'CONFLICT',
      approved: true,
      diffStatsSummary: null,
      author: gqlUser,
      assignees: { nodes: [] },
      reviewers: { nodes: [] },
      approvedBy: { nodes: [] },
      approvalsLeft: 0,
      resolvableDiscussionsCount: 0,
      resolvedDiscussionsCount: 0,
      mergeabilityChecks: [],
      headPipeline: null,
    };
    const provider = new GitLabProvider('https://gitlab.example', 't');
    (provider as any).runQuery = async () => ({ project: { mergeRequests: { nodes: [node] } } });

    const [pr] = await provider.fetchPullRequests({ projectPath: 'g/p', iids: [9] });
    expect(pr!.readiness).toEqual({ state: 'blocked', reasons: ['conflicts'] });
    expect(pr!.readiness).toEqual(gitlabReadiness(pr!));
  });
});
