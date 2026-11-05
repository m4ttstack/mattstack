import type {
  UsageKind,
  UsageMrEntry,
  UsageTotals,
} from '@mattstack/rt-client';

import { repoPath } from '../runs/repoLabel';

export const KIND_ORDER: UsageKind[] = [
  'work',
  'review',
  'respond',
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
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}

export function allTokens(t: UsageTotals): number {
  return t.input + t.output + t.cacheRead + t.cacheWrite;
}

/** An MR key is `<serialized repo>!<number>`. */
export function mrParts(mrKey: string): { repo: string; number: string } {
  const bang = mrKey.lastIndexOf('!');
  return {
    repo: repoPath(mrKey.slice(0, bang)),
    number: `!${mrKey.slice(bang + 1)}`,
  };
}

export const usageMrHref = (mrKey: string) =>
  `/usage/${encodeURIComponent(mrKey)}`;

export function entryLabel(entry: UsageMrEntry): string {
  if (entry.kind === 'respond' && entry.round !== null)
    return `Round ${entry.round}`;
  return KIND_LABEL[entry.kind];
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

export const shortDay = (at: number) => DAY_FORMAT.format(at);
