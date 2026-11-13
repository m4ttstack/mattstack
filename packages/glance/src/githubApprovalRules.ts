import type { ApprovalRuleLite } from './types.ts';

export const APPROVAL_RULES_BATCH = 50;
export const APPROVAL_RULES_PAGE_MAX = 50;

export interface GHApprovalNode {
  number: number;
  isDraft: boolean;
  updatedAt: string;
  baseRefName: string;
  reviewRequests: {
    totalCount: number;
    nodes: Array<{
      asCodeOwner: boolean;
      requestedReviewer: { __typename: string; login?: string; combinedSlug?: string } | null;
    }>;
  };
  latestOpinionatedReviews: {
    totalCount: number;
    nodes: Array<{
      state: string;
      author: { login: string } | null;
      onBehalfOf: { totalCount: number; nodes: Array<{ combinedSlug: string }> };
    }>;
  };
}

const NODE_SELECTION = `number isDraft updatedAt baseRefName
reviewRequests(first: 100) { totalCount nodes { asCodeOwner requestedReviewer {
  __typename ... on User { login } ... on Team { combinedSlug } } } }
latestOpinionatedReviews(first: 20) { totalCount nodes { state author { login }
  onBehalfOf(first: 5) { totalCount nodes { combinedSlug } } } }`;

export function buildApprovalRulesByNumberQuery(_owner: string, _repo: string, numbers: number[]): string {
  const aliases = numbers.map(n => {
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`fetchApprovalRules: iids must be positive integers, got ${n}`);
    }
    return `p${n}: pullRequest(number: ${n}) { ${NODE_SELECTION} }`;
  });
  return `query GlanceApprovalRules($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    ${aliases.join('\n    ')}
  }
}`;
}

export function buildApprovalRulesPageQuery(_owner: string, _repo: string): string {
  return `query GlanceApprovalRulesPage($owner: String!, $repo: String!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequests(states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { ${NODE_SELECTION} }
    }
  }
}`;
}

/** One rule per owner, sorted by section; or why the PR's rules could not be read. */
export function rulesFromNode(node: GHApprovalNode): { rules: ApprovalRuleLite[] } | { unknownReason: string } {
  const requests = node.reviewRequests;
  const reviews = node.latestOpinionatedReviews;
  if (requests.totalCount > requests.nodes.length) {
    return { unknownReason: 'GitHub listed more review requests than one read returns.' };
  }
  if (reviews.totalCount > reviews.nodes.length) {
    return { unknownReason: 'GitHub listed more reviews than one read returns.' };
  }

  const approvedBySection = new Map<string, boolean>();
  const note = (section: string, approved: boolean): void => {
    approvedBySection.set(section, (approvedBySection.get(section) ?? false) || approved);
  };

  for (const request of requests.nodes) {
    if (!request.asCodeOwner) continue;
    const reviewer = request.requestedReviewer;
    const owner = reviewer?.combinedSlug ?? reviewer?.login;
    if (!owner) {
      return { unknownReason: 'A code owner review request names a reviewer the token cannot read.' };
    }
    note(`@${owner.toLowerCase()}`, false);
  }

  for (const review of reviews.nodes) {
    if (review.onBehalfOf.totalCount > review.onBehalfOf.nodes.length) {
      return { unknownReason: 'GitHub listed more teams for one review than one read returns.' };
    }
    for (const team of review.onBehalfOf.nodes) {
      note(`@${team.combinedSlug.toLowerCase()}`, review.state === 'APPROVED');
    }
  }

  const rules = [...approvedBySection]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([section, approved]) => ({ type: 'CODE_OWNER', section, approved }));
  return { rules };
}
