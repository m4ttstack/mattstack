/**
 * System process scanner — discovers all processes whose cwd is inside a
 * tracked repo and samples CPU/memory, on demand for the tray's process panel.
 *
 * Unlike port-scanner.ts (which only looks at processes with a listening
 * port), this scans ALL processes system-wide and filters down to those
 * rooted in a tracked repo — catching build daemons, watchers, and other
 * non-listening processes.
 */

import { lazyChildLogger } from "./../daemon-logger.ts";
import { runCapture } from "../subprocess.ts";

const log = lazyChildLogger("process-scan");
import {
  loadRepoIndex,
  buildWorktreeMap,
  matchCwdToRepo,
  type PortEntry,
} from "../port-scanner.ts";

export interface SystemProcess {
  pid: number;
  ppid: number;
  command: string;
  fullCommand: string;
  cpuPercent: number;
  rssKb: number;
  uptime: string;
  cwd: string;
  repo: string;
  worktree: string | null;
  branch: string | null;
  relativeDir: string;
  port: number | null;
  linearTicket: string | null;
  /** Reconstructed package-script invocation ("pnpm start:lite:watch") from
   *  the process env; null when not launched via a package-manager script. */
  packageScript: string | null;
  firstSeen: number;
  children?: SystemProcess[];
  /** Pids collapsed into this row (chain root → leaf) when single-child
   *  chains are flattened for display; absent on unflattened rows. */
  chainPids?: number[];
}

/** A discovered process before `firstSeen` and the tree fields are applied. */
type GatheredProcess = Omit<SystemProcess, "firstSeen" | "children">;

export function parseProcessList(
  psOutput: string,
  repos: Record<string, string>,
  cwdMap: Map<number, string>,
  worktreeMap: Map<string, { repo: string; branch: string }> = new Map(),
): Omit<SystemProcess, "port" | "linearTicket" | "packageScript" | "firstSeen" | "children">[] {
  // No positional header skip: the daemon's `ps -o pid=,...` output is
  // headerless, so dropping the first line would drop a real process. A
  // header line (from `ps` without `=`) fails the pid regex and is skipped.
  const results: Omit<SystemProcess, "port" | "linearTicket" | "packageScript" | "firstSeen" | "children">[] = [];

  for (const line of psOutput.trim().split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Parse: PID  PPID  %CPU  RSS  ELAPSED  COMM  ARGS...
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)/);
    if (!match) continue;

    const pid = parseInt(match[1]!, 10);
    const ppid = parseInt(match[2]!, 10);
    const cpuPercent = parseFloat(match[3]!);
    const rssKb = parseInt(match[4]!, 10);
    const uptime = match[5]!;
    const command = match[6]!;
    const fullCommand = match[7]!;

    // Filter .app bundle processes
    if (fullCommand.includes(".app/Contents/")) continue;

    // Filter shells: check both comm and fullCommand since macOS truncates comm at ~16 chars
    if (command.startsWith("-")) continue;
    const shellBins = ["zsh", "bash", "fish", "sh"];
    const fullArgv0 = fullCommand.split(" ")[0] ?? "";
    const fullBase = fullArgv0.split("/").pop() ?? "";
    const isShell = shellBins.includes(command) || shellBins.includes(fullBase);
    if (isShell && cpuPercent === 0) continue;

    const cwd = cwdMap.get(pid);
    if (!cwd) continue;

    const repoMatch = matchCwdToRepo(cwd, repos, worktreeMap);
    if (!repoMatch.repo) continue;

    results.push({
      pid,
      ppid,
      command,
      fullCommand,
      cpuPercent,
      rssKb,
      uptime,
      cwd,
      repo: repoMatch.repo,
      worktree: repoMatch.worktree,
      branch: repoMatch.branch,
      relativeDir: repoMatch.relativeDir,
    });
  }

  return results;
}

/**
 * Parse `lsof -d cwd -Fpn` output into a pid → cwd map, keeping only cwds
 * inside a tracked path (repo root or worktree) or a close parent of one.
 * Output looks like: p1234\nn/Users/matt/repos/foo\np5678\nn/other/path\n
 */
export function parseLsofCwdMap(
  lsofOutput: string,
  trackedPaths: string[],
): Map<number, string> {
  const cwdMap = new Map<number, string>();
  let currentPid = 0;
  for (const line of lsofOutput.split("\n")) {
    if (line.startsWith("p")) {
      currentPid = parseInt(line.slice(1), 10);
    } else if (line.startsWith("n") && currentPid > 0) {
      const cwd = line.slice(1);
      if (trackedPaths.some(tp => cwd === tp || cwd.startsWith(tp + "/"))) {
        cwdMap.set(currentPid, cwd);
      } else if (trackedPaths.some(tp =>
        tp.startsWith(cwd + "/") && tp.slice(cwd.length + 1).split("/").length <= 2
      )) {
        cwdMap.set(currentPid, cwd);
      }
    }
  }
  return cwdMap;
}

/**
 * Parse `ps eww -o pid=,command=` output (argv + environment per line) into a
 * pid → "pm script" map, e.g. "pnpm start:lite:watch". Only the two npm_* vars
 * are extracted — the raw lines carry the full env (secrets included) and must
 * never leave this function. Requires BOTH vars: without the pair we can't
 * honestly reconstruct what was typed, so the pid is omitted.
 */
