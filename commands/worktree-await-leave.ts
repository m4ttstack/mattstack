import { closeSync, openSync, readSync, realpathSync, statSync } from "fs";
import { dirname, join, resolve } from "path";
import * as out from "../lib/ui/out.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import { Usage, flagValue } from "../lib/cli-args.ts";
import { listWorktreeRoots } from "../lib/git-worktrees.ts";
import { gitChildEnv, realTreeGuardDeps } from "../lib/mcp/tree-guard.ts";
import { childEnv } from "../lib/subprocess.ts";
import { indexTranscripts } from "../lib/usage/transcripts.ts";
import { departedAt } from "../lib/worktree/departures.ts";
import { loadRegistry, type TreeRecord } from "../lib/worktree/registry.ts";

const USAGE = "rt worktree await-leave <path> --session <id> [--started <iso>] [--start-cwd <path>] [--timeout <seconds>]";
const DEFAULT_TIMEOUT_SECONDS = 60;
const POLL_MS = 2_000;
const CHUNK_BYTES = 64 * 1024;

export type LeaveAnswer =
  | { state: "leaving"; why: string; mainCheckout: string }
  | { state: "reclaimed"; mainCheckout: string }
  | { state: "none" };

export interface LeaveInput {
  tree: TreeRecord | null;
  mainCheckout: string | null;
  /** When this session process started, if known. */
  started: string | null;
  /** The path of the tree the session process started in, if any. */
  startTree: () => string | null;
  /** When the daemon asked this session to leave this tree, if it did. */
  departed: () => string | null;
  /** The session's newest transcript entry from before this process started. */
  lastActive: () => string | null;
}

function after(a: string | undefined, b: string | null): boolean {
  if (a === undefined || b === null) return false;
  const left = Date.parse(a);
  const right = Date.parse(b);
  return Number.isFinite(left) && Number.isFinite(right) && left > right;
}

/**
 * Whether the tree's claim began while this session was away from it. Only a
 * tree the session process started in, claimed before that process started,
 * can have been re-claimed behind its back: any other tree it is in now, it
 * entered or claimed during this run.
 */
function claimedWhileAway(tree: TreeRecord, input: LeaveInput): boolean {
  if (input.started === null || !after(input.started, tree.claimedAt ?? null)) return false;
  if (input.startTree() !== tree.path) return false;
  const lastActive = input.lastActive();
  if (lastActive !== null) return after(tree.claimedAt, lastActive);
  return after(tree.claimedAt, input.departed());
}

/** null means keep waiting. */
export function leaveState(input: LeaveInput): LeaveAnswer | null {
  const { tree, mainCheckout } = input;
  if (!tree || tree.kind !== "ephemeral" || mainCheckout === null) return { state: "none" };
  if (tree.state === "on-deck" || tree.state === "creating") return { state: "reclaimed", mainCheckout };
  if (claimedWhileAway(tree, input)) return { state: "reclaimed", mainCheckout };
  if (tree.leaving) return { state: "leaving", why: tree.leaving.why, mainCheckout };
  return null;
}

function claudeConfigDirs(): string[] {
  return [process.env.CLAUDE_CONFIG_DIR ?? join(process.env.HOME ?? "", ".claude")];
}

/**
 * Reads the transcript from its end, so a long session costs only the entries
 * written since `started`; a transcript that began at or after `started` is
 * settled from its first chunk.
 */
