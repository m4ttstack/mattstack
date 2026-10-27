import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  GenericError,
  Paper,
  Stack,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { notifications } from '@mattstack/app-kit/notifications';

import { loadSteps, StepLoader, useStepLoading } from '../StepLoader';
import classes from './ConfigTab.module.css';
import { useReportReady } from './contentReady';
import { UnsyncedActions, useUnsyncedSummary } from './graph/UnsyncedBanner';
import {
  baseCopyWhy,
  computeHealthGroups,
  HealthGroupCard,
  HealthIssueRow,
} from './health';
import { buildSpine } from './outline';
import {
  SurfaceTab,
  type SkillHealth,
  type SurfaceFilterKind,
} from './SurfaceTab';
import {
  syncRefusal,
  useCompositionSnapshot,
  useSkillsCheck,
  useSkillsCompile,
  useSkillsSync,
  useSkillsWriting,
  useSurface,
} from './useWiring';

type Tone = 'ok' | 'warn' | 'bad' | 'quiet';

/** One count on the bar. A count that needs action is a button that filters
    the list to those skills; a zero problem stays faint. */
function Stat({
  count,
  label,
  tone,
  onShow,
}: {
  count: number;
  label: string;
  tone: Tone;
  onShow?: () => void;
}) {
  const live = onShow !== undefined && count > 0;
  const body = (
    <>
      <span className={classes.statDot} data-tone={tone} aria-hidden />
      <span className={classes.statCount}>{count}</span>
      <span className={classes.statLabel}>{label}</span>
    </>
  );
  return live ? (
    <UnstyledButton
      className={classes.stat}
      data-tone={tone}
      data-live
      onClick={onShow}
      data-testid={`config-stat-${tone}`}
    >
      {body}
    </UnstyledButton>
  ) : (
    <span
      className={classes.stat}
      data-faint={(onShow !== undefined && count === 0) || undefined}
      data-testid={`config-stat-${tone}`}
    >
      {body}
    </span>
  );
}

/**
 * The pack's state on one line: how its skills stand, then what Claude has
 * and the one step that moves it on. Compile writes the compiled skills
 * here; Publish shares them and installs them in Claude Code.
 */
function PackStatusBar({
  pack,
  inSync,
  needCompile,
  neverCompiled,
  installed,
  onShowAttention,
  onReview,
}: {
  pack: string;
  inSync: number;
  needCompile: number;
  neverCompiled: number;
  installed: { status: string; version?: string | null } | null | undefined;
  onShowAttention: () => void;
  onReview: () => void;
}) {
  const summary = useUnsyncedSummary(pack);
  const compile = useSkillsCompile(pack);
  const install = useSkillsSync(pack);
  const writing = useSkillsWriting(pack);
  const compiling = needCompile + neverCompiled > 0;

  const runCompile = () =>
    compile
      .mutateAsync()
      .then(report => {
        const failed = report.verbs.find(verb => verb.status === 'errored');
        if (failed)
          notifications.error(
            failed.errors?.[0] ?? `${failed.name} did not compile`
          );
        else notifications.success(`Compiled ${pack}. Publish to share it.`);
      })
      .catch((error: Error) => notifications.error(error.message));

  const runInstall = () =>
    install
      .mutateAsync()
      .then(report => {
        const refusal = syncRefusal(report);
        if (refusal) notifications.error(refusal);
        else
          notifications.success(
            `Installed the latest ${pack}. Run /reload-plugins in open Claude sessions.`
          );
      })
      .catch((error: Error) => notifications.error(error.message));

  return (
    <Paper
      variant="ground"
      withBorder
      radius="xl"
      className={classes.bar}
      data-testid="pack-status"
    >
      <div className={classes.stats}>
        <Stat count={inSync} label="up to date" tone="ok" />
        <Stat
          count={needCompile}
          label="need a compile"
          tone="warn"
          onShow={onShowAttention}
        />
        <Stat
          count={neverCompiled}
          label="never compiled"
          tone="bad"
          onShow={onShowAttention}
        />
      </div>
      <span className={classes.rule} aria-hidden />
      <div className={classes.state}>
        {compiling ? (
          <>
            <span className={classes.stateLine}>
              <Icon name="circleDot" size={15} color="var(--tk-text-warn)" />
              Claude has an older version
            </span>
            <Button
              color="accent"
              size="compact-sm"
              leftSection={<Icon name="fileCog" size={13} />}
              loading={compile.isPending}
              disabled={writing}
              onClick={runCompile}
              data-testid="compile-pack"
            >
              Compile Skill Pack
            </Button>
          </>
        ) : summary ? (
          <>
            <Badge
              variant="tint"
              color="warn"
              leftSection={<span className={classes.pillDot} />}
              className={classes.pill}
            >
              {summary.count} {summary.count === 1 ? 'change' : 'changes'} to
              publish
            </Badge>
            <Button
              variant="subtle"
              color="gray"
              size="compact-sm"
              rightSection={<Icon name="chevronRight" size={12} />}
              onClick={onReview}
            >
              See changes
            </Button>
            <UnsyncedActions pack={pack} publishOnly />
          </>
        ) : installed && installed.status !== 'current' ? (
          <>
            <span className={classes.stateLine}>
              <Icon name="circleDot" size={15} color="var(--tk-text-warn)" />
              Claude has an older version
            </span>
            <Button
              color="accent"
              size="compact-sm"
              leftSection={<Icon name="download" size={13} />}
              loading={install.isPending}
              disabled={writing}
              onClick={runInstall}
              data-testid="install-latest"
            >
              Install latest
            </Button>
          </>
        ) : (
          <span className={classes.stateLine} data-testid="pack-current">
            <Icon name="checkCircle" size={15} color="var(--tk-text-ok)" />
            Claude has the latest version
            {installed?.version && (
              <span className={classes.version}>{installed.version}</span>
            )}
          </span>
        )}
      </div>
    </Paper>
  );
}

