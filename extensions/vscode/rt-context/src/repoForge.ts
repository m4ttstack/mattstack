import { forgeOfRemote, type Forge } from './forge';
import { confirmedForgeHost } from './gitlab';
import { getRemoteUrl } from './git';
import type { GitRepository } from './types';

export interface RepoForge {
  remoteUrl: string | null;
  forge: Forge | null;
}

const CONFIRMED_HOST_TTL_MS = 60_000;
let confirmedHostMemo: { host: string | null; at: number } | null = null;

function confirmedHostForForge(): string | null {
  const now = Date.now();
  if (!confirmedHostMemo || now - confirmedHostMemo.at >= CONFIRMED_HOST_TTL_MS) {
    confirmedHostMemo = { host: confirmedForgeHost(), at: now };
  }
  return confirmedHostMemo.host;
}

export function resolveRepoForge(repo: GitRepository | null): RepoForge {
  if (!repo) return { remoteUrl: null, forge: null };
  const remoteUrl = getRemoteUrl(repo);
  return { remoteUrl, forge: forgeOfRemote(remoteUrl, confirmedHostForForge()) };
}
