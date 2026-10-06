import {
  formatValue as fmt,
  metricRank,
  METRICS,
  metricValue,
} from '../shared/metrics.js';
import type { LeaderboardResponse } from '../shared/types.js';

/** Printed for a locked response, where the board could not identify the viewer. */
export const LOCKED_MESSAGE =
  "boxscore couldn't tell who you are. Check that your GitLab token is set and that your GitLab username is on the team roster in console.";

export function isLocked(res: LeaderboardResponse): boolean {
  return res.viewer.role === 'self' && res.viewer.username === null;
}

function scopeLabel(res: LeaderboardResponse): string {
  return res.scope.type === 'group'
    ? (res.scope.groupPath ?? 'group')
    : (res.scope.projectPaths ?? []).join(', ');
}

/** The standings printout as lines. Self view drops rank numbers and the leaders section. */
export function standingsLines(res: LeaderboardResponse): string[] {
  const self = res.viewer.role === 'self';
  const w = res.window;
  const out: string[] = [];
  out.push(
    `\nBoxscore ... ${scopeLabel(res)}  ${w.start.slice(0, 10)} → ${w.end.slice(0, 10)}`
  );
  out.push(
    `${res.fromCache ? 'cached' : 'fresh'}${res.hasTrend ? ' · trend on' : ''} · ${res.users.filter(u => u.resolved).length}/${res.users.length} resolved\n`
  );

  out.push(self ? 'YOUR NUMBERS:' : 'STANDINGS BY METRIC (1 = best):');
  for (const d of METRICS) {
    const ranked = res.users
      .filter(u => u.resolved && metricValue(u.metrics, d) !== null)
      .sort(
        (a, b) =>
          (metricRank(a.metrics, d) ?? 99) - (metricRank(b.metrics, d) ?? 99)
      );
    const line = ranked
      .map(u => {
        const label = `${u.name ?? u.username}(${fmt(metricValue(u.metrics, d), d)})`;
        return self ? label : `${metricRank(u.metrics, d)}.${label}`;
      })
      .join('  ');
    out.push(`  ${d.label.padEnd(16)} ${line || '(no data)'}`);
  }

  if (!self) {
    out.push('\nLEADERS:');
    for (const d of METRICS)
      out.push(`  ${d.label.padEnd(16)} ${res.leaders[d.key] ?? '...'}`);
  }

  if (res.warnings.length) {
    out.push('\nWARNINGS:');
    for (const wn of res.warnings)
      out.push(`  ⚠ [${wn.code}] ${wn.message.slice(0, 160)}`);
  }
  return out;
}
