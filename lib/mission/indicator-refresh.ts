import type { GitClient } from "../../packages/git-core/src/index.ts";
import type { GitWorktreeBadge } from "../../packages/rt-client/src/commands.ts";
import { toBadge } from "../git-badge.ts";

export const FETCH_MIN_INTERVAL_MS = 30 * 60_000;
export const FETCH_TIMEOUT_MS = 60_000;

export interface IndicatorTarget {
  id: string;
  path: string;
}

export interface IndicatorRefreshDeps {
  client: (dir: string) => GitClient;
  pathExists: (absPath: string) => boolean;
  now: () => Date;
  fetchTimeoutMs?: number;
  /** Aborting it kills an in-flight fetch child, which would otherwise hold the process open after the board quits. */
  signal?: AbortSignal;
}

export type PublishBadge = (id: string, badge: GitWorktreeBadge | null) => void;

function fetchIsStale(lastFetchedAt: string | null, now: Date): boolean {
  return lastFetchedAt === null || now.getTime() - Date.parse(lastFetchedAt) >= FETCH_MIN_INTERVAL_MS;
}

async function fetchWithTimeout(client: GitClient, timeoutMs: number, stop: AbortSignal | undefined): Promise<boolean> {
  const controller = new AbortController();
  const onStop = () => controller.abort();
  stop?.addEventListener("abort", onStop, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.fetch(undefined, controller.signal, { nonInteractive: true }),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("fetch timed out"));
        }, timeoutMs);
        timer.unref?.();
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    stop?.removeEventListener("abort", onStop);
  }
}

export async function refreshIndicator(target: IndicatorTarget, deps: IndicatorRefreshDeps, publish: PublishBadge): Promise<void> {
  if (!deps.pathExists(target.path)) {
    publish(target.id, null);
    return;
  }
  const client = deps.client(target.path);
  try {
    const [snap, fetch] = await Promise.all([client.snapshot(), client.fetchState()]);
    publish(target.id, toBadge(target.path, snap, fetch, deps.now().toISOString()));
    if (!fetchIsStale(fetch.lastFetchedAt, deps.now())) return;
    const hasOrigin = await client.remotes().then((rs) => rs.some((r) => r.name === "origin"), () => false);
    if (!hasOrigin || deps.signal?.aborted) return;
    if (!(await fetchWithTimeout(client, deps.fetchTimeoutMs ?? FETCH_TIMEOUT_MS, deps.signal))) return;
    const [after, afterFetch] = await Promise.all([client.snapshot(), client.fetchState()]);
    publish(target.id, toBadge(target.path, after, afterFetch, deps.now().toISOString()));
  } catch {
    publish(target.id, null);
  }
}
