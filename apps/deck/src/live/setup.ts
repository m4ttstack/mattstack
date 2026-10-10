import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import { composeCommandPath, resolveProgram } from '../services/exec-env.ts';

export interface SetupRun {
  source: string;
  branch: string | null;
  state: 'running' | 'failed';
  log: string[];
  at: string;
}

export interface SetupDeps {
  run?: (
    cmd: string[],
    cwd: string,
    onLine: (line: string) => void
  ) => Promise<number>;
  now?: () => Date;
}

const LOG_LINES = 200;

/** Written only after `bun install` exits 0, so a tree whose install died
    halfway still reads as needing setup. node_modules is git-ignored. */
export function readyMarker(root: string): string {
  return join(root, 'node_modules', '.deck-live-ready');
}

function markReady(root: string): void {
  try {
    mkdirSync(dirname(readyMarker(root)), { recursive: true });
    writeFileSync(readyMarker(root), '');
  } catch {}
}

const runs = new Map<string, SetupRun>();

export function setupFor(app: string): SetupRun | undefined {
  return runs.get(app);
}

export function clearSetup(app: string): void {
  runs.delete(app);
}

export function recordSetupFailure(
  app: string,
  source: string,
  branch: string | null,
  lines: string[],
  now: () => Date = () => new Date()
): void {
  runs.set(app, {
    source,
    branch,
    state: 'failed',
    log: lines.slice(-LOG_LINES),
    at: now().toISOString(),
  });
}

async function pump(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void
): Promise<void> {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      onLine(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  }
  if (buf) onLine(buf);
}

/** Command-run PATH: the bundle's bun cannot load the native addons postinstall needs, so the user's bun wins. */
async function defaultRun(
  cmd: string[],
  cwd: string,
  onLine: (line: string) => void
): Promise<number> {
  const path = composeCommandPath();
  const program = resolveProgram(cmd[0]!, path);
  if (!program) throw new Error(`${cmd[0]} not found on the service PATH`);
  const proc = Bun.spawn([program, ...cmd.slice(1)], {
    cwd,
    env: { ...process.env, PATH: path },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  await Promise.all([pump(proc.stdout, onLine), pump(proc.stderr, onLine)]);
  return proc.exited;
}

export async function runSetup(
  app: string,
  root: string,
  branch: string | null,
  deps: SetupDeps = {}
): Promise<boolean> {
  const run: SetupRun = {
    source: root,
    branch,
    state: 'running',
    log: [],
    at: (deps.now ?? (() => new Date()))().toISOString(),
  };
  runs.set(app, run);
  const push = (line: string) => {
    run.log.push(line);
    if (run.log.length > LOG_LINES) run.log.shift();
  };
  push('$ bun install');
  rmSync(readyMarker(root), { force: true });
  let code: number;
  try {
    code = await (deps.run ?? defaultRun)(['bun', 'install'], root, push);
  } catch (err) {
    push(String(err));
    code = -1;
  }
  if (code === 0) {
    markReady(root);
    if (runs.get(app) === run) runs.delete(app);
    return true;
  }
  run.state = 'failed';
  return false;
}
