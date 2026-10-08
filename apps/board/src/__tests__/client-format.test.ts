import { expect, test } from 'bun:test';

import {
  ago,
  cleanTitle,
  doctorItemLabel,
  firstReviewTargets,
  laneInterrupted,
  respondAskTarget,
  respondItemLabel,
  reviewLogged,
  reviewMenuItems,
  rowTitle,
} from '../client/board/format.ts';
import { statusReasons } from '../client/board/row-status.ts';

test('ago buckets minutes, hours, days', () => {
  const now = Date.parse('2026-08-19T12:00:00Z');
  expect(ago('2026-08-19T11:30:00Z', now)).toBe('30m');
  expect(ago('2026-08-19T02:00:00Z', now)).toBe('10h');
  expect(ago('2026-08-14T12:00:00Z', now)).toBe('5d');
  expect(ago(null, now)).toBe('');
});

test('cleanTitle strips ticket prefix and draft marker', () => {
  expect(cleanTitle('ACME-2369: add the thing')).toBe('add the thing');
  expect(cleanTitle('Draft: ACME-1: x')).toBe('x');
});

test("statusReasons is 'ready to merge' with no blockers", () => {
  expect(
    statusReasons({
      blockers: { any: false },
      reviews: { given: 0, required: 0 },
      unresolvedThreads: 0,
    } as never)
  ).toBe('ready to merge');
});

test('laneInterrupted: a gone orphan cuts the lane its sessionId names', () => {
  const orphan = { state: 'gone', sessionId: 'sess-1' } as never;
  expect(laneInterrupted(orphan, { sessionId: 'sess-1' })).toBe(true);
  // A lane on a DIFFERENT session (relaunched since) is not interrupted.
  expect(laneInterrupted(orphan, { sessionId: 'sess-2' })).toBe(false);
});

test('laneInterrupted: subject-matched orphans (no session tie) cut any lane', () => {
  const orphan = { state: 'gone', sessionId: 'sess-1' } as never;
  // The lane never recorded a session id (queued): the orphan still applies.
  expect(laneInterrupted(orphan, {})).toBe(true);
});

test('laneInterrupted: hidden or missing orphans and missing lanes never cut', () => {
  const hidden = { state: 'hidden', sessionId: 'sess-1' } as never;
  expect(laneInterrupted(hidden, { sessionId: 'sess-1' })).toBe(false);
  expect(laneInterrupted(undefined, { sessionId: 'sess-1' })).toBe(false);
  const gone = { state: 'gone', sessionId: 'sess-1' } as never;
  expect(laneInterrupted(gone, undefined)).toBe(false);
});

test('reviewMenuItems: focus only while the pane is alive; an interrupted review offers redo', () => {
  expect(reviewMenuItems('reviewing')).toEqual([
    { kind: 'focus', label: 'focus review' },
  ]);
  expect(reviewMenuItems('reviewing', true)).toEqual([
    { kind: 'redo', label: 'redo review' },
  ]);
  expect(reviewMenuItems('queued', true)).toEqual([
    { kind: 'redo', label: 'redo review' },
  ]);
});

test('reviewMenuItems: a finished review offers a follow-up with its next round, and redo', () => {
  expect(reviewMenuItems('done', false, false, 2)).toEqual([
    { kind: 'follow-up', label: 'follow-up review (round 3)' },
    { kind: 'redo', label: 'redo review' },
  ]);
  // Interrupted changes nothing once the review is not running.
  expect(reviewMenuItems('done', true)).toEqual([
    { kind: 'follow-up', label: 'follow-up review' },
    { kind: 'redo', label: 'redo review' },
  ]);
});

test('reviewMenuItems: cold, a plain review; once a review is logged, redo and follow-up', () => {
  expect(reviewMenuItems(undefined)).toEqual([
    { kind: 'review', label: 'review' },
  ]);
  expect(reviewMenuItems('error', false, false)).toEqual([
    { kind: 'review', label: 'review' },
  ]);
  expect(reviewMenuItems(undefined, false, true)).toEqual([
    { kind: 'redo', label: 'redo review' },
    { kind: 'follow-up', label: 'follow-up review' },
  ]);
});

test('reviewLogged: an approval, a reviewer thread, or a reviewer state counts; an untouched MR does not', () => {
  const base = {
    reviews: { isApproved: false, required: 2, given: 0, reviewers: [] },
    reviewerComments: 0,
  } as never;
  expect(reviewLogged(base)).toBe(false);
  expect(
    reviewLogged({ ...(base as object), reviewerComments: 2 } as never)
  ).toBe(true);
  expect(
    reviewLogged({
      reviews: { isApproved: false, required: 2, given: 1, reviewers: [] },
      reviewerComments: 0,
    } as never)
  ).toBe(true);
  expect(
    reviewLogged({
      reviews: {
        isApproved: false,
        required: 2,
        given: 0,
        reviewers: [{ username: 'tom', reviewState: 'REQUESTED_CHANGES' }],
      },
      reviewerComments: 0,
    } as never)
  ).toBe(true);
  expect(
    reviewLogged({
      reviews: {
        isApproved: false,
        required: 2,
        given: 0,
        reviewers: [{ username: 'tom', reviewState: 'UNREVIEWED' }],
      },
      reviewerComments: 0,
    } as never)
  ).toBe(false);
});

