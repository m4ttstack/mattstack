/** PRs per fill request; keeps one request well under GitHub's GraphQL node limit. */
export const FILL_BATCH_SIZE = 25;

export interface GHFillActor {
  __typename: 'User' | 'Bot' | 'Mannequin' | 'Organization' | 'EnterpriseUserAccount';
  login: string;
  avatarUrl: string | null;
  databaseId?: number | null;
  name?: string | null;
}

export type GHFillContext =
  | {
      __typename: 'CheckRun';
      databaseId: number;
      name: string;
      status: string;
      conclusion: string | null;
      startedAt: string | null;
      completedAt: string | null;
      detailsUrl: string | null;
      isRequired: boolean;
      checkSuite: {
        workflowRun: {
          databaseId: number;
          runNumber: number;
          workflow: { name: string };
        } | null;
      } | null;
    }
  | {
      __typename: 'StatusContext';
      context: string;
      state: string;
      targetUrl: string | null;
      createdAt: string;
      isRequired: boolean;
    };

export interface GHFillReview {
  state: string;
  submittedAt: string | null;
  author: GHFillActor | null;
}

export interface GHFillUser {
  login: string;
  databaseId: number | null;
  name: string | null;
  avatarUrl: string | null;
}

export interface GHFillNode {
  id: string;
  databaseId: number;
  number: number;
  title: string;
  /** Absent at list weight. */
  body?: string | null;
  state: string;
  isDraft: boolean;
  url: string;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  mergeable: string;
  mergeStateStatus: string;
  reviewDecision: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  baseRepository: {
    databaseId: number;
    nameWithOwner: string;
    defaultBranchRef: { name: string } | null;
  } | null;
  baseRef: {
    branchProtectionRule: { requiredApprovingReviewCount: number | null } | null;
  } | null;
  author: GHFillActor | null;
  assignees: { nodes: GHFillUser[] };
  reviewRequests: {
    nodes: Array<{
      requestedReviewer: {
        login?: string;
        databaseId?: number | null;
        name?: string | null;
        avatarUrl?: string | null;
        slug?: string;
      } | null;
    }>;
  };
  latestReviews: { nodes: GHFillReview[] };
  latestOpinionatedReviews: { nodes: GHFillReview[] };
  reviewThreads: { totalCount: number; nodes: Array<{ isResolved: boolean }> };
  autoMergeRequest: {
    mergeMethod: string;
    enabledBy: { login: string } | null;
  } | null;
  commits: {
    nodes: Array<{
      commit: {
        oid: string;
        statusCheckRollup: {
          state: string;
          contexts: {
            totalCount: number;
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: GHFillContext[];
          };
        } | null;
      };
    }>;
  };
}

const ACTOR =
  '{ __typename login avatarUrl ... on User { databaseId name } ... on Bot { databaseId } }';

function contextsSelection(number: number, args: string): string {
  return `contexts(${args}) { totalCount pageInfo { hasNextPage endCursor }
    nodes { __typename
      ... on CheckRun { databaseId name status conclusion startedAt completedAt
        detailsUrl isRequired(pullRequestNumber: ${number})
        checkSuite { workflowRun { databaseId runNumber workflow { name } } } }
      ... on StatusContext { context state targetUrl createdAt
        isRequired(pullRequestNumber: ${number}) } } }`;
}

function fillFields(number: number, listWeight: boolean): string {
  const body = listWeight ? '' : ' body';
  return `id databaseId number title${body} state isDraft url createdAt updatedAt mergedAt
mergeable mergeStateStatus reviewDecision additions deletions changedFiles
headRefName headRefOid baseRefName
baseRepository { databaseId nameWithOwner defaultBranchRef { name } }
baseRef { branchProtectionRule { requiredApprovingReviewCount } }
author ${ACTOR}
assignees(first: 20) { nodes { login databaseId name avatarUrl } }
reviewRequests(first: 20) { nodes { requestedReviewer {
  ... on User { login databaseId name avatarUrl } ... on Team { slug } } } }
latestReviews(first: 50) { nodes { state submittedAt author ${ACTOR} } }
latestOpinionatedReviews(first: 50) { nodes { state submittedAt author ${ACTOR} } }
reviewThreads(first: 100) { totalCount nodes { isResolved } }
autoMergeRequest { mergeMethod enabledBy { login } }
commits(last: 1) { nodes { commit { oid statusCheckRollup { state
  ${contextsSelection(number, 'first: 100')} } } } }`;
}

function repoHead(owner: string, repo: string): string {
  return `repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)})`;
}

export function buildFillQuery(
  owner: string,
  repo: string,
  numbers: number[],
  opts: { listWeight: boolean }
): string {
  const aliases = numbers
    .map((n) => `p${n}: pullRequest(number: ${n}) { ${fillFields(n, opts.listWeight)} }`)
    .join('\n');
  return `query { ${repoHead(owner, repo)} {\n${aliases}\n} }`;
}

export function buildContextsPageQuery(
  owner: string,
  repo: string,
  number: number,
  after: string
): string {
  return `query { ${repoHead(owner, repo)} {
p${number}: pullRequest(number: ${number}) { commits(last: 1) { nodes { commit { statusCheckRollup {
  ${contextsSelection(number, `first: 100, after: ${JSON.stringify(after)}`)} } } } } }
} }`;
}

/** Reads the PR numbers from the `p<n>: pullRequest(number: <n>)` aliases of a fill or contexts-page query. */
export function parseFillAliases(query: string): number[] {
  return [...query.matchAll(/\bp(\d+): pullRequest\(number: \d+\)/g)].map((m) => Number(m[1]));
}
