import { deltaIsGood, formatNumber, metricDelta } from '../../shared/metrics';
import type { MetricKey, UserMetrics } from '../../shared/types';
import { descriptor } from './standings';

export type DeltaTone = 'better' | 'worse' | 'none';

/** The delta at the precision `formatDelta` prints, so tone and text never disagree. */
function shown(key: MetricKey, delta: number): number {
  const scale = descriptor(key).percent ? 100 : 10;
  return (Math.sign(delta) * Math.round(Math.abs(delta) * scale)) / scale;
}

export function deltaTone(key: MetricKey, delta: number | null): DeltaTone {
  if (delta === null) return 'none';
  const d = shown(key, delta);
  if (d === 0) return 'none';
  return deltaIsGood(d, descriptor(key).better) ? 'better' : 'worse';
}

export function formatDelta(key: MetricKey, delta: number): string {
  const d = descriptor(key);
  const value = shown(key, delta);
  const arrow = value > 0 ? '▲' : value < 0 ? '▼' : '';
  const size = Math.abs(value);
  if (d.percent) return `${arrow}${Math.round(size * 100)}%`;
  const body = formatNumber(size);
  return d.kind === 'dist' ? `${arrow}${body}h` : `${arrow}${body}`;
}

export interface Delta {
  text: string;
  tone: DeltaTone;
}

/** A user's delta on one stat, or null when it rounds to no change or has no prior. */
export function userDelta(metrics: UserMetrics, key: MetricKey): Delta | null {
  const delta = metricDelta(metrics, descriptor(key));
  if (delta === null) return null;
  const tone = deltaTone(key, delta);
  return tone === 'none' ? null : { text: formatDelta(key, delta), tone };
}
