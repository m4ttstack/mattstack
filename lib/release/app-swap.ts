/**
 * Replacing an installed .app bundle and cycling the dev app, shared by
 * `rt release update-machine` and `rt dev update`. Every external effect goes
 * through AppSwapSeams.
 */
import type { RunResult } from "../subprocess.ts";

export interface AppSwapSeams {
  exec(argv: [string, ...string[]], opts?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> }): Promise<RunResult>;
  sleep(ms: number): Promise<void>;
}

export const PROD_APP_PATH = "/Applications/mattstack.app";
export const DEV_APP_PATH = "/Applications/mattstack-dev.app";
// open hands its caller's environment to the app it launches; a dev app
// opened from an agent shell would carry NODE, npm_* and session vars.
export const OPEN_DEV_APP: [string, ...string[]] = ["/usr/bin/env", "-i", "/usr/bin/open", DEV_APP_PATH];
/** Anchored to the executable inside the bundle so pgrep never catches an unrelated
 *  process that merely mentions the bundle path (a `tail -f` on its log, an editor). */
export const DEV_APP_ANCHOR = `${DEV_APP_PATH}/Contents/MacOS/`;

/** The tail of a failed command's output, for an error leg's detail. */
export function execTail(r: RunResult): string {
  return (r.stderr || r.stdout).trim() || "no output";
}

export async function pgrepPids(seams: AppSwapSeams, pattern: string): Promise<number[]> {
  const r = await seams.exec(["pgrep", "-f", pattern]);
  return r.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
}

/** open(1) hands off to LaunchServices and returns before the app is actually up, so a single immediate pgrep cannot tell "still launching" from "never launched". */
export async function pollForPids(seams: AppSwapSeams, pattern: string, attempts: number, delayMs: number): Promise<number[]> {
  for (let i = 0; i < attempts; i++) {
    const pids = await pgrepPids(seams, pattern);
    if (pids.length > 0) return pids;
    if (i < attempts - 1) await seams.sleep(delayMs);
  }
  return [];
}

export async function waitForNoPids(seams: AppSwapSeams, pattern: string, attempts: number, delayMs: number): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if ((await pgrepPids(seams, pattern)).length === 0) return true;
    if (i < attempts - 1) await seams.sleep(delayMs);
  }
  return (await pgrepPids(seams, pattern)).length === 0;
}

/**
 * `ditto` onto an existing .app MERGES rather than replaces: stale files linger
 * and extras can break the code-signature seal. Move the current bundle aside,
 * ditto the new one into its place, and only delete the aside copy once that
 * succeeds; a failed ditto restores it so the machine is never left without
 * a working app.
 *
 * POSIX `mv src dst` moves src INSIDE dst instead of renaming it when dst
 * already exists as a directory, so every mv here is preceded by a checked
 * `rm -rf` of its own destination: a stale aside from a prior failed run
 * would otherwise break the first move, and a partially-ditto'd destPath
 * would break the rollback move the same way. Returns null on success, or
 * an error detail plus what is left at destPath: the previous app, the new
 * one, or nothing safe to launch (a partial copy, or nothing at all).
 */
export type ReplaceFailure = { error: string; atDest: "previous" | "new" | "unsafe" };

export async function replaceApp(seams: AppSwapSeams, sourcePath: string, destPath: string): Promise<ReplaceFailure | null> {
  const asidePath = `${destPath}.update-machine-old`;

  const clearAside = await seams.exec(["rm", "-rf", asidePath]);
  if (clearAside.exitCode !== 0) {
    return { error: `could not clear a stale aside copy at ${asidePath}: ${execTail(clearAside)}`, atDest: "previous" };
  }

  const mv = await seams.exec(["mv", destPath, asidePath]);
  if (mv.exitCode !== 0) return { error: `could not move the current app aside: ${execTail(mv)}`, atDest: "previous" };

  const ditto = await seams.exec(["ditto", sourcePath, destPath]);
  if (ditto.exitCode !== 0) {
    const clearDest = await seams.exec(["rm", "-rf", destPath]);
    if (clearDest.exitCode !== 0) {
      return {
        error: `ditto failed and the broken app at ${destPath} could not be cleared to roll back (the previous app is at ${asidePath}): ${execTail(clearDest)}`,
        atDest: "unsafe",
      };
    }
    const rollback = await seams.exec(["mv", asidePath, destPath]);
    if (rollback.exitCode !== 0) {
      return { error: `ditto failed and rollback failed (the previous app is at ${asidePath}): ${execTail(rollback)}`, atDest: "unsafe" };
    }
    return { error: `ditto failed, restored the previous app: ${execTail(ditto)}`, atDest: "previous" };
  }

  const cleanup = await seams.exec(["rm", "-rf", asidePath]);
  if (cleanup.exitCode !== 0) {
    return { error: `replaced ${destPath}, but could not remove the aside copy at ${asidePath}: ${execTail(cleanup)}`, atDest: "new" };
  }
  return null;
}

export type DevSwapResult = { ok: true; wasRunning: boolean; pid: number | null } | { ok: false; error: string };

/** Quits a running dev app, swaps `newApp` in, and reopens it only if it was running: opening it by hand takes the Mac over. */
export async function swapDevApp(seams: AppSwapSeams, newApp: string): Promise<DevSwapResult> {
  const runningBefore = await pgrepPids(seams, DEV_APP_ANCHOR);
  const wasRunning = runningBefore.length > 0;
  for (const pid of runningBefore) {
    const kill = await seams.exec(["kill", String(pid)]);
    if (kill.exitCode !== 0) {
      // A process that already exited between pgrep and kill (ESRCH) is not a failure.
      const stillRunning = (await pgrepPids(seams, DEV_APP_ANCHOR)).includes(pid);
      if (stillRunning) return { ok: false, error: `kill ${pid} failed: ${execTail(kill)}` };
    }
  }
  if (!(await waitForNoPids(seams, DEV_APP_ANCHOR, 5, 500))) {
    return { ok: false, error: "the running dev app did not exit after kill" };
  }

  // Never rebuilds the blessed bundle in place; replaceApp swaps it wholesale.
  const failure = await replaceApp(seams, newApp, DEV_APP_PATH);
  if (failure) {
    // The running copy was already quit above, so a failed swap reopens the
    // app replaceApp left in place, unless what is there is not safe to launch.
    if (failure.atDest === "unsafe") return { ok: false, error: `${failure.error}; not reopened, ${DEV_APP_PATH} is not safe to launch` };
    if (!wasRunning) return { ok: false, error: `${failure.error}; not reopened, it was not running` };
    const which = failure.atDest === "previous" ? "reopened the previous app" : "opened the new app";
    const reopen = await seams.exec(OPEN_DEV_APP);
    const pids = reopen.exitCode === 0 ? await pollForPids(seams, DEV_APP_ANCHOR, 5, 500) : [];
    const tail = pids.length > 0 ? `${which} (pid ${pids[0]})` : `opening ${DEV_APP_PATH} did not bring up a process${reopen.exitCode === 0 ? "" : `: ${execTail(reopen)}`}`;
    return { ok: false, error: `${failure.error}; ${tail}` };
  }

  if (!wasRunning) return { ok: true, wasRunning: false, pid: null };
  const open = await seams.exec(OPEN_DEV_APP);
  if (open.exitCode !== 0) return { ok: false, error: `open failed: ${execTail(open)}` };
  const pids = await pollForPids(seams, DEV_APP_ANCHOR, 5, 500);
  if (pids.length === 0) return { ok: false, error: "dev app did not relaunch with a fresh pid" };
  return { ok: true, wasRunning: true, pid: pids[0]! };
}
