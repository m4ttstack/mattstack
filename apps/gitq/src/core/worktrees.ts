import { basename, dirname, join } from 'node:path';
import { getSetting } from '@mattstack/rt-client';
import { GitShell } from './git-shell.ts';
import { getSettingsFilePath, getWorkSlotRoot, repoHash } from './config-paths.ts';
import { readJson } from './json-store.ts';

type GetSettingFn = typeof getSetting;

interface WorkSlotsSetting {
  maxWorkSlots?: number;
  workSlotLocation?: string;
}

/**
 * `gitq.workSlots` off the settings store, or `undefined` when the store
 * doesn't own it (unset, or the resolver threw -- an unreadable/malformed
 * store file, never the daemon). `undefined` is the ownership signal each
 * field below falls back to settings.json on; a thrown error degrades the
 * same way after one warning rather than crashing slot provisioning.
 */
function storeWorkSlots(resolve: GetSettingFn): WorkSlotsSetting | undefined {
  try {
    return resolve<WorkSlotsSetting>('gitq.workSlots').value;
  } catch (err) {
    console.warn('gitq: gitq.workSlots unavailable, falling back to settings.json', err);
    return undefined;
  }
}

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

/**
 * The worktree that has `branch` checked out, if any.
 *
 * Work slots count. gitq always leaves its own slots detached, so a `gitq-N`
 * directory sitting on a branch is one a human ran `git checkout` in, and every
 * caller here is about to move that branch's ref. Skipping it moved the ref and
 * left that tree and index holding the old content, with the command exiting 0.
 *
 * A human worktree wins when both hold the branch: its refusal can tell the
 * user to work from there, which is never advice worth giving about a slot gitq
 * leases out from under them.
 */
export function findSlotForBranch(map: SlotInfo[], branch: string): SlotInfo | undefined {
  const holders = map.filter((s) => s.branch === branch);
  return holders.find((s) => !s.isWorkSlot) ?? holders[0];
}

/**
 * Name a worktree in a refusal.
 *
 * Says "work slot" for gitq's own, since the two get different advice: a human
 * worktree can be worked from, a slot can only be freed.
 */
export function describeSlot(slot: SlotInfo): string {
  return `${slot.isWorkSlot ? 'work slot' : 'slot'} "${slot.name}" (${slot.path})`;
}

/** Settings-controlled placement policy for new work slots. */
export type WorkSlotLocation = 'auto' | 'root';

/**
 * Where work slots live for this repo.
 *
 * Under `auto`, a pool (some other non-slot worktree shares the primary's
 * parent dir) puts slots alongside those worktrees, and anything else puts
 * them out of tree under the configured work-slot root. `root` skips the pool
 * detection entirely and always uses the out-of-tree root: a clone that sits
 * directly in a directory of unrelated repos reads as a pool the moment it
 * gains one sibling worktree, and `gitq-1` appearing among those repos is not
 * what everyone wants.
 */
export function workSlotRoot(commonDir: string, map: SlotInfo[], location: WorkSlotLocation = 'auto'): string {
  const primary = map.find((s) => s.isPrimary);
  if (location === 'auto' && primary) {
    const parent = dirname(primary.path);
    const pooled = map.some((s) => !s.isPrimary && !s.isWorkSlot && dirname(s.path) === parent);
    if (pooled) return parent;
  }
  return join(getWorkSlotRoot(), repoHash(commonDir));
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
  const root = workSlotRoot(commonDir, map, await getWorkSlotLocation());
  const used = new Set(map.filter((s) => s.isWorkSlot).map((s) => s.name));
  let n = 1;
  while (used.has(`gitq-${n}`)) n++;
  const path = join(root, `gitq-${n}`);
  await GitShell.worktreeAddDetached(anyCwd, path, 'HEAD');
  await GitShell.disableWorktreeHooks(path);
  return path;
}

/**
 * Settings-controlled placement policy: `root` forces every new slot under the
 * work-slot root, `auto` (the default, and what anything unrecognised falls
 * back to) keeps the pool-aware placement.
 */
export async function getWorkSlotLocation(resolve: GetSettingFn = getSetting): Promise<WorkSlotLocation> {
  const fileSettings = await readJson<{ workSlotLocation?: string }>(getSettingsFilePath(), {});
  const location = storeWorkSlots(resolve)?.workSlotLocation ?? fileSettings.workSlotLocation;
  return location === 'root' ? 'root' : 'auto';
}

/** Settings-controlled cap on work slots per repo. */
export async function getMaxWorkSlots(resolve: GetSettingFn = getSetting): Promise<number> {
  const fileSettings = await readJson<{ maxWorkSlots?: number }>(getSettingsFilePath(), {});
  const n = storeWorkSlots(resolve)?.maxWorkSlots ?? fileSettings.maxWorkSlots;
  return typeof n === 'number' && n >= 1 ? Math.floor(n) : 3;
}
