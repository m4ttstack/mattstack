import { Component } from 'react';
import type { ReactNode } from 'react';
import {
  Anchor,
  Breadcrumbs,
  GenericError,
  LazyLoader,
  PageShell,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { Link } from 'wouter';

import { PAGE_ROW_HEIGHT } from '../chrome';
import { CommandProvenance } from './CommandProvenance';
import { repoLabel } from './repoLabel';
import { RecordPage } from './run-page/RecordPage';
import { RunPage, type RunPageData } from './run-page/RunPage';
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
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <Stack gap="lg" data-testid="run-detail-error">
          <GenericError
            title="This run failed to load"
            message={error.message}
            onRetry={() => this.setState({ error: null })}
          />
        </Stack>
      );
    }
    return this.props.children;
  }
}

/** The run's own name in the breadcrumb: its ticket, the MR it reviewed, or
    its id. */
function Crumb({ repo, runId }: { repo: string; runId: string }) {
  const { data } = useRunChrome(repo, runId);
  const run = (data as RunPageData | undefined)?.run;
  const reviewed = run?.outcome?.reviewed;
  const name = run?.ticket ?? (reviewed ? `!${reviewed.iid}` : null) ?? runId;
  return (
    <Text span inherit data-testid="run-crumb">
      {name}
    </Text>
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
          bg="var(--tk-panel)"
          contentContainerProps={{ maw: 1680, my: 0, p: 0 }}
        >
          <div className={classes.page}>
            <RunDetailErrorBoundary>
              <LazyLoader>
                <RunDetailContent repo={repo} runId={runId} />
              </LazyLoader>
            </RunDetailErrorBoundary>
          </div>
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );
}
