import { parseIdentity } from '@mattstack/rt-client/identity';

/** Human label for a repo identity: last path segment for a `remote` id
    (the repo name, dropping host/group), basename for a `path` id. Falls
    back to the raw string for anything parseIdentity doesn't recognize
    (legacy bare names) so pre-rekey run rows keep rendering unchanged. */
export function repoLabel(repo: string): string {
  const identity = parseIdentity(repo);
  if (!identity) return repo;
  const segments = identity.id.split('/').filter(Boolean);
  return segments.at(-1) ?? repo;
}

/** The repo's group and name for a `remote` id (`acme/web`), dropping a
    leading forge host; otherwise the same as `repoLabel`. */
export function repoPath(repo: string): string {
  const identity = parseIdentity(repo);
  if (!identity || identity.kind !== 'remote') return repoLabel(repo);
  const segments = identity.id.split('/').filter(Boolean);
  if (segments.length > 2 && segments[0]!.includes('.')) segments.shift();
  return segments.join('/') || repo;
}
