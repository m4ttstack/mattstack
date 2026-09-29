import { lazy, Suspense } from 'react';

import { metricRank, metricValue } from '../../shared/metrics';
import type {
  MetricEvidence,
  MetricKey,
  TimeWindow,
  UserRow,
} from '../../shared/types';
import { descriptor, leaderOf, rankedFor } from '../model/standings';
import { CountChip } from '../ui/CountChip';
import { GroupTag } from '../ui/GroupTag';
import { LeaderMark } from '../ui/LeaderMark';
import { TeamStrip } from '../ui/TeamStrip';
import classes from './detail.module.css';
import { EmptyEvidence } from './evidence/parts';
import {
  definitionOf,
  PANEL_COPY,
  panelValue,
  scaleLabel,
  subOf,
} from './panelCopy';
import { displayName } from './ProfileHeader';

const EvidencePanel = lazy(() => import('./evidence/EvidencePanel'));

export type EvidenceState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; ev: MetricEvidence | undefined };

function Leader({ users, stat }: { users: UserRow[]; stat: MetricKey }) {
  const d = descriptor(stat);
  const leader = leaderOf(users, stat);
  const ranked = rankedFor(users, stat).filter(r => r.rank !== null);
  const tiedValue = ranked[0]?.value ?? null;
  const name = leader
    ? leader.isCurrentUser
      ? 'You'
      : displayName(leader)
    : ranked.length > 1
      ? `Tied, all ${ranked.length}`
      : '—';
  const value = leader ? metricValue(leader.metrics, d) : tiedValue;
  return (
    <div className={classes.block} data-parity="Leader Block">
      <span className={`${classes.t} ${classes.blockLabel}`} data-parity="LL">
        Leader
      </span>
      <div className={classes.leaderValue}>
        {leader && <LeaderMark parity="Gold" />}
        <span className={`${classes.t} ${classes.leaderName}`} data-parity="LN">
          {name}
        </span>
        <span
          className={`${classes.t} ${classes.num} ${classes.leaderStat}`}
          data-parity="LVv"
        >
          {panelValue(stat, value)}
        </span>
      </div>
    </div>
  );
}

export function StatPanel({
  users,
  person,
  stat,
  window,
  evidence,
}: {
  users: UserRow[];
  person: UserRow;
  stat: MetricKey;
  window: TimeWindow;
  evidence: EvidenceState;
}) {
  const d = descriptor(stat);
  const copy = PANEL_COPY[stat];
  const value = metricValue(person.metrics, d);
  const rank = metricRank(person.metrics, d);
  const ranked = rankedFor(users, stat);
  // Dots stack in roster order, as the canvas draws them, so a leader can sit over you.
  const points = [...ranked]
    .sort((a, b) => users.indexOf(a.user) - users.indexOf(b.user))
    .filter(r => r.value !== null)
    .map(r => ({
      username: r.user.username,
      value: r.value!,
      you: r.isYou,
      leader: r.isLeader,
    }));
  const max = Math.max(0, ...points.map(p => p.value));
  const ev = evidence.status === 'ready' ? evidence.ev : undefined;
  const chips = ev?.facts && copy.chips ? copy.chips(ev.facts, person) : [];

  return (
    <section className={classes.panel} data-parity={`Panel · ${d.label}`}>
      <div className={classes.panelTop}>
        <div className={classes.panelHead}>
          <div className={classes.headLeft}>
            <h2
              className={`${classes.t} ${classes.statTitle}`}
              data-parity="Stat Title"
            >
              {d.label}
            </h2>
            <GroupTag group={d.group} variant="pill" parity="Group Tag" />
          </div>
          <span className={`${classes.t} ${classes.src}`} data-parity="Src">
            {copy.source}
          </span>
        </div>
        <div className={classes.hero}>
          <div className={classes.big}>
            <span
              className={`${classes.t} ${classes.num} ${classes.bigValue}`}
              data-parity="Big Value"
            >
              {panelValue(stat, value)}
            </span>
            <span
              className={`${classes.t} ${classes.bigSub}`}
              data-parity="Big Sub"
            >
              {subOf(stat, window)}
            </span>
          </div>
          <div className={classes.block} data-parity="Rank Block">
            <span
              className={`${classes.t} ${classes.blockLabel}`}
              data-parity="RL"
            >
              Rank
            </span>
            <div className={classes.rankValue}>
              <span
                className={`${classes.t} ${classes.num} ${classes.rankR}`}
                data-parity="R"
              >
                {rank === null ? '—' : `#${rank}`}
              </span>
              <span className={classes.rankOfPad}>
                <span
                  className={`${classes.t} ${classes.blockLabel}`}
                  data-parity="of"
                >
                  {`of ${points.length}`}
                </span>
              </span>
            </div>
          </div>
          <Leader users={users} stat={stat} />
          <div
            className={`${classes.block} ${classes.field}`}
            data-parity="Field"
          >
            <span
              className={`${classes.t} ${classes.blockLabel}`}
              data-parity="FL"
            >
              Where the team sits
            </span>
            <TeamStrip
              points={points}
              max={max}
              maxLabel={scaleLabel(stat, max)}
            />
          </div>
        </div>
        <p className={classes.definition} data-parity="Definition">
          {definitionOf(stat, ev?.facts)}
        </p>
        {chips.length > 0 && (
          <div className={classes.counts}>
            {chips.map(c => (
              <CountChip
                key={c.name}
                parity={c.name}
                count={c.count}
                label={c.label}
                tone={c.tone}
              />
            ))}
          </div>
        )}
      </div>
      {evidence.status === 'loading' && <EmptyEvidence message="Loading…" />}
      {evidence.status === 'error' && (
        <EmptyEvidence message={evidence.message} />
      )}
      {evidence.status === 'ready' &&
        (ev ? (
          <Suspense fallback={<EmptyEvidence message="Loading…" />}>
            <EvidencePanel
              key={`${person.username}/${stat}`}
              ev={ev}
              users={users}
              username={person.username}
              statKey={stat}
              window={window}
            />
          </Suspense>
        ) : (
          <EmptyEvidence />
        ))}
    </section>
  );
}
