import { deltaIsGood, formatNumber } from '../../shared/metrics';
import type { MetricKey } from '../../shared/types';
import { descriptor } from './standings';

export type DeltaTone = 'better' | 'worse' | 'none';

export function deltaTone(key: MetricKey, delta: number | null): DeltaTone {
  if (delta === null || delta === 0) return 'none';
  return deltaIsGood(delta, descriptor(key).better) ? 'better' : 'worse';
}

export function formatDelta(key: MetricKey, delta: number): string {
  const d = descriptor(key);
  const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '';
  const size = Math.abs(delta);
  if (d.percent) return `${arrow}${Math.round(size * 100)}%`;
  const body = formatNumber(Math.round(size * 10) / 10);
  return d.kind === 'dist' ? `${arrow}${body}h` : `${arrow}${body}`;
}
