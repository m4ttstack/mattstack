import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  GateAnswer,
  GateRow,
  RunFieldRow,
  RunStageRow,
  RunSummary,
} from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import {
  abandonReason,
  answeredQuestionCount,
  decisionStages,
  defaultRecordTab,
  hasSettledGates,
  postedLabel,
  recommendationTally,
  recordEnd,
  recordSpan,
  recordStats,
  reviewDecisionGates,
  reviewVerdict,
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

describe('abandonReason', () => {
  const abandoned = run({
    status: 'abandoned',
    outcome: { status: 'abandoned' },
  });

  it('quotes the reason an abandoned run recorded, and nothing else', () => {
    expect(
      abandonReason(abandoned, [
        { ...field('reconciled', ' Superseded by WEB-430 '), at: at(152) },
      ])
    ).toBe('“Superseded by WEB-430”');
  });

  it('is null when the reason is blank', () => {
    expect(
      abandonReason(abandoned, [{ ...field('reconciled', ' '), at: at(152) }])
    ).toBeNull();
  });

  it('is null for a run that was not abandoned or recorded nothing', () => {
    expect(abandonReason(abandoned, [])).toBeNull();
    expect(
      abandonReason(run(), [field('reconciled', 'Superseded by WEB-430')])
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

/** The design fixture's gates for one run, read from disk: the import wall
    keeps `server/` modules out of app code, tests included. */
function fixtureGates(runId: string): GateRow[] {
  const path = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../server/fixtures/design/runs/gates.json'
  );
  const { gates } = JSON.parse(readFileSync(path, 'utf8')) as {
    gates: (Omit<GateRow, 'openedAt' | 'answer'> & {
      openedAt: string;
      answer: (Omit<GateAnswer, 'answeredAt'> & { answeredAt: string }) | null;
      origin?: { runId?: string };
    })[];
  };
  return gates
    .filter(g => g.origin?.runId === runId)
    .map(g =>
      gate({
        ...g,
        status: g.answer ? 'answered' : 'open',
        openedAt: Date.parse(g.openedAt),
        answer: g.answer
          ? { ...g.answer, answeredAt: Date.parse(g.answer.answeredAt) }
          : null,
      })
    );
}

/** A review-post gate whose findings questions carry no structured context,
    as an older review skill asks it. */
const plainPost = (questions: [string, string[], string[]][]): GateRow =>
  gate({
    id: 'g-post',
    subject: 'mr:acme/web!406',
    kind: 'review-post',
    questions: [
      ...questions.map(([id, labels]) => ({
        id,
        label: 'Post which findings to !406?',
        multi: true,
        options: labels.map((label, i) => ({ value: `${id}-${i}`, label })),
      })),
      {
        id: 'outcome',
        label: 'What should the review post?',
        multi: false,
        options: [
          { value: 'approve', label: 'Approve' },
          { value: 'comment', label: 'Comment' },
        ],
      },
    ],
    answer: {
      answers: {
        ...Object.fromEntries(questions.map(([id, , picks]) => [id, picks])),
        outcome: 'approve',
      },
      by: 'console',
      answeredAt: at(5),
    },
  });

describe('reviewVerdict', () => {
  it('reads the verdict and each posted finding from the structured context', () => {
    const verdict = reviewVerdict(fixtureGates('20261008-0940'));
    expect(verdict?.verdict).toBe('Request changes');
    expect(verdict?.mrIid).toBe('412');
    expect(verdict?.findings.map(f => f.severity)).toEqual([
      'important',
      'important',
      'minor',
      'minor',
    ]);
    expect(verdict?.findings.filter(f => f.where).map(f => f.where)).toEqual([
      'contacts/import/dedupe.ts:58',
      'apps/contacts/src/import/pipeline/merge/strategies/mergeContactsKeepingNewestRecordAndDeletingTheLosingDuplicate.ts:12',
    ]);
    expect(verdict?.findings[0]).toEqual({
      severity: 'important',
      text: 'Dedupe matches on email only, so contacts without an email import twice.',
      where: 'contacts/import/dedupe.ts:58',
    });
  });

  it('parses the option label when a findings question has no context, across every findings question', () => {
    const verdict = reviewVerdict([
      plainPost([
        [
          'findings-1',
          [
            '[Important] Retry count resets (queue/retry.ts:18)',
            '[Minor] Typo',
          ],
          ['findings-1-0'],
        ],
        ['findings-2', ['[Minor] Log is noisy'], ['findings-2-0']],
      ]),
    ]);
    expect(verdict).toEqual({
      verdict: 'Approve',
      mrIid: '406',
      notPosted: [{ severity: 'minor', text: 'Typo', where: null }],
      findings: [
        {
          severity: 'important',
          text: 'Retry count resets',
          where: 'queue/retry.ts:18',
        },
        { severity: 'minor', text: 'Log is noisy', where: null },
      ],
    });
  });

  it('lists no unposted findings when every one was picked', () => {
    expect(reviewVerdict(fixtureGates('20261008-0940'))?.notPosted).toEqual([]);
  });

  it('lists the offered findings that were not picked, from the context else the option label', () => {
    const [post] = fixtureGates('20261008-0940').filter(
      g => g.id === 'g-0940-post'
    );
    const gate: GateRow = {
      ...post!,
      answer: {
        ...post!.answer!,
        answers: { ...post!.answer!.answers, 'findings-1': ['f1', 'f3'] },
      },
    };
    const verdict = reviewVerdict([gate]);
    expect(verdict?.findings.map(f => f.text)).toEqual([
      'Dedupe matches on email only, so contacts without an email import twice.',
      "mergeContacts deletes the losing record; the name doesn't say so.",
    ]);
    expect(verdict?.notPosted).toEqual([
      {
        severity: 'important',
        text: 'No test covers merging two contacts that share a phone number.',
        where: null,
      },
      {
        severity: 'minor',
        text: 'The skip log prints the whole contact record, email included.',
        where: null,
      },
    ]);
  });

  it('is null for a run that posted nothing', () => {
    expect(reviewVerdict(workGates)).toBeNull();
  });
});

describe('reviewDecisionGates', () => {
  it('leaves out the findings the verdict shows, and the gate context that lists them', () => {
    const gates = reviewDecisionGates(fixtureGates('20261008-0940'));
    expect(
      gates.map(g => [g.id, g.questions.map(q => q.id), g.context ?? null])
    ).toEqual([
      ['g-0940-tiers', ['tiers'], null],
      ['g-0940-post', ['outcome'], null],
    ]);
    expect(answeredQuestionCount(gates)).toBe(2);
  });

  it('drops a gate that asked only for findings', () => {
    const post = plainPost([
      ['findings-1', ['[Minor] Typo'], ['findings-1-0']],
    ]);
    const onlyFindings = { ...post, questions: post.questions.slice(0, 1) };
    expect(reviewDecisionGates([onlyFindings])).toEqual([]);
  });
});
