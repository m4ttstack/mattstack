import { describe, expect, test } from 'bun:test';

import {
  acceptedReReview,
  parseReReview,
  settleReReview,
} from '../latch/rereview.ts';

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

describe('settleReReview', () => {
  const run = async (status: string, pending: string[], failOn?: string) => {
    const resolved: string[] = [];
    const logs: string[] = [];
    let cleared = 0;
    await settleReReview(
      status,
      pending,
      async id => {
        if (id === failOn) throw new Error('boom');
        resolved.push(id);
      },
      () => {
        cleared++;
      },
      m => logs.push(m)
    );
    return { resolved, logs, cleared };
  };

  test('done resolves each id then clears', async () => {
    expect(await run('done', ['d1', 'd2'])).toEqual({
      resolved: ['d1', 'd2'],
      logs: [],
      cleared: 1,
    });
  });

  test('error resolves nothing and clears', async () => {
    expect(await run('error', ['d1'])).toEqual({
      resolved: [],
      logs: [],
      cleared: 1,
    });
  });

  test('drafting resolves nothing and keeps the pick', async () => {
    expect(await run('drafting', ['d1'])).toEqual({
      resolved: [],
      logs: [],
      cleared: 0,
    });
  });

  test('a failed resolve is logged and the rest still settle', async () => {
    const r = await run('done', ['d1', 'd2'], 'd1');
    expect(r.resolved).toEqual(['d2']);
    expect(r.cleared).toBe(1);
    expect(r.logs).toHaveLength(1);
    expect(r.logs[0]).toContain('d1');
  });

  test('an empty pick does nothing', async () => {
    expect(await run('done', [])).toEqual({
      resolved: [],
      logs: [],
      cleared: 0,
    });
  });

  test('a duplicated id resolves once', async () => {
    expect((await run('done', ['d1', 'd1'])).resolved).toEqual(['d1']);
  });
});
