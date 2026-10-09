import type { IconName } from '@mattstack/app-kit/icons';
import type {
  GateRow,
  RunDetail,
  RunFieldRow,
  RunSummary,
} from '@mattstack/rt-client';

import { runIdOfGate } from '../../../shared/gate-run';
import {
  countsForConsoleBadge,
  isMine,
  isWaiting,
} from '../../../shared/gate-waiting';
import { isHandoffGate, waitingHandoff } from '../../../shared/handoff';
import { formatDuration } from './duration';
import { fieldLabel, storyFields } from './fields';
import { gateStage } from './gates';
import { runKind, type RunKind } from './kind';
import { heroLiveness, type HeroLiveness, type HeroTone } from './liveness';
import { ciLabel } from './page';
import { answeredGates, recordEnd } from './record';
import { heldSpans } from './run';
import { railStages, stageAttempts, type RailStage } from './stages';

export type RunsFilter = 'all' | 'live' | 'waiting' | 'done';

const MEDIAN_WINDOW = 30;

export const isStale = (run: RunSummary) =>
  run.ended_at == null && run.attention.reason === 'stale';

/** A run still going that rt does not call stale: it gets a live lane. */
export const isLive = (run: RunSummary) =>
  run.ended_at == null && !isStale(run);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export interface Banner {
  gate: GateRow;
  run: RunSummary;
}

/** The gates waiting on me, each with its run: the console badge's count,
    for the runs on this page. The banner and the waiting stat both read it,
    so they always agree. */
export function waitingOnMe(
  runs: RunSummary[],
  gates: GateRow[],
  now: number
): Banner[] {
  const byId = new Map(runs.map(r => [r.id, r] as const));
  const out: Banner[] = [];
  for (const gate of gates) {
    if (!countsForConsoleBadge(gate, now)) continue;
    const run = byId.get(runIdOfGate(gate) ?? '');
    if (run) out.push({ gate, run });
  }
  return out.sort((a, b) => a.gate.openedAt - b.gate.openedAt);
}

/** My oldest waiting `run:` gate. Herd-owned gates and the board's review
    and respond gates never show here. */
export function waitingBanner(
  runs: RunSummary[],
  gates: GateRow[],
  now: number
): Banner | null {
  return waitingOnMe(runs, gates, now)[0] ?? null;
}

/** Live lanes (newest first) and every other run. A live banner run is the
    banner, not a lane; a stale or ended one still lists in Earlier. */
export function splitRuns(
  runs: RunSummary[],
  bannerRunId: string | null
): { lanes: RunSummary[]; earlier: RunSummary[] } {
  const lanes: RunSummary[] = [];
  const earlier: RunSummary[] = [];
  for (const run of runs) {
    if (!isLive(run)) earlier.push(run);
    else if (run.id !== bannerRunId) lanes.push(run);
  }
  lanes.sort((a, b) => b.started_at - a.started_at);
  return { lanes, earlier };
}

/** When a row's run stopped: the merge of its own MR, its end, or for a run
    still marked running its last event. */
export function rowEnd(run: RunSummary, now: number): number {
  if (run.ended_at == null) return run.last_event_at ?? now;
  return recordEnd(run, now).at;
}

export function rowDuration(run: RunSummary, now: number): number {
  const end = run.ended_at ?? (isStale(run) ? run.last_event_at : now);
  return Math.max(0, end - run.started_at);
}

const dayKey = (ms: number) => new Date(ms).toDateString();

export interface DayGroup {
  key: string;
  label: string;
  runs: RunSummary[];
}

/** Earlier runs by the day they stopped, newest day and newest run
    first. */
export function dayGroups(runs: RunSummary[], now: number): DayGroup[] {
  const today = dayKey(now);
  const d = new Date(now);
  const yesterday = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() - 1
  ).toDateString();
  const sorted = [...runs].sort((a, b) => rowEnd(b, now) - rowEnd(a, now));
  const groups: DayGroup[] = [];
  for (const run of sorted) {
    const end = rowEnd(run, now);
    const key = dayKey(end);
    let group = groups.at(-1);
    if (group?.key !== key) {
      const label =
        key === today
          ? 'Today'
          : key === yesterday
            ? 'Yesterday'
            : new Date(end).toLocaleDateString([], {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              });
      group = { key, label, runs: [] };
      groups.push(group);
    }
    group.runs.push(run);
  }
  return groups;
}

