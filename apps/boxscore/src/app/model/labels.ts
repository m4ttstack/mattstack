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
