import { closeSync, openSync, readdirSync, readSync, statSync } from "fs";
import { join } from "path";

export interface TranscriptHit { path: string; cwd: string; account?: string }

export interface TranscriptDeps {
  home: string;
  cswapAccounts(): Promise<{ number: number; email: string }[]>;
}

const SESSION_ID = /^[A-Za-z0-9-]+$/;
// The first cwd sits within the opening lines; a transcript can run to
// hundreds of megabytes, so only its head is read.
const HEAD_BYTES = 1024 * 1024;

export function firstCwd(path: string): string | null {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0);
    for (const line of buf.subarray(0, n).toString("utf8").split("\n")) {
      if (!line.includes('"cwd"')) continue;
      try {
        const cwd = (JSON.parse(line) as { cwd?: unknown }).cwd;
        if (typeof cwd === "string" && cwd.startsWith("/")) return cwd;
      } catch {
        // the last line can be cut at the buffer edge
      }
    }
    return null;
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
