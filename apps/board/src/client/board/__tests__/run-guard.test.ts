import { describe, expect, test } from 'bun:test';

import type { ActiveRun, BoardMRWithReview } from '../../types.ts';
import { activeRunConfirmFor } from '../run-guard.ts';

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
