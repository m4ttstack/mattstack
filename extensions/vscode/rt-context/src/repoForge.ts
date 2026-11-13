import { forgeOfRemote, type Forge } from './forge';
import { confirmedForgeHost } from './gitlab';
import { getRemoteUrl } from './git';
import type { GitRepository } from './types';

export interface RepoForge {
  remoteUrl: string | null;
  forge: Forge | null;
}

export function resolveRepoForge(repo: GitRepository | null): RepoForge {
  if (!repo) return { remoteUrl: null, forge: null };
  const remoteUrl = getRemoteUrl(repo);
  return { remoteUrl, forge: forgeOfRemote(remoteUrl, confirmedForgeHost()) };
}
