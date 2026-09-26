import { join } from 'node:path';
import { readJson, writeJsonAtomic } from './json-store.ts';
import { withFileLock } from './lockfile.ts';

export interface Lease {
  slotPath: string;
  stackId: string;
  action: string;
  pid: number;
  acquiredAt: number;
  state: 'running' | 'parked';
}

interface LeaseFile {
  leases: Lease[];
}

function leasesPath(commonDir: string): string {
  return join(commonDir, 'gitq', 'leases.json');
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function withRegistry<T>(
  commonDir: string,
  fn: (file: LeaseFile) => Promise<{ file: LeaseFile; result: T }>,
): Promise<T> {
  const path = leasesPath(commonDir);
  return withFileLock(path, async () => {
    const file = await readJson<LeaseFile>(path, { leases: [] });
    const { file: next, result } = await fn(file);
    await writeJsonAtomic(path, next);
    return result;
  });
}

/**
 * The leases that still bind, which is not everything the file holds.
 *
 * A RUNNING lease whose holder pid is gone binds nobody: the process that
 * would have released it died without doing so. Filtering here rather than at
 * each call site is deliberate... `acquireLease` already reaped these, but it
 * is the one path a caller cannot reach, because `requireStackFree` refuses
 * through {@link findLease} first and returns. So the reaper sat behind the
 * guard it was meant to unstick, and a dead lease deadlocked the stack against
 * two remedies that only ever looked at parked leases (MAT-78).
 *
 * A PARKED lease is exempt, and not as an edge case: a parked cascade exited on
 * purpose waiting on judgment, so its holder is *meant* to be gone. Reaping one
 * would drop the conflict state the user is being asked to resolve.
 *
 * Reaping from disk still happens on the next {@link acquireLease}, which holds
 * the write lock. A read has no business rewriting the file.
 */
export async function listLeases(
  commonDir: string,
  opts: { isPidAlive?: (pid: number) => boolean } = {},
): Promise<Lease[]> {
  const isPidAlive = opts.isPidAlive ?? defaultIsPidAlive;
  const { leases } = await readJson<LeaseFile>(leasesPath(commonDir), { leases: [] });
  return leases.filter((l) => l.state === 'parked' || isPidAlive(l.pid));
}

export async function findLease(
  commonDir: string,
  stackId: string,
  opts: { isPidAlive?: (pid: number) => boolean } = {},
): Promise<Lease | null> {
  return (await listLeases(commonDir, opts)).find((l) => l.stackId === stackId) ?? null;
}

export type AcquireResult =
  | { ok: true }
  | { ok: false; reason: 'stack-leased' | 'slot-leased'; holder: Lease };

/**
 * Atomically claim a work slot for a stack. Dead-pid RUNNING leases are
 * reaped first; PARKED leases are legitimately long-lived (a conflict
 * waiting on judgment) and are never reaped automatically.
 */
export async function acquireLease(
  commonDir: string,
  lease: { slotPath: string; stackId: string; action: string },
  opts: { isPidAlive?: (pid: number) => boolean } = {},
): Promise<AcquireResult> {
  const isPidAlive = opts.isPidAlive ?? defaultIsPidAlive;
  return withRegistry<AcquireResult>(commonDir, async (file) => {
    const live = file.leases.filter((l) => l.state === 'parked' || isPidAlive(l.pid));
    const stackHolder = live.find((l) => l.stackId === lease.stackId);
    if (stackHolder) {
      return { file: { leases: live }, result: { ok: false, reason: 'stack-leased', holder: stackHolder } };
    }
    const slotHolder = live.find((l) => l.slotPath === lease.slotPath);
    if (slotHolder) {
      return { file: { leases: live }, result: { ok: false, reason: 'slot-leased', holder: slotHolder } };
    }
    live.push({ ...lease, pid: process.pid, acquiredAt: Date.now(), state: 'running' });
    return { file: { leases: live }, result: { ok: true } };
  });
}

export async function parkLease(commonDir: string, stackId: string): Promise<void> {
  await withRegistry(commonDir, async (file) => ({
    file: {
      leases: file.leases.map((l) => (l.stackId === stackId ? { ...l, state: 'parked' as const } : l)),
    },
    result: undefined,
  }));
}

export async function releaseLease(commonDir: string, stackId: string): Promise<void> {
  await withRegistry(commonDir, async (file) => ({
    file: { leases: file.leases.filter((l) => l.stackId !== stackId) },
    result: undefined,
  }));
}
