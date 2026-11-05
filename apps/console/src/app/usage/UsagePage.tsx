import { useMemo } from 'react';
import {
  Group,
  PageShell,
  Paper,
  SegmentedControl,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import type {
  UsageModelRow,
  UsagePipelineRow,
  UsageTotals,
} from '@mattstack/rt-client';
import { useSearch } from 'wouter';
import { navigate } from 'wouter/use-browser-location';

import { PAGE_ROW_HEIGHT } from '../chrome';
import { RetryAlert } from '../runs/RetryAlert';
import {
  clockTime,
  compact,
  KIND_ORDER,
  modelName,
  nextMrOrder,
  sortMrs,
  usd,
  type MrSort,
  type MrSortOrder,
} from './format';
import { KindLegend, ShareBar } from './KindBar';
import { UsageMrList } from './UsageMrList';
import classes from './UsagePage.module.css';
import { UsageRepoSelect } from './UsageRepoSelect';
import { UsageStats, type UsageStat } from './UsageStats';
import {
  useUsageEnrichment,
  useUsageMrs,
  useUsageStatus,
  useUsageTrends,
  type UsageRange,
} from './useUsage';
import { averageWeek, WeeklyChart } from './WeeklyChart';

const RANGES = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'all', label: 'All' },
];

const MR_SORTS: MrSort[] = ['cost', 'date', 'output', 'cacheRead'];

const CONTENT_FRAME = { maw: 1680, my: 0, px: 40, py: 28 };

const VIEWS = [
  { value: 'mrs', label: 'MRs' },
  { value: 'trends', label: 'Trends' },
];

export function parseUsageSearch(search: string): {
  rangeValue: string;
  range: UsageRange;
  view: 'mrs' | 'trends';
  repo: string | null;
  order: MrSortOrder;
} {
  const params = new URLSearchParams(search);
  const asked = params.get('range');
  const rangeValue = RANGES.some(r => r.value === asked) ? asked! : '30';
  return {
    rangeValue,
    range: rangeValue === 'all' ? null : Number(rangeValue),
    view: params.get('view') === 'trends' ? 'trends' : 'mrs',
    repo: params.get('repo'),
    order: {
      sort: MR_SORTS.find(s => s === params.get('sort')) ?? 'cost',
      dir: params.get('dir') === 'asc' ? 'asc' : 'desc',
    },
  };
}

/** wouter's `useSearch` is `decodeURI`'d, which strips a layer off a repo
    identity's `%2F`, so this only subscribes and the raw string is parsed. */
function useUsageUrl() {
  useSearch();
  const { search, pathname } = window.location;
  const { rangeValue, range, view, repo, order } = parseUsageSearch(search);
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const qs = next.toString();
    navigate(qs ? `${pathname}?${qs}` : pathname, { replace: true });
  };
  const set = (key: string, value: string | null) => update({ [key]: value });
  const sortBy = (sort: MrSort) => {
    const next = nextMrOrder(order, sort);
    update({
      sort: next.sort === 'cost' ? null : next.sort,
      dir: next.dir === 'desc' ? null : next.dir,
    });
  };
  return { rangeValue, range, view, repo, order, set, sortBy };
}

function BreakdownCard({
  title,
  rows,
  total,
}: {
  title: string;
  rows: Array<{ key: string; label: string; totals: UsageTotals }>;
  total: number;
}) {
  return (
    <Paper variant="ground" withBorder radius={12} className={classes.card}>
      <Text fz="md" fw={700} lh="normal" mb={10}>
        {title}
      </Text>
      <Stack gap={10}>
        {rows.map(row => (
          <div key={row.key} className={classes.breakdown}>
            <Text fz="md" lh="normal" truncate>
              {row.label}
            </Text>
            <ShareBar share={total > 0 ? row.totals.cost / total : 0} />
            <Text fz="md" c="dimmed" lh="normal" ta="right">
              {usd(row.totals.cost)}
            </Text>
          </div>
        ))}
      </Stack>
    </Paper>
  );
}