export function parsePackageScripts(psEwwOutput: string): Map<number, string> {
  const scripts = new Map<number, string>();
  for (const line of psEwwOutput.split("\n")) {
    const pidMatch = line.match(/^\s*(\d+)\s/);
    if (!pidMatch) continue;
    const agent = line.match(/\bnpm_config_user_agent=(\S+)/)?.[1];
    const script = line.match(/\bnpm_lifecycle_event=(\S+)/)?.[1];
    if (!agent || !script) continue;
    const pm = agent.split("/")[0];
    if (!pm) continue;
    scripts.set(parseInt(pidMatch[1]!, 10), `${pm} ${script}`);
  }
  return scripts;
}

async function getPackageScripts(pidList: string): Promise<Map<number, string>> {
  const { stdout, exitCode } = await runCapture(
    ["ps", "eww", "-o", "pid=,command=", "-p", pidList],
    { timeoutMs: 5000 },
  );
  if (exitCode !== 0 && !stdout) {
    log.warn({ exitCode }, "ps eww scan failed; package scripts unavailable");
    return new Map();
  }
  return parsePackageScripts(stdout);
}

async function getAllRepoPids(trackedPaths: string[]): Promise<Map<number, string> | null> {
  if (trackedPaths.length === 0) return new Map();

  // Single lsof call to get cwds for ALL processes at once.
  // -d cwd selects only the cwd file descriptor, -Fpn emits pid + name fields.
  const { stdout, exitCode } = await runCapture(
    ["lsof", "-d", "cwd", "-Fpn"],
    { timeoutMs: 10_000 },
  );
  if (exitCode !== 0 && !stdout) {
    // null (not an empty Map) so callers can tell "lsof failed" apart from
    // "genuinely no tracked-cwd processes" and keep the last list instead of
    // showing an empty panel on a transient scan failure.
    log.warn({ exitCode }, "lsof scan failed; preserving prior process state");
    return null;
  }
  return parseLsofCwdMap(stdout, trackedPaths);
}

export class SystemProcessScanner {
  private firstSeen = new Map<number, number>();
  private lastResult: SystemProcess[] = [];
  private lastScanAt: number | null = null;
  private refreshInFlight: Promise<SystemProcess[]> | null = null;

  /** Re-discovers the process list for an on-demand read. */
  refresh(portEntries: PortEntry[] = []): Promise<SystemProcess[]> {
    // One gather serves every caller queued behind it (RT-128): tray polls
    // outpace a gather on a machine whose spawns are slow, and a per-caller
    // gather multiplies the fan-out (git worktree list per repo + lsof)
    // that made the first one slow. Late callers ride the running gather's
    // port entries; ports only decorate rows and refresh again in 1.5s.
    this.refreshInFlight ??= this.refreshOnce(portEntries).finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async refreshOnce(portEntries: PortEntry[]): Promise<SystemProcess[]> {
    const gathered = await this.gather(portEntries);
    if (gathered === null) return this.lastResult; // failed tick: preserve lastResult/lastScanAt
    try {
      const now = Date.now();
      const seen = new Map<number, number>();
      const results = gathered.map<SystemProcess>(proc => {
        const firstSeen = this.firstSeen.get(proc.pid) ?? now;
        seen.set(proc.pid, firstSeen);
        return { ...proc, firstSeen };
      });
      this.firstSeen = seen;
      this.lastResult = results;
      return results;
    } finally {
      // Even a zero-result scan is a completed scan — consumers use this to
      // tell "no processes" apart from "haven't looked yet".
      this.lastScanAt = Date.now();
    }
  }

  /**
   * Discovery half of a scan: find every process rooted in a tracked repo and
   * decorate it with port + package-script.
   */
  protected async gather(portEntries: PortEntry[]): Promise<GatheredProcess[] | null> {
    const repos = loadRepoIndex();
    if (Object.keys(repos).length === 0) return [];

    // Include worktree paths in the lsof pre-filter: worktrees often live as
    // siblings of the registered repo root, so filtering on roots alone would
    // drop their processes before matchCwdToRepo ever sees them.
    const worktreeMap = await buildWorktreeMap(repos);
    const trackedPaths = [...new Set([...Object.values(repos), ...worktreeMap.keys()])];
    const cwdMap = await getAllRepoPids(trackedPaths);
    if (cwdMap === null) return null; // lsof failed
    if (cwdMap.size === 0) return []; // genuinely no tracked-cwd processes

    // Get CPU/memory for discovered PIDs
    const pidList = [...cwdMap.keys()].join(",");
    const psRes = await runCapture(
      ["ps", "-p", pidList, "-o", "pid=,ppid=,pcpu=,rss=,etime=,comm=,args="],
      { timeoutMs: 5000 },
    );
    if (psRes.exitCode !== 0 && !psRes.stdout) return null; // ps failed
    if (!psRes.stdout) return [];

    const parsed = parseProcessList(psRes.stdout, repos, cwdMap, worktreeMap);

    const packageScripts = parsed.length > 0
      ? await getPackageScripts(parsed.map(p => p.pid).join(","))
      : new Map<number, string>();

    // Build port lookup by PID
    const portByPid = new Map<number, number>();
    for (const pe of portEntries) {
      portByPid.set(pe.pid, pe.port);
    }

    return parsed.map(proc => ({
      ...proc,
      port: portByPid.get(proc.pid) ?? null,
      linearTicket: null, // enriched by handler with branch cache data
      packageScript: packageScripts.get(proc.pid) ?? null,
    }));
  }

  /** Ms since the last `refresh` completed; Infinity if never. */
  msSinceLastScan(): number {
    return this.lastScanAt === null ? Infinity : Date.now() - this.lastScanAt;
  }

  getProcesses(): SystemProcess[] {
    return this.lastResult;
  }

  get hasCompletedScan(): boolean {
    return this.lastScanAt !== null;
  }
}
