import type { Scope, TimeWindow } from '../../shared/types';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Reads the UTC calendar date so a label never shifts with the viewer's timezone. */
export function dayLabel(iso: string): string {
  const [, month, day] = iso.slice(0, 10).split('-');
  return `${MONTHS[Number(month) - 1]} ${Number(day)}`;
}

export function windowLabel(window: TimeWindow): string {
  return `${dayLabel(window.start)} – ${dayLabel(window.end)}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The prior window ends where the current one starts, so its label stops on the
 * UTC day before that end; the two ranges never share a day.
 */
export function priorWindowLabel(window: TimeWindow): string {
  const endDay = Date.parse(window.end.slice(0, 10));
  const lastDay = new Date(endDay - DAY_MS).toISOString();
  return `${dayLabel(window.start)} – ${dayLabel(lastDay)}`;
}

export function scopeLabel(scope: Scope): string {
  if (scope.type === 'group') return scope.groupPath ?? 'group';
  const paths = scope.projectPaths ?? [];
  return paths.length === 1 ? paths[0]! : `${paths.length} projects`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}
