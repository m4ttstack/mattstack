/**
 * `BOXSCORE_FIXTURE=design`: every API route answers from the invented data the
 * design boards were drawn with, so the UI can be checked against the boards.
 * Pure TypeScript with no runtime-specific imports: component tests import it.
 */
import type {
  ColdCacheResponse,
  EvidenceRow,
  LeaderboardResponse,
  MetricEvidence,
  MetricKey,
  RefreshStatusResponse,
  Scope,
  UserDetailResponse,
  UserMetrics,
  UserRow,
} from '../../shared/types.js';
import { applyRankings } from '../metrics/ranking.js';
import { mean, percentile, round, streaks } from '../metrics/stats.js';
import {
  BASE_URL,
  CURRENT_USER,
  DELTAS,
  DISTRIBUTIONS,
  LINEAR_URL,
  PIPELINE_STATUS,
  PRIOR_WINDOW,
  PROJECT_PATH,
  ROSTER,
  SCALARS,
  WINDOW,
} from './design-data.js';
import {
  ISSUES,
  ISSUES_EXCLUDED_BY_STATE,
  ISSUES_OUTSIDE_WINDOW,
  MERGED_MRS,
  OPEN_MRS,
  PIPELINE_DAYS,
  PUSH_DAYS,
  REVIEWERS,
  REVIEWS,
} from './design-evidence.js';

export type FixtureScenario = 'warm' | 'refreshing' | 'cold-stalled';

export function fixtureMode(): 'design' | null {
  return process.env.BOXSCORE_FIXTURE === 'design' ? 'design' : null;
}

export function fixtureScenario(): FixtureScenario {
  const s = process.env.BOXSCORE_FIXTURE_SCENARIO;
  return s === 'refreshing' || s === 'cold-stalled' ? s : 'warm';
}

const SYNCED_MINUTES_AGO = 4;
const SCOPE: Scope = { type: 'projects', projectPaths: [PROJECT_PATH] };
const SIZE_BAND = { low: 10, high: 400 };

function buildUsers(trend: boolean): UserRow[] {
  return ROSTER.map(([username, name], i) => {
    const delta = (key: keyof typeof DELTAS): number | null =>
      trend ? (DELTAS[key]?.[i] ?? 0) : null;
    const scalar = (key: keyof typeof SCALARS) => ({
      value: SCALARS[key][i]!,
      delta: delta(key),
      rank: null,
    });
    const dist = (key: keyof typeof DISTRIBUTIONS) => {
      const [p50, p90] = DISTRIBUTIONS[key][i]!;
      return {
        p50,
        p90,
        deltaP50: p50 === null ? null : delta(key),
        rank: null,
      };
    };
    const [success, failed, canceled, other] = PIPELINE_STATUS[i]!;
    const metrics: UserMetrics = {
      additions: scalar('additions'),
      deletions: scalar('deletions'),
      mrsMerged: scalar('mrsMerged'),
      mrsReviewed: scalar('mrsReviewed'),
      pipelines: scalar('pipelines'),
      pipelineStatus: { success, failed, canceled, other },
      reviewDepth: scalar('reviewDepth'),
      reviewLatencyHours: dist('reviewLatencyHours'),
      responseLatencyHours: dist('responseLatencyHours'),
      revertRate: scalar('revertRate'),
      revertedCount: scalar('revertedCount'),
      sizeHealthPct: scalar('sizeHealthPct'),
      codingDays: scalar('codingDays'),
      currentStreak: scalar('currentStreak'),
      longestStreak: scalar('longestStreak'),
      reciprocity: scalar('reciprocity'),
      issuesCompleted: scalar('issuesCompleted'),
    };
    return {
      username,
      name,
      resolved: true,
      isCurrentUser: username === CURRENT_USER,
      metrics,
    };
  });
}

const generatedAt = (): string =>
  new Date(Date.now() - SYNCED_MINUTES_AGO * 60_000).toISOString();

export function fixtureLeaderboard(trend: boolean): LeaderboardResponse {
  const users = buildUsers(trend);
  const leaders = applyRankings(users);
  return {
    scope: SCOPE,
    window: { ...WINDOW },
    priorWindow: trend ? { ...PRIOR_WINDOW } : null,
    hasTrend: trend,
    baseUrl: BASE_URL,
    currentUser: CURRENT_USER,
    generatedAt: generatedAt(),
    fromCache: true,
    metricNotes: {},
    leaders,
    users,
    warnings: [],
  };
}

