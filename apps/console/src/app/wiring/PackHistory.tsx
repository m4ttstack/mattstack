import { Fragment, lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Collapse,
  PaneResizer,
  Text,
  UnstyledButton,
  usePaneWidth,
} from '@mattstack/app-kit/core';
import { Icon, Icons } from '@mattstack/app-kit/icons';
import { useSearch } from 'wouter';
import { navigate } from 'wouter/use-browser-location';

import { StepLoader, useStepLoading } from '../StepLoader';
import { CommitDiff, filesOf } from './CommitDiff';
import { useConfirmCompile } from './graph/confirmCompile';
import { foldVersionOnly } from './graph/model/foldHistory';
import { UnsyncedActions, useUnsyncedSummary } from './graph/UnsyncedBanner';
import classes from './PackHistory.module.css';
import {
  useCompileDiff,
  useCompileWaiting,
  useCompiling,
  usePendingChanges,
  useSkillsDiff,
  useSkillsHistory,
} from './useWiring';

/** The tree library is heavy and only a picked commit needs it. */
const DiffFileTree = lazy(() => import('./DiffFileTree'));

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'always' });

/**
 * A commit's age in words. `numeric: 'always'` on purpose: "yesterday" and
 * "last month" read as prose beside a sha, and a log is scanned for
 * distance, not for dates.
 *
 * An unparseable stamp answers with the raw text rather than a wrong age --
 * `%aI` cannot produce one, but a truncated read of the log can.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;

  const delta = at - now;
  const ago = Math.abs(delta);
  const [unit, size]: [Intl.RelativeTimeFormatUnit, number] =
    ago < HOUR
      ? ['minute', MINUTE]
      : ago < DAY
        ? ['hour', HOUR]
        : ago < MONTH
          ? ['day', DAY]
          : ago < YEAR
            ? ['month', MONTH]
            : ['year', YEAR];

  if (ago < MINUTE) return 'just now';
  return RELATIVE.format(Math.round(delta / size), unit);
}

/** One diff text for the reader: the base diff's hunks follow the pack's. */
function joinDiffs(diff: string, baseDiff: string | undefined): string {
  if (!baseDiff) return diff;
  return diff === '' || diff.endsWith('\n')
    ? diff + baseDiff
    : `${diff}\n${baseDiff}`;
}

/** The pick that stands for the pack's unsynced changes: the working tree
    against its last commit. */
export const WORKING = 'working';

/** A few skill names, then a count, so a large compile keeps one line. */
function namesOf(skills: string[], shown = 3): string {
  if (skills.length <= shown) return skills.join(', ');
  return `${skills.slice(0, shown).join(', ')} +${skills.length - shown} more`;
}

/** The pick that stands for what the next compile would rewrite. */
export const COMPILE = 'compile';

/** Writes the picked commits or the open file into the live query string. */
export function writeHistoryUrl(change: {
  commits?: string[];
  file?: string | null;
}) {
  const next = new URLSearchParams(window.location.search);
  if (change.commits !== undefined) {
    if (change.commits.length > 0)
      next.set('commits', change.commits.join(','));
    else next.delete('commits');
    next.delete('file');
  }
  if (change.file !== undefined) {
    if (change.file) next.set('file', change.file);
    else next.delete('file');
  }
  const query = next.toString().replace(/%2C/g, ',').replace(/%2F/g, '/');
  navigate(`${window.location.pathname}${query ? `?${query}` : ''}`, {
    replace: true,
  });
}

/** The picked commits and the open file, kept in the query string beside
    the Wiring keys so a compare is a link and both panes read it. */
export function useHistoryUrl() {
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const picks = useMemo(
    () => (params.get('commits') ?? '').split(',').filter(Boolean).slice(0, 2),
    [params]
  );
  const file = params.get('file') || null;
  return { picks, file, write: writeHistoryUrl };
}

/** The range a pick shows: one commit against the one before it in the
    pack's log, or two commits, older first. */
function rangeOf(
  picks: string[],
  commits: { sha: string; shortSha: string }[]
): { from: string; to: string } | null {
  if (picks[0] === WORKING) return { from: 'HEAD', to: WORKING };
  if (picks[0] === COMPILE) return { from: 'HEAD', to: COMPILE };
  const at = picks
    .map(sha => commits.findIndex(c => c.sha === sha))
    .filter(i => i >= 0);
  if (at.length === 0) return null;
  if (at.length === 1) {
    const before = commits[at[0] + 1];
    return before
      ? { from: before.shortSha, to: commits[at[0]].shortSha }
      : null;
  }
  // git lists newest first, so the later index is the older end.
  return {
    from: commits[Math.max(...at)].shortSha,
    to: commits[Math.min(...at)].shortSha,
  };
}

