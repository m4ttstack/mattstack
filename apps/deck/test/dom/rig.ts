// Boots the board's real server in DECK_FIXTURE mode (deterministic status
// payload, inert mutations) and drives it with a real headless Chromium, so
// DOM specs exercise the same HTML/JS/CSS the browser gets in production.
import { copyFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  chromium,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from 'playwright';

const ROOT = join(import.meta.dir, '../..');
const FIXTURE_DIR = join(ROOT, 'test/fixture');

let sharedBrowser: Browser | null = null;
// bun kills a timed-out test's child processes, the shared browser included
// when that test launched it, so every later test would fail on a dead one.
async function getBrowser(): Promise<Browser> {
  if (!sharedBrowser?.isConnected())
    sharedBrowser = await chromium.launch({ headless: true });
  return sharedBrowser;
}

async function freePort(): Promise<number> {
  // Probe-and-release: the window between releasing this port and the spawned
  // server binding it is negligible for a single serialized test file.
  const probe = Bun.serve({ port: 0, fetch: () => new Response('ok') });
  const port = probe.port;
  probe.stop(true);
  // Bun.Server.port is typed number | undefined; an undefined here would
  // silently build a "http://127.0.0.1:undefined" base URL and burn the full
  // healthz retry budget on a confusing timeout instead of failing fast.
  if (port === undefined) throw new Error('probe server had no port');
  return port;
}

const consoleErrorsByPage = new WeakMap<Page, string[]>();

/** Console/page errors observed on `page` since its navigation began. */
export function consoleErrors(page: Page): string[] {
  return consoleErrorsByPage.get(page) ?? [];
}

export interface WithBoardOptions {
  /** Filename under test/fixture/ to serve as status.json instead of the
      default, e.g. "status-stale.json". The server always reads
      <DECK_FIXTURE>/status.json, so this copies the named file into its own
      temp dir under that name rather than parameterizing the server. */
  fixture?: string;
  /** Extra browser context options, e.g. a touch device. */
  context?: BrowserContextOptions;
}

type Server = { proc: ReturnType<typeof Bun.spawn>; base: string };

// A cold start on a loaded machine can take several seconds, and a probed port
// can be taken before the server binds it, so a server that exits while
// starting is retried on a fresh port. The wait stays under the shortest
// per-test timeout in the specs (10s).
const HEALTHY_WITHIN_MS = 8_000;
const START_ATTEMPTS = 3;

async function startServer(
  fixtureDir: string,
  stateDir: string
): Promise<Server> {
  for (let attempt = 1; ; attempt++) {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const proc = Bun.spawn(
      [process.execPath, 'run', join(ROOT, 'src/main.ts'), 'serve'],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          PORT: String(port),
          DECK_FIXTURE: fixtureDir,
          LOCAL_STATE_DIR: stateDir,
          // Never touch the real launchd deck service or ~/.mattstack state.
          LOCAL_APPS_NO_GATEWAY: '1',
          LOCAL_APPS_AUTO_HEAL: '0',
        },
        stdout: 'inherit',
        stderr: 'inherit',
      }
    );
    const deadline = Date.now() + HEALTHY_WITHIN_MS;
    const running = () => proc.exitCode === null && proc.signalCode === null;
    while (Date.now() < deadline && running()) {
      try {
        if ((await fetch(`${base}/healthz`)).ok) return { proc, base };
      } catch {
        /* not listening yet */
      }
      await new Promise(r => setTimeout(r, 100));
    }
    const exit = running() ? null : (proc.signalCode ?? proc.exitCode);
    proc.kill();
    await proc.exited;
    if (exit === null || attempt === START_ATTEMPTS)
      throw new Error(
        `fixture server on ${base} did not become healthy${exit === null ? '' : ` (exited ${exit})`}`
      );
  }
}

export async function withBoard(
  fn: (page: Page) => Promise<void>,
  opts: WithBoardOptions = {}
): Promise<void> {
  const stateDir = mkdtempSync(join(tmpdir(), 'deck-dom-'));

  let fixtureDir = FIXTURE_DIR;
  let fixtureTmp: string | null = null;
  if (opts.fixture) {
    fixtureTmp = mkdtempSync(join(tmpdir(), 'deck-dom-fixture-'));
    copyFileSync(
      join(FIXTURE_DIR, opts.fixture),
      join(fixtureTmp, 'status.json')
    );
    fixtureDir = fixtureTmp;
  }

  let server: Server | null = null;
  try {
    server = await startServer(fixtureDir, stateDir);
    const browser = await getBrowser();
    // Granted globally, not per-spec: the logs screen's "copy all" is the
    // only thing that needs it, and an ungranted context makes
    // navigator.clipboard.writeText() reject silently rather than throw,
    // which would surface as a confusing assertion failure far from the
    // real cause.
    const context = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
      ...opts.context,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    consoleErrorsByPage.set(page, errors);
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(String(err)));

    try {
      await page.goto(server.base);
      await page.waitForSelector('[data-board-ready]');
      await fn(page);
    } finally {
      await context.close();
    }
  } finally {
    if (server) {
      server.proc.kill();
      await server.proc.exited;
    }
    rmSync(stateDir, { recursive: true, force: true });
    if (fixtureTmp) rmSync(fixtureTmp, { recursive: true, force: true });
  }
}
