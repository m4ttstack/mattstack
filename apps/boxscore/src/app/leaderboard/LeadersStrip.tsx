import {
  GROUP_ORDER,
  GROUPS,
  metricRank,
  metricValue,
  type MetricGroup,
} from '../../shared/metrics';
import type { LeaderboardResponse } from '../../shared/types';
import { userDelta } from '../model/delta';
import { HEADLINE, hueVar } from '../model/groups';
import { initials } from '../model/labels';
import { descriptor, leaderOf, you } from '../model/standings';
import { DeltaMark } from '../ui/DeltaMark';
import { GroupTag } from '../ui/GroupTag';
import { cellText, tileValue } from './format';
import classes from './leaderboard.module.css';

function avatarFill(group: MetricGroup): string {
  const hue = GROUPS[group].hue;
  return hue === 'neutral'
    ? 'var(--tk-raised)'
    : `var(--mantine-color-${hue}-light)`;
}

function LeaderTile({
  group,
  data,
  trend,
  last,
}: {
  group: MetricGroup;
  data: LeaderboardResponse;
  trend: boolean;
  last: boolean;
}) {
  const key = HEADLINE[group];
  const d = descriptor(key);
  const leader = leaderOf(data.users, key);
  const me = you(data.users);
  const headline = tileValue(
    key,
    leader ? metricValue(leader.metrics, d) : null
  );
  const leaderName = leader ? (leader.name ?? leader.username) : null;
  const myRank = me ? metricRank(me.metrics, d) : null;
  const tag = initials(leaderName ?? '');
  const myDelta = trend && me ? userDelta(me.metrics, key) : null;

  return (
    <div
      className={`${classes.tile} ${last ? classes.tileLast : ''}`}
      data-parity={last ? undefined : `Leader ${GROUPS[group].label}`}
      data-leader-group={group}
    >
      <div className={classes.tileHead}>
        <GroupTag group={group} variant="tile" />
        <span className={classes.tileMetric} data-parity="Metric">
          {d.label}
        </span>
      </div>
      <div className={classes.valueRow}>
        <span className={classes.tileValue} data-parity="Value">
          {headline.value}
        </span>
        {headline.unit !== null && (
          <span className={classes.unitPad}>
            <span className={classes.tileUnit} data-parity="Unit">
              {headline.unit}
            </span>
          </span>
        )}
      </div>
      <div className={classes.leaderRow}>
        {leaderName !== null ? (
          <>
            <span
              className={classes.tileAvatar}
              data-parity={`Avatar ${tag}`}
              style={{ background: avatarFill(group) }}
            >
              <span
                className={classes.tileInitials}
                data-parity="Initials"
                style={{ color: hueVar(group, 'text') }}
              >
                {tag}
              </span>
            </span>
            <span className={classes.leaderName} data-parity="Leader Name">
              {leaderName}
            </span>
          </>
        ) : (
          <span className={classes.leaderName} data-parity="Leader Name">
            Everyone tied
          </span>
        )}
      </div>
      <div className={classes.youRow} data-parity="You Row">
        <span className={classes.youLabel} data-parity="You Label">
          You
        </span>
        <span className={classes.youVal}>
          <span className={classes.youValue} data-parity="You Value">
            {me ? cellText(key, metricValue(me.metrics, d)) : '—'}
          </span>
          <span className={classes.youRank} data-parity="You Rank">
            {myRank !== null ? `#${myRank}` : '—'}
          </span>
          {myDelta && (
            <DeltaMark text={myDelta.text} tone={myDelta.tone} parity="Delta" />
          )}
        </span>
      </div>
    </div>
  );
}

export function LeadersStrip({
  data,
  trend,
}: {
  data: LeaderboardResponse;
  trend: boolean;
}) {
  return (
    <section
      className={classes.strip}
      data-parity="Stat Leaders"
      aria-label="Stat leaders"
    >
      {GROUP_ORDER.map((g, i) => (
        <LeaderTile
          key={g}
          group={g}
          data={data}
          trend={trend}
          last={i === GROUP_ORDER.length - 1}
        />
      ))}
    </section>
  );
}
