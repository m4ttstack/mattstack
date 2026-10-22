import { homedir } from "os";
import { join } from "path";
import type { PaneAccount } from "../packages/rt-client/src/commands.ts";
import type { Probes } from "./setup/probes.ts";
import { childEnv, runCapture } from "./subprocess.ts";

const ACCOUNT_LINE = /^\s*(\d+):\s+(\S+)(?:\s+\[([^\]]+)\])?/;
// The `$$` row is spend, not rate-limit headroom; it is skipped on purpose.
// Lazy label capture tolerates a colon inside the label itself (e.g. "Sub:Label:").
const HEADROOM_LINE = /^\s*[├└]\s+([^$\n]+?):\s+(\d+)%/;

export function parseCswapList(text: string): PaneAccount[] {
  const accounts: PaneAccount[] = [];
  const headroom: string[][] = [];
  for (const line of text.split("\n")) {
    const acct = ACCOUNT_LINE.exec(line);
    if (acct) {
      accounts.push({ slot: Number(acct[1]), email: acct[2]!, ...(acct[3] ? { alias: acct[3] } : {}) });
      headroom.push([]);
      continue;
    }
    const head = HEADROOM_LINE.exec(line);
    if (head && headroom.length) headroom[headroom.length - 1]!.push(`${head[1]!.trim()} ${head[2]}%`);
  }
  return accounts.map((a, i) => (headroom[i]!.length ? { ...a, headroom: headroom[i]!.join(" · ") } : a));
}

/** launchd's PATH does not carry ~/.local/bin, so resolve the binary explicitly. */
export function cswapBin(): string {
  return Bun.which("cswap") ?? join(homedir(), ".local", "bin", "cswap");
}

/** Exit code a `cswapExec` caller sees when it stopped waiting on a slow cswap. */
export const CSWAP_STILL_RUNNING = -2;

type RunOpts = Parameters<typeof runCapture>[1];
type RunResult = Awaited<ReturnType<typeof runCapture>>;
export type CswapSpawn = (argv: [string, ...string[]], env: Record<string, string | undefined>) => Promise<RunResult> | null;

const realSpawn: CswapSpawn = (argv, env) => {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(argv, { env, stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  } catch {
    return null;
  }
  proc.unref();
  return (async () => {
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout as ReadableStream).text(), proc.exited]);
    return { stdout, stderr: "", exitCode };
  })();
};

/** A run this old is assumed wedged: later calls stop joining it and start fresh. */
const INFLIGHT_MAX_AGE_MS = 10 * 60_000;

/**
 * A runCapture stand-in for cswap that never signals the child. `cswap list`
 * can refresh an expired Claude token under Claude Code's own lock, and a
 * kill between its refresh and its write-back loses the account's login. A
 * caller past `timeoutMs` gets `CSWAP_STILL_RUNNING` and cswap finishes on
 * its own; an identical call made meanwhile joins that run instead of
 * starting another.
 *
 * The child is unref'd so it never holds a process open, but the wait timer
 * stays ref'd: in the CLI it is the only thing keeping the event loop alive
 * until cswap answers.
 */
export function createCswapExec(spawn: CswapSpawn = realSpawn, now: () => number = Date.now): typeof runCapture {
  const inflight = new Map<string, { run: Promise<RunResult>; startedAt: number }>();
  return async (argv, opts: RunOpts = {}) => {
    const env = opts.env ?? childEnv();
    const key = JSON.stringify([argv, env.CLAUDE_CONFIG_DIR ?? ""]);
    let entry = inflight.get(key);
    if (entry && now() - entry.startedAt > INFLIGHT_MAX_AGE_MS) entry = undefined;
    if (!entry) {
      const started = spawn(argv, env);
      if (!started) return { stdout: "", stderr: "", exitCode: -1 };
      const fresh = {
        run: started.finally(() => { if (inflight.get(key) === fresh) inflight.delete(key); }),
        startedAt: now(),
      };
      inflight.set(key, fresh);
      entry = fresh;
    }
    const run = entry.run;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<RunResult>((resolve) => {
      timer = setTimeout(() => resolve({ stdout: "", stderr: "", exitCode: CSWAP_STILL_RUNNING }), opts.timeoutMs ?? 10_000);
    });
    try {
      return await Promise.race([run, waited]);
    } finally {
      clearTimeout(timer);
    }
  };
}

export const cswapExec = createCswapExec();

/** The account a `cswap run` caller is actually running as. Only the caller's
    env knows it: `cswap run` sets CLAUDE_CONFIG_DIR per terminal, while a
    bare `claude` launched by the daemon falls back to the global default
    profile, which can be a different account. Undefined for a default-profile
    caller, whose spawns already land on the same account. */
export async function callerCswapAccount(
  env: Record<string, string | undefined>,
  exec: typeof runCapture = cswapExec,
): Promise<string | undefined> {
  if (!env.CLAUDE_CONFIG_DIR) return undefined;
  const res = await exec([cswapBin(), "list", "--json"], { timeoutMs: 5_000, env });
  if (res.exitCode !== 0) return undefined;
  try {
    const parsed = JSON.parse(res.stdout) as { activeAccountNumber?: number | null; accounts?: Array<{ number: number; email: string }> };
    return parsed.accounts?.find((a) => a.number === parsed.activeAccountNumber)?.email;
  } catch {
    return undefined;
  }
}

/** Account number to email, the pairing a cswap config dir's `<number>-` prefix needs. Empty when cswap is missing or answers garbage. */
export async function cswapAccountNumbers(exec: typeof runCapture = cswapExec): Promise<{ number: number; email: string }[]> {
  const res = await exec([cswapBin(), "list", "--json"], { timeoutMs: 5_000 });
  if (res.exitCode !== 0) return [];
  try {
    const parsed = JSON.parse(res.stdout) as { accounts?: Array<{ number?: unknown; email?: unknown }> };
    return (parsed.accounts ?? []).flatMap((a) =>
      typeof a.number === "number" && typeof a.email === "string" ? [{ number: a.number, email: a.email }] : [],
    );
  } catch {
    return [];
  }
}

export async function listCswapAccounts(exec: typeof runCapture = cswapExec): Promise<PaneAccount[]> {
  return (await readCswapAccounts(exec)).accounts;
}

/** listCswapAccounts plus whether cswap was still answering when the wait ran out. */
export async function readCswapAccounts(
  exec: typeof runCapture = cswapExec,
  timeoutMs = 5_000,
): Promise<{ accounts: PaneAccount[]; stillRunning: boolean }> {
  const res = await exec([cswapBin(), "list"], { timeoutMs });
  if (res.exitCode === CSWAP_STILL_RUNNING) return { accounts: [], stillRunning: true };
  if (res.exitCode !== 0) return { accounts: [], stillRunning: false };
  return { accounts: parseCswapList(res.stdout), stillRunning: false };
}

/** Each cswap account's Claude config dir: the folder `cswap run` sets CLAUDE_CONFIG_DIR to, one per account under ~/.claude-swap-backup/sessions. */
export function cswapConfigDirs(p: Pick<Probes, "home" | "readDir" | "statPath">): string[] {
  const root = join(p.home, ".claude-swap-backup", "sessions");
  return p.readDir(root).sort().map((name) => join(root, name)).filter((dir) => p.statPath(dir)?.isDirectory === true);
}
