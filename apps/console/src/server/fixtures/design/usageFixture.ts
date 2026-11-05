/** `CONSOLE_FIXTURE=design` data for the usage reads: invented `acme/widgets` MRs. */
import type {
  UsageKind,
  UsageModelRow,
  UsageMrData,
  UsageMrEntry,
  UsageMrRow,
  UsageMrsData,
  UsageStageRow,
  UsageStatusData,
  UsageTotals,
  UsageTrendsData,
} from '@mattstack/rt-client';

export interface UsageFixture {
  mrs: UsageMrsData;
  mr(mrKey: string): UsageMrData | null;
  trends: UsageTrendsData;
  status: UsageStatusData;
}

const ZERO: UsageTotals = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
  unpricedTokens: 0,
};
const KINDS: UsageKind[] = ['work', 'review', 'respond', 'doctor', 'other'];
const round = (n: number) => Math.round(n * 1e6) / 1e6;

function sum(rows: UsageTotals[]): UsageTotals {
  return rows.reduce<UsageTotals>(
    (a, t) => ({
      input: a.input + t.input,
      output: a.output + t.output,
      cacheRead: a.cacheRead + t.cacheRead,
      cacheWrite: a.cacheWrite + t.cacheWrite,
      cost: round(a.cost + t.cost),
      unpricedTokens: a.unpricedTokens + t.unpricedTokens,
    }),
    ZERO
  );
}

