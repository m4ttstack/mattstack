import { lazy, Suspense, type ReactNode } from 'react';
import { Alert, Text } from '@mattstack/app-kit/core';
import { Icons } from '@mattstack/app-kit/icons';

import { StepLoader, useStepLoading } from '../StepLoader';
import classes from './CommitDiff.module.css';

/** The highlighter is heavy and only a picked range needs it. */
const PatchView = lazy(() => import('./PatchView'));

export interface DiffFile {
  path: string;
  /** This file's own `diff --git` section, headers included. */
  patch: string;
  added: number;
  removed: number;
}

const FILE_START = 'diff --git ';

/** The diff cut into one patch per file, in the diff's own order. */
export function filesOf(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let lines: string[] = [];
  const close = () => {
    if (lines.length === 0) return;
    const header = lines.find(line => line.startsWith('+++ '));
    const old = lines.find(line => line.startsWith('--- '));
    const named = header && !header.endsWith('/dev/null') ? header : old;
    const path = (named ?? lines[0].slice(FILE_START.length))
      .replace(/^(\+\+\+|---) /, '')
      .replace(/^[ab]\//, '')
      .split('\t')[0];
    const body = lines.slice(lines.findIndex(line => line.startsWith('@@')));
    files.push({
      path,
      patch: `${lines.join('\n')}\n`,
      added: body.filter(l => l.startsWith('+') && !l.startsWith('+++ '))
        .length,
      removed: body.filter(l => l.startsWith('-') && !l.startsWith('--- '))
        .length,
    });
    lines = [];
  };
  for (const line of diff.split('\n')) {
    if (line.startsWith(FILE_START)) close();
    if (line.startsWith(FILE_START) || lines.length > 0) lines.push(line);
  }
  close();
  return files;
}

export interface CommitDiffProps {
  from: string;
  to: string;
  /** A name for the range in place of its two ends. */
  title?: string;
  /** Controls at the head's end, for a range a person can act on. */
  actions?: ReactNode;
  files: DiffFile[];
  /** The file the tree has open; null while the diff loads. */
  file: DiffFile | null;
  truncated: boolean;
  isPending: boolean;
  error: string | null;
}

/** The open file of a range, drawn by the diff renderer under its own file
    header, the way the board shows a review. */
export function CommitDiff({
  from,
  to,
  title,
  actions = null,
  files,
  file,
  truncated,
  isPending,
  error,
}: CommitDiffProps) {
  const { show: held, bind: heldBind } = useStepLoading(isPending);

  return (
    <div className={classes.panel} data-testid="commit-diff">
      <div className={classes.head}>
        <span className={classes.range}>{title ?? `${from} → ${to}`}</span>
        {!held && !error && (
          <span className={classes.count}>
            {files.length} {files.length === 1 ? 'file' : 'files'} changed
          </span>
        )}
        {actions && <span className={classes.actions}>{actions}</span>}
      </div>
      <div className={classes.body}>
        {held ? (
          <StepLoader
            {...heldBind}
            testId="compare-loading"
            steps={[title ? `git diff ${from}` : `git diff ${from}..${to}`]}
          />
        ) : error ? (
          <Alert
            variant="light"
            color="bad"
            icon={<Icons.error size={14} />}
            data-testid="compare-error"
          >
            <Text size="xs">{error}</Text>
          </Alert>
        ) : files.length === 0 ? (
          <Text size="sm" c="dimmed" data-testid="compare-empty">
            Nothing changed between these two commits.
          </Text>
        ) : (
          file && (
            <div className={classes.patch} key={file.path}>
              <Suspense fallback={null}>
                <PatchView patch={file.patch} path={file.path} />
              </Suspense>
            </div>
          )
        )}
        {truncated && !held && (
          <Text size="xs" c="dimmed" data-testid="compare-truncated">
            The diff was longer than this reads and was cut.
          </Text>
        )}
      </div>
    </div>
  );
}
