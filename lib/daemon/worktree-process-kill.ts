/**
 * Kill the workload processes rooted in a worktree — dev servers, watchers,
 * compilers — when the worktree is parked and its feature is done.
 *
 * Deliberately spares AI agent sessions (claude, codex, …) and everything
 * they spawned: agents are cleaned up through their own lifecycle (herdr),
 * never SIGKILL. Shells and .app bundle processes are spared for the same
 * reason the system scanner ignores them — they're the user's, not workload.
 *
 * Kill semantics mirror the tray's: SIGTERM the whole set immediately, then
 * escalate survivors to SIGKILL after 5s. The escalation timer never blocks
 * the caller — parking proceeds while stragglers wind down.
 */

import { realpathSync } from "fs";
import { lazyChildLogger } from "../daemon-logger.ts";
import { runCapture } from "../subprocess.ts";
import { parseLsofCwdMap, parsePackageScripts } from "./system-process-scanner.ts";

const log = lazyChildLogger("worktree-kill");

const ESCALATE_AFTER_MS = 5_000;

const SHELL_BINS = new Set(["zsh", "bash", "fish", "sh"]);
const INTERPRETER_BINS = new Set(["node", "bun", "deno", "python", "python3"]);
const DEFAULT_AI_AGENT_NAMES = new Set([
  "claude", "codex", "gemini", "aider", "cursor-agent", "copilot",
]);
/** Multiplexers, remote shells, and editors: never workload, always the user's. */
const SPARED_BINS = new Set(["tmux", "screen", "ssh", "mosh", "vim", "nvim", "emacs", "less", "man"]);

export interface KillCandidate {
  pid: number;
  ppid: number;
  command: string;
  fullCommand: string;
}

export type ProcRow = KillCandidate;

