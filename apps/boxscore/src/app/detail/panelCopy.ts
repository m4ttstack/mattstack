import { formatNumber } from '../../shared/metrics';
import type { MetricKey } from '../../shared/types';
import { cellText } from '../leaderboard/format';
import { descriptor } from '../model/standings';
import type { ChipTone } from '../ui/CountChip';

export interface PanelChip {
  name: string;
  count: string;
  label: string;
  tone: ChipTone;
}

interface PanelCopy {
  source: string;
  sub: string;
  /** The board's wording where it differs from the metric's own description. */
  definition?: string;
  chips?: (facts: Record<string, number>) => PanelChip[];
}

const fact = (facts: Record<string, number>, key: string): string =>
  formatNumber(facts[key] ?? 0);

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
  },
  reviewDepth: {
    source: 'Source: GitLab inline diff comments',
    sub: 'inline comments per reviewed MR',
  },
  reviewLatencyHours: {
    source: 'Source: GitLab, first review on your MRs',
    sub: 'median wait for a first review',
  },
  responseLatencyHours: {
    source: 'Source: GitLab, your first response on MRs you review',
    sub: 'median time to a first response',
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
    sub: 'distinct days with a push',
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

export function definitionOf(key: MetricKey): string {
  return PANEL_COPY[key].definition ?? descriptor(key).description;
}
