import { identityFromRemote } from '@mattstack/rt-client';

/**
 * The raw `host/path` identity that keys a repo-scoped settings section, or
 * null. `identityFromRemote` returns a tagged `{ kind, id }`; the resolver
 * wants the bare string, and quietly reads no repo section when handed the
 * object instead.
 */
export function repoIdentityFromRemote(remoteUrl: string): string | null {
  const identity = identityFromRemote(remoteUrl);
  return identity?.kind === 'remote' ? identity.id : null;
}
