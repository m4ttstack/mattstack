import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query';
import { useLocation } from 'wouter';

import { MattstackShell, NotFoundPage } from '@mattstack/app-kit/app';
import { Alert, PageShell, Stack, Text } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type {
  ColdCacheResponse,
  LeaderboardResponse,
  MetricKey,
} from '../shared/types';
import { isColdCache, type RangeSelection } from './api';
import { DetailPage, FIRST_STAT } from './detail/DetailPage';
import { useLeaderboard } from './hooks/useLeaderboard';
import { usePersistentState } from './hooks/usePersistentState';
import { useRefreshClock } from './hooks/useRefreshClock';
import { useRefreshJob } from './hooks/useRefreshJob';

import './icons';

import {
  LeaderboardPage,
  leaderboardSubtitle,
} from './leaderboard/LeaderboardPage';
import { statHref } from './leaderboard/StandingsTable';
import { progressKey, STALL_AFTER_MS } from './lib/progress';
import { scopeLabel, windowLabel } from './model/labels';
import { descriptor } from './model/standings';
import { RefreshStatus } from './refresh/RefreshStatus';
import { SkeletonStandings } from './refresh/SkeletonStandings';
import { useAppRoute } from './routes';
import { PageHeader, type RangeState, type ViewMode } from './shell/PageHeader';
import { SettingsLink } from './shell/SettingsLink';
import classes from './shell/shell.module.css';
import {
  syncedLabel,
  TopbarActions,
  TopbarCrumbs,
  type Freshness,
} from './shell/Topbar';

const queryClient = new QueryClient();

