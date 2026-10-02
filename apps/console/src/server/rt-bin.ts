import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

export type RunRt = (
  argv: string[],
  opts?: { timeoutMs?: number }
) => Promise<{ code: number; stdout: string; stderr: string }>;

export class RtNotFoundError extends Error {
  constructor(searched: string[]) {
    super(`rt binary not found (looked in: ${searched.join(', ')})`);
    this.name = 'RtNotFoundError';
  }
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolved at CALL time, never cached at module load: tests repoint `HOME`
 * to a fixture directory, and a value captured on import would keep
 * pointing at whatever machine first imported this module.
 */
export function resolveRtBin():
  { path: string; searched: string[] } | { path: null; searched: string[] } {
  const searched: string[] = [];

  const primary = join(homedir(), '.local', 'bin', 'rt');
  searched.push(primary);
  if (isExecutable(primary)) return { path: primary, searched };

  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'rt');
    if (candidate === primary) continue;
    searched.push(candidate);
    if (isExecutable(candidate)) return { path: candidate, searched };
  }

  return { path: null, searched };
}

/** A wedged `claude` subprocess inside a wedged `rt` must surface as a 502, not a hung page. */
export const READ_TIMEOUT_MS = 10_000;

/** A write recompiles the pack (a bind regenerates its manifest first), and a
    sync also pushes and refreshes the installed cache: tens of seconds on a
    large pack, where a read takes a second or two. */
export const WRITE_TIMEOUT_MS = 120_000;

/**
 * The one Bun-only call in this module -- unreachable from vitest's Node
 * runtime, same split `embedded/serve.ts` documents for `Bun.file`.
 * `skills.ts` takes this as an injectable parameter defaulting to this
 * export, so routes stay testable without the `Bun` global.
 */
export const runRt: RunRt = async (
  argv,
  { timeoutMs = READ_TIMEOUT_MS } = {}
) => {
  const resolved = resolveRtBin();
  if (resolved.path === null) throw new RtNotFoundError(resolved.searched);

  const proc = Bun.spawn([resolved.path, ...argv], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const timeout = setTimeout(() => proc.kill(), timeoutMs);

  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timeout);
  }
};
