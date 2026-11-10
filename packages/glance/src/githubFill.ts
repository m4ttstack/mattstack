import type {
  MergeRequestReviewState,
  MRState,
  Pipeline,
  PipelineJob,
  Readiness,
  ReadinessReason,
  Reviewer,
  UserRef
} from './types.ts';

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

const GHOST: UserRef = {
  id: 'github:user:ghost',
  username: 'ghost',
  name: 'Deleted user',
  avatarUrl: null
};

/** GraphQL reports a Bot login without the suffix REST appends. */
export function toUserRefFromActor(actor: GHFillActor | null): UserRef {
  if (!actor) return GHOST;
  const username =
    actor.__typename === 'Bot' && !actor.login.endsWith('[bot]')
      ? `${actor.login}[bot]`
      : actor.login;
  return {
    id: `github:user:${actor.databaseId ?? actor.login}`,
    username,
    name: actor.name ?? username,
    avatarUrl: actor.avatarUrl
  };
}

export interface ReviewSummary {
  reviewers: Reviewer[];
  approvedBy: UserRef[];
  approved: boolean;
  approvalsRequired: number | null;
  approvalsLeft: number;
}

function reviewStateOf(state: string): MergeRequestReviewState {
  switch (state) {
    case 'APPROVED':
      return 'APPROVED';
    case 'CHANGES_REQUESTED':
      return 'REQUESTED_CHANGES';
    case 'PENDING':
      return 'REVIEW_STARTED';
    default:
      return 'REVIEWED';
  }
}

/** `rulesRequired` is the rulesets count; null means none found or unreadable. */
export function mapReviews(node: GHFillNode, rulesRequired: number | null): ReviewSummary {
  const byId = new Map<string, Reviewer>();
  for (const { requestedReviewer: u } of node.reviewRequests.nodes) {
    if (!u?.login) continue;
    const ref = toUserRefFromActor({
      __typename: 'User',
      login: u.login,
      avatarUrl: u.avatarUrl ?? null,
      databaseId: u.databaseId,
      name: u.name
    });
    byId.set(ref.id, { ...ref, reviewState: 'UNREVIEWED' });
  }
  for (const r of node.latestReviews.nodes) {
    const ref = toUserRefFromActor(r.author);
    // A pending re-request is newer than the review it follows.
    if (!byId.has(ref.id)) byId.set(ref.id, { ...ref, reviewState: reviewStateOf(r.state) });
  }

  const approvedBy = node.latestOpinionatedReviews.nodes
    .filter((r) => r.state === 'APPROVED')
    .map((r) => toUserRefFromActor(r.author));

  const decision = node.reviewDecision;
  const approved = decision !== 'REVIEW_REQUIRED' && decision !== 'CHANGES_REQUESTED';

  // A zero count cannot explain a REVIEW_REQUIRED verdict (code owners, for
  // one), so only positive counts are treated as answers.
  const known = [
    node.baseRef?.branchProtectionRule?.requiredApprovingReviewCount,
    rulesRequired
  ].filter((n): n is number => typeof n === 'number' && n > 0);
  const approvalsRequired =
    known.length > 0 ? Math.max(...known) : decision === null ? 0 : null;

  return {
    reviewers: [...byId.values()],
    approvedBy,
    approved,
    approvalsRequired,
    approvalsLeft:
      approvalsRequired === null ? 0 : Math.max(0, approvalsRequired - approvedBy.length)
  };
}

function checkRunStatus(c: Extract<GHFillContext, { __typename: 'CheckRun' }>): string {
  switch (c.status) {
    case 'COMPLETED':
      switch (c.conclusion) {
        case 'SUCCESS':
        case 'NEUTRAL':
          return 'success';
        case 'FAILURE':
        case 'TIMED_OUT':
        case 'STALE':
        case 'STARTUP_FAILURE':
          return 'failed';
        case 'CANCELLED':
          return 'canceled';
        case 'SKIPPED':
          return 'skipped';
        case 'ACTION_REQUIRED':
          return 'manual';
        default:
          return 'pending';
      }
    case 'IN_PROGRESS':
      return 'running';
    default:
      return 'pending';
  }
}

function statusContextStatus(state: string): string {
  switch (state) {
    case 'SUCCESS':
      return 'success';
    case 'FAILURE':
    case 'ERROR':
      return 'failed';
    default:
      return 'pending';
  }
}

function jobDuration(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
}

