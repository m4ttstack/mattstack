import { useState } from 'react';

import { Tooltip } from '@mattstack/app-kit/core';
import { Link } from '@mattstack/app-kit/router';
import {
  GROUP_ORDER,
  GROUPS,
  metricValue,
  type MetricGroup,
} from '../../shared/metrics';
import type {
  LeaderboardResponse,
  MetricKey,
  TimeWindow,
  UserRow,
} from '../../shared/types';
import { userDelta } from '../model/delta';
import { hueVar, OVERVIEW, statsInGroup } from '../model/groups';
import { initials, priorWindowLabel } from '../model/labels';
import {
  descriptor,
  isQuietValue,
  rankedFor,
  type Ranked,
} from '../model/standings';
import { DeltaMark } from '../ui/DeltaMark';
import { Glyph } from '../ui/Glyph';
import { LeaderMark } from '../ui/LeaderMark';
import rowHover from '../ui/row-hover.module.css';
import { cellText, signed } from './format';
import classes from './leaderboard.module.css';

type Column = MetricKey | 'lines';
type Tab = 'overview' | MetricGroup;

const BAR_WIDTH = 72;
const BAR_MIN = 2;
const BARRED = new Set<Column>([
  'issuesCompleted',
  'mrsMerged',
  'mrsReviewed',
  'lines',
  'codingDays',
]);

export function statHref(username: string, stat: MetricKey): string {
  return `/user/${encodeURIComponent(username)}/${stat}`;
}

/** The stat a column ranks and opens: Lines ± stands for lines added. */
const statOf = (c: Column): MetricKey => (c === 'lines' ? 'additions' : c);

const groupOf = (c: Column): MetricGroup =>
  c === 'lines' ? 'volume' : descriptor(c).group;

const labelOf = (c: Column): string =>
  c === 'lines' ? 'Lines ±' : descriptor(c).label;

const definitionOf = (c: Column): string =>
  c === 'lines'
    ? 'Lines added and deleted across merged MRs the user authored.'
    : descriptor(c).description;

function columnsFor(tab: Tab): Column[] {
  return tab === 'overview' ? OVERVIEW : statsInGroup(tab);
}

