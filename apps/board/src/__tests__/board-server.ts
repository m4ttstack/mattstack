/** Boots the real board server (src/server.ts) as a child of one test file.

    A hardcoded port let a server leaked by an earlier run (its parent
    killed before afterAll, or a `-t` filter that skipped it) answer the next
    run's /healthz while the new child failed to bind, so every request hit a
    stale server whose fixture HOME was gone. Each boot here takes a port the
    OS just reported free, spawns from beforeAll (bun skips it when a filter
    leaves the file nothing to run) and gives up the moment the child exits. */
import { join } from 'path';
import { afterAll, beforeAll } from 'bun:test';

// A cold boot on a loaded CI runner has run past 10s.
const BOOT_MS = 60_000;
const SERVER = join(import.meta.dir, '..', 'server.ts');

export interface BoardServer {
  readonly port: number;
  /** `http://127.0.0.1:<port>` */
  readonly origin: string;
  /** Spawns on first call; resolves once /healthz answers. */
  ready(): Promise<void>;
  /** Everything the child wrote to stdout and stderr so far. */
  output(): string;
  /** null while the child runs, and before it is spawned. */
  exitCode(): number | null;
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

/** The test preload already strips RT_DAEMON_SOCK, but an inherited
    HERDR_SOCKET_PATH, or an installed herdr found by path, would still route
    a pane nudge or launch to the developer's live herdr. */
function childEnv(env: Record<string, string>, port: number) {
  const base: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(base))
    if (key.startsWith('HERDR_')) delete base[key];
  return {
    ...base,
    HERDR_BIN: join(env.HOME ?? '/nonexistent', 'no-such-herdr'),
    ...env,
    PORT: String(port),
  };
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
        env: childEnv(opts.env, port),
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      }
    );
    proc = child;
    void drain(child.stdout);
    void drain(child.stderr);
    const deadline = Date.now() + BOOT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode !== null)
        throw new Error(
          `board server exited ${child.exitCode} before /healthz answered:\n${output}`
        );
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
    exitCode: () => proc?.exitCode ?? null,
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
