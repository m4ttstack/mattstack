/**
 * Which worktrees a person can pick: the one rule rt's pickers and deck's
 * live-mode source list share, so every app offers the same trees.
 */

import { existsSync } from "fs";
import { basename } from "path";

import type { WorktreeTreeRow } from "./commands.ts";
import { rtCommand } from "./transport.ts";

/** Marks a directory as rt's to delete. Nothing without this prefix is ever reaped. */
export const TRASH_PREFIX = ".trash-";

/**
 * The retention store: disposed trees live here (RT-51), stripped of
 * reinstallables, until the reconciler ages them out. A sibling of the pool
 * root the tree itself lived in (see retainedTrashRoot), so it always shares
 * the tree's volume; the name deliberately lacks the trailing dash so the
 * crash-leftover sweep's `.trash-` prefix match never descends into it.
 */
export const RETAIN_DIR = ".trash";

/**
 * Whether `path` sits inside the trash: under a `.trash/` retention store or a
 * `.trash-*` crash leftover. Dispose's rename and its `git worktree prune` are
 * two steps, so git (and any snapshot built from it) can briefly still carry a
 * trashed tree; every worktree enumeration a picker reads must drop these.
 */
export function isTrashPath(path: string): boolean {
  return path.split("/").some((seg) => seg === RETAIN_DIR || seg.startsWith(TRASH_PREFIX));
}

export interface PickableWorktreeRow {
  path: string;
  branch?: string | null;
  kind?: string;
  state?: string | null;
  repoName?: string;
  lastActiveAt?: string | null;
}

/**
 * Rows from git carry no `kind` and get only the path and branch rules. A
 * registry row is pickable only when it is the main checkout, a tree rt does
 * not manage, or a claimed ephemeral tree: a spare could be handed to someone
 * else mid-session, and a golden or disposable tree is rt's own.
 */
export function isPickableWorktree(
  row: PickableWorktreeRow,
  exists: (path: string) => boolean = existsSync,
): boolean {
  if (isTrashPath(row.path)) return false;
  if (row.branch?.startsWith("on-deck/")) return false;
  // gitq's recognition contract for its work slots is the basename; their roots have moved twice.
  if (/^gitq-\d+$/.test(basename(row.path))) return false;
  if (row.kind !== undefined) {
    const kept =
      row.kind === "main" || row.kind === "unmanaged" || (row.kind === "ephemeral" && row.state === "claimed");
    if (!kept) return false;
  }
  return exists(row.path);
}

export type PickableSort = "recent" | "name";

export interface ListPickableOpts<T extends PickableWorktreeRow> {
  sort?: PickableSort;
  exists?: (path: string) => boolean;
  list?: (repoName: string) => Promise<T[]>;
}

/** The daemon's `worktree:list` rows for one repo; throws the daemon's error. */
export async function listWorktreeRows(repoName?: string): Promise<WorktreeTreeRow[]> {
  const res = await rtCommand<{ trees: WorktreeTreeRow[] }>("worktree:list", repoName ? { repoName } : {});
  if (!res.ok || !res.data) throw new Error(res.error ?? "rt could not list worktrees");
  return res.data.trees;
}

function nameOf(row: PickableWorktreeRow): string {
  return row.branch || basename(row.path);
}

/** A repo's pickable trees, main first. A daemon failure is an `error`, never a throw. */
export async function listPickableWorktrees<T extends PickableWorktreeRow = WorktreeTreeRow>(
  repoName: string,
  opts: ListPickableOpts<T> = {},
): Promise<{ trees: T[]; error: string | null }> {
  const list = opts.list ?? (listWorktreeRows as unknown as (repoName: string) => Promise<T[]>);
  let rows: T[];
  try {
    rows = await list(repoName);
  } catch (err) {
    return { trees: [], error: err instanceof Error ? err.message : String(err) };
  }
  const kept = rows.filter(
    (r) => (r.repoName === undefined || r.repoName === repoName) && isPickableWorktree(r, opts.exists),
  );
  const main = kept.filter((r) => r.kind === "main");
  const rest = kept.filter((r) => r.kind !== "main");
  if (opts.sort === "name") {
    rest.sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: "base" }));
  } else {
    rest.sort((a, b) => (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? ""));
  }
  return { trees: [...main, ...rest], error: null };
}
