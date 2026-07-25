import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Stack } from '../core/types.ts';
import { getMaxWorkSlots, getWorktreeMap, ensureWorkSlot } from '../core/worktrees.ts';
import { acquireLease, findLease, listLeases, parkLease, releaseLease } from '../core/leases.ts';
import type { Lease } from '../core/leases.ts';
import { GitShell } from '../core/git-shell.ts';
import type { CliContext } from './context.ts';
import { fail } from './output.ts';

const exec = promisify(execFile);

export async function slotGitDir(slotPath: string): Promise<string> {
  const { stdout } = await exec('git', ['rev-parse', '--absolute-git-dir'], { cwd: slotPath });
  return stdout.trim();
}

/** Per-stack guard: refuse while the stack holds a running or parked lease. */
export async function requireStackFree(ctx: CliContext, stackId: string): Promise<number | null> {
  const lease = await findLease(ctx.commonDir, stackId);
  if (lease) {
    return fail(
      `stack has a ${lease.state} ${lease.action} lease on ${lease.slotPath}; finish it first: gitq continue (or gitq abort)`,
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
        `all ${workSlotCount} work slots are busy (max ${max}); finish or abort a cascade, or raise maxWorkSlots in settings.json`,
      );
    }
    slotPath = await ensureWorkSlot(ctx.repoRoot, ctx.commonDir, map);
  }

  const acquired = await acquireLease(ctx.commonDir, { slotPath, stackId: stack.id, action });
  if (!acquired.ok) {
    const h = acquired.holder;
    return fail(`stack has a ${h.state} ${h.action} lease on ${h.slotPath}; finish it first: gitq continue (or gitq abort)`);
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
