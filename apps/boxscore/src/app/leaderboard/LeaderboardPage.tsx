import type {
  LeaderboardResponse,
  MetricKey,
  TimeWindow,
} from '../../shared/types';
import { priorWindowLabel, windowLabel } from '../model/labels';
import { descriptor } from '../model/standings';
import type { ViewMode } from '../shell/PageHeader';
import { Glyph } from '../ui/Glyph';
import { CardsGrid } from './CardsGrid';
import classes from './leaderboard.module.css';
import { LeadersStrip } from './LeadersStrip';
import { StandingsTable } from './StandingsTable';

/** The prior window to compare against, or null when trend is off or there is no prior. */
export function trendWindow(
  data: LeaderboardResponse,
  trend: boolean
): TimeWindow | null {
  return trend && data.hasTrend ? data.priorWindow : null;
}

export function leaderboardSubtitle(
  data: LeaderboardResponse,
  sort: MetricKey,
  trend: boolean,
  view: ViewMode = 'table'
): string {
  const people = data.users.filter(u => u.resolved).length;
  const prior = trendWindow(data, trend);
  const range = prior
    ? `${windowLabel(data.window)} vs ${priorWindowLabel(prior)}`
    : windowLabel(data.window);
  return [
    range,
    `${people} ${people === 1 ? 'person' : 'people'}`,
    view === 'cards'
      ? 'every stat, ranked'
      : `sorted by ${descriptor(sort).label}`,
  ].join('  ·  ');
}

export function LeaderboardPage({
  data,
  view,
  trend,
  dimmed = false,
  sort,
  onSort,
  onSelectStat,
}: {
  data: LeaderboardResponse;
  view: ViewMode;
  trend: boolean;
  /** A refresh is running, so these are the last good numbers. */
  dimmed?: boolean;
  sort: MetricKey;
  onSort: (k: MetricKey) => void;
  onSelectStat: (username: string, stat: MetricKey) => void;
}) {
  const prior = trendWindow(data, trend);
  if (view === 'cards') {
    return (
      <CardsGrid
        data={data}
        prior={prior}
        dimmed={dimmed}
        onSelectStat={onSelectStat}
      />
    );
  }
  return (
    <>
      <LeadersStrip data={data} trend={prior !== null} dimmed={dimmed} />
      <StandingsTable
        data={data}
        prior={prior}
        dimmed={dimmed}
        sort={sort}
        onSort={onSort}
        onSelectStat={onSelectStat}
      />
      <p className={classes.footnote} data-parity="Footnote">
        <Glyph name="info" size={13} color="var(--tk-text-3)" parity="Info" />
        <span className={classes.footnoteText} data-parity="Footnote Text">
          Revert rate counts detected reverts only, so it undercounts
          fix-forward fixes. Hover any header for its definition.
        </span>
      </p>
    </>
  );
}
