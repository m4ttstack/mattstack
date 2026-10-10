import { existsSync, realpathSync } from 'fs';
import { join, relative } from 'path';

import { rtCommand } from '@mattstack/rt-client';
import { git } from '../edge/source.ts';
import type { AppRecord } from '../registry/records.ts';
import { readyMarker } from './setup.ts';

/** Mirrors rt-client's WorktreeTreeRow, which the package does not export. */
export interface TreeRow {
  path: string;
  branch: string | null;
  kind: string;
  state: string | null;
  repoName: string;
  readyAt?: string | null;
  lastActiveAt?: string | null;
}

export interface LiveSource {
  path: string;
  branch: string | null;
  main: boolean;
  needsSetup: boolean;
  lastActiveAt: string | null;
}

export interface SourcesDeps {
  listTrees?: () => Promise<TreeRow[]>;
  exists?: (path: string) => boolean;
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function gitLine(args: string[], dir: string): string | null {
  try {
    const r = git(args, dir);
    return r.code === 0 ? r.stdout.trim() || null : null;
  } catch {
    return null;
  }
}

export function sharedRootFor(record: AppRecord): string | null {
  const dir = record.dev?.workingDirectory;
  if (!dir || !existsSync(dir)) return null;
  const top = gitLine(['rev-parse', '--show-toplevel'], dir);
  return top ? real(top) : null;
}

export function appDirIn(
  record: AppRecord,
  root: string,
  sharedRoot: string
): string | null {
  const linked = record.dev?.workingDirectory;
  if (!linked) return null;
  return join(root, relative(sharedRoot, real(linked)));
}

export function branchOf(root: string): string | null {
  if (!existsSync(root)) return null;
  const branch = gitLine(['rev-parse', '--abbrev-ref', 'HEAD'], root);
  return branch === 'HEAD' ? null : branch;
}

async function defaultListTrees(): Promise<TreeRow[]> {
  const res = await rtCommand<{ trees: TreeRow[] }>('worktree:list', {});
  if (!res.ok || !res.data)
    throw new Error(res.error ?? 'rt worktree list failed');
  return res.data.trees;
}

/** Claimed and hand-made trees only: rt hands its spare trees out, so one
    picked here could change hands mid-session. */
function pickable(t: TreeRow): boolean {
  return (
    (t.kind === 'ephemeral' && t.state === 'claimed') || t.kind === 'unmanaged'
  );
}

export async function listLiveSources(
  sharedRoot: string,
  deps: SourcesDeps = {}
): Promise<{ sources: LiveSource[]; error: string | null }> {
  const exists = deps.exists ?? existsSync;
  const main: LiveSource = {
    path: sharedRoot,
    branch: branchOf(sharedRoot),
    main: true,
    needsSetup: false,
    lastActiveAt: null,
  };
  let trees: TreeRow[];
  try {
    trees = await (deps.listTrees ?? defaultListTrees)();
  } catch (err) {
    return {
      sources: [main],
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const repo = trees.find(t => real(t.path) === sharedRoot)?.repoName;
  const worktrees = trees
    .filter(
      t =>
        repo !== undefined &&
        t.repoName === repo &&
        real(t.path) !== sharedRoot &&
        pickable(t)
    )
    .map(t => ({
      path: real(t.path),
      branch: t.branch,
      main: false,
      needsSetup: !t.readyAt && !exists(readyMarker(t.path)),
      lastActiveAt: t.lastActiveAt ?? null,
    }))
    .sort((a, b) => (b.lastActiveAt ?? '').localeCompare(a.lastActiveAt ?? ''));
  return { sources: [main, ...worktrees], error: null };
}
