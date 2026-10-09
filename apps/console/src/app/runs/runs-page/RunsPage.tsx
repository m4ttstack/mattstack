import { useMemo } from 'react';
import {
  GenericError,
  Group,
  PageShell,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type {
  BranchEnrichment,
  GateRow,
  RunSummary,
} from '@mattstack/rt-client';

import { runIdOfGate } from '../../../shared/gate-run';
import { PAGE_ROW_HEIGHT } from '../../chrome';
import { agingWarning } from '../aging';
import { CommandProvenance } from '../CommandProvenance';
import { nowOf } from '../derive/clock';
import { runTitle } from '../derive/kind';
import {
  dayGroups,
  filterView,
  laneFacts,
  runsStats,
  statCards,
  type RunsFilter,
} from '../derive/lanes';
import { answeredGates } from '../derive/record';
import { repoPath } from '../repoLabel';
import type { RunPageData } from '../run-page/useRunParts';
import {
  useRunChrome,
  useRunEvents,
  useRunList,
  useRunsEnrich,
  useRunsPruneDays,
} from '../useRuns';
import { EarlierList, type EarlierRowInfo } from './EarlierList';
import { LiveLane } from './LiveLane';
import { runHref, ticketOf } from './runLinks';
import classes from './RunsPage.module.css';
import { StatCards } from './StatCards';
import { TimelineView, ViewToggle } from './TimelineView';
import { useLinkedGates } from './useLinkedGates';
import { useRunsUrl } from './useRunsUrl';
import { WaitingBanner } from './WaitingBanner';

const FILTERS: { value: RunsFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'live', label: 'Live' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'done', label: 'Done' },
];

const ALL_REPOS = '';
const NO_GATES: GateRow[] = [];

function SectionLabel({
  parity,
  children,
}: {
  parity: string;
  children: string;
}) {
  return (
    <Text
      fz={10.5}
      fw={500}
      lh="normal"
      tt="uppercase"
      lts={0.8}
      c="dimmed"
      data-parity={parity}
    >
      {children}
    </Text>
  );
}

function EmptyCard({ title, sub }: { title: string; sub: string }) {
  return (
    <Paper
      variant="ground"
      withBorder
      radius={12}
      className={classes.empty}
      data-parity="Live empty"
    >
      <Stack gap={6}>
        <Text fz={13.5} fw={500} lh="normal" data-parity="t">
          {title}
        </Text>
        <Text fz={12.5} lh="normal" c="dimmed" data-parity="s">
          {sub}
        </Text>
      </Stack>
    </Paper>
  );
}

function LaneSlot({
  run,
  gates,
  title,
  now,
}: {
  run: RunSummary;
  gates: GateRow[];
  title: string;
  now: number;
}) {
  const detail = useRunChrome(run.repo, run.id).data as RunPageData | undefined;
  return (
    <LiveLane
      runId={run.id}
      ticket={ticketOf(run)}
      title={title}
      href={runHref(run)}
      facts={laneFacts({ run, detail, gates, now })}
    />
  );
}

/** Every run on this Mac: what waits on you, what is live and what ran
    before, filtered by state and repo; or one day's runs on a timeline. */
