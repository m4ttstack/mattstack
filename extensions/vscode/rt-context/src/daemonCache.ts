import type { DaemonResponse } from './daemonClient';
import type { DaemonCacheEntry } from './forge';

export type DaemonQuery = (path: string) => Promise<DaemonResponse | null>;

type Read = { entry: DaemonCacheEntry | null; reachable: boolean };

async function readOnce(query: DaemonQuery, path: string, branch: string): Promise<Read> {
  const response = await query(path);
  if (!response?.ok) return { entry: null, reachable: false };
  const entries = (response.data ?? {}) as Record<string, DaemonCacheEntry>;
  return { entry: entries[branch] ?? Object.values(entries)[0] ?? null, reachable: true };
}

/**
 * An older daemon ignores `repoIdentity`, and a scoped miss asks again
 * unscoped because a row written with no repo is keyed by the bare branch.
 * Either read can hand back another repo's entry; the caller's forge check
 * decides, never this read. Dropping an entry here would send the caller to
 * its direct fetch, which looks the MR up on GitLab.
 */
export async function readDaemonCacheEntry(
  query: DaemonQuery,
  branch: string,
  repoIdentity: string | null,
): Promise<DaemonCacheEntry | null> {
  const path = `/api/cache/${encodeURIComponent(branch)}`;
  if (repoIdentity) {
    const scoped = await readOnce(query, `${path}?repoIdentity=${encodeURIComponent(repoIdentity)}`, branch);
    if (scoped.entry || !scoped.reachable) return scoped.entry;
  }
  return (await readOnce(query, path, branch)).entry;
}
