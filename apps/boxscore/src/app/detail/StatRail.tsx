import { Fragment } from 'react';

import { Link } from '@mattstack/app-kit/router';
import {
  GROUP_ORDER,
  GROUPS,
  metricRank,
  metricValue,
} from '../../shared/metrics';
import type { MetricKey, UserRow } from '../../shared/types';
import { cardValue } from '../leaderboard/format';
import { statHref } from '../leaderboard/StandingsTable';
import { hueVar, statsInGroup } from '../model/groups';
import { descriptor } from '../model/standings';
import classes from './detail.module.css';

function RankPill({ rank }: { rank: number | null }) {
  const gold = rank === 1;
  return (
    <span
      className={`${classes.rankPill} ${gold ? classes.rankPillGold : classes.rankPillPlain}`}
      data-parity="Rank"
    >
      <span className={`${classes.t} ${classes.num}`} data-parity="n">
        {rank === null ? '–' : `#${rank}`}
      </span>
    </span>
  );
}

export function StatRail({
  person,
  selected,
}: {
  person: UserRow;
  selected: MetricKey;
}) {
  return (
    <nav
      className={classes.statRail}
      data-parity="Stat Rail"
      aria-label="Stats"
    >
      {GROUP_ORDER.map(group => {
        const neutral = GROUPS[group].hue === 'neutral';
        return (
          <Fragment key={group}>
            <div className={classes.groupHead}>
              <span
                className={classes.swatch}
                data-parity="Swatch"
                style={{ background: hueVar(group, 'swatch') }}
              />
              <span
                className={`${classes.t} ${classes.groupLabel}`}
                data-parity="G Label"
                style={{
                  color: neutral ? 'var(--tk-text-3)' : hueVar(group, 'text'),
                }}
              >
                {GROUPS[group].label.toUpperCase()}
              </span>
            </div>
            {statsInGroup(group).map(key => {
              const d = descriptor(key);
              const on = key === selected;
              return (
                <Link
                  key={key}
                  href={statHref(person.username, key)}
                  aria-current={on ? 'page' : undefined}
                  className={`${classes.statRow} ${on ? classes.statRowSelected : ''}`}
                  data-parity={on ? `Stat ${d.label}` : undefined}
                >
                  <span
                    className={`${classes.t} ${classes.statName}`}
                    data-parity="M"
                    style={{
                      color: on ? 'var(--tk-text-accent)' : 'var(--tk-text-2)',
                      fontWeight: on ? 500 : 400,
                    }}
                  >
                    {d.label}
                  </span>
                  <span
                    className={`${classes.t} ${classes.num} ${classes.statValue}`}
                    data-parity="V"
                  >
                    {cardValue(key, metricValue(person.metrics, d))}
                  </span>
                  <RankPill rank={metricRank(person.metrics, d)} />
                </Link>
              );
            })}
          </Fragment>
        );
      })}
    </nav>
  );
}
