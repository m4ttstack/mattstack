import type {
  RunDecisionRow,
  RunFieldRow,
  RunStageRow,
} from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import { fieldKind, heldSpans } from './run';

describe('fieldKind', () => {
  it.each([
    ['hold', '-', 'cleared'],
    ['hold', '  ', 'cleared'],
    ['mr', 'https://gitlab.com/a/-/merge_requests/1', 'url'],
    ['commits', 'e797751 cb5f031 1e90006', 'sha-list'],
    ['evidence', '{"v":1,"before":"/b.png"}', 'json'],
    ['waiting-gate', 'g_01HXYZ', 'gate-ref'],
    ['approach', 'direct-tdd', 'text'],
    ['plan', 'docs/superpowers/plans/2026-10-08-x.md', 'path'],
    ['shot', '/Users/acme/evidence/before.png', 'path'],
    ['branch', 'feat/x', 'text'],
    ['note', 'see docs/a.md for more', 'text'],
  ])('%s=%s is %s', (k, v, kind) => expect(fieldKind(k, v)).toBe(kind));
});

const st = (
  name: string,
  attempt: number,
  started_at: number,
  ended_at: number | null = null
): RunStageRow => ({
  name,
  status: 'done',
  attempt,
  started_at,
  ended_at,
  reason: null,
  detail_path: null,
});
const hold = (scope: string, at: number): RunDecisionRow => ({
  contract: 'gate@1',
  scope,
  selection: 'hold',
  decided_by: 'stage-plan',
  decided_at: at,
});

const field = (key: string, value: string, at: number): RunFieldRow => ({
  key,
  value,
  produced_by: 'plan',
  at,
});

describe('heldSpans', () => {
  it('runs from the hold decision to the next attempt', () => {
    expect(
      heldSpans(
        [st('plan', 1, 0), st('plan', 2, 500)],
        [hold('hold:plan:1', 100)]
      )
    ).toEqual([{ stage: 'plan', from: 100, to: 500 }]);
  });
  it('is open-ended while no next attempt exists', () => {
    expect(heldSpans([st('plan', 1, 0)], [hold('hold:plan:1', 100)])).toEqual([
      { stage: 'plan', from: 100, to: null },
    ]);
  });
  it('ends when the held attempt ends', () => {
    expect(
      heldSpans([st('plan', 1, 0, 900)], [hold('hold:plan:1', 100)])
    ).toEqual([{ stage: 'plan', from: 100, to: 900 }]);
  });
  it('ends when the hold field is cleared', () => {
    expect(
      heldSpans(
        [st('plan', 1, 0, 900)],
        [hold('hold:plan:1', 100)],
        [field('hold', '-', 300)]
      )
    ).toEqual([{ stage: 'plan', from: 100, to: 300 }]);
  });
  it('stays open while the hold field still carries a reason', () => {
    expect(
      heldSpans(
        [st('plan', 1, 0)],
        [hold('hold:plan:1', 100)],
        [field('hold', 'waiting on Matt', 110)]
      )
    ).toEqual([{ stage: 'plan', from: 100, to: null }]);
  });
  it('ignores a clear older than the hold', () => {
    expect(
      heldSpans(
        [st('plan', 1, 0)],
        [hold('hold:plan:1', 100)],
        [field('hold', '-', 50)]
      )
    ).toEqual([{ stage: 'plan', from: 100, to: null }]);
  });
  it('ignores other scopes', () =>
    expect(heldSpans([], [hold('plan', 1)])).toEqual([]));
});
