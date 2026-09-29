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
  UserRow,
} from '../../shared/types';
import { hueVar, OVERVIEW, statsInGroup } from '../model/groups';
import { initials } from '../model/labels';
import { descriptor, rankedFor, type Ranked } from '../model/standings';
import { Glyph } from '../ui/Glyph';
import { LeaderMark } from '../ui/LeaderMark';
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

function Tabs({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
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
        <LeaderMark parity="Pill" />
        <span className={classes.legendLabel} data-parity="Legend Label">
          Leads this stat
        </span>
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
  onOpen,
}: {
  column: Column;
  user: UserRow;
  facts: ColumnFacts;
  onOpen: (stat: MetricKey) => void;
}) {
  const stat = statOf(column);
  const value = metricValue(user.metrics, descriptor(stat));
  const leader = facts.leaders.has(user.username);
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
            style={value === 0 ? { color: 'var(--tk-text-3)' } : undefined}
          >
            {cellText(stat, value)}
          </span>
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
  sort,
  onSelectStat,
}: {
  ranked: Ranked;
  position: number;
  last: boolean;
  columns: Column[];
  facts: Map<Column, ColumnFacts>;
  sort: MetricKey;
  onSelectStat: (username: string, stat: MetricKey) => void;
}) {
  const { user, isYou } = ranked;
  const name = user.name ?? user.username;
  const open = (stat: MetricKey) => onSelectStat(user.username, stat);
  return (
    <div
      className={`${classes.row} ${last ? classes.rowLast : ''}`}
      data-parity={last ? undefined : `Row ${name}`}
      role="row"
      style={
        isYou ? { background: 'var(--mantine-color-accent-light)' } : undefined
      }
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
          onOpen={open}
        />
      ))}
    </div>
  );
}

export function StandingsTable({
  data,
  sort,
  onSort,
  onSelectStat,
}: {
  data: LeaderboardResponse;
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
      className={classes.standings}
      data-parity="Standings"
      aria-label="Standings"
    >
      <Tabs tab={tab} onTab={setTab} />
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
