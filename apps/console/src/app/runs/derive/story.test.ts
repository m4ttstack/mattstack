import type {
  GateRow,
  RunDecisionRow,
  RunFieldRow,
  RunStageRow,
} from '@mattstack/rt-client';
import { parseEvidence } from '@mattstack/rt-client/evidence';
import { describe, expect, it } from 'vitest';

import {
  liveStory,
  runBlock,
  stageSummary,
  type StoryEntry,
  type StoryInput,
} from './story';

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

describe('stageSummary', () => {
  const entryOf = (over: Partial<StoryEntry>): StoryEntry => ({
    key: 'plan#1',
    attempt: {
      stage: 'plan',
      attempt: 1,
      status: 'done',
      startedAt: 0,
      endedAt: 10,
    } as StoryEntry['attempt'],
    label: 'plan',
    durationMs: 10,
    fields: [],
    gates: [],
    holds: [],
    failure: null,
    redirect: null,
    evidence: null,
    ...over,
  });
  const asked = (id: string, at: number, picked: string, label: string) =>
    gate(id, 'plan', at, {
      questions: [
        {
          id: 'q',
          label: 'Q?',
          multi: false,
          options: [
            { value: picked, label: `${label} (Recommended)` },
            { value: 'other', label: 'Other' },
          ],
        },
      ],
      answer: { answers: { q: picked }, by: 'console', answeredAt: at + 1 },
    } as Partial<GateRow>);

  it('counts the decisions and names the first pick', () => {
    expect(
      stageSummary(
        entryOf({
          fields: [fld('approach', 1, 'Superpowers')],
          gates: [
            asked('a', 1, 'gap', 'Backend gap-fill + component work'),
            asked('b', 2, 'both', 'Both linked parcels and recipients'),
            asked('c', 3, 'ok', 'Approve, write the plan'),
          ],
        })
      )
    ).toBe('3 decisions · Backend gap-fill + component work');
  });

  it('says one decision in the singular', () => {
    expect(
      stageSummary(entryOf({ gates: [asked('a', 1, 'gap', 'Gap fill')] }))
    ).toBe('1 decision · Gap fill');
  });

  it('falls back to the first field as label and value on one line', () => {
    expect(
      stageSummary(
        entryOf({
          fields: [
            fld('extra-gate', 1, 'read the area docs\n  before implement'),
            fld('case', 2, 'An order'),
          ],
          gates: [gate('x', 'plan', 1, { status: 'closed', answer: null })],
        })
      )
    ).toBe('Extra gate: read the area docs before implement');
  });

  it('describes the evidence a stage holds in place of a pick the row repeats', () => {
    const gates = [
      asked('a', 1, 'spot', 'Spotlight the parcel card'),
      asked('b', 2, 'ok', 'Screenshot as planned, proceed'),
    ];
    const legacy = parseEvidence(
      'Shots: /e/web-412-before.png /e/web-412-before-annotated.png, page http://localhost:4001/orders/4821#parcels'
    );
    expect(stageSummary(entryOf({ gates, evidence: 'legacy' }), legacy)).toBe(
      '2 decisions · 2 screenshots, 1 link'
    );
    const v1 = parseEvidence(
      JSON.stringify({
        v: 1,
        before: '/e/before.png',
        beforeAnnotated: '/e/before-annotated.png',
        after: '/e/after.png',
      })
    );
    expect(stageSummary(entryOf({ gates, evidence: 'before' }), v1)).toBe(
      '2 decisions · 2 screenshots'
    );
    expect(stageSummary(entryOf({ evidence: 'after' }), v1)).toBe(
      '1 screenshot'
    );
  });

  it('falls back to the failure reason, then to nothing', () => {
    expect(
      stageSummary(
        entryOf({ failure: { reason: 'tests failed', detailPath: null } })
      )
    ).toBe('tests failed');
    expect(stageSummary(entryOf({}))).toBe('');
  });
});
