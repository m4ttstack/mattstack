import type { GateRow, RtResponse } from '@mattstack/rt-client';
import { domainForKind } from './sweep.ts';

export interface DropReviewIo {
  rows(): GateRow[];
  gateClose(payload: {
    id: string;
    reason: 'abandoned';
  }): Promise<RtResponse<unknown>>;
  reviewTabId(mrUrl: string): string | undefined;
  closeTab(tabId: string): Promise<void>;
  dismissReview(mrUrl: string): void;
  logError(message: string): void;
}

/** The operator's "drop review": closes every open or parked review gate on
    the MR as abandoned, so it leaves the decision queue without posting.
    A parked gate's pane is already gone; an open one's pane is still
    waiting on the gate, so its tab closes too. */
export async function dropReview(
  mrUrl: string,
  io: DropReviewIo
): Promise<{ closed: number }> {
  const subject = `mr:${mrUrl}`;
  const targets = io
    .rows()
    .filter(
      row =>
        row.subject === subject &&
        domainForKind(row.kind) === 'review' &&
        (row.status === 'open' || row.status === 'parked')
    );
  let closed = 0;
  let closedOpen = false;
  for (const row of targets) {
    try {
      const res = await io.gateClose({ id: row.id, reason: 'abandoned' });
      if (!res.ok) continue;
      closed++;
      if (row.status === 'open') closedOpen = true;
    } catch (err) {
      io.logError(
        `drop review: gateClose(${row.id}) failed for ${mrUrl}: ${err instanceof Error ? err.message : err}`
      );
    }
  }
  if (closed === 0) return { closed };
  const tabId = closedOpen ? io.reviewTabId(mrUrl) : undefined;
  if (tabId)
    await io
      .closeTab(tabId)
      .catch(err =>
        io.logError(
          `drop review: closeTab(${tabId}) failed for ${mrUrl}: ${err instanceof Error ? err.message : err}`
        )
      );
  io.dismissReview(mrUrl);
  return { closed };
}