export interface KillTargetOptions {
  /** Extra binary names to protect, in addition to the built-in AI agents. */
  aiAgentNames?: string[];
  /** Pids to protect (with their descendants), e.g. the calling CLI process. */
  protectedPids?: number[];
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

/** realpathSync, falling back to the literal path when it fails (already gone, no permission). */
export function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function stripLoginDash(name: string): string {
  return name.startsWith("-") ? name.slice(1) : name;
}

/** The names a process answers to: comm, argv0 basename, and (when argv0 is
 *  an interpreter) the basename of the script it runs. A login shell's
 *  leading `-` is stripped from each. */
function processNames(proc: KillCandidate): string[] {
  const argv = proc.fullCommand.split(" ");
  const names = [stripLoginDash(proc.command), stripLoginDash(basename(argv[0] ?? ""))];
  if (INTERPRETER_BINS.has(names[1]!) && argv[1]) {
    names.push(stripLoginDash(basename(argv[1])));
  }
  return names;
}

/** argv0 basename; comm is truncated to 16 characters on macOS. */
export function processLabel(proc: ProcRow): string {
  const argv0 = stripLoginDash(basename(proc.fullCommand.split(" ")[0] ?? ""));
  return argv0 || stripLoginDash(proc.command);
}

/** Never workload: an .app bundle process, a shell, or a multiplexer/editor. */
function isSparedFromWorkload(proc: KillCandidate): boolean {
  if (proc.fullCommand.includes(".app/Contents/")) return true;
  const argv0 = stripLoginDash(basename(proc.fullCommand.split(" ")[0] ?? ""));
  const comm = stripLoginDash(proc.command);
  return (
    SHELL_BINS.has(comm) || SHELL_BINS.has(argv0) ||
    SPARED_BINS.has(comm) || SPARED_BINS.has(argv0)
  );
}

/** An agent session, shell, multiplexer or editor: the user's, never workload. */
export function isUserOrAgentProcess(proc: KillCandidate): boolean {
  const names = processNames(proc);
  return names.some((n) => DEFAULT_AI_AGENT_NAMES.has(n) || SHELL_BINS.has(n) || SPARED_BINS.has(n));
}

/**
 * Pids belonging to AI agent sessions (claude, codex, …) plus everything they
 * spawned, following live ppid links. Once an agent exits its orphans get
 * reparented to pid 1, so leftovers from dead sessions are no longer covered.
 */
export function agentSessionPids(
  rows: KillCandidate[],
  opts: KillTargetOptions = {},
): Set<number> {
  const aiNames = new Set([...DEFAULT_AI_AGENT_NAMES, ...(opts.aiAgentNames ?? [])]);

  // Roots of protection: AI agent processes and explicitly protected pids.
  const protectedRoots = new Set(opts.protectedPids ?? []);
  for (const proc of rows) {
    if (processNames(proc).some(n => aiNames.has(n))) {
      protectedRoots.add(proc.pid);
    }
  }

  // Extend protection to every descendant so we never yank a subprocess out
  // from under a live agent mid-task.
  const childrenByPpid = new Map<number, number[]>();
  for (const proc of rows) {
    const siblings = childrenByPpid.get(proc.ppid) ?? [];
    siblings.push(proc.pid);
    childrenByPpid.set(proc.ppid, siblings);
  }
  const protectedPids = new Set<number>();
  const queue = [...protectedRoots];
  while (queue.length > 0) {
    const pid = queue.pop()!;
    if (protectedPids.has(pid)) continue;
    protectedPids.add(pid);
    queue.push(...(childrenByPpid.get(pid) ?? []));
  }
  return protectedPids;
}

export function selectKillTargets(
  rows: KillCandidate[],
  opts: KillTargetOptions = {},
): KillCandidate[] {
  const protectedPids = agentSessionPids(rows, opts);

  return rows.filter(proc => {
    if (protectedPids.has(proc.pid)) return false;
    return !isSparedFromWorkload(proc);
  });
}

/**
 * Drops any cwd not inside the (already realpath'd) target, and any cwd owned
 * by a more-specific nested exclude path (a sibling/nested worktree's
 * processes belong to that tree, not this one). Pure: callers realpath every
 * input first so a symlinked home resolves the same way on both sides.
 */
export function attributeCwds(
  target: string,
  excludes: string[],
  cwdMap: Map<number, string>,
): Map<number, string> {
  const attributed = new Map<number, string>();
  for (const [pid, cwd] of cwdMap) {
    const insideTarget = cwd === target || cwd.startsWith(target + "/");
    if (!insideTarget) continue;
    const ownedByNested = excludes.some(e => cwd === e || cwd.startsWith(e + "/"));
    if (ownedByNested) continue;
    attributed.set(pid, cwd);
  }
  return attributed;
}

export interface StoppedSessionPlan {
  pid: number;
  label: string;
  cwd: string;
}

export interface KillPlanInput {
  /** Realpath'd tree being disposed. */
  target: string;
  /** Realpath'd trees nested under target, owned by someone else. */
  excludes: string[];
  /** Every process on the machine. */
  table: ProcRow[];
  /** Every process's realpath'd cwd. */
  cwds: Map<number, string>;
  /** The daemon, its parent and the calling CLI. */
  protectedPids: number[];
  /** True only for the merge reactor's dispose: agents inside target are stopped. */
  stopSessionsInside: boolean;
}

/**
 * Decides who dies when `target` is disposed, over the full process table.
 * An agent anywhere is a session root; its family (ancestors below pid 1 and
 * every descendant) lives unless the root sits inside target and the caller
 * asked for sessions inside to be stopped. Pure: no ps, lsof or signals.
 */
export function planWorktreeKill(input: KillPlanInput): {
  targets: KillCandidate[];
  stoppedSessions: StoppedSessionPlan[];
} {
  const { target, excludes, table, cwds, stopSessionsInside } = input;
  const byPid = new Map<number, ProcRow>();
  const children = new Map<number, number[]>();
  for (const proc of table) {
    byPid.set(proc.pid, proc);
    const siblings = children.get(proc.ppid) ?? [];
    siblings.push(proc.pid);
    children.set(proc.ppid, siblings);
  }

  const ancestorsOf = (pid: number): number[] => {
    const found: number[] = [];
    const seen = new Set<number>([pid]);
    let cur = byPid.get(pid)?.ppid;
    while (cur !== undefined && cur > 1 && !seen.has(cur)) {
      const proc = byPid.get(cur);
      if (!proc) break;
      seen.add(cur);
      found.push(cur);
      cur = proc.ppid;
    }
    return found;
  };

  const descendantsOf = (pid: number): number[] => {
    const found: number[] = [];
    const seen = new Set<number>([pid]);
    const queue = [...(children.get(pid) ?? [])];
    while (queue.length > 0) {
      const next = queue.pop()!;
      if (seen.has(next)) continue;
      seen.add(next);
      found.push(next);
      queue.push(...(children.get(next) ?? []));
    }
    return found;
  };

  const familyOf = (pid: number): number[] => [pid, ...ancestorsOf(pid), ...descendantsOf(pid)];

  const attributed = attributeCwds(target, excludes, cwds);
  const roots = table.filter(p => processNames(p).some(n => DEFAULT_AI_AGENT_NAMES.has(n)));
  const rootSet = new Set(roots.map(r => r.pid));
  const protectedRoots = input.protectedPids.filter(pid => pid > 1);

  const spared = new Set<number>();
  for (const root of roots) {
    if (!attributed.has(root.pid) || !stopSessionsInside) {
      for (const pid of familyOf(root.pid)) spared.add(pid);
    }
  }
  for (const pid of protectedRoots) {
    spared.add(pid);
    for (const d of descendantsOf(pid)) spared.add(d);
    for (const a of ancestorsOf(pid)) {
      if (rootSet.has(a)) for (const f of familyOf(a)) spared.add(f);
    }
  }

  const stoppedRoots = roots.filter(r => attributed.has(r.pid) && !spared.has(r.pid));
  const stoppedFamily = new Set<number>();
  for (const root of stoppedRoots) for (const pid of familyOf(root.pid)) stoppedFamily.add(pid);

  const targets = new Map<number, KillCandidate>();
  for (const root of stoppedRoots) targets.set(root.pid, root);
  for (const pid of attributed.keys()) {
    const proc = byPid.get(pid);
    if (!proc || spared.has(pid) || stoppedFamily.has(pid) || isSparedFromWorkload(proc)) continue;
    targets.set(pid, proc);
  }

  return {
    targets: [...targets.values()].sort((a, b) => a.pid - b.pid),
    stoppedSessions: stoppedRoots
      .map(r => ({ pid: r.pid, label: processLabel(r), cwd: attributed.get(r.pid)! }))
      .sort((a, b) => a.pid - b.pid),
  };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface WorktreeKillResult {
  terminated: { pid: number; label: string }[];
}

export interface KillWorktreeOptions {
  /** Pids to spare (with their descendants), e.g. the calling CLI process. */
  callerPids?: number[];
  /** Other registered trees' paths: their processes are never this tree's to kill,
   *  even when a nested checkout puts their cwd underneath this one. */
  excludePaths?: string[];
}

/**
 * Keeps only excludes strictly nested under target. An exclude equal to
 * target itself must be dropped here: attributeCwds' ownedByNested check
 * matches on `cwd === e`, so a target-equal exclude would mark every cwd in
 * the target as owned by a "nested" tree and silently zero out the kill set.
 */
export function nestedExcludes(target: string, excludePaths: string[]): string[] {
  return excludePaths.filter(e => e !== target && e.startsWith(target + "/"));
}

/**
 * Find and terminate the workload processes whose cwd is inside the worktree.
 * Discovery is done fresh (not from the scanner's 10s-old snapshot) so we act
 * on ground truth at park time.
 */
export async function killWorktreeProcesses(
  worktreePath: string,
  opts: KillWorktreeOptions = {},
): Promise<WorktreeKillResult> {
  const target = safeRealpath(worktreePath);
  const excludes = nestedExcludes(target, (opts.excludePaths ?? []).map(safeRealpath));

  const lsof = await runCapture(["lsof", "-d", "cwd", "-Fpn"], { timeoutMs: 10_000 });
  if (lsof.exitCode !== 0 && !lsof.stdout) {
    log.warn({ exitCode: lsof.exitCode, worktreePath }, "lsof failed; skipping worktree process kill");
    return { terminated: [] };
  }

  // Pass the realpath'd target to parseLsofCwdMap too, so its own prefix
  // match agrees with attributeCwds below on a symlinked home.
  const rawCwdMap = parseLsofCwdMap(lsof.stdout, [target]);
  const resolvedCwdMap = new Map<number, string>();
  for (const [pid, raw] of rawCwdMap) resolvedCwdMap.set(pid, safeRealpath(raw));
  const cwdMap = attributeCwds(target, excludes, resolvedCwdMap);
  if (cwdMap.size === 0) return { terminated: [] };

  const pidList = [...cwdMap.keys()].join(",");
  const rows: KillCandidate[] = [];
  const ps = await runCapture(["ps", "-p", pidList, "-o", "pid=,ppid=,comm=,args="], { timeoutMs: 5000 });
  if (ps.exitCode !== 0 && !ps.stdout) {
    log.warn({ exitCode: ps.exitCode, worktreePath }, "ps failed; skipping worktree process kill");
    return { terminated: [] };
  }
  for (const line of ps.stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)/);
    if (!match) continue;
    rows.push({
      pid: parseInt(match[1]!, 10),
      ppid: parseInt(match[2]!, 10),
      command: basename(match[3]!),
      fullCommand: match[4]!,
    });
  }

