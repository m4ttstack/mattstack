import type {
  GateRow,
  RunFieldRow,
  RunStageRow,
  RunSummary,
} from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import {
  abandonedLine,
  answeredQuestionCount,
  decisionStages,
  defaultRecordTab,
  hasSettledGates,
  postedLabel,
  recommendationTally,
  recordEnd,
  recordSpan,
  recordStats,
} from './record';

const MIN = 60_000;
const T0 = new Date(2026, 9, 8, 11, 42).getTime();
const at = (m: number) => T0 + m * MIN;

const gate = (o: Partial<GateRow>): GateRow => ({
  id: 'g',
  subject: 'run:r1',
  kind: 'plan',
  questions: [],
  meta: null,
  status: 'answered',
  answer: null,
  openedAt: 0,
  parkedAt: null,
  closedAt: null,
  closedReason: null,
  supersededBy: null,
  agent: null,
  pane: null,
  nudge: null,
  delivery: null,
  released: false,
  consumedAt: null,
  owner: 'human',
  escalatedAt: null,
  ...o,
});

/** An answered one-question gate: `rec` marks the first option recommended,
    `pick` names the option picked (0 or 1). */
const answered = (
  id: string,
  stage: string,
  opened: number,
  answeredAt: number,
  { rec = true, pick = 0, owner = 'human' as string | null } = {}
): GateRow =>
  gate({
    id,
    meta: { stage },
    owner,
    openedAt: at(opened),
    questions: [
      {
        id: 'q',
        label: 'Which?',
        multi: false,
        options: [
          { value: 'a', label: rec ? 'A (Recommended)' : 'A' },
          { value: 'b', label: 'B' },
        ],
      },
    ],
    answer: {
      answers: { q: pick === 0 ? 'a' : 'b' },
      by: 'console',
      answeredAt: at(answeredAt),
    },
  });

const stage = (
  name: string,
  from: number,
  to: number | null,
  status = 'done',
  attempt = 1
): RunStageRow => ({
  name,
  status,
  attempt,
  started_at: at(from),
  ended_at: to == null ? null : at(to),
  reason: null,
  detail_path: null,
});

const field = (key: string, value: string): RunFieldRow => ({
  key,
  value,
  produced_by: 'x',
  at: at(1),
});

const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 'r1',
  repo: 'remote:acme%2Fweb',
  work_type: 'feature',
  pipeline: 'work',
  status: 'done',
  current_stage: null,
  spawned_by: null,
  started_at: at(0),
  ended_at: at(150),
  pack_commits: null,
  pack_dirty: 0,
  attention: { needs: false, reason: null, evidence: '' },
  last_event_at: at(150),
  ticket: 'WEB-409',
  branch: 'web-409',
  ...over,
});

const merged = run({
  outcome: {
    status: 'done',
    mr: { iid: 405, state: 'merged', url: null, mergedAt: at(152) },
    ci: 'success',
  },
});

const workGates = [
  answered('g1', 'plan', 7, 7),
  answered('g2', 'plan', 13, 13, { pick: 1 }),
  answered('g3', 'plan', 24, 26),
  answered('g4', 'evidence', 26, 49),
  answered('g5', 'evidence', 54, 55, { owner: 'herd:acme' }),
  answered('g6', 'ship', 107, 108, { pick: 1, owner: 'herd:acme' }),
];

describe('recordEnd', () => {
  it('ends at the merge when the run’s own MR merged', () => {
    expect(recordEnd(merged, 0)).toEqual({ at: at(152), merged: true });
  });

  it('ends at the run’s end otherwise', () => {
    expect(recordEnd(run(), 0)).toEqual({ at: at(150), merged: false });
  });

  it('ends at the run’s end when the run did not finish done', () => {
    const abandoned = { ...merged, status: 'abandoned' };
    expect(recordEnd(abandoned, 0)).toEqual({ at: at(150), merged: false });
  });

  it('falls back to the last event for a run that never recorded its end', () => {
    expect(
      recordEnd(run({ ended_at: null, last_event_at: at(30) }), at(99))
    ).toEqual({ at: at(30), merged: false });
  });
});

describe('recordSpan', () => {
  it('reads the day once when the run ended the day it started', () => {
    expect(recordSpan(at(0), at(152))).toBe('Oct 8, 11:42 AM → 2:14 PM');
  });

  it('names the end day when it differs', () => {
    expect(recordSpan(at(0), at(24 * 60))).toBe(
      'Oct 8, 11:42 AM → Oct 9, 11:42 AM'
    );
  });
});