function Tabs({
  tab,
  onTab,
  prior,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  prior: TimeWindow | null;
}) {
  const tabs: Tab[] = ['overview', ...GROUP_ORDER];
  return (
    <div className={classes.tabsRow} data-parity="Tabs Row">
      <div className={classes.tabs} role="tablist">
        {tabs.map(t => {
          const active = t === tab;
          const label = t === 'overview' ? 'Overview' : GROUPS[t].label;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={active}
              className={`${classes.tab} ${active ? classes.tabActive : ''}`}
              data-parity={active ? `Tab ${label}` : undefined}
              onClick={() => onTab(t)}
            >
              {t !== 'overview' && (
                <span
                  className={classes.tabSwatch}
                  data-parity="Swatch"
                  style={{ background: hueVar(t, 'swatch') }}
                />
              )}
              <span
                className={classes.tabLabel}
                data-parity="Tab Label"
                style={{
                  color: active ? 'var(--tk-text-1)' : 'var(--tk-text-3)',
                }}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>
      <div className={classes.legend}>
        <span className={classes.legendItem}>
          <LeaderMark parity="Pill" />
          <span className={classes.legendLabel} data-parity="Legend Label">
            Leads this stat
          </span>
        </span>
        {prior && (
          <span className={classes.legendItem}>
            <span
              className={classes.legendArrows}
              data-parity="g"
              style={{ color: 'var(--tk-text-ok)' }}
            >
              ▲▼
            </span>
            <span className={classes.legendLabel} data-parity="gl">
              better
            </span>
            <span
              className={classes.legendArrows}
              data-parity="b"
              style={{ color: 'var(--tk-text-bad)' }}
            >
              ▲▼
            </span>
            <span className={classes.legendLabel} data-parity="bl">
              worse than {priorWindowLabel(prior)}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

function HeaderRow({
  columns,
  sort,
  onSort,
}: {
  columns: Column[];
  sort: MetricKey;
  onSort: (k: MetricKey) => void;
}) {
  return (
    <div className={classes.headerRow} data-parity="Header Row" role="row">
      <div className={classes.hNum} role="columnheader">
        <span className={classes.hLabel} data-parity="H Label">
          #
        </span>
      </div>
      <div className={classes.hPerson} role="columnheader">
        <span className={classes.hLabel} data-parity="H Label">
          Person
        </span>
      </div>
      {columns.map(c => {
        const sorted = statOf(c) === sort;
        return (
          <Tooltip
            key={c}
            label={definitionOf(c)}
            multiline
            w={280}
            openDelay={300}
          >
            <div
              className={c === 'lines' ? classes.hLines : classes.hStat}
              role="columnheader"
              aria-sort={sorted ? 'descending' : undefined}
            >
              <button
                type="button"
                className={classes.hButton}
                onClick={() => onSort(statOf(c))}
              >
                <span
                  className={classes.hSwatch}
                  data-parity="Swatch"
                  style={{ background: hueVar(groupOf(c), 'swatch') }}
                />
                <span
                  className={classes.hLabel}
                  data-parity="H Label"
                  style={sorted ? { color: 'var(--tk-text-1)' } : undefined}
                >
                  {labelOf(c)}
                </span>
                {sorted && (
                  <Glyph
                    name="arrowDown"
                    size={12}
                    color="var(--tk-text-1)"
                    parity="Sort"
                  />
                )}
              </button>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}

function Bar({
  value,
  max,
  isYou,
}: {
  value: number;
  max: number;
  isYou: boolean;
}) {
  const width =
    max > 0
      ? Math.max(BAR_MIN, Math.round((value / max) * BAR_WIDTH))
      : BAR_MIN;
  return (
    <span className={classes.barTrack} data-parity="Bar Track">
      <span
        className={classes.bar}
        data-parity="Bar"
        style={{
          width,
          background: isYou ? 'var(--tk-fill-accent)' : 'var(--tk-muted)',
        }}
      />
    </span>
  );
}

interface ColumnFacts {
  leaders: Set<string>;
  max: number;
}

function factsFor(users: UserRow[], c: Column): ColumnFacts {
  const ranked = rankedFor(users, statOf(c));
  return {
    leaders: new Set(ranked.filter(r => r.isLeader).map(r => r.user.username)),
    max: Math.max(0, ...ranked.map(r => r.value ?? 0)),
  };
}

function StatCell({
  column,
  user,
  facts,
  trend,
  onOpen,
}: {
  column: Column;
  user: UserRow;
  facts: ColumnFacts;
  trend: boolean;
  onOpen: (stat: MetricKey) => void;
}) {
  const stat = statOf(column);
  const value = metricValue(user.metrics, descriptor(stat));
  const leader = facts.leaders.has(user.username);
  const delta =
    trend && column !== 'lines' ? userDelta(user.metrics, stat) : null;
  return (
    <div
      className={column === 'lines' ? classes.cellLines : classes.cellStat}
      role="cell"
      data-stat={stat}
      onClick={e => {
        e.stopPropagation();
        onOpen(stat);
      }}
    >
      <span className={classes.valueLine}>
        {leader && <LeaderMark parity="Rank Pill" />}
        {column === 'lines' ? (
          <>
            <span className={classes.added} data-parity="Added">
              {signed(user.metrics.additions.value, '+')}
            </span>
            <span className={classes.deleted} data-parity="Deleted">
              {signed(user.metrics.deletions.value, '−')}
            </span>
          </>
        ) : (
          <span
            className={classes.value}
            data-parity="Value"
            style={
              isQuietValue(stat, value)
                ? { color: 'var(--tk-text-3)' }
                : undefined
            }
          >
            {cellText(stat, value)}
          </span>
        )}
        {delta && (
          <DeltaMark text={delta.text} tone={delta.tone} parity="Delta" />
        )}
      </span>
      {BARRED.has(column) && (
        <Bar value={value ?? 0} max={facts.max} isYou={user.isCurrentUser} />
      )}
    </div>
  );
}

function PersonRow({
  ranked,
  position,
  last,
  columns,
  facts,
  trend,
  sort,
  onSelectStat,
}: {
  ranked: Ranked;
  position: number;
  last: boolean;
  columns: Column[];
  facts: Map<Column, ColumnFacts>;
  trend: boolean;
  sort: MetricKey;
  onSelectStat: (username: string, stat: MetricKey) => void;
}) {
  const { user, isYou } = ranked;
  const name = user.name ?? user.username;
  const open = (stat: MetricKey) => onSelectStat(user.username, stat);
  return (
    <div
      className={`${classes.row} ${last ? classes.rowLast : ''} ${rowHover.row}`}
      data-you={isYou ? '' : undefined}
      data-parity={last ? undefined : `Row ${name}`}
      role="row"
      onClick={() => open(sort)}
    >
      <div className={classes.cellNum} role="cell">
        <span className={classes.pos} data-parity="Pos">
          {position}
        </span>
      </div>
      <div className={classes.cellPerson} role="cell">
        <span
          className={classes.avatar}
          data-parity="Avatar"
          style={{
            background: isYou ? 'var(--tk-fill-accent)' : 'var(--tk-raised)',
          }}
        >
          <span
            className={classes.initials}
            data-parity="Initials"
            style={{
              color: isYou ? 'var(--tk-on-fill-accent)' : 'var(--tk-text-2)',
            }}
          >
            {initials(name)}
          </span>
        </span>
        <span className={classes.nameBlock}>
          <span className={classes.nameLine}>
            <Link
              href={statHref(user.username, sort)}
              className={classes.nameLink}
              onClick={e => e.stopPropagation()}
            >
              <span
                className={classes.name}
                data-parity="Name"
                style={{
                  color: isYou ? 'var(--tk-text-accent)' : 'var(--tk-text-1)',
                }}
              >
                {name}
              </span>
            </Link>
            {isYou && (
              <span className={classes.youBadge} data-parity="You Badge">
                <span className={classes.youBadgeText} data-parity="You">
                  you
                </span>
              </span>
            )}
          </span>
          <span className={classes.handle} data-parity="Handle">
            @{user.username}
          </span>
        </span>
      </div>
      {columns.map(c => (
        <StatCell
          key={c}
          column={c}
          user={user}
          facts={facts.get(c)!}
          trend={trend}
          onOpen={open}
        />
      ))}
    </div>
  );
}

export function StandingsTable({
  data,
  prior,
  dimmed = false,
  sort,
  onSort,
  onSelectStat,
}: {
  data: LeaderboardResponse;
  /** The window deltas compare against; null shows values only. */
  prior: TimeWindow | null;
  dimmed?: boolean;
  sort: MetricKey;
  onSort: (k: MetricKey) => void;
  onSelectStat: (username: string, stat: MetricKey) => void;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const columns = columnsFor(tab);
  const rows = rankedFor(data.users, sort);
  const facts = new Map(columns.map(c => [c, factsFor(data.users, c)]));

  return (
    <section
      className={
        dimmed ? `${classes.standings} ${classes.dimmed}` : classes.standings
      }
      data-parity="Standings"
      aria-label="Standings"
    >
      <Tabs tab={tab} onTab={setTab} prior={prior} />
      {rows.length === 0 ? (
        <p className={classes.empty}>
          No users configured, or none resolved on the instance.
        </p>
      ) : (
        <div className={classes.scroller}>
          <div className={classes.table} role="table">
            <HeaderRow columns={columns} sort={sort} onSort={onSort} />
            {rows.map((r, i) => (
              <PersonRow
                key={r.user.username}
                ranked={r}
                position={i + 1}
                last={i === rows.length - 1}
                columns={columns}
                facts={facts}
                trend={prior !== null}
                sort={sort}
                onSelectStat={onSelectStat}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
