/**
 * This process's ancestors, nearest first, read from the process table. A
 * hook's command runs under the harness process that fired it, so an
 * ancestor is evidence about who called that no argument or environment
 * variable can forge. Empty when the table cannot be read.
 */

import { runCapture } from "./subprocess.ts";

const MAX_DEPTH = 12;

export async function processAncestry(pid: number = process.pid): Promise<number[]> {
  const ps = await runCapture(["ps", "-A", "-o", "pid=,ppid="], { timeoutMs: 2000 });
  if (ps.exitCode !== 0) return [];
  const parentOf = new Map<number, number>();
  for (const line of ps.stdout.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (m) parentOf.set(Number(m[1]), Number(m[2]));
  }
  const chain: number[] = [];
  let at = parentOf.get(pid);
  while (at !== undefined && at > 1 && chain.length < MAX_DEPTH && !chain.includes(at)) {
    chain.push(at);
    at = parentOf.get(at);
  }
  return chain;
}
