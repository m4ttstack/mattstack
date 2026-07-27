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

/** Strip the decorations a project path picks up in a URL: slashes, `.git`. */
function cleanProjectPath(projectPath: string): string {
  return projectPath
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/, '');
}

/** Both forges resolve project paths case-insensitively, so comparisons do too. */
function sameProject(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Extract "group/project" from a git remote URL.
 *
 * SSH: "git@gitlab.com:group/project.git" -> "group/project"
 * HTTPS: "https://gitlab.com/group/project.git" -> "group/project"
 *
 * Returns null when no path can be read, which callers treat as "unknown
 * scope" rather than "matches nothing".
 */
export function projectPathFromRemoteUrl(remoteUrl: string): string | null {
  const sshMatch = remoteUrl.match(/:([^/].*?)(?:\.git)?$/);
  const raw = sshMatch?.[1] && remoteUrl.includes('@') ? sshMatch[1] : readUrlPath(remoteUrl);
  if (raw === null) return null;
  const path = cleanProjectPath(raw);
  return path === '' ? null : path;
}

function readUrlPath(remoteUrl: string): string | null {
  try {
    return new URL(remoteUrl).pathname;
  } catch {
    return remoteUrl.includes('/') ? remoteUrl : null;
  }
}

/**
 * Extract a project path from an MR/PR web URL.
 *
 * GitLab: "https://gitlab.com/group/project/-/merge_requests/42" -> "group/project"
 * GitHub: "https://github.com/owner/repo/pull/42" -> "owner/repo"
 */
export function projectPathFromWebUrl(webUrl: string | null): string | null {
  if (!webUrl) return null;
  try {
    const parts = new URL(webUrl).pathname.split('/').filter(Boolean);

    const dashIdx = parts.indexOf('-');
    if (dashIdx >= 2) return cleanProjectPath(parts.slice(0, dashIdx).join('/'));

    const pullIdx = parts.indexOf('pull');
    if (pullIdx >= 2) return cleanProjectPath(parts.slice(0, pullIdx).join('/'));

    if (parts.length >= 2) return cleanProjectPath(`${parts[0]}/${parts[1]}`);
  } catch {
    // Invalid URL
  }
  return null;
}

/**
 * Keep only the PRs that belong to `projectPath`.
 *
 * The web URL is the only repo identity a `PullRequest` carries that can be
 * matched against a local remote... `repositoryId` is the forge's own numeric
 * id, which we would have to call the API to resolve. A PR whose project can't
 * be established is dropped: an MR we cannot place is an MR we cannot claim
 * belongs to this repo.
 */
export function filterPRsToProject(prs: PullRequest[], projectPath: string): PullRequest[] {
  const wanted = cleanProjectPath(projectPath);
  return prs.filter((pr) => {
    const prProject = projectPathFromWebUrl(pr.webUrl);
    return prProject !== null && sameProject(prProject, wanted);
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
  for (const pr of prs) {
    const bucket = byRepo.get(pr.repositoryId);
    if (bucket) bucket.push(pr);
    else byRepo.set(pr.repositoryId, [pr]);
  }

  return [...byRepo.values()].flatMap(discoverStacksInRepo);
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