describe('recommendationTally', () => {
  it('counts answered questions that had a recommendation', () => {
    expect(recommendationTally(workGates)).toEqual({ took: 4, of: 6 });
  });

  it('skips questions with no recommendation and unanswered gates', () => {
    expect(
      recommendationTally([
        answered('x', 'plan', 0, 1, { rec: false }),
        gate({ status: 'open' }),
      ])
    ).toEqual({ took: 0, of: 0 });
  });
});

describe('recordStats', () => {
  it('shows duration, decisions, took and waiting on a merged work run', () => {
    const stats = recordStats({ run: merged, gates: workGates, now: at(200) });
    expect(stats.map(s => [s.id, s.value, s.label])).toEqual([
      ['duration', '2h 32m', 'start to merge'],
      ['decisions', '6', 'decisions'],
      ['took', '4 of 6', 'took the recommendation'],
      ['waiting', '25m', 'waiting on you'],
    ]);
  });

  it('counts answered questions, not gates, and says one decision', () => {
    const two = answered('t', 'plan', 1, 2);
    const twoQuestions = {
      ...two,
      questions: [
        two.questions[0]!,
        { ...two.questions[0]!, id: 'scope', label: 'Scope?' },
      ],
      answer: { ...two.answer!, answers: { q: 'a', scope: 'b' } },
    };
    expect(
      recordStats({ run: run(), gates: [twoQuestions], now: at(200) }).find(
        s => s.id === 'decisions'
      )
    ).toMatchObject({ value: '2', label: 'decisions' });
    expect(
      recordStats({
        run: run(),
        gates: [answered('o', 'plan', 1, 2)],
        now: at(200),
      }).find(s => s.id === 'decisions')
    ).toMatchObject({ value: '1', label: 'decision' });
  });

  it('hides took-the-recommendation when no answered question had one', () => {
    const stats = recordStats({
      run: run({ outcome: { status: 'abandoned' }, ended_at: at(152) }),
      gates: [
        answered('a', 'plan', 8, 23, { rec: false }),
        answered('b', 'evidence', 38, 58, { rec: false }),
      ],
      now: at(200),
    });
    expect(stats.map(s => [s.id, s.value, s.label])).toEqual([
      ['duration', '2h 32m', 'start to end'],
      ['decisions', '2', 'decisions'],
      ['waiting', '35m', 'waiting on you'],
    ]);
  });

  it('omits decisions and waiting when nobody answered anything', () => {
    const stats = recordStats({
      run: run({ work_type: 'watch-ci' }),
      gates: [],
      now: at(200),
    });
    expect(stats.map(s => s.id)).toEqual(['duration']);
  });

  it('counts only the gates that are mine toward waiting on you', () => {
    const stats = recordStats({
      run: run(),
      gates: [answered('h', 'plan', 0, 30, { owner: 'herd:acme' })],
      now: at(200),
    });
    expect(stats.map(s => s.id)).toEqual(['duration', 'decisions', 'took']);
  });
});

describe('abandonedLine', () => {
  const abandoned = run({
    status: 'abandoned',
    outcome: { status: 'abandoned' },
  });

  it('reads when and why a run was abandoned, naming nobody', () => {
    expect(
      abandonedLine(abandoned, [
        { ...field('reconciled', 'Superseded by WEB-430'), at: at(152) },
      ])
    ).toBe('Abandoned · Oct 8, 2:14 PM · “Superseded by WEB-430”');
  });

  it('leaves the reason off when none was given', () => {
    expect(
      abandonedLine(abandoned, [{ ...field('reconciled', ' '), at: at(152) }])
    ).toBe('Abandoned · Oct 8, 2:14 PM');
  });

  it('is null for a run that was not abandoned or recorded nothing', () => {
    expect(abandonedLine(abandoned, [])).toBeNull();
    expect(
      abandonedLine(run(), [field('reconciled', 'Superseded by WEB-430')])
    ).toBeNull();
  });
});

describe('hasSettledGates', () => {
  it('counts answered and closed gates, not open ones', () => {
    expect(hasSettledGates([gate({ status: 'open' })])).toBe(false);
    expect(hasSettledGates([gate({ status: 'closed' })])).toBe(true);
    expect(hasSettledGates(workGates)).toBe(true);
  });
});

