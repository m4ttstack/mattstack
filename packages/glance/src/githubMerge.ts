import type { MergeMethod, MergePullRequestInput, MergeQueueEntry } from './types.ts';

/** What merge and auto-merge need to know about a pull request and its repository, read in one request. */
export interface GitHubMergeContext {
  nodeId: string;
  headSha: string;
  headBranch: string;
  /** `owner/name` of the repository holding the head branch; null when GitHub no longer knows it (a deleted fork). */
  headRepo: string | null;
  /** The viewer's default merge method for this repository, lowercased; null when GitHub reports none. */
  defaultMethod: MergeMethod | null;
  allowed: Record<MergeMethod, boolean>;
  queueEnabled: boolean;
  inQueue: boolean;
  queueEntry: MergeQueueEntry | null;
}

export const MERGE_CONTEXT_QUERY = `
  query GlanceMergeContext($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      viewerDefaultMergeMethod
      mergeCommitAllowed
      squashMergeAllowed
      rebaseMergeAllowed
      pullRequest(number: $number) {
        id
        headRefOid
        headRefName
        headRepository { nameWithOwner }
        isMergeQueueEnabled
        isInMergeQueue
        mergeQueueEntry { position state }
      }
    }
  }
`;

export interface GHMergeContextResponse {
  repository?: {
    viewerDefaultMergeMethod?: string | null;
    mergeCommitAllowed?: boolean | null;
    squashMergeAllowed?: boolean | null;
    rebaseMergeAllowed?: boolean | null;
    pullRequest?: {
      id: string;
      headRefOid: string;
      headRefName: string;
      headRepository?: { nameWithOwner: string } | null;
      isMergeQueueEnabled?: boolean | null;
      isInMergeQueue?: boolean | null;
      mergeQueueEntry?: { position: number; state: string } | null;
    } | null;
  } | null;
}

const METHODS: readonly MergeMethod[] = ['merge', 'squash', 'rebase'];

function toMergeMethod(value: string | null | undefined): MergeMethod | null {
  const lower = value?.toLowerCase();
  return METHODS.find(m => m === lower) ?? null;
}

/** Null when the response carries no pull request. */
export function toMergeContext(data: GHMergeContextResponse): GitHubMergeContext | null {
  const repo = data.repository;
  const pr = repo?.pullRequest;
  if (!repo || !pr) return null;
  return {
    nodeId: pr.id,
    headSha: pr.headRefOid,
    headBranch: pr.headRefName,
    headRepo: pr.headRepository?.nameWithOwner ?? null,
    defaultMethod: toMergeMethod(repo.viewerDefaultMergeMethod),
    allowed: {
      merge: repo.mergeCommitAllowed === true,
      squash: repo.squashMergeAllowed === true,
      rebase: repo.rebaseMergeAllowed === true
    },
    queueEnabled: pr.isMergeQueueEnabled === true,
    inQueue: pr.isInMergeQueue === true,
    queueEntry: pr.mergeQueueEntry
      ? { position: pr.mergeQueueEntry.position, state: pr.mergeQueueEntry.state }
      : null
  };
}

/**
 * The merge method to send, refused before any write when the repository
 * forbids what the caller asked for. GitHub's REST and GraphQL merges both
 * default to "merge" whatever the repository allows, so the method is always
 * resolved here instead of left to GitHub.
 */
export function pickMergeMethod(
  op: string,
  projectPath: string,
  ctx: Pick<GitHubMergeContext, 'defaultMethod' | 'allowed'>,
  input?: Pick<MergePullRequestInput, 'mergeMethod' | 'squash'>
): MergeMethod {
  const allowedList = METHODS.filter(m => ctx.allowed[m]);
  const allowedText = allowedList.length > 0 ? allowedList.join(', ') : 'none';
  const named = input?.mergeMethod ?? (input?.squash === true ? 'squash' : undefined);
  if (named) {
    if (!ctx.allowed[named]) {
      throw new Error(`${op} failed: ${projectPath} does not allow ${named} merges (allowed: ${allowedText})`);
    }
    return named;
  }
  const def = ctx.defaultMethod;
  if (input?.squash === false) {
    if (def && def !== 'squash' && ctx.allowed[def]) return def;
    const notSquash = allowedList.find(m => m !== 'squash');
    if (!notSquash) {
      throw new Error(
        `${op} failed: ${projectPath} does not allow a merge that is not a squash (allowed: ${allowedText})`
      );
    }
    return notSquash;
  }
  if (def && ctx.allowed[def]) return def;
  const first = allowedList[0];
  if (!first) throw new Error(`${op} failed: ${projectPath} allows no merge method`);
  return first;
}
