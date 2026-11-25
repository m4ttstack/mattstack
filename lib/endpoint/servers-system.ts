import { parseCwdMap, parseListeningLsof } from "../port-scanner.ts";
import { childEnv, runCapture, type RunResult } from "../subprocess.ts";
import { listWorktreesAsync } from "../worktree/git-async.ts";
import { parseServerProcs, type RunningServer, type ServerSnapshot } from "./servers.ts";

export interface ServerSystem {
  run(argv: [string, ...string[]], opts: { timeoutMs: number; env?: Record<string, string | undefined> }): Promise<RunResult>;
  worktrees(repoRoot: string): Promise<Array<{ path: string; branch: string | null }> | null>;
  /** Throws errno errors, as process.kill does. */
  signal(pid: number, sig: "SIGTERM" | "SIGKILL" | 0): void;
  sleep(ms: number): Promise<void>;
}

export const realServerSystem: ServerSystem = {
  run: runCapture,
  worktrees: async (repoRoot) =>
    (await listWorktreesAsync(repoRoot))?.filter((w) => !w.isBare).map(({ path, branch }) => ({ path, branch })) ?? null,
  signal: (pid, sig) => void process.kill(pid, sig),
  sleep: (ms) => Bun.sleep(ms),
};

// lsof exits 1 both for "nothing to report" and after partial output; only a higher code means it died.
const lsofRan = (read: RunResult) => read.exitCode === 0 || read.exitCode === 1;

/** Null when any read failed, so a caller never mistakes that for nothing running. */
export async function readServerSnapshot(repoRoot: string, system: ServerSystem = realServerSystem): Promise<ServerSnapshot | null> {
  const [ps, cwdRead, listenerRead, worktrees] = await Promise.all([
    system.run(["ps", "-A", "-o", "pid=,ppid=,etime=,lstart=,args="], { timeoutMs: 5_000, env: { ...childEnv(), LC_ALL: "C" } }),
    system.run(["lsof", "-d", "cwd", "-Fpn"], { timeoutMs: 10_000 }),
    system.run(["lsof", "-nP", "-iTCP", "-sTCP:LISTEN"], { timeoutMs: 10_000 }),
    system.worktrees(repoRoot),
  ]);
  const procs = parseServerProcs(ps.stdout);
  const cwds = parseCwdMap(cwdRead.stdout);
  if (ps.exitCode !== 0 || procs.length === 0) return null;
  if (!lsofRan(cwdRead) || cwds.size === 0) return null;
  if (!lsofRan(listenerRead) || worktrees === null) return null;

  const listeners = new Map<number, number[]>();
  for (const { pid, port } of parseListeningLsof(listenerRead.stdout)) listeners.set(pid, [...(listeners.get(pid) ?? []), port]);
  for (const ports of listeners.values()) ports.sort((a, b) => a - b);
  return { procs, cwds, listeners, worktrees };
}

export interface StopOutcome {
  server: RunningServer;
  result: "stopped" | "gone" | "failed";
  why?: string;
}

const POLL_MS = 100;
const ESCALATE_AFTER_MS = 5_000;
const GIVE_UP_AFTER_MS = 2_000;

const errnoOf = (err: unknown) => (err as NodeJS.ErrnoException).code;

/** `fresh` is read after the pick: a server whose root pid has a new start time is gone, and its pid is another process's now. */
export async function stopServers(
  picked: RunningServer[],
  fresh: RunningServer[],
  spare: Set<number>,
  system: ServerSystem = realServerSystem,
): Promise<StopOutcome[]> {
  const isAlive = (pid: number) => {
    try {
      system.signal(pid, 0);
      return true;
    } catch (err) {
      return errnoOf(err) === "EPERM";
    }
  };
  /** Why the signal could not be sent, or null when it was sent or the process is already gone. */
  const send = (pid: number, sig: "SIGTERM" | "SIGKILL"): string | null => {
    try {
      system.signal(pid, sig);
      return null;
    } catch (err) {
      if (errnoOf(err) === "ESRCH") return null;
      return errnoOf(err) === "EPERM" ? "It belongs to another user or to macOS." : (err as Error).message;
    }
  };

  const jobs = picked.map((server) => {
    const now = fresh.find((f) => f.pid === server.pid && f.startTime === server.startTime);
    if (!now) return { server, gone: true, why: null, waiting: [] };
    if (spare.has(now.pid)) return { server, gone: false, why: "rt is running inside it.", waiting: [] };
    let why: string | null = null;
    const waiting: number[] = [];
    for (const pid of now.pids) {
      if (pid <= 1 || spare.has(pid)) continue;
      const refused = send(pid, "SIGTERM");
      if (refused === null) waiting.push(pid);
      else why ??= refused;
    }
    return { server, gone: false, why, waiting };
  });

  const alive = () => jobs.flatMap((job) => job.waiting).filter(isAlive);
  const waitUpTo = async (limitMs: number) => {
    for (let waited = 0; waited < limitMs && alive().length > 0; waited += POLL_MS) await system.sleep(POLL_MS);
  };
  await waitUpTo(ESCALATE_AFTER_MS);
  const stubborn = alive();
  for (const pid of stubborn) send(pid, "SIGKILL");
  if (stubborn.length > 0) await waitUpTo(GIVE_UP_AFTER_MS);

  return jobs.map(({ server, gone, why, waiting }): StopOutcome => {
    if (gone) return { server, result: "gone" };
    const failure = why ?? (waiting.some(isAlive) ? "It did not stop." : null);
    return failure === null ? { server, result: "stopped" } : { server, result: "failed", why: failure };
  });
}
