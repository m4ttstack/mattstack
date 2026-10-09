import { useMemo } from 'react';
import {
  GenericError,
  PageShell,
  Text,
  TextInput,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { RunSummary } from '@mattstack/rt-client';
import { useSearchParams } from 'wouter';

import { PAGE_ROW_HEIGHT } from '../chrome';
import { CommandProvenance } from './CommandProvenance';
import { nowOf } from './derive/clock';
import { dayGroups } from './derive/lanes';
import { EarlierList } from './runs-page/EarlierList';
import { runHref, ticketOf } from './runs-page/runLinks';
import classes from './RunSearch.module.css';
import { matchRun, parseQuery } from './search';
import { useRunList, useRunsPruneDays } from './useRuns';
import { useRunTitles } from './useRunTitles';

/** "2 runs · last 30 days", the window coming from rt's prune setting. */
export function searchCount(n: number, days: number | undefined): string {
  const runs = `${n} run${n === 1 ? '' : 's'}`;
  return days === undefined
    ? runs
    : `${runs} · last ${days} day${days === 1 ? '' : 's'}`;
}

export function RunSearch() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const setQuery = (q: string) => setParams(q ? { q } : {}, { replace: true });
  const runsQuery = useRunList();
  const pruneDays = useRunsPruneDays().data;
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
  const titleOf = useRunTitles(results);

  return (
    <PageShell headerHeight={PAGE_ROW_HEIGHT} compactHeader>
      <PageShell.Main>
        <PageShell.Header
          title="Search"
          actions={
            <CommandProvenance
              command="rt runs"
              asOf={runsQuery.dataUpdatedAt}
            />
          }
        />
        <PageShell.Content
          bg="var(--tk-panel)"
          contentContainerProps={{ maw: 1680, my: 0, p: 0 }}
        >
          <div
            className={classes.page}
            data-parity="Search"
            data-testid="run-search"
          >
            <Text fz={20} fw={700} lh="normal" data-parity="h">
              Search
            </Text>
            {runsQuery.isError ? (
              <GenericError
                title="Couldn't load runs"
                message={(runsQuery.error as Error).message}
                onRetry={() => void runsQuery.refetch()}
              />
            ) : (
              <>
                <TextInput
                  size="md"
                  autoFocus
                  aria-label="Search runs"
                  placeholder="Ticket, branch, repo, pipeline or status"
                  value={query}
                  onChange={event => setQuery(event.currentTarget.value)}
                  leftSection={<Icon name="search" size={16} />}
                  rightSection={
                    <Text
                      fz={12}
                      lh="normal"
                      c="dimmed"
                      className={classes.count}
                      data-parity="n"
                      data-testid="retention-window"
                    >
                      {searchCount(results.length, pruneDays)}
                    </Text>
                  }
                  rightSectionWidth="auto"
                  classNames={{ section: classes.section }}
                  wrapperProps={{ 'data-parity': 'input' }}
                  data-testid="run-search-input"
                />
                {results.length === 0 ? (
                  <Text fz={13} lh="normal" c="dimmed">
                    {query.trim() ? 'No runs match.' : 'No retained runs yet.'}
                  </Text>
                ) : (
                  <EarlierList
                    groups={dayGroups(results, now)}
                    now={now}
                    info={run => ({
                      ticket: ticketOf(run),
                      title: titleOf(run),
                      href: runHref(run),
                      inBoard: false,
                      aging: null,
                    })}
                  />
                )}
              </>
            )}
          </div>
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );
}
