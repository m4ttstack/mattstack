import { describe, expect, test } from 'bun:test';

import { acceptedReReview, parseReReview } from '../latch/rereview.ts';

const latches = [
  { reviewer: 'Ana', discussionId: 'd1', requested: false },
  { reviewer: 'bo', discussionId: 'd2', requested: false },
  { reviewer: 'cy', discussionId: 'd3', requested: true },
];

describe('acceptedReReview', () => {
  test('keeps an unrequested latch id', () => {
    expect(acceptedReReview(['d1'], latches)).toEqual(['d1']);
  });

  test('drops an unknown id', () => {
    expect(acceptedReReview(['d1', 'nope'], latches)).toEqual(['d1']);
  });

  test('drops the id of a requested latch', () => {
    expect(acceptedReReview(['d3'], latches)).toEqual([]);
  });

  test("limits to one person's latch, case-insensitively", () => {
    expect(acceptedReReview(['d1', 'd2'], latches, 'ana')).toEqual(['d1']);
    expect(acceptedReReview(['d1', 'd2'], latches, 'Ana')).toEqual(['d1']);
  });
});

describe('parseReReview', () => {
  test('returns the ids when the field is an array of strings', () => {
    expect(parseReReview({ reReview: ['d1', 'd2'] })).toEqual(['d1', 'd2']);
  });

  test('returns [] for a missing field, a string or a mixed array', () => {
    expect(parseReReview({})).toEqual([]);
    expect(parseReReview({ reReview: 'd1' })).toEqual([]);
    expect(parseReReview({ reReview: ['d1', 4] })).toEqual([]);
    expect(parseReReview({ reReview: [''] })).toEqual([]);
    expect(parseReReview(null)).toEqual([]);
  });
});