  const targets = selectKillTargets(rows, {
    protectedPids: [process.pid, process.ppid, ...(opts.callerPids ?? [])],
  });
  if (targets.length === 0) return { terminated: [] };

  // Label with the package-script invocation when known — that's the name the
  // developer recognizes ("pnpm start:lite:watch", not "node").
  let scripts = new Map<number, string>();
  const eww = await runCapture(
    ["ps", "eww", "-o", "pid=,command=", "-p", targets.map(t => t.pid).join(",")],
    { timeoutMs: 5000 },
  );
  if (eww.exitCode === 0 || eww.stdout) scripts = parsePackageScripts(eww.stdout);

  // Package-script kills (recognized "pnpm start:lite:watch" etc.) are routine;
  // anything without that label is the riskier, unrecognized case worth a warn.
  const unlabeled = targets.filter(t => !scripts.has(t.pid));
  if (unlabeled.length > 0) {
    log.warn(
      { worktreePath, targets: unlabeled.map(t => ({ pid: t.pid, comm: t.command })) },
      "worktree process kill: SIGTERM targets",
    );
  }

  const terminated: { pid: number; label: string }[] = [];
  for (const killTarget of targets) {
    try {
      process.kill(killTarget.pid, "SIGTERM");
      terminated.push({ pid: killTarget.pid, label: scripts.get(killTarget.pid) ?? killTarget.command });
    } catch { /* already gone */ }
  }

  if (terminated.length > 0) {
    log.info(
      { worktreePath, terminated },
      `terminated ${terminated.length} worktree process(es): ${terminated.map(t => t.label).join(", ")}`,
    );

    const timer = setTimeout(() => {
      const survivors = terminated.filter(t => isAlive(t.pid));
      for (const survivor of survivors) {
        try { process.kill(survivor.pid, "SIGKILL"); } catch { /* raced exit */ }
      }
      if (survivors.length > 0) {
        log.warn({ worktreePath, survivors }, `escalated ${survivors.length} survivor(s) to SIGKILL`);
      }
    }, ESCALATE_AFTER_MS);
    timer.unref?.();
  }

  return { terminated };
}
