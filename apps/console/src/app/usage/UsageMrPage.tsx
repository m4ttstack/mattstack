import { useState } from 'react';
import {
  Anchor,
  Badge,
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
import type { UsageMrEntry, UsageTotals } from '@mattstack/rt-client';

import { PAGE_ROW_HEIGHT } from '../chrome';
import { Eyebrow } from '../runs/Eyebrow';
import { RetryAlert } from '../runs/RetryAlert';
import { Stat } from '../runs/Stat';
import {
  allTokens,
  compact,
  entryLabel,
  KIND_ORDER,
  mrParts,
  shortDay,
  usd,
} from './format';
import { KindBar, KindLegend } from './KindBar';
import classes from './UsageMrPage.module.css';
import { useUsageMr } from './useUsage';

function Tokens({ totals }: { totals: UsageTotals }) {
  return (
    <Text fz="sm" c="dimmed" lh="normal">
      {`${compact(totals.output)} output, ${compact(allTokens(totals))} total`}
    </Text>
  );
}

function EntryRow({ entry }: { entry: UsageMrEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={classes.entry}>
      <UnstyledButton
        className={classes.entryHead}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} />
        <Badge color="gray" className={classes.kind}>
          {entryLabel(entry)}
        </Badge>
        <Text fz="md" lh="normal" className={classes.entryWhen}>
          {shortDay(entry.firstActivity)}
        </Text>
        <Text fz="sm" c="dimmed" lh="normal" truncate className={classes.grow}>
          {entry.pipeline ?? 'No run'}
        </Text>
        <Tokens totals={entry.totals} />
        <Text fz="md" fw={500} lh="normal" className={classes.cost}>
          {usd(entry.totals.cost)}
        </Text>
      </UnstyledButton>
      {open ? (
        <div className={classes.stages}>
          <Table>
            <Table.Tbody>
              {entry.stages.map(stage => (
                <Table.Tr key={`${stage.name}-${stage.attempt}`}>
                  <Table.Td>
                    {stage.name
                      ? `${stage.name}${stage.attempt && stage.attempt > 1 ? ` (attempt ${stage.attempt})` : ''}`
                      : 'Between stages'}
                  </Table.Td>
                  <Table.Td ta="right">
                    <Tokens totals={stage.totals} />
                  </Table.Td>
                  <Table.Td ta="right" className={classes.cost}>
                    {usd(stage.totals.cost)}
                  </Table.Td>
                </Table.Tr>
              ))}
              {entry.subagent.cost > 0 ? (
                <Table.Tr>
                  <Table.Td>
                    <Text fz="sm" c="dimmed" lh="normal">
                      Of this, subagents
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Tokens totals={entry.subagent} />
                  </Table.Td>
                  <Table.Td ta="right" className={classes.cost}>
                    {usd(entry.subagent.cost)}
                  </Table.Td>
                </Table.Tr>
              ) : null}
            </Table.Tbody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}

export function UsageMrPage({ mrKey }: { mrKey: string }) {
  const query = useUsageMr(mrKey);
  const mr = query.data;
  const { repo, number } = mrParts(mrKey);
  const usedKinds = mr ? KIND_ORDER.filter(k => mr.costByKind[k] > 0) : [];

  return (
    <PageShell headerHeight={PAGE_ROW_HEIGHT} compactHeader>
      <PageShell.Main>
        <PageShell.Header title="Usage" />
        <PageShell.Content
          contentContainerProps={{ maw: 1080, my: 0, px: 40, py: 28 }}
        >
          <div className={classes.page} data-testid="usage-mr-page">
            <Link href="/usage" className={classes.back}>
              <Group gap={4} wrap="nowrap">
                <Icon name="chevronLeft" size={16} />
                <Text fz="sm" lh="normal">
                  All MRs
                </Text>
              </Group>
            </Link>

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

            {mr ? (
              <>
                <Stack gap={2}>
                  <Text fz="xl" fw={700} lh="normal">
                    {mr.ticket ?? mr.branch ?? number}
                  </Text>
                  <Group gap={8}>
                    <Text fz="sm" c="dimmed" lh="normal">
                      {`${repo} ${number}`}
                    </Text>
                    {mr.url ? (
                      <Anchor
                        href={mr.url}
                        target="_blank"
                        rel="noreferrer"
                        fz="sm"
                      >
                        Open MR
                      </Anchor>
                    ) : null}
                  </Group>
                </Stack>

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
                    value={usd(mr.totals.cost)}
                    label="Estimated cost"
                  />
                  <Stat
                    size="h2"
                    className={classes.stat}
                    value={compact(mr.totals.output)}
                    label="Output tokens"
                  />
                  <Stat
                    size="h2"
                    className={classes.stat}
                    value={compact(allTokens(mr.totals))}
                    label="Tokens, with cache"
                  />
                  <Stat
                    size="h2"
                    className={classes.stat}
                    value={usd(mr.subagent.cost)}
                    label="In subagents"
                  />
                </Paper>

                <Paper
                  variant="ground"
                  withBorder
                  radius={12}
                  className={classes.card}
                >
                  <Group justify="space-between" gap={16} mb={12}>
                    <Eyebrow>Where it went</Eyebrow>
                    <KindLegend kinds={usedKinds} />
                  </Group>
                  <KindBar cost={mr.costByKind} />
                </Paper>

                <Eyebrow>In order</Eyebrow>
                <div className={classes.entries}>
                  {mr.runs.map(entry => (
                    <EntryRow
                      key={entry.runId ?? entry.sessionId}
                      entry={entry}
                    />
                  ))}
                </div>

                <Eyebrow>By model</Eyebrow>
                <Table>
                  <Table.Tbody>
                    {mr.byModel.map(row => (
                      <Table.Tr key={row.model}>
                        <Table.Td>{row.model ?? 'Unknown'}</Table.Td>
                        <Table.Td ta="right">
                          <Tokens totals={row.totals} />
                        </Table.Td>
                        <Table.Td ta="right" className={classes.cost}>
                          {usd(row.totals.cost)}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>

                <Text fz="sm" c="dimmed" lh="normal">
                  Dollars are what this usage would cost at API prices.
                  Teammates’ reviews are not on this Mac.
                </Text>
              </>
            ) : null}
          </div>
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );
}