/** The pack's commits, newest first. One click shows that commit's change;
    a second click compares the two. */
export function HistorySidebar({ pack }: { pack: string }) {
  const history = useSkillsHistory(pack, null);
  const { show: held, bind } = useStepLoading(history.isPending);
  const commits = useMemo(() => history.data?.commits ?? [], [history.data]);
  const { picks, write } = useHistoryUrl();
  const summary = useUnsyncedSummary(pack);
  const changesPending = usePendingChanges(pack).isPending;
  const unsynced = summary?.count ?? 0;
  const waiting = useCompileWaiting(pack).data;
  const uncompiled = useMemo(() => new Set(waiting?.commits ?? []), [waiting]);
  const outside = waiting?.outside ?? [];
  const staleSkills = waiting?.skills ?? [];
  const onWorking = picks[0] === WORKING;
  const onCompile = picks[0] === COMPILE;
  const comparing = picks.length === 2;
  // Shas of the folds a reader opened, so an open fold stays open when a
  // pick reshapes the runs around it.
  const [shownFolds, setShownFolds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const toggleFold = (shas: string[], show: boolean) =>
    setShownFolds(shown => {
      const next = new Set(shown);
      for (const sha of shas) {
        if (show) next.add(sha);
        else next.delete(sha);
      }
      return next;
    });
  // A compare runs from the older pick to the newer one; the log lists the
  // newest first, so the newer pick sits higher in it.
  const newerIndex = comparing
    ? Math.min(...picks.map(sha => commits.findIndex(c => c.sha === sha)))
    : -1;

  // The page opens on the unsynced changes when there are any, else on the
  // newest commit's change, rather than on nothing; a sync that empties the
  // working tree moves it on to that commit.
  useEffect(() => {
    // A summary still reading counts as no changes; wait for it.
    if (changesPending) return;
    if (
      picks.length === 0 ||
      (onWorking && unsynced === 0) ||
      (onCompile && waiting !== undefined && staleSkills.length === 0)
    ) {
      if (unsynced > 0) write({ commits: [WORKING] });
      else {
        const opening =
          commits.find(commit => !commit.versionOnly) ?? commits[0];
        if (opening) write({ commits: [opening.sha] });
      }
    }
  }, [
    changesPending,
    picks.length,
    onWorking,
    onCompile,
    waiting,
    staleSkills.length,
    unsynced,
    commits,
    write,
  ]);

  const pick = (sha: string, add: boolean) => {
    // The unsynced changes stand alone: no compare runs to or from them.
    if (onWorking || onCompile) {
      write({ commits: [sha] });
    } else if (picks.includes(sha)) {
      write({ commits: picks.filter(s => s !== sha) });
    } else {
      // Two picks at most: a third replaces the one picked first.
      write({ commits: add ? [...picks.slice(-1), sha] : [sha] });
    }
  };

  // Never folded: both ends of the diff on screen, the newest commit and any
  // commit not compiled yet.
  const range = rangeOf(picks, commits);
  const inView = new Set<string>([
    ...picks,
    ...uncompiled,
    ...(commits[0] ? [commits[0].sha] : []),
    ...(range
      ? commits
          .filter(c => c.shortSha === range.from || c.shortSha === range.to)
          .map(c => c.sha)
      : []),
  ]);

  // Only what a fold would hide folds: a commit kept in view is a row in its
  // own place and splits the run around it.
  const rows = foldVersionOnly(
    commits.map(commit => ({
      sha: commit.sha,
      commit,
      versionOnly: commit.versionOnly && !inView.has(commit.sha),
    }))
  );

  const commitRow = (commit: (typeof commits)[number]) => {
    const i = commits.indexOf(commit);
    const at = picks.indexOf(commit.sha);
    return (
      <UnstyledButton
        key={commit.sha}
        className={classes.row}
        data-selected={at >= 0 || undefined}
        aria-pressed={at >= 0}
        aria-label={`show ${commit.shortSha}`}
        onClick={event => pick(commit.sha, event.shiftKey)}
        data-testid={`commit-${commit.shortSha}`}
      >
        <span className={classes.subject}>{commit.subject}</span>
        <span className={classes.meta}>
          <span className={classes.sha}>{commit.shortSha}</span>
          <span>{relativeTime(commit.authoredAt)}</span>
          {i === 0 && <span>newest</span>}
          {uncompiled.has(commit.sha) && (
            <span
              className={classes.uncompiled}
              data-testid={`uncompiled-${commit.shortSha}`}
            >
              not compiled
            </span>
          )}
          {comparing && at >= 0 && (
            <span className={classes.end}>
              {i === newerIndex ? 'To' : 'From'}
            </span>
          )}
        </span>
      </UnstyledButton>
    );
  };

  return (
    <div className={classes.sidebar} data-testid="history-sidebar">
      <div className={classes.head}>
        <span className={classes.title}>Commits</span>
        {history.data && (
          <span className={classes.count} data-testid="history-count">
            {commits.length}
          </span>
        )}
        {comparing ? (
          <Button
            variant="default"
            size="compact-xs"
            className={classes.clear}
            onClick={() => write({ commits: [] })}
            data-testid="clear-compare"
          >
            Clear compare
          </Button>
        ) : (
          <span className={classes.hint}>⇧-click to compare</span>
        )}
      </div>
      {held ? (
        <div className={classes.pad}>
          <StepLoader {...bind} steps={['git log']} />
        </div>
      ) : history.isError ? (
        <div className={classes.pad}>
          <Alert
            variant="light"
            color="bad"
            icon={<Icons.error size={14} />}
            data-testid="history-error"
          >
            <Text size="xs">{(history.error as Error).message}</Text>
          </Alert>
        </div>
      ) : commits.length === 0 ? (
        <div className={classes.pad}>
          <Text size="xs" c="dimmed" data-testid="history-empty">
            No commit has touched this pack.
          </Text>
        </div>
      ) : (
        <div className={classes.rows} data-testid="commit-list">
          <Collapse
            expanded={unsynced > 0}
            transitionDuration={200}
            animateOpacity
          >
            <UnstyledButton
              className={`${classes.row} ${classes.compile}`}
              data-selected={onWorking || undefined}
              aria-pressed={onWorking}
              onClick={() => write({ commits: [WORKING] })}
              data-testid="commit-working"
            >
              <span className={classes.compileHead}>
                <Icon name="circleDot" size={14} />
                <span className={classes.subject}>Unsynced changes</span>
              </span>
              <span className={classes.meta}>
                <span className={classes.compileSkills}>
                  {unsynced} {unsynced === 1 ? 'change' : 'changes'}
                </span>
                <span>
                  {summary?.trial
                    ? `on ${summary.trial} only`
                    : 'not synced yet'}
                </span>
              </span>
            </UnstyledButton>
          </Collapse>
          <Collapse
            expanded={staleSkills.length > 0}
            transitionDuration={200}
            animateOpacity
          >
            <UnstyledButton
              className={`${classes.row} ${classes.compile}`}
              data-selected={onCompile || undefined}
              aria-pressed={onCompile}
              onClick={() => write({ commits: [COMPILE] })}
              data-testid="compile-waiting"
            >
              <span className={classes.compileHead}>
                <Icon name="fileCog" size={14} />
                <span className={classes.subject}>Waiting for compile</span>
              </span>
              <span className={classes.meta}>
                <span className={classes.compileSkills}>
                  {namesOf(staleSkills)}
                </span>
                {outside.length === 1 ? (
                  <span>
                    {`${outside[0].ref} ${outside[0].builtVersion} → ${outside[0].version}`}
                  </span>
                ) : (
                  outside.length > 1 && (
                    <span>{`${outside.length} plugin sources changed`}</span>
                  )
                )}
                {uncompiled.size > 0 && (
                  <span>
                    {uncompiled.size === 1
                      ? '1 commit below'
                      : `${uncompiled.size} commits below`}
                  </span>
                )}
              </span>
            </UnstyledButton>
          </Collapse>
          {rows.map(row => {
            if (row.kind === 'commit') return commitRow(row.commit.commit);
            const folded = row.commits.map(entry => entry.commit);
            const shas = folded.map(commit => commit.sha);
            const shown = shas.some(sha => shownFolds.has(sha));
            return (
              <Fragment key={`fold-${shas[0]}`}>
                <UnstyledButton
                  className={`${classes.row} ${classes.fold}`}
                  aria-expanded={shown}
                  onClick={() => toggleFold(shas, !shown)}
                  data-testid={`fold-${folded[0]!.shortSha}`}
                >
                  <span className={classes.foldHead}>
                    <Icon
                      name={shown ? 'chevronDown' : 'chevronRight'}
                      size={14}
                    />
                    <span className={classes.foldLabel}>
                      {folded.length} version-only commits
                    </span>
                    <span className={classes.foldToggle}>
                      {shown ? 'Hide' : 'Show'}
                    </span>
                  </span>
                </UnstyledButton>
                {shown && folded.map(commitRow)}
              </Fragment>
            );
          })}
          {history.data?.truncated && (
            <div className={classes.note} data-testid="history-truncated">
              The repo holds more history than this list shows.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Compiles the pack once confirmed, then hands over to the Config tab,
    which shows the compile running and what it left to publish. */
function CompileAction({
  pack,
  skills,
  onStart,
}: {
  pack: string;
  skills: string[];
  onStart?: () => void;
}) {
  const confirm = useConfirmCompile(pack, onStart);
  const running = useCompiling(pack);
  return (
    <Button
      color="warn"
      size="compact-sm"
      leftSection={<Icon name="fileCog" size={13} />}
      loading={running}
      onClick={() => confirm(skills.length)}
      data-testid="compile-from-changes"
    >
      Compile Skill Pack
    </Button>
  );
}

/** The file list beside the diff. */
const TREE_PANE = { initial: 360, min: 240, max: 520 };

/** The commit list in the sidebar. */
export const COMMITS_PANE = { initial: 296, min: 240, max: 480 };

/** The picked change: its files as a tree beside the open file's diff. */
export function HistoryMain({
  pack,
  height,
  onCompile,
}: {
  pack: string;
  height: string;
  /** Called once a compile started here is confirmed. */
  onCompile?: () => void;
}) {
  const history = useSkillsHistory(pack, null);
  const commits = useMemo(() => history.data?.commits ?? [], [history.data]);
  const { picks, file: openPath, write } = useHistoryUrl();
  const range = rangeOf(picks, commits);

  const compiling = range?.to === COMPILE;
  const commitDiff = useSkillsDiff(
    pack,
    compiling ? null : (range?.from ?? null),
    compiling ? null : (range?.to ?? null)
  );
  const compileDiff = useCompileDiff(pack, compiling);
  const diff = compiling ? compileDiff : commitDiff;
  const files = useMemo(
    () =>
      diff.data
        ? filesOf(
            joinDiffs(
              diff.data.diff,
              'baseDiff' in diff.data ? diff.data.baseDiff : undefined
            )
          )
        : [],
    [diff.data]
  );
  const openFile =
    files.find(file => file.path === openPath) ?? files[0] ?? null;
  // The tree builds its model once, so a working diff that reloads with
  // other files or other lines must remount it.
  const rangeKey = range
    ? `${range.from}..${range.to}:${files.map(file => `${file.path}\n${file.patch}`).join('\0')}`
    : null;
  const [treeWidth, setTreeWidth] = usePaneWidth(
    'console-history-tree-width',
    TREE_PANE
  );

  return (
    <div
      className={classes.main}
      style={{
        height,
        gridTemplateColumns: `${treeWidth}px minmax(0, 1fr)`,
      }}
      data-testid="pack-history"
    >
      <PaneResizer
        width={treeWidth}
        onWidth={setTreeWidth}
        bounds={TREE_PANE}
        label="Resize the file list"
        style={{ left: treeWidth - 4 }}
        testId="tree-resizer"
      />
      <div className={classes.files}>
        <div className={classes.head}>
          <span className={classes.title}>Changes</span>
          {diff.data && <span className={classes.count}>{files.length}</span>}
        </div>
        <div className={classes.tree}>
          {range && diff.data && files.length > 0 && (
            <Suspense fallback={null}>
              <DiffFileTree
                key={rangeKey}
                files={files}
                selected={openFile?.path ?? null}
                onSelect={path => write({ file: path })}
              />
            </Suspense>
          )}
        </div>
      </div>
      <div className={classes.diff}>
        {range ? (
          <CommitDiff
            from={range.from}
            to={range.to}
            title={
              range.to === WORKING
                ? 'Unsynced changes'
                : compiling
                  ? 'Waiting for compile'
                  : undefined
            }
            actions={
              range.to === WORKING ? (
                <UnsyncedActions pack={pack} />
              ) : compiling && compileDiff.data ? (
                <CompileAction
                  pack={pack}
                  skills={compileDiff.data.skills}
                  onStart={onCompile}
                />
              ) : null
            }
            files={files}
            file={openFile}
            truncated={diff.data?.truncated ?? false}
            isPending={diff.isPending}
            error={diff.isError ? (diff.error as Error).message : null}
          />
        ) : (
          <div className={classes.empty} data-testid="compare-hint">
            {picks.length > 0
              ? 'This is the oldest commit the log holds, so there is nothing before it to compare.'
              : 'Pick a commit to see its change.'}
          </div>
        )}
      </div>
    </div>
  );
}