export function fixtureDetail(
  user: string,
  trend: boolean
): UserDetailResponse | null {
  const board = fixtureLeaderboard(trend);
  const row = board.users.find(u => u.username === user);
  if (!row) return null;
  const evidence = designEvidence();
  if (user !== CURRENT_USER) retarget(evidence, row);
  return {
    window: board.window,
    priorWindow: board.priorWindow,
    hasTrend: board.hasTrend,
    baseUrl: board.baseUrl,
    currentUser: board.currentUser,
    generatedAt: board.generatedAt,
    fromCache: board.fromCache,
    user: row,
    evidence,
    warnings: [],
  };
}

export function fixtureColdCache(): ColdCacheResponse {
  return { cached: false, window: { ...WINDOW }, scope: SCOPE };
}

export function fixtureRefresh(): RefreshStatusResponse {
  return {
    jobId: 'design-fixture',
    status: 'running',
    progress: {
      phase: 'mrs-detail',
      label: 'MR details',
      done: 142,
      total: 310,
      window: 'current',
      totals: { users: ROSTER.length, 'mrs-list': 1, 'mrs-detail': 310 },
    },
  };
}

const mrUrl = (iid: number): string =>
  `${BASE_URL}/${PROJECT_PATH}/-/merge_requests/${iid}`;
const hrs = (n: number): string => `${round(n, 1)}h`;

function distFacts(samples: number[]): Record<string, number> {
  return {
    p50: round(percentile(samples, 0.5) ?? 0, 2),
    p90: round(percentile(samples, 0.9) ?? 0, 2),
    count: samples.length,
  };
}

function distSummary(samples: number[], label: string): string {
  const f = distFacts(samples);
  return `p50 ${f.p50}h · p90 ${f.p90}h over ${f.count} MRs (${label})`;
}

