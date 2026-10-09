import type {
  GateRow,
  RunDecisionRow,
  RunDetail,
  RunStageRow,
  RunSummary,
} from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import {
  activeOn,
  barDetail,
  barLabel,
  barPlacement,
  CATEGORY_OF,
  dayAxis,
  dayDecisions,
  dayKey,
  dayTimeline,
  dayTotals,
  decisionCount,
  decisionText,
  parseDayKey,
  runDetailKey,
  shiftDay,
  timelineSub,
  type DayRow,
} from './day';

const MIN = 60_000;
const NOW = new Date(2026, 9, 8, 16, 23).getTime();
const TODAY = (h: number, m = 0) => new Date(2026, 9, 8, h, m).getTime();
const YESTERDAY = (h: number, m = 0) => new Date(2026, 9, 7, h, m).getTime();

const run = (over: Partial<RunSummary>): RunSummary => ({
  id: 'r',
  repo: 'remote:acme%2Fweb',
  work_type: 'feature',
  pipeline: 'work',
  status: 'running',
  current_stage: null,
  spawned_by: null,
  started_at: TODAY(9),
  ended_at: null,
  pack_commits: null,
  pack_dirty: 0,
  attention: { needs: false, reason: null, evidence: '' },
  last_event_at: TODAY(9),
  ticket: null,
  branch: null,
  ...over,
});

const stage = (
  name: string,
  status: string,
  started_at: number,
  ended_at: number | null,
  attempt = 1
): RunStageRow => ({
  name,
  status,
  attempt,
  started_at,
  ended_at,
  reason: null,
  detail_path: null,
});

const detail = (
  r: RunSummary,
  stages: RunStageRow[],
  decisions: RunDecisionRow[] = []
): RunDetail => ({ run: r, stages, fields: [], decisions, schemaAhead: false });

const gate = (over: Partial<GateRow>): GateRow =>
  ({
    id: 'g',
    subject: 'run:r',
    kind: 'plan',
    status: 'open',
    owner: 'human',
    openedAt: TODAY(16, 17),
    questions: [],
    answer: null,
    origin: null,
    ...over,
  }) as GateRow;

const answered = (
  id: string,
  runId: string,
  by: string,
  at: number,
  over: Partial<GateRow> = {}
): GateRow =>
  gate({
    id,
    subject: `run:${runId}`,
    status: 'answered',
    openedAt: at - 5 * MIN,
    questions: [
      {
        id: 'q',
        label: 'Which approach?',
        multi: false,
        options: [
          { value: 'a', label: 'Backend first (Recommended)' },
          { value: 'b', label: 'Stub the data' },
        ],
      },
    ],
    answer: {
      answers: { q: 'b' },
      by,
      answeredAt: at,
    } as GateRow['answer'],
    ...over,
  });

describe('day keys', () => {
  it('reads and writes a local calendar day', () => {
    expect(dayKey(NOW)).toBe('2026-10-08');
    expect(parseDayKey('2026-10-07')).toBe('2026-10-07');
    expect(parseDayKey('2026-13-01')).toBeNull();
    expect(parseDayKey('yesterday')).toBeNull();
    expect(parseDayKey(null)).toBeNull();
    expect(shiftDay('2026-10-01', -1)).toBe('2026-09-30');
    expect(shiftDay('2026-10-08', 1)).toBe('2026-10-09');
  });
});

describe('activeOn', () => {
  const from = TODAY(0);
  const to = new Date(2026, 9, 9).getTime();

  it('takes a run whose span touches the day', () => {
    expect(activeOn(run({ started_at: YESTERDAY(10) }), from, to, NOW)).toBe(
      true
    );
    expect(
      activeOn(
        run({
          status: 'done',
          started_at: YESTERDAY(9),
          ended_at: YESTERDAY(10),
        }),
        from,
        to,
        NOW
      )
    ).toBe(false);
  });

  it('ends a stale run at its last event', () => {
    const stale = run({
      started_at: YESTERDAY(10),
      last_event_at: YESTERDAY(13),
      attention: { needs: true, reason: 'stale', evidence: '' },
    });
    expect(activeOn(stale, from, to, NOW)).toBe(false);
  });
});

