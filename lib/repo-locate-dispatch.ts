/**
 * The one place that decides whether a locate runs in the daemon or in this
 * process.
 *
 * The daemon is the single writer of the worktree registry, so a locate must
 * never run locally while it is present: a reconcile pass landing between the
 * index write and the registry write is exactly the prune this feature exists
 * to prevent. Presence is decided from liveness EVIDENCE (a live pid, or the
 * socket file existing) rather than a ping: an event-loop-stalled daemon —
 * alive, holding the registry, just not servicing requests — fails a ping
 * exactly like a dead one does, and treating that as "absent" would take the
 * local branch anyway and race the very daemon still holding the registry. So
 * once presence is established, an unanswered `repos:locate` is a hard stop,
 * never a fall-through — `daemonSocketQuery` is the read-only client, so
 * probing never starts a daemon or warns.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { daemonSocketQuery } from "./daemon-client.ts";
import { RT_DIR } from "./daemon-config.ts";
import { applyLocate, isRefusal, planLocate, type LocatePlan, type LocateResult } from "./repo-locate.ts";

/** git worktree repair across a large pool is the slow part; the 2s default IPC timeout is a client number, not a daemon-op one. */
export const LOCATE_TIMEOUT_MS = 2 * 60_000;

export type LocateOutcome =
  | { via: "daemon" | "local"; ok: true; dryRun: false; result: LocateResult }
  | { via: "daemon" | "local"; ok: true; dryRun: true; plan: LocatePlan }
  | { via: "daemon" | "local"; ok: false; error: string; why?: string; next?: string };

interface PresenceIo {
  exists(path: string): boolean;
  readFile(path: string): string | null;
}

const realPresenceIo: PresenceIo = {
  exists: existsSync,
  readFile: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
};

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A live pid file OR a socket file on disk in `rtDir`: either is evidence the daemon holds the registry, whether or not it is currently answering requests. */
export function daemonPresentIn(rtDir: string, io: PresenceIo = realPresenceIo): boolean {
  const pid = Number.parseInt(io.readFile(join(rtDir, "rt.pid"))?.trim() ?? "", 10);
  return (pid > 0 && pidAlive(pid)) || io.exists(join(rtDir, "rt.sock"));
}

function daemonPresent(): boolean {
  return daemonPresentIn(RT_DIR);
}

export async function locateMovedRepo(req: {
  newPath: string;
  repo?: string;
  dryRun?: boolean;
}): Promise<LocateOutcome> {
  const dryRun = req.dryRun === true;

  if (daemonPresent()) {
    const res = await daemonSocketQuery(
      "repos:locate",
      { newPath: req.newPath, ...(req.repo ? { repo: req.repo } : {}), dryRun },
      LOCATE_TIMEOUT_MS,
    );
    if (!res) {
      return {
        via: "daemon",
        ok: false,
        error: "The rt daemon is running but did not answer",
        why: "rt will not move the repo itself while the daemon holds its records: the two would race.",
        next: "rt daemon status",
      };
    }
    if (!res.ok) return { via: "daemon", ok: false, error: res.error ?? "repos:locate failed" };
    return dryRun
      ? { via: "daemon", ok: true, dryRun: true, plan: res.data.plan as LocatePlan }
      : { via: "daemon", ok: true, dryRun: false, result: res.data as LocateResult };
  }

  const plan = await planLocate({ newPath: req.newPath, repo: req.repo });
  if (isRefusal(plan)) return { via: "local", ok: false, error: `${plan.refusal}: ${plan.message}` };
  if (dryRun) return { via: "local", ok: true, dryRun: true, plan };

  const result = await applyLocate(plan);
  return result.ok
    ? { via: "local", ok: true, dryRun: false, result }
    : { via: "local", ok: false, error: result.error ?? "locate failed" };
}
