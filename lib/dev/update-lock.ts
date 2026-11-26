/**
 * One dev update at a time: the hourly `rt dev update --auto` and a hand-run
 * `rt dev update` share this lock, so neither runs `bun install` or swaps the
 * app under the other.
 */
import { join } from "path";
import { createUpdateLock, type UpdateLock } from "../setup/update-lock.ts";

/** Past the sum of the run's own timeouts (fetch, install, five app builds, the download and the swap come to about two hours). */
export const DEV_UPDATE_LOCK_MAX_AGE_MS = 3 * 60 * 60_000;

export function devUpdateLock(rtDir: string, opts: { pid?: number; alive?: (pid: number) => boolean } = {}): UpdateLock {
  return createUpdateLock(join(rtDir, "dev-update.lock"), { ...opts, maxAgeMs: DEV_UPDATE_LOCK_MAX_AGE_MS });
}

export async function underDevUpdateLock<T>(lock: UpdateLock, fn: () => Promise<T>): Promise<T | "locked"> {
  if (!lock.acquire()) return "locked";
  try {
    return await fn();
  } finally {
    lock.release();
  }
}
