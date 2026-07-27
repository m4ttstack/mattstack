import type { PullRequest } from '@workforge/glance-sdk';
import type { DiffStats, PipelineStatus } from './types.ts';

export interface DiscoveredStack {
  root: string;
  branches: string[];
  mrMap: Map<string, PullRequest>;
}

/** Index a PR list by source branch for O(1) lookup. */
export function indexBySource(prs: PullRequest[]): Map<string, PullRequest> {
  const map = new Map<string, PullRequest>();
  for (const pr of prs) {
    map.set(pr.sourceBranch, pr);
  }
  return map;
}

// ── Repo scoping ─────────────────────────────────────────────────────────────

/**
 * A forge project, as far as a URL can identify one.
 *
 * `host` is null when the URL it was read from carries none (a bare
 * "group/project" scope, a local path remote), which the comparison below
 * reads as "says nothing about the instance" rather than "no instance".
 */
export interface ProjectScope {
  host: string | null;
  path: string;
}

/** Strip the decorations a project path picks up in a URL: slashes, `.git`. */
function cleanProjectPath(projectPath: string): string {
  return projectPath
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/, '');
}

/**
 * Hosts are case-insensitive, and `www.` never distinguishes two forges.
 *
 * A single-label host is not one we can compare: `git@work:acme/web.git` names
 * an `~/.ssh/config` alias, not a forge, and no MR web URL will ever carry it.
 * Reading it as an instance would filter out every MR of a repo cloned that
 * way, so it counts as naming no host at all.
 */
function cleanHost(host: string): string | null {
  const cleaned = host.trim().toLowerCase().replace(/^www\./, '');
  return cleaned.includes('.') ? cleaned : null;
}

/**
 * Both forges resolve project paths case-insensitively, so comparisons do too.
 *
 * The host decides alongside the path whenever both sides carry one: the same
 * "acme/web" exists on github.com, on gitlab.com and on every self-hosted
 * instance, and they are different projects. A side without a host cannot rule
 * anything out, so it doesn't.
 */
function sameProject(a: ProjectScope, b: ProjectScope): boolean {
  if (a.path.toLowerCase() !== b.path.toLowerCase()) return false;
  return a.host === null || b.host === null || a.host === b.host;
}

/**
 * Extract "group/project" from a git remote URL.
 *
 * SSH: "git@gitlab.com:group/project.git" -> "group/project"
 * HTTPS: "https://gitlab.com/group/project.git" -> "group/project"
 *
 * Returns null when no path can be read. What that means is the caller's to
 * decide: discovery reads it as "no scope" and lists everything, `import`
 * refuses rather than rebuild a store from another project's MRs.
 */
export function projectPathFromRemoteUrl(remoteUrl: string): string | null {
  return projectScopeFromRemoteUrl(remoteUrl)?.path ?? null;
}

/** {@link projectPathFromRemoteUrl}, keeping the host the remote named. */
export function projectScopeFromRemoteUrl(remoteUrl: string): ProjectScope | null {
  // Only the scp-like form (no scheme) puts the path after a colon. Matching
  // a colon in "ssh://git@host:2222/group/project" would read the port.
  const scpMatch = remoteUrl.includes('://') ? null : remoteUrl.match(/^[^/]*@([^/:]+):(.+)$/);
  if (scpMatch) return scope(cleanHost(scpMatch[1] ?? ''), scpMatch[2] ?? '');

  try {
    const url = new URL(remoteUrl);
    return scope(cleanHost(url.hostname), url.pathname);
  } catch {
    // Not a URL at all: a bare path ("/srv/git/group/project.git") names a
    // project but no instance.
    return remoteUrl.includes('/') ? scope(null, remoteUrl) : null;
  }
}

function scope(host: string | null, rawPath: string): ProjectScope | null {
  const path = cleanProjectPath(rawPath);
  return path === '' ? null : { host, path };
}

/**
 * Extract a project path from an MR/PR web URL.
 *
 * GitLab: "https://gitlab.com/group/project/-/merge_requests/42" -> "group/project"
 * GitHub: "https://github.com/owner/repo/pull/42" -> "owner/repo"
 */
export function projectPathFromWebUrl(webUrl: string | null): string | null {
  return projectScopeFromWebUrl(webUrl)?.path ?? null;
}

/** {@link projectPathFromWebUrl}, keeping the host the URL named. */
export function projectScopeFromWebUrl(webUrl: string | null): ProjectScope | null {
  if (!webUrl) return null;

  let url: URL;
  try {
    url = new URL(webUrl);
  } catch {
    return null;
  }

  const parts = url.pathname.split('/').filter(Boolean);
  const host = cleanHost(url.hostname);

  const dashIdx = parts.indexOf('-');
  if (dashIdx >= 2 && parts[dashIdx + 1] === 'merge_requests') {
    return scope(host, parts.slice(0, dashIdx).join('/'));
  }

  const pullIdx = parts.indexOf('pull');
  if (pullIdx >= 2) return scope(host, parts.slice(0, pullIdx).join('/'));

  // Anything else is not an MR/PR url. Reading the first two segments of an
  // arbitrary URL as a project would invent one ("gitlab.com/project/-/..."
  // is not the project "project/-"), and an invented project matches, or
  // fails to match, a scope for no reason.
  return null;
}

