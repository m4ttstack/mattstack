import { identityFromRemote, mayOfferGitLabTokenToHost, normalizeRemote, parseIdentity, serializeIdentity } from '@mattstack/rt-client';
import { extractLinearId } from './branchParser';
import type { LinearTicket } from './linear';
import type { CachedBranchData } from './types';

export type Forge = 'github' | 'gitlab';

export interface ForgeWords {
  site: string;
  short: string;
  long: string;
  title: string;
}

export interface DaemonCacheEntry {
  ticket?: LinearTicket | null;
  mr?: { webUrl?: string | null; provider?: string } | null;
  linearId?: string | null;
  fetchedAt?: number;
  repoName?: string;
}

const GITHUB_WORDS: ForgeWords = { site: 'GitHub', short: 'PR', long: 'pull request', title: 'Pull Request' };
const GITLAB_WORDS: ForgeWords = { site: 'GitLab', short: 'MR', long: 'merge request', title: 'Merge Request' };

const SSH_SCHEME_RE = /^(?:git\+)?ssh:\/\/|^git:\/\//i;

/** Lowercased host (ssh port dropped) and path of a remote, or null when it names neither. */
function hostAndPathOfRemote(remoteUrl: string): { host: string; path: string } | null {
  const normalized = normalizeRemote(remoteUrl);
  if (normalized === null) return null;
  const slash = normalized.indexOf('/');
  let authority = normalized.slice(0, slash);
  if (SSH_SCHEME_RE.test(remoteUrl.trim())) authority = authority.replace(/:\d+$/, '');
  try {
    return { host: new URL(`https://${authority}`).host.toLowerCase(), path: normalized.slice(slash + 1) };
  } catch {
    return null;
  }
}

export function forgeOfRemote(remoteUrl: string | null, confirmedHost: unknown): Forge | null {
  if (remoteUrl === null) return null;
  const parsed = hostAndPathOfRemote(remoteUrl);
  if (!parsed) return null;
  if (parsed.host === 'github.com') return 'github';
  return mayOfferGitLabTokenToHost(parsed.host, confirmedHost) ? 'gitlab' : null;
}

export function forgeWords(forge: Forge | null): ForgeWords {
  return forge === 'github' ? GITHUB_WORDS : GITLAB_WORDS;
}

export function memoizeFor<K, V>(fn: (key: K) => V, ttlMs: number, clock: () => number = Date.now) {
  const memo = new Map<K, { value: V; at: number }>();
  return {
    get(key: K): V {
      const now = clock();
      const hit = memo.get(key);
      if (hit && now - hit.at < ttlMs) return hit.value;
      const value = fn(key);
      memo.set(key, { value, at: now });
      return value;
    },
    clear() {
      memo.clear();
    },
  };
}

const identityMemo = memoizeFor((remoteUrl: string): string | null => {
  const identity = identityFromRemote(remoteUrl);
  return identity === null ? null : serializeIdentity(identity);
}, 60_000);

export function repoIdentityOfRemote(remoteUrl: string): string | null {
  return identityMemo.get(remoteUrl);
}

export function clearRepoIdentityMemo() {
  identityMemo.clear();
}

/** The identity a written cache entry carries: only a GitHub repo stores one, so GitLab's stored data stays as it was. */
export function repoIdentityToStore(
  forge: Forge | null,
  entryIdentity: string | undefined,
  remoteUrl: string | null,
): string | null {
  if (forge !== 'github') return null;
  return entryIdentity ?? (remoteUrl ? repoIdentityOfRemote(remoteUrl) : null);
}

export function prBelongsToRemote(webUrl: string, remoteUrl: string): boolean {
  const remote = hostAndPathOfRemote(remoteUrl);
  if (!remote) return false;
  let url: URL;
  try {
    url = new URL(webUrl);
  } catch {
    return false;
  }
  const prefix = `${remote.host}/${remote.path}/`.toLowerCase();
  return `${url.host}${url.pathname}`.toLowerCase().startsWith(prefix);
}

function isSerializedIdentity(value: string | null | undefined): value is string {
  return !!value && parseIdentity(value) !== null;
}

/**
 * Identity decides when the entry carries a serialized one; the PR URL text decides
 * for an entry with none, or with a legacy display name in its place.
 */
function isForeignEntry(
  identity: string | null | undefined,
  webUrl: string | null | undefined,
  hasMr: boolean,
  remoteUrl: string | null,
): boolean {
  if (remoteUrl === null) return hasMr || isSerializedIdentity(identity);
  if (isSerializedIdentity(identity)) return identity !== repoIdentityOfRemote(remoteUrl);
  return hasMr && !(webUrl && prBelongsToRemote(webUrl, remoteUrl));
}

export function branchDataFromDaemonEntry(
  entry: DaemonCacheEntry,
  forge: Forge | null,
  remoteUrl: string | null,
  branch: string,
  now: number = Date.now(),
  prior?: CachedBranchData | null,
): CachedBranchData {
  const mr = entry.mr ?? null;
  const fetchedAt = entry.fetchedAt ?? now;
  if (forge !== 'github') {
    return {
      ticket: entry.ticket ?? null,
      mrUrl: mr?.webUrl ?? null,
      linearId: entry.linearId || null,
      fetchedAt,
    };
  }
  const repoIdentity = repoIdentityToStore(forge, undefined, remoteUrl);
  const identityField = repoIdentity ? { repoIdentity } : {};
  if (!isForeignEntry(entry.repoName, mr?.webUrl, mr !== null, remoteUrl)) {
    return {
      ticket: entry.ticket ?? null,
      mrUrl: mr?.webUrl ?? null,
      linearId: entry.linearId || null,
      fetchedAt,
      ...(mr !== null || isSerializedIdentity(entry.repoName) ? identityField : {}),
    };
  }
  const ticket = entry.ticket ?? null;
  const named = extractLinearId(branch);
  const own = ownBranchData(prior, forge, remoteUrl);
  const keepOwnPr = own?.mrUrl ? own : null;
  return {
    ticket: ticket !== null && named !== null && ticket.identifier === named ? ticket : keepOwnPr?.ticket ?? null,
    mrUrl: keepOwnPr?.mrUrl ?? null,
    linearId: keepOwnPr?.linearId ?? null,
    fetchedAt,
    ...identityField,
  };
}

export function ownBranchData(
  data: CachedBranchData | null | undefined,
  forge: Forge | null,
  remoteUrl: string | null,
): CachedBranchData | null {
  if (!data) return null;
  if (forge === 'github' && isForeignEntry(data.repoIdentity, data.mrUrl, !!data.mrUrl, remoteUrl)) return null;
  return data;
}
