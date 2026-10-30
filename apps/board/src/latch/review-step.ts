/**
 * What a finished review does to its reviewer's latch: it lands the follow-up
 * a running latch waits on, a comment outcome arms a fresh latch, an approve
 * outcome spends every copy. Only latches `self` posted are read or touched,
 * so reviewers on the same MR never block or spend each other's.
 */
import type { Database } from 'bun:sqlite';

import type { MRDetail } from '@mattstack/glance';
import { getStateDb } from '../state/index.ts';
import { findLatches, hasLiveLatch } from './discussions.ts';
import { landFollowUp, spendForApproval } from './land.ts';
import { putLatchRow, readLatchRow } from './latch-state.ts';
import { postLatch, type LatchGateway } from './post.ts';

export interface ReviewLatchStep {
  /** null: the review ended done with no verdict (an abandoned post gate). */
  outcome: 'comment' | 'approve' | null;
  /** board.reReview: whether a comment may arm a fresh latch. Landing a
      follow-up and spending never depend on it. */
  arm: boolean;
  /** runStamp of the finished review; null when the lane no longer reads
      done, so this signal cannot vouch for the run and nothing lands. */
  reviewRunStartedAt: number | null;
  /** The reviewer's discussions created at or after `launchAt`, fresh from
      GitLab; null when they cannot be read. */
  countNew: (launchAt: number) => Promise<number | null>;
  self: string;
  /** Usernames GitLab lists as approvers of the MR. */
  approvedBy: string[];
  detail: MRDetail;
  gateway: LatchGateway;
  projectId: number;
  projectPath: string;
  mrUrl: string;
  iid: number;
  now?: number;
  /** The board's state db; the default is the live one. */
  db?: Database;
}

export async function applyReviewLatch(
  s: ReviewLatchStep
): Promise<'posted' | 'spent' | 'landed' | 'none'> {
  const db = s.db ?? getStateDb();
  const now = s.now ?? Date.now();
  const latches = findLatches(s.detail, s.self);
  const mr = {
    projectId: s.projectId,
    projectPath: s.projectPath,
    mrUrl: s.mrUrl,
    iid: s.iid,
  };
  const row = readLatchRow(s.mrUrl, db);
  if (
    row &&
    (row.phase === 'running' || row.phase === 'error') &&
    s.reviewRunStartedAt !== null
  ) {
    const launchAt = row.launchAt;
    const landed = await landFollowUp(
      {
        target: {
          ...mr,
          discussionId: row.discussionId,
          rootNoteId: row.rootNoteId,
        },
        outcome: s.outcome,
        reviewRunStartedAt: s.reviewRunStartedAt,
        gateway: s.gateway,
        self: s.self,
        countNew: () =>
          launchAt === null ? Promise.resolve(null) : s.countNew(launchAt),
        now,
        latches,
      },
      db
    );
    if (landed === 'landed') return 'landed';
  }
  if (s.outcome === 'approve') {
    // Every copy, not just the canonical one: an armed duplicate left behind
    // here is unreachable to the triage pass's repair step once the canon it
    // stops at is spent.
    if (latches.length === 0) return 'none';
    await spendForApproval(
      s.gateway,
      mr,
      latches,
      readLatchRow(s.mrUrl, db),
      now,
      db
    );
    return 'spent';
  }
  if (s.outcome !== 'comment' || !s.arm) return 'none';
  // A standing GitLab approval from this reviewer makes the triage pass spend
  // any armed latch of theirs on its next tick, so posting one here would
  // only show the author a latch that turns into an approval at once.
  const self = s.self.toLowerCase();
  if (s.approvedBy.some(u => u.toLowerCase() === self)) return 'none';
  // A spent latch must never suppress a fresh post, or the feature disables
  // itself forever the first time a latch is ever spent. A live row does:
  // the discussion read can lag the row's latch.
  if (hasLiveLatch(latches)) return 'none';
  const live = readLatchRow(s.mrUrl, db);
  if (live && live.phase !== 'spent') return 'none';
  const { discussionId, rootNoteId } = await postLatch(
    s.gateway,
    s.projectId,
    s.projectPath,
    s.mrUrl,
    s.iid,
    db
  );
  putLatchRow(
    {
      mrUrl: s.mrUrl,
      discussionId,
      rootNoteId,
      phase: 'armed',
      wait: null,
      launchAt: null,
      failures: 0,
      stuck: false,
      variant: 'armed',
      replyDue: null,
      updatedAt: now,
    },
    db
  );
  return 'posted';
}
