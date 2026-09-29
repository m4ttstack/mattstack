import { GROUPS, METRICS, type MetricGroup } from '../../shared/metrics';
import type { MetricKey } from '../../shared/types';

export const HEADLINE: Record<MetricGroup, MetricKey> = {
  delivery: 'issuesCompleted',
  volume: 'mrsMerged',
  quality: 'reviewLatencyHours',
  consistency: 'codingDays',
  collaboration: 'reciprocity',
};

export const OVERVIEW: Array<MetricKey | 'lines'> = [
  'issuesCompleted',
  'mrsMerged',
  'mrsReviewed',
  'lines',
  'reviewDepth',
  'reviewLatencyHours',
  'sizeHealthPct',
  'codingDays',
  'reciprocity',
];

export function statsInGroup(g: MetricGroup): MetricKey[] {
  return METRICS.filter(d => d.group === g).map(d => d.key);
}

// Tokyo has no neutral text hue, so the neutral group borrows the plain text and muted roles.
export function hueVar(
  g: MetricGroup,
  role: 'swatch' | 'text' | 'small'
): string {
  const hue = GROUPS[g].hue;
  if (hue === 'neutral') {
    return role === 'swatch' ? 'var(--tk-muted)' : 'var(--tk-text-2)';
  }
  return role === 'small'
    ? `var(--tk-text-${hue}-small)`
    : `var(--tk-text-${hue})`;
}
