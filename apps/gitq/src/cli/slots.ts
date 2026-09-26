import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Stack } from '../core/types.ts';
import { getMaxWorkSlots, getWorktreeMap, ensureWorkSlot } from '../core/worktrees.ts';
import { GitShell } from '../core/git-shell.ts';
import { acquireLease, findLease, listLeases, parkLease, releaseLease } from '../core/leases.ts';
import type { Lease } from '../core/leases.ts';
import type { CliContext } from './context.ts';
import { fail } from './output.ts';
import { readPause } from './pause-file.ts';

const exec = promisify(execFile);

export async function slotGitDir(slotPath: string): Promise<string> {
  const { stdout } = await exec('git', ['rev-parse', '--absolute-git-dir'], { cwd: slotPath });
  return stdout.trim();
}

/**
 * What is actually blocking, appended to a held-lease refusal.
 *
 * `pauseInfo` is printed once, when the cascade pauses, and never again: a
 * later command only learns a lease is held. Recovering the conflict list
 * then meant still having that first output, or going into the slot and
 * working it out by hand. The pause file is right there next to the lease,
 * so read it and say. Best-effort by design — a running (unpaused) lease has
 * no pause file, and a refusal is not the place to fail over a missing one.
 */
export async function pausedDetail(slotPath: string): Promise<string> {
  try {
    const pause = await readPause(await slotGitDir(slotPath));
    const info = pause?.pauseInfo;
    if (!info) return '';
    const files = info.conflictTypes?.length
      ? info.conflictTypes.map((c) => `${c.type} ${c.file}`)
      : (info.conflictFiles ?? []);
    if (files.length === 0) return `\n  paused on ${info.currentBranch}`;
    return (
      `\n  paused on ${info.currentBranch}, ${files.length} conflict${files.length > 1 ? 's' : ''}:` +
      files.map((f) => `\n    ${f}`).join('')
    );
  } catch {
    return '';
  }
}

/** Per-stack guard: refuse while the stack holds a running or parked lease. */
export async function requireStackFree(ctx: CliContext, stackId: string): Promise<number | null> {
  const lease = await findLease(ctx.commonDir, stackId);
  if (lease) {
    return fail(
      `stack has a ${lease.state} ${lease.action} lease on ${lease.slotPath}; finish it first: gitq continue (or gitq abort)` +
        (await pausedDetail(lease.slotPath)),
    );
  }
  return null;
}

/**
 * Acquire a work slot for a cascade, run fn in it, then park (exit 2) or
 * release the lease. Slot provisioning respects maxWorkSlots.
 */
export async function withLeasedSlot(
  ctx: CliContext,
  stack: Stack,
  action: string,
  fn: (workDir: string) => Promise<number>,
): Promise<number> {
  const map = await getWorktreeMap(ctx.repoRoot);
  const leases = await listLeases(ctx.commonDir);
  const leasedPaths = new Set(leases.map((l) => l.slotPath));
  const free = map.find((s) => s.isWorkSlot && s.branch === null && !s.rebaseInProgress && !leasedPaths.has(s.path));

  let slotPath: string;
  if (free) {
    slotPath = free.path;
  } else {
    const workSlotCount = map.filter((s) => s.isWorkSlot).length;
    const max = await getMaxWorkSlots();
    if (workSlotCount >= max && leasedPaths.size >= workSlotCount) {
      return fail(
        `all ${workSlotCount} work slots are busy (max ${max}); finish or abort a cascade, or raise maxWorkSlots -- ` +
          `rt settings explain gitq.workSlots first, then rt settings set gitq.workSlots '{"maxWorkSlots":N,...}' ` +
          `--scope machine (it replaces the whole value, so keep any workSlotLocation you already have) ` +
          `(or, until gitq.workSlots is imported, edit maxWorkSlots in settings.json)`,
      );
    }
    slotPath = await ensureWorkSlot(ctx.repoRoot, ctx.commonDir, map);
  }

  // Heal hooks on every acquisition: the free-slot fast path above skips
  // ensureWorkSlot, and pre-existing slots may predate hook disabling.
  await GitShell.disableWorktreeHooks(slotPath);

  const acquired = await acquireLease(ctx.commonDir, { slotPath, stackId: stack.id, action });
  if (!acquired.ok) {
    const h = acquired.holder;
    return fail(
      `stack has a ${h.state} ${h.action} lease on ${h.slotPath}; finish it first: gitq continue (or gitq abort)` +
        (await pausedDetail(h.slotPath)),
    );
  }

  let code: number;
  try {
    code = await fn(slotPath);
  } catch (err) {
    await releaseLease(ctx.commonDir, stack.id);
    throw err;
  }
  if (code === 2) {
    await parkLease(ctx.commonDir, stack.id);
  } else {
    await releaseLease(ctx.commonDir, stack.id);
  }
  return code;
}

export async function worktreesForJson(ctx: CliContext) {
  const [map, leases] = await Promise.all([getWorktreeMap(ctx.repoRoot), listLeases(ctx.commonDir)]);
  return map.map((s) => {
    const lease = leases.find((l) => l.slotPath === s.path) ?? null;
    return {
      path: s.path,
      name: s.name,
      branch: s.branch,
      dirty: s.dirty,
      isWorkSlot: s.isWorkSlot,
      lease: lease ? { stackId: lease.stackId, action: lease.action, state: lease.state } : null,
    };
  });
}

/** Resolve the parked lease to operate on (for continue/abort from anywhere). */
export async function findParkedLease(ctx: CliContext, stackId?: string): Promise<
  { lease: Lease } | { error: string }
> {
  const leases = (await listLeases(ctx.commonDir)).filter((l) => l.state === 'parked');
  if (stackId) {
    const match = leases.find((l) => l.stackId === stackId);
    return match ? { lease: match } : { error: 'no parked cascade for that stack' };
  }
  if (leases.length === 0) return { error: 'nothing to continue (no parked cascade)' };
  if (leases.length > 1) return { error: 'multiple parked cascades; pass --stack to pick one' };
  return { lease: leases[0]! };
}
