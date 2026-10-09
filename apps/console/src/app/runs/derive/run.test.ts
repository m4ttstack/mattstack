import type { RunDecisionRow, RunStageRow } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';
import { fieldKind, heldSpans } from './run';

describe('fieldKind', () => {
  it.each([
    ['hold', '-', 'cleared'], ['hold', '  ', 'cleared'],
    ['mr', 'https://gitlab.com/a/-/merge_requests/1', 'url'],
    ['commits', 'e797751 cb5f031 1e90006', 'sha-list'],
    ['evidence', '{"v":1,"before":"/b.png"}', 'json'],
    ['waiting-gate', 'g_01HXYZ', 'gate-ref'],
    ['approach', 'direct-tdd', 'text'],
  ])('%s=%s is %s', (k, v, kind) => expect(fieldKind(k, v)).toBe(kind));
});

const st = (name: string, attempt: number, started_at: number): RunStageRow =>
  ({ name, status: 'done', attempt, started_at, ended_at: null, reason: null, detail_path: null });
const hold = (scope: string, at: number): RunDecisionRow =>
  ({ contract: 'gate@1', scope, selection: 'hold', decided_by: 'stage-plan', decided_at: at });

describe('heldSpans', () => {
  it('runs from the hold decision to the next attempt', () => {
    expect(heldSpans([st('plan', 1, 0), st('plan', 2, 500)], [hold('hold:plan:1', 100)]))
      .toEqual([{ stage: 'plan', from: 100, to: 500 }]);
  });
  it('is open-ended while no next attempt exists', () => {
    expect(heldSpans([st('plan', 1, 0)], [hold('hold:plan:1', 100)])).toEqual([{ stage: 'plan', from: 100, to: null }]);
  });
  it('ignores other scopes', () => expect(heldSpans([], [hold('plan', 1)])).toEqual([]));
});
