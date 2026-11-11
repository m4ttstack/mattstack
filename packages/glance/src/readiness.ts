import type { PullRequest, Readiness, ReadinessReason } from './types.ts';
import { isTransitionalMergeStatus } from './types.ts';

/**
 * The blockers `getMRDashboardProps` reports, in `ReadinessReason` order.
 * Shared so the dashboard and `readiness` cannot disagree about what blocks.
 */
export function blockerReasons(pr: PullRequest): ReadinessReason[] {
  const reasons: ReadinessReason[] = [];
  if (pr.conflicts) reasons.push('conflicts');
  // `shouldBeRebased` alone: `divergedCommitsCount` is null on most fetch
  // paths and must not read as "not behind" (MAT-164).
  if (pr.shouldBeRebased) reasons.push('behind');
  if (pr.pipeline?.status === 'failed') reasons.push('checks-failing');
  if (pr.pipeline?.status === 'running' || pr.pipeline?.status === 'pending') {
    reasons.push('checks-running');
  }
  if (!pr.approved) reasons.push('approvals');

  // 0.27.0 rule: the DISCUSSIONS_NOT_RESOLVED check decides where the project
  // requires resolution; the count is only a fallback, and a null count is
  // not a blocker.
  const discussionCheck = (pr.mergeabilityChecks ?? []).find(
    (c) => c.identifier === 'DISCUSSIONS_NOT_RESOLVED'
  )?.status;
  const threadsBlock =
    discussionCheck === 'FAILED' ||
    (discussionCheck !== 'INACTIVE' &&
      discussionCheck !== 'SUCCESS' &&
      (pr.unresolvedThreadCount ?? 0) > 0);
  if (threadsBlock) reasons.push('threads');
  if (pr.mergeError != null) reasons.push('merge-error');
  return reasons;
}

/** GitLab readiness from signals the PullRequest already carries. */
export function gitlabReadiness(pr: PullRequest): Readiness {
  if (pr.state === 'merged') return { state: 'merged', reasons: [] };
  if (pr.state === 'closed') return { state: 'closed', reasons: [] };
  if (pr.draft) return { state: 'draft', reasons: [] };
  if (pr.detailedMergeStatus === 'mergeable') return { state: 'ready', reasons: [] };
  if (isTransitionalMergeStatus(pr.detailedMergeStatus)) {
    return { state: 'checking', reasons: [] };
  }
  const reasons = blockerReasons(pr);
  return { state: 'blocked', reasons: reasons.length > 0 ? reasons : ['other'] };
}