describe('dayTimeline', () => {
  const live = run({
    id: 'live',
    current_stage: 'implement',
    started_at: TODAY(13, 38),
    stages: [
      {
        name: 'plan',
        status: 'done',
        started_at: TODAY(13, 38),
        ended_at: TODAY(14),
      },
      {
        name: 'implement',
        status: 'running',
        started_at: TODAY(15, 48),
        ended_at: null,
      },
    ],
  });
  const liveDetail = detail(live, [
    stage('plan', 'done', TODAY(13, 38), TODAY(14)),
    stage('implement', 'running', TODAY(15, 48), null),
  ]);
  const finished = run({
    id: 'done',
    status: 'done',
    started_at: TODAY(11, 42),
    ended_at: TODAY(14, 12),
    last_event_at: TODAY(14, 12),
    outcome: {
      status: 'done',
      mr: { iid: 405, state: 'merged', url: null, mergedAt: TODAY(14, 14) },
    },
  });
  const finishedDetail = detail(finished, [
    stage('plan', 'done', TODAY(11, 42), TODAY(12, 40)),
    stage('implement', 'running', TODAY(12, 40), null),
  ]);
  const old = run({
    id: 'old',
    status: 'done',
    started_at: YESTERDAY(9),
    ended_at: YESTERDAY(10),
    last_event_at: YESTERDAY(10),
  });
  const oldDetail = detail(old, [
    stage('plan', 'done', YESTERDAY(9), YESTERDAY(10)),
  ]);
  const runs = [finished, old, live];
  const details = new Map([
    [runDetailKey(live), liveDetail],
    [runDetailKey(finished), finishedDetail],
    [runDetailKey(old), oldDetail],
  ]);
  const gates = new Map<string, GateRow[]>([
    [
      'done',
      [
        gate({
          id: 'g-mine',
          subject: 'run:done',
          status: 'answered',
          openedAt: TODAY(12),
          answer: {
            answers: {},
            by: 'console',
            answeredAt: TODAY(12, 30),
          } as GateRow['answer'],
        }),
      ],
    ],
  ]);
  const build = (key: string) =>
    dayTimeline({ runs, details, gatesByRun: gates, key, now: NOW });

  it('lists the runs active that day, live first, newest first', () => {
    expect(build('2026-10-08').rows.map(r => r.run.id)).toEqual([
      'live',
      'done',
    ]);
    expect(build('2026-10-07').rows.map(r => r.run.id)).toEqual(['old']);
  });

  it('gives each segment kind its own legend colour', () => {
    const day = build('2026-10-08');
    const kinds = day.rows.flatMap(r => r.bars.map(b => b.kind));
    expect(new Set(kinds)).toEqual(new Set(['done', 'idle', 'running', 'you']));
    expect(CATEGORY_OF).toEqual({
      done: 'work',
      running: 'work',
      you: 'you',
      ci: 'ci',
      held: 'idle',
      idle: 'idle',
    });
  });

  it('draws a stage still running on a finished run as done, ending at the run end', () => {
    const row = build('2026-10-08').rows.find(r => r.run.id === 'done')!;
    expect(row.bars.at(-1)).toMatchObject({
      kind: 'done',
      to: TODAY(14, 12),
      stages: ['plan', 'implement'],
    });
    expect(row.bars.some(b => b.kind === 'running')).toBe(false);
  });

  it('merges neighbouring bars of one kind and names the gate of a you bar', () => {
    const row = build('2026-10-08').rows.find(r => r.run.id === 'done')!;
    expect(row.bars.map(b => [b.kind, b.stages])).toEqual([
      ['done', ['plan']],
      ['you', ['plan']],
      ['done', ['plan', 'implement']],
    ]);
    expect(row.bars[1]!.gates.map(g => g.id)).toEqual(['g-mine']);
  });

  it('adds up the totals to the bars it draws', () => {
    const day = build('2026-10-08');
    const sums = { work: 0, ci: 0, you: 0, idle: 0 };
    for (const row of day.rows)
      for (const b of row.bars) sums[CATEGORY_OF[b.kind]] += b.to - b.from;
    expect(day.totals).toEqual(sums);
    expect(day.totals.you).toBe(30 * MIN);
  });

  it('counts the day for its heading', () => {
    expect(build('2026-10-08')).toMatchObject({
      title: 'Today',
      sub: 'Thu Oct 8 · 1 live · 0 waiting on you · 1 finished',
      isToday: true,
    });
    expect(build('2026-10-07')).toMatchObject({
      title: 'Yesterday',
      sub: 'Wed Oct 7 · 1 finished',
      isToday: false,
    });
  });
});

