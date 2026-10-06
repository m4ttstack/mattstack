// src/cli/client.ts
import { bundleRootFromExec } from '../services/bundle-layout.ts';
import {
  deckStartHint,
  liveProbe,
  type Probe,
} from '../services/helper-owner.ts';
import { resolveApiInfo } from './api-info.ts';

export async function deckNotRunning(
  probe: Probe = liveProbe,
  bundleRoot: string | null = bundleRootFromExec()
): Promise<string> {
  return `Deck isn't running. ${await deckStartHint(probe, bundleRoot)}`;
}

/** Retries a request deck never answered, for up to `waitMs`, when running
    inside a deck command run: deck may be redeploying itself alongside the
    run (`bun run build && deck restart <app>`), and comes back in seconds. A
    request deck did answer is never retried, so a write is never repeated. */
export async function withDeckWait(
  attempt: () => Promise<Response>,
  opts: {
    insideRun?: boolean;
    waitMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {}
): Promise<Response> {
  const insideRun = opts.insideRun ?? process.env.DECK_COMMAND_RUN === '1';
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => Bun.sleep(ms));
  const deadline = now() + (opts.waitMs ?? 60_000);
  for (;;) {
    try {
      return await attempt();
    } catch (err) {
      if (!insideRun || now() >= deadline) throw err;
      await sleep(500);
    }
  }
}

export async function apiFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  // No record at all is a deck that is not installed, which no wait fixes;
  // a restarting deck keeps its record and only refuses the connection.
  const first = resolveApiInfo();
  if (!first) throw new Error(await deckNotRunning());
  return withDeckWait(() => {
    const info = resolveApiInfo() ?? first;
    return fetch(`http://127.0.0.1:${info.port}${path}`, init);
  });
}

export async function apiJson(
  path: string,
  init?: RequestInit
): Promise<{ status: number; body: any }> {
  const res = await apiFetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
