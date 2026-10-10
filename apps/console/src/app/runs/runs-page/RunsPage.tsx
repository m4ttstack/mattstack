import { useMemo } from 'react';
import { MattstackShell } from '@mattstack/app-kit/app';
import {
  Group,
  PageShell,
  Paper,
  SegmentedControl,
  Select,
  Skeleton,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { GateRow, RunSummary } from '@mattstack/rt-client';
import { useQueryClient } from '@tanstack/react-query';

import { runIdOfGate } from '../../../shared/gate-run';
import { PAGE_ROW_HEIGHT } from '../../chrome';
import { agingWarning } from '../aging';
import { CommandProvenance } from '../CommandProvenance';
import { nowOf } from '../derive/clock';
import {
  dayGroups,
  filterView,
  laneFacts,
  runsStats,
  statCards,
  type RunsFilter,
} from '../derive/lanes';
import { Eyebrow } from '../Eyebrow';
import { repoPath } from '../repoLabel';
import { RetryAlert } from '../RetryAlert';
import type { RunPageData } from '../run-page/useRunParts';
import {
  useRunChrome,
  useRunEvents,
  useRunList,
  useRunsPruneDays,
} from '../useRuns';
import { useRunTitles, type TitleOf } from '../useRunTitles';
import { EarlierList, type EarlierRowInfo } from './EarlierList';
import { LiveLane } from './LiveLane';
import { runHref, ticketOf } from './runLinks';
import classes from './RunsPage.module.css';
import { StatLine } from './StatLine';
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
        <Text fz="lg" fw={500} lh="normal" data-parity="t">
          {title}
        </Text>
        <Text fz="md" lh="normal" c="dimmed" data-parity="s">
          {sub}
        </Text>
      </Stack>
    </Paper>
  );
}

/** The runs' rows before rt has answered, so a slow or failed read never
    draws as an empty day. */
function ListSkeleton() {
  return (
    <Paper
      variant="ground"
      withBorder
      radius={12}
      className={classes.empty}
      aria-busy="true"
      data-testid="runs-skeleton"
      data-parity="list"
    >
      <Stack gap={10}>
        <Skeleton h={8} w="82%" radius="xl" data-parity="skel" />
        <Skeleton h={8} w="68%" radius="xl" data-parity="skel" />
        <Skeleton h={8} w="74%" radius="xl" data-parity="skel" />
      </Stack>
    </Paper>
  );
}

/** The runs read failed: what that means for the numbers, and Retry. */
function OutageBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <RetryAlert
      color="warn"
      icon="unplug"
      onRetry={onRetry}
      data-testid="runs-outage"
      data-parity="banner"
    >
      Can&apos;t reach the rt daemon, so these numbers are unknown, not zero.
    </RetryAlert>
  );
}

function LaneSlot({
  run,
  gates,
  titleOf,
  now,
}: {
  run: RunSummary;
  gates: GateRow[];
  titleOf: TitleOf;
  now: number;
}) {
  const detail = useRunChrome(run.repo, run.id).data as RunPageData | undefined;
  const mrField = detail?.fields.find(f => f.key === 'mr')?.value;
  return (
    <LiveLane
      runId={run.id}
      ticket={ticketOf(run)}
      title={titleOf(run, mrField)}
      href={runHref(run)}
      facts={laneFacts({ run, detail, gates, now })}
    />
  );
}

/** Every run on this Mac: what waits on you, what is live and what ran
    before, filtered by state and repo; or one day's runs on a timeline. */
