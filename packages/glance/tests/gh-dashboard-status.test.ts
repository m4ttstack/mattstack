import { describe, expect, test } from 'bun:test';
import { getMRDashboardProps } from '../src/MRDashboard.ts';
import { toPullRequestFromNode, type GHFillNode } from '../src/githubFill.ts';
import { ghNode, type DeepPartial } from './helpers/gh-fill-fixture.ts';

function dashboardFor(over: DeepPartial<GHFillNode> = {}, contextsComplete = true) {
  const node = ghNode(over);
  const pr = toPullRequestFromNode(node, {
    roles: ['author'],
    contexts: node.commits.nodes[0]!.commit.statusCheckRollup!.contexts.nodes,
    contextsComplete,
    rulesRequired: null
  });
  return getMRDashboardProps(pr);
}

/** The default node's one check run, completed with `conclusion` and its rollup set to `state`. */
function checkConcluded(conclusion: string, state: string, isRequired = true): DeepPartial<GHFillNode> {
  const commit = ghNode().commits.nodes[0]!.commit;
  const rollup = commit.statusCheckRollup!;
  return {
    commits: {
      nodes: [
        {
          commit: {
            ...commit,
            statusCheckRollup: {
              ...rollup,
              state,
              contexts: {
                ...rollup.contexts,
                nodes: rollup.contexts.nodes.map((n) => ({ ...n, conclusion, isRequired }))
              }
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
    const props = dashboardFor({ ...checkConcluded('FAILURE', 'FAILURE'), mergeStateStatus: 'BLOCKED' });

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

  test('a PR behind its base is blocked until it is rebased', () => {
    const props = dashboardFor({ mergeStateStatus: 'BEHIND' });

    expect(props.status).toBe('blocked');
    expect(props.blockers.needsRebase).toBe(true);
  });

  test('a failing check that is not required leaves the PR mergeable', () => {
    const props = dashboardFor({ ...checkConcluded('FAILURE', 'FAILURE', false), mergeStateStatus: 'UNSTABLE' });

    expect(props.readiness?.state).toBe('ready');
    expect(props.status).toBe('mergeable');
    expect(props.isReady).toBe(true);
  });

  test('an undecided merge state reads as checking and stays mergeable', () => {
    const props = dashboardFor({ mergeStateStatus: 'UNKNOWN' });

    expect(props.isCheckingMergeability).toBe(true);
    expect(props.status).toBe('mergeable');
  });

  test('a check list read only in part reads as checking', () => {
    const props = dashboardFor({}, false);

    expect(props.readiness?.state).toBe('checking');
    expect(props.isCheckingMergeability).toBe(true);
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
