import { GROUP_ORDER } from '../../shared/metrics';
import type {
  LeaderboardResponse,
  MetricKey,
  TimeWindow,
} from '../../shared/types';
import { userDelta } from '../model/delta';
import { statsInGroup } from '../model/groups';
import { shortName } from '../model/labels';
import {
  descriptor,
  isFullTie,
  rankedFor,
  type Ranked,
} from '../model/standings';
import { GroupTag } from '../ui/GroupTag';
import { RankRow } from '../ui/RankRow';
import { cardValue } from './format';
import classes from './leaderboard.module.css';
import { statHref } from './StandingsTable';

const CARD_STATS: MetricKey[] = GROUP_ORDER.flatMap(statsInGroup);

/** Bar length against the best value: higher-is-better scales by the max, lower by the min. */
function fractionOf(key: MetricKey, value: number | null, rows: Ranked[]) {
  if (value === null) return 0;
  const values = rows.flatMap(r => (r.value === null ? [] : [r.value]));
  if (descriptor(key).better === 'desc') {
    const max = Math.max(...values);
    return max > 0 ? value / max : 0;
  }
  const min = Math.min(...values);
  if (value === 0) return 1;
  return min / value;
}

function StatCard({
  data,
  stat,
  trend,
  onSelectStat,
}: {
  data: LeaderboardResponse;
  stat: MetricKey;
  trend: boolean;
  onSelectStat: (username: string, stat: MetricKey) => void;
}) {
  const d = descriptor(stat);
  const rows = rankedFor(data.users, stat);
  const tie = isFullTie(data.users, stat);
  const valued = rows.filter(r => r.value !== null);
  return (
    <section
      className={classes.statCard}
      data-parity={`Card ${d.label}`}
      data-stat-card={stat}
    >
      <div className={classes.cardHead}>
        <span className={classes.cardName} data-parity="Metric Name">
          {d.label}
        </span>
        <GroupTag group={d.group} variant="swatch-label" />
      </div>
      {tie ? (
        <div className={classes.tiedState} data-parity="Tied State">
          <span className={classes.tiedValue} data-parity="Tied Value">
            {cardValue(stat, valued[0]?.value ?? null)}
          </span>
          <span className={classes.tiedNote} data-parity="Tied Note">
            All {valued.length} tied, no separation this window
          </span>
        </div>
      ) : (
        <div className={classes.ranking}>
          {rows.map(r => {
            const name = r.user.name ?? r.user.username;
            const delta = trend ? userDelta(r.user.metrics, stat) : null;
            return (
              <div
                key={r.user.username}
                className={classes.rankHit}
                onClick={() => onSelectStat(r.user.username, stat)}
              >
                <RankRow
                  rank={r.value === null ? null : r.rank}
                  name={shortName(name)}
                  value={cardValue(stat, r.value)}
                  fraction={fractionOf(stat, r.value, rows)}
                  you={r.isYou}
                  leader={r.isLeader}
                  dim={r.value === null || r.value === 0}
                  delta={delta ?? undefined}
                  href={statHref(r.user.username, stat)}
                  parity={r.isYou ? `Rank Row ${name}` : undefined}
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function CardsGrid({
  data,
  prior,
  onSelectStat,
}: {
  data: LeaderboardResponse;
  prior: TimeWindow | null;
  onSelectStat: (username: string, stat: MetricKey) => void;
}) {
  return (
    <div className={classes.cardsGrid}>
      {CARD_STATS.map(stat => (
        <StatCard
          key={stat}
          data={data}
          stat={stat}
          trend={prior !== null}
          onSelectStat={onSelectStat}
        />
      ))}
    </div>
  );
}
