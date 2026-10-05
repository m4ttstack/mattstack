import { describe, expect, test } from 'bun:test';

import type { BoardMR } from '../../../data.ts';
import { ALL_TURN } from '../../../turn.ts';
import { turnSummary } from '../turn-summary.ts';

const base = {
  author: { username: 'pat' },
  reviews: { isApproved: false, required: 1, given: 0, reviewers: [] },
  blockers: { any: false },
  threadSummary: { awaiting: 0, replied: 0, resolved: 0 },
};
const mr = (iid: number, over: Record<string, unknown> = {}) =>
  ({ ...base, iid, ...over }) as unknown as BoardMR;

describe('turnSummary', () => {
  const rows = [
    mr(1),
    mr(2, { threadSummary: { awaiting: 1, replied: 0, resolved: 0 } }),
    mr(3, { reviews: { ...base.reviews, isApproved: true } }),
    mr(4),
  ];
  test('every row lands in exactly one bucket', () => {
    const s = turnSummary(rows, ALL_TURN, m => m.iid === 4);
    expect(s).toEqual({ needYou: 1, waitingOnAuthor: 1, readyToMerge: 1, needReviewer: 1 });
  });
  test('need you wins over an author signal', () => {
    const s = turnSummary(rows, ALL_TURN, m => m.iid === 2);
    expect(s.needYou).toBe(1);
    expect(s.waitingOnAuthor).toBe(0);
  });
  test('a seatless board has no need-you bucket', () => {
    expect(turnSummary(rows, ALL_TURN, null).needYou).toBe(0);
  });
});
