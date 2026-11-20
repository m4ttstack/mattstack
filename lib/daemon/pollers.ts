/**
 * Periodic background work — cache refresh, port scanning, and the
 * hooks-guard fallback rescan. The system-process list is read on demand
 * only (handlers/system-processes.ts), never on a timer.
 *
 * All intervals live here so daemon.ts stays a thin wiring layer.
 */

import { existsSync } from "fs";
import type { Logger } from "pino";
import { scanListeningPorts, type PortEntry } from "../port-scanner.ts";
import { primeTeamTrackingIdentityMap } from "../repo-tracking.ts";
import type { PortCacheRef, RepoIndex } from "./handlers/types.ts";
import { demandedWithin } from "./demand-tracker.ts";
import { makeCoalescer } from "./cache-refresh.ts";

const MR_REFRESH_INTERVAL_MS = 5 * 60 * 1000;        // 5 minutes
const PORT_SCAN_INTERVAL_MS = 30 * 1000;             // 30 seconds
const HOOKS_SCAN_INTERVAL_MS = 60 * 1000;            // 60 seconds (fallback for stale watchers)
/** Consider a consumer "present" for 5 min after its last port-backed read. */
const DEMAND_WINDOW_MS = 5 * 60 * 1000;
/**
 * Abandon a wedged port scan after this long so a later tick is not
 * latched out forever (R047). The scan chains multiple subprocess calls
 * whose own runCapture timeouts can stack to ~20s worst case, so this sits
 * well above that -- it only fires for a genuinely hung child, not a slow one.
 */
const SCAN_DEADLINE_MS = 45 * 1000;

export interface PollerDeps {
  log: Logger;
  refreshCache: () => Promise<void>;
  /** Mutated in place so handlers read fresh port values without getters. */
  portCacheRef: PortCacheRef;
  broadcast: (type: string, data: any) => void;
  repoIndex: () => RepoIndex;
  checkAndRepairHooksPath: (repoName: string, repoPath: string) => Promise<boolean>;
  /** Test seam: overrides the real lsof/ps port scan. */
  scanPorts?: () => Promise<PortEntry[]>;
  /** Test seam: overrides the real "consumer read recently" demand check. */
  demanded?: () => boolean;
  /** Test seam: overrides SCAN_DEADLINE_MS. */
  scanDeadlineMs?: number;
}

export interface PollersHandle {
  /** Clears every timer this armed, so the pollers unit's reverse-stop leaves
   *  no interval or pending initial-scan timeout running. */
  stop(): void;
  /** Test seam: run one port-scan tick now. */
  tickPorts(): Promise<void>;
}

export function startPollers(deps: PollerDeps): PollersHandle {
  const { log, refreshCache, portCacheRef, broadcast } = deps;
  const scanPorts = deps.scanPorts ?? scanListeningPorts;
  const demanded = deps.demanded ?? (() => demandedWithin(DEMAND_WINDOW_MS));
  const scanDeadlineMs = deps.scanDeadlineMs ?? SCAN_DEADLINE_MS;

  // In-flight + deadline guard: the scan is async, so a slow scan must not
  // overlap the next tick, and a wedged one must not latch out every later
  // tick forever (R047).
  const runPortScan = makeCoalescer(
    async () => {
      try {
        portCacheRef.ports = await scanPorts();
        portCacheRef.updatedAt = Date.now();
        log.debug({ count: portCacheRef.ports.length }, "ports scanned");

        broadcast("ports", { ports: portCacheRef.ports, updatedAt: portCacheRef.updatedAt });
      } catch (err) {
        log.error({ err }, "port scan failed");
      }
    },
    scanDeadlineMs,
    () => log.warn("port scan timed out; cleared in-flight latch for next tick"),
    { onRefused: () => log.warn("port scan skipped; too many stalled scans already running") },
  );

  async function refreshPortCache(): Promise<void> {
    if (!demanded()) return; // no consumer asked recently
    await runPortScan();
  }

  const timeouts: ReturnType<typeof setTimeout>[] = [];
  const intervals: ReturnType<typeof setInterval>[] = [];

  // Periodic cache refresh
  timeouts.push(setTimeout(() => refreshCache(), 5000)); // initial refresh after 5s
  intervals.push(setInterval(() => refreshCache(), MR_REFRESH_INTERVAL_MS));

  // Port scanning (lightweight — every 30s)
  timeouts.push(setTimeout(() => refreshPortCache(), 2000)); // initial scan after 2s
  intervals.push(setInterval(() => refreshPortCache(), PORT_SCAN_INTERVAL_MS));

  // Periodic hooks scan — belt-and-suspenders fallback in case a directory
  // watcher ever misses a write (e.g. watcher limit hit, FS edge-case).
  // Runs every 60s; each call is cheap (one git-config read per watched repo).
  //
  // Rides the same interval to re-prime the team-tracking identity map: this
  // is the ONLY re-prime mechanism now that the repo index lives in
  // state.db (RT-50) — there is no file left to fs.watch (see daemon.ts).
  intervals.push(setInterval(async () => {
    const repos = deps.repoIndex();
    await primeTeamTrackingIdentityMap(repos).catch((err) => {
      log.warn({ err }, "repo-tracking: failed to re-prime team-intent identity map");
    });
    for (const [repoName, repoPath] of Object.entries(repos)) {
      if (existsSync(repoPath)) await deps.checkAndRepairHooksPath(repoName, repoPath);
    }
  }, HOOKS_SCAN_INTERVAL_MS));

  return {
    stop() {
      for (const t of timeouts) clearTimeout(t);
      for (const i of intervals) clearInterval(i);
    },
    tickPorts: refreshPortCache,
  };
}
