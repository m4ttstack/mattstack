import * as path from 'path';
import { existsSync, realpathSync } from 'fs';
import { isPickableWorktree, type WorktreePickerRow } from '@mattstack/rt-client';
import type { WorktreeEntry } from './types';

export type PickerGroup = NonNullable<WorktreePickerRow['group']>;

export interface OrderedWorktree extends WorktreeEntry {
  group: PickerGroup | null;
}

function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * The daemon's rows are rt cd's own order and groups; this only marks the
 * window's tree current. Never sort here: the order is rt's to decide.
 */
export function fromPickerRows(
  rows: WorktreePickerRow[],
  currentRoot: string,
  real: (p: string) => string = safeRealpath,
): OrderedWorktree[] {
  const current = real(currentRoot);
  return rows.map((r) => ({
    dirPath: r.path,
    name: path.basename(r.path),
    branch: r.branch,
    isCurrent: real(r.path) === current,
    group: r.group,
  }));
}

/**
 * With the daemon down there is no rt order to show, so this keeps git's own
 * order, ungrouped, through rt-client's shared pickable rule. The window's own
 * tree always stays so the picker can mark it current.
 */
export function fallbackWorktrees(
  entries: WorktreeEntry[],
  exists: (p: string) => boolean = existsSync,
): OrderedWorktree[] {
  return entries
    .filter((wt, i) => wt.isCurrent || isPickableWorktree({ path: wt.dirPath, branch: wt.branch }, i === 0 ? () => true : exists))
    .map((wt) => ({ ...wt, group: null }));
}

/**
 * A row's PR/MR part. With no ticket title to show, the PR's own title fills
 * in, minus a leading "<ticket id>:" the row already shows.
 */
export function prDetail(short: string, prTitle: string | null, linearId: string | null, maxLen: number): string {
  let title = prTitle?.trim() ?? '';
  if (linearId && title.toUpperCase().startsWith(`${linearId.toUpperCase()}:`)) {
    title = title.slice(linearId.length + 1).trim();
  }
  if (!title) return `$(git-pull-request) ${short}`;
  if (maxLen > 0 && title.length > maxLen) title = title.slice(0, maxLen - 1) + '…';
  return `$(git-pull-request) ${short}: ${title}`;
}

export const UNGROUPED_LABEL = "git order: rt's order needs the rt daemon";

export type PickerSlot =
  | { kind: 'tree'; tree: OrderedWorktree }
  | { kind: 'separator'; label: string };

/**
 * The window's tree pinned on top (the extension's one difference from rt
 * cd), then the rest in the order given, with a labelled separator wherever
 * the recency group changes.
 */
export function pickerLayout(trees: OrderedWorktree[], grouped: boolean): PickerSlot[] {
  const slots: PickerSlot[] = [];
  const current = trees.find((t) => t.isCurrent);
  if (current) {
    slots.push({ kind: 'tree', tree: current });
    slots.push({ kind: 'separator', label: grouped ? '' : UNGROUPED_LABEL });
  } else if (!grouped) {
    slots.push({ kind: 'separator', label: UNGROUPED_LABEL });
  }
  let group: PickerGroup | null = null;
  for (const t of trees) {
    if (t.isCurrent) continue;
    if (t.group && t.group !== group) slots.push({ kind: 'separator', label: t.group });
    group = t.group ?? group;
    slots.push({ kind: 'tree', tree: t });
  }
  return slots;
}

/**
 * Parse `git worktree list --porcelain` into WorktreeEntry[].
 *
 * Porcelain is used instead of the human-readable `git worktree list` format
 * because the latter can't be reliably matched: detached worktrees render as
 * "(detached HEAD)" with no `[branch]`, and git appends annotations like
 * `locked`/`prunable` after the branch. The previous regex required a trailing
 * `[branch]`, so it silently dropped every detached worktree (e.g. warm-pool
 * entries that haven't been assigned a branch yet). Porcelain emits one stable
 * key/value record per worktree, so each kind round-trips losslessly.
 *
 * `currentFolder` is the basename of the active workspace's repo root; the
 * entry whose directory basename matches is flagged `isCurrent`.
 */
export function parseWorktreePorcelain(stdout: string, currentFolder: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let dirPath: string | null = null;
  let branch: string | null = null;
  let bare = false;

  const flush = () => {
    // Skip the bare main-repo entry — it has no working tree to open.
    if (dirPath && !bare) {
      const name = path.basename(dirPath);
      entries.push({ dirPath, name, branch, isCurrent: name === currentFolder });
    }
    dirPath = null;
    branch = null;
    bare = false;
  };

  for (const line of stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush();
      dirPath = line.slice('worktree '.length).trim();
    } else if (line.startsWith('branch ')) {
      branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
    } else if (line === 'bare') {
      bare = true;
    }
    // A `detached` line leaves branch = null, which is exactly what we want.
  }
  flush();

  return entries;
}
