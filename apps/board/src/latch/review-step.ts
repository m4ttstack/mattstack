/**
 * What a finished review does to its reviewer's latch: a comment outcome arms
 * one, an approve outcome spends every copy. Only latches `self` posted are
 * read or touched, so reviewers on the same MR never block or spend each
 * other's.
 */
import type { MRDetail } from '@mattstack/glance';
import { findLatches, hasArmedLatch } from './discussions.ts';
import { postLatch, spendAllLatches, type LatchGateway } from './post.ts';

export interface ReviewLatchStep {
  outcome: 'comment' | 'approve';
  self: string;
  /** Usernames GitLab lists as approvers of the MR. */
  approvedBy: string[];
  detail: MRDetail;
  gateway: LatchGateway;
  projectId: number;
  projectPath: string;
  mrUrl: string;
  iid: number;
}

export async function applyReviewLatch(
  s: ReviewLatchStep
): Promise<'posted' | 'spent' | 'none'> {
  const latches = findLatches(s.detail, s.self);
  if (s.outcome === 'approve') {
    // Every copy, not just the canonical one: an armed duplicate left behind
    // here is unreachable to the triage pass's repair step once the canon it
    // stops at is spent.
    if (latches.length === 0) return 'none';
    await spendAllLatches(
      s.gateway,
      s.projectId,
      s.projectPath,
      s.iid,
      latches
    );
    return 'spent';
  }
  // A standing GitLab approval from this reviewer makes the triage pass spend
  // any armed latch of theirs on its next tick, so posting one here would
  // only show the author a latch that turns into an approval at once.
  const self = s.self.toLowerCase();
  if (s.approvedBy.some(u => u.toLowerCase() === self)) return 'none';
  // A spent latch must never suppress a fresh post, or the feature disables
  // itself forever the first time a latch is ever spent.
  if (hasArmedLatch(latches)) return 'none';
  await postLatch(s.gateway, s.projectId, s.projectPath, s.mrUrl, s.iid);
  return 'posted';
}
