/**
 * Single flight for `rt setup update`: the tray spawns the verb at every
 * launch and a hand run can overlap it, and two engines would race on
 * setup-state.json and run the same migration twice.
 */

import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from "fs";
import { dirname, join } from "path";

export interface UpdateLock {
  /** False when another live run holds the lock. */
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
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
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

  const take = (): boolean => {
    let fd: number;
    try {
      fd = openSync(path, "wx");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw err;
    }
    try {
      writeSync(fd, String(pid));
    } finally {
      closeSync(fd);
    }
    return true;
  };

  const heldByLiveRun = (): boolean => {
    try {
      const holder = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
      if (!Number.isInteger(holder) || holder <= 0) return false;
      if (now() - statSync(path).mtimeMs > UPDATE_LOCK_MAX_AGE_MS) return false;
      return alive(holder);
    } catch {
      // The holder released between the failed take and this read.
      return false;
    }
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
      rmSync(path, { force: true });
    },
  };
}
