import { Component } from 'react';
import type { ReactNode } from 'react';
import { MattstackShell, ScopeSlash } from '@mattstack/app-kit/app';
import {
  Button,
  Divider,
  Group,
  LazyLoader,
  PageShell,
  Text,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { RunSummary } from '@mattstack/rt-client';
import { QueryErrorResetBoundary, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';

import { formatClock } from './derive/clock';
import { repoLabel } from './repoLabel';
import { Dot } from './run-page/Dot';
import { RunGateQueue } from './run-page/GateQueueStrip';
import { RecordPage } from './run-page/RecordPage';
import { RunLoadError } from './run-page/RunLoadError';
import { RunPage, type RunPageData } from './run-page/RunPage';
import { RunPageSkeleton } from './run-page/RunPageSkeleton';
import classes from './RunDetail.module.css';
import { runsHomeHref } from './runs-page/useRunsUrl';
import { useRun, useRunChrome, useRunEvents } from './useRuns';

function RunDetailContent({ repo, runId }: { repo: string; runId: string }) {
  useRunEvents();
  const { data } = useRun(repo, runId);
  const page = data as RunPageData;
  return page.run.status === 'running' ? (
    <RunPage repo={repo} runId={runId} data={page} />
  ) : (
    <RecordPage repo={repo} runId={runId} data={page} />
  );
}

/**
 * Scoped to this route (not the app-wide `RouteErrorBoundary` in App.tsx),
 * so a thrown `useRun` query loses only the fields it fetched -- the page
 * title and the command that would fetch them by hand both survive the
 * fallback.
 */
class RunDetailErrorBoundary extends Component<
  {
    children: ReactNode;
    onReset: () => void;
    fallback: (error: Error, retry: () => void) => ReactNode;
  },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  retry = () => {
    this.props.onReset();
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    return error ? this.props.fallback(error, this.retry) : this.props.children;
  }
}

/** The run's own name: its ticket, the MR it reviewed, or its id. A run
    that has not loaded takes its ticket from the runs list when that list
    is cached. */
function useRunName(repo: string, runId: string) {
  const queryClient = useQueryClient();
  const { data } = useRunChrome(repo, runId);
  const run = (data as RunPageData | undefined)?.run;
  if (run) {
    const reviewed = run.outcome?.reviewed;
    return run.ticket ?? (reviewed ? `!${reviewed.iid}` : null) ?? runId;
  }
  const listed = queryClient
    .getQueriesData<{ runs: RunSummary[] }>({ queryKey: ['runs'] })
    .flatMap(([, list]) => list?.runs ?? [])
    .find(r => r.repo === repo && r.id === runId);
  return listed?.ticket ?? runId;
}

/** While the run works, when the page last heard from rt. */
function Freshness({ repo, runId }: { repo: string; runId: string }) {
  const query = useRunChrome(repo, runId);
  const data = query.data as RunPageData | undefined;
  if (data?.run.status !== 'running') return null;
  return (
    <>
      <Divider orientation="vertical" />
      <Group gap={6} wrap="nowrap" data-testid="run-freshness">
        <Dot tone="ok" />
        <Text span fz="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
          {`live · updated ${formatClock(data.asOf ?? query.dataUpdatedAt)}`}
        </Text>
      </Group>
    </>
  );
}

/** The top bar's way back to the runs, as they were left, then where this
    run sits: its repo and its own name. */
function RunCrumbs({ repo, runId }: { repo: string; runId: string }) {
  return (
    <MattstackShell.AppBar>
      <Group gap={10} wrap="nowrap" miw={0}>
        <Button
          component={Link}
          href={runsHomeHref()}
          size="compact-sm"
          radius="xl"
          variant="default"
          leftSection={<Icon name="arrowLeft" size={14} />}
        >
          Runs
        </Button>
        <ScopeSlash />
        <Text span fz="sm" fw={500} c="dimmed" data-testid="run-repo">
          {repoLabel(repo)}
        </Text>
        <ScopeSlash />
        <Text span fz="sm" fw={600} truncate data-testid="run-crumb">
          {useRunName(repo, runId)}
        </Text>
        <Freshness repo={repo} runId={runId} />
      </Group>
    </MattstackShell.AppBar>
  );
}

function RunDetailBody({ repo, runId }: { repo: string; runId: string }) {
  const name = useRunName(repo, runId);
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <RunDetailErrorBoundary
          onReset={reset}
          fallback={(error, retry) => (
            <RunLoadError
              error={error}
              name={name}
              runId={runId}
              onRetry={retry}
            />
          )}
        >
          <LazyLoader loaderType="custom" loader={<RunPageSkeleton />}>
            <RunDetailContent repo={repo} runId={runId} />
          </LazyLoader>
        </RunDetailErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}

/** The run page: its breadcrumb in the top bar, then the live page or the
    finished run's record. */
export function RunDetail({ repo, runId }: { repo: string; runId: string }) {
  return (
    <PageShell>
      <RunCrumbs repo={repo} runId={runId} />
      <PageShell.Main>
        <PageShell.Content
          contentContainerProps={{ maw: 1680, my: 0, px: 40, py: 28 }}
        >
          <div className={classes.page}>
            <RunGateQueue runId={runId} />
            <RunDetailBody repo={repo} runId={runId} />
          </div>
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );
}