const pipelineRows = (rows: UsagePipelineRow[]) =>
  [...rows]
    .sort((a, b) => b.totals.cost - a.totals.cost)
    .map(r => ({
      key: r.pipeline ?? '',
      label: r.pipeline ?? 'no run',
      totals: r.totals,
    }));

const modelRows = (rows: UsageModelRow[]) =>
  [...rows]
    .sort((a, b) => b.totals.cost - a.totals.cost)
    .map(r => ({
      key: r.model ?? '',
      label: modelName(r.model),
      totals: r.totals,
    }));

/** The doubled window holds the current one, so what is left is the window
    before it. A placeholder from another range says nothing about this one. */
function changeStat(
  cost: number,
  range: UsageRange,
  earlier: ReturnType<typeof useUsageTrends>
): UsageStat {
  const label = range ? `vs last ${range} days` : 'vs earlier';
  const whole = earlier.isPlaceholderData ? undefined : earlier.data;
  const before = range && whole ? whole.totals.cost - cost : 0;
  if (before <= 0) return { key: 'change', value: '—', label };
  const change = Math.round(((cost - before) / before) * 100);
  return {
    key: 'change',
    value: `${change > 0 ? '+' : ''}${change}%`,
    label,
  };
}

function emptyHint(
  sweptAt: number | null,
  range: UsageRange,
  repo: string | null
): string {
  if (!sweptAt) return 'rt reads token usage from your runs every 5 minutes.';
  if (repo) return 'Try all repos.';
  return range ? 'Try a longer range.' : 'Nothing has run through a pipeline.';
}

