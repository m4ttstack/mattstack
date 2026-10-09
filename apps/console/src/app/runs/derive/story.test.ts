import type {
  GateRow,
  RunDecisionRow,
  RunFieldRow,
  RunStageRow,
} from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import { decisionEntries, liveStory, runBlock, type StoryInput } from './story';

const st = (
  name: string,
  attempt: number,
  status: string,
  started_at: number,
  ended_at: number | null,
  extra: Partial<RunStageRow> = {}
): RunStageRow => ({
  name,
  attempt,
  status,
  started_at,
  ended_at,
  reason: null,
  detail_path: null,
  ...extra,
});
const fld = (key: string, at: number, value = 'v'): RunFieldRow => ({
  key,
  value,
  produced_by: 'x',
  at,
});
const dec = (
  scope: string,
  at: number,
  selection: unknown
): RunDecisionRow => ({
  contract: 'gate@1',
  scope,
  selection: JSON.stringify(selection),
  decided_by: 'agent',
  decided_at: at,
});
const gate = (
  id: string,
  stage: string | null,
  openedAt: number,
  over: Partial<GateRow> = {}
): GateRow =>
  ({
    id,
    subject: 'run:r1',
    kind: 'plan',
    meta: stage ? { stage } : null,
    owner: 'human',
    status: 'answered',
    openedAt,
    parkedAt: null,
    closedAt: null,
    questions: [
      { id: 'q', label: 'Q?', options: [{ value: 'a', label: 'A long' }] },
    ],
    answer: {
      answers: { q: 'a' },
      by: 'console',
      answeredAt: openedAt + 1,
    },
    ...over,
  }) as unknown as GateRow;

const input = (over: Partial<StoryInput>): StoryInput => ({
  stages: [],
  fields: [],
  decisions: [],
  gates: [],
  run: { status: 'running', ended_at: null },
  now: 1000,
  ...over,
});

describe('liveStory', () => {
  const stages = [
    st('provision', 1, 'done', 0, 10),
    st('plan', 1, 'done', 10, 20),
    st('implement', 1, 'running', 30, null),
  ];

  it('splits the current attempt off and keeps the rest in run order', () => {
    const story = liveStory(
      input({
        stages,
        fields: [
          fld('approach', 15),
          fld('strategy', 40),
          fld('ticket', 1),
          fld('extra.task', 41),
        ],
        gates: [gate('g1', 'plan', 12)],
      })
    );
    expect(story.current?.stage).toBe('implement');
    expect(story.currentLabel).toBe('implement');
    expect(story.currentFields.map(f => f.key)).toEqual(['strategy']);
    expect(story.entries.map(e => e.key)).toEqual(['plan#1']);
    expect(story.entries[0]!.fields.map(f => f.key)).toEqual(['approach']);
    expect(story.entries[0]!.gates.map(g => g.id)).toEqual(['g1']);
    expect(story.entries[0]!.durationMs).toBe(10);
  });

  it('leaves out an attempt with nothing to tell', () => {
    const story = liveStory(input({ stages, fields: [fld('approach', 15)] }));
    expect(story.entries.map(e => e.attempt.stage)).toEqual(['plan']);
  });

  it('labels a re-run stage with its attempt, and carries failures and redirects', () => {
    const story = liveStory(
      input({
        stages: [
          st('implement', 1, 'failed', 0, 10, {
            reason: 'Typecheck failed',
            detail_path: '/log.txt',
          }),
          st('implement', 2, 'done', 10, 20),
          st('self-review', 1, 'redirected', 20, 25),
          st('implement', 3, 'running', 30, null),
        ],
        fields: [fld('strategy', 12)],
        decisions: [
          dec('redirect:self-review:1', 25, {
            from: 'self-review',
            to: 'implement',
            reason: 'the empty state is missing',
          }),
        ],
      })
    );
    expect(story.currentLabel).toBe('implement · attempt 3');
    expect(story.entries.map(e => e.label)).toEqual([
      'implement · attempt 1',
      'implement · attempt 2',
      'self-review',
    ]);
    expect(story.entries[0]!.failure).toEqual({
      reason: 'Typecheck failed',
      detailPath: '/log.txt',
    });
    expect(story.entries[2]!.redirect).toBe(
      'back to implement: the empty state is missing'
    );
  });

  it('records a hold with its reason against its attempt', () => {
    const story = liveStory(
      input({
        stages: [
          st('plan', 1, 'done', 0, 10),
          st('plan', 2, 'done', 50, 60),
          st('implement', 1, 'running', 60, null),
        ],
        decisions: [dec('hold:plan:1', 10, { reason: 'waiting on design' })],
      })
    );
    expect(story.entries[0]!.holds).toEqual([
      { from: 10, to: 50, reason: 'waiting on design' },
    ]);
  });

  it('puts the before evidence in the evidence section and the after in ship', () => {
    const evidence = JSON.stringify({
      v: 1,
      before: '/e/before.png',
      after: '/e/after.png',
    });
    const story = liveStory(
      input({
        stages: [
          st('evidence', 1, 'done', 0, 10),
          st('implement', 1, 'done', 10, 20),
          st('ship', 1, 'done', 20, 30),
          st('watch-ci', 1, 'running', 30, null),
        ],
        fields: [fld('evidence', 25, evidence)],
      })
    );
    expect(story.entries.map(e => [e.attempt.stage, e.evidence])).toEqual([
      ['evidence', 'before'],
      ['ship', 'after'],
    ]);
    expect(story.entries.flatMap(e => e.fields)).toEqual([]);
  });

  it('marks legacy evidence for the evidence section', () => {
    const story = liveStory(
      input({
        stages: [
          st('evidence', 1, 'done', 0, 10),
          st('implement', 1, 'running', 10, null),
        ],
        fields: [fld('evidence', 5, '/a.png http://x/1')],
      })
    );
    expect(story.entries[0]!.evidence).toBe('legacy');
  });

  it('has no current attempt once the run has ended', () => {
    const story = liveStory(
      input({
        stages: [st('plan', 1, 'running', 0, null)],
        fields: [fld('approach', 5)],
        run: { status: 'done', ended_at: 20 },
      })
    );
    expect(story.current).toBeNull();
    expect(story.entries[0]!.durationMs).toBe(20);
    expect(story.entries[0]!.attempt.status).toBe('done');
  });

  it('skips open gates, which belong to the gate slot', () => {
    const story = liveStory(
      input({
        stages,
        gates: [
          gate('open', 'plan', 12, { status: 'open', answer: null }),
          gate('closed', 'plan', 13, {
            status: 'closed',
            answer: null,
            closedReason: 'superseded',
          } as Partial<GateRow>),
        ],
      })
    );
    expect(story.entries[0]!.gates.map(g => g.id)).toEqual(['closed']);
  });
});

