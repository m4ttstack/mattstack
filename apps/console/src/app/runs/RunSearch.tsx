import { useMemo, useState } from 'react';
import {
  GenericError,
  PageShell,
  Stack,
  Text,
  TextInput,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import type { RunSummary } from '@mattstack/rt-client';

import { PAGE_ROW_HEIGHT } from '../chrome';
import { CommandProvenance } from './CommandProvenance';
import { nowOf } from './derive/clock';
import { runTitle } from './derive/kind';
import { dayGroups } from './derive/lanes';
import { answeredGates } from './derive/record';
import { EarlierList } from './runs-page/EarlierList';
import { useLinkedGates } from './runs-page/useLinkedGates';
import { matchRun, parseQuery } from './search';
import { useRunList, useRunsPruneDays } from './useRuns';

function RetentionNotice({ days }: { days: number | undefined }) {
  const { text } = useSchemeColors();
  return (
    <Text c={text.muted} size="sm" data-testid="retention-window">
      {days === undefined
        ? 'Searching retained runs…'
        : `Searching the last ${days} day${days === 1 ? '' : 's'}; older runs have been pruned.`}
    </Text>
  );
}

export function RunSearch() {
  const [query, setQuery] = useState('');
  const runsQuery = useRunList();
  const pruneDaysQuery = useRunsPruneDays();
  const linked = useLinkedGates();
  const { text } = useSchemeColors();
  const now = nowOf(runsQuery.data);

  const runs = useMemo(
    () => (runsQuery.data?.runs ?? []) as RunSummary[],
    [runsQuery.data]
  );
  const terms = useMemo(() => parseQuery(query), [query]);
  const results = useMemo(
    () => runs.filter(run => matchRun(run, terms)),
    [runs, terms]
  );

  if (runsQuery.isError) {
    return (
      <PageShell title="Search" headerHeight={PAGE_ROW_HEIGHT} compactHeader>
        <GenericError
          title="Couldn't load runs"
          message={(runsQuery.error as Error).message}
          onRetry={() => void runsQuery.refetch()}
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Search"
      headerHeight={PAGE_ROW_HEIGHT}
      compactHeader
      actions={
        <CommandProvenance command="rt runs" asOf={runsQuery.dataUpdatedAt} />
      }
    >
      <Stack gap="md" data-testid="run-search">
        <RetentionNotice days={pruneDaysQuery.data} />
        <TextInput
          placeholder="Search by ticket, branch, repo, verb, or status"
          value={query}
          onChange={event => setQuery(event.currentTarget.value)}
          leftSection={<Icons.search size={16} />}
          data-testid="run-search-input"
        />
        {results.length === 0 ? (
          <Text c={text.muted} size="sm">
            {query.trim() ? 'No runs match.' : 'No retained runs yet.'}
          </Text>
        ) : (
          <EarlierList
            groups={dayGroups(results, now)}
            now={now}
            info={run => ({
              ticket: run.ticket,
              title: runTitle(run, {}),
              href: `/runs/${run.repo}/${run.id}`,
              decisions: answeredGates(linked.byRun.get(run.id) ?? []).length,
              inBoard: false,
              aging: null,
            })}
          />
        )}
      </Stack>
    </PageShell>
  );
}
