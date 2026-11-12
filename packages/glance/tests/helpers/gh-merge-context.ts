import type { GHMergeContextResponse } from '../../src/githubMerge.ts';
import type { MergeMethod } from '../../src/types.ts';

export interface MergeContextOptions {
  viewerDefaultMergeMethod?: string | null;
  allowed?: MergeMethod[];
  queueEnabled?: boolean;
  nodeId?: string;
  headBranch?: string;
  headRepo?: string | null;
}

/** A GraphQL `data` payload for the merge context read; defaults to a repository allowing every method. */
export function mergeContextData({
  viewerDefaultMergeMethod = 'MERGE',
  allowed = ['merge', 'squash', 'rebase'],
  queueEnabled = false,
  nodeId = 'PR_node',
  headBranch = 'feature',
  headRepo = 'o/r'
}: MergeContextOptions = {}): GHMergeContextResponse {
  return {
    repository: {
      viewerDefaultMergeMethod,
      mergeCommitAllowed: allowed.includes('merge'),
      squashMergeAllowed: allowed.includes('squash'),
      rebaseMergeAllowed: allowed.includes('rebase'),
      pullRequest: {
        id: nodeId,
        headRefOid: 'abc123',
        headRefName: headBranch,
        headRepository: headRepo ? { nameWithOwner: headRepo } : null,
        isMergeQueueEnabled: queueEnabled,
        isInMergeQueue: false,
        mergeQueueEntry: null
      }
    }
  };
}

export function isMergeContextQuery(query: string): boolean {
  return query.includes('GlanceMergeContext');
}
