/** Boots the real board server (src/server.ts) as a child of one test file.

    Never a fixed port: a server leaked by an earlier run keeps it, answers
    the next run's /healthz while the new child fails to bind, and every
    request lands on a server whose fixture HOME is gone. Never a spawn at
    module load: `bun test -t` imports every file, and a server spawned by a
    file whose tests are all filtered out is never stopped. */
import { join } from 'path';
import { afterAll, beforeAll } from 'bun:test';

// A cold boot on a loaded CI runner has run past 10s.
const BOOT_MS = 60_000;
const SERVER = join(import.meta.dir, '..', 'server.ts');

// Board knobs a developer's shell may export: an inherited BOARD_STATE_DB
// points the child at the live state.db, and BOARD_FIXTURE makes it refuse
// every POST. HERDR_* goes too (any inherited HERDR_SOCKET_PATH routes a pane
// nudge to the live herdr), and HERDR_BIN names a missing binary so an
// installed herdr is never found by path. The test preload already strips
// RT_DAEMON_SOCK.
const AMBIENT = [
  'BOARD_STATE_DB',
  'BOARD_FIXTURE',
  'BOARD_REVIEW_RECHECK_MS',
  'CLAUDE_BIN',
];

export interface BoardServer {
  readonly port: number;
  readonly origin: string;
  /** Spawns on first call; resolves once /healthz answers. */
  ready(): Promise<void>;
  /** Everything the child wrote to stdout and stderr so far. */
  output(): string;
  /** True once the child has exited or died on a signal. */
  exited(): boolean;
  /** Sends `signal` and resolves with the exit code: 0 for a clean
      shutdown, 128 plus the signal number for a death on it. */
  terminate(signal: NodeJS.Signals): Promise<number>;
  stop(): Promise<void>;
}

export interface BoardServerOptions {
  /** Laid over the runner's env; PORT is always the helper's own. */
  env: Record<string, string>;
  /** Passed to `bun run --preload`. */
  preload?: string;
}

export function freePort(): number {
  const probe = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: { data() {} },
  });
  const { port } = probe;
  probe.stop(true);
  return port;
}

function boardEnv(env: Record<string, string>, port: number) {
  const base: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(base))
    if (key.startsWith('HERDR_') || AMBIENT.includes(key)) delete base[key];
  return {
    ...base,
    HERDR_BIN: join(env.HOME ?? '/nonexistent', 'no-such-herdr'),
    ...env,
    PORT: String(port),
  };
}

function hasExited(child: Bun.Subprocess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/** No hooks: for a boot that a test starts and stops itself. */
export function startBoardServer(opts: BoardServerOptions): BoardServer {
  const port = freePort();
  const origin = `http://127.0.0.1:${port}`;
  let proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined;
  let booting: Promise<void> | undefined;
  let output = '';

  async function drain(stream: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    for await (const chunk of stream)
      output += decoder.decode(chunk, { stream: true });
  }

  async function boot(): Promise<void> {
    const child = Bun.spawn(
      [
        'bun',
        'run',
        ...(opts.preload ? ['--preload', opts.preload] : []),
        SERVER,
      ],
      {
        env: boardEnv(opts.env, port),
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      }
    );
    proc = child;
    const drains = [drain(child.stdout), drain(child.stderr)];
    const deadline = Date.now() + BOOT_MS;
    while (Date.now() < deadline) {
      if (hasExited(child)) {
        await child.exited;
        // A grandchild that inherited the pipes can hold a drain open.
        await Promise.race([Promise.allSettled(drains), Bun.sleep(1_000)]);
        throw new Error(
          `board server died (${child.signalCode ?? `exit ${child.exitCode}`}) before /healthz answered:\n${output}`
        );
      }
      try {
        const res = await fetch(`${origin}/healthz`, {
          signal: AbortSignal.timeout(2_000),
        });
        if (res.ok) return;
      } catch {
        // not listening yet
      }
      await Bun.sleep(100);
    }
    throw new Error(
      `board server never answered /healthz in ${BOOT_MS}ms:\n${output}`
    );
  }

  return {
    port,
    origin,
    ready: () => (booting ??= boot()),
    output: () => output,
    exited: () => (proc ? hasExited(proc) : false),
    async terminate(signal) {
      if (!proc) throw new Error('board server was never started');
      proc.kill(signal);
      return proc.exited;
    },
    async stop() {
      if (!proc) return;
      proc.kill('SIGKILL');
      await proc.exited;
    },
  };
}

/** Boots in this file's beforeAll and kills in its afterAll. */
export function bootBoardServer(opts: BoardServerOptions): BoardServer {
  const server = startBoardServer(opts);
  beforeAll(() => server.ready(), BOOT_MS + 5_000);
  afterAll(() => server.stop());
  return server;
}
