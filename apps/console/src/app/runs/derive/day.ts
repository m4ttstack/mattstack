import type {
  GateRow,
  RunDetail,
  RunStageRow,
  RunSummary,
} from '@mattstack/rt-client';

import { runIdOfGate } from '../../../shared/gate-run';
import { countsForConsoleBadge, isMine } from '../../../shared/gate-waiting';
import { answeredBy, myGateSpans } from './answers';
import { formatClock } from './clock';
import { formatDuration } from './duration';
import { gateKindLabel, gateStage, pickedText, questionAnswer } from './gates';
import { isLive, isStale, rowDuration } from './lanes';
import { answeredQuestionCount } from './record';
import { heldSpans } from './run';
import { stageAttempts } from './stages';
import { timelineSegments, type SegmentKind } from './timeline';

const HOUR_MS = 60 * 60 * 1000;
const AXIS_START_HOUR = 8;
const AXIS_END_HOUR = 18;
const TICK_HOURS = 2;
/** A tick this close to the now marker would sit under its label. */
const TICK_CLEAR_OF_NOW_MS = HOUR_MS;

export type Category = 'work' | 'ci' | 'you' | 'idle';

/** "Where the day's time went" folds the five legend kinds into four:
    running time is stage work, and held time is idle. */
export const CATEGORY_OF: Record<SegmentKind, Category> = {
  done: 'work',
  running: 'work',
  you: 'you',
  ci: 'ci',
  held: 'idle',
  idle: 'idle',
};

export const CATEGORIES: { category: Category; label: string }[] = [
  { category: 'work', label: 'Stage work' },
  { category: 'ci', label: 'Waiting on CI' },
  { category: 'you', label: 'Waiting on you' },
  { category: 'idle', label: 'Idle or held' },
];

/** The legend, in the board's order; held shares idle's swatch. */
export const LEGEND: { kind: SegmentKind; label: string }[] = [
  { kind: 'done', label: 'stage done' },
  { kind: 'running', label: 'running now' },
  { kind: 'you', label: 'waiting on you' },
  { kind: 'ci', label: 'waiting on CI' },
  { kind: 'idle', label: 'idle / held' },
];

const KIND_LABEL: Record<SegmentKind, string> = {
  done: 'stage done',
  running: 'running now',
  you: 'waiting on you',
  ci: 'waiting on CI',
  held: 'held',
  idle: 'idle',
};

export interface Bar {
  kind: SegmentKind;
  from: number;
  to: number;
  /** Every stage the bar spans, in order. */
  stages: string[];
  /** For a waiting-on-you bar, my gates open during it. */
  gates: GateRow[];
}

export interface DayRow {
  run: RunSummary;
  bars: Bar[];
  sub: { text: string; waiting: boolean };
}

export interface Tick {
  at: number;
  label: string;
  /** The board's layer: `t` and the hour on a 24-hour clock. */
  layer: string;
  /** The axis's last tick, which right-aligns to the end. */
  end: boolean;
}

export interface DayAxis {
  from: number;
  to: number;
  ticks: Tick[];
  /** Set only when the axis is today's and covers now. */
  now: number | null;
}

export type DayTotals = Record<Category, number>;

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, '0');

/** A local calendar day as `YYYY-MM-DD`. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The key itself when it names a real day, else null. */
export function parseDayKey(value: string | null | undefined): string | null {
  const m = value ? DAY_KEY.exec(value) : null;
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return dayKey(d.getTime()) === value ? value : null;
}

/** The local time `hour` hours into the day (24 is the next midnight). */
export function dayAt(key: string, hour = 0): number {
  const [, y, m, d] = DAY_KEY.exec(key)!;
  return new Date(Number(y), Number(m) - 1, Number(d), hour).getTime();
}

/** Run ids are unique within a repo only. */
export function runDetailKey(run: Pick<RunSummary, 'repo' | 'id'>): string {
  return JSON.stringify([run.repo, run.id]);
}

export function shiftDay(key: string, days: number): string {
  const [, y, m, d] = DAY_KEY.exec(key)!;
  return dayKey(new Date(Number(y), Number(m) - 1, Number(d) + days).getTime());
}

/** When a run stopped being active: its end, a stale run's last event, else
    now. */
export function runEnd(run: RunSummary, now: number): number {
  if (run.ended_at != null) return run.ended_at;
  return isStale(run) ? run.last_event_at : now;
}