/**
 * The pack's configuration in one place: the build health of its skills and
 * its unsynced changes at the top, then which skills agents see, grouped by
 * what they are for. Problems the list cannot show (the parent pack's
 * copies, a pipeline's ignored overrides) follow the strip when there are any.
 */
export function ConfigTab({
  pack,
  onReview,
}: {
  pack: string;
  /** Opens the unsynced changes on the Changes tab. */
  onReview: () => void;
}) {
  const compositionQuery = useCompositionSnapshot(pack);
  const checkQuery = useSkillsCheck(pack);
  const surfaceQuery = useSurface(pack);
  const composition = compositionQuery.data;
  const check = checkQuery.data;
  const [filterKind, setFilterKind] = useState<SurfaceFilterKind>('all');

  // A missing `check` must not read as healthy, so nothing is counted until
  // it answers.
  const groups = useMemo(
    () =>
      composition && check
        ? computeHealthGroups(buildSpine(composition, check, null))
        : null,
    [composition, check]
  );
  const ready = groups !== null && !surfaceQuery.isPending;
  const { show: held, bind: heldBind } = useStepLoading(!ready);
  useReportReady(ready && !held);

  const health = useMemo(() => {
    const map = new Map<string, SkillHealth>();
    if (!groups) return map;
    for (const entry of groups.staleEntries)
      map.set(entry.verb ?? entry.label, 'stale');
    for (const entry of groups.neverCompiledEntries)
      map.set(entry.verb ?? entry.label, 'never-compiled');
    for (const copy of check?.attachments ?? []) {
      if (copy.status === 'stale') map.set(copy.name, 'stale');
      if (copy.status === 'never-compiled')
        map.set(copy.name, 'never-compiled');
    }
    return map;
  }, [groups, check]);

  if (compositionQuery.isError || checkQuery.isError) {
    const failed = compositionQuery.isError ? compositionQuery : checkQuery;
    return (
      <GenericError
        title={
          compositionQuery.isError
            ? "Couldn't load this pack's composition"
            : "Couldn't measure this pack's health"
        }
        message={(failed.error as Error).message}
        onRetry={() => void failed.refetch()}
      />
    );
  }

  if (!ready || held) {
    return (
      <StepLoader
        {...heldBind}
        testId="config-tab-loading"
        steps={loadSteps([
          {
            step: `rt skills composition --pack ${pack}`,
            done: Boolean(composition),
          },
          { step: `rt skills check --pack ${pack}`, done: Boolean(check) },
          {
            step: `rt skills surface list --pack ${pack}`,
            done: Boolean(surfaceQuery.data),
          },
        ])}
      />
    );
  }

  const staleCount = [...health.values()].filter(h => h === 'stale').length;
  const neverCount = health.size - staleCount;
  const showAttention = () => setFilterKind('attention');

  const baseRows = [
    ...(check?.attachments ?? [])
      .filter(copy => copy.status !== 'in-sync')
      .map(copy => ({
        key: `copy:${copy.base ?? ''}:${copy.name}`,
        name: copy.name,
        why: baseCopyWhy(copy),
      })),
    ...(check?.baseErrors ?? []).map((message, i) => ({
      key: `base-error:${i}`,
      name: message,
      why: undefined,
    })),
  ];
  const pipelineRows = [
    ...(check?.staleCopies ?? []).map(name => ({
      key: `stale-copy:${name}`,
      message: `stale stage copy ${name}: run rt skills compile`,
    })),
    ...(check?.droppedOverrides ?? []).map(({ key, layer }) => ({
      key: `dropped:${layer}:${key}`,
      message: `Override ${key} from ${layer} is ignored: a later layer's stage list no longer has that stage`,
    })),
  ];
  // A stale pipeline stage copy is fixed by the same compile as a skill.
  const staleStageCopies = check?.staleCopies?.length ?? 0;

  return (
    <Stack gap={16} data-testid="config-tab">
      <PackStatusBar
        pack={pack}
        inSync={groups.inSyncCount}
        needCompile={staleCount + staleStageCopies}
        neverCompiled={neverCount}
        installed={check?.installed}
        onShowAttention={showAttention}
        onReview={onReview}
      />

      {baseRows.length > 0 && (
        <HealthGroupCard
          title="Org base"
          intent="warn"
          caption="attachments copied from the org base, and base problems"
          entries={baseRows}
          getKey={row => row.key}
          renderRow={row => (
            <HealthIssueRow
              testId={row.key}
              name={row.name}
              reference={null}
              why={row.why}
              wrapName={row.why === undefined}
            />
          )}
        />
      )}

      {pipelineRows.length > 0 && (
        <HealthGroupCard
          title="Pipelines"
          intent="warn"
          caption="stale stage copies, and overrides a pipeline ignores"
          entries={pipelineRows}
          getKey={row => row.key}
          renderRow={row => (
            <HealthIssueRow
              testId={row.key}
              name={row.message}
              reference={null}
              wrapName
            />
          )}
        />
      )}

      <SurfaceTab
        pack={pack}
        health={health}
        filterKind={filterKind}
        onFilterKind={setFilterKind}
      />
    </Stack>
  );
}