/**
 * Keep only the PRs that belong to `wanted` ("group/project", or a
 * {@link ProjectScope} when the host is known too).
 *
 * The web URL is the only repo identity a `PullRequest` carries that can be
 * matched against a local remote... `repositoryId` is the forge's own numeric
 * id, which we would have to call the API to resolve. A PR whose project can't
 * be established is dropped: an MR we cannot place is an MR we cannot claim
 * belongs to this repo.
 */
export function filterPRsToProject(prs: PullRequest[], wanted: string | ProjectScope): PullRequest[] {
  const target = typeof wanted === 'string' ? scope(null, wanted) : scope(wanted.host, wanted.path);
  if (target === null) return [];

  return prs.filter((pr) => {
    const prScope = projectScopeFromWebUrl(pr.webUrl);
    return prScope !== null && sameProject(prScope, target);
  });
}

/**
 * Stack discovery: given a list of PRs, walk target→source chains
 * and return independent stack trees.
 *
 * Branches that target the same base branch (e.g. multiple MRs → main)
 * but don't form a chain with each other are split into separate stacks.
 * Only branches connected by a chain (A → B → main) share a stack.
 *
 * Chains are walked one repository at a time. Branch names are only unique
 * within a repository... `main`, `develop` and `fix-tests` collide across
 * unrelated projects as a matter of routine, and a single adjacency map over
 * mixed repos would splice those collisions into a stack that exists nowhere.
 */
export function discoverStacksFromPRs(prs: PullRequest[]): DiscoveredStack[] {
  const byRepo = new Map<string, PullRequest[]>();
  // A PR the forge gave no repository id for gets a bucket to itself. Pooling
  // them under one empty key would splice unrelated repos back together...
  // exactly the collision the bucketing exists to prevent. A bucket of one
  // never reaches the two-branch minimum, so such a PR joins no stack.
  const unidentified: PullRequest[][] = [];

  for (const pr of prs) {
    if (!pr.repositoryId) {
      unidentified.push([pr]);
      continue;
    }
    const bucket = byRepo.get(pr.repositoryId);
    if (bucket) bucket.push(pr);
    else byRepo.set(pr.repositoryId, [pr]);
  }

  return [...byRepo.values(), ...unidentified].flatMap(discoverStacksInRepo);
}

/** Stack discovery within a single repository, where branch names are unique. */
function discoverStacksInRepo(prs: PullRequest[]): DiscoveredStack[] {
  const prBySource = indexBySource(prs);
  const childrenOf = new Map<string, string[]>();

  for (const pr of prs) {
    const children = childrenOf.get(pr.targetBranch) ?? [];
    children.push(pr.sourceBranch);
    childrenOf.set(pr.targetBranch, children);
  }

  const sourceBranches = new Set(prs.map((pr) => pr.sourceBranch));
  const roots = new Set<string>();
  for (const pr of prs) {
    if (!sourceBranches.has(pr.targetBranch)) {
      roots.add(pr.targetBranch);
    }
  }

  const stacks: DiscoveredStack[] = [];
  for (const root of roots) {
    const directChildren = childrenOf.get(root) ?? [];

    for (const child of directChildren) {
      const branches: string[] = [];
      const mrMap = new Map<string, PullRequest>();
      const queue = [child];

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) break;
        branches.push(current);
        const pr = prBySource.get(current);
        if (pr) mrMap.set(current, pr);
        const grandchildren = childrenOf.get(current) ?? [];
        for (const gc of grandchildren) {
          queue.push(gc);
        }
      }

      if (branches.length >= 2) {
        stacks.push({ root, branches, mrMap });
      }
    }
  }

  return stacks;
}

/** Normalize a forge pipeline status string to our PipelineStatus union. */
export function normalizePipelineStatus(
  status: string | null | undefined,
): PipelineStatus {
  switch (status) {
    case 'success':
      return 'success';
    case 'failed':
    case 'canceled':
      return 'failed';
    case 'running':
      return 'running';
    case 'pending':
    case 'created':
    case 'waiting_for_resource':
    case 'preparing':
    case 'scheduled':
      return 'pending';
    default:
      return 'unknown';
  }
}

/** Map forge PR diffStats to our DiffStats shape (null-safe). */
export function mapDiffStats(prDiffStats: PullRequest['diffStats']): DiffStats | null {
  if (!prDiffStats) return null;
  return {
    additions: prDiffStats.additions,
    deletions: prDiffStats.deletions,
    filesChanged: prDiffStats.filesChanged,
  };
}