describe('dayAxis', () => {
  const row = (
    from: number,
    to: number,
    kind: DayRow['bars'][number]['kind'] = 'done'
  ): DayRow => ({
    run: run({}),
    bars: [{ kind, from, to, stages: [], gates: [] }],
    sub: { text: '', waiting: false },
  });

  it('runs 8 AM to 6 PM and marks now on today', () => {
    const axis = dayAxis([row(TODAY(9), TODAY(10))], '2026-10-08', NOW);
    expect(axis.from).toBe(TODAY(8));
    expect(axis.to).toBe(TODAY(18));
    expect(axis.now).toBe(NOW);
    expect(axis.ticks.map(t => t.layer)).toEqual([
      't8',
      't10',
      't12',
      't14',
      't18',
    ]);
    expect(axis.ticks.at(-1)).toMatchObject({ label: '6 PM', end: true });
  });

  it('stretches to cover activity and clips idle to the axis', () => {
    const axis = dayAxis(
      [
        row(YESTERDAY(6, 30), YESTERDAY(7)),
        row(YESTERDAY(0), YESTERDAY(15), 'idle'),
      ],
      '2026-10-07',
      NOW
    );
    expect(axis.from).toBe(new Date(2026, 9, 7, 6).getTime());
    expect(axis.now).toBeNull();
  });

  it('places a bar as fractions of the axis', () => {
    const axis = dayAxis([], '2026-10-08', NOW);
    expect(barPlacement({ from: TODAY(13), to: TODAY(14) }, axis)).toEqual({
      x: 0.5,
      w: 0.1,
    });
  });
});

describe('timelineSub', () => {
  it('names the stage and its elapsed time on a live run', () => {
    const r = run({
      current_stage: 'implement',
      stages: [
        {
          name: 'implement',
          status: 'running',
          started_at: TODAY(15, 50),
          ended_at: null,
        },
      ],
    });
    expect(timelineSub(r, [], [], NOW)).toEqual({
      text: 'implement · 33m',
      waiting: false,
    });
  });

  it('says a run waits on you at the gate stage', () => {
    const r = run({ id: 'r', current_stage: 'plan' });
    const g = gate({ meta: { stage: 'plan' } as GateRow['meta'] });
    expect(timelineSub(r, [], [g], NOW)).toEqual({
      text: 'plan · waiting on you',
      waiting: true,
    });
  });

  it('names how a finished run ended and how long it took', () => {
    const r = run({
      status: 'done',
      started_at: TODAY(11, 42),
      ended_at: TODAY(14, 12),
      outcome: { status: 'done', mr: { iid: 405, state: 'merged', url: null } },
    });
    expect(timelineSub(r, [], [], NOW).text).toBe('merged !405 · 2h 30m');
    const review = run({
      work_type: 'review',
      status: 'done',
      started_at: TODAY(9),
      ended_at: TODAY(9, 23),
      outcome: {
        status: 'done',
        reviewed: { iid: 412, url: null, posted: 'Approve' },
      },
    });
    expect(timelineSub(review, [], [], NOW).text).toBe('reviewed !412 · 23m');
  });
});

describe('dayDecisions', () => {
  const runs = [
    run({ id: 'a', ticket: 'WEB-1' }),
    run({ id: 'b', ticket: 'WEB-2' }),
  ];
  const from = TODAY(0);
  const to = new Date(2026, 9, 9).getTime();

  it('lists your answers that day, newest first, never a shepherd', () => {
    const gates = [
      answered('g1', 'a', 'console', TODAY(10)),
      answered('g2', 'b', 'pane', TODAY(12)),
      answered('g3', 'a', 'shepherd', TODAY(13)),
      answered('g4', 'b', 'board', YESTERDAY(13)),
      answered('g5', 'gone', 'console', TODAY(14)),
      gate({
        id: 'g6',
        subject: 'run:a',
        answer: { answers: {}, answeredAt: TODAY(15) } as GateRow['answer'],
      }),
    ];
    expect(dayDecisions(runs, gates, from, to).map(d => d.gate.id)).toEqual([
      'g2',
      'g1',
    ]);
  });

  it('words a decision by the picked options', () => {
    expect(decisionText(answered('g1', 'a', 'console', TODAY(10)))).toBe(
      'Stub the data'
    );
  });
});