export function mapPipeline(
  contexts: GHFillContext[],
  prUrl: string,
  headRef: string,
  headSha: string | null
): Pipeline | null {
  if (contexts.length === 0) return null;

  const entries = contexts.map((c) => {
    if (c.__typename === 'CheckRun') {
      const job: PipelineJob = {
        id: `github:check:${c.databaseId}`,
        name: c.name,
        stage: 'checks',
        status: checkRunStatus(c),
        allowFailure: !c.isRequired,
        duration: jobDuration(c.startedAt, c.completedAt),
        webUrl: c.detailsUrl,
        runId: c.checkSuite?.workflowRun ? String(c.checkSuite.workflowRun.databaseId) : null
      };
      return { job, required: c.isRequired };
    }
    const job: PipelineJob = {
      id: `github:status:${c.context}`,
      name: c.context,
      stage: 'checks',
      status: statusContextStatus(c.state),
      allowFailure: !c.isRequired,
      duration: null,
      webUrl: c.targetUrl,
      runId: null
    };
    return { job, required: c.isRequired };
  });

  // With no required contexts configured every check counts, so a failure
  // still reads red to the PR author.
  const anyRequired = entries.some((e) => e.required);
  const counted = entries.filter((e) => e.required || !anyRequired).map((e) => e.job);
  const statuses = counted.map((j) => j.status);
  let status: string;
  if (statuses.includes('failed')) status = 'failed';
  else if (statuses.includes('canceled')) status = 'canceled';
  else if (statuses.includes('running')) status = 'running';
  else if (statuses.includes('pending') || statuses.includes('manual')) status = 'pending';
  else status = 'success';

  const jobs = entries.map((e) => e.job);
  const runIds: string[] = [];
  for (const j of jobs) if (j.runId && !runIds.includes(j.runId)) runIds.push(j.runId);

  const failedRun = counted.find((j) => j.status === 'failed' && j.runId)?.runId;
  const highest = runIds.reduce<string | null>(
    (best, id) => (best === null || Number(id) > Number(best) ? id : best),
    null
  );
  const runId = failedRun ?? highest;

  return {
    id: runId ? `github:run:${runId}` : `github:checks:${prUrl}`,
    status,
    sha: headSha,
    ref: headRef,
    mergeRequestEventType: null,
    createdAt: null,
    webUrl: `${prUrl}/checks`,
    jobs,
    runIds
  };
}

export function githubReadiness(input: {
  state: MRState;
  isDraft: boolean;
  mergeStateStatus: string;
  reviewDecision: string | null;
  pipeline: Pipeline | null;
  unresolvedThreadCount: number | null;
  contextsComplete: boolean;
}): Readiness {
  const { state, mergeStateStatus: merge } = input;
  if (state === 'merged') return { state: 'merged', reasons: [] };
  if (state === 'closed') return { state: 'closed', reasons: [] };
  if (input.isDraft || merge === 'DRAFT') return { state: 'draft', reasons: [] };
  // Missing contexts could hide a failing required check.
  if (!input.contextsComplete) return { state: 'checking', reasons: [] };

  switch (merge) {
    case 'CLEAN':
    case 'HAS_HOOKS':
    case 'UNSTABLE':
      return { state: 'ready', reasons: [] };
    case 'DIRTY':
      return { state: 'blocked', reasons: ['conflicts'] };
    case 'BEHIND':
      return { state: 'blocked', reasons: ['behind'] };
    case 'BLOCKED': {
      const reasons: ReadinessReason[] = [];
      // allowFailure is !isRequired, so only required jobs can explain a block.
      const required = (input.pipeline?.jobs ?? []).filter((j) => !j.allowFailure);
      if (required.some((j) => j.status === 'failed' || j.status === 'canceled')) {
        reasons.push('checks-failing');
      }
      if (required.some((j) => ['running', 'pending', 'manual'].includes(j.status))) {
        reasons.push('checks-running');
      }
      if (input.reviewDecision === 'REVIEW_REQUIRED') reasons.push('approvals');
      if (input.reviewDecision === 'CHANGES_REQUESTED') reasons.push('changes-requested');
      if ((input.unresolvedThreadCount ?? 0) > 0) reasons.push('threads');
      return { state: 'blocked', reasons: reasons.length > 0 ? reasons : ['other'] };
    }
    default:
      return { state: 'checking', reasons: [] };
  }
}
