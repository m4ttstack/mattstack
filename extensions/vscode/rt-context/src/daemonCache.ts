import { parseIdentity } from '@mattstack/rt-client';
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
 * An older daemon ignores `repoIdentity` and may hand back another repo's
 * entry, so on GitHub the caller's identity check still decides. A scoped
 * miss asks again unscoped, because a row written with no repo is keyed by
 * the bare branch and only that read finds it; that read keeps only an entry
 * naming no other repo, since GitLab runs no identity check of its own.
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
  const { entry } = await readOnce(query, path, branch);
  if (!repoIdentity || !entry) return entry;
  return namesOtherRepo(entry, repoIdentity) ? null : entry;
}

function namesOtherRepo(entry: DaemonCacheEntry, repoIdentity: string): boolean {
  const named = entry.repoName;
  return !!named && parseIdentity(named) !== null && named !== repoIdentity;
}
