import { describe, expect, it } from 'vitest';

import type { StageAttempt } from './stages';
import { timelineSegments } from './timeline';

const at = (
  stage: string,
  status: StageAttempt['status'],
  startedAt: number,
  endedAt: number | null,
  attempt = 1
): StageAttempt => ({ stage, attempt, status, startedAt, endedAt });

const base = {
  myGateSpans: [],
  held: [],
  runStart: 0,
  runEnd: 100,
  dayStart: 0,
  dayEnd: 1000,
};

describe('timelineSegments', () => {
  it('draws stage windows, with failed and redirected as done', () => {
    const out = timelineSegments({
      ...base,
      attempts: [
        at('plan', 'done', 0, 20),
        at('implement', 'failed', 20, 40),
        at('implement', 'redirected', 40, 60, 2),
        at('ship', 'running', 60, null),
      ],
    });
    expect(out).toEqual([
      { kind: 'done', from: 0, to: 20, stage: 'plan' },
      { kind: 'done', from: 20, to: 60, stage: 'implement' },
      { kind: 'running', from: 60, to: 100, stage: 'ship' },
    ]);
  });

  it('fills a gap inside the run with idle', () => {
    const out = timelineSegments({
      ...base,
      attempts: [at('plan', 'done', 0, 20), at('ship', 'done', 50, 100)],
    });
    expect(out).toEqual([
      { kind: 'done', from: 0, to: 20, stage: 'plan' },
      { kind: 'idle', from: 20, to: 50, stage: null },
      { kind: 'done', from: 50, to: 100, stage: 'ship' },
    ]);
  });

  it('puts waiting on you above waiting on CI above held above the stage', () => {
    const out = timelineSegments({
      ...base,
      attempts: [
        at('plan', 'done', 0, 30),
        at('watch-ci', 'running', 30, null),
      ],
      myGateSpans: [{ from: 40, to: 60 }],
      held: [{ from: 20, to: 50 }],
    });
    expect(out).toEqual([
      { kind: 'done', from: 0, to: 20, stage: 'plan' },
      { kind: 'held', from: 20, to: 30, stage: 'plan' },
      { kind: 'ci', from: 30, to: 40, stage: 'watch-ci' },
      { kind: 'you', from: 40, to: 60, stage: 'watch-ci' },
      { kind: 'ci', from: 60, to: 100, stage: 'watch-ci' },
    ]);
  });

  it('draws a hold in a gap as held', () => {
    const out = timelineSegments({
      ...base,
      attempts: [at('plan', 'done', 0, 20), at('plan', 'done', 60, 100, 2)],
      held: [{ from: 20, to: 60 }],
    });
    expect(out[1]).toEqual({ kind: 'held', from: 20, to: 60, stage: null });
  });

  it('runs an open hold to the run end', () => {
    const out = timelineSegments({
      ...base,
      attempts: [at('plan', 'done', 0, 20)],
      held: [{ from: 20, to: null }],
    });
    expect(out.at(-1)).toEqual({
      kind: 'held',
      from: 20,
      to: 100,
      stage: null,
    });
  });

  it('clips to the day window', () => {
    const out = timelineSegments({
      ...base,
      attempts: [at('plan', 'done', 0, 50), at('ship', 'done', 50, 100)],
      dayStart: 30,
      dayEnd: 70,
    });
    expect(out).toEqual([
      { kind: 'done', from: 30, to: 50, stage: 'plan' },
      { kind: 'done', from: 50, to: 70, stage: 'ship' },
    ]);
  });

  it('clips gate spans to the run', () => {
    const out = timelineSegments({
      ...base,
      attempts: [at('ship', 'done', 0, 100)],
      myGateSpans: [{ from: 80, to: 500 }],
    });
    expect(out.at(-1)).toEqual({
      kind: 'you',
      from: 80,
      to: 100,
      stage: 'ship',
    });
  });

  it('merges adjacent segments of one kind and stage', () => {
    const out = timelineSegments({
      ...base,
      attempts: [at('plan', 'done', 0, 50), at('plan', 'done', 50, 100, 2)],
      myGateSpans: [
        { from: 10, to: 20 },
        { from: 20, to: 30 },
      ],
    });
    expect(out).toEqual([
      { kind: 'done', from: 0, to: 10, stage: 'plan' },
      { kind: 'you', from: 10, to: 30, stage: 'plan' },
      { kind: 'done', from: 30, to: 100, stage: 'plan' },
    ]);
  });

  it('returns nothing when the run misses the day', () => {
    expect(
      timelineSegments({
        ...base,
        attempts: [at('plan', 'done', 0, 100)],
        dayStart: 500,
        dayEnd: 600,
      })
    ).toEqual([]);
  });

  it('skips attempts that never started', () => {
    expect(
      timelineSegments({
        ...base,
        attempts: [{ ...at('plan', 'done', 0, 0), startedAt: null }],
      })
    ).toEqual([{ kind: 'idle', from: 0, to: 100, stage: null }]);
  });
});
