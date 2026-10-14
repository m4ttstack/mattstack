import type { PeerReviewState } from './peer/peer-reviews.ts';

/** Moves every peer review state's clocks by `shiftMs`, in place. */
export function shiftPeerReviews(
  data: { mrs: Array<{ peerReviews?: PeerReviewState[] }> },
  shiftMs: number
): void {
  for (const mr of data.mrs)
    for (const p of mr.peerReviews ?? []) {
      p.updatedAt += shiftMs;
      if (p.receivedAt !== undefined) p.receivedAt += shiftMs;
    }
}
