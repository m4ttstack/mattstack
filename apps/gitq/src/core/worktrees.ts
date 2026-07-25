import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { GitShell } from './git-shell.ts';
import { getSettingsFilePath, repoHash } from './config-paths.ts';
import { readJson } from './json-store.ts';

export interface SlotInfo {
  path: string;
  /** Directory basename, the human-facing slot name. */
  name: string;
  head: string;
  branch: string | null;
  dirty: boolean;
  rebaseInProgress: boolean;
  isWorkSlot: boolean;
  isPrimary: boolean;
}

const WORK_SLOT_RE = /^gitq-\d+$/;

/** Enumerate every worktree with the state the pool policy needs. */
export async function getWorktreeMap(anyCwd: string): Promise<SlotInfo[]> {
  const raw = await GitShell.worktreeList(anyCwd);
  const out: SlotInfo[] = [];
  for (let i = 0; i < raw.length; i++) {
    const wt = raw[i]!;
    const dirty = await GitShell.isDirty(wt.path).catch(() => true);
    const rebaseInProgress = GitShell.isRebaseInProgress(wt.path);
    out.push({
      path: wt.path,
      name: basename(wt.path),
      head: wt.head,
      branch: wt.branch,
      dirty,
      rebaseInProgress,
      isWorkSlot: WORK_SLOT_RE.test(basename(wt.path)),
      isPrimary: i === 0,
    });
  }
  return out;
}

/** The non-work slot that has `branch` checked out, if any. */
export function findSlotForBranch(map: SlotInfo[], branch: string): SlotInfo | undefined {
  return map.find((s) => !s.isWorkSlot && s.branch === branch);
}

/**
 * Where work slots live for this repo: a sibling of the primary worktree when
 * the repo is a pool (some other worktree shares the primary's parent dir),
 * else an out-of-tree cache dir.
 */
export function workSlotRoot(commonDir: string, map: SlotInfo[]): string {
  const primary = map.find((s) => s.isPrimary);
  if (primary) {
    const parent = dirname(primary.path);
    const pooled = map.some((s) => !s.isPrimary && !s.isWorkSlot && dirname(s.path) === parent);
    if (pooled) return parent;
  }
  return join(homedir(), '.cache', 'gitq', 'work', repoHash(commonDir));
}

/**
 * Return a free work slot (detached, no rebase in progress), creating
 * `gitq-<next>` when none exists. The CALLER enforces the lease cap; this
 * only provisions.
 */
export async function ensureWorkSlot(anyCwd: string, commonDir: string, map: SlotInfo[]): Promise<string> {
  const free = map.find((s) => s.isWorkSlot && s.branch === null && !s.rebaseInProgress);
  if (free) {
    await GitShell.disableWorktreeHooks(free.path);
    return free.path;
  }
  const root = workSlotRoot(commonDir, map);
  const used = new Set(map.filter((s) => s.isWorkSlot).map((s) => s.name));
  let n = 1;
  while (used.has(`gitq-${n}`)) n++;
  const path = join(root, `gitq-${n}`);
  await GitShell.worktreeAddDetached(anyCwd, path, 'HEAD');
  await GitShell.disableWorktreeHooks(path);
  return path;
}

/** Settings-controlled cap on work slots per repo. */
export async function getMaxWorkSlots(): Promise<number> {
  const settings = await readJson<{ maxWorkSlots?: number }>(getSettingsFilePath(), {});
  const n = settings.maxWorkSlots;
  return typeof n === 'number' && n >= 1 ? Math.floor(n) : 3;
}
