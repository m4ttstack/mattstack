import { describe, expect, test } from 'bun:test';
import { getMRDashboardProps } from '../src/MRDashboard.ts';
import { toPullRequestFromNode, type GHFillNode } from '../src/githubFill.ts';
import { ghNode, type DeepPartial } from './helpers/gh-fill-fixture.ts';

function dashboardFor(over: DeepPartial<GHFillNode> = {}) {
  const node = ghNode(over);
  const pr = toPullRequestFromNode(node, {
    roles: ['author'],
    contexts: node.commits.nodes[0]!.commit.statusCheckRollup!.contexts.nodes,
    contextsComplete: true,
    rulesRequired: null
  });
  return getMRDashboardProps(pr);
}

function failingCheck(): DeepPartial<GHFillNode> {
  return {
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              state: 'FAILURE',
              contexts: { nodes: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE', isRequired: true }] }
            }
          }
        }
      ]
    }
  };
}

describe('a GitHub fill node through getMRDashboardProps', () => {
  test('a clean, approved, green PR is mergeable with no blockers', () => {
    const props = dashboardFor();

    expect(props.provider).toBe('github');
    expect(props.state).toBe('opened');
    expect(props.status).toBe('mergeable');
    expect(props.isReady).toBe(true);
    expect(props.isCheckingMergeability).toBe(false);
    expect(props.pipeline?.status).toBe('success');
    expect(props.reviews.isApproved).toBe(true);
    expect(props.blockers.any).toBe(false);
  });

  test('a conflicting PR is blocked by its conflicts', () => {
    const props = dashboardFor({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' });

    expect(props.status).toBe('blocked');
    expect(props.isReady).toBe(false);
    expect(props.blockers.hasConflicts).toBe(true);
    expect(props.blockers.any).toBe(true);
  });

  test('a draft PR reads as draft whatever its merge state', () => {
    const props = dashboardFor({ isDraft: true, mergeStateStatus: 'DRAFT' });

    expect(props.state).toBe('draft');
    expect(props.status).toBe('draft');
    expect(props.blockers.isDraft).toBe(true);
  });

  test('a failing required check blocks the PR and fails its pipeline', () => {
    const props = dashboardFor({ ...failingCheck(), mergeStateStatus: 'BLOCKED' });

    expect(props.status).toBe('blocked');
    expect(props.pipeline?.status).toBe('failed');
    expect(props.blockers.pipelineFailing).toBe(true);
  });

  test('a PR still waiting on its required approval is blocked on approvals', () => {
    const props = dashboardFor({
      mergeStateStatus: 'BLOCKED',
      reviewDecision: 'REVIEW_REQUIRED',
      latestReviews: { nodes: [] },
      latestOpinionatedReviews: { nodes: [] }
    });

    expect(props.status).toBe('blocked');
    expect(props.reviews.isApproved).toBe(false);
    expect(props.blockers.awaitingApprovals).toBe(true);
  });

  test('a merged PR reads as merged', () => {
    const props = dashboardFor({ state: 'MERGED', mergedAt: '2026-01-03T00:00:00Z' });

    expect(props.state).toBe('merged');
    expect(props.status).toBe('merged');
  });

  test('a closed PR reads as closed', () => {
    const props = dashboardFor({ state: 'CLOSED' });

    expect(props.state).toBe('closed');
    expect(props.status).toBe('closed');
  });
});