describe('runBlock', () => {
  it('puts every story field and settled gate on the last attempt', () => {
    const block = runBlock(
      input({
        stages: [st('review', 1, 'running', 100, null)],
        fields: [
          fld('branch', 1),
          fld('findings', 200),
          fld('mr', 3),
          fld('tiers', 210),
        ],
        gates: [gate('g', null, 300)],
      })
    );
    expect(block?.label).toBe('review');
    expect(block?.durationMs).toBe(900);
    expect(block?.fields.map(f => f.key)).toEqual(['findings', 'tiers']);
    expect(block?.gates.map(g => g.id)).toEqual(['g']);
  });

  it('draws a stage left running on a finished run as done', () => {
    const block = runBlock(
      input({
        stages: [st('review', 1, 'running', 100, null)],
        run: { status: 'done', ended_at: 400 },
      })
    );
    expect(block?.attempt.status).toBe('done');
    expect(block?.durationMs).toBe(300);
  });

  it('is null for a run with no stages', () => {
    expect(runBlock(input({}))).toBeNull();
  });
});

describe('decisionEntries', () => {
  it('lists each answered question by answer time, with its stage and pick label', () => {
    const rows = decisionEntries(
      [
        gate('late', 'evidence', 50),
        gate('early', 'plan', 10),
        gate('open', 'plan', 5, { status: 'open', answer: null }),
      ],
      []
    );
    expect(rows).toEqual([
      { gateId: 'early', questionId: 'q', stage: 'plan', pick: 'A long' },
      { gateId: 'late', questionId: 'q', stage: 'evidence', pick: 'A long' },
    ]);
  });

  it('reads the pick as the story row does: labels joined, recommended mark stripped, an unknown value as it is', () => {
    const g = gate('m', 'plan', 10, {
      questions: [
        {
          id: 'q',
          label: 'Q?',
          multi: true,
          options: [
            { value: 'a', label: 'Alpha (Recommended)' },
            { value: 'b', label: 'Beta' },
          ],
        },
      ],
      answer: {
        answers: { q: ['a', 'b', 'zeta'] },
        by: 'console',
        answeredAt: 11,
      },
    } as Partial<GateRow>);
    expect(decisionEntries([g], [])[0]?.pick).toBe('Alpha, Beta, zeta');
  });
});
