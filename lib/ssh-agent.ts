/**
 * Finds an ssh-agent socket that holds a key.
 *
 * herdr hands every pane SSH_AUTH_SOCK=<herdr socket>.agent, a symlink it
 * points at the agent it saw when it started, or at a dead path when it saw
 * none. A key loaded afterwards lands in another agent the pane never sees,
 * so a pane spawn and a failed fetch look for one that does hold a key.
 */

import { lstatSync, readdirSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";

/** `ssh-add -l`'s exit: 0 holds a key, 1 holds none, 2 unreachable; null when it timed out or could not run. */
export type AgentCheck = 0 | 1 | 2 | null;

export interface AgentProbeDeps {
  launchdSocket(): Promise<string | undefined>;
  envSocket: string | undefined;
  scanSockets(): string[];
  check(socket: string): Promise<AgentCheck>;
}

const CHECK_TIMEOUT_MS = 2_000;
const MAX_SCANNED = 8;

async function runQuiet(argv: string[], env: Record<string, string | undefined>): Promise<{ code: number | null; stdout: string }> {
  try {
    const proc = Bun.spawn(argv, { env, stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const timer = setTimeout(() => proc.kill(), CHECK_TIMEOUT_MS);
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    clearTimeout(timer);
    return { code: proc.signalCode ? null : code, stdout };
  } catch {
    return { code: null, stdout: "" };
  }
}

/** /tmp is world-writable: a socket another user planted there would receive this user's ssh sign requests. */
function ownedByMe(path: string, uid: number): boolean {
  try {
    return lstatSync(path).uid === uid;
  } catch {
    return false;
  }
}

export function listSockets(dir: string, dirPrefix: string, filePrefix: string, uid: number = process.getuid!()): { path: string; mtime: number }[] {
  const found: { path: string; mtime: number }[] = [];
  let dirs: string[];
  try {
    dirs = readdirSync(dir).filter((d) => d.startsWith(dirPrefix));
  } catch {
    return found;
  }
  for (const d of dirs) {
    const sub = join(dir, d);
    if (!lstatSync(sub, { throwIfNoEntry: false })?.isDirectory() || !ownedByMe(sub, uid)) continue;
    let files: string[];
    try {
      files = readdirSync(sub).filter((f) => f.startsWith(filePrefix));
    } catch {
      continue;
    }
    for (const f of files) {
      const path = join(sub, f);
      try {
        const st = lstatSync(path);
        if (st.isSocket() && st.uid === uid) found.push({ path, mtime: st.mtimeMs });
      } catch {
        /* gone between readdir and stat */
      }
    }
  }
  return found;
}

/** ssh-agent's own sockets (`~/.ssh/agent/s.*` from OpenSSH 10, `ssh-XXXX/agent.<pid>` before it) and macOS's launchd agent (`com.apple.launchd.*\/Listeners`), newest first. */
function scanDefaultSockets(home: string): string[] {
  const roots = [...new Set([tmpdir(), process.env.TMPDIR, "/tmp", "/private/tmp"].filter((d): d is string => !!d))];
  const found = [
    ...listSockets(join(home, ".ssh"), "agent", "s."),
    ...roots.flatMap((r) => [...listSockets(r, "ssh-", "agent."), ...listSockets(r, "com.apple.launchd.", "Listeners")]),
  ];
  const seen = new Set<string>();
  return found
    .sort((a, b) => b.mtime - a.mtime)
    .map((s) => s.path)
    .filter((p) => (seen.has(p) ? false : (seen.add(p), true)))
    .slice(0, MAX_SCANNED);
}

export function defaultAgentProbeDeps(env: NodeJS.ProcessEnv = process.env): AgentProbeDeps {
  return {
    launchdSocket: async () => (await runQuiet(["/bin/launchctl", "getenv", "SSH_AUTH_SOCK"], env)).stdout.trim() || undefined,
    envSocket: env.SSH_AUTH_SOCK || undefined,
    scanSockets: () => scanDefaultSockets(env.HOME ?? homedir()),
    check: async (socket) => {
      const { code } = await runQuiet(["/usr/bin/ssh-add", "-l"], { ...env, SSH_AUTH_SOCK: socket });
      return code === 0 || code === 1 || code === 2 ? code : null;
    },
  };
}

/** A pane launch waits on this search, so every probe after the first shares one budget. */
const SEARCH_BUDGET_MS = 5_000;

/** The first socket holding a key, `preferred` first; undefined when none does or the budget runs out. */
export async function findAgentWithKey(
  preferred: string | undefined,
  deps: AgentProbeDeps = defaultAgentProbeDeps(),
  now: () => number = Date.now,
): Promise<{ socket: string; preferred: boolean } | undefined> {
  if (preferred && (await deps.check(preferred)) === 0) return { socket: preferred, preferred: true };
  const deadline = now() + SEARCH_BUDGET_MS;
  const tried = new Set(preferred ? [preferred] : []);
  const ordered = [await deps.launchdSocket(), deps.envSocket];
  for (const socket of [...ordered, ...deps.scanSockets()]) {
    if (now() >= deadline) return undefined;
    if (!socket || tried.has(socket)) continue;
    tried.add(socket);
    if ((await deps.check(socket)) === 0) return { socket, preferred: false };
  }
  return undefined;
}

export function looksLikeSshAuthFailure(gitOutput: string): boolean {
  return /Permission denied \(publickey|Could not open a connection to your authentication agent|Error connecting to agent/.test(gitOutput);
}