export function RunsPage() {
  useRunEvents();
  const queryClient = useQueryClient();
  const [url, setUrl] = useRunsUrl();
  const runsQuery = useRunList();
  const linked = useLinkedGates();
  const pruneDays = useRunsPruneDays().data;
  const now = nowOf(runsQuery.data);

  const allRuns = useMemo(
    () => (runsQuery.data?.runs ?? []) as RunSummary[],
    [runsQuery.data]
  );
  // The server offers only the repos rt has registered, by their own names;
  // test and smoke runs stay under "all repos".
  const choices = useMemo(() => runsQuery.data?.repos ?? [], [runsQuery.data]);
  const repos = useMemo(() => choices.map(c => c.repo), [choices]);
  const labelOf = (repo: string) =>
    choices.find(c => c.repo === repo)?.label ?? repoPath(repo);
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

  const titleOf = useRunTitles(runs);
  const gatesOf = (run: RunSummary) => linked.byRun.get(run.id) ?? NO_GATES;
  const info = (run: RunSummary): EarlierRowInfo => ({
    ticket: ticketOf(run),
    title: titleOf(run),
    href: runHref(run),
    inBoard: view.inBoard.has(run.id),
    aging: agingWarning(run, pruneDays, now),
  });

  const repoName = url.repo
    ? labelOf(url.repo)
    : repos.length === 1
      ? labelOf(repos[0]!)
      : repos.length > 1
        ? `${repos.length} repos`
        : null;

  // A refetch with no data resets the query to pending, so a poll after a
  // failed read would otherwise flash the skeleton.
  const outage =
    runsQuery.isError ||
    (runsQuery.isFetching &&
      runsQuery.errorUpdatedAt > runsQuery.dataUpdatedAt);
  const settled = !runsQuery.isPending && !outage;
  const retry = () => {
    void queryClient.refetchQueries({ queryKey: ['runs'] });
    void queryClient.refetchQueries({ queryKey: ['gates'] });
  };

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
          contentContainerProps={{ maw: 1680, my: 0, px: 40, py: 28 }}
        >
          {height =>
            url.view === 'timeline' ? (
              <div className={classes.page} data-testid="runs-page">
                {outage ? <OutageBanner onRetry={retry} /> : null}
                <TimelineView
                  runs={runs}
                  gates={gates}
                  gatesByRun={linked.byRun}
                  loading={!settled || !linked.loaded}
                  repoName={url.repo ? labelOf(url.repo) : null}
                  now={now}
                  day={url.day}
                  setUrl={setUrl}
                  titleOf={titleOf}
                  height={height}
                />
              </div>
            ) : (
              <div
                className={classes.page}
                data-parity="Content"
                data-testid="runs-page"
              >
                <Group
                  justify="space-between"
                  gap={16}
                  w="100%"
                  data-parity="Title row"
                >
                  <Text
                    fz="lg"
                    fw={500}
                    lh="normal"
                    truncate
                    className={classes.titleBlock}
                    data-parity="sub"
                  >
                    {repoName
                      ? `${repoName} · every pipeline run on this Mac`
                      : 'every pipeline run on this Mac'}
                  </Text>
                  <MattstackShell.AppBar>
                    <Select
                      aria-label="repo"
                      w={200}
                      size="xs"
                      leftSection={<Icon name="gitBranch" size={14} />}
                      value={url.repo ?? ALL_REPOS}
                      data={[
                        { value: ALL_REPOS, label: 'all repos' },
                        ...choices.map(c => ({
                          value: c.repo,
                          label: c.label,
                        })),
                        ...(url.repo && !repos.includes(url.repo)
                          ? [{ value: url.repo, label: labelOf(url.repo) }]
                          : []),
                      ]}
                      onChange={v => setUrl({ repo: v ? v : null })}
                    />
                  </MattstackShell.AppBar>
                  <Group gap={8} wrap="nowrap">
                    <SegmentedControl
                      aria-label="Show"
                      data={FILTERS}
                      value={url.filter}
                      onChange={v => setUrl({ filter: v as RunsFilter })}
                    />
                    <ViewToggle
                      view="lanes"
                      onChange={view => setUrl({ view })}
                    />
                  </Group>
                </Group>

                {outage ? <OutageBanner onRetry={retry} /> : null}

                <StatLine
                  cards={cards}
                  state={
                    outage
                      ? 'unknown'
                      : runsQuery.isPending
                        ? 'loading'
                        : 'ready'
                  }
                />

                {!settled ? <ListSkeleton /> : null}

                {settled && banner ? (
                  <WaitingBanner
                    gate={banner.gate}
                    ticket={ticketOf(banner.run)}
                    title={titleOf(banner.run)}
                    href={`${runHref(banner.run)}#gate-${encodeURIComponent(banner.gate.id)}`}
                    now={now}
                  />
                ) : null}

                {settled && nothingWaiting ? (
                  <EmptyCard
                    title="Nothing is waiting on you."
                    sub="Gates that need your answer show up here."
                  />
                ) : null}

                {settled &&
                lanes &&
                !(url.filter === 'waiting' && lanes.length === 0) ? (
                  <>
                    <Eyebrow c="var(--tk-fg)" fw={600} data-parity="Live label">
                      {`Live · ${lanes.length}`}
                    </Eyebrow>
                    {lanes.length > 0 ? (
                      <div className={classes.lanes} data-parity="Live cards">
                        {lanes.map(run => (
                          <LaneSlot
                            key={run.id}
                            run={run}
                            gates={gatesOf(run)}
                            titleOf={titleOf}
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

                {settled &&
                earlier &&
                !(url.filter === 'waiting' && earlier.length === 0) ? (
                  <>
                    <div className={classes.label}>
                      <Eyebrow
                        c="var(--tk-fg)"
                        fw={600}
                        data-parity="Earlier label"
                      >
                        Earlier
                      </Eyebrow>
                    </div>
                    {groups.length > 0 ? (
                      <EarlierList
                        groups={groups}
                        info={info}
                        now={now}
                        paged
                      />
                    ) : (
                      <EmptyCard
                        title="No earlier runs."
                        sub="Finished runs land here, grouped by day."
                      />
                    )}
                  </>
                ) : null}
              </div>
            )
          }
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );
}