/** The first `days` day groups of the Earlier list, and whether more follow. */
export function earlierPage(
  groups: DayGroup[],
  days: number
): { shown: DayGroup[]; more: boolean } {
  return { shown: groups.slice(0, days), more: groups.length > days };
}

/** What rt still flags on a finished run ("stranded"), when the ending does
    not already say it. */
function attentionNote(run: RunSummary): string | null {
  const { needs, reason } = run.attention;
  if (run.ended_at == null || !needs || !reason || reason === run.status)
    return null;
  return reason;
}

/** How the run ended, after its pipeline: "!405 merged", "reviewed !412 ·
    request changes", "stale · no pane". */
function endingText(run: RunSummary): string | null {
  if (isStale(run)) return run.agent ? 'stale' : 'stale · no pane';
  const reviewed = run.outcome?.reviewed;
  if (reviewed)
    return reviewed.posted
      ? `reviewed !${reviewed.iid} · ${reviewed.posted}`
      : `reviewed !${reviewed.iid}`;
  if (run.status === 'abandoned' || run.status === 'failed') return run.status;
  const mr = run.outcome?.mr;
  if (mr && mr.state !== 'unknown')
    return `!${mr.iid} ${mr.state === 'opened' ? 'open' : mr.state}`;
  if (run.ended_at == null) return 'running';
  return null;
}

export function rowSub(run: RunSummary): string {
  return [`${run.pipeline} pipeline`, endingText(run), attentionNote(run)]
    .filter(Boolean)
    .join(' · ');
}

export interface OutcomeTile {
  tone: HeroTone;
  icon: IconName;
  /** The board's icon layer, named after the lucide glyph. */
  layer: string;
}

export function outcomeTile(run: RunSummary): OutcomeTile {
  const kind = runKind(run.work_type);
  if (isStale(run) || run.status === 'abandoned')
    return { tone: 'gray', icon: 'circleSlash', layer: 'circle-slash' };
  if (run.status === 'failed')
    return { tone: 'bad', icon: 'circleX', layer: 'circle-x' };
  if (attentionNote(run))
    return { tone: 'warn', icon: 'warning', layer: 'triangle-alert' };
  if (kind === 'review' || kind === 'respond')
    return { tone: 'accent', icon: 'messageSquare', layer: 'message-square' };
  if (run.ended_at == null)
    return { tone: 'accent', icon: 'circleDot', layer: 'circle-dot' };
  const mr = run.outcome?.mr;
  if (mr?.state === 'merged')
    return { tone: 'ok', icon: 'gitMerge', layer: 'git-merge' };
  if (mr && mr.state !== 'unknown')
    return {
      tone: mr.state === 'opened' ? 'accent' : 'gray',
      icon: 'gitPullRequest',
      layer: 'git-pull-request',
    };
  return { tone: 'ok', icon: 'circleCheck', layer: 'circle-check' };
}

/** The evidence column: a work run's image count, else the links its
    legacy evidence names (as the record counts them), else a dash so the
    columns stay aligned. */
export function evidenceText(run: RunSummary): string {
  if (runKind(run.work_type) !== 'work') return '—';
  const images = run.evidence_count ?? 0;
  if (images > 0) return `${images} evidence`;
  const links = run.evidence_links ?? 0;
  return links > 0 ? plural(links, 'link') : '—';
}

export const decisionsText = (n: number) => plural(n, 'decision');

/** The most recent story field; a tie goes to the one written first. */
export function latestField(fields: RunFieldRow[]): RunFieldRow | null {
  let best: RunFieldRow | null = null;
  for (const f of storyFields(fields)) if (!best || f.at > best.at) best = f;
  return best;
}

export const fieldLine = (f: RunFieldRow) => `${fieldLabel(f.key)}: ${f.value}`;

/** A lane's MR line: the run's own MR and its CI, the MR a review read, or
    that a work run has none yet. Null when neither applies. */
