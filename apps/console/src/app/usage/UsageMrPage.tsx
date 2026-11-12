import { useState } from 'react';
import {
  Badge,
  Button,
  Group,
  PageShell,
  Paper,
  Stack,
  Table,
  Text,
  UnstyledButton,
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
import { StepActivity } from './StepActivity';
import { stepRows, type StepRow } from './steps';
import classes from './UsageMrPage.module.css';
import { UsageRepoSelect } from './UsageRepoSelect';
import { billingStats, UsageStats } from './UsageStats';
import { useUsageEnrichment, useUsageMr, useUsageStatus } from './useUsage';

function StepLine({
  row,
  whole,
  onOpen,
}: {
  row: StepRow;
  whole: number;
  onOpen: (row: OpenStep) => void;
}) {
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
        <UnstyledButton
          className={classes.stepOpen}
          onClick={() => onOpen(row)}
        >
          <Text
            span
            fz="md"
            fw={group ? 500 : 400}
            c={row.uncounted ? 'dimmed' : undefined}
            lh="normal"
          >
            {row.label}
          </Text>
        </UnstyledButton>
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
      <Table.Td
        ta="right"
        fw={row.uncounted ? 400 : 500}
        c={row.uncounted ? 'dimmed' : undefined}
      >
        {usd(row.totals.cost)}
      </Table.Td>
      <Table.Td className={classes.barCell}>
        {row.uncounted ? (
          <Text fz="sm" c="dimmed" lh="normal">
            not counted
          </Text>
        ) : (
          <ShareBar
            kind={row.kind}
            share={whole > 0 ? row.totals.cost / whole : 0}
          />
        )}
      </Table.Td>
    </Table.Tr>
  );
}

type OpenStep = Extract<StepRow, { type: 'step' }>;

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
      <Text fz="md" fw={500} lh="normal" mb={12}>
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

const MR_TONE = {
  merged: { color: 'ok', label: 'merged' },
  opened: { color: 'accent', label: 'open' },
  closed: { color: 'gray', label: 'closed' },
} as const;

/** The MR's state, toned as the run page's outcome badge is, then a button
    that opens the MR when its url is known. */
function MrState({
  state,
  number,
  url,
}: {
  state: string | undefined;
  number: string;
  url: string | null | undefined;
}) {
  const tone = MR_TONE[state as keyof typeof MR_TONE];
  return (
    <Group gap={8} wrap="nowrap" style={{ flex: 'none' }}>
      {tone ? (
        <Badge
          size="lg"
          variant="light"
          color={tone.color}
          tt="none"
          leftSection={<Icon name="gitMerge" size={13} />}
        >
          {tone.label}
        </Badge>
      ) : null}
      {url ? (
        <Button
          component="a"
          href={url}
          target="_blank"
          rel="noreferrer"
          variant="default"
          size="compact-sm"
          rightSection={<Icon name="externalLink" size={12} />}
        >
          {number}
        </Button>
      ) : null}
    </Group>
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
  const [openStep, setOpenStep] = useState<OpenStep | null>(null);
  const [stepOpened, setStepOpened] = useState(false);

  return (
    <PageShell headerHeight={PAGE_ROW_HEIGHT} compactHeader>
      <StepActivity
        step={openStep}
        opened={stepOpened}
        onClose={() => setStepOpened(false)}
      />
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
                <Group gap={10} wrap="nowrap" miw={0}>
                  <Text fz="h3" fw={600} lh="normal" className={classes.name}>
                    {name}
                  </Text>
                  <Text fz="h3" lh="normal" truncate>
                    {title}
                  </Text>
                  <MrState state={state} number={number} url={mr.url} />
                </Group>

                <UsageStats
                  stats={[
                    ...billingStats(mr.byBilling),
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
                            onOpen={step => {
                              setOpenStep(step);
                              setStepOpened(true);
                            }}
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
