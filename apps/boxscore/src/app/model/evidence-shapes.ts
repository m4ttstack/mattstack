import type { MetricEvidence } from '../../shared/types';

export interface Bin {
  label: string;
  count: number;
  highlight: boolean;
}

export interface CalendarDay {
  date: string;
  count: number;
  inWindow: boolean;
  level: 0 | 1 | 2 | 3;
}

export interface MergeDay {
  date: string;
  count: number;
  run: 'longest' | 'current' | 'other' | 'none';
}

export interface DayStatus {
  date: string;
  success: number;
  failed: number;
  canceled: number;
  running: number;
}

interface Edge {
  label: string;
  lo: number;
  hi: number;
}

const DAY_MS = 86_400_000;

function column(ev: MetricEvidence, name: string, fallback: number): string[] {
  const i = ev.columns.indexOf(name);
  const at = i === -1 ? fallback : i;
  return ev.rows.map(r => r.cells[at] ?? '');
}

/** Reads the leading number, so "4.3h" and "12" both parse. */
function numbers(ev: MetricEvidence, name: string, fallback: number): number[] {
  return column(ev, name, fallback)
    .map(s => Number.parseFloat(s))
    .filter(n => Number.isFinite(n));
}

/** Bins are half open, [lo, hi), so an edge value lands in the upper bin. */
function bin(
  values: number[],
  edges: Edge[],
  highlight: (e: Edge) => boolean
): Bin[] {
  return edges.map(e => ({
    label: e.label,
    count: values.filter(v => v >= e.lo && v < e.hi).length,
    highlight: highlight(e),
  }));
}

const WAIT_EDGES: Edge[] = [
  { label: '< 0.5h', lo: -Infinity, hi: 0.5 },
  { label: '0.5–1h', lo: 0.5, hi: 1 },
  { label: '1–2h', lo: 1, hi: 2 },
  { label: '2–4h', lo: 2, hi: 4 },
  { label: '4–8h', lo: 4, hi: 8 },
  { label: '8–24h', lo: 8, hi: 24 },
  { label: '24h +', lo: 24, hi: Infinity },
];

const SIZE_EDGES: Edge[] = [
  { label: '< 10', lo: -Infinity, hi: 10 },
  { label: '10–50', lo: 10, hi: 50 },
  { label: '50–100', lo: 50, hi: 100 },
  { label: '100–200', lo: 100, hi: 200 },
  { label: '200–400', lo: 200, hi: 400 },
  { label: '400–800', lo: 400, hi: 800 },
  { label: '800 +', lo: 800, hi: Infinity },
];

const DEPTH_EDGES: Edge[] = [
  { label: '0', lo: -Infinity, hi: 1 },
  { label: '1', lo: 1, hi: 2 },
  { label: '2', lo: 2, hi: 3 },
  { label: '3–5', lo: 3, hi: 6 },
  { label: '6 +', lo: 6, hi: Infinity },
];

export function waitBins(ev: MetricEvidence): Bin[] {
  const p50 = ev.facts?.p50;
  return bin(
    numbers(ev, 'Wait', 2),
    WAIT_EDGES,
    e => p50 !== undefined && p50 >= e.lo && p50 < e.hi
  );
}

export function sizeBins(ev: MetricEvidence): Bin[] {
  const low = ev.facts?.bandLow ?? -Infinity;
  const high = ev.facts?.bandHigh ?? -Infinity;
  return bin(
    numbers(ev, 'Changed', 2),
    SIZE_EDGES,
    e => e.lo >= low && e.hi <= high
  );
}

export function depthBins(ev: MetricEvidence): Bin[] {
  return bin(
    numbers(ev, 'Inline comments', 2),
    DEPTH_EDGES,
    e => e.label !== '0'
  );
}

const dayNum = (date: string): number =>
  Math.round(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / DAY_MS);
const dateOf = (n: number): string =>
  new Date(n * DAY_MS).toISOString().slice(0, 10);

/**
 * The window's days run from the start's UTC day for as many whole days as
 * the window spans, so a 30 day window is 30 cells even when both ends fall
 * mid-day.
 */
