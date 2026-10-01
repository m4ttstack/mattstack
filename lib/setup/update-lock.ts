/**
 * Single flight for `rt setup update`: the tray spawns the verb at every
 * launch and a hand run can overlap it, and two engines would race on
 * setup-state.json and run the same migration twice.
 */

import { linkSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";

export interface UpdateLock {
  /** False when another live run holds the lock. Throws when the lock file cannot be created or read. */
  acquire(): boolean;
  /** Frees the lock only if this instance holds it. */
  release(): void;
}

/** A pid can be reused after its run died, so age is the second proof of a stale lock. An update run takes minutes at most. */
export const UPDATE_LOCK_MAX_AGE_MS = 30 * 60 * 1000;

export function updateLockPath(home: string): string {
  return join(home, ".mattstack", "rt", "setup-update.lock");
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the pid exists under another user.
    return errorCode(err) === "EPERM";
  }
}

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException).code;
}

interface UpdateLockOptions {
  pid?: number;
  alive?: (pid: number) => boolean;
  now?: () => number;
}

export function createUpdateLock(path: string, opts: UpdateLockOptions = {}): UpdateLock {
  const pid = opts.pid ?? process.pid;
  const alive = opts.alive ?? pidAlive;
  const now = opts.now ?? Date.now;
  let held = false;

  // link(2) publishes the file with the pid already in it: a lock created
  // empty and written afterwards would read as stale to a run starting in
  // between.
  const take = (): boolean => {
    const scratch = `${path}.${pid}.tmp`;
    writeFileSync(scratch, String(pid));
    try {
      linkSync(scratch, path);
      return true;
    } catch (err) {
      if (errorCode(err) === "EEXIST") return false;
      throw err;
    } finally {
      rmSync(scratch, { force: true });
    }
  };

  const holderPid = (): number | null => {
    try {
      const holder = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
      return Number.isInteger(holder) && holder > 0 ? holder : null;
    } catch (err) {
      // The holder released between the failed take and this read.
      if (errorCode(err) === "ENOENT") return null;
      throw err;
    }
  };

  const heldByLiveRun = (): boolean => {
    const holder = holderPid();
    if (holder === null) return false;
    try {
      if (now() - statSync(path).mtimeMs > UPDATE_LOCK_MAX_AGE_MS) return false;
    } catch (err) {
      if (errorCode(err) === "ENOENT") return false;
      throw err;
    }
    return alive(holder);
  };

  return {
    acquire() {
      mkdirSync(dirname(path), { recursive: true });
      if (take()) {
        held = true;
        return true;
      }
      if (heldByLiveRun()) return false;
      rmSync(path, { force: true });
      held = take();
      return held;
    },
    release() {
      if (!held) return;
      held = false;
      // A run evicted by the age cap no longer owns the file at this path.
      if (holderPid() === pid) rmSync(path, { force: true });
    },
  };
}