/** Sam Rivera's evidence, built from the drawn tables the same way evidence.ts shapes it. */
function designEvidence(): Partial<Record<MetricKey, MetricEvidence>> {
  const out: Partial<Record<MetricKey, MetricEvidence>> = {};
  const byIid = new Map(MERGED_MRS.map(m => [m[0], m]));

  const added = MERGED_MRS.reduce((s, m) => s + m[2], 0);
  const deleted = MERGED_MRS.reduce((s, m) => s + m[3], 0);
  const mergedCols = ['MR', 'Title', 'Added', 'Deleted', 'Merged'];
  const mergedRows: EvidenceRow[] = MERGED_MRS.map(
    ([iid, title, a, d, day]) => ({
      cells: [`!${iid}`, title, `+${a}`, `−${d}`, day],
      href: mrUrl(iid),
    })
  );
  const mergedFacts = { merged: MERGED_MRS.length, added, deleted };
  out.additions = {
    columns: mergedCols,
    rows: mergedRows,
    summary: `${added} lines added across ${MERGED_MRS.length} merged MRs`,
    facts: mergedFacts,
  };
  out.deletions = {
    columns: mergedCols,
    rows: mergedRows,
    summary: `${deleted} lines deleted across ${MERGED_MRS.length} merged MRs`,
    facts: mergedFacts,
  };
  out.mrsMerged = {
    columns: mergedCols,
    rows: mergedRows,
    summary: `${MERGED_MRS.length} MRs merged`,
    facts: mergedFacts,
  };

  const changed = (m: (typeof MERGED_MRS)[number]) => m[2] + m[3];
  const inBand = (m: (typeof MERGED_MRS)[number]) =>
    changed(m) >= SIZE_BAND.low && changed(m) <= SIZE_BAND.high;
  const inBandCount = MERGED_MRS.filter(inBand).length;
  out.sizeHealthPct = {
    columns: ['MR', 'Title', 'Changed', 'In band?'],
    rows: MERGED_MRS.map(m => ({
      cells: [`!${m[0]}`, m[1], String(changed(m)), inBand(m) ? '✓' : '✗'],
      href: mrUrl(m[0]),
      muted: !inBand(m),
    })),
    summary: `${inBandCount} of ${MERGED_MRS.length} MRs in the ${SIZE_BAND.low}–${SIZE_BAND.high} line band`,
    facts: {
      inBand: inBandCount,
      overBand: MERGED_MRS.filter(m => changed(m) > SIZE_BAND.high).length,
      underBand: MERGED_MRS.filter(m => changed(m) < SIZE_BAND.low).length,
      bandLow: SIZE_BAND.low,
      bandHigh: SIZE_BAND.high,
    },
  };

  const revert: MetricEvidence = {
    columns: ['MR', 'Title', 'Merged', 'Reverted by', 'Lived'],
    rows: MERGED_MRS.map(([iid, title, , , day]) => ({
      cells: [`!${iid}`, title, day, '—', '—'],
      href: mrUrl(iid),
      muted: true,
    })),
    summary: `0 of ${MERGED_MRS.length} merged MRs later reverted`,
    facts: { reverted: 0, checked: MERGED_MRS.length },
  };
  out.revertRate = revert;
  out.revertedCount = revert;

  out.mrsReviewed = {
    columns: ['MR', 'Author', 'Title', 'Comments', 'Inline'],
    rows: REVIEWS.map(([iid, author, title, comments, inline]) => ({
      cells: [`!${iid}`, author, title, String(comments), String(inline)],
      href: mrUrl(iid),
    })),
    summary: `${REVIEWS.length} teammates' MRs reviewed`,
    facts: {
      reviewed: REVIEWS.length,
      authors: new Set(REVIEWS.map(r => r[1])).size,
    },
  };
  out.reviewDepth = {
    columns: ['MR', 'Title', 'Inline comments'],
    rows: REVIEWS.map(([iid, , title, , inline]) => ({
      cells: [`!${iid}`, title, String(inline)],
      href: mrUrl(iid),
    })),
    summary: `mean ${round(mean(REVIEWS.map(r => r[4])), 2)} inline comments per reviewed MR`,
    facts: {
      reviewed: REVIEWS.length,
      inlineComments: REVIEWS.reduce((s, r) => s + r[4], 0),
    },
  };

  const responded = REVIEWS.filter(r => r[5] !== null);
  const responses = responded.map(r => r[5]!);
  out.responseLatencyHours = {
    columns: ['MR', 'Title', 'Response'],
    rows: responded.map(([iid, , title, , , h]) => ({
      cells: [`!${iid}`, title, hrs(h!)],
      href: mrUrl(iid),
    })),
    summary: distSummary(responses, 'first response'),
    facts: distFacts(responses),
  };

  const waited = [
    ...MERGED_MRS.map(m => [m[0], m[1], m[5]] as const),
    ...OPEN_MRS,
  ].sort((a, b) => b[0] - a[0]);
  const waits = waited.map(w => w[2]);
  out.reviewLatencyHours = {
    columns: ['MR', 'Title', 'Wait'],
    rows: waited.map(([iid, title, h]) => ({
      cells: [`!${iid}`, title, hrs(h)],
      href: mrUrl(iid),
    })),
    summary: distSummary(waits, 'first review'),
    facts: distFacts(waits),
  };

  const given = REVIEWS.length;
  out.reciprocity = {
    columns: ['Reviewer', 'Your MRs they reviewed'],
    rows: REVIEWERS.map(([name, n]) => ({ cells: [name, String(n)] })),
    summary: `gave ${given} reviews, received from ${REVIEWERS.length} reviewer(s) ... ratio ${round(given / REVIEWERS.length, 2)}`,
    facts: {
      given,
      received: REVIEWERS.length,
      reviewers: REVIEWERS.length,
    },
  };

  const status = { success: 0, failed: 0, canceled: 0, running: 0 };
  const pipelineRows: EvidenceRow[] = [];
  for (const [day, success, failed, canceled, running] of PIPELINE_DAYS) {
    const counts = { running, failed, canceled, success };
    for (const [s, n] of Object.entries(counts)) {
      status[s as keyof typeof status] += n;
      for (let k = 0; k < n; k++)
        pipelineRows.push({ cells: [s, day], muted: s !== 'success' });
    }
  }
  out.pipelines = {
    columns: ['Status', 'Created'],
    rows: pipelineRows,
    summary: Object.entries(status)
      .filter(([, n]) => n > 0)
      .map(([s, n]) => `${n} ${s}`)
      .join(' · '),
    facts: status,
  };

  out.codingDays = {
    columns: ['Date', 'Pushes'],
    rows: [...PUSH_DAYS]
      .reverse()
      .map(([day, n]) => ({ cells: [day, String(n)] })),
    summary: `${PUSH_DAYS.length} distinct days with a push`,
    facts: { days: PUSH_DAYS.length, windowDays: 30 },
  };

  const mergeByDay = new Map<string, number>();
  for (const m of MERGED_MRS)
    mergeByDay.set(m[4], (mergeByDay.get(m[4]) ?? 0) + 1);
  const run = streaks(MERGED_MRS.map(m => `${m[4]}T12:00:00Z`));
  const mergeDays: MetricEvidence = {
    columns: ['Date', 'MRs merged'],
    rows: [...mergeByDay.entries()]
      .sort()
      .reverse()
      .map(([d, n]) => ({ cells: [d, String(n)] })),
    summary: `longest run ${run.longest} day(s), current ${run.current}, across ${mergeByDay.size} merge day(s)`,
    facts: {
      current: run.current,
      longest: run.longest,
      mergeDays: mergeByDay.size,
    },
  };
  out.longestStreak = mergeDays;
  out.currentStreak = mergeDays;

  out.issuesCompleted = {
    columns: ['Issue', 'Title', 'State', 'Closed', 'MR(s)'],
    rows: ISSUES.map(([id, title, state, mrs]) => {
      const first = byIid.get(mrs[0]!)!;
      return {
        cells: [
          id,
          title ?? first[1],
          state,
          first[4],
          mrs.map(iid => `!${iid}`).join(', '),
        ],
        href: `${LINEAR_URL}/${id}`,
        mrHrefs: mrs.map(mrUrl),
      };
    }),
    summary: `${ISSUES.length} counted · ${ISSUES_EXCLUDED_BY_STATE} excluded by state · ${ISSUES_OUTSIDE_WINDOW} outside window`,
    facts: {
      counted: ISSUES.length,
      excludedByState: ISSUES_EXCLUDED_BY_STATE,
      outsideWindow: ISSUES_OUTSIDE_WINDOW,
    },
  };

  return out;
}

