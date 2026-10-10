import { Component } from 'react';
import type { ReactNode } from 'react';
import {
  Anchor,
  Breadcrumbs,
  LazyLoader,
  PageShell,
  Text,
} from '@mattstack/app-kit/core';
import type { RunSummary } from '@mattstack/rt-client';
import { QueryErrorResetBoundary, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';

import { PAGE_ROW_HEIGHT } from '../chrome';
import { CommandProvenance } from './CommandProvenance';
import { repoLabel } from './repoLabel';
import { RecordPage } from './run-page/RecordPage';
import { RunLoadError } from './run-page/RunLoadError';
import { RunPage, type RunPageData } from './run-page/RunPage';
import { RunPageSkeleton } from './run-page/RunPageSkeleton';
import classes from './RunDetail.module.css';
import { useRun, useRunChrome, useRunEvents } from './useRuns';

const command = (repo: string, runId: string) =>
  `rt runs show ${runId} --repo ${repoLabel(repo)}`;

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

function Crumb({ repo, runId }: { repo: string; runId: string }) {
  return (
    <Text span inherit data-testid="run-crumb">
      {useRunName(repo, runId)}
    </Text>
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

function Provenance({ repo, runId }: { repo: string; runId: string }) {
  const query = useRunChrome(repo, runId);
  const asOf =
    (query.data as RunPageData | undefined)?.asOf ??
    (query.dataUpdatedAt || undefined);
  return <CommandProvenance command={command(repo, runId)} asOf={asOf} />;
}

/** The run page: a breadcrumb back to the runs, the command that reads the
    same run, and the live page or the finished run's record. */
export function RunDetail({ repo, runId }: { repo: string; runId: string }) {
  return (
    <PageShell headerHeight={PAGE_ROW_HEIGHT} compactHeader>
      <PageShell.Main>
        <PageShell.Header
          title={
            <Breadcrumbs separator="/">
              <Anchor component={Link} href="/" inherit>
                Runs
              </Anchor>
              <Crumb repo={repo} runId={runId} />
            </Breadcrumbs>
          }
          actions={<Provenance repo={repo} runId={runId} />}
        />
        <PageShell.Content
          contentContainerProps={{ maw: 1680, my: 0, px: 40, py: 28 }}
        >
          <div className={classes.page}>
            <RunDetailBody repo={repo} runId={runId} />
          </div>
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );
}
