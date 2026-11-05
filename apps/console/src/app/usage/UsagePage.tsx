import { useMemo } from 'react';
import {
  Group,
  PageShell,
  Paper,
  SegmentedControl,
  Stack,
  Table,
  Text,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { Link } from '@mattstack/app-kit/router';
import type {
  UsageModelRow,
  UsageMrRow,
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
  mrParts,
  mrSummary,
  usageMrHref,
  usd,
} from './format';
import { KindBar, KindLegend, ShareBar } from './KindBar';
import classes from './UsagePage.module.css';
import { UsageRepoSelect } from './UsageRepoSelect';
import { UsageStats, type UsageStat } from './UsageStats';
import {
  useUsageEnrichment,
  useUsageMrs,
  useUsageStatus,
  useUsageTrends,
  type EnrichmentOf,
  type UsageRange,
} from './useUsage';
import { WeeklyChart } from './WeeklyChart';

const RANGES = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'all', label: 'All' },
];

const VIEWS = [
  { value: 'mrs', label: 'MRs' },
  { value: 'trends', label: 'Trends' },
];

const DAY_MS = 86_400_000;

function useUsageUrl() {
  const params = new URLSearchParams(useSearch());
  const rangeValue = params.get('range') ?? '30';
  const view = params.get('view') === 'trends' ? 'trends' : 'mrs';
  const repo = params.get('repo');
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    navigate(qs ? `/usage?${qs}` : '/usage', { replace: true });
  };
  const range: UsageRange = rangeValue === 'all' ? null : Number(rangeValue);
  return { rangeValue, range, view, repo, set };
}

function MrRow({
  row,
  enrichment,
}: {
  row: UsageMrRow;
  enrichment: EnrichmentOf;
}) {
  const { number } = mrParts(row.mrKey);
  const title = enrichment(row.branch)?.ticket?.title;
  return (
    <Table.Tr className={classes.row}>
      <Table.Td className={classes.name}>
        <Link href={usageMrHref(row.mrKey)} className={classes.link}>
          <Group gap={8} wrap="nowrap">
            {row.ticket ? (
              <Text fz="md" fw={700} lh="normal" className={classes.ticket}>
                {row.ticket}
              </Text>
            ) : null}
            <Text fz="md" fw={row.ticket ? 400 : 700} lh="normal" truncate>
              {title ?? row.branch ?? number}
            </Text>
          </Group>
        </Link>
        <Text fz="sm" c="dimmed" lh="normal" truncate mt={3}>
          {`${number} ${mrSummary(row)}`.trim()}
        </Text>
      </Table.Td>
      <Table.Td className={classes.bar}>
        <KindBar cost={row.costByKind} />
      </Table.Td>
      <Table.Td ta="right" c="dimmed" className={classes.num}>
        {compact(row.totals.output)}
      </Table.Td>
      <Table.Td ta="right" c="dimmed" className={classes.num}>
        {compact(row.totals.cacheRead)}
      </Table.Td>
      <Table.Td ta="right" fw={700} className={classes.num}>
        {usd(row.totals.cost)}
      </Table.Td>
      <Table.Td className={classes.chevron}>
        <Icon name="chevronRight" size={16} />
      </Table.Td>
    </Table.Tr>
  );
}

function MrsView({
  rows,
  enrichment,
}: {
  rows: UsageMrRow[];
  enrichment: EnrichmentOf;
}) {
  const kinds = KIND_ORDER.filter(k => rows.some(r => r.costByKind[k] > 0));
  return (
    <Paper variant="ground" withBorder radius={12} className={classes.table}>
      <Table variant="soft" noPaper highlightOnHover horizontalSpacing={16}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>MR</Table.Th>
            <Table.Th>
              <KindLegend kinds={kinds} />
            </Table.Th>
            <Table.Th ta="right" className={classes.num}>
              Output
            </Table.Th>
            <Table.Th ta="right" className={classes.num}>
              Cache read
            </Table.Th>
            <Table.Th ta="right" className={classes.num}>
              <Group gap={3} justify="flex-end" wrap="nowrap">
                Est. cost
                <Icon name="arrowDown" size={12} />
              </Group>
            </Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map(row => (
            <MrRow key={row.mrKey} row={row} enrichment={enrichment} />
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}

function BreakdownCard({
  title,
  rows,
  total,
}: {
  title: string;
  rows: Array<{ label: string; totals: UsageTotals }>;
  total: number;
}) {
  return (
    <Paper variant="ground" withBorder radius={12} className={classes.card}>
      <Text fz="md" fw={700} lh="normal" mb={10}>
        {title}
      </Text>
      <Stack gap={10}>
        {rows.map(row => (
          <div key={row.label} className={classes.breakdown}>
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
    .map(r => ({ label: r.pipeline ?? 'no run', totals: r.totals }));

const modelRows = (rows: UsageModelRow[]) =>
  [...rows]
    .sort((a, b) => b.totals.cost - a.totals.cost)
    .map(r => ({ label: modelName(r.model), totals: r.totals }));

function changeStat(
  cost: number,
  range: UsageRange,
  now: number,
  earlier: ReturnType<typeof useUsageTrends>['data']
): UsageStat {
  const label = range ? `vs last ${range} days` : 'vs earlier';
  const before = range
    ? (earlier?.weeks ?? [])
        .filter(w => w.weekStart < now - range * DAY_MS)
        .reduce((sum, w) => sum + w.totals.cost, 0)
    : 0;
  if (before <= 0) return { key: 'change', value: '—', label };
  const change = Math.round(((cost - before) / before) * 100);
  return {
    key: 'change',
    value: `${change > 0 ? '+' : ''}${change}%`,
    label,
  };
}

export function UsagePage() {
  const url = useUsageUrl();
  const mrs = useUsageMrs(url.range, url.repo);
  const trends = useUsageTrends(url.range, url.repo);
  const earlier = useUsageTrends(url.range ? url.range * 2 : null, url.repo);
  const status = useUsageStatus();
  const now = useMemo(() => Date.now(), []);

  const rows = useMemo(
    () =>
      [...(mrs.data?.mrs ?? [])].sort((a, b) => b.totals.cost - a.totals.cost),
    [mrs.data]
  );
  const enrichment = useUsageEnrichment(rows.map(r => r.branch));

  const summary = mrs.data?.summary;
  const weeks = trends.data?.weeks ?? [];
  const failed = mrs.isError || trends.isError;
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
      value: usd(weeks.length ? trendCost / weeks.length : 0),
      label: 'average week',
    },
    { key: 'mrs', value: summary?.mrCount ?? 0, label: 'MRs' },
    changeStat(trendCost, url.range, now, earlier.data),
  ];

  return (
    <PageShell headerHeight={PAGE_ROW_HEIGHT} compactHeader>
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
          contentContainerProps={{ maw: 1680, my: 0, px: 40, py: 28 }}
        >
          <div className={classes.page} data-testid="usage-page">
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

            {summary && summary.mrCount > 0 ? (
              url.view === 'mrs' ? (
                <>
                  <UsageStats stats={mrStats} />
                  <MrsView rows={rows} enrichment={enrichment} />
                </>
              ) : (
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
              )
            ) : null}

            {unpriced > 0 ? (
              <Text fz="sm" c="dimmed" lh="normal">
                {`${compact(unpriced)} tokens have no price yet.`}
              </Text>
            ) : null}

            {summary && summary.mrCount === 0 ? (
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
                    {sweptAt
                      ? 'Try a longer range.'
                      : 'rt reads token usage from your runs every 5 minutes.'}
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