/**
 * Only Sam Rivera is on the canvas. Everyone else gets the same rows with the
 * headline facts replaced by their own values, so a panel's totals match their
 * leaderboard row.
 */
function retarget(
  ev: Partial<Record<MetricKey, MetricEvidence>>,
  row: UserRow
): void {
  const m = row.metrics;
  const set = (keys: MetricKey[], facts: Record<string, number>) => {
    for (const key of keys) {
      const e = ev[key];
      if (e) ev[key] = { ...e, facts: { ...e.facts, ...facts } };
    }
  };
  set(['issuesCompleted'], { counted: m.issuesCompleted.value });
  set(['additions', 'deletions', 'mrsMerged'], {
    merged: m.mrsMerged.value,
    added: m.additions.value,
    deleted: m.deletions.value,
  });
  set(['mrsReviewed', 'reviewDepth'], { reviewed: m.mrsReviewed.value });
  set(['reviewDepth'], {
    inlineComments: Math.round(m.reviewDepth.value * m.mrsReviewed.value),
  });
  for (const key of ['reviewLatencyHours', 'responseLatencyHours'] as const)
    set([key], { p50: m[key].p50 ?? 0, p90: m[key].p90 ?? 0 });
  const p = m.pipelineStatus;
  set(['pipelines'], {
    success: p.success,
    failed: p.failed,
    canceled: p.canceled,
    running: p.other,
  });
  set(['codingDays'], { days: m.codingDays.value });
  set(['currentStreak', 'longestStreak'], {
    current: m.currentStreak.value,
    longest: m.longestStreak.value,
  });
  set(['reciprocity'], { given: m.mrsReviewed.value });
  set(['revertRate', 'revertedCount'], { checked: m.mrsMerged.value });
  const inBand = Math.round(m.sizeHealthPct.value * m.mrsMerged.value);
  set(['sizeHealthPct'], {
    inBand,
    overBand: m.mrsMerged.value - inBand,
    underBand: 0,
  });
}
