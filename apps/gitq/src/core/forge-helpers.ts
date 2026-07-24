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

/**
 * Stack discovery: given a list of PRs, walk target→source chains
 * and return independent stack trees.
 *
 * Branches that target the same base branch (e.g. multiple MRs → main)
 * but don't form a chain with each other are split into separate stacks.
 * Only branches connected by a chain (A → B → main) share a stack.
 */
export function discoverStacksFromPRs(prs: PullRequest[]): DiscoveredStack[] {
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
