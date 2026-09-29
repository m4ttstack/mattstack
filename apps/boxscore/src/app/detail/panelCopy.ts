import { formatNumber } from '../../shared/metrics';
import type { MetricKey, TimeWindow, UserRow } from '../../shared/types';
import { cellText } from '../leaderboard/format';
import { descriptor } from '../model/standings';
import type { ChipTone } from '../ui/CountChip';

export interface PanelChip {
  name: string;
  count?: string;
  label: string;
  tone: ChipTone;
}

type Facts = Record<string, number>;

interface PanelCopy {
  source: string;
  sub: string | ((window: TimeWindow) => string);
  /** The board's wording where it differs from the metric's own description. */
  definition?: string | ((facts: Facts | undefined) => string);
  chips?: (facts: Facts, person: UserRow) => PanelChip[];
}

const fact = (facts: Facts, key: string): string =>
  formatNumber(facts[key] ?? 0);

/** A chip named after its own text, as the evidence variants board names them. */
const chip = (label: string, tone: ChipTone): PanelChip => ({
  name: `Chip ${label}`,
  label,
  tone,
});

const hours = (n: number | undefined): string => `${(n ?? 0).toFixed(2)}h`;

const DAY_MS = 24 * 60 * 60 * 1000;

export function windowDays(window: TimeWindow): number {
  return Math.round(
    (Date.parse(window.end) - Date.parse(window.start)) / DAY_MS
  );
}

function latency(
  what: string,
  subject: string
): Pick<PanelCopy, 'definition' | 'chips'> {
  return {
    definition: facts => {
      const base = `${what}, reported as the p50. Lower is better.`;
      return facts?.count
        ? `${base} p90 is ${hours(facts.p90)} over ${formatNumber(facts.count)} ${subject}.`
        : base;
    },
    chips: facts => [
      chip(`p50 ${hours(facts.p50)}`, 'accent'),
      chip(`p90 ${hours(facts.p90)}`, 'neutral'),
      chip(`${formatNumber(facts.count ?? 0)} ${subject}`, 'neutral'),
    ],
  };
}

export const PANEL_COPY: Record<MetricKey, PanelCopy> = {
  issuesCompleted: {
    source: 'Source: Linear, via merged MRs',
    sub: 'issues closed by your merged work',
    definition:
      "Linear issues closed by merged work: an issue counts in the window its implementing MR merged (Linear's attached MR, or one referencing the issue in its title, branch, or a closing phrase), credited to that MR's author. Issues whose current state is not a done state, or with no merged implementing MR, do not count.",
    chips: facts => [
      {
        name: 'Chip counted',
        count: fact(facts, 'counted'),
        label: 'counted',
        tone: 'ok',
      },
      {
        name: 'Chip excluded by state',
        count: fact(facts, 'excludedByState'),
        label: 'excluded by state',
        tone: 'neutral',
      },
      {
        name: 'Chip outside window',
        count: fact(facts, 'outsideWindow'),
        label: 'outside window',
        tone: 'neutral',
      },
    ],
  },
  additions: { source: 'Source: GitLab MRs you authored', sub: 'lines added' },
  deletions: {
    source: 'Source: GitLab MRs you authored',
    sub: 'lines deleted',
  },
  mrsMerged: { source: 'Source: GitLab MRs you authored', sub: 'MRs merged' },
  mrsReviewed: {
    source: 'Source: GitLab notes and approvals',
    sub: "teammates' MRs reviewed",
  },
  pipelines: {
    source: 'Source: GitLab pipelines you triggered',
    sub: 'pipelines triggered',
    definition: 'Pipelines you triggered in the window, across every status.',
    chips: facts => [
      chip(`${fact(facts, 'success')} success`, 'ok'),
      chip(`${fact(facts, 'failed')} failed`, 'bad'),
      chip(`${fact(facts, 'canceled')} canceled`, 'neutral'),
      chip(`${fact(facts, 'running')} running`, 'accent'),
    ],
  },
  reviewDepth: {
    source: 'Source: GitLab inline diff comments',
    sub: 'inline comments per reviewed MR',
  },
  reviewLatencyHours: {
    source: 'Source: GitLab, first review on your MRs',
    sub: 'median wait for a first review',
    ...latency('Hours your own MRs wait for their first review', 'MRs'),
  },
  responseLatencyHours: {
    source: 'Source: GitLab, your first response on MRs you review',
    sub: 'median time to a first response',
    ...latency(
      "Hours until your first response on teammates' MRs you review",
      'MRs'
    ),
  },
  revertRate: {
    source: 'Source: GitLab, detected revert MRs',
    sub: 'of merged MRs later reverted',
  },
  revertedCount: {
    source: 'Source: GitLab, detected revert MRs',
    sub: 'merged MRs later reverted',
  },
  sizeHealthPct: {
    source: 'Source: GitLab diff stats, merged MRs',
    sub: 'of merged MRs in the healthy size band',
  },
  codingDays: {
    source: 'Source: GitLab pushes to tracked projects',
    sub: window => `distinct days with a push, of ${windowDays(window)}`,
    definition:
      'Number of distinct days you pushed at least one commit to a tracked project during the window.',
    chips: (facts, person) => [
      chip(
        `${fact(facts, 'days')} of ${fact(facts, 'windowDays')} days`,
        'gold'
      ),
      chip(`current streak ${person.metrics.currentStreak.value}d`, 'neutral'),
      chip(`longest ${person.metrics.longestStreak.value}d`, 'neutral'),
    ],
  },
  currentStreak: {
    source: 'Source: GitLab merge dates, MRs you authored',
    sub: 'current run of merge days',
  },
  longestStreak: {
    source: 'Source: GitLab merge dates, MRs you authored',
    sub: 'longest run of merge days',
  },
  reciprocity: {
    source: 'Source: GitLab reviews given and received',
    sub: 'reviews given per review received',
    definition:
      'Reviews given divided by reviews received. Around 1 means you are pulling your weight; well above 1 means you review far more than you are reviewed.',
    chips: facts => [
      chip(`gave ${fact(facts, 'given')} reviews`, 'purple'),
      chip(
        `${fact(facts, 'reviewers')} ${facts.reviewers === 1 ? 'reviewer' : 'reviewers'} on your MRs`,
        'neutral'
      ),
    ],
  },
};

const DAY_UNIT = new Set<MetricKey>(['currentStreak', 'longestStreak']);

/** A value as the panel prints it in the hero, rank and leader blocks. */
export function panelValue(key: MetricKey, value: number | null): string {
  if (value === null) return '—';
  return cellText(key, value) + (DAY_UNIT.has(key) ? 'd' : '');
}

/** The team strip's far label: the plain number, with the stat's own unit. */
export function scaleLabel(key: MetricKey, value: number): string {
  const d = descriptor(key);
  if (d.kind === 'dist') return `${value.toFixed(2)}h`;
  if (d.percent) return `${Math.round(value * 100)}%`;
  return formatNumber(value) + (DAY_UNIT.has(key) ? 'd' : '');
}

export function definitionOf(key: MetricKey, facts?: Facts): string {
  const d = PANEL_COPY[key].definition;
  if (d === undefined) return descriptor(key).description;
  return typeof d === 'string' ? d : d(facts);
}

export function subOf(key: MetricKey, window: TimeWindow): string {
  const sub = PANEL_COPY[key].sub;
  return typeof sub === 'string' ? sub : sub(window);
}
