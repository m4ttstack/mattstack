import { describe, expect, test } from 'bun:test';

import type { ActiveRun, BoardMRWithReview } from '../../types.ts';
import { activeRunConfirmFor, runParent } from '../run-guard.ts';

const RUN: ActiveRun = { runId: 'run-7', stage: 'implement', name: 'Pip' };
const mr = (activeRun?: ActiveRun) =>
  ({ iid: 4127, ...(activeRun ? { activeRun } : {}) }) as BoardMRWithReview;

describe('activeRunConfirmFor', () => {
  test('a manual doctor on an MR a live run owns asks first', () => {
    expect(activeRunConfirmFor('doctor', {}, mr(RUN))).toEqual(RUN);
    expect(activeRunConfirmFor('rebase-local', {}, mr(RUN))).toEqual(RUN);
  });

  test('no live run, no question', () => {
    expect(activeRunConfirmFor('doctor', {}, mr())).toBeNull();
  });

  test('focus and quiet launches never ask', () => {
    expect(
      activeRunConfirmFor('doctor', { intent: 'focus' }, mr(RUN))
    ).toBeNull();
    expect(activeRunConfirmFor('doctor', { quiet: true }, mr(RUN))).toBeNull();
  });

  test('review and respond flows never ask', () => {
    for (const flow of [
      'review',
      're-review',
      'resume-review',
      'respond',
      'resume-respond',
    ] as const)
      expect(activeRunConfirmFor(flow, {}, mr(RUN))).toBeNull();
  });
});

describe('runParent', () => {
  test("names the parent by iid, else by branch, else it is this MR's own", () => {
    expect(runParent({ ...RUN, viaIid: 1400, viaBranch: 'feature/p' })).toBe(
      '!1400'
    );
    expect(runParent({ ...RUN, viaBranch: 'feature/p' })).toBe('feature/p');
    expect(runParent(RUN)).toBeNull();
  });
});
