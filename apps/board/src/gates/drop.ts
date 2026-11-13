import type { GateRow, RtResponse } from '@mattstack/rt-client';
import { domainForKind } from './sweep.ts';

/** The slice of the review lane a drop reads to tell the current run's
    gates from an older run's. */
export interface DropReviewLane {
  gateId?: string;
  runStartedAt?: number;
  tabId?: string;
}

export interface DropReviewIo {
  rows(): GateRow[];
  gateClose(payload: {
    id: string;
    reason: 'abandoned';
  }): Promise<RtResponse<unknown>>;
  reviewLane(mrUrl: string): DropReviewLane | undefined;
  closeTab(tabId: string): Promise<void>;
  /** Ends the lane's run quietly: the wrapper writes no status when its
      gate closes, so a lane left reviewing reads as interrupted. */
  settleReview(mrUrl: string): void;
  logError(message: string): void;
}

function ofCurrentRun(row: GateRow, lane: DropReviewLane | undefined) {
  if (!lane) return false;
  if (lane.gateId === row.id) return true;
  return lane.runStartedAt !== undefined && row.openedAt >= lane.runStartedAt;
}

/** The operator's "discard review": closes every open or parked review gate
    on the MR as abandoned, so it leaves the decision queue without posting.
    Only a gate from the lane's current run settles the lane, and only its
    open gate closes the pane: an older run's gate can sit beside a newer
    run that is still working. */
export async function dropReview(
  mrUrl: string,
  io: DropReviewIo
): Promise<{ closed: number; failed: number }> {
  const subject = `mr:${mrUrl}`;
  const lane = io.reviewLane(mrUrl);
  const targets = io
    .rows()
    .filter(
      row =>
        row.subject === subject &&
        domainForKind(row.kind) === 'review' &&
        (row.status === 'open' || row.status === 'parked')
    );
  let closed = 0;
  let failed = 0;
  let currentClosed = false;
  let currentOpenClosed = false;
  for (const row of targets) {
    try {
      const res = await io.gateClose({ id: row.id, reason: 'abandoned' });
      if (!res.ok) {
        failed++;
        io.logError(
          `discard review: gateClose(${row.id}) refused for ${mrUrl}: ${res.error}`
        );
        continue;
      }
      closed++;
      if (ofCurrentRun(row, lane)) {
        currentClosed = true;
        if (row.status === 'open') currentOpenClosed = true;
      }
    } catch (err) {
      failed++;
      io.logError(
        `discard review: gateClose(${row.id}) failed for ${mrUrl}: ${err instanceof Error ? err.message : err}`
      );
    }
  }
  if (!currentClosed) return { closed, failed };
  const tabId = currentOpenClosed ? lane?.tabId : undefined;
  if (tabId)
    await io
      .closeTab(tabId)
      .catch(err =>
        io.logError(
          `discard review: closeTab(${tabId}) failed for ${mrUrl}: ${err instanceof Error ? err.message : err}`
        )
      );
  io.settleReview(mrUrl);
  return { closed, failed };
}
