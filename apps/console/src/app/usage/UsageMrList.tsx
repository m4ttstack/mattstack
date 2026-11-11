import { Paper, Text, VirtualList } from '@mattstack/app-kit/core';
import { useElementSize } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';
import { Link } from '@mattstack/app-kit/router';
import type {
  UsageBilling,
  UsageMrRow,
  UsageTotals,
} from '@mattstack/rt-client';

import {
  compact,
  KIND_ORDER,
  mrParts,
  mrSummary,
  shortDate,
  usageMrHref,
  usd,
  type MrSort,
  type MrSortOrder,
} from './format';
import { KindBar, KindLegend } from './KindBar';
import classes from './UsageMrList.module.css';
import type { EnrichmentOf } from './useUsage';

/** The list only windows rows of a known height: `.row` holds it. */
const ROW_HEIGHT = 64;
const HEAD_HEIGHT = 40;
const MIN_ROWS_SHOWN = 3;

const SORT_COLUMNS: Array<{ sort: MrSort; label: string }> = [
  { sort: 'date', label: 'Last active' },
  { sort: 'output', label: 'Output' },
  { sort: 'cacheRead', label: 'Cache read' },
  { sort: 'cost', label: 'Est. cost' },
];

function SortHeader({
  sort,
  label,
  order,
  onSort,
}: {
  sort: MrSort;
  label: string;
  order: MrSortOrder;
  onSort: (sort: MrSort) => void;
}) {
  const active = order.sort === sort;
  const ascending = order.dir === 'asc';
  return (
    <div
      role="columnheader"
      aria-sort={active ? (ascending ? 'ascending' : 'descending') : undefined}
    >
      <button
        type="button"
        className={classes.sort}
        data-active={active || undefined}
        onClick={() => onSort(sort)}
      >
        {active ? (
          <Icon name={ascending ? 'arrowUp' : 'arrowDown'} size={12} />
        ) : null}
        {label}
      </button>
    </div>
  );
}

export function CostCell({
  byBilling,
}: {
  byBilling: Record<UsageBilling, UsageTotals>;
}) {
  return (
    <div role="cell" className={classes.cost}>
      <Text fz="sm" fw={500} lh="normal" data-testid="cost-metered">
        {usd(byBilling.metered.cost)}
      </Text>
      {byBilling.plan.cost > 0 ? (
        <Text fz="sm" c="dimmed" lh="normal" data-testid="cost-plan">
          {`${usd(byBilling.plan.cost)} on plan`}
        </Text>
      ) : null}
    </div>
  );
}

function MrRow({
  row,
  index,
  enrichment,
  showRepo,
}: {
  row: UsageMrRow;
  index: number;
  enrichment: EnrichmentOf;
  showRepo: boolean;
}) {
  const { number, repo } = mrParts(row.mrKey);
  const title = enrichment(row.branch)?.ticket?.title;
  return (
    <div role="row" aria-rowindex={index + 2} className={classes.row}>
      <div role="cell" className={classes.name}>
        <Link href={usageMrHref(row.mrKey)} className={classes.link}>
          <span className={classes.title}>
            {row.ticket ? (
              <Text
                span
                fz="md"
                fw={500}
                lh="normal"
                className={classes.ticket}
              >
                {row.ticket}
              </Text>
            ) : null}
            <Text span fz="md" fw={row.ticket ? 400 : 500} lh="normal" truncate>
              {title ?? row.branch ?? number}
            </Text>
          </span>
        </Link>
        <Text fz="sm" c="dimmed" lh="normal" truncate mt={3}>
          {`${showRepo ? `${repo} ` : ''}${number} ${mrSummary(row)}`.trim()}
        </Text>
      </div>
      <div role="cell" className={classes.bar}>
        <Link
          href={usageMrHref(row.mrKey)}
          className={classes.barLink}
          tabIndex={-1}
        >
          <KindBar cost={row.costByKind} />
        </Link>
      </div>
      <Text role="cell" fz="sm" c="dimmed" ta="right">
        {shortDate(row.lastActivity)}
      </Text>
      <Text role="cell" fz="sm" c="dimmed" ta="right">
        {compact(row.totals.output)}
      </Text>
      <Text role="cell" fz="sm" c="dimmed" ta="right">
        {compact(row.totals.cacheRead)}
      </Text>
      <CostCell byBilling={row.byBilling} />
      <div role="cell" className={classes.chevron}>
        <Icon name="chevronRight" size={16} />
      </div>
    </div>
  );
}

/** Rows scroll inside the card so the stats and the sort headers stay put.
    The box asks for every row and flex shrinks it to the room left, so a
    short list keeps a short card and a long one measures the page. The floor
    sits on the card, so a window too short for it scrolls the page instead. */
export function UsageMrList({
  rows,
  enrichment,
  order,
  onSort,
  resetKey,
  showRepo,
}: {
  rows: UsageMrRow[];
  enrichment: EnrichmentOf;
  order: MrSortOrder;
  onSort: (sort: MrSort) => void;
  resetKey: string;
  showRepo: boolean;
}) {
  const kinds = KIND_ORDER.filter(k => rows.some(r => r.costByKind[k] > 0));
  const { ref, height } = useElementSize<HTMLDivElement>();
  return (
    <Paper
      variant="ground"
      withBorder
      radius={12}
      className={classes.table}
      style={{
        minHeight:
          HEAD_HEIGHT + Math.min(rows.length, MIN_ROWS_SHOWN) * ROW_HEIGHT,
      }}
      role="table"
      aria-label="MRs"
      aria-rowcount={rows.length + 1}
    >
      <div className={classes.frame}>
        <div role="row" aria-rowindex={1} className={classes.head}>
          <div role="columnheader">MR</div>
          <div role="columnheader" aria-label="Cost by kind">
            <KindLegend kinds={kinds} />
          </div>
          {SORT_COLUMNS.map(column => (
            <SortHeader
              key={column.sort}
              {...column}
              order={order}
              onSort={onSort}
            />
          ))}
          <div role="columnheader" aria-label="Open" />
        </div>
        <div
          ref={ref}
          className={classes.rows}
          style={{ height: rows.length * ROW_HEIGHT }}
        >
          <VirtualList
            key={resetKey}
            items={rows}
            getItemKey={row => row.mrKey}
            estimateSize={() => ROW_HEIGHT}
            overscan={8}
            maxHeight={height}
            renderRow={(row, index) => (
              <MrRow
                row={row}
                index={index}
                enrichment={enrichment}
                showRepo={showRepo}
              />
            )}
          />
        </div>
      </div>
    </Paper>
  );
}
