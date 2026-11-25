import { parseCwdMap, parseListeningLsof, parsePidValueMap } from "../port-scanner.ts";
import { childEnv, runCapture, type RunResult } from "../subprocess.ts";
import { listWorktreesAsync } from "../worktree/git-async.ts";
import { agentLabel, parseServerProcs, type RunningServer, type ServerProc, type ServerSnapshot } from "./servers.ts";

/** `identity` is the serialized repo identity; `root` is any of its worktrees. */
export interface ServerRepo {
  identity: string;
  root: string;
}

export interface ServerSystem {
  run(argv: [string, ...string[]], opts: { timeoutMs: number; env?: Record<string, string | undefined> }): Promise<RunResult>;
  /** Git's list, then the removed trees rt still keeps: a server can outlive its worktree. */
  worktrees(repo: ServerRepo): Promise<ServerSnapshot["worktrees"] | null>;
  /** Throws errno errors, as process.kill does. */
  signal(pid: number, sig: "SIGTERM" | "SIGKILL" | 0): void;
  sleep(ms: number): Promise<void>;
}

export const realServerSystem: ServerSystem = {
  run: runCapture,
  worktrees: async ({ identity, root }) => {
    const listed = await listWorktreesAsync(root);
    if (!listed) return null;
    const { listRestorableEntries } = await import("../worktree/restore.ts");
    // Git lists the main checkout first.
    const kept = await listRestorableEntries(identity, listed[0]?.path ?? root);
    return [
      ...listed.filter((w) => !w.isBare).map(({ path, branch }) => ({ path, branch })),
      ...kept.map(({ path, branch }) => ({ path, branch, removed: true })),
    ];
  },
  signal: (pid, sig) => void process.kill(pid, sig),
  sleep: (ms) => Bun.sleep(ms),
};

// lsof exits 1 both for "nothing to report" and after partial output; only a higher code means it died.
const lsofRan = (read: RunResult) => read.exitCode === 0 || read.exitCode === 1;

/** Null when any read failed, so a caller never mistakes that for nothing running. */
export async function readServerSnapshot(repo: ServerRepo, system: ServerSystem = realServerSystem): Promise<ServerSnapshot | null> {
  const [ps, commandRead, cwdRead, listenerRead, worktrees] = await Promise.all([
    system.run(["ps", "-A", "-o", "pid=,ppid=,etime=,lstart=,args="], { timeoutMs: 5_000, env: { ...childEnv(), LC_ALL: "C" } }),
    system.run(["ps", "-A", "-o", "pid=,comm="], { timeoutMs: 5_000 }),
    system.run(["lsof", "-d", "cwd", "-Fpn"], { timeoutMs: 10_000 }),
    system.run(["lsof", "-nP", "-iTCP", "-sTCP:LISTEN"], { timeoutMs: 10_000 }),
    system.worktrees(repo),
  ]);
  const commands = parsePidValueMap(commandRead.stdout);
  const procs = parseServerProcs(ps.stdout, commands);
  const cwds = parseCwdMap(cwdRead.stdout);
  if (ps.exitCode !== 0 || procs.length === 0) return null;
  if (commandRead.exitCode !== 0 || commands.size === 0) return null;
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

/** Read after the pick: a server whose root pid has a new start time is gone, and its pid is another process's now. */
export interface FreshServers {
  servers: RunningServer[];
  procs: Array<Pick<ServerProc, "pid" | "startTime">>;
}

interface StopJob {
  server: RunningServer;
  gone: boolean;
  why: string | null;
  /** Signalled and not yet seen dead. */
  waiting: number[];
}

/** Why nothing in this tree may be signalled: ending any of it would end what runs inside. */
function refusal(server: RunningServer, spare: Set<number>): string | null {
  if (spare.has(server.pid)) return "rt is running inside it.";
  if (server.inside === null) return null;
  return `${server.inside === "shell" ? "A shell" : agentLabel(server.inside)} is running inside it.`;
}

export async function stopServers(
  picked: RunningServer[],
  fresh: FreshServers,
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

  const jobs = picked.map((server): StopJob => {
    const same = (p: { pid: number; startTime: string }) => p.pid === server.pid && p.startTime === server.startTime;
    const now = fresh.servers.find(same);
    if (!now) {
      const running = fresh.procs.some(same);
      return { server, gone: !running, why: running ? "It changed while you were picking." : null, waiting: [] };
    }
    const refused = refusal(now, spare);
    if (refused !== null) return { server, gone: false, why: refused, waiting: [] };
    let why: string | null = null;
    const waiting: number[] = [];
    for (const pid of now.pids) {
      if (pid <= 1 || spare.has(pid)) continue;
      const unsent = send(pid, "SIGTERM");
      if (unsent === null) waiting.push(pid);
      else why ??= unsent;
    }
    return { server, gone: false, why, waiting };
  });

  // A pid leaves for good once it reads dead: seen alive again, it is another process.
  const alive = () => jobs.flatMap((job) => (job.waiting = job.waiting.filter(isAlive)));
  const waitUpTo = async (limitMs: number) => {
    for (let waited = 0; waited < limitMs && alive().length > 0; waited += POLL_MS) await system.sleep(POLL_MS);
  };
  await waitUpTo(ESCALATE_AFTER_MS);
  const stubborn = alive();
  for (const pid of stubborn) send(pid, "SIGKILL");
  if (stubborn.length > 0) await waitUpTo(GIVE_UP_AFTER_MS);
  alive();

  return jobs.map(({ server, gone, why, waiting }): StopOutcome => {
    if (gone) return { server, result: "gone" };
    const failure = why ?? (waiting.length > 0 ? "It did not stop." : null);
    return failure === null ? { server, result: "stopped" } : { server, result: "failed", why: failure };
  });
}