export function RunsPage() {
  useRunEvents();
  const [url, setUrl] = useRunsUrl();
  const runsQuery = useRunList();
  const linked = useLinkedGates();
  const pruneDays = useRunsPruneDays().data;
  const now = nowOf(runsQuery.data);

  const allRuns = useMemo(
    () => (runsQuery.data?.runs ?? []) as RunSummary[],
    [runsQuery.data]
  );
  const repos = useMemo(
    () => [...new Set(allRuns.map(r => r.repo))].sort(),
    [allRuns]
  );
  const runs = useMemo(
    () => (url.repo ? allRuns.filter(r => r.repo === url.repo) : allRuns),
    [allRuns, url.repo]
  );
  const gates = useMemo(() => {
    if (!url.repo) return linked.all;
    const ids = new Set(runs.map(r => r.id));
    return linked.all.filter(g => ids.has(runIdOfGate(g) ?? ''));
  }, [linked.all, runs, url.repo]);

  const view = useMemo(
    () => filterView({ filter: url.filter, runs, gates, now }),
    [url.filter, runs, gates, now]
  );
  const cards = useMemo(
    () => statCards(runsStats({ runs, gates, lanes: view.allLanes, now })),
    [runs, gates, view.allLanes, now]
  );

  const branches = useMemo(
    () =>
      runs.map(r => r.branch).filter((b): b is string => typeof b === 'string'),
    [runs]
  );
  const enrich = useRunsEnrich(branches).data;
  const titleOf = (run: RunSummary) =>
    runTitle(run, {
      ticketTitle: run.branch
        ? (enrich as Record<string, BranchEnrichment> | undefined)?.[run.branch]
            ?.ticket?.title
        : null,
    });
  const gatesOf = (run: RunSummary) => linked.byRun.get(run.id) ?? NO_GATES;
  const info = (run: RunSummary): EarlierRowInfo => ({
    ticket: ticketOf(run),
    title: titleOf(run),
    href: runHref(run),
    decisions: answeredGates(gatesOf(run)).length,
    inBoard: view.inBoard.has(run.id),
    aging: agingWarning(run, pruneDays, now),
  });

  const repoName = url.repo
    ? repoPath(url.repo)
    : repos.length === 1
      ? repoPath(repos[0]!)
      : repos.length > 1
        ? `${repos.length} repos`
        : null;

  if (runsQuery.isError) {
    return (
      <PageShell title="Runs" headerHeight={PAGE_ROW_HEIGHT} compactHeader>
        <GenericError
          title="Couldn't load runs"
          message={(runsQuery.error as Error).message}
          onRetry={() => void runsQuery.refetch()}
        />
      </PageShell>
    );
  }

  const { banner, lanes, earlier } = view;
  const groups = earlier ? dayGroups(earlier, now) : [];
  const nothingWaiting =
    url.filter === 'waiting' &&
    !banner &&
    lanes?.length === 0 &&
    earlier?.length === 0;

  return (
    <PageShell headerHeight={PAGE_ROW_HEIGHT} compactHeader>
      <PageShell.Main>
        <PageShell.Header
          title="Runs"
          actions={
            <CommandProvenance
              command="rt runs"
              asOf={
                runsQuery.data?.asOf ?? (runsQuery.dataUpdatedAt || undefined)
              }
            />
          }
        />
        <PageShell.Content
          bg="var(--tk-panel)"
          contentContainerProps={{ maw: 1680, my: 0, p: 0 }}
        >
          {url.view === 'timeline' ? (
            <div className={classes.page} data-testid="runs-page">
              <TimelineView
                runs={runs}
                gates={gates}
                gatesByRun={linked.byRun}
                loading={runsQuery.isPending || !linked.loaded}
                repoName={url.repo ? repoPath(url.repo) : null}
                now={now}
                day={url.day}
                setUrl={setUrl}
                titleOf={titleOf}
              />
            </div>
          ) : (
            <div
              className={classes.page}
              data-parity="Content"
              data-testid="runs-page"
            >
              <div className={classes.titleRow}>
                <Stack gap={4} className={classes.titleBlock}>
                  <Text fz={24} fw={700} lh="normal" data-parity="title">
                    Runs
                  </Text>
                  <Text fz={13} lh="normal" c="dimmed" data-parity="sub">
                    {repoName
                      ? `${repoName} · every pipeline run on this Mac`
                      : 'every pipeline run on this Mac'}
                  </Text>
                </Stack>
                <Group gap={8} wrap="nowrap">
                  <SegmentedControl
                    aria-label="Show"
                    data={FILTERS}
                    value={url.filter}
                    onChange={v => setUrl({ filter: v as RunsFilter })}
                  />
                  <Select
                    aria-label="repo"
                    w={180}
                    allowDeselect={false}
                    leftSection={<Icon name="gitBranch" size={14} />}
                    value={url.repo ?? ALL_REPOS}
                    data={[
                      { value: ALL_REPOS, label: 'all repos' },
                      ...repos.map(r => ({ value: r, label: repoPath(r) })),
                      ...(url.repo && !repos.includes(url.repo)
                        ? [{ value: url.repo, label: repoPath(url.repo) }]
                        : []),
                    ]}
                    onChange={v => setUrl({ repo: v ? v : null })}
                  />
                  <ViewToggle
                    view="lanes"
                    onChange={view => setUrl({ view })}
                  />
                </Group>
              </div>

              <StatCards cards={cards} />

              {banner ? (
                <WaitingBanner
                  gate={banner.gate}
                  ticket={ticketOf(banner.run)}
                  title={titleOf(banner.run)}
                  href={`${runHref(banner.run)}#gate-${encodeURIComponent(banner.gate.id)}`}
                  now={now}
                />
              ) : null}

              {nothingWaiting ? (
                <EmptyCard
                  title="Nothing is waiting on you."
                  sub="Gates that need your answer show up here."
                />
              ) : null}

              {lanes && !(url.filter === 'waiting' && lanes.length === 0) ? (
                <>
                  <SectionLabel parity="Live label">
                    {`Live · ${lanes.length}`}
                  </SectionLabel>
                  {lanes.length > 0 ? (
                    <div className={classes.lanes}>
                      {lanes.map(run => (
                        <LaneSlot
                          key={run.id}
                          run={run}
                          gates={gatesOf(run)}
                          title={titleOf(run)}
                          now={now}
                        />
                      ))}
                    </div>
                  ) : (
                    <EmptyCard
                      title="Nothing running."
                      sub="New runs show up here as soon as a pipeline starts."
                    />
                  )}
                </>
              ) : null}

              {earlier &&
              !(url.filter === 'waiting' && earlier.length === 0) ? (
                <>
                  <div className={classes.label}>
                    <SectionLabel parity="Earlier label">Earlier</SectionLabel>
                  </div>
                  {groups.length > 0 ? (
                    <EarlierList groups={groups} info={info} now={now} />
                  ) : (
                    <EmptyCard
                      title="No earlier runs."
                      sub="Finished runs land here, grouped by day."
                    />
                  )}
                </>
              ) : null}
            </div>
          )}
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );
}