export function activeOn(
  run: RunSummary,
  from: number,
  to: number,
  now: number
): boolean {
  return run.started_at < to && runEnd(run, now) > from;
}

/** Neighbouring segments of one kind read as one bar. */
function mergeBars(
  segments: ReturnType<typeof timelineSegments>,
  myGates: GateRow[],
  now: number
): Bar[] {
  const bars: Bar[] = [];
  for (const s of segments) {
    const prev = bars.at(-1);
    if (prev && prev.kind === s.kind && prev.to === s.from) {
      prev.to = s.to;
      if (s.stage && prev.stages.at(-1) !== s.stage) prev.stages.push(s.stage);
    } else {
      bars.push({
        kind: s.kind,
        from: s.from,
        to: s.to,
        stages: s.stage ? [s.stage] : [],
        gates: [],
      });
    }
  }
  for (const bar of bars) {
    if (bar.kind !== 'you') continue;
    bar.gates = myGates.filter(g => {
      const to = g.answer?.answeredAt ?? g.closedAt ?? now;
      return g.openedAt < bar.to && to > bar.from;
    });
  }
  return bars;
}

/** One run's bars over the window. A stage still marked running on a
    finished run is drawn as done, ending at the run's end. On a stale run
    the open stage runs only to the last event; after it the run is idle. */
export function rowBars({
  run,
  detail,
  gates,
  from,
  to,
  now,
}: {
  run: RunSummary;
  detail: Pick<RunDetail, 'stages' | 'decisions'>;
  gates: GateRow[];
  from: number;
  to: number;
  now: number;
}): Bar[] {
  const finished = run.ended_at != null;
  const stale = isStale(run);
  const attempts = stageAttempts(detail.stages, run, now).map(a => {
    if (a.status !== 'running') return a;
    if (finished) return { ...a, status: 'done' as const };
    if (stale && a.endedAt == null)
      return { ...a, endedAt: Math.max(run.last_event_at, a.startedAt ?? 0) };
    return a;
  });
  const mine = gates.filter(isMine);
  const segments = timelineSegments({
    attempts,
    myGateSpans: myGateSpans(mine, now),
    held: heldSpans(detail.stages, detail.decisions),
    runStart: run.started_at,
    runEnd: finished ? run.ended_at! : now,
    dayStart: from,
    dayEnd: to,
  });
  return mergeBars(segments, mine, now);
}

function currentStageStart(run: RunSummary): number | null {
  return run.stages?.findLast(s => s.status === 'running')?.started_at ?? null;
}

function ending(run: RunSummary): string {
  if (run.status === 'abandoned' || run.status === 'failed') return run.status;
  const reviewed = run.outcome?.reviewed;
  if (reviewed) return `reviewed !${reviewed.iid}`;
  const mr = run.outcome?.mr;
  if (mr?.state === 'merged') return `merged !${mr.iid}`;
  if (mr && mr.state !== 'unknown')
    return `!${mr.iid} ${mr.state === 'opened' ? 'open' : mr.state}`;
  return run.status;
}

/** A row's second line: the stage a live run is in and for how long (or
    that it waits on you), or how a finished run ended and how long it
    took. Today's state is only told on today; on a past day a run that has
    not ended yet reads as stale or still running. */
export function timelineSub(
  run: RunSummary,
  stages: RunStageRow[],
  gates: GateRow[],
  now: number,
  isToday = true
): DayRow['sub'] {
  if (run.ended_at == null && !isToday) {
    return {
      text: `${isStale(run) ? 'stale' : 'still running'} · ${formatDuration(rowDuration(run, now))}`,
      waiting: false,
    };
  }
  if (run.ended_at == null) {
    const mine = gates
      .filter(g => countsForConsoleBadge(g, now))
      .sort((a, b) => a.openedAt - b.openedAt)[0];
    if (mine) {
      const at = gateStage(mine, stages) ?? run.current_stage;
      return {
        text: at ? `${at} · waiting on you` : 'waiting on you',
        waiting: true,
      };
    }
    const stage = run.current_stage ?? 'running';
    if (isStale(run)) return { text: `${stage} · stale`, waiting: false };
    const since = currentStageStart(run);
    return {
      text: since != null ? `${stage} · ${formatDuration(now - since)}` : stage,
      waiting: false,
    };
  }
  return {
    text: `${ending(run)} · ${formatDuration(rowDuration(run, now))}`,
    waiting: false,
  };
}

