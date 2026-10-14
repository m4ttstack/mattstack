import { expect, test } from 'bun:test';

import { shiftPeerReviews } from '../fixture-peer-reviews.ts';
import type { PeerReviewState } from '../peer/peer-reviews.ts';

const state = (over: Partial<PeerReviewState>): PeerReviewState => ({
  mrUrl: 'https://gitlab.example.com/g/p/-/merge_requests/1',
  iid: 1,
  reviewer: 'kim',
  status: 'reviewing',
  updatedAt: 1000,
  ...over,
});

test('shifts updatedAt and receivedAt, leaving a missing receivedAt unset', () => {
  const data = {
    mrs: [{ peerReviews: [state({ receivedAt: 2000 }), state({})] }, {}],
  };
  shiftPeerReviews(data, 500);
  const [a, b] = data.mrs[0]!.peerReviews!;
  expect(a).toMatchObject({ updatedAt: 1500, receivedAt: 2500 });
  expect(b!.updatedAt).toBe(1500);
  expect(b!.receivedAt).toBeUndefined();
});
