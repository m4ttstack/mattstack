import { mayOfferGitLabTokenToHost } from '@mattstack/rt-client';
import { parseRemoteUrl } from './branchParser';
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
}

const GITHUB_WORDS: ForgeWords = { site: 'GitHub', short: 'PR', long: 'pull request', title: 'Pull Request' };
const GITLAB_WORDS: ForgeWords = { site: 'GitLab', short: 'MR', long: 'merge request', title: 'Merge Request' };

export function forgeOfRemote(remoteUrl: string | null, confirmedHost: unknown): Forge | null {
  if (remoteUrl === null) return null;
  const remote = parseRemoteUrl(remoteUrl);
  if (!remote) return null;
  const host = new URL(remote.host).host.toLowerCase();
  if (host === 'github.com') return 'github';
  return mayOfferGitLabTokenToHost(host, confirmedHost) ? 'gitlab' : null;
}

export function forgeWords(forge: Forge | null): ForgeWords {
  return forge === 'github' ? GITHUB_WORDS : GITLAB_WORDS;
}

export function prBelongsToRemote(webUrl: string, remoteUrl: string): boolean {
  const remote = parseRemoteUrl(remoteUrl);
  if (!remote) return false;
  let url: URL;
  try {
    url = new URL(webUrl);
  } catch {
    return false;
  }
  const prefix = `${remote.host}/${remote.projectPath}/`.toLowerCase();
  return `${url.origin}${url.pathname}`.toLowerCase().startsWith(prefix);
}

function mayShowPr(webUrl: string | null | undefined, remoteUrl: string | null): boolean {
  return !!webUrl && remoteUrl !== null && prBelongsToRemote(webUrl, remoteUrl);
}

export function branchDataFromDaemonEntry(
  entry: DaemonCacheEntry,
  forge: Forge | null,
  remoteUrl: string | null,
  now: number = Date.now(),
): CachedBranchData | null {
  const mr = entry.mr ?? null;
  if (forge === 'github' && mr !== null && !mayShowPr(mr.webUrl, remoteUrl)) return null;
  return {
    ticket: entry.ticket ?? null,
    mrUrl: mr?.webUrl ?? null,
    linearId: entry.linearId || null,
    fetchedAt: entry.fetchedAt ?? now,
  };
}

export function ownBranchData(
  data: CachedBranchData | null | undefined,
  forge: Forge | null,
  remoteUrl: string | null,
): CachedBranchData | null {
  if (!data) return null;
  if (forge === 'github' && data.mrUrl && !mayShowPr(data.mrUrl, remoteUrl)) return null;
  return data;
}
