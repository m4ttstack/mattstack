import { describe, expect, test } from 'bun:test';

import type { BoardMR } from '../data.ts';
import {
  ALL_TURN,
  authorTurn,
  resolveTurnConfig,
  reviewerTurn,
  type TurnConfig,
} from '../turn.ts';

type Over = Record<string, unknown>;
const NO_BLOCKERS = {
  any: false,
  isDraft: false,
  hasConflicts: false,
  needsRebase: false,
  pipelineFailing: false,
  pipelineRunning: false,
  awaitingApprovals: false,
  hasUnresolvedDiscussions: false,
  hasMergeError: false,
  mergeError: null,
};
function mr(over: Over = {}): BoardMR {
  return {
    iid: 7,
    title: 'ACME-12 Tidy the widget',
    webUrl: 'https://gitlab.example.com/acme/webapp/-/merge_requests/7',
    author: { username: 'pat', name: 'Pat' },
    reviews: { isApproved: false, required: 1, given: 0, reviewers: [] },
    blockers: { ...NO_BLOCKERS },
    threadSummary: { awaiting: 0, replied: 0, resolved: 0 },
    myThreads: { awaiting: 0, replied: 0, resolved: 0 },
    ...over,
  } as unknown as BoardMR;
}
const blocked = (b: Over) => mr({ blockers: { ...NO_BLOCKERS, any: true, ...b } });
const only = (author: TurnConfig['author']): TurnConfig => ({ ...ALL_TURN, author });

describe('resolveTurnConfig', () => {
  test('absent or malformed means every signal', () => {
    expect(resolveTurnConfig(undefined)).toEqual(ALL_TURN);
    expect(resolveTurnConfig('nope')).toEqual(ALL_TURN);
    expect(resolveTurnConfig({ author: 'threads' })).toEqual(ALL_TURN);
  });
  test('an explicit empty list means none', () => {
    expect(resolveTurnConfig({ author: [] }).author).toEqual([]);
    expect(resolveTurnConfig({ author: [] }).reviewer).toEqual(ALL_TURN.reviewer);
  });
  test('a non-empty list of only unknown names falls open to every signal', () => {
    expect(resolveTurnConfig({ author: ['bogus'] }).author).toEqual(ALL_TURN.author);
    expect(resolveTurnConfig({ reviewer: ['x', 'y'] }).reviewer).toEqual(ALL_TURN.reviewer);
  });
  test('unknown names are dropped, order follows the canonical list', () => {
    expect(resolveTurnConfig({ author: ['ciFailing', 'bogus', 'threads'] }).author)
      .toEqual(['threads', 'ciFailing']);
  });
});

describe('authorTurn', () => {
  test('a merge in flight is nobody\'s turn', () => {
    const m = mr({
      mergeButton: { visible: true, disabled: false, loading: true },
      reviews: { isApproved: true, required: 1, given: 1, reviewers: [] },
      blockers: { ...NO_BLOCKERS, hasConflicts: true },
    });
    expect(authorTurn(m, ALL_TURN)).toBeNull();
  });
  test('each signal fires on its own', () => {
    expect(authorTurn(mr({ threadSummary: { awaiting: 1, replied: 0, resolved: 0 } }), ALL_TURN)).toBe('threads');
    expect(authorTurn(blocked({ hasConflicts: true }), ALL_TURN)).toBe('conflicts');
    expect(authorTurn(blocked({ needsRebase: true }), ALL_TURN)).toBe('rebase');
    expect(authorTurn(blocked({ pipelineFailing: true }), ALL_TURN)).toBe('ciFailing');
    expect(authorTurn(mr({ reviews: { isApproved: true, required: 1, given: 1, reviewers: [] } }), ALL_TURN)).toBe('readyToMerge');
  });
  test('changes requested by a reviewer', () => {
    const m = mr({
      reviews: {
        isApproved: false, required: 1, given: 0,
        reviewers: [{ username: 'sam', name: 'Sam', reviewState: 'REQUESTED_CHANGES' }],
      },
    });
    expect(authorTurn(m, ALL_TURN)).toBe('changesRequested');
  });
  test('a signal switched off does not fire', () => {
    expect(authorTurn(blocked({ pipelineFailing: true }), only(['threads']))).toBeNull();
  });
  test('a running pipeline and an untouched MR are nobody\'s turn', () => {
    expect(authorTurn(blocked({ pipelineRunning: true }), ALL_TURN)).toBeNull();
    expect(authorTurn(mr(), ALL_TURN)).toBeNull();
  });
  test('approved but still blocked is not ready to merge', () => {
    const m = mr({
      reviews: { isApproved: true, required: 1, given: 1, reviewers: [] },
      blockers: { ...NO_BLOCKERS, any: true, pipelineRunning: true },
    });
    expect(authorTurn(m, ALL_TURN)).toBeNull();
  });
});

describe('reviewerTurn', () => {
  const asReviewer = (reviewState: string, over: Over = {}) =>
    mr({
      reviews: {
        isApproved: false, required: 1, given: 0,
        reviewers: [{ username: 'me', name: 'Me', reviewState }],
      },
      ...over,
    });
  test('assigned and not finished', () => {
    expect(reviewerTurn(asReviewer('UNREVIEWED'), 'me', ALL_TURN)).toBe('assigned');
    expect(reviewerTurn(asReviewer('REVIEW_STARTED'), 'me', ALL_TURN)).toBe('assigned');
  });
  test('approval reset by a push', () => {
    expect(reviewerTurn(asReviewer('UNAPPROVED'), 'me', ALL_TURN)).toBe('approvalReset');
  });
  test('already approved is never my turn', () => {
    expect(reviewerTurn(asReviewer('APPROVED', { myThreads: { awaiting: 0, replied: 2, resolved: 0 } }), 'me', ALL_TURN)).toBeNull();
  });
  test('my thread still awaiting the author is the author\'s turn', () => {
    expect(reviewerTurn(asReviewer('REVIEWED', { myThreads: { awaiting: 1, replied: 1, resolved: 0 } }), 'me', ALL_TURN)).toBeNull();
  });
  test('assigned: replied or resolved threads mean re-review', () => {
    expect(reviewerTurn(asReviewer('REVIEWED', { myThreads: { awaiting: 0, replied: 0, resolved: 2 } }), 'me', ALL_TURN)).toBe('repliedThreads');
  });
  test('unassigned: an answered thread is my turn', () => {
    expect(reviewerTurn(mr({ myThreads: { awaiting: 0, replied: 1, resolved: 3 } }), 'me', ALL_TURN)).toBe('repliedThreads');
  });
  test('unassigned: only resolved threads are not my turn', () => {
    expect(reviewerTurn(mr({ myThreads: { awaiting: 0, replied: 0, resolved: 3 } }), 'me', ALL_TURN)).toBeNull();
  });
  test('signals switched off', () => {
    const cfg: TurnConfig = { ...ALL_TURN, reviewer: [] };
    expect(reviewerTurn(asReviewer('UNREVIEWED'), 'me', cfg)).toBeNull();
  });
});