export function laneMrLine(run: RunSummary, kind: RunKind): string | null {
  const reviewed = run.outcome?.reviewed;
  if (reviewed) return `reviewing !${reviewed.iid}`;
  const mr = run.outcome?.mr;
  if (mr && mr.state !== 'unknown') {
    const ci = ciLabel(run.outcome?.ci);
    const head = `!${mr.iid} ${mr.state === 'opened' ? 'open' : mr.state}`;
    return ci ? `${head} · ${ci}` : head;
  }
  return kind === 'work' ? 'no MR yet' : null;
}

export interface LaneFacts {
  kind: RunKind;
  liveness: HeroLiveness;
  focusPane: string | null;
  /** Null for a run kind with no rail, and until the run's detail lands. */
  rail: RailStage[] | null;
  stage: string | null;
  elapsed: string | null;
  field: string | null;
  mr: string | null;
  decisions: string;
  age: string;
}

/** What a live lane says about its run. The rail and the latest field come
    from the run's detail. */
export function laneFacts({
  run,
  detail,
  gates,
  now,
}: {
  run: RunSummary;
  detail: Pick<RunDetail, 'stages' | 'fields' | 'decisions'> | undefined;
  gates: GateRow[];
  now: number;
}): LaneFacts {
  const kind = runKind(run.work_type);
  const mine =
    gates
      .filter(g => countsForConsoleBadge(g, now))
      .sort((a, b) => a.openedAt - b.openedAt)[0] ?? null;
  const current = run.stages?.findLast(s => s.status === 'running') ?? null;
  const since = current?.started_at ?? null;
  const fields =
    detail && since != null ? detail.fields.filter(f => f.at >= since) : [];
  const latest = latestField(fields);
  const rail =
    kind === 'work' && detail
      ? railStages(
          detail.fields.find(f => f.key === 'pipeline-stages')?.value ?? null,
          stageAttempts(detail.stages, run, now),
          heldSpans(detail.stages, detail.decisions),
          mine ? gateStage(mine, detail.stages) : null,
          now
        )
      : null;
  return {
    kind,
    liveness: heroLiveness(
      run,
      { mine, handoff: waitingHandoff(gates.filter(isMine)) },
      now
    ),
    focusPane: run.agent && run.agent.status !== 'done' ? run.agent.pane : null,
    rail,
    stage: run.current_stage,
    elapsed: since != null ? formatDuration(now - since) : null,
    field: latest ? fieldLine(latest) : ciLabel(run.outcome?.ci),
    mr: laneMrLine(run, kind),
    decisions: decisionsText(answeredGates(gates).length),
    age: `running ${formatDuration(now - run.started_at)}`,
  };
}