export function UsagePage() {
  const url = useUsageUrl();
  const mrs = useUsageMrs(url.range, url.repo);
  const onTrends = url.view === 'trends';
  const trends = useUsageTrends(url.range, url.repo, onTrends);
  const earlier = useUsageTrends(
    url.range ? url.range * 2 : null,
    url.repo,
    onTrends && url.range !== null
  );
  const status = useUsageStatus();

  const { sort, dir } = url.order;
  const rows = useMemo(
    () => sortMrs(mrs.data?.mrs ?? [], { sort, dir }),
    [mrs.data, sort, dir]
  );
  const enrichment = useUsageEnrichment(rows.map(r => r.branch));

  const summary = mrs.data?.summary;
  const weeks = trends.data?.weeks ?? [];
  const failed = mrs.isError || (onTrends && trends.isError);
  const hasData = onTrends
    ? trends.isSuccess && weeks.length > 0
    : (summary?.mrCount ?? 0) > 0;
  const settled = onTrends ? trends.isSuccess : mrs.isSuccess;
  const usedKinds = KIND_ORDER.filter(k =>
    weeks.some(w => w.byKind[k].cost > 0)
  );
  const unpriced = summary?.totals.unpricedTokens ?? 0;
  const sweptAt = status.data?.lastSweepAt ?? null;

  const responseCost = rows.reduce((sum, r) => sum + r.costByKind.respond, 0);
  const mrStats: UsageStat[] = summary
    ? [
        {
          key: 'cost',
          value: usd(summary.totals.cost),
          label: 'estimated cost',
          tone: 'gray',
        },
        {
          key: 'mrs',
          value: summary.mrCount,
          label: 'MRs',
          tone: 'accent',
        },
        {
          key: 'median',
          value: usd(summary.medianCost),
          label: 'median MR',
          tone: 'gray',
        },
        {
          key: 'responses',
          value: `${summary.totals.cost > 0 ? Math.round((responseCost / summary.totals.cost) * 100) : 0}%`,
          label: 'spent on responses',
          tone: 'ok',
        },
      ]
    : [];
  const trendCost = trends.data?.totals.cost ?? 0;
  const trendStats: UsageStat[] = [
    { key: 'cost', value: usd(trendCost), label: 'estimated cost' },
    {
      key: 'average',
      value: usd(averageWeek(trendCost, url.range, weeks)),
      label: 'average week',
    },
    { key: 'mrs', value: summary?.mrCount ?? 0, label: 'MRs' },
    changeStat(trendCost, url.range, earlier),
  ];

  return (
    <PageShell
      headerHeight={PAGE_ROW_HEIGHT}
      compactHeader
      scrollClamp={!onTrends}
    >
      <PageShell.Main>
        <PageShell.Header
          title="Usage"
          actions={
            sweptAt ? (
              <Text fz="sm" c="dimmed" lh="normal">
                {`as of ${clockTime(sweptAt)}`}
              </Text>
            ) : undefined
          }
        />
        <PageShell.Content
          contentContainer
          contentContainerProps={
            onTrends ? CONTENT_FRAME : { ...CONTENT_FRAME, h: '100%' }
          }
        >
          <div
            className={classes.page}
            data-clamped={!onTrends || undefined}
            data-testid="usage-page"
          >
            <UsageRepoSelect
              value={url.repo}
              onChange={repo => url.set('repo', repo)}
              range={url.range}
            />

            <Group justify="space-between" gap={16} w="100%">
              <Text fz="lg" fw={500} lh="normal">
                {url.view === 'trends'
                  ? 'weekly usage on this Mac'
                  : 'every MR on this Mac'}
              </Text>
              <Group gap={8} wrap="nowrap">
                <SegmentedControl
                  aria-label="Range"
                  data={RANGES}
                  value={url.rangeValue}
                  onChange={v => url.set('range', v === '30' ? null : v)}
                />
                <SegmentedControl
                  aria-label="View"
                  data={VIEWS}
                  value={url.view}
                  onChange={v => url.set('view', v === 'mrs' ? null : v)}
                />
              </Group>
            </Group>

            {failed ? (
              <RetryAlert
                color="warn"
                icon="unplug"
                onRetry={() => {
                  void mrs.refetch();
                  void trends.refetch();
                }}
              >
                Can&apos;t read usage from the rt daemon.
              </RetryAlert>
            ) : null}

            {hasData ? (
              onTrends ? (
                <>
                  <UsageStats stats={trendStats} />
                  <Paper
                    variant="ground"
                    withBorder
                    radius={12}
                    className={classes.card}
                  >
                    <Group justify="space-between" gap={16} mb={14}>
                      <Text fz="md" fw={700} lh="normal">
                        Estimated cost per week
                      </Text>
                      <KindLegend kinds={usedKinds} />
                    </Group>
                    <WeeklyChart weeks={weeks} />
                  </Paper>
                  <div className={classes.lower}>
                    <BreakdownCard
                      title="By pipeline"
                      rows={pipelineRows(trends.data?.byPipeline ?? [])}
                      total={trendCost}
                    />
                    <BreakdownCard
                      title="By model"
                      rows={modelRows(trends.data?.byModel ?? [])}
                      total={trendCost}
                    />
                  </div>
                </>
              ) : (
                <>
                  <UsageStats stats={mrStats} />
                  <UsageMrList
                    rows={rows}
                    enrichment={enrichment}
                    order={url.order}
                    onSort={url.sortBy}
                    resetKey={`${url.rangeValue} ${url.repo} ${sort} ${dir}`}
                    showRepo={url.repo === null}
                  />
                </>
              )
            ) : null}

            {unpriced > 0 ? (
              <Text fz="sm" c="dimmed" lh="normal">
                {`${compact(unpriced)} tokens have no price yet.`}
              </Text>
            ) : null}

            {settled && !hasData ? (
              <Paper
                variant="ground"
                withBorder
                radius={12}
                className={classes.card}
              >
                <Stack gap={6}>
                  <Text fz="lg" fw={500} lh="normal">
                    {sweptAt ? 'No usage in this range.' : 'No usage yet.'}
                  </Text>
                  <Text fz="md" lh="normal" c="dimmed">
                    {emptyHint(sweptAt, url.range, url.repo)}
                  </Text>
                </Stack>
              </Paper>
            ) : null}
          </div>
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );
}
