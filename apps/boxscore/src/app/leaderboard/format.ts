import { formatNumber } from '../../shared/metrics';
import type { MetricKey } from '../../shared/types';
import { descriptor } from '../model/standings';

const TWO_PLACES = new Set<MetricKey>(['reviewDepth', 'reciprocity']);

/** A standings cell: ratios and hours always carry two places so the column lines up. */
export function cellText(key: MetricKey, value: number | null): string {
  if (value === null) return '—';
  const d = descriptor(key);
  if (d.kind === 'dist') return `${value.toFixed(2)}h`;
  if (d.percent) return `${Math.round(value * 100)}%`;
  if (TWO_PLACES.has(key)) return value.toFixed(2);
  return formatNumber(value);
}

const TILE_UNIT: Partial<Record<MetricKey, string>> = {
  codingDays: 'days',
};

/** A leader tile's headline: the number alone, with any unit set beside it. */
export function tileValue(
  key: MetricKey,
  value: number | null
): { value: string; unit: string | null } {
  if (value === null) return { value: '—', unit: null };
  const d = descriptor(key);
  if (d.kind === 'dist') return { value: value.toFixed(2), unit: 'h p50' };
  if (d.percent) return { value: `${Math.round(value * 100)}%`, unit: null };
  return { value: formatNumber(value), unit: TILE_UNIT[key] ?? null };
}

const CARD_UNIT: Partial<Record<MetricKey, string>> = {
  currentStreak: 'd',
  longestStreak: 'd',
};

/** A card's ranking value: the cell text plus any per-stat unit. */
export function cardValue(key: MetricKey, value: number | null): string {
  if (value === null) return '—';
  const d = descriptor(key);
  const text = cellText(key, value);
  if (d.kind === 'dist' || d.percent) return text;
  return text + (CARD_UNIT[key] ?? d.unit ?? '');
}

export function signed(value: number, sign: '+' | '−'): string {
  return `${sign}${formatNumber(value)}`;
}