export interface RunsStats {
  waiting: { count: number; oldestMs: number | null };
  live: { count: number; stages: string[] };
  finished: {
    count: number;
    merged: number;
    abandoned: number;
    reviewsPosted: number;
  };
  median: { ms: number | null; runs: number };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function runsStats({
  runs,
  gates,
  lanes,
  now,
}: {
  runs: RunSummary[];
  gates: GateRow[];
  lanes: RunSummary[];
  now: number;
}): RunsStats {
  const waiting = waitingOnMe(runs, gates, now).map(w => w.gate);
  const oldest = Math.min(...waiting.map(g => g.openedAt));

  const today = dayKey(now);
  const finishedToday = runs.filter(
    r => r.ended_at != null && dayKey(rowEnd(r, now)) === today
  );
  const isWork = (r: RunSummary) => runKind(r.work_type) === 'work';
  const handedOff = (r: RunSummary) => {
    const kind = runKind(r.work_type);
    return kind === 'review' || kind === 'respond';
  };

  const workRuns = runs
    .filter(r => isWork(r) && r.status === 'done' && r.ended_at != null)
    .sort((a, b) => b.ended_at! - a.ended_at!)
    .slice(0, MEDIAN_WINDOW);

  return {
    waiting: {
      count: waiting.length,
      oldestMs: waiting.length > 0 ? now - oldest : null,
    },
    live: {
      count: lanes.length,
      stages: [
        ...new Set(
          lanes.map(r => r.current_stage).filter((s): s is string => !!s)
        ),
      ],
    },
    finished: {
      count: finishedToday.length,
      merged: finishedToday.filter(
        r => isWork(r) && r.outcome?.mr?.state === 'merged'
      ).length,
      abandoned: finishedToday.filter(
        r => isWork(r) && r.status === 'abandoned'
      ).length,
      reviewsPosted: finishedToday.filter(
        r => handedOff(r) && r.outcome?.reviewed?.posted
      ).length,
    },
    median: {
      ms: median(workRuns.map(r => r.ended_at! - r.started_at)),
      runs: workRuns.length,
    },
  };
}

export interface StatCard {
  role: 'Waiting on you' | 'Live' | 'Finished today' | 'Median work run';
  tone: HeroTone;
  value: string;
  /** The card's second line and its board layer. */
  sub: string;
  subLayer: 'oldest' | 'stages' | 'split' | 'window';
}

export function statCards(stats: RunsStats): StatCard[] {
  const { waiting, live, finished, median: m } = stats;
  const split = [
    finished.merged > 0 ? `${finished.merged} merged` : null,
    finished.abandoned > 0 ? `${finished.abandoned} abandoned` : null,
    finished.reviewsPosted > 0
      ? `${plural(finished.reviewsPosted, 'review')} posted`
      : null,
  ].filter(Boolean);
  return [
    {
      role: 'Waiting on you',
      tone: 'bad',
      value: String(waiting.count),
      sub:
        waiting.oldestMs == null
          ? 'nothing waiting'
          : `${plural(waiting.count, 'gate')} · ${formatDuration(waiting.oldestMs)}`,
      subLayer: 'oldest',
    },
    {
      role: 'Live',
      tone: 'accent',
      value: String(live.count),
      sub: live.count > 0 ? live.stages.join(' · ') : 'nothing running',
      subLayer: 'stages',
    },
    {
      role: 'Finished today',
      tone: 'ok',
      value: String(finished.count),
      sub:
        finished.count === 0
          ? 'none yet'
          : split.length > 0
            ? split.join(' · ')
            : plural(finished.count, 'run'),
      subLayer: 'split',
    },
    {
      role: 'Median work run',
      tone: 'gray',
      value: m.ms == null ? '—' : formatDuration(m.ms),
      sub:
        m.runs === 0
          ? 'no finished work runs'
          : `last ${plural(m.runs, 'work run')}`,
      subLayer: 'window',
    },
  ];
}

/** Runs with a gate waiting on me, and runs whose review or respond gate
    waits on me in the board. */
export function waitingRuns(gates: GateRow[], now: number) {
  const onYou = new Set<string>();
  const inBoard = new Set<string>();
  for (const g of gates) {
    const runId = runIdOfGate(g);
    if (!runId) continue;
    if (countsForConsoleBadge(g, now)) onYou.add(runId);
    else if (isHandoffGate(g) && isWaiting(g) && isMine(g)) inBoard.add(runId);
  }
  return { onYou, inBoard };
}

export interface RunsView {
  banner: Banner | null;
  /** Null when the filter hides the section. */
  lanes: RunSummary[] | null;
  earlier: RunSummary[] | null;
  inBoard: Set<string>;
}

/** What each section shows under a filter. */
export function filterView({
  filter,
  runs,
  gates,
  now,
}: {
  filter: RunsFilter;
  runs: RunSummary[];
  gates: GateRow[];
  now: number;
}): RunsView & { allLanes: RunSummary[] } {
  const banner = waitingBanner(runs, gates, now);
  const { lanes, earlier } = splitRuns(runs, banner?.run.id ?? null);
  const { onYou, inBoard } = waitingRuns(gates, now);
  const waits = (r: RunSummary) => onYou.has(r.id) || inBoard.has(r.id);
  const base = { inBoard, allLanes: lanes };
  switch (filter) {
    case 'all':
      return { ...base, banner, lanes, earlier };
    case 'live':
      return { ...base, banner, lanes, earlier: null };
    case 'waiting':
      return {
        ...base,
        banner,
        lanes: lanes.filter(waits),
        earlier: earlier.filter(waits),
      };
    case 'done':
      return { ...base, banner: null, lanes: null, earlier };
  }
}