const hourLabel = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: 'numeric' });

/** The wall-clock hour of `ms` on the day `key` (the next midnight is 24),
    so a 23- or 25-hour day still lines up with `dayAt`. */
function wallHour(ms: number, key: string): number {
  if (ms <= dayAt(key)) return 0;
  if (ms >= dayAt(key, 24)) return 24;
  const d = new Date(ms);
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

/** 8 AM to 6 PM, stretched in two-hour steps to cover any bar that is not
    idle; now is marked on today. */
export function dayAxis(rows: DayRow[], key: string, now: number): DayAxis {
  let lo = AXIS_START_HOUR;
  let hi = AXIS_END_HOUR;
  for (const row of rows) {
    for (const bar of row.bars) {
      if (bar.kind === 'idle') continue;
      const a = wallHour(bar.from, key);
      const b = wallHour(bar.to, key);
      lo = Math.min(lo, Math.floor(a / TICK_HOURS) * TICK_HOURS);
      hi = Math.max(hi, Math.ceil(b / TICK_HOURS) * TICK_HOURS);
    }
  }
  lo = Math.max(0, lo);
  hi = Math.min(24, hi);
  const from = dayAt(key, lo);
  const to = dayAt(key, hi);
  const isToday = dayKey(now) === key;
  const marked = isToday && now >= from && now <= to ? now : null;
  const ticks: Tick[] = [];
  for (let h = lo; h <= hi; h += TICK_HOURS) {
    const at = dayAt(key, h);
    if (marked != null && Math.abs(at - marked) < TICK_CLEAR_OF_NOW_MS)
      continue;
    ticks.push({ at, label: hourLabel(at), layer: `t${h}`, end: h === hi });
  }
  return { from, to, ticks, now: marked };
}

function clipBars(bars: Bar[], axis: DayAxis): Bar[] {
  return bars
    .map(b => ({
      ...b,
      from: Math.max(b.from, axis.from),
      to: Math.min(b.to, axis.to),
    }))
    .filter(b => b.to > b.from);
}

/** Where a bar sits on the axis, as fractions of its width. */
export function barPlacement(
  bar: Pick<Bar, 'from' | 'to'>,
  axis: Pick<DayAxis, 'from' | 'to'>
): { x: number; w: number } {
  const span = axis.to - axis.from;
  return { x: (bar.from - axis.from) / span, w: (bar.to - bar.from) / span };
}

export function dayTotals(rows: DayRow[]): DayTotals {
  const totals: DayTotals = { work: 0, ci: 0, you: 0, idle: 0 };
  for (const row of rows)
    for (const bar of row.bars)
      totals[CATEGORY_OF[bar.kind]] += bar.to - bar.from;
  return totals;
}

const gateName = (g: GateRow) => g.questions[0]?.label ?? gateKindLabel(g.kind);

/** The hover text: the stages, the kind, the gate and the times. */
export function barLabel(bar: Bar): string {
  return [
    bar.stages.length > 0 ? bar.stages.join(' → ') : 'between stages',
    KIND_LABEL[bar.kind],
    ...(bar.gates.length > 0 ? [bar.gates.map(gateName).join(' / ')] : []),
    `${formatClock(bar.from)} to ${formatClock(bar.to)}`,
  ].join(' · ');
}

export interface BarDetail {
  /** "plan · waiting on you". */
  title: string;
  /** "1:39 PM → 1:45 PM · 6m". */
  span: string;
  /** A waiting stretch's first question and who picked what, else null. */
  gate: string | null;
}

function gateLine(gate: GateRow): string | null {
  const question = gate.questions[0];
  if (!question) return null;
  const answer = questionAnswer(gate.answer, question);
  if (!answer || answer.picked.length === 0) return question.label;
  const you = answeredBy(gate)?.you;
  const who =
    you === true
      ? 'You picked'
      : you === false
        ? 'The shepherd picked'
        : 'Picked';
  return `${question.label} ${who} ${pickedText(question, answer.picked)}.`;
}

/** What the hover card on a timeline bar says. */
export function barDetail(bar: Bar): BarDetail {
  const stages =
    bar.stages.length > 0 ? bar.stages.join(' → ') : 'between stages';
  return {
    title: `${stages} · ${KIND_LABEL[bar.kind]}`,
    span: `${formatClock(bar.from)} → ${formatClock(bar.to)} · ${formatDuration(bar.to - bar.from)}`,
    gate: bar.gates[0] ? gateLine(bar.gates[0]) : null,
  };
}

/** The options a decision picked, question by question. */
export function decisionText(gate: GateRow): string {
  const picks = gate.questions
    .map(q => {
      const a = questionAnswer(gate.answer, q);
      return a && a.picked.length > 0 ? pickedText(q, a.picked) : null;
    })
    .filter((t): t is string => !!t);
  return picks.length > 0 ? picks.join(' · ') : gateKindLabel(gate.kind);
}

export interface DayDecision {
  gate: GateRow;
  run: RunSummary;
}

/** The gates you answered that day (in the console, a pane or the board) on
    the runs listed, newest first. A shepherd's answers are not yours. */
export function dayDecisions(
  runs: RunSummary[],
  gates: GateRow[],
  from: number,
  to: number
): DayDecision[] {
  const byId = new Map(runs.map(r => [r.id, r] as const));
  const out: DayDecision[] = [];
  for (const gate of gates) {
    const at = gate.answer?.answeredAt;
    if (at == null || at < from || at >= to) continue;
    if (!answeredBy(gate)?.you) continue;
    const run = byId.get(runIdOfGate(gate) ?? '');
    if (run) out.push({ gate, run });
  }
  return out.sort(
    (a, b) => b.gate.answer!.answeredAt - a.gate.answer!.answeredAt
  );
}

/** The questions answered across the day's decisions. */
export const decisionCount = (decisions: DayDecision[]) =>
  answeredQuestionCount(decisions.map(d => d.gate));

function dayTitle(key: string, now: number): string {
  const today = dayKey(now);
  if (key === today) return 'Today';
  if (key === shiftDay(today, -1)) return 'Yesterday';
  return dateLabel(key);
}

/** "Thu Oct 8", as the board writes it. */
function dateLabel(key: string): string {
  const d = new Date(dayAt(key, 12));
  const part = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString([], o);
  return `${part({ weekday: 'short' })} ${part({ month: 'short' })} ${d.getDate()}`;
}

export interface DayTimeline {
  key: string;
  isToday: boolean;
  title: string;
  sub: string;
  rows: DayRow[];
  axis: DayAxis;
  totals: DayTotals;
}

/** Every run active on the day, as rows of bars on one axis, with the day's
    totals. Live runs come first, then finished ones, newest first in each.
    A run whose detail has not landed yet has a row with no bars. */
export function dayTimeline({
  runs,
  details,
  gatesByRun,
  key,
  now,
  repoName = null,
}: {
  runs: RunSummary[];
  details: Map<string, Pick<RunDetail, 'stages' | 'decisions'>>;
  gatesByRun: Map<string, GateRow[]>;
  key: string;
  now: number;
  /** The repo the page is filtered to, named first in the sub line. */
  repoName?: string | null;
}): DayTimeline {
  const from = dayAt(key);
  const to = dayAt(key, 24);
  const isToday = dayKey(now) === key;
  const active = runs
    .filter(r => activeOn(r, from, to, now))
    .sort(
      (a, b) =>
        Number(a.ended_at != null) - Number(b.ended_at != null) ||
        b.started_at - a.started_at ||
        b.id.localeCompare(a.id)
    );
  const raw: DayRow[] = active.map(run => {
    const gates = gatesByRun.get(run.id) ?? [];
    const detail = details.get(runDetailKey(run));
    return {
      run,
      bars: detail ? rowBars({ run, detail, gates, from, to, now }) : [],
      sub: timelineSub(run, detail?.stages ?? [], gates, now, isToday),
    };
  });
  const axis = dayAxis(raw, key, now);
  const rows = raw.map(r => ({ ...r, bars: clipBars(r.bars, axis) }));

  const finished = active.filter(
    r => r.ended_at != null && r.ended_at >= from && r.ended_at < to
  ).length;
  const waiting = rows.filter(r => r.sub.waiting).length;
  const live = rows.filter(r => isLive(r.run) && !r.sub.waiting).length;
  const sub = [
    ...(repoName ? [repoName] : []),
    dateLabel(key),
    ...(isToday ? [`${live} live`, `${waiting} waiting on you`] : []),
    `${finished} finished`,
  ].join(' · ');

  return {
    key,
    isToday,
    title: dayTitle(key, now),
    sub,
    rows,
    axis,
    totals: dayTotals(rows),
  };
}
