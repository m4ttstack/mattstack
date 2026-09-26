import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface LockOptions {
  /** Give up after this long waiting for the lock. */
  timeoutMs?: number;
  /** Poll interval while waiting. */
  retryMs?: number;
  /** A lock older than this whose pid is dead gets broken. */
  staleMs?: number;
  /** Test seam: liveness check for the pid found in a lock file. */
  isPidAlive?: (pid: number) => boolean;
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Single-writer sidecar lock: exclusive-create `<filePath>.lock` containing
 * `{ pid, acquiredAt }`, run fn, remove the lock. Held only for the duration
 * of fn, which should be a single read-modify-write. A lock whose pid is dead
 * and whose age exceeds staleMs is broken and retried.
 */
export async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
  opts: LockOptions = {},
): Promise<T> {
  const lockPath = `${filePath}.lock`;
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const retryMs = opts.retryMs ?? 25;
  const staleMs = opts.staleMs ?? 10_000;
  const isPidAlive = opts.isPidAlive ?? defaultIsPidAlive;
  const deadline = Date.now() + timeoutMs;

  await mkdir(dirname(filePath), { recursive: true });

  for (;;) {
    try {
      await writeFile(lockPath, JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }), { flag: 'wx' });
      break;
    } catch {
      let broke = false;
      try {
        const holder = JSON.parse(await readFile(lockPath, 'utf-8')) as { pid?: number; acquiredAt?: number };
        const age = Date.now() - (holder.acquiredAt ?? 0);
        if (age > staleMs && typeof holder.pid === 'number' && !isPidAlive(holder.pid)) {
          await unlink(lockPath).catch(() => {});
          broke = true;
        }
      } catch {
        // unreadable lock file: retry until timeout, then give up below
      }
      if (!broke) {
        if (Date.now() > deadline) throw new Error(`could not acquire lock ${lockPath}`);
        await sleep(retryMs);
      }
    }
  }

  try {
    return await fn();
  } finally {
    await unlink(lockPath).catch(() => {});
  }
}
