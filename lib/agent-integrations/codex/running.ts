/**
 * The Codex homes running `codex` processes use, read from the process
 * table. A Codex session keeps the user-layer hooks it loaded when it
 * started, managed by rt or not, so this is the evidence that rt's hook
 * program is still in use. It never asks the daemon, so it still answers
 * once `rt uninstall` has stopped it.
 */

import { realpathSync } from "fs";
import { basename, join } from "path";
import { runCapture } from "../../subprocess.ts";

export type PsRun = (argv: [string, ...string[]]) => Promise<{ stdout: string; exitCode: number }>;

const realPs: PsRun = (argv) => runCapture(argv, { timeoutMs: 5000 });

/** `codex ...`, or the npm launcher run through node. */
function isCodex(args: string[]): boolean {
  const [first, second] = args;
  if (first === undefined) return false;
  if (basename(first) === "codex") return true;
  return basename(first) === "node" && second !== undefined && /(^|\/)codex(\.js)?$/.test(second);
}

/** Each pid's CODEX_HOME, else its HOME's `.codex`, else `home`'s. */
export function parseCodexHomes(psEnvOutput: string, home: string): string[] {
  const homes: string[] = [];
  for (const line of psEnvOutput.split("\n")) {
    if (!/^\s*\d+\s/.test(line)) continue;
    const codexHome = /(?:^|\s)CODEX_HOME=(\S+)/.exec(line)?.[1];
    const userHome = /(?:^|\s)HOME=(\S+)/.exec(line)?.[1];
    homes.push(codexHome ?? join(userHome ?? home, ".codex"));
  }
  return homes;
}

/** Null when the process table cannot be read, which callers treat as in use. */
export async function runningCodexHomes(opts: { home: string; ps?: PsRun }): Promise<string[] | null> {
  const ps = opts.ps ?? realPs;
  const all = await ps(["ps", "-A", "-ww", "-o", "pid=,args="]);
  if (all.exitCode !== 0) return null;
  const pids: string[] = [];
  for (const line of all.stdout.split("\n")) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (m && isCodex(m[2]!.trim().split(/\s+/))) pids.push(m[1]!);
  }
  if (pids.length === 0) return [];
  const env = await ps(["ps", "eww", "-o", "pid=,command=", "-p", pids.join(",")]);
  if (env.exitCode !== 0 && env.stdout.trim() === "") return null;
  return parseCodexHomes(env.stdout, opts.home);
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** A value `ps` cut at a space still names the home it starts. */
export function homeInUse(running: readonly string[], codexHome: string): boolean {
  const wanted = [codexHome, real(codexHome)];
  return running.some((r) => wanted.some((w) => r === w || real(r) === w || (w.startsWith(r) && w[r.length] === " ")));
}