const DEFAULT_SORT: MetricKey = 'mrsMerged';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  );
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function AppShell() {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [cold, setCold] = useState<ColdCacheResponse | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  // True from the moment a cold cache triggers a background refresh until that refresh lands
  // (onDone/onError) or the selection changes. Covers the whole span, including the gap between
  // deciding to refresh and refreshJob.start()'s POST actually landing (before refreshJob.refreshing
  // flips true) -- without it the leaderboard render has no signal that data is still coming and
  // falls through to blank once the cache-only probe itself settles.
  const [awaitingRefresh, setAwaitingRefresh] = useState(false);
  const [rangeState, setRangeState] = usePersistentState<RangeState>(
    'forge-range',
    { range: '30d' }
  );
  const [trend, setTrend] = usePersistentState<boolean>('forge-trend', false);
  const [view, setView] = usePersistentState<ViewMode>('forge-view', 'table');
  const [sort, setSort] = useState<MetricKey>(DEFAULT_SORT);
  const route = useAppRoute();
  const [, navigate] = useLocation();
  const now = useNow(30_000);
  const client = useQueryClient();

  const selection = useMemo<RangeSelection>(
    () => ({
      range: rangeState.range,
      start: rangeState.start,
      end: rangeState.end,
      trend,
    }),
    [rangeState.range, rangeState.start, rangeState.end, trend]
  );

  const refreshJob = useRefreshJob({
    onDone: (result, startedFor) => {
      client.setQueryData(['leaderboard', startedFor], result);
      const matches =
        startedFor.range === rangeState.range &&
        startedFor.start === rangeState.start &&
        startedFor.end === rangeState.end &&
        startedFor.trend === trend;
      if (matches) setData(result);
      setAwaitingRefresh(false);
    },
    onError: message => {
      setJobError(message);
      setAwaitingRefresh(false);
    },
  });

  const leaderboardQuery = useLeaderboard(selection);

  // Cancels any in-flight job first so a stale refresh doesn't linger in the background once the
  // selection moves on. All effects from one render commit before any async response can land, so
  // this always runs ahead of anything the new probe fetch below could resolve.
  useEffect(() => {
    refreshJob.cancel();
    setJobError(null);
    setAwaitingRefresh(false);
    setCold(null);
    // refreshJob.cancel is intentionally excluded: it is a no-op when idle, and including it here
    // (its identity changes with jobId) would refire this effect for job starts/stops, not just
    // selection changes, which is the one thing this effect must run on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  useEffect(() => {
    const result = leaderboardQuery.data;
    if (!result) return;
    if (isColdCache(result)) {
      setCold(result);
      setAwaitingRefresh(true);
      void refreshJob.start(selection);
    } else {
      setData(result);
    }
    // Deliberately keyed on the probe result only: `selection` is read fresh via closure, and it
    // is already the selection that produced this exact `result` (react-query only hands back data
    // for the query key it was fetched with).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaderboardQuery.data]);

  const error =
    jobError ??
    (leaderboardQuery.error ? leaderboardQuery.error.message : null);
  const loading = !data && (leaderboardQuery.isFetching || awaitingRefresh);

  // cancel() nulls the job without routing through onDone or onError, the only other paths that
  // clear awaitingRefresh, so a cancelled refresh would otherwise leave Loading with nothing behind it.
  const cancelRefresh = () => {
    setAwaitingRefresh(false);
    refreshJob.cancel();
  };

  const clock = useRefreshClock(
    refreshJob.refreshing,
    progressKey(refreshJob.progress)
  );
  const stalledMs =
    refreshJob.refreshing && clock.idleMs >= STALL_AFTER_MS
      ? clock.idleMs
      : null;
  const seconds = (ms: number) => Math.floor(ms / 1000);

  const freshness: Freshness | null = refreshJob.refreshing
    ? stalledMs !== null
      ? { label: `Stalled · ${seconds(stalledMs)}s`, tone: 'warn' }
      : { label: `Refreshing · ${seconds(clock.elapsedMs)}s`, tone: 'accent' }
    : data
      ? { label: syncedLabel(data.generatedAt, now), tone: 'ok' }
      : null;

  const firstLoad = !data && cold !== null;
  const shownWindow = data?.window ?? cold?.window ?? null;
  const shownScope = data?.scope ?? cold?.scope ?? null;

  const onRange = (range: string, start?: string, end?: string) =>
    setRangeState({ range, start, end });

  const status = (
    <>
      {refreshJob.refreshing && (
        <RefreshStatus
          progress={refreshJob.progress}
          stalledMs={stalledMs}
          window={shownWindow ? windowLabel(shownWindow) : ''}
          cold={!data}
          onCancel={cancelRefresh}
        />
      )}
      {error && (
        <Alert
          color="red"
          title="Error"
          variant="light"
          icon={<Icon name="warning" size={16} />}
        >
          {error}
        </Alert>
      )}
      {data && data.warnings.length > 0 && (
        <Alert
          color="warn"
          variant="light"
          icon={<Icon name="warning" size={16} />}
        >
          <Stack gap={4}>
            {data.warnings.map((w, i) => (
              <Text key={i} size="xs">
                {w.message}
              </Text>
            ))}
          </Stack>
        </Alert>
      )}
    </>
  );

  const isPerson = route.name === 'user' || route.name === 'stat';
  const stat = route.name === 'stat' ? route.stat : FIRST_STAT;

  let page: ReactNode;
  if (isPerson) {
    page = (
      <>
        {status}
        {!error && loading && (
          <Text size="sm" c="var(--tk-text-3)">
            Loading…
          </Text>
        )}
        {data && (
          <DetailPage
            data={data}
            username={route.username}
            stat={stat}
            selection={selection}
          />
        )}
      </>
    );
  } else if (route.name === 'not-found') {
    page = <NotFoundPage />;
  } else {
    page = (
      <>
        <PageHeader
          title="Leaderboard"
          subtitle={
            data
              ? leaderboardSubtitle(data, sort, trend, view)
              : cold
                ? `${windowLabel(cold.window)}  ·  first refresh for this window`
                : null
          }
          range={rangeState}
          onRange={onRange}
          trend={trend}
          onTrend={setTrend}
          view={view}
          onView={setView}
        />
        {status}
        {!data && !error && loading && <SkeletonStandings />}
        {firstLoad && !error && !loading && (
          <Text size="sm" c="var(--tk-text-3)">
            Nothing is stored for this window yet. Refresh to build it.
          </Text>
        )}
        {data && (
          <LeaderboardPage
            data={data}
            view={view}
            trend={trend}
            dimmed={refreshJob.refreshing}
            sort={sort}
            onSort={setSort}
            onSelectStat={(username, stat) =>
              navigate(statHref(username, stat))
            }
          />
        )}
        {data && Object.keys(data.metricNotes).length > 0 && (
          <Stack gap={2}>
            {Object.entries(data.metricNotes).map(([k, v]) => (
              <Text key={k} size="xs" c="var(--tk-text-3)">
                {k}: {v}
              </Text>
            ))}
          </Stack>
        )}
      </>
    );
  }

  const personName = isPerson
    ? (data?.users.find(u => u.username === route.username)?.name ??
      route.username)
    : null;
  const crumbs = isPerson
    ? ['boxscore', personName!, descriptor(stat).label]
    : ['boxscore', route.name === 'not-found' ? 'Not found' : 'Leaderboard'];

  return (
    <MattstackShell
      name="boxscore"
      rail={false}
      mark={
        <img
          src="/favicon.svg"
          alt=""
          width={30}
          height={30}
          style={{ display: 'block', flex: 'none' }}
        />
      }
    >
      <MattstackShell.Header
        actions={
          <>
            <TopbarActions
              scope={shownScope ? scopeLabel(shownScope) : null}
              freshness={freshness}
              action={refreshJob.refreshing ? 'cancel' : 'refresh'}
              onAction={
                refreshJob.refreshing
                  ? cancelRefresh
                  : () => void refreshJob.start(selection)
              }
            />
            <SettingsLink />
          </>
        }
      >
        <TopbarCrumbs crumbs={crumbs} />
      </MattstackShell.Header>
      <PageShell>
        <PageShell.Main>
          <PageShell.Content bg="var(--tk-panel)" contentContainer={false}>
            <main className={classes.content}>{page}</main>
          </PageShell.Content>
        </PageShell.Main>
      </PageShell>
    </MattstackShell>
  );
}
