import type {
  UsageKind,
  UsageMrData,
  UsageMrRow,
  UsageTotals,
} from '@mattstack/rt-client';

import { repoPath } from '../runs/repoLabel';

export const KIND_ORDER: UsageKind[] = [
  'work',
  'respond',
  'review',
  'doctor',
  'other',
];

export const KIND_LABEL: Record<UsageKind, string> = {
  work: 'Work',
  review: 'Review',
  respond: 'Respond',
  doctor: 'Doctor',
  other: 'Other',
};

export function usd(cost: number): string {
  if (cost >= 1000) return `$${Math.round(cost).toLocaleString('en-US')}`;
  return `$${cost.toFixed(2)}`;
}

export function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}K`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

/** An MR key is `<serialized repo>!<number>`. */
export function mrParts(mrKey: string): {
  repoKey: string;
  repo: string;
  number: string;
} {
  const bang = mrKey.lastIndexOf('!');
  const repoKey = mrKey.slice(0, bang);
  return {
    repoKey,
    repo: repoPath(repoKey),
    number: `!${mrKey.slice(bang + 1)}`,
  };
}

export const usageMrHref = (mrKey: string) =>
  `/usage/${encodeURIComponent(mrKey)}`;

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export type MrSort = 'cost' | 'date' | 'output' | 'cacheRead';

export interface MrSortOrder {
  sort: MrSort;
  dir: 'asc' | 'desc';
}

const MR_SORT_VALUES: Record<MrSort, (row: UsageMrRow) => number[]> = {
  cost: row => [row.byBilling.metered.cost, row.totals.cost],
  date: row => [row.lastActivity],
  output: row => [row.totals.output],
  cacheRead: row => [row.totals.cacheRead],
};

function compareValues(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    const diff = a[i]! - b[i]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Ties fall back to the key so a re-sort never shuffles equal rows. */
export function sortMrs(
  rows: UsageMrRow[],
  { sort, dir }: MrSortOrder
): UsageMrRow[] {
  const values = MR_SORT_VALUES[sort];
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort(
    (a, b) =>
      sign * compareValues(values(a), values(b)) ||
      a.mrKey.localeCompare(b.mrKey)
  );
}

export function nextMrOrder(order: MrSortOrder, sort: MrSort): MrSortOrder {
  if (order.sort !== sort) return { sort, dir: 'desc' };
  return { sort, dir: order.dir === 'desc' ? 'asc' : 'desc' };
}

/** What an MR's money went on, in words: `work run, 3 rounds`. */
export function mrSummary(row: UsageMrRow): string {
  const parts: string[] = [];
  if (row.costByKind.work > 0) parts.push('work run');
  else if (row.costByKind.review > 0) parts.push('review only');
  if (row.roundCount > 0) parts.push(plural(row.roundCount, 'round'));
  return parts.join(', ');
}

/** An MCP tool's id ends in the name people know it by. */
export const toolName = (id: string) => id.split('__').at(-1) ?? id;

/** `claude-opus-5-5` reads `Opus 5.5`; an id of another shape stays as is. */
export function modelName(model: string | null): string {
  if (!model) return 'Unknown';
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(model);
  if (!m) return model;
  const family = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1);
  return `${family} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
}

export function spokenOn(totals: UsageTotals, whole: number): number {
  return whole > 0 ? totals.cost / whole : 0;
}

export function runCounts(mr: UsageMrData): { runs: number; rounds: number } {
  return {
    runs: mr.runs.filter(r => r.runId !== null).length,
    rounds: mr.runs.filter(r => r.kind === 'respond').length,
  };
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

export const shortDay = (at: number) => DAY_FORMAT.format(at);

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/** The year only shows when it is not this one. */
export const shortDate = (at: number, now = Date.now()) =>
  new Date(at).getFullYear() === new Date(now).getFullYear()
    ? shortDay(at)
    : DATE_FORMAT.format(at);

/** `Oct 9`, or `Oct 9 to Oct 10` across days. */
export function daySpan(from: number, to: number): string {
  const first = shortDate(from);
  const last = shortDate(to);
  return first === last ? first : `${first} to ${last}`;
}

const TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

export const clockTime = (at: number) => TIME_FORMAT.format(at);
