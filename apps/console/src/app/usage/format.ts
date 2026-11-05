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

/** What an MR's money went on, in words: `work run, 3 rounds`. */
export function mrSummary(row: UsageMrRow): string {
  const parts: string[] = [];
  if (row.costByKind.work > 0) parts.push('work run');
  else if (row.costByKind.review > 0) parts.push('review only');
  if (row.roundCount > 0) parts.push(plural(row.roundCount, 'round'));
  return parts.join(', ');
}

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

const TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

export const clockTime = (at: number) => TIME_FORMAT.format(at);
