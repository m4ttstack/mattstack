/**
 * The UI's view of metric metadata is just the shared single-source-of-truth, re-exported
 * with display formatting. Ranking/classification now comes from the server (each metric
 * carries a `rank`), so the UI never computes "who's #1" itself.
 */
import {
  deltaIsGood,
  formatNumber,
  formatValue,
  GROUPS,
  metricDelta,
  metricRank,
  METRICS,
  metricValue,
  type MetricDescriptor,
  type MetricGroup,
} from '../shared/metrics';

export type Column = MetricDescriptor;

export const COLUMNS: Column[] = METRICS;

export const sortValue = metricValue;
export const deltaValue = metricDelta;
export const rankValue = metricRank;
export { deltaIsGood, formatNumber, formatValue };

export { GROUP_ORDER, GROUPS } from '../shared/metrics';

const HUE_COLOR = {
  cyan: 'cyan',
  neutral: 'dimmed',
  accent: 'accent',
  gold: 'var(--tk-text-gold-small)',
  purple: 'purple',
} as const;

/** A `c` prop value for a group's hue: a Mantine colour name, or a role token where Tokyo has no named colour. */
export function groupColor(g: MetricGroup): string {
  return HUE_COLOR[GROUPS[g].hue];
}
