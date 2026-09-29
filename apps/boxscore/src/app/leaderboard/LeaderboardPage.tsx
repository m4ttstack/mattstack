import type { LeaderboardResponse, MetricKey } from '../../shared/types';
import { MetricCards } from '../components/MetricCards';
import { windowLabel } from '../model/labels';
import { descriptor } from '../model/standings';
import type { ViewMode } from '../shell/PageHeader';
import { Glyph } from '../ui/Glyph';
import classes from './leaderboard.module.css';
import { LeadersStrip } from './LeadersStrip';
import { StandingsTable } from './StandingsTable';

export function leaderboardSubtitle(
  data: LeaderboardResponse,
  sort: MetricKey
): string {
  const people = data.users.filter(u => u.resolved).length;
  return [
    windowLabel(data.window),
    `${people} ${people === 1 ? 'person' : 'people'}`,
    `sorted by ${descriptor(sort).label}`,
  ].join('  ·  ');
}

export function LeaderboardPage({
  data,
  view,
  trend,
  sort,
  onSort,
  onSelectStat,
}: {
  data: LeaderboardResponse;
  view: ViewMode;
  trend: boolean;
  sort: MetricKey;
  onSort: (k: MetricKey) => void;
  onSelectStat: (username: string, stat: MetricKey) => void;
}) {
  if (view === 'cards') return <MetricCards data={data} trend={trend} />;
  return (
    <>
      <LeadersStrip data={data} />
      <StandingsTable
        data={data}
        sort={sort}
        onSort={onSort}
        onSelectStat={onSelectStat}
      />
      <p className={classes.footnote}>
        <Glyph name="info" size={13} color="var(--tk-text-3)" parity="Info" />
        <span className={classes.footnoteText} data-parity="Footnote Text">
          Revert rate counts detected reverts only, so it undercounts
          fix-forward fixes. Hover any header for its definition.
        </span>
      </p>
    </>
  );
}