test('respondItemLabel: focus while alive, redo once interrupted or done', () => {
  expect(respondItemLabel(undefined)).toBe('respond');
  expect(respondItemLabel('error')).toBe('respond');
  expect(respondItemLabel('implementing')).toBe('focus response');
  expect(respondItemLabel('implementing', true)).toBe('redo response');
  expect(respondItemLabel('done')).toBe('redo response');
});

test('doctorItemLabel: focus while alive, redo once interrupted or done, honest at the api tier', () => {
  expect(doctorItemLabel(undefined)).toBe('call doctor');
  expect(doctorItemLabel(undefined, false, 'checkout')).toBe('call doctor');
  expect(doctorItemLabel(undefined, false, 'api')).toBe(
    'call doctor (CI only)'
  );
  expect(doctorItemLabel('rebasing')).toBe('focus doctor');
  expect(doctorItemLabel('rebasing', true)).toBe('redo doctor');
  expect(doctorItemLabel('done')).toBe('redo doctor');
});

test('rowTitle also drops the ticket the facts line carries, with or without a colon; Slack titles keep it', () => {
  expect(rowTitle('ACME-2214 Port the flows', 'ACME-2214')).toBe(
    'Port the flows'
  );
  expect(rowTitle('ACME-2214: Port the flows', 'ACME-2214')).toBe(
    'Port the flows'
  );
  expect(rowTitle('acme-2214 - Port the flows', 'ACME-2214')).toBe(
    'Port the flows'
  );
  expect(rowTitle('ACME-22140 is not the ticket', 'ACME-2214')).toBe(
    'ACME-22140 is not the ticket'
  );
  expect(rowTitle('Port the flows', null)).toBe('Port the flows');
  expect(cleanTitle('ACME-2214 Port the flows')).toBe(
    'ACME-2214 Port the flows'
  );
});

test('a title that is only the ticket keeps the ticket rather than going blank', () => {
  expect(rowTitle('ACME-2214', 'ACME-2214')).toBe('ACME-2214');
  expect(rowTitle('ACME-2214 -', 'ACME-2214')).toBe('ACME-2214 -');
  expect(rowTitle('ACME-2214:', 'ACME-2214')).toBe('ACME-2214:');
  expect(cleanTitle('ACME-2214:')).toBe('ACME-2214:');
  expect(cleanTitle('Draft: ACME-2214:')).toBe('ACME-2214:');
});

test('firstReviewTargets: roster minus author, engaged peers, and gated by an outstanding ask', () => {
  const mrx = {
    author: { username: 'ada' },
    peerReviews: [
      { reviewer: 'grace', status: 'reviewing', updatedAt: 1 },
      { reviewer: 'linus', status: 'done', outcome: 'comment', updatedAt: 1 },
    ],
  } as never;
  const roster = ['ada', 'grace', 'linus', 'kim'];
  expect(firstReviewTargets(mrx, roster)).toEqual(['kim']);

  const outstanding = {
    ...(mrx as object),
    sentNudge: { display: 'requested', reviewer: 'kim' },
  } as never;
  expect(firstReviewTargets(outstanding, roster)).toEqual([]);

  const retryable = {
    ...(mrx as object),
    sentNudge: { display: 'no-response', reviewer: 'kim' },
  } as never;
  expect(firstReviewTargets(retryable, roster)).toEqual(['kim']);
});

test('respondAskTarget: the author, only after my commented review, gated by an outstanding ask', () => {
  const base = {
    author: { username: 'pat' },
    review: { status: 'done', outcome: 'comment' },
  } as never;
  expect(respondAskTarget(base)).toBe('pat');

  const approved = {
    author: { username: 'pat' },
    review: { status: 'done', outcome: 'approve' },
  } as never;
  expect(respondAskTarget(approved)).toBeNull();

  const inFlight = {
    author: { username: 'pat' },
    review: { status: 'reviewing' },
  } as never;
  expect(respondAskTarget(inFlight)).toBeNull();

  const noReview = { author: { username: 'pat' } } as never;
  expect(respondAskTarget(noReview)).toBeNull();

  const outstanding = {
    author: { username: 'pat' },
    review: { status: 'done', outcome: 'comment' },
    sentNudge: { display: 'requested', reviewer: 'pat' },
  } as never;
  expect(respondAskTarget(outstanding)).toBeNull();

  const retryable = {
    author: { username: 'pat' },
    review: { status: 'done', outcome: 'comment' },
    sentNudge: { display: 'expired', reviewer: 'pat' },
  } as never;
  expect(respondAskTarget(retryable)).toBe('pat');
});

test('enrollment filters the pickers when known, and stays out of the way when not', () => {
  const mrx = { author: { username: 'ada' } } as never;
  const roster = ['ada', 'grace', 'linus', 'kim'];
  expect(firstReviewTargets(mrx, roster, ['grace', 'kim'])).toEqual([
    'grace',
    'kim',
  ]);
  expect(firstReviewTargets(mrx, roster, undefined)).toEqual([
    'grace',
    'linus',
    'kim',
  ]);
  expect(firstReviewTargets(mrx, roster, [])).toEqual([]);

  const reviewed = {
    author: { username: 'pat' },
    review: { status: 'done', outcome: 'comment' },
  } as never;
  expect(respondAskTarget(reviewed, ['pat'])).toBe('pat');
  expect(respondAskTarget(reviewed, ['kim'])).toBeNull();
  expect(respondAskTarget(reviewed, undefined)).toBe('pat');
});
