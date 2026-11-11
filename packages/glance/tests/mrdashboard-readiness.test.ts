#!/usr/bin/env bun
/**
 * `getMRDashboardProps` reads the forge-neutral `readiness` when present and
 * falls back to the GitLab merge status when absent. For GitLab-shaped PRs
 * the two paths must agree.
 */
import { describe, expect, test } from 'bun:test';
import { getMRDashboardProps } from '../src/MRDashboard.ts';
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
    ...overrides
  } as unknown as PullRequest;
}

const pipe = (status: string) => ({ id: 1, status, jobs: [] }) as unknown as PullRequest['pipeline'];

const matrix: Array<[string, Partial<PullRequest>]> = [
  ['mergeable', {}],
  ...[...TRANSITIONAL_MERGE_STATUSES].flatMap((s): Array<[string, Partial<PullRequest>]> => [
    [`${s}`, { detailedMergeStatus: s }],
    [`${s} draft`, { detailedMergeStatus: s, draft: true }]
  ]),
  ['checking with conflicts', { detailedMergeStatus: 'checking', conflicts: true }],
  ['checking with failing pipeline', { detailedMergeStatus: 'checking', pipeline: pipe('failed') }],
  ['checking with running pipeline', { detailedMergeStatus: 'checking', pipeline: pipe('running') }],
  ['not_approved', { detailedMergeStatus: 'not_approved', approved: false }],
  ['discussions', { detailedMergeStatus: 'discussions_not_resolved', unresolvedThreadCount: 2 }],
  ['merge error', { detailedMergeStatus: 'mergeable', mergeError: 'boom' }],
  ['needs rebase', { detailedMergeStatus: 'need_rebase', shouldBeRebased: true }],
  ['draft', { detailedMergeStatus: 'draft_status', draft: true }],
  ['merged', { state: 'merged' }],
  ['closed', { state: 'closed' }]
];

describe('GitLab parity matrix', () => {
  test.each(matrix)('%s', (_name, overrides) => {
    const base = stubPR(overrides);
    const withReadiness = getMRDashboardProps({ ...base, readiness: gitlabReadiness(base) });
    const without = getMRDashboardProps(base);
    expect(withReadiness.isReady).toBe(without.isReady);
    expect(withReadiness.status).toBe(without.status);
    expect(withReadiness.isCheckingMergeability).toBe(without.isCheckingMergeability);
    expect(withReadiness.blockers).toEqual(without.blockers);
  });
});

describe('GitHub-shaped readiness', () => {
  test('ready', () => {
    const props = getMRDashboardProps(
      stubPR({ detailedMergeStatus: null, readiness: { state: 'ready', reasons: [] } })
    );
    expect(props.isReady).toBe(true);
    expect(props.status).toBe('mergeable');
    expect(props.readiness).toEqual({ state: 'ready', reasons: [] });
  });

  test('checking is optimistic', () => {
    const checking = { state: 'checking', reasons: [] } as const;
    const ok = getMRDashboardProps(
      stubPR({ detailedMergeStatus: null, readiness: checking, pipeline: pipe('success') })
    );
    expect(ok.isReady).toBe(true);
    expect(ok.isCheckingMergeability).toBe(true);
    expect(ok.status).toBe('mergeable');

    const conflicted = getMRDashboardProps(
      stubPR({ detailedMergeStatus: null, readiness: checking, conflicts: true })
    );
    expect(conflicted.isReady).toBe(false);
    expect(conflicted.status).toBe('blocked');
  });

  test('blocked', () => {
    const props = getMRDashboardProps(
      stubPR({
        detailedMergeStatus: null,
        approved: false,
        readiness: { state: 'blocked', reasons: ['approvals'] }
      })
    );
    expect(props.isReady).toBe(false);
    expect(props.status).toBe('blocked');
  });

  test('absent readiness falls back to today', () => {
    const props = getMRDashboardProps(stubPR({ detailedMergeStatus: null }));
    expect(props.isReady).toBe(false);
    expect(props.readiness).toBeNull();
  });
});
