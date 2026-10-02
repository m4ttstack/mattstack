import { describe, expect, test } from 'bun:test';

import { askIdForRun } from '../peer/ask-echo.ts';
import type { NudgeState } from '../peer/nudges.ts';

const MR = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';

function ask(over: Partial<NudgeState>): NudgeState {
  return {
    id: 'a1',
    mrUrl: MR,
    iid: 4821,
    from: 'ada',
    receivedAt: 100,
    ...over,
  };
}

describe('askIdForRun', () => {
  test("picks the author's latest ask that arrived before the run started", () => {
    const nudges = [
      ask({ id: 'old', materializedAt: 100 }),
      ask({ id: 'new', materializedAt: 200 }),
    ];
    expect(askIdForRun(nudges, MR, 'ada', 250, 250)).toBe('new');
  });

  test('an ask that lands mid-run belongs to the next run', () => {
    const nudges = [
      ask({ id: 'first', materializedAt: 100 }),
      ask({ id: 'retry', materializedAt: 300 }),
    ];
    expect(askIdForRun(nudges, MR, 'ada', 250, 250)).toBe('first');
  });

  test('ignores respond asks, other authors and other MRs', () => {
    const nudges = [
      ask({ id: 'respond', kind: 'respond', materializedAt: 100 }),
      ask({ id: 'grace', from: 'grace', materializedAt: 100 }),
      ask({ id: 'other', mrUrl: `${MR}0`, materializedAt: 100 }),
    ];
    expect(askIdForRun(nudges, MR, 'ada', 250, 250)).toBeUndefined();
  });

  test('matches the author case-insensitively', () => {
    expect(askIdForRun([ask({ from: 'ada' })], MR, 'Ada', 250, 250)).toBe('a1');
  });

  test('a row from before materializedAt existed falls back to receivedAt', () => {
    expect(askIdForRun([ask({ receivedAt: 100 })], MR, 'ada', 250, 250)).toBe(
      'a1'
    );
  });

  test('no run start on file means no echo', () => {
    expect(askIdForRun([ask({})], MR, 'ada', undefined, 250)).toBeUndefined();
  });

  test('a run stamp later than the signal was emitted echoes nothing', () => {
    expect(askIdForRun([ask({})], MR, 'ada', 250, 200)).toBeUndefined();
  });

  test('a run stamp equal to emittedAt echoes', () => {
    expect(askIdForRun([ask({})], MR, 'ada', 250, 250)).toBe('a1');
  });
});