function windowDays(windowStart: string, windowEnd: string): number[] {
  const first = dayNum(windowStart);
  const span = Math.round(
    (Date.parse(windowEnd) - Date.parse(windowStart)) / DAY_MS
  );
  return Array.from({ length: Math.max(span, 0) }, (_, i) => first + i);
}

/** Date-keyed evidence: the first column is the day, the second its count. */
function countsByDay(ev: MetricEvidence): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of ev.rows) {
    const date = r.cells[0];
    const n = Number(r.cells[1]);
    if (!date || !Number.isFinite(n)) continue;
    const key = dayNum(date);
    out.set(key, (out.get(key) ?? 0) + n);
  }
  return out;
}

function level(count: number): CalendarDay['level'] {
  if (count === 0) return 0;
  if (count < 6) return 1;
  if (count < 15) return 2;
  return 3;
}

export function calendarWeeks(
  ev: MetricEvidence,
  windowStart: string,
  windowEnd: string
): CalendarDay[][] {
  const days = windowDays(windowStart, windowEnd);
  if (days.length === 0) return [];
  const counts = countsByDay(ev);
  const first = days[0]!;
  const last = days.at(-1)!;
  // Day 0 of the epoch, 1970-01-01, was a Thursday.
  const weekday = (n: number) => (((n + 4) % 7) + 7) % 7;
  const gridStart = first - weekday(first);
  const gridEnd = last + (6 - weekday(last));
  const weeks: CalendarDay[][] = [];
  for (let n = gridStart; n <= gridEnd; n++) {
    if (weekday(n) === 0) weeks.push([]);
    const inWindow = n >= first && n <= last;
    const count = inWindow ? (counts.get(n) ?? 0) : 0;
    weeks
      .at(-1)!
      .push({ date: dateOf(n), count, inWindow, level: level(count) });
  }
  return weeks;
}

/**
 * Runs are consecutive calendar days with a merge. Ties for longest go to the
 * latest run, and a current run that is also the longest reads as longest.
 */
export function mergeDays(
  ev: MetricEvidence,
  windowStart: string,
  windowEnd: string
): MergeDay[] {
  const days = windowDays(windowStart, windowEnd);
  const counts = countsByDay(ev);
  const runs: number[][] = [];
  for (const n of days) {
    if (!(counts.get(n) ?? 0)) continue;
    const run = runs.at(-1);
    if (run && run.at(-1) === n - 1) run.push(n);
    else runs.push([n]);
  }
  let longest: number[] | undefined;
  for (const r of runs) if (!longest || r.length >= longest.length) longest = r;
  const current = runs.at(-1);
  const runOf = new Map<number, MergeDay['run']>();
  for (const r of runs) {
    const kind =
      r === longest ? 'longest' : r === current ? 'current' : 'other';
    for (const n of r) runOf.set(n, kind);
  }
  return days.map(n => ({
    date: dateOf(n),
    count: counts.get(n) ?? 0,
    run: runOf.get(n) ?? 'none',
  }));
}

/** Any status other than success, failed or canceled counts as running. */
export function pipelinesByDay(ev: MetricEvidence, days: number): DayStatus[] {
  const statuses = column(ev, 'Status', 0);
  const created = column(ev, 'Created', 1);
  const byDay = new Map<string, DayStatus>();
  statuses.forEach((status, i) => {
    const date = created[i]!.slice(0, 10);
    if (!date) return;
    let d = byDay.get(date);
    if (!d) {
      d = { date, success: 0, failed: 0, canceled: 0, running: 0 };
      byDay.set(date, d);
    }
    if (status === 'success' || status === 'failed' || status === 'canceled')
      d[status] += 1;
    else d.running += 1;
  });
  return [...byDay.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, days);
}

export function reviewsByAuthor(
  ev: MetricEvidence
): Array<{ author: string; count: number }> {
  const counts = new Map<string, number>();
  for (const author of column(ev, 'Author', 1))
    if (author) counts.set(author, (counts.get(author) ?? 0) + 1);
  return [...counts.entries()]
    .map(([author, count]) => ({ author, count }))
    .sort((a, b) => b.count - a.count || a.author.localeCompare(b.author));
}
