import {
  formatValue as fmt,
  metricRank,
  METRICS,
  metricValue,
} from '../shared/metrics.js';
import type { LeaderboardResponse } from '../shared/types.js';
import { validateLeaderboard } from './metrics/validate.js';
import { LOCKED_MESSAGE } from './viewer-scope.js';

export { LOCKED_MESSAGE };

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

export const SELF_VALIDATE_NOTE =
  '\nVALIDATION: skipped. Validation needs Team view, because Self view has no ranks or leaders to check.';

export interface CliOutcome {
  stdout: string[];
  stderr: string[];
  exitCode: number;
}

function validationLines(res: LeaderboardResponse): CliOutcome {
  const report = validateLeaderboard(res);
  const stdout = [
    `\nVALIDATION: ${report.ok ? 'PASS' : 'FAIL'} · ${report.errors} error(s), ${report.warnings} warning(s)`,
  ];
  for (const issue of report.issues) {
    const icon = issue.severity === 'error' ? '✗' : '⚠';
    stdout.push(`  ${icon} [${issue.code}] ${issue.message}`);
  }
  return { stdout, stderr: [], exitCode: report.ok ? 0 : 1 };
}

/** What the standings run prints and exits with, for a table or validate format. */
export function standingsOutcome(
  res: LeaderboardResponse,
  validate: boolean
): CliOutcome {
  if (isLocked(res))
    return { stdout: [], stderr: [LOCKED_MESSAGE], exitCode: 1 };
  const stdout = standingsLines(res);
  if (!validate) return { stdout, stderr: [], exitCode: 0 };
  if (res.viewer.role === 'self')
    return { stdout: [...stdout, SELF_VALIDATE_NOTE], stderr: [], exitCode: 0 };
  const v = validationLines(res);
  return { ...v, stdout: [...stdout, ...v.stdout] };
}