describe('barLabel', () => {
  it('names the stages, the kind and the gate', () => {
    const g = answered('g1', 'a', 'console', TODAY(10));
    expect(
      barLabel({
        kind: 'you',
        from: TODAY(9, 55),
        to: TODAY(10),
        stages: ['plan'],
        gates: [g],
      })
    ).toBe('plan · waiting on you · Which approach? · 9:55 AM to 10:00 AM');
    expect(
      barLabel({
        kind: 'idle',
        from: TODAY(9),
        to: TODAY(10),
        stages: [],
        gates: [],
      })
    ).toBe('between stages · idle · 9:00 AM to 10:00 AM');
  });
});

describe('barDetail', () => {
  const planGate = (by: string | null): GateRow =>
    gate({
      id: 'g-plan',
      status: by ? 'answered' : 'open',
      openedAt: TODAY(13, 39),
      questions: [
        {
          id: 'approach',
          label: 'Which approach should the plan take?',
          multi: false,
          options: [
            {
              value: 'Server-side filter',
              label: 'Server-side filter (Recommended)',
            },
            { value: 'Client-side filter', label: 'Client-side filter' },
          ],
        },
      ],
      answer: by
        ? ({
            answers: { approach: 'Server-side filter' },
            by,
            answeredAt: TODAY(13, 45),
          } as GateRow['answer'])
        : null,
    });
  const waiting = (g: GateRow) => ({
    kind: 'you' as const,
    from: TODAY(13, 39),
    to: TODAY(13, 45),
    stages: ['plan'],
    gates: [g],
  });

  it('names a waiting stretch’s stage, span, gate question and your pick', () => {
    expect(barDetail(waiting(planGate('console')))).toEqual({
      title: 'plan · waiting on you',
      span: '1:39 PM → 1:45 PM · 6m',
      gate: 'Which approach should the plan take? You picked Server-side filter.',
    });
  });

  it('says who picked when it was not you, and nothing while it is open', () => {
    expect(barDetail(waiting(planGate('shepherd'))).gate).toBe(
      'Which approach should the plan take? The shepherd picked Server-side filter.'
    );
    expect(barDetail(waiting(planGate('cron'))).gate).toBe(
      'Which approach should the plan take? Picked Server-side filter.'
    );
    expect(barDetail(waiting(planGate(null))).gate).toBe(
      'Which approach should the plan take?'
    );
  });

  it('has no gate line for a bar with no gate', () => {
    expect(
      barDetail({
        kind: 'done',
        from: TODAY(9),
        to: TODAY(10, 5),
        stages: ['implement', 'self-review'],
        gates: [],
      })
    ).toEqual({
      title: 'implement → self-review · stage done',
      span: '9:00 AM → 10:05 AM · 1h 05m',
      gate: null,
    });
  });
});

describe('decisionCount', () => {
  it('counts the questions you answered, not the gates', () => {
    const two = answered('g1', 'a', 'console', TODAY(10), {
      questions: [
        { id: 'q', label: 'Which approach?', multi: false, options: [] },
        { id: 'r', label: 'Scope?', multi: false, options: [] },
      ],
      answer: {
        answers: { q: 'a', r: 'b' },
        by: 'console',
        answeredAt: TODAY(10),
      } as GateRow['answer'],
    });
    const runs = [run({ id: 'a' })];
    const decisions = dayDecisions(runs, [two], TODAY(0), TODAY(23));
    expect(decisions).toHaveLength(1);
    expect(decisionCount(decisions)).toBe(2);
  });
});

describe('dayTotals', () => {
  it('sums each legend category', () => {
    const rows: DayRow[] = [
      {
        run: run({}),
        sub: { text: '', waiting: false },
        bars: [
          { kind: 'done', from: 0, to: 10, stages: [], gates: [] },
          { kind: 'running', from: 10, to: 15, stages: [], gates: [] },
          { kind: 'held', from: 15, to: 18, stages: [], gates: [] },
          { kind: 'idle', from: 18, to: 20, stages: [], gates: [] },
          { kind: 'ci', from: 20, to: 27, stages: [], gates: [] },
        ],
      },
    ];
    expect(dayTotals(rows)).toEqual({ work: 15, ci: 7, you: 0, idle: 5 });
  });
});

