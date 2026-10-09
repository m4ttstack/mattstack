import type { RunStageRow } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import { railStages, stageAttempts, type StageAttempt } from './stages';

const row = (
  name: string,
  attempt: number,
  status: string,
  started_at: number | null,
  ended_at: number | null
): RunStageRow => ({
  name,
  status,
  attempt,
  started_at,
  ended_at,
  reason: null,
  detail_path: null,
});

describe('stageAttempts', () => {
  it('keeps run order and carries the status through', () => {
    const out = stageAttempts(
      [
        row('implement', 1, 'failed', 200, 300),
        row('plan', 1, 'done', 100, 200),
        row('implement', 2, 'redirected', 400, 450),
      ],
      { status: 'running', ended_at: null },
      1000
    );
    expect(out.map(x => `${x.stage}#${x.attempt}:${x.status}`)).toEqual([
      'plan#1:done',
      'implement#1:failed',
      'implement#2:redirected',
    ]);
  });

  it('ends a running stage of a finished run at the run end', () => {
    const [s] = stageAttempts(
      [row('watch-ci', 1, 'running', 100, null)],
      { status: 'done', ended_at: 900 },
      5000
    );
    expect(s).toMatchObject({
      status: 'running',
      startedAt: 100,
      endedAt: 900,
    });
  });

  it('ends a running stage of a finished run with no end at now', () => {
    const [s] = stageAttempts(
      [row('watch-ci', 1, 'running', 100, null)],
      { status: 'abandoned', ended_at: null },
      5000
    );
    expect(s?.endedAt).toBe(5000);
  });

  it('leaves a running stage of a live run open', () => {
    const [s] = stageAttempts(
      [row('implement', 1, 'running', 100, null)],
      { status: 'running', ended_at: null },
      5000
    );
    expect(s?.endedAt).toBeNull();
  });

  it('ends an unended settled attempt at the next attempt start', () => {
    const out = stageAttempts(
      [
        row('plan', 1, 'done', 100, null),
        row('implement', 1, 'done', 250, 300),
      ],
      { status: 'running', ended_at: null },
      5000
    );
    expect(out[0]?.endedAt).toBe(250);
  });

  it('keeps a real ended_at', () => {
    const [s] = stageAttempts(
      [row('plan', 1, 'done', 100, 180)],
      { status: 'done', ended_at: 900 },
      5000
    );
    expect(s?.endedAt).toBe(180);
  });

  it('reads an unknown status as done', () => {
    const [s] = stageAttempts(
      [row('plan', 1, 'weird', 100, 180)],
      { status: 'done', ended_at: 900 },
      5000
    );
    expect(s?.status).toBe('done');
  });
});

describe('railStages', () => {
  const at = (
    stage: string,
    attempt: number,
    status: StageAttempt['status'],
    startedAt: number,
    endedAt: number | null
  ): StageAttempt => ({ stage, attempt, status, startedAt, endedAt });

  it('lists the pipeline order with not-started stages', () => {
    const out = railStages(
      'provision plan implement',
      [at('provision', 1, 'done', 0, 10), at('plan', 1, 'running', 10, null)],
      [],
      null,
      30
    );
    expect(out.map(s => [s.name, s.status])).toEqual([
      ['provision', 'done'],
      ['plan', 'running'],
      ['implement', 'not-started'],
    ]);
    expect(out[0]).toMatchObject({ durationMs: 10, attempts: 1 });
    expect(out[1]).toMatchObject({ durationMs: 20, attempts: 1 });
    expect(out[2]).toMatchObject({ durationMs: null, attempts: 0 });
  });

  it('uses executed stages when there is no pipeline-stages', () => {
    const out = railStages(
      null,
      [at('plan', 1, 'done', 0, 5), at('ship', 1, 'done', 5, 9)],
      [],
      null,
      30
    );
    expect(out.map(s => s.name)).toEqual(['plan', 'ship']);
  });

  it('appends executed stages that are not in the list', () => {
    const out = railStages(
      'plan implement',
      [at('plan', 1, 'done', 0, 5), at('extra', 1, 'done', 5, 6)],
      [],
      null,
      30
    );
    expect(out.map(s => s.name)).toEqual(['plan', 'implement', 'extra']);
  });

  it('sums attempts, counts them and takes the last status', () => {
    const out = railStages(
      'implement',
      [at('implement', 1, 'failed', 0, 10), at('implement', 2, 'done', 20, 50)],
      [],
      null,
      30
    );
    expect(out[0]).toEqual({
      name: 'implement',
      status: 'done',
      durationMs: 40,
      attempts: 2,
    });
  });

  it('marks a failed or redirected last attempt', () => {
    const out = railStages(
      'a b',
      [at('a', 1, 'failed', 0, 1), at('b', 1, 'redirected', 1, 2)],
      [],
      null,
      30
    );
    expect(out.map(s => s.status)).toEqual(['failed', 'redirected']);
  });

  it('measures a running stage to now, on top of its earlier attempts', () => {
    const out = railStages(
      'implement',
      [
        at('implement', 1, 'failed', 0, 10),
        at('implement', 2, 'running', 20, null),
      ],
      [],
      null,
      50
    );
    expect(out[0]).toMatchObject({ status: 'running', durationMs: 40 });
  });

  it('marks a stage under an open hold as held', () => {
    const out = railStages(
      'plan implement',
      [at('plan', 1, 'done', 0, 5)],
      [{ stage: 'plan', to: null }],
      null,
      30
    );
    expect(out[0]?.status).toBe('held');
  });

  it('ignores a hold that has ended', () => {
    const out = railStages(
      'plan',
      [at('plan', 1, 'done', 0, 5), at('plan', 2, 'done', 8, 9)],
      [{ stage: 'plan', to: 8 }],
      null,
      30
    );
    expect(out[0]?.status).toBe('done');
  });

  it('marks the stage a gate of mine waits on as waiting', () => {
    const out = railStages(
      'plan implement',
      [at('plan', 1, 'running', 0, null)],
      [],
      'plan',
      30
    );
    expect(out.map(s => s.status)).toEqual(['waiting', 'not-started']);
  });

  it('lets waiting win over held', () => {
    const out = railStages(
      'plan',
      [at('plan', 1, 'done', 0, 5)],
      [{ stage: 'plan', to: null }],
      'plan',
      30
    );
    expect(out[0]?.status).toBe('waiting');
  });

  it('shows a waiting stage that has not started', () => {
    const out = railStages('plan gates', [], [], 'gates', 30);
    expect(out.map(s => s.status)).toEqual(['not-started', 'waiting']);
  });
});