describe('defaultRecordTab', () => {
  it('opens on Decisions when a gate was answered', () => {
    expect(defaultRecordTab(workGates)).toBe('decisions');
  });

  it('opens on Story otherwise', () => {
    expect(
      defaultRecordTab([gate({ status: 'closed', closedReason: 'abandoned' })])
    ).toBe('story');
  });
});

describe('decisionStages', () => {
  const stages = [
    stage('provision', 0, 1),
    stage('plan', 1, 13),
    stage('evidence', 14, 58),
    stage('ship', 106, 114),
  ];
  const pipeline = 'provision plan gates evidence implement ship';

  it('groups settled gates by stage in pipeline order', () => {
    const shuffled = [...workGates].reverse();
    const groups = decisionStages(shuffled, stages, run(), 0, pipeline);
    expect(
      groups.map(g => [
        g.stage,
        g.gates.map(x => x.id),
        g.answered,
        g.durationMs,
        g.overrides,
        g.status,
      ])
    ).toEqual([
      ['plan', ['g1', 'g2', 'g3'], 3, 12 * MIN, 1, 'done'],
      ['evidence', ['g4', 'g5'], 2, 44 * MIN, 0, 'done'],
      ['ship', ['g6'], 1, 8 * MIN, 1, 'done'],
    ]);
  });

  it('counts a stage’s answered questions and overrides, not its gates', () => {
    const g = answered('m', 'plan', 2, 3, { pick: 1 });
    const two = {
      ...g,
      questions: [g.questions[0]!, { ...g.questions[0]!, id: 'scope' }],
      answer: { ...g.answer!, answers: { q: 'b', scope: 'b' } },
    };
    const [plan] = decisionStages([two], stages, run(), 0, pipeline);
    expect([plan!.answered, plan!.overrides]).toEqual([2, 2]);
  });

  it('gives a stage with no attempt no status', () => {
    const [other] = decisionStages(
      [answered('x', 'triage', 0, 1)],
      stages,
      run(),
      0,
      pipeline
    );
    expect(other!.status).toBeNull();
  });

  it('keeps closed gates in their stage without counting them', () => {
    const closed = gate({
      id: 'c',
      meta: { stage: 'plan' },
      status: 'closed',
      closedReason: 'superseded',
      openedAt: at(30),
    });
    const [plan] = decisionStages(
      [answered('g1', 'plan', 7, 7), closed, gate({ status: 'open' })],
      stages,
      run(),
      0,
      pipeline
    );
    expect(plan!.gates.map(g => g.id)).toEqual(['g1', 'c']);
    expect(plan!.answered).toBe(1);
  });

  it('puts a stage the pipeline does not name after the ones it does', () => {
    const groups = decisionStages(
      [answered('x', 'triage', 0, 1), answered('y', 'plan', 2, 3)],
      stages,
      run(),
      0,
      pipeline
    );
    expect(groups.map(g => g.stage)).toEqual(['plan', 'triage']);
  });
});

describe('postedLabel', () => {
  it('reads a posted disposition in sentence case', () => {
    expect(postedLabel('request changes')).toBe('Request changes');
    expect(postedLabel('Request changes')).toBe('Request changes');
    expect(postedLabel('REQUEST_CHANGES')).toBe('Request changes');
    expect(postedLabel('approve')).toBe('Approve');
  });
});

describe('answeredQuestionCount', () => {
  const g = (id: string, qs: string[], answered: boolean) =>
    ({
      id,
      status: answered ? 'answered' : 'open',
      questions: qs.map(q => ({ id: q, label: q, multi: false, options: [] })),
      answer: answered
        ? { answers: Object.fromEntries(qs.map(q => [q, 'x'])) }
        : null,
    }) as unknown as GateRow;

  it('counts answered questions, not gates', () => {
    expect(
      answeredQuestionCount([
        g('a', ['q1', 'q2'], true),
        g('b', ['q3'], true),
        g('c', ['q4'], false),
      ])
    ).toBe(3);
  });

  it('counts a multi-select answer once and skips unanswered questions', () => {
    const gate = {
      ...g('a', ['findings-1', 'outcome'], true),
      answer: { answers: { 'findings-1': ['x', 'y'] } },
    } as unknown as GateRow;
    expect(answeredQuestionCount([gate])).toBe(1);
  });
});