describe('dayTimeline edges', () => {
  const one = (r: RunSummary, stages: RunStageRow[], key: string) =>
    dayTimeline({
      runs: [r],
      details: new Map([[runDetailKey(r), detail(r, stages)]]),
      gatesByRun: new Map(),
      key,
      now: NOW,
    });

  it('reads each repo its own detail when two runs share an id', () => {
    const a = run({
      id: 'same',
      status: 'done',
      started_at: TODAY(9),
      ended_at: TODAY(10),
      last_event_at: TODAY(10),
    });
    const b = { ...a, repo: 'remote:acme%2Fapi' };
    const timeline = dayTimeline({
      runs: [a, b],
      details: new Map([
        [
          runDetailKey(a),
          detail(a, [stage('plan', 'done', TODAY(9), TODAY(10))]),
        ],
        [
          runDetailKey(b),
          detail(b, [stage('ship', 'done', TODAY(9), TODAY(10))]),
        ],
      ]),
      gatesByRun: new Map(),
      key: '2026-10-08',
      now: NOW,
    });
    expect(timeline.rows.map(r => r.bars[0]!.stages)).toEqual([
      ['plan'],
      ['ship'],
    ]);
  });

  it('splits a run that crosses midnight between its two days', () => {
    const r = run({
      id: 'late',
      status: 'done',
      started_at: YESTERDAY(22),
      ended_at: TODAY(2),
      last_event_at: TODAY(2),
    });
    const stages = [stage('implement', 'done', YESTERDAY(22), TODAY(2))];
    const before = one(r, stages, '2026-10-07');
    expect(before.axis.to).toBe(TODAY(0));
    expect(before.rows[0]!.bars).toEqual([
      expect.objectContaining({
        kind: 'done',
        from: YESTERDAY(22),
        to: TODAY(0),
      }),
    ]);
    const after = one(r, stages, '2026-10-08');
    expect(after.axis.from).toBe(TODAY(0));
    expect(after.totals.work).toBe(2 * 60 * MIN);
  });

  it('runs a stale run only to its last event, then idles', () => {
    const r = run({
      id: 'stale',
      current_stage: 'implement',
      started_at: TODAY(9),
      last_event_at: TODAY(11),
      attention: { needs: true, reason: 'stale', evidence: '' },
    });
    const day = one(
      r,
      [stage('implement', 'running', TODAY(9), null)],
      '2026-10-08'
    );
    expect(day.rows[0]!.bars.map(b => [b.kind, b.from, b.to])).toEqual([
      ['running', TODAY(9), TODAY(11)],
      ['idle', TODAY(11), NOW],
    ]);
    expect(day.rows[0]!.sub.text).toBe('implement · stale');
  });

  it('tells a past day a run is still running, not today’s state', () => {
    const r = run({
      id: 'long',
      current_stage: 'implement',
      started_at: YESTERDAY(9),
      last_event_at: NOW,
    });
    const g = gate({ subject: 'run:long' });
    expect(timelineSub(r, [], [g], NOW, false)).toEqual({
      text: 'still running · 1d 7h',
      waiting: false,
    });
  });

  it('tells a past day a stale run is stale, not still running', () => {
    const r = run({
      id: 'quiet',
      current_stage: 'implement',
      started_at: YESTERDAY(9),
      last_event_at: YESTERDAY(11),
      attention: { needs: true, reason: 'stale', evidence: '' },
    });
    expect(timelineSub(r, [], [], NOW, false)).toEqual({
      text: 'stale · 2h 00m',
      waiting: false,
    });
  });

  it('names an abandoned review as abandoned', () => {
    const r = run({
      work_type: 'review',
      status: 'abandoned',
      started_at: TODAY(9),
      ended_at: TODAY(9, 10),
      outcome: {
        status: 'abandoned',
        reviewed: { iid: 412, url: null, posted: null },
      },
    });
    expect(timelineSub(r, [], [], NOW).text).toBe('abandoned · 10m');
  });

  it('names the filtered repo first in the sub line', () => {
    const r = run({ id: 'x', status: 'done', ended_at: TODAY(10) });
    const day = dayTimeline({
      runs: [r],
      details: new Map(),
      gatesByRun: new Map(),
      key: '2026-10-08',
      now: NOW,
      repoName: 'acme/web',
    });
    expect(day.sub).toBe(
      'acme/web · Thu Oct 8 · 0 live · 0 waiting on you · 1 finished'
    );
  });
});
