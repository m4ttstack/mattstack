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
import { Link } from '@mattstack/app-kit/router';
import type { UsageMrRow } from '@mattstack/rt-client';
import { useSearch } from 'wouter';
import { navigate } from 'wouter/use-browser-location';

import { PAGE_ROW_HEIGHT } from '../chrome';
import { Eyebrow } from '../runs/Eyebrow';
import { RetryAlert } from '../runs/RetryAlert';
import { Stat } from '../runs/Stat';
import {
  allTokens,
  compact,
  KIND_ORDER,
  mrParts,
  shortDay,
  usageMrHref,
  usd,
} from './format';
import { KindBar, KindLegend } from './KindBar';
import classes from './UsagePage.module.css';
import {
  useUsageMrs,
  useUsageStatus,
  useUsageTrends,
  type UsageRange,
} from './useUsage';
import { WeeklyChart } from './WeeklyChart';

const RANGES = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'all', label: 'All' },
];

const SORTS = [
  { value: 'cost', label: 'Costliest' },
  { value: 'recent', label: 'Latest' },
];

function useUsageUrl() {
  const params = new URLSearchParams(useSearch());
  const rangeValue = params.get('range') ?? '30';
  const sort = params.get('sort') === 'recent' ? 'recent' : 'cost';
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    navigate(`/usage?${next.toString()}`, { replace: true });
  };
  const range: UsageRange = rangeValue === 'all' ? null : Number(rangeValue);
  return { rangeValue, range, sort, set };
}

function MrRow({ row, peak }: { row: UsageMrRow; peak: number }) {
  const { repo, number } = mrParts(row.mrKey);
  return (
    <Table.Tr>
      <Table.Td className={classes.name}>
        <Link href={usageMrHref(row.mrKey)} className={classes.link}>
          <Text fz="md" fw={500} lh="normal" truncate>
            {row.ticket ?? row.branch ?? number}
          </Text>
        </Link>
        <Text fz="sm" c="dimmed" lh="normal" truncate>
          {`${repo} ${number}`}
        </Text>
      </Table.Td>
      <Table.Td className={classes.bar}>
        <KindBar cost={row.costByKind} scale={row.totals.cost / peak} />
      </Table.Td>
      <Table.Td ta="right">
        <Text fz="md" fw={500} lh="normal">
          {usd(row.totals.cost)}
        </Text>
      </Table.Td>
      <Table.Td ta="right">{compact(row.totals.output)}</Table.Td>
      <Table.Td ta="right">{row.roundCount || '—'}</Table.Td>
      <Table.Td ta="right">{shortDay(row.lastActivity)}</Table.Td>
    </Table.Tr>
  );
}

function EmptyState({ swept }: { swept: boolean }) {
  return (
    <Paper variant="ground" withBorder radius={12} className={classes.empty}>
      <Stack gap={6}>
        <Text fz="lg" fw={500} lh="normal">
          {swept ? 'No usage in this range.' : 'No usage yet.'}
        </Text>
        <Text fz="md" lh="normal" c="dimmed">
          {swept
            ? 'Try a longer range.'
            : 'rt reads token usage from your runs every 5 minutes.'}
        </Text>
      </Stack>
    </Paper>
  );
}

export function UsagePage() {
  const url = useUsageUrl();
  const mrs = useUsageMrs(url.range);
  const trends = useUsageTrends(url.range);
  const status = useUsageStatus();

  const rows = useMemo(() => {
    const list = [...(mrs.data?.mrs ?? [])];
    return url.sort === 'recent'
      ? list
      : list.sort((a, b) => b.totals.cost - a.totals.cost);
  }, [mrs.data, url.sort]);

  const peak = Math.max(...rows.map(r => r.totals.cost), 0.01);
  const summary = mrs.data?.summary;
  const unpriced = summary?.totals.unpricedTokens ?? 0;
  const failed = mrs.isError || trends.isError;
  const usedKinds = KIND_ORDER.filter(k =>
    trends.data?.weeks.some(w => w.byKind[k].cost > 0)
  );

  return (
    <PageShell headerHeight={PAGE_ROW_HEIGHT} compactHeader>
      <PageShell.Main>
        <PageShell.Header title="Usage" />
        <PageShell.Content
          contentContainerProps={{ maw: 1280, my: 0, px: 40, py: 28 }}
        >
          <div className={classes.page} data-testid="usage-page">
            <Group justify="space-between" gap={16} w="100%">
              <Text fz="lg" fw={500} lh="normal">
                Estimated token cost of each MR on this Mac
              </Text>
              <SegmentedControl
                aria-label="Range"
                data={RANGES}
                value={url.rangeValue}
                onChange={v => url.set('range', v)}
              />
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
              <>
                <Paper
                  variant="ground"
                  withBorder
                  radius={12}
                  py={14}
                  className={classes.stats}
                >
                  <Stat
                    size="h2"
                    className={classes.stat}
                    value={usd(summary.totals.cost)}
                    label="Estimated cost"
                  />
                  <Stat
                    size="h2"
                    className={classes.stat}
                    value={summary.mrCount}
                    label="MRs"
                  />
                  <Stat
                    size="h2"
                    className={classes.stat}
                    value={usd(summary.medianCost)}
                    label="Median MR"
                  />
                  <Stat
                    size="h2"
                    className={classes.stat}
                    value={compact(allTokens(summary.totals))}
                    label="Tokens, with cache"
                  />
                </Paper>

                {trends.data && trends.data.weeks.length > 0 ? (
                  <Paper
                    variant="ground"
                    withBorder
                    radius={12}
                    className={classes.card}
                  >
                    <Group justify="space-between" gap={16} mb={16}>
                      <Eyebrow>By week</Eyebrow>
                      <KindLegend kinds={usedKinds} />
                    </Group>
                    <WeeklyChart weeks={trends.data.weeks} />
                  </Paper>
                ) : null}

                <Group justify="space-between" gap={16} w="100%">
                  <Eyebrow>MRs</Eyebrow>
                  <SegmentedControl
                    aria-label="Sort"
                    data={SORTS}
                    value={url.sort}
                    onChange={v => url.set('sort', v)}
                  />
                </Group>
                <Table highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>MR</Table.Th>
                      <Table.Th>Where it went</Table.Th>
                      <Table.Th ta="right">Cost</Table.Th>
                      <Table.Th ta="right">Output</Table.Th>
                      <Table.Th ta="right">Rounds</Table.Th>
                      <Table.Th ta="right">Last active</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {rows.map(row => (
                      <MrRow key={row.mrKey} row={row} peak={peak} />
                    ))}
                  </Table.Tbody>
                </Table>
                <Text fz="sm" c="dimmed" lh="normal">
                  {[
                    'Dollars are what this usage would cost at API prices.',
                    'Teammates’ usage is not on this Mac.',
                    unpriced > 0
                      ? `${compact(unpriced)} tokens have no price yet.`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                </Text>
              </>
            ) : null}

            {summary && summary.mrCount === 0 ? (
              <EmptyState swept={status.data?.lastSweepAt != null} />
            ) : null}
          </div>
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );
}
