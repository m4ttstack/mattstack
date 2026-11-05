import {
  Anchor,
  Badge,
  Group,
  PageShell,
  Paper,
  Stack,
  Table,
  Text,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { Link } from '@mattstack/app-kit/router';
import type { UsageTotals } from '@mattstack/rt-client';
import { navigate } from 'wouter/use-browser-location';

import { PAGE_ROW_HEIGHT } from '../chrome';
import { RetryAlert } from '../runs/RetryAlert';
import {
  clockTime,
  compact,
  modelName,
  mrParts,
  plural,
  runCounts,
  usd,
} from './format';
import { ShareBar } from './KindBar';
import { stepRows, type StepRow } from './steps';
import classes from './UsageMrPage.module.css';
import { UsageRepoSelect } from './UsageRepoSelect';
import { UsageStats } from './UsageStats';
import { useUsageEnrichment, useUsageMr, useUsageStatus } from './useUsage';

function StepLine({ row, whole }: { row: StepRow; whole: number }) {
  if (row.type === 'elsewhere')
    return (
      <Table.Tr>
        <Table.Td className={classes.child}>
          <Group gap={6} wrap="nowrap">
            <Icon name="user" size={13} />
            <Text fz="md" c="dimmed" lh="normal">
              {row.label}
            </Text>
          </Group>
        </Table.Td>
        <Table.Td colSpan={4} ta="right" c="dimmed">
          not on this Mac
        </Table.Td>
        <Table.Td />
      </Table.Tr>
    );
  const group = row.level === 'group';
  return (
    <Table.Tr className={group ? classes.group : undefined}>
      <Table.Td className={group ? undefined : classes.child}>
        <Text fz="md" fw={group ? 700 : 400} lh="normal">
          {row.label}
        </Text>
        {row.note ? (
          <Text fz="sm" c="dimmed" lh="normal" mt={2}>
            {row.note}
          </Text>
        ) : null}
      </Table.Td>
      <Table.Td ta="right" c="dimmed">
        {compact(row.totals.messages)}
      </Table.Td>
      <Table.Td ta="right" c="dimmed">
        {compact(row.totals.output)}
      </Table.Td>
      <Table.Td ta="right" c="dimmed">
        {compact(row.totals.cacheRead)}
      </Table.Td>
      <Table.Td ta="right" fw={group ? 700 : 500}>
        {usd(row.totals.cost)}
      </Table.Td>
      <Table.Td className={classes.barCell}>
        <ShareBar
          kind={row.kind}
          share={whole > 0 ? row.totals.cost / whole : 0}
        />
      </Table.Td>
    </Table.Tr>
  );
}

function SideCard({
  title,
  rows,
  whole,
}: {
  title: string;
  rows: Array<{ key: string; label: string; totals: UsageTotals }>;
  whole: number;
}) {
  return (
    <Paper variant="ground" withBorder radius={12} className={classes.card}>
      <Text fz="md" fw={700} lh="normal" mb={12}>
        {title}
      </Text>
      <Stack gap={12}>
        {rows.map(row => (
          <Stack key={row.key} gap={5}>
            <Group justify="space-between" gap={8} wrap="nowrap">
              <Text fz="md" lh="normal" truncate>
                {row.label}
              </Text>
              <Text fz="md" c="dimmed" lh="normal">
                {usd(row.totals.cost)}
              </Text>
            </Group>
            <ShareBar share={whole > 0 ? row.totals.cost / whole : 0} />
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}

export function UsageMrPage({ mrKey }: { mrKey: string }) {
  const query = useUsageMr(mrKey);
  const status = useUsageStatus();
  const mr = query.data;
  const enrichment = useUsageEnrichment([mr?.branch ?? null]);
  const { repoKey, repo, number } = mrParts(mrKey);
  const enriched = enrichment(mr?.branch ?? null);
  const name = mr?.ticket ?? number;
  const title = enriched?.ticket?.title ?? mr?.branch ?? repo;
  const state = enriched?.mr?.state;
  const counts = mr ? runCounts(mr) : null;
  const sweptAt = status.data?.lastSweepAt ?? null;

  return (
    <PageShell headerHeight={PAGE_ROW_HEIGHT} compactHeader>
      <PageShell.Main>
        <PageShell.Header
          title={
            <Group gap={5} wrap="nowrap">
              <Link href="/usage" className={classes.crumb}>
                Usage
              </Link>
              <span>/</span>
              <span>{name}</span>
            </Group>
          }
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
          <div className={classes.page} data-testid="usage-mr-page">
            <UsageRepoSelect
              value={repoKey}
              onChange={next =>
                navigate(
                  next ? `/usage?repo=${encodeURIComponent(next)}` : '/usage'
                )
              }
            />
            {query.isError ? (
              <RetryAlert
                color="warn"
                icon="unplug"
                onRetry={() => void query.refetch()}
              >
                Can&apos;t read usage from the rt daemon.
              </RetryAlert>
            ) : null}

            {query.isSuccess && mr === null ? (
              <Text fz="md" c="dimmed" lh="normal">
                {`No usage recorded for ${repo} ${number}.`}
              </Text>
            ) : null}

            {mr && counts ? (
              <>
                <Group justify="space-between" gap={16} wrap="nowrap">
                  <Group gap={10} wrap="nowrap" miw={0}>
                    <Text fz="xl" fw={700} lh="normal" className={classes.name}>
                      {name}
                    </Text>
                    <Text fz="xl" lh="normal" truncate>
                      {title}
                    </Text>
                    {state ? (
                      <Badge variant="outline" color="gray">
                        {state}
                      </Badge>
                    ) : null}
                  </Group>
                  {mr.url ? (
                    <Anchor
                      href={mr.url}
                      target="_blank"
                      rel="noreferrer"
                      fz="md"
                    >
                      {number}
                    </Anchor>
                  ) : null}
                </Group>

                <UsageStats
                  stats={[
                    {
                      key: 'cost',
                      value: usd(mr.totals.cost),
                      label: 'estimated cost',
                    },
                    {
                      key: 'output',
                      value: compact(mr.totals.output),
                      label: 'output tokens',
                    },
                    {
                      key: 'cache',
                      value: compact(mr.totals.cacheRead),
                      label: 'cache read',
                    },
                    {
                      key: 'runs',
                      value: counts.runs,
                      label: `${counts.runs === 1 ? 'run' : 'runs'}, ${plural(counts.rounds, 'round')}`,
                    },
                  ]}
                />

                <div className={classes.body}>
                  <Paper
                    variant="ground"
                    withBorder
                    radius={12}
                    className={classes.table}
                  >
                    <Table variant="soft" noPaper horizontalSpacing={16}>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Step</Table.Th>
                          <Table.Th ta="right">Msgs</Table.Th>
                          <Table.Th ta="right">Output</Table.Th>
                          <Table.Th ta="right">Cache read</Table.Th>
                          <Table.Th ta="right">Est. cost</Table.Th>
                          <Table.Th />
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {stepRows(mr).map(row => (
                          <StepLine
                            key={row.key}
                            row={row}
                            whole={mr.totals.cost}
                          />
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Paper>
                  <Stack gap={16}>
                    <SideCard
                      title="By model"
                      whole={mr.totals.cost}
                      rows={[...mr.byModel]
                        .sort((a, b) => b.totals.cost - a.totals.cost)
                        .map(r => ({
                          key: r.model ?? '',
                          label: modelName(r.model),
                          totals: r.totals,
                        }))}
                    />
                    <SideCard
                      title="By agent"
                      whole={mr.totals.cost}
                      rows={[
                        { key: 'main', label: 'Main session', totals: mr.main },
                        { key: 'sub', label: 'Subagents', totals: mr.subagent },
                      ]}
                    />
                  </Stack>
                </div>
              </>
            ) : null}
          </div>
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );
}