const tot = (
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
  cost: number
): UsageTotals => ({
  input,
  output,
  cacheRead,
  cacheWrite,
  cost,
  unpricedTokens: 0,
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Local Monday midnight, as `mondayOf` in lib/usage/queries.ts. */
const WEEK = new Date(2026, 10, 2).getTime();
const OPUS = 'claude-opus-4-8';
const SONNET = 'claude-sonnet-5-5';

function seenModels(main: UsageTotals, subagent: UsageTotals): UsageModelRow[] {
  return [
    { model: OPUS, totals: main },
    { model: SONNET, totals: subagent },
  ].filter(
    ({ totals: t }) => t.input + t.output + t.cacheRead + t.cacheWrite > 0
  );
}

interface EntrySpec {
  runId: string | null;
  sessionId: string | null;
  kind: UsageKind;
  round: number | null;
  pipeline: string | null;
  status: string | null;
  start: number;
  hours: number;
  main: UsageTotals;
  subagent: UsageTotals;
  stages: Array<[string | null, number | null, string | null, UsageTotals]>;
}

function entry(s: EntrySpec): UsageMrEntry {
  const totals = sum([s.main, s.subagent]);
  const span =
    (s.hours * HOUR) / s.stages.filter(([name]) => name !== null).length;
  let at = s.start;
  const stages: UsageStageRow[] = s.stages.map(
    ([name, attempt, status, totals]) => {
      if (name === null)
        return {
          name,
          attempt,
          status,
          startedAt: null,
          endedAt: null,
          totals,
        };
      const startedAt = at;
      at += span;
      return { name, attempt, status, startedAt, endedAt: at, totals };
    }
  );
  return {
    runId: s.runId,
    sessionId: s.sessionId,
    kind: s.kind,
    round: s.round,
    pipeline: s.pipeline,
    status: s.status,
    startedAt: s.runId ? s.start : null,
    endedAt: s.runId ? s.start + s.hours * HOUR : null,
    firstActivity: s.start,
    lastActivity: s.start + s.hours * HOUR,
    totals,
    byModel: seenModels(s.main, s.subagent),
    main: s.main,
    subagent: s.subagent,
    stages,
  };
}

function mrData(
  mrKey: string,
  url: string | null,
  ticket: string | null,
  branch: string | null,
  entries: UsageMrEntry[]
): UsageMrData {
  const costByKind = Object.fromEntries(
    KINDS.map(k => [
      k,
      round(
        entries.filter(e => e.kind === k).reduce((a, e) => a + e.totals.cost, 0)
      ),
    ])
  ) as Record<UsageKind, number>;
  const main = sum(entries.map(e => e.main));
  const subagent = sum(entries.map(e => e.subagent));
  return {
    mrKey,
    url,
    ticket,
    branch,
    firstActivity: Math.min(...entries.map(e => e.firstActivity)),
    lastActivity: Math.max(...entries.map(e => e.lastActivity)),
    totals: sum(entries.map(e => e.totals)),
    costByKind,
    byModel: seenModels(main, subagent),
    main,
    subagent,
    runs: entries,
  };
}

const EARLIER_WEEK_COSTS: Array<Record<UsageKind, number>> = [
  { work: 62, review: 9, respond: 21, doctor: 4, other: 2 },
  { work: 41, review: 12, respond: 14, doctor: 0, other: 1 },
  { work: 88, review: 7, respond: 33, doctor: 11, other: 3 },
];

const KEY_FULL = 'remote:github.com%2Facme%2Fwidgets!123';
const KEY_REVIEW = 'remote:github.com%2Facme%2Fwidgets!124';

export function usageFixture(): UsageFixture {
  const full = mrData(
    KEY_FULL,
    'https://github.com/acme/widgets/pull/123',
    'WEB-123',
    'web-123-cart-totals',
    [
      entry({
        runId: 'r-work-1',
        sessionId: null,
        kind: 'work',
        round: null,
        pipeline: 'feature',
        status: 'done',
        start: WEEK + 9 * HOUR,
        hours: 3,
        main: tot(1200, 48000, 5_200_000, 310_000, 14.8),
        subagent: tot(400, 15000, 1_100_000, 90_000, 1.9),
        stages: [
          ['plan', 1, 'done', tot(300, 9000, 800_000, 60_000, 2.4)],
          ['implement', 1, 'done', tot(1000, 50000, 5_000_000, 330_000, 13.6)],
          [null, null, null, tot(300, 4000, 500_000, 10_000, 0.7)],
        ],
      }),
      ...[1, 2, 3].map(n =>
        entry({
          runId: `r-respond-${n}`,
          sessionId: null,
          kind: 'respond',
          round: n,
          pipeline: 'respond',
          status: 'done',
          start: WEEK + n * DAY + 10 * HOUR,
          hours: 1,
          main: tot(300 * n, 9000, 1_400_000, 80_000, 3.1 + n * 0.4),
          subagent: tot(0, 0, 0, 0, 0),
          stages: [
            [
              'respond',
              1,
              'done',
              tot(300 * n, 9000, 1_400_000, 80_000, 3.1 + n * 0.4),
            ],
          ],
        })
      ),
      entry({
        runId: null,
        sessionId: 's-doctor-1',
        kind: 'doctor',
        round: null,
        pipeline: null,
        status: null,
        start: WEEK + 4 * DAY + 14 * HOUR,
        hours: 1,
        main: tot(200, 6000, 900_000, 50_000, 2.2),
        subagent: tot(0, 0, 0, 0, 0),
        stages: [[null, null, null, tot(200, 6000, 900_000, 50_000, 2.2)]],
      }),
    ]
  );

  const reviewOnly = mrData(
    KEY_REVIEW,
    'https://github.com/acme/widgets/pull/124',
    null,
    'feature/cart-discounts',
    [
      entry({
        runId: 'r-review-1',
        sessionId: null,
        kind: 'review',
        round: null,
        pipeline: 'review',
        status: 'done',
        start: WEEK + 4 * DAY + 16 * HOUR,
        hours: 1,
        main: tot(500, 12000, 2_000_000, 120_000, 4.6),
        subagent: tot(0, 0, 0, 0, 0),
        stages: [
          ['review', 1, 'done', tot(500, 12000, 2_000_000, 120_000, 4.6)],
        ],
      }),
    ]
  );

  const row = (d: UsageMrData): UsageMrRow => ({
    mrKey: d.mrKey,
    url: d.url,
    ticket: d.ticket,
    branch: d.branch,
    firstActivity: d.firstActivity,
    lastActivity: d.lastActivity,
    totals: d.totals,
    costByKind: d.costByKind,
    runCount: d.runs.filter(r => r.runId !== null).length,
    roundCount: d.runs.filter(r => r.kind === 'respond').length,
  });
  const all = [full, reviewOnly];
  const rows = all.map(row).sort((a, b) => b.lastActivity - a.lastActivity);
  const costs = rows.map(r => r.totals.cost).sort((a, b) => a - b);
  const mid = Math.floor(costs.length / 2);
  const medianCost = round(
    costs.length % 2 ? costs[mid]! : (costs[mid - 1]! + costs[mid]!) / 2
  );

  const kindTotals = (kind: UsageKind) =>
    sum(
      all.flatMap(d => d.runs.filter(r => r.kind === kind).map(r => r.totals))
    );
  const week: UsageTrendsData['weeks'][number] = {
    weekStart: WEEK,
    totals: sum(all.map(d => d.totals)),
    byKind: Object.fromEntries(KINDS.map(k => [k, kindTotals(k)])) as Record<
      UsageKind,
      UsageTotals
    >,
  };
  const earlierWeeks = EARLIER_WEEK_COSTS.map((costs, i) => {
    const byKind = Object.fromEntries(
      KINDS.map(k => [k, tot(0, costs[k] * 2000, 0, 0, costs[k])])
    ) as Record<UsageKind, UsageTotals>;
    const start = new Date(WEEK);
    start.setDate(start.getDate() - 7 * (EARLIER_WEEK_COSTS.length - i));
    return {
      weekStart: start.getTime(),
      totals: sum(Object.values(byKind)),
      byKind,
    };
  });
  const weeks = [...earlierWeeks, week];

  return {
    mrs: {
      mrs: rows,
      summary: {
        mrCount: rows.length,
        totals: sum(rows.map(r => r.totals)),
        medianCost,
      },
    },
    mr: key => all.find(d => d.mrKey === key) ?? null,
    trends: {
      weeks,
      totals: sum(weeks.map(w => w.totals)),
      byPipeline: [
        { pipeline: 'feature', totals: full.runs[0]!.totals },
        { pipeline: 'respond', totals: kindTotals('respond') },
        { pipeline: 'review', totals: kindTotals('review') },
        { pipeline: null, totals: kindTotals('doctor') },
      ],
      byModel: seenModels(
        sum(all.map(d => d.main)),
        sum(all.map(d => d.subagent))
      ),
    },
    status: {
      lastSweepAt: WEEK + 5 * DAY,
      lastSweepMs: 840,
      messages: 4210,
      runs: new Set(all.flatMap(d => d.runs.flatMap(r => r.runId ?? []))).size,
      skippedLines: 0,
      conflicts: 0,
      skippedRate: 0,
      unpricedModels: [],
      sessionsMissingTranscript: 0,
    },
  };
}

export function emptyUsageFixture(): UsageFixture {
  return {
    mrs: { mrs: [], summary: { mrCount: 0, totals: ZERO, medianCost: 0 } },
    mr: () => null,
    trends: { weeks: [], totals: ZERO, byPipeline: [], byModel: [] },
    status: {
      lastSweepAt: null,
      lastSweepMs: null,
      messages: 0,
      runs: 0,
      skippedLines: 0,
      conflicts: 0,
      skippedRate: 0,
      unpricedModels: [],
      sessionsMissingTranscript: 0,
    },
  };
}