export function readLastActive(sessionId: string, started: string, configDirs: string[] = claudeConfigDirs()): string | null {
  const limit = Date.parse(started);
  if (!Number.isFinite(limit)) return null;
  const file = indexTranscripts(configDirs, new Set([sessionId])).find((f) => f.subagentId === null);
  if (!file) return null;
  let fd: number;
  try {
    fd = openSync(file.path, "r");
  } catch {
    return null;
  }
  try {
    let end = statSync(file.path).size;
    const first = firstTimestamp(fd, Math.min(end, CHUNK_BYTES));
    if (first !== null && Date.parse(first) >= limit) return null;
    let carry = Buffer.alloc(0);
    while (end > 0) {
      const start = Math.max(0, end - CHUNK_BYTES);
      const chunk = Buffer.alloc(end - start);
      readSync(fd, chunk, 0, chunk.length, start);
      const buf = Buffer.concat([chunk, carry]);
      // The chunk's first line may continue into the previous chunk, so it waits in carry until that chunk is read.
      const firstBreak = start === 0 ? -1 : buf.indexOf(0x0a);
      const complete = start === 0 ? buf : firstBreak === -1 ? Buffer.alloc(0) : buf.subarray(firstBreak + 1);
      carry = start === 0 ? Buffer.alloc(0) : firstBreak === -1 ? buf : buf.subarray(0, firstBreak);
      const lines = complete.toString("utf8").split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        const ts = timestampOf(lines[i]!);
        if (ts !== null && Date.parse(ts) < limit) return ts;
      }
      end = start;
    }
    return null;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

function firstTimestamp(fd: number, bytes: number): string | null {
  const head = Buffer.alloc(bytes);
  readSync(fd, head, 0, bytes, 0);
  for (const line of head.toString("utf8").split("\n")) {
    const ts = timestampOf(line);
    if (ts !== null) return ts;
  }
  return null;
}

function timestampOf(line: string): string | null {
  if (!line.includes('"timestamp"')) return null;
  try {
    const ts = (JSON.parse(line) as { timestamp?: unknown }).timestamp;
    return typeof ts === "string" && Number.isFinite(Date.parse(ts)) ? ts : null;
  } catch {
    return null;
  }
}

interface FoundTree {
  repoName: string;
  tree: TreeRecord;
}

export interface AwaitLeaveDeps {
  findTree: (path: string) => FoundTree | null;
  mainCheckoutFor: (found: FoundTree) => string | null;
  departedAt: (treePath: string, sessionId: string) => string | null;
  lastActive: (sessionId: string, started: string) => string | null;
  sleep: (ms: number) => Promise<void>;
}

function lookup(dir: string): FoundTree | null {
  const tryOne = (p: string): FoundTree | null => {
    const hit = realTreeGuardDeps.treeByPath(p);
    const tree = hit ? loadRegistry(hit.repoName).find((t) => t.name === hit.tree) : undefined;
    return hit && tree ? { repoName: hit.repoName, tree } : null;
  };
  const direct = tryOne(dir);
  if (direct) return direct;
  try {
    const real = realpathSync(dir);
    return real === dir ? null : tryOne(real);
  } catch {
    return null;
  }
}

/** The session may sit in a folder inside its tree, so the walk stops at the first ancestor the registry knows. */
function findTreeFrom(path: string): FoundTree | null {
  for (let dir = path; ; dir = dirname(dir)) {
    const found = lookup(dir);
    if (found) return found;
    if (dirname(dir) === dir) return null;
  }
}

function mainCheckoutFor({ repoName, tree }: FoundTree): string | null {
  const main = loadRegistry(repoName).find((t) => t.kind === "main");
  if (main) return main.path;
  return listWorktreeRoots(tree.path, { env: gitChildEnv(childEnv(), { GIT_TERMINAL_PROMPT: "0" }), timeoutMs: 10_000 })[0] ?? null;
}

const REAL_DEPS: AwaitLeaveDeps = {
  findTree: findTreeFrom,
  mainCheckoutFor,
  departedAt,
  lastActive: (sessionId, started) => readLastActive(sessionId, started),
  sleep: (ms) => Bun.sleep(ms),
};

function positional(args: string[]): string | undefined {
  const valued = new Set(["--session", "--started", "--start-cwd", "--timeout"]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (valued.has(a)) i++;
    else if (!a.startsWith("--")) return a;
  }
  return undefined;
}

function usageExit(title: string, why?: string): never {
  out.fail(usageFailure(title, USAGE, why));
  process.exit(2);
}

function once<T>(read: () => T): () => T {
  let done = false;
  let value: T;
  return () => {
    if (!done) {
      value = read();
      done = true;
    }
    return value;
  };
}

/** Never call directly: the mattstack plugin's worktree mod runs it. Always exits 0 with one JSON line on stdout, whichever of the four answers it gives. */
export async function awaitLeaveCommand(args: string[], _ctx?: unknown, overrides: Partial<AwaitLeaveDeps> = {}): Promise<void> {
  out.payloadOnStdout();
  const deps = { ...REAL_DEPS, ...overrides };
  let session: string | undefined;
  let started: string | undefined;
  let startCwd: string | undefined;
  let timeoutRaw: string | undefined;
  try {
    session = flagValue(args, "--session");
    started = flagValue(args, "--started");
    startCwd = flagValue(args, "--start-cwd");
    timeoutRaw = flagValue(args, "--timeout");
  } catch (err) {
    if (err instanceof Usage) usageExit("A flag is missing its value", err.message);
    throw err;
  }
  const path = positional(args);
  if (!path) usageExit("Which worktree?");
  if (!session) usageExit("Which session?");
  if (started !== undefined && !Number.isFinite(Date.parse(started))) usageExit("That start time is not a date", "--started takes an ISO timestamp.");
  const seconds = timeoutRaw === undefined ? DEFAULT_TIMEOUT_SECONDS : Number(timeoutRaw);
  if (!Number.isFinite(seconds) || seconds < 0) usageExit("That timeout is not a number of seconds");

  const deadline = Date.now() + seconds * 1000;
  const sessionId = session;
  const lastActive = once(() => (started === undefined ? null : deps.lastActive(sessionId, started)));
  const startTree = once(() => (startCwd === undefined ? null : (deps.findTree(resolve(startCwd))?.tree.path ?? null)));
  const absolute = resolve(path);
  let cachedFor: string | undefined;
  let cachedMain: string | null = null;

  for (;;) {
    const found = deps.findTree(absolute);
    if (found && cachedFor !== found.tree.path) {
      cachedFor = found.tree.path;
      cachedMain = deps.mainCheckoutFor(found);
    }
    const answer = leaveState({
      tree: found?.tree ?? null,
      mainCheckout: found ? cachedMain : null,
      started: started ?? null,
      startTree,
      departed: () => (found ? deps.departedAt(found.tree.path, sessionId) : null),
      lastActive,
    });
    if (answer) return out.payload(JSON.stringify(answer) + "\n");
    const remaining = deadline - Date.now();
    if (remaining <= 0) return out.payload('{"state":"timeout"}\n');
    await deps.sleep(Math.min(POLL_MS, remaining));
  }
}
