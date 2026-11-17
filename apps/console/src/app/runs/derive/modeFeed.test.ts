import type { GateRow, RunSummary } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import { decisionText } from './day';
import { modeFeed, modeOf } from './modeFeed';

const run = (id: string, over: Partial<RunSummary> = {}): RunSummary => ({
  id,
  repo: 'remote:acme%2Fweb',
  work_type: 'feature',
  pipeline: 'work',
  status: 'running',
  current_stage: null,
  spawned_by: null,
  started_at: 0,
  ended_at: null,
  pack_commits: null,
  pack_dirty: 0,
  attention: { needs: false, reason: null, evidence: '' },
  last_event_at: 0,
  ticket: null,
  branch: null,
  ...over,
});

const gate = (
  id: string,
  runId: string,
  by: string,
  answeredAt: number,
  over: Partial<GateRow> = {}
): GateRow =>
  ({
    id,
    subject: `run:${runId}`,
    kind: 'plan',
    status: 'answered',
    questions: [
      {
        id: 'approach',
        label: 'Which approach?',
        multi: false,
        options: ['direct-tdd', 'spike-first'],
      },
    ],
    answer: { answers: { approach: 'direct-tdd' }, by, answeredAt },
    meta: null,
    openedAt: 0,
    ...over,
  }) as GateRow;

describe('modeOf', () => {
  it('reads the mode out of answer.by', () => {
    expect(modeOf(gate('g', 'r1', 'mode:quiet', 1))).toBe('quiet');
    expect(modeOf(gate('g', 'r1', 'console', 1))).toBeNull();
    expect(modeOf({ ...gate('g', 'r1', 'x', 1), answer: null })).toBeNull();
  });
});

describe('modeFeed', () => {
  it('lists only mode-answered gates under their run', () => {
    const mode = gate('g1', 'r1', 'mode:quiet', 100, {
      meta: { stage: 'plan', headCommit: 'abc123' },
    });
    const feed = modeFeed(
      [run('r1'), run('r2', { status: 'done' })],
      [
        mode,
        gate('g2', 'r1', 'console', 200),
        gate('g3', 'r2', 'mode:normal', 50),
      ]
    );
    expect(feed.map(f => f.run.id)).toEqual(['r1', 'r2']);
    expect(feed[0]!.canControl).toBe(true);
    expect(feed[0]!.rows).toHaveLength(1);
    const row = feed[0]!.rows[0]!;
    expect(row).toMatchObject({
      mode: 'quiet',
      stage: 'plan',
      headCommit: 'abc123',
      answeredAt: 100,
    });
    expect(row.choice).toBe(decisionText(mode));
    expect(row.choice).toContain('direct-tdd');
    expect(feed[1]!.canControl).toBe(false);
    expect(feed[1]!.rows[0]).toMatchObject({
      mode: 'normal',
      stage: null,
      headCommit: null,
    });
  });

  it('since drops older rows', () => {
    const feed = modeFeed(
      [run('r1')],
      [
        gate('g1', 'r1', 'mode:quiet', 100),
        gate('g2', 'r1', 'mode:quiet', 300),
      ],
      { since: 200 }
    );
    expect(feed[0]!.rows.map(r => r.gate.id)).toEqual(['g2']);
    expect(
      modeFeed([run('r1')], [gate('g1', 'r1', 'mode:quiet', 100)], {
        since: 200,
      })
    ).toEqual([]);
  });

  it('a gate on an unlisted run is left out', () => {
    expect(
      modeFeed([run('r1')], [gate('g1', 'r9', 'mode:quiet', 100)])
    ).toEqual([]);
  });

  it('runs order by their newest row, rows newest first', () => {
    const feed = modeFeed(
      [run('r1'), run('r2')],
      [
        gate('a', 'r1', 'mode:quiet', 100),
        gate('b', 'r2', 'mode:quiet', 300),
        gate('c', 'r1', 'mode:quiet', 200),
      ]
    );
    expect(feed.map(f => f.run.id)).toEqual(['r2', 'r1']);
    expect(feed[1]!.rows.map(r => r.gate.id)).toEqual(['c', 'a']);
  });
});
