import { existsSync, realpathSync } from 'fs';
import { join, relative } from 'path';

import { listPickableWorktrees, listWorktreeRows } from '@mattstack/rt-client';
import { git } from '../edge/source.ts';
import type { AppRecord } from '../registry/records.ts';
import { readyMarker } from './setup.ts';

/** The `worktree:list` fields deck reads. */
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
  list?: () => Promise<TreeRow[]>;
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
  let rows: TreeRow[];
  try {
    rows = await (
      deps.list ?? (listWorktreeRows as () => Promise<TreeRow[]>)
    )();
  } catch (err) {
    return {
      sources: [main],
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const repo = rows.find(t => real(t.path) === sharedRoot)?.repoName;
  if (repo === undefined) return { sources: [main], error: null };
  const { trees } = await listPickableWorktrees(repo, {
    list: async () => rows,
    exists,
  });
  const worktrees = trees
    .filter(t => real(t.path) !== sharedRoot)
    .map(t => ({
      path: real(t.path),
      branch: t.branch,
      main: false,
      needsSetup: !t.readyAt && !exists(readyMarker(t.path)),
      lastActiveAt: t.lastActiveAt ?? null,
    }));
  return { sources: [main, ...worktrees], error: null };
}
