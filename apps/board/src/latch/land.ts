/**
 * Landing a finished follow-up review on the latch it was launched for. The
 * server's done signal and the latch pass's backstop both call this; the
 * compare-and-set on the row lets exactly one of them write the note and
 * post the reply.
 */
import type { Database } from 'bun:sqlite';

import type { MRDetail } from '@mattstack/glance';
import { getStateDb } from '../state/index.ts';
import type { LatchRef } from './discussions.ts';
import {
  casLatch,
  readLatchRow,
  type LatchPhase,
  type LatchRow,
} from './latch-state.ts';
import { latchKindOf } from './markers.ts';
import {
  rewriteLatch,
  spendAllLatches,
  spendLatch,
  type LatchGateway,
  type LatchTarget,
} from './post.ts';
import { variantKey, type BannerVariant } from './variants.ts';

export interface LandInput {
  target: LatchTarget;
  outcome: 'comment' | 'approve' | null;
  /** runStamp(review) of the review that finished. */
  reviewRunStartedAt: number;
  gateway: LatchGateway;
  self: string;
  /** The reviewer's discussions created at or after launchAt, fresh from
      GitLab; null when they cannot be read. */
  countNew: () => Promise<number | null>;
  now: number;
  /** Every latch copy of this reviewer's found on the MR. An approve landing
      spends all but the target as approved, so an extra cannot strand live
      once the canon is spent. */
  latches?: LatchRef[];
}

export type LandResult = 'landed' | 'not-mine' | 'none';

const DONE_APPROVED: BannerVariant = { state: 'done-approved' };
const ARMED: BannerVariant = { state: 'armed' };

function check(row: LatchRow | null, i: LandInput): LandResult | 'ok' {
  if (!row || (row.phase !== 'running' && row.phase !== 'error')) return 'none';
  if (row.discussionId !== i.target.discussionId) return 'not-mine';
  // A first launch that failed never stamped one, so no review can be shown
  // to be this latch's follow-up.
  if (row.launchAt === null || i.reviewRunStartedAt < row.launchAt)
    return 'not-mine';
  return 'ok';
}

export function finishedReply(
  outcome: 'comment' | 'approve',
  count: number | null
): string {
  if (outcome === 'approve') return 'Follow-up review done: approved.';
  if (count == null || count <= 0) return 'Follow-up review done.';
  return count === 1
    ? 'Follow-up review done: 1 new comment.'
    : `Follow-up review done: ${count} new comments.`;
}

export async function landFollowUp(
  i: LandInput,
  db: Database = getStateDb()
): Promise<LandResult> {
  const { target, now } = i;
  const first = check(readLatchRow(target.mrUrl, db), i);
  if (first !== 'ok') return first;

  const count = i.outcome === 'comment' ? await i.countNew() : null;
  const variant: BannerVariant =
    i.outcome === 'approve'
      ? DONE_APPROVED
      : i.outcome === 'comment'
        ? { state: 'done-comments', count }
        : ARMED;
  const key = variantKey(variant);
  const patch: Partial<Omit<LatchRow, 'mrUrl'>> =
    i.outcome === 'approve'
      ? { phase: 'spent', variant: key }
      : {
          phase: 'armed',
          failures: 0,
          stuck: false,
          wait: null,
          launchAt: null,
          variant: key,
        };

  // The re-check and the move share one write transaction: a retry that
  // re-stamped launchAt since the first read must not be landed by an older
  // review.
  const from = db
    .transaction((): LatchPhase | null => {
      const row = readLatchRow(target.mrUrl, db);
      if (check(row, i) !== 'ok') return null;
      const moved = casLatch(
        target.mrUrl,
        ['running', 'error'],
        patch,
        now,
        db,
        { discussionId: target.discussionId }
      );
      return moved ? row!.phase : null;
    })
    .immediate();
  if (from === null) return 'none';

  if (i.outcome === 'approve') {
    const latch: LatchRef = {
      discussionId: target.discussionId,
      rootNoteId: target.rootNoteId,
      kind: from,
      resolved: true,
      createdAt: '',
      body: '',
    };
    await spendLatch(
      i.gateway,
      target.projectId,
      target.projectPath,
      target.mrUrl,
      target.iid,
      latch,
      variant,
      now,
      db
    );
  } else {
    await rewriteLatch(
      i.gateway,
      target,
      'armed',
      variant,
      'unresolve',
      now,
      db
    );
  }
  if (i.outcome) {
    await i.gateway.createNote(
      target.projectId,
      target.iid,
      finishedReply(i.outcome, count),
      target.discussionId
    );
  }
  if (i.outcome === 'approve') {
    await spendAllLatches(
      i.gateway,
      target.projectId,
      target.projectPath,
      target.mrUrl,
      target.iid,
      (i.latches ?? []).filter(l => l.discussionId !== target.discussionId),
      { state: 'approved' },
      now,
      db
    );
  }
  return 'landed';
}

/** The reviewer's own threads opened at or after `launchAt`, leaving out
    latch threads and system notes. */
export function countNewDiscussions(
  detail: MRDetail,
  self: string,
  launchAt: number
): number {
  const owner = self.toLowerCase();
  let n = 0;
  for (const d of detail.discussions) {
    const root = d.notes[0];
    if (!root || root.system) continue;
    if (root.author?.username.toLowerCase() !== owner) continue;
    if (latchKindOf(root.body ?? '')) continue;
    const at = Date.parse(root.createdAt);
    if (Number.isFinite(at) && at >= launchAt) n++;
  }
  return n;
}

/** countNewDiscussions over a fresh read; null when the read fails. */
export async function fetchNewDiscussionCount(
  fetchDetail: () => Promise<MRDetail>,
  self: string,
  launchAt: number
): Promise<number | null> {
  try {
    return countNewDiscussions(await fetchDetail(), self, launchAt);
  } catch {
    return null;
  }
}

/** An approval spends every copy. The copy a landing already marked
    done-approved keeps that banner, so a later spend from a stale read
    cannot turn the follow-up's verdict back into a plain approval. */
export async function spendForApproval(
  gw: LatchGateway,
  mr: Pick<LatchTarget, 'projectId' | 'projectPath' | 'mrUrl' | 'iid'>,
  latches: LatchRef[],
  row: LatchRow | null,
  now: number,
  db: Database = getStateDb()
): Promise<void> {
  const landed =
    row?.phase === 'spent' && row.variant === variantKey(DONE_APPROVED)
      ? row.discussionId
      : null;
  const own = latches.find(l => l.discussionId === landed);
  if (own) {
    await spendLatch(
      gw,
      mr.projectId,
      mr.projectPath,
      mr.mrUrl,
      mr.iid,
      own,
      DONE_APPROVED,
      now,
      db
    );
  }
  await spendAllLatches(
    gw,
    mr.projectId,
    mr.projectPath,
    mr.mrUrl,
    mr.iid,
    latches.filter(l => l.discussionId !== landed),
    { state: 'approved' },
    now,
    db
  );
}
