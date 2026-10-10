import { parseIdentity } from '@mattstack/rt-client';

/** A repo the runs page can filter to: the run store's name for it, and the
    repo's own name to show. */
export interface RepoChoice {
  repo: string;
  label: string;
}

const lastSegment = (id: string) => id.split('/').filter(Boolean).pop() ?? id;

/**
 * The repos worth offering as a filter: those rt has registered. A run's
 * `repo` is either a serialized identity or the run store's folder name for
 * one, which is the identity's id with every slash as a dash (rt's
 * `repoIdentitySlug`). Run folders that match no registered repo (test and
 * smoke runs) are left out.
 */
export function repoChoices(
  runRepos: readonly string[],
  registered: readonly string[]
): RepoChoice[] {
  const byName = new Map<string, string>();
  for (const serialized of registered) {
    const identity = parseIdentity(serialized);
    if (!identity) continue;
    const label = lastSegment(identity.id);
    byName.set(serialized, label);
    byName.set(identity.id.replace(/\//g, '-'), label);
  }
  const seen = new Set<string>();
  const out: RepoChoice[] = [];
  for (const repo of runRepos) {
    const label = byName.get(repo);
    if (label === undefined || seen.has(repo)) continue;
    seen.add(repo);
    out.push({ repo, label });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}
