import { closeSync, openSync, readdirSync, readSync, statSync } from "fs";
import { join } from "path";

export interface TranscriptHit { path: string; cwd: string; account?: string }

export interface TranscriptDeps {
  home: string;
  cswapAccounts(): Promise<{ number: number; email: string }[]>;
}

const SESSION_ID = /^[A-Za-z0-9-]+$/;
// A transcript can run to hundreds of megabytes and its first record (a
// summary, a snapshot, a pasted image) can pass a megabyte on its own, so it
// is read in chunks and stops at the first line that carries a cwd.
const CHUNK_BYTES = 1024 * 1024;

function lineCwd(line: Buffer): string | null {
  const text = line.toString("utf8");
  if (!text.includes('"cwd"')) return null;
  try {
    const cwd = (JSON.parse(text) as { cwd?: unknown }).cwd;
    return typeof cwd === "string" && cwd.startsWith("/") ? cwd : null;
  } catch {
    return null;
  }
}

export function firstCwd(path: string): string | null {
  const fd = openSync(path, "r");
  try {
    const chunk = Buffer.alloc(CHUNK_BYTES);
    let partial: Buffer[] = [];
    for (;;) {
      const n = readSync(fd, chunk, 0, CHUNK_BYTES, null);
      if (n === 0) return partial.length > 0 ? lineCwd(Buffer.concat(partial)) : null;
      const read = chunk.subarray(0, n);
      let start = 0;
      for (let nl = read.indexOf(10, start); nl !== -1; nl = read.indexOf(10, start)) {
        const cwd = lineCwd(Buffer.concat([...partial, read.subarray(start, nl)]));
        if (cwd) return cwd;
        partial = [];
        start = nl + 1;
      }
      if (start < n) partial.push(Buffer.from(read.subarray(start)));
    }
  } finally {
    closeSync(fd);
  }
}

function findIn(configDir: string, sessionId: string): { path: string; mtimeMs: number } | null {
  let projects: string[];
  try {
    projects = readdirSync(join(configDir, "projects"));
  } catch {
    return null;
  }
  for (const project of projects) {
    const path = join(configDir, "projects", project, `${sessionId}.jsonl`);
    try {
      return { path, mtimeMs: statSync(path).mtimeMs };
    } catch {
      continue;
    }
  }
  return null;
}

export async function locateTranscript(
  sessionId: string,
  preferredAccount: string | undefined,
  deps: TranscriptDeps,
): Promise<TranscriptHit | null> {
  if (!SESSION_ID.test(sessionId)) return null;
  const base = findIn(join(deps.home, ".claude"), sessionId);
  const root = join(deps.home, ".claude-swap-backup", "sessions");
  let names: string[] = [];
  try {
    names = readdirSync(root).sort();
  } catch {
    names = [];
  }
  const accounts = names.length > 0 ? await deps.cswapAccounts() : [];
  const swapped: { path: string; mtimeMs: number; account: string }[] = [];
  for (const name of names) {
    const hit = findIn(join(root, name), sessionId);
    if (!hit) continue;
    const number = Number(/^(\d+)-/.exec(name)?.[1]);
    const email = accounts.find((a) => a.number === number)?.email;
    if (email) swapped.push({ ...hit, account: email });
  }
  const preferred = preferredAccount ? swapped.find((h) => h.account === preferredAccount) : undefined;
  const newest = [...swapped].sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  const chosen: { path: string; account?: string } | undefined = preferred ?? base ?? newest;
  if (!chosen) return null;
  const cwd = firstCwd(chosen.path);
  if (!cwd) return null;
  return { path: chosen.path, cwd, ...(chosen.account !== undefined && { account: chosen.account }) };
}
