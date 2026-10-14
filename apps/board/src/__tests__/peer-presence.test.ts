import { describe, expect, test } from 'bun:test';

import {
  activePeerReviewer,
  isFreshPeerReview,
  PEER_REVIEW_STALE_MS,
  presenceEnvelopes,
  reviewPresenceRecipients,
  reviewSyncEnvelopes,
} from '../peer/presence.ts';

const URL_A = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';

describe('reviewPresenceRecipients', () => {
  test('every org member but me, author first, filtered to enrolled boards', () => {
    expect(
      reviewPresenceRecipients({
        orgMembers: ['Pat', 'kim', 'mira', 'me', 'ada'],
        self: 'me',
        author: 'kim',
        enrolled: ['pat', 'kim', 'mira', 'me'],
      })
    ).toEqual(['kim', 'pat', 'mira']);
  });

  test('the author is sent even when not enrolled or not on the roster', () => {
    expect(
      reviewPresenceRecipients({
        orgMembers: ['pat'],
        self: 'me',
        author: 'grace',
        enrolled: ['pat'],
      })
    ).toEqual(['grace', 'pat']);
  });

  test('an unknown enrolled list does not filter', () => {
    expect(
      reviewPresenceRecipients({
        orgMembers: ['pat', 'mira'],
        self: 'me',
        author: 'kim',
        enrolled: null,
      })
    ).toEqual(['kim', 'pat', 'mira']);
  });

  test('the author on the roster gets exactly one copy', () => {
    expect(
      reviewPresenceRecipients({
        orgMembers: ['kim', 'KIM ', 'pat'],
        self: 'me',
        author: 'Kim',
        enrolled: null,
      })
    ).toEqual(['kim', 'pat']);
  });
});

describe('presenceEnvelopes', () => {
  const payload = {
    mrUrl: URL_A,
    iid: 4821,
    status: 'reviewing',
    updatedAt: 500,
    nudgeId: 'ask-1',
  };

  test('one review-state per recipient; only the author keeps nudgeId', () => {
    const out = presenceEnvelopes(['kim', 'pat'], 'Kim', payload, 900);
    expect(out.map(e => [e.to, e.type])).toEqual([
      ['kim', 'review-state'],
      ['pat', 'review-state'],
    ]);
    expect((out[0]!.payload as { nudgeId?: string }).nudgeId).toBe('ask-1');
    expect('nudgeId' in (out[1]!.payload as object)).toBe(false);
    expect(new Set(out.map(e => e.id)).size).toBe(2);
  });

  test('never addresses everyone', () => {
    const out = presenceEnvelopes(['kim'], 'kim', payload);
    expect(out.every(e => e.to !== '*')).toBe(true);
  });
});

describe('isFreshPeerReview', () => {
  const NOW = 10 * PEER_REVIEW_STALE_MS;

  test('reviewing within the cutoff is fresh, past it is stale', () => {
    expect(
      isFreshPeerReview(
        { status: 'reviewing', updatedAt: 0, receivedAt: NOW - 1000 },
        NOW
      )
    ).toBe(true);
    expect(
      isFreshPeerReview(
        {
          status: 'reviewing',
          updatedAt: NOW,
          receivedAt: NOW - PEER_REVIEW_STALE_MS - 1,
        },
        NOW
      )
    ).toBe(false);
  });

  test('a legacy row without receivedAt is judged on updatedAt', () => {
    expect(
      isFreshPeerReview({ status: 'queued', updatedAt: NOW - 1000 }, NOW)
    ).toBe(true);
    expect(
      isFreshPeerReview(
        { status: 'queued', updatedAt: NOW - PEER_REVIEW_STALE_MS - 1 },
        NOW
      )
    ).toBe(false);
  });

  test('done and error are never fresh', () => {
    for (const status of ['done', 'error'])
      expect(isFreshPeerReview({ status, updatedAt: NOW }, NOW)).toBe(false);
  });
});

describe('activePeerReviewer', () => {
  const NOW = 10 * PEER_REVIEW_STALE_MS;
  const r = (reviewer: string, status = 'reviewing', receivedAt = NOW) => ({
    reviewer,
    status,
    updatedAt: receivedAt,
    receivedAt,
  });

  test('names the first fresh reviewer who is not me', () => {
    expect(
      activePeerReviewer(
        { peerReviews: [r('me'), r('pat', 'done'), r('mira'), r('ada')] },
        'me',
        NOW
      )
    ).toBe('mira');
  });

  test('null when nobody else is reviewing or the state is stale', () => {
    expect(activePeerReviewer({}, 'me', NOW)).toBeNull();
    expect(
      activePeerReviewer(
        {
          peerReviews: [r('pat', 'reviewing', NOW - PEER_REVIEW_STALE_MS - 1)],
        },
        'me',
        NOW
      )
    ).toBeNull();
  });
});

describe('reviewPresenceRecipients roster', () => {
  test("a literal '*' roster entry is never a recipient", () => {
    expect(
      reviewPresenceRecipients({
        orgMembers: ['*', 'pat'],
        self: 'me',
        author: 'kim',
        enrolled: null,
      })
    ).toEqual(['kim', 'pat']);
  });
});

describe('reviewSyncEnvelopes', () => {
  const payload = {
    mrUrl: URL_A,
    iid: 4821,
    status: 'reviewing' as const,
    updatedAt: 5,
  };
  const base = {
    author: 'kim',
    self: 'me',
    payload,
    askId: 'ask-1',
    now: 9,
    recipients: (author: string) =>
      reviewPresenceRecipients({
        orgMembers: ['me', 'pat', 'ada'],
        self: 'me',
        author,
        enrolled: ['kim', 'pat', 'me'],
      }),
  };

  test('own MR sends nothing', () => {
    expect(reviewSyncEnvelopes({ ...base, author: 'Me' })).toEqual([]);
  });

  test("self 'all' sends nothing", () => {
    expect(reviewSyncEnvelopes({ ...base, self: 'all' })).toEqual([]);
  });

  test('no author sends nothing', () => {
    expect(reviewSyncEnvelopes({ ...base, author: undefined })).toEqual([]);
  });

  test('author and third party each get one, only the author a nudgeId; un-enrolled dropped', () => {
    const out = reviewSyncEnvelopes(base);
    expect(out.map(e => e.to)).toEqual(['kim', 'pat']);
    expect(out.map(e => 'nudgeId' in (e.payload as object))).toEqual([
      true,
      false,
    ]);
  });
});
