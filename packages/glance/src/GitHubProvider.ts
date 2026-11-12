/**
 * GitHub provider implementation (Phase C1 spike).
 *
 * Uses the GitHub REST API v3 to fetch pull requests, PR details, and
 * discussions. Maps GitHub responses to the same provider-agnostic domain
 * types used by GitLab, so the Swift client renders them identically.
 *
 * Auth: expects a GitHub Personal Access Token (classic or fine-grained)
 * with `repo` scope. Passed as `Authorization: Bearer <token>`.
 *
 * Base URL: "https://api.github.com" for github.com; for GHES, the user
 * provides the instance URL and we append "/api/v3".
 */

import type {
  FetchPullRequestsOptions,
  FetchPullRequestsWarning,
  GitProvider,
  MRState
} from './GitProvider.ts';
import { parseUpdatedAfter, requireProjectPath, warningTarget } from './GitProvider.ts';
import type {
  BranchProtectionRule,
  CommentAnchor,
  CreatePullRequestInput,
  Discussion,
  InlineCommentResult,
  InvalidationBatch,
  JobDetail,
  EnqueuePullRequestInput,
  MergePullRequestInput,
  MergePullRequestResult,
  MergeQueueEntry,
  MergeQueueStatus,
  MRDetail,
  Note,
  NoteAuthor,
  NotePosition,
  NoteRef,
  NoteWriteResult,
  ReviewSubmission,
  ReviewSubmitResult,
  Pipeline,
  PipelineJob,
  PullRequestFileDiff,
  PipelineListEntry,
  ProjectLabel,
  ProviderCapabilities,
  PullRequest,
  UpdatePullRequestInput,
  FetchSummariesOptions,
  PullRequestSummary,
  SummaryState,
  UserRef,
  WatchEventsOptions
} from './types.ts';
import { type ForgeLogger, noopLogger } from './logger.ts';
import {
  GitHubEventsPoller,
  type FetchGitHubEventsPage,
  type GitHubEvent
} from './GitHubEventsPoller.ts';
import { startWatcherLoop, type LoopTick } from './EventsWatcher.ts';
import { ForgeHttpError, RateLimitedError } from './errors.ts';
import {
  bodyText,
  createGitHubClient,
  ghError,
  reasonPhrase,
  resolveGitHubUrls,
  toRateLimitedError,
  GRAPHQL_READ_MARKER,
  type GlanceOctokit
} from './githubClient.ts';
import type { OnRequestHook } from './instrumentation.ts';
import {
  forgeWrite,
  githubHttpError,
  githubLineAndSide,
  parseReviewThreadDiscussionId,
  resolveGitHubCommentKind,
  type GitHubCommentKind
} from './githubNotes.ts';
import { submitGitHubReview } from './githubReview.ts';
import {
  buildContextsPageQuery,
  buildFillQuery,
  FILL_BATCH_SIZE,
  checkStatusFromParts,
  jobDuration,
  rolesFromViewer,
  toPullRequestFromNode,
  type GHFillContext,
  type GHFillNode,
  type GHFillViewer
} from './githubFill.ts';
// GitHub's own generated REST response shapes (MAT-144): the GH*-prefixed
// interfaces below derive from these `components` types where a schema
// exists, so a field GitHub renames or drops becomes a compile error here
// instead of a silent `undefined` at a call site.
import type { components } from '@octokit/openapi-types';
// This package depends on @octokit/request-error directly so `err instanceof
// RequestError` below can narrow errors thrown by @octokit/core's OWN copy of
// this class. That only works while npm/bun dedupe the two into one module
// instance, which only holds while this package's version range for
// @octokit/request-error overlaps the range @octokit/core depends on. If the
// ranges ever diverge, two separate RequestError classes end up installed,
// every migrated `instanceof RequestError` check here goes false, and each
// catch rethrows the raw error instead of translating it. Keep this range
// tracking @octokit/core's own dependency on @octokit/request-error.
import { RequestError } from '@octokit/request-error';
// Same coupling as RequestError above, for @octokit/core's copy of
// @octokit/graphql: `err instanceof GraphqlResponseError` in the GraphQL
// helpers' catches only works while the two copies dedupe to one module
// instance, which requires this package's @octokit/graphql range to track
// @octokit/core's.
import { GraphqlResponseError } from '@octokit/graphql';
import { ReadBackFailedError } from './errors.ts';

// ---------------------------------------------------------------------------
// GitHub REST API response shapes (only fields we consume)
//
// Each type below derives from `components["schemas"][...]` (MAT-144) via
// `Pick`, so a field GitHub renames or drops turns into a compile error here
// instead of a silent `undefined` at a call site. Fields this file narrows
// beyond what the schema promises -- assumed-always-present, narrowed off
// `number | bigint`, sliced out of a shape shared with a slimmer sibling
// endpoint -- are declared explicitly with a one-line comment explaining the
// narrowing. The GraphQL response shapes further down (starting at
// GHReviewThread) stay fully hand-rolled: @octokit/openapi-types
// only documents the REST surface, not the GraphQL schema this file queries
// via `graphqlOrThrow`.
// ---------------------------------------------------------------------------

type PullRequestSchema = components['schemas']['pull-request'];
type RepositorySchema = components['schemas']['repository'];
type ReviewCommentSchema = components['schemas']['pull-request-review-comment'];
type IssueSearchItemSchema = components['schemas']['issue-search-result-item'];

// GitHub ids fit within JS's safe-integer range in practice; openapi-types
// widens every `id` field to `number | bigint` defensively for values beyond
// it. Every `id: number` override below (and in the shapes further down)
// shares this same rationale rather than repeating it per field.

type GHUser = Pick<components['schemas']['simple-user'], 'login' | 'name' | 'avatar_url'> & {
  id: number;
};

// `components["schemas"]["label"]` exists and would work here too; this derives
// from the PR schema's own inline duplicate of it instead, for locality: labels
// only ever reach this file inside a PR payload, so the shape that drifts is
// the one the PR schema declares.
type GHLabel = Pick<PullRequestSchema['labels'][number], 'name' | 'color'> & {
  id: number;
};

type GHPullRequest = Pick<
  PullRequestSchema,
  'number' | 'title' | 'body' | 'merged_at' | 'html_url' | 'created_at' | 'updated_at'
> & {
  id: number;
  /** GraphQL global node ID: the handle the v4 API addresses this PR by. */
  node_id: PullRequestSchema['node_id'];
  state: string; // "open" | "closed"
  // Schema marks `draft` optional; every PR payload this file has seen sets it.
  draft: boolean;
  head: Pick<PullRequestSchema['head'], 'sha' | 'ref'> & {
    /**
     * The repository the branch lives in. Present on real API responses;
     * declared optional/nullable here because GitHub returns null when the
     * fork has since been deleted.
     */
    repo?: { full_name: string } | null;
  };
  base: Pick<PullRequestSchema['base'], 'ref'> & {
    repo: Pick<RepositorySchema, 'full_name' | 'default_branch'> & { id: number };
  };
  user: GHUser;
  assignees: GHUser[];
  requested_reviewers: GHUser[];
  labels: GHLabel[];
  // These four exist on the full `pull-request` schema but not on
  // `pull-request-simple`, the slimmer shape the list/search endpoints
  // return that this type is also cast onto -- optional here for that reason.
  additions?: number;
  deletions?: number;
  changed_files?: number;
  mergeable?: boolean | null;
  mergeable_state?: string; // "dirty" | "clean" | "unstable" | "blocked" | ...
  auto_merge?: {
    enabled_by: GHUser;
    merge_method: string; // "merge" | "squash" | "rebase"
  } | null;
};

type GHReview = Pick<components['schemas']['pull-request-review'], 'state'> & {
  id: number;
  user: GHNoteUser;
  // Schema marks this optional (absent on PENDING reviews); the
  // /pulls/{number}/reviews page this file reads has never omitted it.
  submitted_at: string;
};

/** One review thread, joined to REST review comments by its root comment. */
interface GHReviewThread {
  nodeId: string;
  isResolved: boolean;
  rootCommentId: number;
}

/** `repository.pullRequest.reviewThreads` projection, one PR at a time. */
interface GHPullRequestThreadsResponse {
  repository?: {
    pullRequest?: {
      reviewThreads?: {
        pageInfo?: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          id: string;
          isResolved: boolean;
          comments?: { nodes: Array<{ databaseId: number | null }> };
        } | null>;
      };
    } | null;
  } | null;
}

/**
 * `repository { b0: pullRequests(...) ... }` projection, one alias per branch.
 *
 * The keys are positional aliases (`b0`, `b1`, ...) rather than branch names
 * because a branch name is not a valid GraphQL identifier -- `feature/x-y`
 * has a slash and a dash in it -- so the caller maps aliases back to branches
 * by index.
 */
interface GHBranchPullRequestsResponse {
  repository?: Record<
    string,
    { nodes?: Array<{ number: number } | null> } | null
  > | null;
}

interface GHFillResponse {
  viewer?: GHFillViewer | null;
  repository: Record<string, GHFillNode | null> | null;
}

interface GHFillContextsPage {
  contexts: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: GHFillContext[];
  };
}

interface GHFillContextsResponse {
  repository: Record<
    string,
    { commits: { nodes: Array<{ commit: { statusCheckRollup: GHFillContextsPage | null } }> } } | null
  > | null;
}

interface GHSummaryNode {
  number?: number;
  title: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  merged: boolean;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  author: { login: string } | null;
  url: string | null;
  mergedAt: string | null;
}

interface GHSummaryConnection {
  nodes: Array<GHSummaryNode | null>;
  issueCount?: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

interface GHSummaryResponse {
  repository?: { pullRequests: GHSummaryConnection } | null;
  search?: GHSummaryConnection;
}

const SUMMARY_FIELDS = `number title state merged isDraft headRefName baseRefName url mergedAt author { login }`;

const SUMMARY_LIST_QUERY = `query GlancePullRequestSummaries($owner: String!, $name: String!, $states: [PullRequestState!], $head: String, $base: String, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: $states, headRefName: $head, baseRefName: $base, first: 100, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { ${SUMMARY_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const SUMMARY_SEARCH_QUERY = `query GlancePullRequestSummarySearch($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 100, after: $after) {
    issueCount
    nodes { ... on PullRequest { ${SUMMARY_FIELDS} } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const SUMMARY_STATES: Record<SummaryState, string[]> = {
  opened: ['OPEN'],
  closed: ['CLOSED'],
  merged: ['MERGED'],
  all: ['OPEN', 'CLOSED', 'MERGED']
};

const SUMMARY_SEARCH_STATE: Record<SummaryState, string> = {
  opened: 'is:open',
  closed: 'is:closed -is:merged',
  merged: 'is:merged',
  all: ''
};

/**
 * A quote or backslash would end the phrase and let the rest of the value
 * add qualifiers, so those are refused; whitespace is contained by quoting.
 */
function searchTerm(label: string, value: string, phrase = false): string {
  if (/["\\\r\n]/.test(value)) {
    throw new Error(`${label} cannot contain a quote, backslash or newline in a GitHub search`);
  }
  return phrase || /\s/.test(value) ? `"${value}"` : value;
}

function summarySearchString(owner: string, repo: string, o: FetchSummariesOptions): string {
  const parts = [`repo:${owner}/${repo}`, 'is:pr', SUMMARY_SEARCH_STATE[o.state]];
  if (o.author) {
    parts.push(`author:${o.author === 'me' ? '@me' : searchTerm('author', o.author)}`);
  }
  if (o.sourceBranch) parts.push(`head:${searchTerm('sourceBranch', o.sourceBranch)}`);
  if (o.targetBranch) parts.push(`base:${searchTerm('targetBranch', o.targetBranch)}`);
  if (o.search) parts.push(searchTerm('search', o.search, true));
  // Without it GitHub ranks by relevance, so the limit would keep the wrong rows.
  parts.push('sort:updated-desc');
  return parts.filter(Boolean).join(' ');
}

/** One entry of a GraphQL response's `errors`, as `graphqlRead` reports it. */
interface GraphQLReadError {
  message: string;
  type: string | null;
  path: Array<string | number> | null;
}

/**
 * The error, if any, that means PR `n`'s read failed rather than found
 * nothing. GitHub answers an unknown number with a null alias plus a
 * `NOT_FOUND` error, which is a missing PR, not a failure. An error under
 * the alias fails the PR even when its node arrived, since a field inside
 * it may be null for that reason; an error with no alias path fails only
 * the aliases that came back null. The exception is the classic protection
 * rule: a token that cannot see it gets an error there and a null rule, and
 * that is an unknown count, not a failed read. A check's workflow run is
 * the same: a token without Actions read access errors there and gets a null
 * run, which is an unknown run id, not a failed read.
 */
function isWorkflowRunError(e: GraphQLReadError): boolean {
  const path = e.path ?? [];
  return path.length >= 2 && path[path.length - 2] === 'checkSuite' && path[path.length - 1] === 'workflowRun';
}

function fillErrorFor(
  errors: GraphQLReadError[],
  n: number,
  resolved: boolean
): GraphQLReadError | null {
  for (const e of errors) {
    if (e.type === 'NOT_FOUND') continue;
    const [root, alias, ...rest] = e.path ?? [];
    if (root === 'viewer') continue;
    if (alias === `p${n}`) {
      if (rest[0] === 'baseRef' && rest[1] === 'branchProtectionRule') continue;
      if (isWorkflowRunError(e)) continue;
      return e;
    }
    if (!resolved && alias === undefined) return e;
  }
  return null;
}

/** An item from `/search/issues`: issue-shaped, with a `pull_request` stub on PRs. */
type GHSearchItem = Pick<
  IssueSearchItemSchema,
  'number' | 'state' | 'updated_at' | 'repository_url'
> & {
  pull_request?: Pick<NonNullable<IssueSearchItemSchema['pull_request']>, 'merged_at'> & {
    // Schema marks `url` nullable; every pull_request stub this file has seen carries a real URL.
    url: string;
  };
};

/** `user` is null for a deleted account, which GitHub shows as ghost. */
type GHNoteUser = (GHUser & { type?: string }) | null;

type GHComment = Pick<ReviewCommentSchema, 'body' | 'created_at'> & {
  id: number;
  user: GHNoteUser;
  // The remaining fields exist on `pull-request-review-comment` (diff-level
  // comments) but this type is also cast onto plain `issue-comment`
  // responses (PR-level comments), which lack them entirely -- optional here
  // for that reason, same as GHPullRequest's list/search narrowing above.
  path?: string | null;
  line?: number | null;
  original_line?: number | null;
  side?: 'LEFT' | 'RIGHT' | null;
  diff_hunk?: string | null;
  pull_request_review_id?: number | null;
  in_reply_to_id?: number | null;
};

type GHReviewSummary = Pick<components['schemas']['pull-request-review'], 'state' | 'body'> & {
  id: number;
  user: GHNoteUser;
  // Absent only on a PENDING review, which the summary read skips.
  submitted_at: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pages of 100 to walk before giving up on a search. Matches the bound
    fetchPullRequestByBranch uses for its own fallback scan. */
const SEARCH_MAX_PAGES = 5;

/** Pages of 100 to walk when listing every PR in a repository. */
const LIST_MAX_PAGES = 20;

/**
 * How long a branch's ruleset answer is reused. A daemon loop re-reads the
 * same PRs constantly, and rulesets change rarely, so this keeps the extra
 * REST call to one per branch per window.
 */
const RULES_CACHE_MS = 600_000;

/**
 * Branch aliases per batched `pullRequests(headRefName:)` query.
 *
 * GitHub scores a GraphQL query's cost from the connections it asks for, and
 * a single query with hundreds of aliased connections is both rejected past
 * the node limit
 * and unattributable when it fails -- one bad alias takes the whole request
 * with it. Fifty keeps each request cheap and each failure small.
 */
const BRANCH_BATCH_SIZE = 50;

/**
 * Follow-up contexts pages per PR, 100 checks each, past the fill's first
 * 100. A PR with more than that reads as still checking, never green.
 */
const CONTEXTS_MAX_PAGES = 10;

/** GraphQL page size for `fetchReviewThreadIndex`'s review-thread walk. */
const THREAD_PAGE_SIZE = 100;

/**
 * Thread pages to walk for one PR before giving up. At THREAD_PAGE_SIZE per
 * page this is 1000 threads, far past any real review. The bound exists so a
 * pathological PR cannot spin this loop, not because 1000 is a meaningful
 * limit.
 */
const THREAD_MAX_PAGES = 10;

/** Page cap for the label and job listings, 100 rows a page. */
const FORGE_READ_MAX_PAGES = 20;

/**
 * GitHub requires a reason on every review dismissal and posts it to the pull
 * request timeline. GitLab's unapprove takes no message, so
 * `unapprovePullRequest` has none to pass along and sends this instead of
 * inventing a reason that would read as if a person wrote it.
 */
const DISMISSAL_MESSAGE = 'Approval withdrawn via the Glance SDK.';

/**
 * Default `watchEvents` cadence: 60s, four times GitLab's 15s.
 *
 * Not a tuning preference. GitHub asks for exactly this on every 200 from
 * the events feed (`X-Poll-Interval: 60`), and polling a repo feed faster
 * than the server asked is how a token earns a secondary rate limit. A
 * caller that passes `intervalMs` is still honored; the server's own number
 * only ever raises the wait, never lowers it (see `watchEvents`).
 */
const WATCH_EVENTS_INTERVAL_MS = 60_000;

/** The events feed's page size cap, and the only value this provider sends. */
const EVENTS_PER_PAGE = 100;

/**
 * The events feed serves at most 3 pages (300 events) to a poller; page 4 is
 * empty no matter what. `GitHubEventsPoller` already clamps to this, so the
 * fetch below throwing past it is defense, not the enforcement.
 */
const EVENTS_MAX_PAGE = 3;

function toUserRef(u: GHUser): UserRef {
  return {
    id: `github:user:${u.id}`,
    username: u.login,
    name: u.name ?? u.login,
    avatarUrl: u.avatar_url
  };
}

/**
 * Normalize GitHub PR state to our domain states.
 * GitHub only has "open" and "closed"; we check `merged_at` to distinguish merges.
 */
function normalizePRState(pr: GHPullRequest): MRState {
  return toMRState(pr.state, pr.merged_at);
}

/**
 * The same open/closed/merged_at reading as `normalizePRState`, for payloads
 * that carry those two fields without being a full PR (search results).
 */
function toMRState(state: string, mergedAt: string | null | undefined): MRState {
  if (mergedAt) return 'merged';
  if (state === 'open') return 'opened';
  return 'closed';
}

/** The requested state filter as a set; defaults to open MRs only. */
function wantedStates(state: FetchPullRequestsOptions['state']): Set<MRState> {
  if (!state) return new Set<MRState>(['opened']);
  return new Set<MRState>(Array.isArray(state) ? state : [state]);
}

/**
 * The `is:` qualifiers to search for `wanted`: one query per qualifier.
 *
 * GitHub search cannot express "open OR merged" in one query -- qualifiers
 * AND together, so `is:open is:closed` matches nothing. Dropping the
 * qualifier instead would match every PR the user has ever touched, all
 * time, which is how a mixed-state request became the most expensive call in
 * the SDK. Two bounded searches cost less than one unbounded one.
 *
 * `merged` and `closed` are both `is:closed` on GitHub (a merged PR is a
 * closed one with `merged_at` set), so a request for both still searches once.
 */
function searchStateQualifiers(wanted: Set<MRState>): string[] {
  const qualifiers: string[] = [];
  if (wanted.has('opened')) qualifiers.push('is:open');
  if (wanted.has('merged') || wanted.has('closed')) qualifiers.push('is:closed');
  return qualifiers.length > 0 ? qualifiers : ['is:open'];
}

/** The `state` query param for `/repos/{path}/pulls` covering `wanted`. */
function listStateParam(wanted: Set<MRState>): 'open' | 'closed' | 'all' {
  if (!wanted.has('opened')) return 'closed';
  if (wanted.size === 1) return 'open';
  return 'all';
}

/** A PR a search matched, before the fill reads it. */
interface SearchHit {
  /** `owner/repo`. */
  repoPath: string;
  number: number;
}

function hitKey(hit: SearchHit): string {
  return `${hit.repoPath}#${hit.number}`;
}

/** One entry per PR, in first-seen order. */
function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Map<string, SearchHit>();
  for (const hit of hits) {
    if (!seen.has(hitKey(hit))) seen.set(hitKey(hit), hit);
  }
  return [...seen.values()];
}

/**
 * Map our provider-agnostic MRState to GitHub's `state` query param, which
 * only knows "open" | "closed" | "all" (GitHub has no separate "merged"
 * state -- a merged PR is just `state=closed` with `merged_at` set).
 */
function mapStateToGitHubQueryParam(state: MRState | 'all'): 'open' | 'closed' | 'all' {
  if (state === 'all') return 'all';
  if (state === 'opened') return 'open';
  return 'closed'; // 'closed' and 'merged' both map to GitHub's 'closed'
}

/**
 * Map our MRState to GitHub's GraphQL `PullRequestState` values, or `null`
 * for "send no filter at all".
 *
 * Each answer is pinned to a sibling this must agree with, not chosen on its
 * own merits:
 *
 * - **omitted -> `[OPEN]`.** `GitLabProvider.fetchPullRequestsByBranches`
 *   defaults its `state` to `'opened'`, and this method exists so a caller
 *   can ask one question of either forge. A caller that names no state must
 *   get the same answer on both, so the default is `opened` here too rather
 *   than the wider "no filter".
 * - **`'all'` -> `null` (no filter).** GitLab passes `state: undefined` for
 *   `'all'`, which is likewise no filter.
 * - **`'closed'` -> `[CLOSED, MERGED]`.** GraphQL splits these two; REST does
 *   not, so `mapStateToGitHubQueryParam` sends `state=closed` and
 *   `fetchPullRequestByBranch` consequently matches merged PRs on a
 *   `'closed'` lookup. That is GitHub's own `is:closed` semantics, and the
 *   batch path has to answer `'closed'` the way its sibling does or the two
 *   silently disagree about the same branch.
 * - **`'merged'` -> `[MERGED]`.** The one place GraphQL is usefully finer
 *   than REST: REST's `state=closed` cannot express "merged" at all, so
 *   `fetchPullRequestByBranch` over-matches here. Narrowing is a strict
 *   improvement rather than a divergence -- every PR this returns is one the
 *   REST path would also have returned.
 */
function mapStateToGraphQLStates(
  state: MRState | 'all' | undefined
): string[] | null {
  switch (state) {
    case 'all':
      return null;
    case undefined:
    case 'opened':
      return ['OPEN'];
    case 'merged':
      return ['MERGED'];
    case 'closed':
      return ['CLOSED', 'MERGED'];
  }
}

// ---------------------------------------------------------------------------
// GitHubProvider
// ---------------------------------------------------------------------------

export class GitHubProvider implements GitProvider {
  readonly providerName = 'github' as const;
  readonly baseURL: string;
  private readonly apiBase: string;
  private readonly token: string;
  private readonly log: ForgeLogger;
  private readonly octokit: GlanceOctokit;
  private readonly now: () => number;
  private readonly writeTimeoutMs: number;
  private readonly reviewTimeoutMs: number;
  private readonly rulesCache = new Map<string, { required: number | null; at: number }>();

  /**
   * @param baseURL — The user-facing GitHub URL. For github.com: "https://github.com".
   *   For GHES: "https://github.mycompany.com".
   * @param token — A GitHub PAT (classic or fine-grained) with `repo` scope.
   * @param options.logger — Optional logger; defaults to noop.
   * @param options.now Clock for the ruleset cache; defaults to `Date.now`.
   * @param options.writeTimeoutMs Abort bound for each comment write; defaults to 15 s.
   * @param options.reviewTimeoutMs Abort bound for the review POST; defaults to 60 s.
   */
  constructor(
    baseURL: string,
    token: string,
    options: {
      logger?: ForgeLogger;
      onRequest?: OnRequestHook;
      now?: () => number;
      writeTimeoutMs?: number;
      reviewTimeoutMs?: number;
    } = {}
  ) {
    this.now = options.now ?? Date.now;
    this.writeTimeoutMs = options.writeTimeoutMs ?? 15_000;
    this.reviewTimeoutMs = options.reviewTimeoutMs ?? 60_000;
    this.baseURL = baseURL.replace(/\/$/, '');
    this.token = token;
    this.log = options.logger ?? noopLogger;

    const urls = resolveGitHubUrls(this.baseURL);
    this.apiBase = urls.apiBase;
    this.octokit = createGitHubClient({
      baseURL: this.baseURL,
      token: this.token,
      log: this.log,
      onRequest: options.onRequest
    });
  }

  // ── Capabilities ──────────────────────────────────────────────────────

  readonly capabilities: ProviderCapabilities = {
    canMerge: true,
    canApprove: true,
    canUnapprove: true,
    canRebase: false,
    canAutoMerge: true,
    canEnqueue: true,
    canResolveDiscussions: true,
    canRetryPipeline: true,
    canRequestReReview: true,
    /**
     * True, with two limits a caller has to design around.
     *
     * no CI events: the polled feed has no workflow/check event type at all,
     * so a `pipelines` invalidation never fires here. keep a full poll for
     * pipeline status; the watcher is an accelerator, not a replacement.
     *
     * hours-scale retention: the feed holds roughly six hours. a watcher
     * down longer than that comes back to a cursor that proves nothing about
     * what it missed, because the missed history is already gone from the
     * feed. resume is a fast path, not a guarantee; full sync is the only
     * recovery.
     */
    canWatchEvents: true,
    canFetchMergeRequestIndex: false,
    canFetchMergeRequestMetrics: false,
    canFetchGroupProjects: false,
    canFetchProject: false,
    canFetchProjectPipelines: false,
    canFetchUserEvents: false,
    canFetchProjectLabels: true,
    canFetchPipelineList: true,
    canFetchCommitParents: true,
    canFetchPipelineFailedJobs: true,
    canFetchPullRequestSummaries: true,
    canEditLabels: true,
    canReplyToGeneralComments: false,
    canRequestChanges: true,
    canFetchPullRequestDiffs: true
  };

  // ── GitProvider interface ─────────────────────────────────────────────────

  async validateToken(): Promise<UserRef> {
    let user: GHUser;
    try {
      const res = await this.octokit.request('GET /user');
      user = res.data as GHUser;
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        // Built directly, not through `ghError`, because this message's shape
        // predates that helper and the live harness pattern-matches on it:
        // `${op} failed: ${status} ${statusText}`, no body. `ghError`'s
        // 'statusText' style appends the body after an em dash, which is a
        // different, newer shape this call site never used.
        throw new Error(
          `GitHub token validation failed: ${err.status} ${reasonPhrase(err.status)}`
        );
      }
      // No `.response` means this never reached an HTTP outcome (DNS
      // failure, connection refused): a transport failure, not something
      // `validateToken` has ever translated. Rethrow the original
      // `RequestError` (or whatever else was thrown) so callers keep
      // `.status`/`.request`, same as every other migrated method here.
      throw err;
    }
    return toUserRef(user);
  }

  async fetchUser(username: string): Promise<UserRef | null> {
    let user: GHUser;
    try {
      const res = await this.octokit.request('GET /users/{username}', { username });
      user = res.data as GHUser;
    } catch (err) {
      if (err instanceof RequestError && err.status === 404) return null;
      throw ghError('fetchUser', err);
    }
    return toUserRef(user);
  }

  /**
   * Fetch pull requests the token user is involved in, or -- with
   * `projectPath` -- pull requests in a single repository.
   *
   * Discovery (the REST listing or search) yields PR numbers; every PR's data
   * then comes from the batched GraphQL fill (`fillPullRequests`), one request
   * per `FILL_BATCH_SIZE` PRs per repository, plus one per extra page of
   * checks on a PR with more than 100.
   *
   * How each `FetchPullRequestsOptions` field lands on GitHub:
   * - `state`: honored. GitHub has no merged state of its own, so `merged`
   *   is `is:closed` plus a `merged_at` check (the same reading
   *   `normalizePRState` does). A request for several states runs one search
   *   per `is:` qualifier rather than an unqualified (all-time) search.
   * - `iids` + `projectPath`: honored, through the fill alone.
   * - `authorUsernames` + `projectPath`: honored, one search per author and
   *   state qualifier.
   * - `projectPath` alone: honored, paginated `/pulls` listing.
   * - The involvement mode (no `projectPath`): authored, review-requested,
   *   reviewed and assigned PRs, so a PR stays in "my reviews" after the
   *   review lands.
   * - `updatedAfter`: honored in every mode.
   * - `listWeight`: honored in every mode by dropping only `body`; checks
   *   stay, since one fill reads both.
   * - `onWarning`: called for page-cap truncation, a rejected search page,
   *   a PR whose fill failed (`fill`, the PR is missing from the result) and
   *   an unread checks page (`contexts`, the pipeline reads pending).
   *
   * `iids` and `authorUsernames` throw without `projectPath`, as the interface
   * documents. A rate limit on any discovery page or fill batch throws
   * `RateLimitedError` rather than returning a short list.
   *
   * Cost, for U matching PRs in R repositories and Q state qualifiers (1, or
   * 2 for a request mixing open with merged/closed): the listing mode reads
   * one REST page per 100 listed PRs; the involvement mode runs 4*Q searches
   * of up to `SEARCH_MAX_PAGES` pages each; the author mode one search per
   * author and qualifier. Then about ceil(U/25) GraphQL fills per
   * repository, plus one cached rulesets read per open PR's base branch
   * awaiting a verdict. Searches are merged by PR before the fill, so a PR
   * several searches matched is filled once.
   */
  async fetchPullRequests(
    options?: FetchPullRequestsOptions
  ): Promise<PullRequest[]> {
    const wanted = wantedStates(options?.state);
    const updatedAfter = parseUpdatedAfter(options?.updatedAfter);
    const onWarning = options?.onWarning;
    const listWeight = options?.listWeight ?? false;
    const excluded = new Set(options?.excludeTargetBranches ?? []);
    const isFresh = (updatedAt: string) =>
      updatedAfter === null || Date.parse(updatedAt) >= updatedAfter;
    const keepRaw = (pr: GHPullRequest) =>
      wanted.has(normalizePRState(pr)) && isFresh(pr.updated_at);
    const keepSearchItem = (item: GHSearchItem) =>
      wanted.has(toMRState(item.state, item.pull_request?.merged_at)) &&
      isFresh(item.updated_at);

    // A date-only lower bound is a superset of the requested instant, so the
    // exact `isFresh` filter below still decides; this only trims the search.
    const freshQualifier = options?.updatedAfter
      ? ` updated:>=${options.updatedAfter.slice(0, 10)}`
      : '';
    const stateQualifiers = searchStateQualifiers(wanted);

    let results: PullRequest[];

    // Mode selection keys off the field being present, not non-empty: an empty
    // `iids` list asks for no MRs, not for the whole repository.
    if (options?.iids) {
      const projectPath = requireProjectPath(options.projectPath, 'iids');
      const iids = [...new Set(options.iids)];
      const filled = await this.fillPullRequests(projectPath, iids, {
        listWeight,
        roles: new Map(),
        onWarning
      });
      return iids
        .map(iid => filled.get(iid) ?? null)
        .filter(
          (pr): pr is PullRequest =>
            pr !== null && wanted.has(pr.state as MRState) && isFresh(pr.updatedAt ?? '')
        );
    } else if (options?.authorUsernames) {
      const projectPath = requireProjectPath(
        options.projectPath,
        'authorUsernames'
      );
      const perSearch = await Promise.all(
        options.authorUsernames.flatMap(author =>
          stateQualifiers.map(state =>
            this.searchPRs(
              `${state} is:pr repo:${projectPath} author:${author}${freshQualifier}`,
              keepSearchItem,
              onWarning
            )
          )
        )
      );
      results = await this.fillHits(dedupeHits(perSearch.flat()), new Map(), listWeight, onWarning);
      // A search item carries no base branch, so the exclusion waits for the fill.
      if (excluded.size > 0) results = results.filter(pr => !excluded.has(pr.targetBranch));
    } else if (options?.projectPath) {
      const projectPath = options.projectPath;
      const listed = await this.listRepoPRs(
        projectPath,
        wanted,
        updatedAfter,
        keepRaw,
        onWarning
      );
      results = await this.fillHits(
        listed
          .filter(pr => !excluded.has(pr.base.ref))
          .map(pr => ({ repoPath: projectPath, number: pr.number })),
        new Map(),
        listWeight,
        onWarning
      );
    } else {
      // Involvement search: one search per involvement (times one per state
      // qualifier), merged by PR before the fill, so a PR the token user
      // authored, was assigned and reviewed is filled once with every role.
      const involvements = [
        { qualifier: 'author:@me', role: 'author' },
        { qualifier: 'review-requested:@me', role: 'reviewer' },
        { qualifier: 'reviewed-by:@me -author:@me', role: 'reviewer' },
        { qualifier: 'assignee:@me', role: 'assignee' }
      ];
      const searched = await Promise.all(
        involvements.flatMap(({ qualifier, role }) =>
          stateQualifiers.map(async state => ({
            role,
            hits: await this.searchPRs(
              `${state} is:pr ${qualifier}${freshQualifier}`,
              keepSearchItem,
              onWarning
            )
          }))
        )
      );

      const rolesByHit = new Map<string, string[]>();
      const unique: SearchHit[] = [];
      for (const { role, hits } of searched) {
        for (const hit of hits) {
          const roles = rolesByHit.get(hitKey(hit));
          if (!roles) {
            rolesByHit.set(hitKey(hit), [role]);
            unique.push(hit);
          } else if (!roles.includes(role)) {
            roles.push(role);
          }
        }
      }

      results = await this.fillHits(unique, rolesByHit, listWeight, onWarning);
    }

    this.log.debug('GitHubProvider.fetchPullRequests', {
      count: results.length
    });
    return results;
  }

  /**
   * `onWarning` is not part of the `GitProvider` interface: callers that
   * need to tell "this PR does not exist" from "the read failed" pass it
   * directly. Either way this resolves to `null`, the contract
   * `fetchPullRequestByBranch` and the daemon's freshness pass rely on; only
   * the failure fires a `fill` warning.
   *
   * A `RateLimitedError` is the exception to null-plus-warning: it
   * propagates, so a caller can back off instead of caching a null.
   *
   * Cost: 1 GraphQL request, plus 1 per extra page of checks past 100.
   */
  async fetchSingleMR(
    projectPath: string,
    mrIid: number,
    _currentUserNumericId: number | null,
    onWarning?: FetchPullRequestsOptions['onWarning']
  ): Promise<PullRequest | null> {
    const filled = await this.fillPullRequests(projectPath, [mrIid], {
      listWeight: false,
      roles: new Map(),
      onWarning
    });
    return filled.get(mrIid) ?? null;
  }

  /**
   * `createPullRequest`/`updatePullRequest`/`mergePullRequest` all refetch
   * the PR they just mutated to return the caller a fresh copy, and all
   * three used to throw the same generic "... but failed to fetch it back"
   * when that refetch came back null. That message matches no live-harness
   * pattern (`providerConformance.ts`) and reads as an unrelated hard
   * failure -- indistinguishable from the PR genuinely having vanished --
   * when the actual, far more common cause is a rate-limited or otherwise
   * rejected page on the way back. Capturing `fetchSingleMR`'s `onWarning`
   * here (rather than letting the mutation callers see only `null`) is what
   * lets the thrown message say which one actually happened.
   */
  private async fetchSingleMRAfterMutation(
    projectPath: string,
    mrIid: number,
    verb: 'Created' | 'Updated' | 'Merged'
  ): Promise<PullRequest> {
    const details = { operation: `fetchSingleMR after ${verb}`, projectPath, iid: mrIid, writeApplied: true };
    let warning: FetchPullRequestsWarning | undefined;
    let pr: PullRequest | null;
    try {
      pr = await this.fetchSingleMR(projectPath, mrIid, null, w => {
        warning = w;
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new ReadBackFailedError(`${verb} PR #${mrIid} but could not verify it afterward: ${reason}`, {
        ...details,
        cause: err
      });
    }
    if (pr) return pr;
    throw new ReadBackFailedError(
      warning
        ? `${verb} PR #${mrIid} but could not verify it afterward: ${warning.message}`
        : `${verb} PR #${mrIid} but it was not found when refetched`,
      details
    );
  }

  async fetchMRDiscussions(
    repositoryId: string,
    mrIid: number
  ): Promise<MRDetail> {
    const { owner, repo: repoName } = await this.discussionRepo(repositoryId);
    const route = { owner, repo: repoName, pull_number: mrIid, per_page: 100 };

    // `paginate` needs the route template plus real route params (rather
    // than one path string) so it can follow the `Link` header itself.
    const [reviewComments, issueComments, reviews] = await Promise.all([
      this.octokit.paginate<GHComment>('GET /repos/{owner}/{repo}/pulls/{pull_number}/comments', route),
      this.octokit.paginate<GHComment>(
        'GET /repos/{owner}/{repo}/issues/{issue_number}/comments',
        { owner, repo: repoName, issue_number: mrIid, per_page: 100 }
      ),
      this.octokit.paginate<GHReviewSummary>('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews', route)
    ]);

    // Resolution state lives only in GraphQL. A failure here degrades the
    // answer to the pre-MAT-27 "unknown" rather than failing the call: the
    // notes themselves came from REST and were returned long before resolved
    // state was available.
    let threads: Map<number, GHReviewThread> = new Map();
    const oldPaths = new Map<string, string>();
    if (reviewComments.length > 0) {
      const [files] = await Promise.all([
        this.octokit.paginate<Pick<components['schemas']['diff-entry'], 'filename' | 'previous_filename'>>(
          'GET /repos/{owner}/{repo}/pulls/{pull_number}/files',
          route
        ),
        this.fetchReviewThreadIndex('fetchMRDiscussions', owner, repoName, mrIid).then(
          index => {
            threads = index;
          },
          err => {
            this.log.warn('fetchMRDiscussions: could not read review thread state', {
              message: err instanceof Error ? err.message : String(err),
              projectPath: `${owner}/${repoName}`,
              mrIid
            });
          }
        )
      ]);
      for (const f of files) {
        if (f.previous_filename) oldPaths.set(f.filename, f.previous_filename);
      }
    }

    const discussions: Discussion[] = [];

    // PR-level comments have no thread and no resolved state on GitHub, so
    // null is the correct answer here rather than a gap.
    for (const c of issueComments) {
      discussions.push({
        id: `gh-issue-comment-${c.id}`,
        resolvable: null,
        resolved: null,
        notes: [toNote(c)]
      });
    }

    for (const r of reviews) {
      if (r.state === 'PENDING' || !r.body?.trim()) continue;
      discussions.push({
        id: `gh-review-${r.id}`,
        resolvable: false,
        resolved: null,
        notes: [
          {
            id: r.id,
            body: r.body,
            author: toNoteAuthor(r.user),
            createdAt: r.submitted_at,
            system: false,
            type: 'DiscussionNote',
            resolvable: null,
            resolved: null,
            position: null
          }
        ]
      });
    }

    // Group review comments into threads by their reply root. GitHub does not
    // return a thread id on REST review comments, so the root comment stands
    // in for one: every reply carries `in_reply_to_id` pointing at it, and
    // GraphQL reports that same comment as the thread's first comment, which
    // is what lets `fetchReviewThreadIndex` join the two.
    const threadMap = new Map<number, GHComment[]>();
    for (const c of reviewComments) {
      const rootId = c.in_reply_to_id ?? c.id;
      const thread = threadMap.get(rootId) ?? [];
      thread.push(c);
      threadMap.set(rootId, thread);
    }

    for (const [rootId, comments] of threadMap) {
      comments.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      // No match means the GraphQL read failed or the thread arrived after
      // it. `resolvable: true` with `resolved: null` is exactly what this
      // method reported before MAT-27, so an unmatched thread degrades to the
      // old answer instead of to a wrong one.
      //
      // A matched thread also reports `resolvable: true`, unconditionally.
      // GitHub has no per-thread resolvability flag: every review thread can
      // be resolved, so there is nothing else to encode. `viewerCanResolve`
      // exists on the schema but answers a different question, whether the
      // calling user has permission, not whether the thread itself is
      // resolvable, so mapping it onto this field would trade one wrong
      // answer for another.
      const thread = threads.get(rootId);
      discussions.push({
        id: `gh-review-thread-${rootId}`,
        resolvable: true,
        resolved: thread ? thread.isResolved : null,
        notes: comments.map(c => toNote(c, thread ? thread.isResolved : null, oldPaths))
      });
    }

    return { mrIid, repositoryId, discussions };
  }

  /**
   * `github:<owner>/<repo>` names the repo directly; the older
   * `github:<digits>` form costs a `GET /repositories/{id}` per call.
   */
  private async discussionRepo(repositoryId: string): Promise<{ owner: string; repo: string }> {
    const named = repositoryId.slice(repositoryId.indexOf(':') + 1);
    if (named.includes('/')) return this.splitOwnerRepo(named);
    const repoId = parseInt(repositoryId.split(':').pop() ?? '0', 10);
    const repoRes = await this.api('GET', `/repositories/${repoId}`);
    if (!repoRes.ok) {
      throw new Error(`Failed to fetch repo: ${repoRes.status}`);
    }
    const repo = (await repoRes.json()) as { full_name: string };
    return this.splitOwnerRepo(repo.full_name);
  }

  /**
   * The per-branch detail read below requires admin access on the
   * repository, so a non-admin token that previously resolved with a full
   * list now throws on the first protected branch it cannot read. That is
   * the interface docstring's rule (MAT-147) playing out here: this method
   * keeps the throw rather than returning whatever branches it did manage
   * to read, because a caller gating a destructive action on this list has
   * no way to know the list stopped short. If admin-less callers become
   * common enough that this hurts, the honest fix is to change the return
   * type to say which branches were unreadable, not to pick a default and
   * hope it is never wrong.
   */
  async fetchBranchProtectionRules(
    projectPath: string
  ): Promise<BranchProtectionRule[]> {
    let branches: Array<{
      name: string;
      protected: boolean;
      protection?: {
        enabled: boolean;
        required_status_checks?: {
          enforcement_level: string;
          contexts: string[];
        } | null;
      };
    }>;
    try {
      const res = await this.octokit.request(
        `GET /repos/${projectPath}/branches?protected=true&per_page=100`
      );
      branches = res.data as typeof branches;
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        throw ghError('fetchBranchProtectionRules', err);
      }
      throw err;
    }

    const rules: BranchProtectionRule[] = [];
    for (const b of branches) {
      if (!b.protected) continue;
      // Fetch detailed protection for each protected branch
      let detail: {
        allow_force_pushes?: { enabled: boolean };
        allow_deletions?: { enabled: boolean };
        required_pull_request_reviews?: {
          required_approving_review_count?: number;
        } | null;
        required_status_checks?: { strict: boolean; contexts: string[] } | null;
      };
      try {
        const detailRes = await this.octokit.request(
          `GET /repos/${projectPath}/branches/${encodeURIComponent(b.name)}/protection`
        );
        detail = detailRes.data as typeof detail;
      } catch (err) {
        if (!(err instanceof RequestError && err.response)) throw err;
        // The invented rule this replaces was wrong in both directions at once:
        // it claimed force-push and deletion were forbidden while also claiming
        // no approvals and no status checks were required, and a caller had no
        // way to tell those four values from real ones (MAT-131). On a private
        // repository on the free plan this is a 403, which the message surfaces.
        // Not `ghError`-shaped: the prefix here is "reading protection for
        // ...", not "op failed:", so the body is read with `bodyText` directly.
        //
        // The branch name was already in this message; the part missing was
        // that throwing here also discards every rule already accumulated in
        // `rules` for branches read before this one (MAT-147). Saying so
        // (rather than repeating the branch name) is what tells a caller
        // debugging this whether earlier branches even mattered.
        const discarded =
          rules.length > 0
            ? ` (discarding ${rules.length} already-read rule${rules.length === 1 ? '' : 's'})`
            : '';
        throw new Error(
          `fetchBranchProtectionRules failed reading protection for "${b.name}": ${err.status} ${bodyText(err)}${discarded}`
        );
      }
      rules.push({
        pattern: b.name,
        allowForcePush: detail.allow_force_pushes?.enabled ?? false,
        allowDeletion: detail.allow_deletions?.enabled ?? false,
        requiredApprovals:
          detail.required_pull_request_reviews
            ?.required_approving_review_count ?? 0,
        requireStatusChecks:
          detail.required_status_checks !== null &&
          detail.required_status_checks !== undefined,
        raw: detail as unknown as Record<string, unknown>
      });
    }
    return rules;
  }

  async deleteBranch(projectPath: string, branch: string): Promise<void> {
    try {
      await this.octokit.request(
        `DELETE /repos/${projectPath}/git/refs/heads/${encodeURIComponent(branch)}`
      );
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        // The existing message is the plain shape (status plus body, no
        // statusText): `ghError`'s default style reproduces it exactly.
        throw ghError('deleteBranch', err);
      }
      throw err;
    }
  }

  async fetchPullRequestByBranch(
    projectPath: string,
    sourceBranch: string,
    state: MRState | 'all' = 'opened'
  ): Promise<PullRequest | null> {
    const ghState = mapStateToGitHubQueryParam(state);

    // Fast path: GitHub's `head` filter requires `<owner>:<branch>`, and we
    // only know the BASE repo's owner here -- this matches same-repo
    // branches but never matches a fork PR (whose head lives under a
    // different owner).
    // The whole "owner:branch" value is encoded together, not just the
    // branch half. Octokit's endpoint parser rewrites `:word` into a route
    // placeholder before this string ever reaches fetch, and an unencoded
    // colon here reads as exactly that: `head=o:mybranch` becomes the
    // placeholder `{mybranch}`, which expands to empty with no parameters
    // supplied, silently turning this into a query for any PR from the
    // owner instead of this branch's PR. Because the whole value goes
    // through `encodeURIComponent` before it is spliced in, the colon is
    // already `%3A` by the time this string exists -- there is no raw `:`
    // left for the placeholder rewrite to find, on this route or the
    // fallback one below, so calling `octokit.request` directly here (unlike
    // arbitrary future paths) needs no extra escaping.
    let prs: GHPullRequest[];
    try {
      const res = await this.octokit.request(
        `GET /repos/${projectPath}/pulls?head=${encodeURIComponent(`${projectPath.split('/')[0]}:${sourceBranch}`)}&state=${ghState}&per_page=1`
      );
      prs = res.data as GHPullRequest[];
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        this.log.warn('fetchPullRequestByBranch failed', {
          projectPath,
          sourceBranch,
          status: err.status
        });
        return null;
      }
      throw err;
    }
    if (prs[0]) {
      return this.fetchSingleMR(projectPath, prs[0].number, null);
    }

    // Fallback: list PRs in the target state and match by head.ref
    // client-side, which catches fork PRs the head-filtered fast path
    // above can never see. First match wins. We walk up to 5 pages (500
    // PRs) and stop early on a match or a short page (< 100, i.e. the
    // last page). This is a bounded scan, not an exhaustive search:
    // branches whose PR sits beyond the first 500 in the target state
    // are reported as not found. Callers that need an exhaustive lookup
    // should use fetchSingleMR by number instead.
    const maxPages = 5;
    for (let page = 1; page <= maxPages; page++) {
      let list: GHPullRequest[];
      try {
        const listRes = await this.octokit.request(
          `GET /repos/${projectPath}/pulls?state=${ghState}&per_page=100&page=${page}`
        );
        list = listRes.data as GHPullRequest[];
      } catch (err) {
        if (err instanceof RequestError && err.response) {
          this.log.warn('fetchPullRequestByBranch failed', {
            projectPath,
            sourceBranch,
            status: err.status
          });
          return null;
        }
        throw err;
      }
      const match = list.find((pr) => pr.head.ref === sourceBranch);
      if (match) {
        return this.fetchSingleMR(projectPath, match.number, null);
      }
      if (list.length < 100) {
        // Short page: this was the last page, nothing left to scan.
        return null;
      }
      if (page === maxPages) {
        this.log.warn('fetchPullRequestByBranch: fallback scan hit page limit', {
          projectPath,
          sourceBranch
        });
      }
    }
    return null;
  }

  /**
   * Batch branch -> PR resolution (MAT-151).
   *
   * The cost: **one GraphQL lookup per `BRANCH_BATCH_SIZE` (50) branches,
   * then one GraphQL fill per `FILL_BATCH_SIZE` (25) PRs found**, plus one
   * request per extra page of checks on a PR with more than 100. GitHub's
   * schema has no multi-branch filter, so the lookup and the fill stay two
   * requests where GitLab answers in one; 20 branches cost 2.
   *
   * Hits are resolved through the same fill `fetchSingleMR` reads from, so a
   * branch looked up either way yields the same object rather than a
   * thinner batch-shaped one. Misses map to `null` without a further
   * request. Every input branch is a key of the returned Map, and an empty
   * `branches` issues no requests at all. A hit whose fill failed also maps
   * to `null`, as it did when each hit went through `fetchSingleMR`; a rate
   * limit on either request throws `RateLimitedError`.
   *
   * Three lookup semantics, each chosen to agree with a sibling rather than
   * on its own merits, because a caller's whole reason to use this method is
   * that it answers the same question the other paths do:
   *
   * 1. **An omitted `state` means `'opened'`** -- what
   *    `GitLabProvider.fetchPullRequestsByBranches` defaults to. Same call,
   *    same question, either forge.
   * 2. **`'closed'` matches merged PRs too** (`[CLOSED, MERGED]`), because
   *    REST has no MERGED and `fetchPullRequestByBranch` therefore does. Only
   *    `'merged'` narrows to merged alone; `'all'` sends no filter, as on
   *    GitLab.
   * 3. **Multiple PRs on one branch resolve created-descending**, matching
   *    the default sort `fetchPullRequestByBranch`'s REST call takes its
   *    first result from.
   *
   * Unlike `fetchPullRequestByBranch` -- which reports an HTTP failure as
   * `null`, indistinguishable from "this branch has no PR" -- a failed lookup
   * here throws (MAT-133, via `graphqlRead`). One query carries up to 50
   * branches, so swallowing it would report 50 branches as PR-less on the
   * strength of one 502.
   *
   * Fork PRs are found without the client-side scan the REST path needs:
   * GraphQL's `headRefName` matches on the ref name itself, not on the
   * `owner:branch` pair REST's `head` filter requires.
   */
  async fetchPullRequestsByBranches(
    projectPath: string,
    branches: string[],
    state?: MRState | 'all'
  ): Promise<Map<string, PullRequest | null>> {
    const result = new Map<string, PullRequest | null>();
    if (branches.length === 0) return result;

    const { owner, repo } = this.splitOwnerRepo(projectPath);
    const states = mapStateToGraphQLStates(state);

    // Branch -> PR number for the branches that have one. Keyed by branch
    // rather than by alias: aliases are per-chunk and restart at b0.
    const numbers = new Map<string, number>();

    for (let i = 0; i < branches.length; i += BRANCH_BATCH_SIZE) {
      const batch = branches.slice(i, i + BRANCH_BATCH_SIZE);

      // Branch names reach the server as variables, never as query text: a
      // ref name may contain any of `)`, `{`, `#` or a quote, and splicing
      // one in would let a branch name rewrite the query. The aliases and
      // variable names below are generated from the index alone.
      const stateArg = states ? ', states: $states' : '';
      // `orderBy` is CREATED_AT DESC, not the more obvious UPDATED_AT, so
      // that a branch carrying more than one PR resolves to the same one
      // `fetchPullRequestByBranch` picks: its REST call takes the first
      // result of `GET /pulls`, whose default sort is created-descending.
      // Ordering by UPDATED_AT instead would return the more recently
      // *touched* PR, which on a reused branch is frequently the older one
      // -- and U2 asserts live that the two paths agree, so this ordering is
      // an invariant of that agreement rather than a preference.
      const fields = batch
        .map(
          (_, j) =>
            `b${j}: pullRequests(headRefName: $h${j}${stateArg}, first: 1, orderBy: {field: CREATED_AT, direction: DESC}) { nodes { number } }`
        )
        .join('\n            ');
      const query = `
        query GlancePullRequestsByBranches($owner: String!, $repo: String!${
          states ? ', $states: [PullRequestState!]' : ''
        }, ${batch.map((_, j) => `$h${j}: String!`).join(', ')}) {
          repository(owner: $owner, name: $repo) {
            ${fields}
          }
        }
      `;

      const variables: Record<string, unknown> = { owner, repo };
      if (states) variables.states = states;
      batch.forEach((branch, j) => {
        variables[`h${j}`] = branch;
      });

      const { data, errors } = await this.graphqlRead<GHBranchPullRequestsResponse>(
        'fetchPullRequestsByBranches',
        query,
        variables
      );
      if (errors.length > 0) {
        throw new Error(
          `fetchPullRequestsByBranches failed: GitHub GraphQL returned ${errors.map(e => e.message).join('; ')}`
        );
      }
      const repository = data.repository;
      if (!repository) {
        // Every alias would read as "no PR" against a null repository, which
        // is the whole batch degrading to misses on what is really an access
        // or a typo'd path.
        throw new Error(
          `fetchPullRequestsByBranches failed: GitHub reported no repository ${projectPath}`
        );
      }
      batch.forEach((branch, j) => {
        const number = repository[`b${j}`]?.nodes?.[0]?.number;
        if (number != null) numbers.set(branch, number);
      });
    }

    const filled = await this.fillPullRequests(projectPath, [...new Set(numbers.values())], {
      listWeight: false,
      roles: new Map()
    });
    for (const branch of branches) {
      const number = numbers.get(branch);
      result.set(branch, number === undefined ? null : (filled.get(number) ?? null));
    }
    return result;
  }

  /**
   * Every route built in this method and in `updatePullRequest` below
   * interpolates only `projectPath`/`input.projectPath` (an `owner/repo`
   * string, and GitHub forbids a colon in either half of that) and a
   * numeric PR number, never a value with a colon in it. Unlike
   * `fetchPullRequestByBranch`'s `owner:branch` value, there is nothing
   * here for Octokit's endpoint parser to rewrite into an empty route
   * placeholder, so none of these routes carry the defensive `%3A` escape
   * `api()` applies as a last line of defense. If a future change threads
   * a caller-supplied string (a title, a branch name) into one of these
   * routes rather than the request body, that guard needs to come back.
   */
  async createPullRequest(input: CreatePullRequestInput): Promise<PullRequest> {
    const body: Record<string, unknown> = {
      head: input.sourceBranch,
      base: input.targetBranch,
      title: input.title
    };
    if (input.description != null) body.body = input.description;
    if (input.draft != null) body.draft = input.draft;

    let created: GHPullRequest;
    try {
      const res = await this.octokit.request(
        `POST /repos/${input.projectPath}/pulls`,
        { data: body }
      );
      created = res.data as GHPullRequest;
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        throw ghError('createPullRequest', err);
      }
      throw err;
    }

    // GitHub doesn't support reviewers/assignees/labels on create -- add them
    // separately. The PR above already exists by this point: a failure here
    // is not "no PR was created," it is "PR #<n> exists without this one
    // field applied." The op label below names both the sub-operation and
    // the PR number so a caller (or a human reading the thrown message) can
    // tell the two apart and find the PR that already exists, instead of
    // retrying and hitting GitHub's own "a pull request already exists" 422.
    if (input.reviewers?.length) {
      await this.fireAndThrow(
        `createPullRequest reviewers for #${created.number}`,
        `POST /repos/${input.projectPath}/pulls/${created.number}/requested_reviewers`,
        { reviewers: input.reviewers }
      );
    }
    if (input.assignees?.length) {
      await this.fireAndThrow(
        `createPullRequest assignees for #${created.number}`,
        `POST /repos/${input.projectPath}/issues/${created.number}/assignees`,
        { assignees: input.assignees }
      );
    }
    if (input.labels?.length) {
      await this.fireAndThrow(
        `createPullRequest labels for #${created.number}`,
        `POST /repos/${input.projectPath}/issues/${created.number}/labels`,
        { labels: input.labels }
      );
    }

    return this.fetchSingleMRAfterMutation(
      input.projectPath,
      created.number,
      'Created'
    );
  }

  /**
   * `input.draft` is applied with a GraphQL mutation, not through the PATCH:
   * GitHub's REST update endpoint has no `draft` field, so the value the
   * previous code put in the request body was silently discarded (MAT-15).
   */
  async updatePullRequest(
    projectPath: string,
    mrIid: number,
    input: UpdatePullRequestInput
  ): Promise<PullRequest> {
    const body: Record<string, unknown> = {};
    if (input.title != null) body.title = input.title;
    if (input.description != null) body.body = input.description;
    if (input.targetBranch != null) body.base = input.targetBranch;
    if (input.stateEvent)
      body.state = input.stateEvent === 'close' ? 'closed' : 'open';

    let patched: GHPullRequest;
    try {
      const res = await this.octokit.request(
        `PATCH /repos/${projectPath}/pulls/${mrIid}`,
        { data: body }
      );
      patched = res.data as GHPullRequest;
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        throw ghError('updatePullRequest', err);
      }
      throw err;
    }

    if (input.draft != null) {
      if (patched.draft !== input.draft) {
        await this.setDraft(patched.node_id, input.draft);
      }
    }

    // Handle reviewers/assignees/labels replacement if provided. Octokit
    // throws on a non-2xx here, where the old fetch-based code never checked
    // `res.ok` and silently swallowed a failure on all three. Surfacing that
    // failure is a deliberate behavior change (MAT-24 owns these fields). By
    // this point the PATCH above and any draft toggle have already landed,
    // so the op label below names the sub-operation and the PR number,
    // matching createPullRequest's treatment: a caller reading the thrown
    // message can tell "the title/base/draft update landed but reviewers
    // did not" from "nothing happened."
    //
    // `patched` (the PATCH response) already carries the PR's current
    // requested_reviewers/assignees, so the diff below needs no extra read.
    if (input.reviewers) {
      await this.replaceUserSet(
        `updatePullRequest reviewers for #${mrIid}`,
        `/repos/${projectPath}/pulls/${mrIid}/requested_reviewers`,
        'reviewers',
        patched.requested_reviewers,
        input.reviewers
      );
    }
    if (input.assignees) {
      await this.replaceUserSet(
        `updatePullRequest assignees for #${mrIid}`,
        `/repos/${projectPath}/issues/${mrIid}/assignees`,
        'assignees',
        patched.assignees,
        input.assignees
      );
    }
    if (input.labels) {
      await this.fireAndThrow(
        `updatePullRequest labels for #${mrIid}`,
        `PUT /repos/${projectPath}/issues/${mrIid}/labels`,
        { labels: input.labels }
      );
    }

    return this.fetchSingleMRAfterMutation(projectPath, mrIid, 'Updated');
  }

  async restRequest(
    method: string,
    path: string,
    body?: unknown,
    _op?: string,
    io?: { redirect?: 'manual' }
  ): Promise<Response> {
    return this.api(method, path, body, io);
  }

  watchMR(
    _projectPath: string,
    _mrIid: number,
    _currentUserNumericId: number | null,
    _onUpdate: (pr: PullRequest) => void,
    _options?: import('./RealtimeWatcher.ts').RealtimeWatcherOptions
  ): () => void {
    throw new Error(
      'watchMR is not supported by the GitHub REST API. ' +
        'GitHub does not offer a WebSocket subscription equivalent. ' +
        'Check provider capabilities before calling.'
    );
  }

  /**
   * Poll the repository events feed and translate activity into invalidation
   * hints. Same contract as GitLab's `watchEvents`; the feed underneath is
   * different in ways a caller feels:
   *
   * - Cadence defaults to 60s, not GitLab's 15s, because that is what the
   *   server asks for (`WATCH_EVENTS_INTERVAL_MS`). A 200 carrying a larger
   *   `X-Poll-Interval` raises the next wait; it never lowers it below what
   *   the caller configured.
   * - No `pipelines` invalidation is ever delivered. The feed has no CI event
   *   type, so a caller that needs pipeline status keeps its full poll.
   * - The first tick on a cold start delivers nothing: it snapshots page 1 to
   *   seed the cursor, since the feed has no time filter to bound a lookback
   *   with. Full-refresh on boot, as on GitLab.
   * - `options.perPage` is ignored: the feed is always requested at its cap
   *   of 100 per page, which is what makes the 3-page ceiling worth 300
   *   events.
   *
   * @returns dispose. Call to stop the loop.
   */
  watchEvents(
    projectPath: string,
    options: WatchEventsOptions,
    onInvalidations: (batch: InvalidationBatch) => void
  ): () => void {
    const { owner, repo } = this.splitOwnerRepo(projectPath);
    const poller = new GitHubEventsPoller({
      fetchPage: (opts) => this.fetchEventsPage(owner, repo, opts),
      cursor: options.cursor,
      maxPagesPerTick: options.maxPagesPerTick
    });
    const intervalMs = options.intervalMs ?? WATCH_EVENTS_INTERVAL_MS;

    return startWatcherLoop(
      async (): Promise<LoopTick> => {
        const result = await poller.tick();
        // One timestamp per tick, not one per field: the batch's `syncedAt`
        // and the loop's own notion of when this tick landed must not be two
        // clock reads that can disagree.
        const syncedAt = new Date().toISOString();
        // The poller already returns [] on a cold start, so an empty list is
        // the only "nothing to say" signal this needs.
        const batch: InvalidationBatch | null =
          result.invalidations.length > 0
            ? { invalidations: result.invalidations, syncedAt, cursor: result.cursor }
            : null;
        // Server-directed cadence, one way only: honor a slower request,
        // ignore one that would poll faster than the caller asked for.
        const serverMs = result.serverPollIntervalMs;
        const nextIntervalMs =
          serverMs != null && serverMs > intervalMs ? serverMs : undefined;
        return { batch, cursor: result.cursor, nextIntervalMs };
      },
      { ...options, intervalMs },
      onInvalidations,
      this.log
    );
  }

  /**
   * One conditional GET of the events feed.
   *
   * Octokit does not return a 304 -- it throws a `RequestError` with
   * `status: 304`, since there is no body to hand back. Translating that
   * here is what keeps a "nothing changed" tick from reaching the watcher
   * loop as a failure and tripping its backoff, which would turn the
   * steady-state response into an outage.
   *
   * `If-None-Match` goes out on page 1 only (the etag describes the head of
   * the feed), and no `since`/`after` is ever sent: the feed has no such
   * parameter, and inventing one would silently filter nothing.
   */
  private async fetchEventsPage(
    owner: string,
    repo: string,
    opts: { page: number; etag: string | null }
  ): Promise<Awaited<ReturnType<FetchGitHubEventsPage>>> {
    if (opts.page > EVENTS_MAX_PAGE) {
      throw new Error(
        `fetchEventsPage: the events feed serves at most ${EVENTS_MAX_PAGE} pages, got page ${opts.page}`
      );
    }
    const headers: Record<string, string> = {};
    if (opts.page === 1 && opts.etag) headers['if-none-match'] = opts.etag;

    let res: { headers: Record<string, unknown>; data: unknown };
    try {
      res = await this.octokit.request('GET /repos/{owner}/{repo}/events', {
        owner,
        repo,
        per_page: EVENTS_PER_PAGE,
        page: opts.page,
        headers
      });
    } catch (err) {
      // Duck-typed on purpose, unlike every other catch in this file, which
      // narrows with `instanceof RequestError`. A 304 is what a healthy
      // watcher gets on nearly every tick, so if the two RequestError copies
      // ever stop deduping (see this file's import comment), an `instanceof`
      // here would silently reclassify the steady state as a failure and
      // leave the loop permanently backing off. Only `.status` is needed,
      // and reading it cannot go false.
      if ((err as { status?: unknown } | null)?.status === 304) {
        return { status: 304, events: [], etag: null, pollIntervalSec: null };
      }
      throw err;
    }

    const etag = res.headers.etag;
    const pollInterval = Number(res.headers['x-poll-interval']);
    return {
      status: 200,
      events: (res.data ?? []) as GitHubEvent[],
      etag: typeof etag === 'string' ? etag : null,
      // A missing header parses to NaN, a blank one to 0; neither is a
      // cadence, and both must read as "the server said nothing".
      pollIntervalSec: Number.isFinite(pollInterval) && pollInterval > 0 ? pollInterval : null
    };
  }

  /**
   * When `shouldRemoveSourceBranch` is set, the branch deletion happens as a
   * second call after the merge PUT has already succeeded and been read
   * back. If that cleanup fails, the merge still resolves, with the reason
   * in `sourceBranchNotDeleted`: a rejection here would read as "the merge
   * failed", and a caller retrying on it would re-issue a merge that landed.
   */
  async mergePullRequest(
    projectPath: string,
    mrIid: number,
    input?: MergePullRequestInput
  ): Promise<MergePullRequestResult> {
    const body: Record<string, unknown> = {};
    const mergeMethod =
      input?.mergeMethod ?? (input?.squash ? 'squash' : undefined);
    if (mergeMethod) body.merge_method = mergeMethod;
    Object.assign(body, this.mergeCommitFields(input, mergeMethod));
    if (input?.sha != null) body.sha = input.sha;

    try {
      await this.octokit.request(
        `PUT /repos/${projectPath}/pulls/${mrIid}/merge`,
        { data: body }
      );
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        // The live conformance harness (conformance.ts:838) matches
        // /\bmergePullRequest failed: 405\b/ on this exact message. Do not
        // reword it.
        throw ghError('mergePullRequest', err);
      }
      throw err;
    }
    const pr = await this.fetchSingleMRAfterMutation(projectPath, mrIid, 'Merged');
    if (!input?.shouldRemoveSourceBranch) return pr;
    const notDeleted = await this.removeMergedSourceBranch(projectPath, mrIid, pr.sourceBranch);
    return notDeleted === null ? pr : { ...pr, sourceBranchNotDeleted: notDeleted };
  }

  /**
   * Deletes a merged PR's source branch from the repository that owns it.
   * Resolves null once the branch is gone, or the one-sentence reason it is
   * still there. Never throws: the merge in front of it already landed.
   */
  private async removeMergedSourceBranch(
    projectPath: string,
    mrIid: number,
    branch: string
  ): Promise<string | null> {
    const notDeleted = (why: string) => `The source branch "${branch}" was not deleted: ${why}`;
    // `branch` is `head.ref`, a branch name with no repository
    // attached. For a same-repo PR that name lives in `projectPath`, but
    // for a fork PR it lives in the fork, and deleting against
    // `projectPath` would either 404 (branch never existed there, so the
    // delete silently does nothing while reporting success) or, worse,
    // delete an unrelated same-named branch in the base repo. The raw PR
    // (not the mapped `PullRequest`, which carries no head-repo field)
    // has to be read to find out which repository actually owns the ref.
    let raw: GHPullRequest | null = null;
    try {
      const res = await this.octokit.request(`GET /repos/${projectPath}/pulls/${mrIid}`);
      raw = res.data as GHPullRequest;
    } catch (err) {
      // A failed read is not a deleted fork: saying so would send the
      // caller looking for the wrong problem.
      if (err instanceof RateLimitedError) {
        return notDeleted(
          `reading the PR to find its head repository was rate limited${err.resetAt ? ` until ${err.resetAt}` : ''}`
        );
      }
      if (!(err instanceof RequestError && err.status === 404)) {
        const reason =
          err instanceof RequestError && err.response
            ? `${err.status} ${bodyText(err)}`
            : err instanceof Error
              ? err.message
              : String(err);
        return notDeleted(`reading the PR to find its head repository failed: ${reason}`);
      }
    }
    const headRepo = raw?.head?.repo?.full_name;
    if (!headRepo) {
      return notDeleted(
        'its head repository is unknown (the fork was likely deleted), so the delete could not be targeted safely'
      );
    }
    const refused = await this.deleteMergedSourceBranch(headRepo, branch);
    return refused === null ? null : notDeleted(refused);
  }

  /**
   * Pick the one commit message that applies to this merge.
   *
   * GitHub carries a single commit-message pair per merge: `commit_title` and
   * `commit_message` are the title and body of one commit, not a merge variant
   * and a squash variant. `commitMessage` and `squashCommitMessage` are
   * alternates selected by strategy (types.ts), so sending both would put a
   * squash message in the body of a merge commit. Sending both onto
   * `commit_title` is MAT-25, where the second silently overwrote the first.
   */
  private mergeCommitFields(
    input: MergePullRequestInput | undefined,
    mergeMethod: string | undefined
  ): { commit_title?: string; commit_message?: string } {
    // A squash with no squash-specific message still has the caller's intent in
    // commitMessage, and GitHub produces exactly one commit either way, so
    // falling back preserves it instead of discarding it. The reverse case is
    // symmetric: a caller who supplies only squashCommitMessage and no
    // mergeMethod clearly meant that message to be used, and since GitHub
    // produces one commit regardless of method, dropping it serves nobody.
    // This does not weaken MAT-25: when both messages are supplied, exactly
    // one is still selected.
    const chosen =
      mergeMethod === 'squash'
        ? (input?.squashCommitMessage ?? input?.commitMessage)
        : (input?.commitMessage ?? input?.squashCommitMessage);
    if (chosen == null) return {};

    // Strip leading newlines to avoid empty commit_title in the request body.
    const trimmed = chosen.replace(/^\n+/, '');
    if (trimmed === '') return {};

    const firstBreak = trimmed.indexOf('\n');
    if (firstBreak === -1) return { commit_title: trimmed };
    const rest = trimmed.slice(firstBreak + 1).replace(/^\n+/, '');
    return rest
      ? { commit_title: trimmed.slice(0, firstBreak), commit_message: rest }
      : { commit_title: trimmed.slice(0, firstBreak) };
  }

  /**
   * GitHub's merge endpoint has no delete-branch parameter: it accepts only
   * commit_title, commit_message, sha, and merge_method. The `delete_branch`
   * field this used to send was silently ignored, so callers asking for branch
   * removal never got it (MAT-127). The ref has to be deleted in a second call.
   *
   * A ref that is already gone satisfies what the caller asked for. The
   * repository-level delete_branch_on_merge setting deletes it asynchronously
   * and races this call, so treating "not there" as failure would make every
   * merge on such a repository throw.
   *
   * GitHub's 422 status is ambiguous: it means both "reference does not exist"
   * and (in some cases) "deletion blocked by branch protection". The intent
   * ("ref is gone") is verified by checking whether the ref still exists, not
   * by status code alone. If it is gone, the caller's end state is satisfied.
   *
   * `repoPath` is the repository that owns `branch`, which for a fork PR is
   * the fork, not the base repository the PR was opened against. The caller
   * resolves that from `head.repo.full_name` before calling in.
   *
   * Resolves null once the ref is gone, or why it may still be there.
   */
  private async deleteMergedSourceBranch(
    repoPath: string,
    branch: string
  ): Promise<string | null> {
    try {
      await this.octokit.request(
        `DELETE /repos/${repoPath}/git/refs/heads/${encodeURIComponent(branch)}`
      );
      return null;
    } catch (deleteErr) {
      if (!(deleteErr instanceof RequestError && deleteErr.response)) {
        const reason = deleteErr instanceof Error ? deleteErr.message : String(deleteErr);
        return `the delete request failed before GitHub answered: ${reason}`;
      }

      // Verify whether the ref still exists. If it is gone, the caller's
      // requested end state is satisfied. If it still exists, report the
      // deletion failure details below. GitHub reuses 422 for both
      // "reference does not exist" and a protection-refused delete, so the
      // status code alone cannot distinguish them.
      try {
        await this.octokit.request(
          `GET /repos/${repoPath}/git/ref/heads/${encodeURIComponent(branch)}`
        );
        // No throw means the ref still exists: fall through to the report below.
      } catch (checkErr) {
        if (
          checkErr instanceof RequestError &&
          checkErr.response &&
          checkErr.status === 404
        ) {
          return null; // Confirmed gone: the requested end state is satisfied.
        }
        // Cannot verify the end state: either a non-404 HTTP response (ref
        // still there, or an unrelated error on the check) or a transport
        // failure on the check itself (no `.response`, e.g. a dropped
        // connection). Both fall through to the deletion-failure report
        // below, deliberately, including the transport case. The merge
        // above already succeeded; an unverifiable branch deletion is a
        // deletion failure, not a merge failure.
      }

      return `GitHub refused the delete with ${deleteErr.status} ${bodyText(deleteErr)}`;
    }
  }

  async approvePullRequest(projectPath: string, mrIid: number): Promise<void> {
    try {
      await this.octokit.request(
        `POST /repos/${projectPath}/pulls/${mrIid}/reviews`,
        { data: { event: 'APPROVE' } }
      );
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        // The live conformance harness matches /approvePullRequest failed:
        // 422\b/ on this message. When a second identity is configured that
        // identity approves for real and this message is never produced;
        // this 422 is only the fallback proof of request shape and auth
        // for a single-identity run, where self-approval is the only call
        // available to make.
        throw ghError('approvePullRequest', err, 'statusText');
      }
      throw err;
    }
  }

  /**
   * Withdraw the token user's approval by dismissing their review.
   *
   * Not identical to GitLab's unapprove, and the difference is caller-visible:
   * GitLab removes the approval record, GitHub leaves a `DISMISSED` review in
   * the list.
   *
   * Only `APPROVE` and `REQUEST_CHANGES` reviews change a reviewer's state on
   * GitHub; a `COMMENT` review does not. The review that currently carries
   * the approval is therefore the newest APPROVED-or-CHANGES_REQUESTED
   * review, not simply the newest review of any kind -- a comment left after
   * approving must not be mistaken for a state change and must not shadow
   * the approval that is still in effect.
   *
   * Throws when there is nothing to dismiss. Resolving would be the silent
   * no-op shape: the caller would believe an approval was revoked when none
   * existed. GitLab's own unapprove answers a non-approved MR with a 404,
   * which its SDK also turns into a throw.
   */
  async unapprovePullRequest(
    projectPath: string,
    mrIid: number
  ): Promise<void> {
    const { owner, repo } = this.splitOwnerRepo(projectPath);
    const me = (await this.validateToken()).username;

    let reviews: GHReview[];
    try {
      reviews = await this.octokit.paginate<GHReview>(
        'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
        { owner, repo, pull_number: mrIid, per_page: 100 }
      );
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        throw ghError('unapprovePullRequest', err, 'statusText');
      }
      throw err;
    }

    // Only APPROVE and REQUEST_CHANGES reviews change a reviewer's state on
    // GitHub, so a later COMMENT review must not be picked over a still-
    // current approval. Filtering to state-bearing reviews before taking
    // the newest is what makes that true, sorted by `submitted_at` rather
    // than trusting list order.
    const mine = reviews
      .filter(
        r =>
          r.user?.login === me &&
          (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED')
      )
      .sort(
        (a, b) =>
          new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime()
      );
    const latest = mine[mine.length - 1];

    if (!latest || latest.state !== 'APPROVED') {
      throw new Error(
        `unapprovePullRequest failed: ${me} has no current approval on ${projectPath}!${mrIid} to dismiss`
      );
    }

    try {
      await this.octokit.request(
        'PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/dismissals',
        {
          owner,
          repo,
          pull_number: mrIid,
          review_id: latest.id,
          message: DISMISSAL_MESSAGE,
          event: 'DISMISS'
        }
      );
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        throw ghError('unapprovePullRequest', err, 'statusText');
      }
      throw err;
    }
  }

  async rebasePullRequest(_projectPath: string, _mrIid: number): Promise<void> {
    // TODO: GitHub has no native "rebase" API for pull requests.
    // The closest equivalent is the update-branch API:
    //   PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch
    // which updates the PR branch with the latest from the base branch,
    // but it's a merge (not a rebase). True rebase requires pushing
    // locally rebased commits.
    throw new Error(
      'rebasePullRequest is not supported by GitHub. ' +
        'Check provider.capabilities.canRebase before calling.'
    );
  }

  /**
   * The GraphQL node id for a pull request the caller named by number.
   *
   * Both auto-merge mutations address a PR by node id and `GitProvider` only
   * hands this provider `projectPath` and `mrIid`, so every call pays one
   * REST read for the translation.
   */
  private async pullRequestNodeId(
    op: string,
    projectPath: string,
    mrIid: number
  ): Promise<string> {
    const { owner, repo } = this.splitOwnerRepo(projectPath);
    let pr: GHPullRequest;
    try {
      const res = await this.octokit.request(
        'GET /repos/{owner}/{repo}/pulls/{pull_number}',
        { owner, repo, pull_number: mrIid }
      );
      pr = res.data as GHPullRequest;
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        throw ghError(op, err, 'statusText');
      }
      throw err;
    }
    if (!pr.node_id) {
      throw new Error(`${op} failed: ${projectPath}!${mrIid} carries no GraphQL node id`);
    }
    return pr.node_id;
  }

  /**
   * Merge this pull request once its required checks pass.
   *
   * REST has no auto-merge endpoint, so this is GraphQL only. Two repository
   * preconditions are GitHub's, not this SDK's: `allow_auto_merge` must be on,
   * and GitHub refuses `enablePullRequestAutoMerge` at both ends of the
   * mergeability range -- "clean" (nothing left to wait for) and "unstable"
   * (won't queue behind failing/pending checks) -- so the round trip is only
   * provable when a run happens to land the pull request inside the armable
   * window between them. In a repository with no required status checks, a
   * pull request with checks still pending is "unstable", which is the
   * primary use case a consumer who just read `canAutoMerge: true` hits.
   */
  async setAutoMerge(projectPath: string, mrIid: number): Promise<void> {
    const nodeId = await this.pullRequestNodeId('setAutoMerge', projectPath, mrIid);
    const mutation = `
      mutation GlanceEnableAutoMerge($id: ID!) {
        enablePullRequestAutoMerge(input: { pullRequestId: $id }) {
          pullRequest { autoMergeRequest { enabledAt } }
        }
      }
    `;

    const data = await this.graphqlOrThrow<{
      enablePullRequestAutoMerge?: {
        pullRequest?: { autoMergeRequest?: { enabledAt?: string | null } | null } | null;
      };
    }>('setAutoMerge', mutation, { id: nodeId });

    // Reading the end state back, not just the absence of an error: an
    // accepted mutation that enabled nothing is indistinguishable from a
    // successful one at the call site otherwise.
    if (!data.enablePullRequestAutoMerge?.pullRequest?.autoMergeRequest?.enabledAt) {
      throw new Error(
        `setAutoMerge failed: GitHub accepted the mutation but reported no auto-merge on ${projectPath}!${mrIid}`
      );
    }
  }

  async fetchMergeQueueStatus(projectPath: string, mrIid: number): Promise<MergeQueueStatus> {
    const { owner, repo } = this.splitOwnerRepo(projectPath);
    const query = `
      query GlanceMergeQueueStatus($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            isMergeQueueEnabled
            isInMergeQueue
            state
            timelineItems(last: 1, itemTypes: [REMOVED_FROM_MERGE_QUEUE_EVENT]) {
              nodes { ... on RemovedFromMergeQueueEvent { createdAt reason } }
            }
          }
        }
      }
    `;
    const data = await this.graphqlOrThrow<{
      repository?: {
        pullRequest?: {
          isMergeQueueEnabled: boolean;
          isInMergeQueue: boolean;
          state: string;
          timelineItems: { nodes: Array<{ createdAt: string; reason: string | null }> };
        } | null;
      } | null;
    }>('fetchMergeQueueStatus', query, { owner, repo, number: mrIid });

    const pr = data.repository?.pullRequest;
    if (!pr) throw new Error(`fetchMergeQueueStatus failed: GitHub returned no pull request for ${projectPath}!${mrIid}`);
    const removal = pr.timelineItems.nodes[0];
    return {
      enabled: pr.isMergeQueueEnabled,
      inQueue: pr.isInMergeQueue,
      merged: pr.state === 'MERGED',
      lastRemoval: removal ? { at: removal.createdAt, reason: removal.reason ?? 'unknown' } : null
    };
  }

  /** Fails with GitHub's own message when the branch has no merge queue. */
  async enqueuePullRequest(
    projectPath: string,
    mrIid: number,
    input: EnqueuePullRequestInput = {}
  ): Promise<MergeQueueEntry> {
    const nodeId = await this.pullRequestNodeId('enqueuePullRequest', projectPath, mrIid);
    const mutation = `
      mutation GlanceEnqueue($id: ID!, $head: GitObjectID) {
        enqueuePullRequest(input: { pullRequestId: $id, expectedHeadOid: $head }) {
          mergeQueueEntry { position state }
        }
      }
    `;

    const data = await this.graphqlOrThrow<{
      enqueuePullRequest?: { mergeQueueEntry?: MergeQueueEntry | null };
    }>('enqueuePullRequest', mutation, { id: nodeId, head: input.expectedHeadSha ?? null });

    const entry = data.enqueuePullRequest?.mergeQueueEntry;
    if (!entry) {
      throw new Error(
        `enqueuePullRequest failed: GitHub accepted the mutation but reported no queue entry on ${projectPath}!${mrIid}`
      );
    }
    return entry;
  }

  /**
   * Disarm a previously-armed auto-merge on this pull request.
   *
   * Same `allow_auto_merge` repository precondition as `setAutoMerge`: GitHub
   * has nothing to disable if that setting was never on for this repository.
   */
  async cancelAutoMerge(projectPath: string, mrIid: number): Promise<void> {
    const nodeId = await this.pullRequestNodeId('cancelAutoMerge', projectPath, mrIid);
    const mutation = `
      mutation GlanceDisableAutoMerge($id: ID!) {
        disablePullRequestAutoMerge(input: { pullRequestId: $id }) {
          pullRequest { autoMergeRequest { enabledAt } }
        }
      }
    `;

    const data = await this.graphqlOrThrow<{
      disablePullRequestAutoMerge?: {
        pullRequest?: { autoMergeRequest?: { enabledAt?: string | null } | null } | null;
      };
    }>('cancelAutoMerge', mutation, { id: nodeId });

    if (data.disablePullRequestAutoMerge?.pullRequest?.autoMergeRequest?.enabledAt) {
      throw new Error(
        `cancelAutoMerge failed: GitHub accepted the mutation but still reports auto-merge on ${projectPath}!${mrIid}`
      );
    }
  }

  // ── Discussion mutations ────────────────────────────────────────────────

  async resolveDiscussion(
    projectPath: string,
    mrIid: number,
    discussionId: string
  ): Promise<void> {
    await this.setThreadResolved('resolveDiscussion', projectPath, mrIid, discussionId, true);
  }

  async unresolveDiscussion(
    projectPath: string,
    mrIid: number,
    discussionId: string
  ): Promise<void> {
    await this.setThreadResolved('unresolveDiscussion', projectPath, mrIid, discussionId, false);
  }

  // ── Comment writes ──────────────────────────────────────────────────────

  async createComment(
    projectPath: string,
    mrIid: number,
    body: string,
    _options?: { resolvable?: boolean }
  ): Promise<NoteWriteResult> {
    const { owner, repo } = this.splitOwnerRepo(projectPath);
    const { data } = await forgeWrite('createComment', this.writeTimeoutMs, (signal) =>
      this.octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
        owner,
        repo,
        issue_number: mrIid,
        body,
        request: { retries: 0, signal }
      })
    );
    const noteId = Number(data.id);
    return { noteId, discussionId: `gh-issue-comment-${noteId}`, resolvable: false, url: data.html_url };
  }

  async createInlineComment(
    projectPath: string,
    mrIid: number,
    body: string,
    anchor: CommentAnchor
  ): Promise<InlineCommentResult> {
    const { owner, repo } = this.splitOwnerRepo(projectPath);
    const { line, side } = githubLineAndSide(anchor);
    const headSignal = AbortSignal.timeout(this.writeTimeoutMs);
    const pr = await this.forgeRead('createInlineComment', () =>
      this.octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
        owner,
        repo,
        pull_number: mrIid,
        // The retry plugin would wait 1, 4 and 9 s after an abort, past the caller's budget.
        request: { signal: headSignal, retries: 0 }
      })
    ).catch((err: unknown) => {
      if (headSignal.aborted) {
        throw new Error("createInlineComment timed out reading the pull request's head commit; nothing was posted", {
          cause: err
        });
      }
      throw err;
    });
    const { data } = await forgeWrite('createInlineComment', this.writeTimeoutMs, (signal) =>
      this.octokit.request('POST /repos/{owner}/{repo}/pulls/{pull_number}/comments', {
        owner,
        repo,
        pull_number: mrIid,
        body,
        commit_id: pr.data.head.sha,
        path: anchor.path,
        line,
        side,
        request: { retries: 0, signal }
      })
    );
    const noteId = Number(data.id);
    return {
      noteId,
      discussionId: `gh-review-thread-${noteId}`,
      resolvable: true,
      url: data.html_url,
      anchored: true,
      noteType: 'DiffNote'
    };
  }

  async replyToDiscussion(
    projectPath: string,
    mrIid: number,
    discussionId: string,
    body: string
  ): Promise<NoteWriteResult> {
    const root = parseReviewThreadDiscussionId(discussionId);
    if (root == null) {
      const what = /^gh-review-\d+$/.test(discussionId) ? 'a review summary' : 'a pull request comment';
      throw new Error(
        `replyToDiscussion: ${discussionId} is ${what} with no thread on GitHub; post a new comment instead`
      );
    }
    const { owner, repo } = this.splitOwnerRepo(projectPath);
    const { data } = await forgeWrite('replyToDiscussion', this.writeTimeoutMs, (signal) =>
      this.octokit.request('POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies', {
        owner,
        repo,
        pull_number: mrIid,
        comment_id: root,
        body,
        request: { retries: 0, signal }
      })
    );
    return { noteId: Number(data.id), discussionId, resolvable: true, url: data.html_url };
  }

  async updateComment(projectPath: string, mrIid: number, note: NoteRef, body: string): Promise<void> {
    const { owner, repo } = this.splitOwnerRepo(projectPath);
    if (note.kind === 'review') {
      await forgeWrite('updateComment', this.writeTimeoutMs, (signal) =>
        this.octokit.request('PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}', {
          owner,
          repo,
          pull_number: mrIid,
          review_id: note.id,
          body,
          request: { retries: 0, signal }
        })
      );
      return;
    }
    const kind = note.kind ?? (await this.commentKind('updateComment', projectPath, mrIid, note.id));
    const params = { owner, repo, comment_id: note.id, body };
    await forgeWrite<unknown>('updateComment', this.writeTimeoutMs, (signal) =>
      kind === 'diff'
        ? this.octokit.request('PATCH /repos/{owner}/{repo}/pulls/comments/{comment_id}', {
            ...params,
            request: { retries: 0, signal }
          })
        : this.octokit.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
            ...params,
            request: { retries: 0, signal }
          })
    );
  }

  async deleteComment(projectPath: string, mrIid: number, note: NoteRef): Promise<void> {
    if (note.kind === 'review') throw new Error('GitHub cannot delete a submitted review');
    const { owner, repo } = this.splitOwnerRepo(projectPath);
    const kind = note.kind ?? (await this.commentKind('deleteComment', projectPath, mrIid, note.id));
    const params = { owner, repo, comment_id: note.id };
    await forgeWrite<unknown>('deleteComment', this.writeTimeoutMs, (signal) =>
      kind === 'diff'
        ? this.octokit.request('DELETE /repos/{owner}/{repo}/pulls/comments/{comment_id}', {
            ...params,
            request: { retries: 0, signal }
          })
        : this.octokit.request('DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}', {
            ...params,
            request: { retries: 0, signal }
          })
    );
  }

  async submitReview(projectPath: string, mrIid: number, review: ReviewSubmission): Promise<ReviewSubmitResult> {
    const { owner, repo } = this.splitOwnerRepo(projectPath);
    return submitGitHubReview(
      {
        octokit: this.octokit,
        owner,
        repo,
        pullNumber: mrIid,
        reviewTimeoutMs: this.reviewTimeoutMs,
        read: (op, fn) => this.forgeRead(op, fn),
        reply: (discussionId, body) => this.replyToDiscussion(projectPath, mrIid, discussionId, body),
        resolve: (discussionId) => this.resolveDiscussion(projectPath, mrIid, discussionId)
      },
      review
    );
  }

  private commentKind(op: string, projectPath: string, mrIid: number, id: number): Promise<GitHubCommentKind> {
    const { owner, repo } = this.splitOwnerRepo(projectPath);
    return resolveGitHubCommentKind({ id, projectPath, mrIid }, (kind) =>
      this.forgeRead(op, async () => {
        if (kind === 'diff') {
          const res = await this.octokit.request('GET /repos/{owner}/{repo}/pulls/comments/{comment_id}', {
            owner,
            repo,
            comment_id: id
          });
          return res.data.pull_request_url;
        }
        const res = await this.octokit.request('GET /repos/{owner}/{repo}/issues/comments/{comment_id}', {
          owner,
          repo,
          comment_id: id
        });
        return res.data.issue_url;
      })
    );
  }

  /**
   * Move one review thread between resolved and unresolved.
   *
   * `discussionId` is the `gh-review-thread-<rootCommentId>` form
   * `fetchMRDiscussions` emits, not a GraphQL node id. Keeping it that way is
   * deliberate: the id is a value consumers may have persisted, and changing
   * what it means would be a breaking change on a package with unbumped
   * consumer-visible changes already shipped. The cost is this lookup.
   */
  private async setThreadResolved(
    op: string,
    projectPath: string,
    mrIid: number,
    discussionId: string,
    resolved: boolean
  ): Promise<void> {
    const rootCommentId = parseReviewThreadDiscussionId(discussionId);
    if (rootCommentId == null) {
      throw new Error(
        `${op} failed: "${discussionId}" is not a resolvable review thread. ` +
          'Only ids of the form gh-review-thread-<id> can be resolved; ' +
          'GitHub pull request level comments have no thread.'
      );
    }

    const { owner, repo } = this.splitOwnerRepo(projectPath);
    const threads = await this.fetchReviewThreadIndex(op, owner, repo, mrIid);
    const thread = threads.get(rootCommentId);
    if (!thread) {
      throw new Error(
        `${op} failed: no review thread rooted at comment ${rootCommentId} on ${projectPath}!${mrIid}`
      );
    }

    const field = resolved ? 'resolveReviewThread' : 'unresolveReviewThread';
    const mutation = `
      mutation GlanceSetThreadResolved($threadId: ID!) {
        ${field}(input: { threadId: $threadId }) {
          thread { id isResolved }
        }
      }
    `;

    const data = await this.graphqlOrThrow<
      Record<string, { thread?: { id: string; isResolved: boolean } } | undefined>
    >(op, mutation, { threadId: thread.nodeId });

    // GitHub accepting the mutation is not the same as GitHub applying it.
    // Reporting success on a thread that never changed is the MAT-15 shape.
    const isResolved = data[field]?.thread?.isResolved;
    if (isResolved !== resolved) {
      throw new Error(
        `${op} failed: thread ${thread.nodeId} did not become ${resolved ? 'resolved' : 'unresolved'} ` +
          `(GitHub reported isResolved=${String(isResolved)})`
      );
    }
  }

  // ── Pipeline mutations ──────────────────────────────────────────────────

  /**
   * Reruns the failed jobs of one GitHub Actions workflow run, as GitLab's
   * pipeline retry reruns failed jobs only. `pipelineId` is the run id
   * (`Pipeline.id` is `github:run:<id>`; `Pipeline.runIds` lists every run on
   * the head commit). A commit status from external CI has no run to rerun.
   */
  async retryPipeline(projectPath: string, pipelineId: number): Promise<void> {
    try {
      await this.octokit.request(
        `POST /repos/${projectPath}/actions/runs/${pipelineId}/rerun-failed-jobs`
      );
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        const failure = ghError('retryPipeline', err, 'statusText');
        if (err.status === 404) {
          failure.message +=
            ' (only a GitHub Actions run can be retried; a commit status from external CI has no retry)';
        }
        throw failure;
      }
      throw err;
    }
  }

  async retryJob(projectPath: string, jobId: number): Promise<void> {
    // GitHub Actions: re-run a single job within a workflow run.
    // jobId maps to the job ID. Requires the workflow run ID which we don't have here.
    // Use POST /repos/{owner}/{repo}/actions/jobs/{job_id}/rerun
    try {
      await this.octokit.request(
        `POST /repos/${projectPath}/actions/jobs/${jobId}/rerun`
      );
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        // This message is quoted verbatim, 403 case included, as evidence in
        // two committed specs documents; ghError's statusText style reproduces
        // its exact shape.
        throw ghError('retryJob', err, 'statusText');
      }
      throw err;
    }
  }

  async fetchProjectLabels(
    projectPath: string,
    options: { search?: string; maxRows?: number } = {}
  ): Promise<{ labels: ProjectLabel[]; truncated: boolean }> {
    const maxRows = options.maxRows ?? 1000;
    const needle = options.search?.toLowerCase();
    const { owner, repo } = this.splitOwnerRepo(projectPath);
    const labels: ProjectLabel[] = [];
    let truncated = false;
    await this.forgeRead('fetchProjectLabels', async () => {
      let page = 0;
      for await (const res of this.octokit.paginate.iterator(
        'GET /repos/{owner}/{repo}/labels',
        { owner, repo, per_page: 100 }
      )) {
        for (const l of res.data) {
          if (needle && !l.name.toLowerCase().includes(needle)) continue;
          if (labels.length === maxRows) {
            truncated = true;
            return;
          }
          labels.push({
            name: l.name,
            description: l.description ?? null,
            color: l.color ? `#${l.color}` : null
          });
        }
        if (++page === FORGE_READ_MAX_PAGES) {
          truncated = true;
          return;
        }
      }
    });
    return { labels, truncated };
  }

  async addPullRequestLabels(projectPath: string, mrIid: number, labels: string[]): Promise<void> {
    if (labels.length === 0) return;
    const { owner, repo } = this.splitOwnerRepo(projectPath);
    await this.forgeRead('addPullRequestLabels', () =>
      this.octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/labels', {
        owner,
        repo,
        issue_number: mrIid,
        labels,
        request: { retries: 0 }
      })
    );
  }

  async removePullRequestLabels(projectPath: string, mrIid: number, labels: string[]): Promise<void> {
    const { owner, repo } = this.splitOwnerRepo(projectPath);
    for (const name of labels) {
      try {
        await this.forgeRead('removePullRequestLabels', () =>
          this.octokit.request('DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}', {
            owner,
            repo,
            issue_number: mrIid,
            name,
            request: { retries: 0 }
          })
        );
      } catch (err) {
        // A missing PR or repository is also a 404, so only this message means the goal state already holds.
        if (err instanceof ForgeHttpError && err.status === 404 && err.bodyText === 'Label does not exist') continue;
        throw err;
      }
    }
  }

  async fetchPipelineList(
    projectPath: string,
    options: { ref?: string; sha?: string; iid?: number; limit: number }
  ): Promise<PipelineListEntry[]> {
    const { owner, repo } = this.splitOwnerRepo(projectPath);
    return this.forgeRead('fetchPipelineList', async () => {
      let headSha = options.sha;
      if (options.iid !== undefined) {
        const pr = await this.octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
          owner,
          repo,
          pull_number: options.iid
        });
        headSha = pr.data.head.sha;
      }
      const res = await this.octokit.request('GET /repos/{owner}/{repo}/actions/runs', {
        owner,
        repo,
        per_page: options.limit,
        ...(options.iid === undefined && options.ref ? { branch: options.ref } : {}),
        ...(headSha ? { head_sha: headSha } : {})
      });
      return res.data.workflow_runs.map(r => ({
        id: r.id,
        status: checkStatusFromParts(
          r.status?.toUpperCase() ?? '',
          r.conclusion ? r.conclusion.toUpperCase() : null
        ),
        ref: r.head_branch ?? null,
        sha: r.head_sha ?? null,
        source: r.event ?? null,
        webUrl: r.html_url ?? null,
        createdAt: r.created_at ?? null
      }));
    });
  }

  async fetchCommitParents(projectPath: string, sha: string): Promise<string[]> {
    const { owner, repo } = this.splitOwnerRepo(projectPath);
    return this.forgeRead('fetchCommitParents', async () => {
      const res = await this.octokit.request('GET /repos/{owner}/{repo}/commits/{ref}', {
        owner,
        repo,
        ref: sha
      });
      return res.data.parents.map(p => p.sha);
    });
  }

  async fetchPullRequestDiffs(
    projectPath: string,
    mrIid: number,
    options: { signal?: AbortSignal } = {}
  ): Promise<{ diffs: PullRequestFileDiff[]; truncated: boolean }> {
    const { owner, repo } = this.splitOwnerRepo(projectPath);
    return this.forgeRead('fetchPullRequestDiffs', async () => {
      const res = await this.octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
        owner,
        repo,
        pull_number: mrIid,
        per_page: 100,
        request: { signal: options.signal }
      });
      const diffs = res.data.map((f): PullRequestFileDiff => ({
        newPath: f.filename,
        ...(f.previous_filename ? { oldPath: f.previous_filename } : {}),
        diff: f.patch ?? '',
        ...(f.patch == null ? { tooLarge: true } : {})
      }));
      return { diffs, truncated: res.data.length >= 100 };
    });
  }

  async fetchPipelineFailedJobs(projectPath: string, pipelineId: number): Promise<PipelineJob[]> {
    const { owner, repo } = this.splitOwnerRepo(projectPath);
    const failed = new Set(['failure', 'timed_out', 'cancelled']);
    const out: PipelineJob[] = [];
    await this.forgeRead('fetchPipelineFailedJobs', async () => {
      // An explicit page walk keeps this read independent of paginate.iterator
      // parsing the next page out of `response.url`.
      for (let page = 1; page <= FORGE_READ_MAX_PAGES; page++) {
        const res = await this.octokit.request('GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs', {
          owner,
          repo,
          run_id: pipelineId,
          filter: 'latest',
          per_page: 100,
          page
        });
        for (const j of res.data.jobs) {
          if (!j.conclusion || !failed.has(j.conclusion)) continue;
          out.push({
            // Same id the read model gives a check-run job: an Actions job id is its check-run id.
            id: `github:check:${j.id}`,
            name: j.name,
            stage: 'checks',
            status: checkStatusFromParts('COMPLETED', j.conclusion.toUpperCase()),
            allowFailure: false,
            duration: jobDuration(j.started_at, j.completed_at),
            webUrl: j.html_url ?? null,
            runId: String(j.run_id)
          });
        }
        if (res.data.jobs.length < 100) return;
      }
      // A partial list would read as every failed job.
      throw new Error(
        `fetchPipelineFailedJobs failed: workflow run ${pipelineId} has more than ${FORGE_READ_MAX_PAGES * 100} jobs, past the ${FORGE_READ_MAX_PAGES}-page read cap`
      );
    });
    return out;
  }

  async fetchPullRequestSummaries(
    projectPath: string,
    options: FetchSummariesOptions
  ): Promise<{ rows: PullRequestSummary[]; truncated: boolean }> {
    const { owner, repo } = this.splitOwnerRepo(projectPath);
    const searching = Boolean(options.author || options.search);
    const q = searching ? summarySearchString(owner, repo, options) : '';
    const rows: PullRequestSummary[] = [];
    let after: string | null = null;
    let more = false;
    for (let page = 1; page <= FORGE_READ_MAX_PAGES; page++) {
      const { data, errors }: { data: GHSummaryResponse; errors: GraphQLReadError[] } =
        await this.graphqlRead<GHSummaryResponse>(
        'fetchPullRequestSummaries',
        searching ? SUMMARY_SEARCH_QUERY : SUMMARY_LIST_QUERY,
        searching
          ? { q, after }
          : {
              owner,
              name: repo,
              states: SUMMARY_STATES[options.state],
              head: options.sourceBranch ?? null,
              base: options.targetBranch ?? null,
              after
            }
      );
      // A partial page would pass as a complete list.
      if (errors.length > 0) {
        throw new Error(
          `fetchPullRequestSummaries failed: GitHub GraphQL returned ${errors.map(e => e.message).join('; ')}`
        );
      }
      const connection: GHSummaryConnection | null | undefined = searching ? data.search : data.repository?.pullRequests;
      if (!connection) throw new Error('fetchPullRequestSummaries failed: GitHub GraphQL returned no data');
      for (const n of connection.nodes) {
        if (n == null || typeof n.number !== 'number') continue;
        rows.push({
          iid: n.number,
          title: n.title,
          state: n.merged || n.state === 'MERGED' ? 'merged' : n.state === 'CLOSED' ? 'closed' : 'opened',
          draft: n.isDraft === true,
          sourceBranch: n.headRefName,
          targetBranch: n.baseRefName,
          author: n.author?.login ?? null,
          webUrl: n.url ?? null,
          detailedMergeStatus: null,
          mergedAt: n.mergedAt ?? null
        });
      }
      // The search connection ends at 1000 nodes without a next page, so its count is the evidence.
      more = connection.pageInfo.hasNextPage || (searching && (connection.issueCount ?? 0) > rows.length);
      if (rows.length > options.limit || !connection.pageInfo.hasNextPage) break;
      after = connection.pageInfo.endCursor;
    }
    // `more` still set here means the page cap or the search ceiling ended the walk.
    return { rows: rows.slice(0, options.limit), truncated: rows.length > options.limit || more };
  }

  /** Runs a REST read, turning a rate limit into `RateLimitedError` and a non-2xx into `ForgeHttpError`. */
  private async forgeRead<T>(op: string, read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (err) {
      const limited = toRateLimitedError(err, op);
      if (limited) throw limited;
      if (err instanceof RequestError && err.response) {
        const data = err.response.data as { message?: unknown } | string | undefined;
        const detail =
          data && typeof data === 'object' && typeof data.message === 'string'
            ? data.message
            : bodyText(err);
        throw githubHttpError(err, detail);
      }
      throw err;
    }
  }

  async fetchJobTrace(projectPath: string, jobId: number): Promise<string> {
    // GitHub Actions: download job logs
    // GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs
    // The endpoint answers a redirect to a signed blob-storage URL; Octokit's
    // fetch wrapper follows it and then parses the final body by the content
    // type the blob store answers with, not by this route. A text/* (or
    // missing) content type is the branch the hand-rolled `res.text()` this
    // replaces was equivalent to, but that prior behavior was content-type
    // agnostic and never exercised Octokit's own parsing, so which of these
    // three branches actually fires is unverified until the next live run.
    // Handle all three explicitly so this method's Promise<string> contract
    // holds regardless: text/* comes back as a string already; anything else
    // recognized as text-like falls through to an ArrayBuffer; anything
    // Octokit parses as JSON (e.g. an `application/json` content type,
    // plausible behind a GHES proxy) arrives as an object.
    try {
      const res = await this.octokit.request(
        `GET /repos/${projectPath}/actions/jobs/${jobId}/logs`
      );
      return typeof res.data === 'string'
        ? res.data
        : res.data instanceof ArrayBuffer
          ? Buffer.from(res.data).toString('utf-8')
          : JSON.stringify(res.data);
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        throw ghError('fetchJobTrace', err, 'statusText');
      }
      throw err;
    }
  }

  async fetchDownstreamPipeline(_projectPath: string, _jobId: number, _pipelineId?: number): Promise<Pipeline | null> {
    // GitHub Actions doesn't have a child/downstream pipeline concept, so
    // null is the correct answer for every input, pipelineId included.
    return null;
  }

  async fetchJobDetail(projectPath: string, jobId: number, _pipelineId?: number): Promise<JobDetail> {
    // GitHub Actions has no bridge/trigger concept — always return trace
    const content = await this.fetchJobTrace(projectPath, jobId);
    return { type: 'trace', content };
  }

  // ── Review mutations ────────────────────────────────────────────────────

  async requestReReview(
    projectPath: string,
    mrIid: number,
    reviewerUsernames?: string[]
  ): Promise<void> {
    // With no usernames given, everyone on the PR's reviewer list: pending
    // requests and past reviewers alike, since GitHub drops a request once
    // its review lands.
    if (!reviewerUsernames?.length) {
      let warning: FetchPullRequestsWarning | undefined;
      const filled = await this.fillPullRequests(projectPath, [mrIid], {
        listWeight: true,
        roles: new Map(),
        rules: false,
        onWarning: w => {
          warning = w;
        }
      });
      const pr = filled.get(mrIid) ?? null;
      if (!pr) {
        const reason = warning
          ? `${warning.status !== undefined ? `${warning.status} ` : ''}${warning.message}`
          : `GitHub has no PR ${warningTarget(projectPath, mrIid)} visible to this token`;
        throw new Error(`requestReReview: failed to fetch PR: ${reason}`);
      }
      // GitHub refuses a review request for a bot or a deleted account, and
      // one refused name fails the whole request.
      reviewerUsernames = pr.reviewers
        .filter(r => !r.username.endsWith('[bot]') && r.id !== 'github:user:ghost')
        .map(r => r.username);
      if (!reviewerUsernames.length) {
        // Matches GitLabProvider.requestReReview: resolving here would be
        // the exact silent-success shape this method must not have. The
        // caller asked to re-ping reviewers and there is no one to ping.
        throw new Error(
          'requestReReview: nothing to re-request -- no reviewerUsernames given and the PR has no existing reviewers'
        );
      }
    }

    try {
      await this.octokit.request(
        `POST /repos/${projectPath}/pulls/${mrIid}/requested_reviewers`,
        { data: { reviewers: reviewerUsernames } }
      );
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        throw ghError('requestReReview', err, 'statusText');
      }
      throw err;
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Kept as a Response-returning seam while call sites migrate off it.
   *
   * Octokit throws on non-2xx; this converts that back into a Response so the
   * `if (!res.ok)` call sites still work and so `restRequest`, which is public
   * and documented to return a Response, does not start throwing on a 404 that
   * callers branch on.
   */
  private async api(
    method: string,
    path: string,
    body?: unknown,
    io?: { redirect?: 'manual' }
  ): Promise<Response> {
    // Octokit's endpoint parser rewrites `:word` into a route placeholder
    // before the string is ever handed to fetch, and a placeholder with no
    // matching parameter expands to the empty string. Every call site is
    // supposed to hand over an already-built path with the colon encoded,
    // but this is the last line of defense: any literal colon that still
    // reaches this point is escaped so it cannot be misread as a
    // placeholder marker. The negative lookahead excludes a colon followed
    // by a slash, which is a scheme separator (e.g. `https://...`) on an
    // absolute URL, not a placeholder colon (Octokit's own placeholder
    // regex, `/:([a-z]\w+)/g`, never matches a colon before `/` either);
    // escaping it would turn `https://` into `https%3A//`, which still
    // passes Octokit's `/^http/` check so no baseUrl gets prepended, and
    // fetch then throws on the malformed URL. `restRequest` is documented
    // as accepting an absolute URL, so this path is live. Only `path` is
    // escaped, never the "${method} " prefix, since Octokit splits on that
    // leading space to read the verb.
    const safePath = path.replace(/:(?!\/)/g, '%3A');
    // The pre-Octokit `fetch` threw `TypeError: Request with GET/HEAD method
    // cannot have body` here, a loud failure. Octokit has no such guard: for
    // GET/HEAD it routes `data` into the query string instead
    // (`?data=%5Bobject%20Object%5D` for an object body), turning a caller
    // mistake into a silently wrong request rather than a thrown error. This
    // restores the old loudness instead of letting that corruption through.
    if (body !== undefined) {
      const upperMethod = method.toUpperCase();
      if (upperMethod === 'GET' || upperMethod === 'HEAD') {
        throw new Error(
          `restRequest: ${method} cannot have a body (GitHub/Octokit routes it into the query string instead)`
        );
      }
    }
    try {
      const res = await this.octokit.request(`${method} ${safePath}`, {
        ...(body !== undefined ? { data: body } : {}),
        ...(io?.redirect ? { request: { redirect: io.redirect } } : {})
      });
      return toResponse(res.status, res.headers, res.data);
    } catch (caught) {
      // `api()` hands callers an HTTP outcome to branch on (`res.ok`,
      // `res.status`), never a throw, and a rate-limited 403 or 429 is one.
      // The client converts it to `RateLimitedError` for the typed read
      // paths, so unwrap it back to the response it came from here.
      const err =
        caught instanceof RateLimitedError && caught.cause instanceof RequestError
          ? caught.cause
          : caught;
      if (err instanceof RequestError) {
        if (!err.response) {
          // No `response` means Octokit's fetch wrapper never got an HTTP
          // result (DNS failure, connection refused, an aborted request):
          // a transport failure, not an HTTP outcome. Fabricating a
          // synthetic 500 Response here would let a caller's `if (!res.ok)`
          // read a dropped connection as an ordinary HTTP failure, hiding
          // the transport failure instead of surfacing it.
          throw err;
        }
        return toResponse(err.status, err.response.headers ?? {}, err.response.data);
      }
      throw err;
    }
  }

  /**
   * Fire a write whose caller does not read the response body, translating a
   * thrown HTTP failure into `ghError`'s shape. A transport failure (no
   * `.response`) is rethrown untouched, same as every other migrated call
   * site: it never reached an HTTP outcome, so laundering it through
   * `ghError` would lose `.status` and `.request` for no reason.
   *
   * `op` is not a bare method name here the way it is at the other call
   * sites: every caller of this helper names the sub-operation and the PR
   * number it applies to (e.g. `createPullRequest reviewers for #42`), since
   * a failure here throws for a PR that already exists (created) or was
   * already partially updated (patched). A generic `createPullRequest`
   * label would read as "nothing happened," which is false.
   */
  private async fireAndThrow(
    op: string,
    route: string,
    data: unknown
  ): Promise<void> {
    try {
      await this.octokit.request(route, { data });
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        throw ghError(op, err);
      }
      throw err;
    }
  }

  /**
   * Bring GitHub's requested-reviewer or assignee set to exactly `wanted`,
   * the "replaces the current set" contract `UpdatePullRequestInput`
   * documents and GitLab's id arrays honour natively. GitHub's own
   * endpoints (`POST .../requested_reviewers`, `POST .../assignees`) are
   * additive only; a caller shrinking the list previously got back a PR
   * that still had the dropped name on it, with nothing in the response
   * distinguishing that from success (MAT-24). Removals need the matching
   * `DELETE` on the same route, with the removed logins in the body.
   *
   * `current` is only ever a PR's own `requested_reviewers`/`assignees`,
   * which GitHub returns as user objects with logins only -- team reviewers
   * live in the separate `requested_teams` field, which this method never
   * reads or writes. `reviewers`/`assignees` are documented on
   * `CreatePullRequestInput`/`UpdatePullRequestInput` as usernames with no
   * team concept, so any team already requested is left exactly as it was.
   */
  private async replaceUserSet(
    op: string,
    route: string,
    bodyKey: 'reviewers' | 'assignees',
    current: GHUser[],
    wanted: string[]
  ): Promise<void> {
    const currentLogins = new Set(current.map(u => u.login));
    const wantedLogins = new Set(wanted);
    const toAdd = wanted.filter(login => !currentLogins.has(login));
    const toRemove = [...currentLogins].filter(login => !wantedLogins.has(login));

    if (toAdd.length) {
      await this.fireAndThrow(`${op} (add)`, `POST ${route}`, { [bodyKey]: toAdd });
    }
    if (toRemove.length) {
      await this.fireAndThrow(`${op} (remove)`, `DELETE ${route}`, { [bodyKey]: toRemove });
    }
  }

  /**
   * Issue a GraphQL (v4) request that must succeed.
   *
   * MAT-133. A mutation cannot report failure as `null`: a `null` from
   * `enablePullRequestAutoMerge` is indistinguishable from "auto-merge is
   * off", which is the MAT-15 bug class where a silent no-op meant a draft
   * MR was never actually published.
   */
  private async graphqlOrThrow<T>(
    op: string,
    query: string,
    variables: Record<string, unknown>
  ): Promise<T> {
    let data: T | null | undefined;
    try {
      data = await this.octokit.graphql<T>(query, variables);
    } catch (err) {
      const messages = graphqlErrorMessages(err);
      if (messages) {
        throw new Error(`${op} failed: GitHub GraphQL returned ${messages.join('; ')}`);
      }
      if (err instanceof GraphqlResponseError) {
        // Empty `errors` array. `@octokit/graphql` throws on the key's mere
        // presence and `[]` is truthy, but an empty array carries no error,
        // so this falls through to the response's data.
        data = err.data as T | undefined;
      } else if (err instanceof RequestError && err.response) {
        throw ghError(op, err, 'statusText');
      } else {
        throw err;
      }
    }
    if (data == null) {
      throw new Error(`${op} failed: GitHub GraphQL returned no data`);
    }
    return data;
  }

  /**
   * The read side's GraphQL call, for the fill and the branch lookup.
   *
   * It never turns a failure into null, and unlike `graphqlOrThrow()` it
   * keeps partial data: a response carrying both
   * `data` and `errors` returns both, so the fill can keep the PRs that
   * resolved. A response with errors and no data, an HTTP failure or a
   * transport failure throws; a rate limit throws `RateLimitedError`.
   *
   * It must only ever send queries: `GRAPHQL_READ_MARKER` keeps the 5xx
   * retries a REST GET gets, which would duplicate a mutation.
   */
  private async graphqlRead<T>(
    op: string,
    query: string,
    variables: Record<string, unknown> = {}
  ): Promise<{ data: T; errors: GraphQLReadError[] }> {
    let data: T | null | undefined;
    let errors: GraphQLReadError[] = [];
    try {
      data = await this.octokit.graphql<T>(query, {
        ...variables,
        request: { [GRAPHQL_READ_MARKER]: true }
      });
    } catch (err) {
      const limited = toRateLimitedError(err, `POST /graphql (${op})`);
      if (limited) throw limited;
      if (err instanceof GraphqlResponseError) {
        errors = (err.errors ?? []).map(e => ({
          message: e.message,
          type: (e as { type?: string }).type ?? null,
          path: (e.path as Array<string | number> | undefined) ?? null
        }));
        data = err.data as T | undefined;
        if (data == null && errors.length > 0) {
          throw new Error(
            `${op} failed: GitHub GraphQL returned ${errors.map(e => e.message).join('; ')}`
          );
        }
      } else if (err instanceof RequestError && err.response) {
        // The status rides along so a warning can report it.
        throw Object.assign(ghError(op, err, 'statusText'), { status: err.status });
      } else {
        throw err;
      }
    }
    if (data == null) {
      throw new Error(`${op} failed: GitHub GraphQL returned no data`);
    }
    return { data, errors };
  }

  /**
   * Every PR in `numbers`, read through aliased GraphQL queries of
   * `FILL_BATCH_SIZE` PRs each, with a follow-up contexts page for each PR
   * whose checks run past the first 100.
   *
   * The map holds every requested number: `null` for a PR that does not
   * exist or is not visible (no warning, matching a REST 404), and `null`
   * plus a `fill` warning for a PR whose read failed. A PR is never returned
   * with fields from a failed read. A rate limit throws, so a caller backs
   * off instead of treating a short result as complete.
   *
   * `roles` carries roles a discovery step already knows; a PR it does not
   * name gets the token user's roles from the fill's `viewer`.
   *
   * Batches run one at a time: GitHub asks integrations to make requests
   * serially to stay clear of its secondary limit, and a rate limit then
   * stops the read before it spends more of the budget.
   */
  private async fillPullRequests(
    projectPath: string,
    numbers: number[],
    opts: {
      listWeight: boolean;
      roles: Map<number, string[]>;
      /** False skips the rulesets lookup, for a caller that reads no approval count. */
      rules?: boolean;
      onWarning?: FetchPullRequestsOptions['onWarning'];
    }
  ): Promise<Map<number, PullRequest | null>> {
    const out = new Map<number, PullRequest | null>();
    const unique = [...new Set(numbers)];
    if (unique.length === 0) return out;
    const { owner, repo } = this.splitOwnerRepo(projectPath);

    for (let i = 0; i < unique.length; i += FILL_BATCH_SIZE) {
      const batch = unique.slice(i, i + FILL_BATCH_SIZE);
      let response: { data: GHFillResponse; errors: GraphQLReadError[] };
      try {
        response = await this.graphqlRead<GHFillResponse>(
          'fillPullRequests',
          buildFillQuery(owner, repo, batch, { listWeight: opts.listWeight })
        );
      } catch (err) {
        if (err instanceof RateLimitedError) throw err;
        for (const n of batch) {
          this.warnFillFailed(opts.onWarning, projectPath, n, err);
          out.set(n, null);
        }
        continue;
      }

      const { data, errors } = response;
      const viewer = data.viewer ?? null;
      const nodes = new Map<number, GHFillNode>();
      for (const n of batch) {
        const node = data.repository?.[`p${n}`] ?? null;
        const failure = fillErrorFor(errors, n, node !== null);
        if (failure) {
          this.warnFillFailed(opts.onWarning, projectPath, n, new Error(failure.message));
          out.set(n, null);
        } else if (node) {
          nodes.set(n, node);
        } else {
          out.set(n, null);
        }
      }

      // The base branch is only known once the fill returns. Only an open PR
      // awaiting a verdict needs the count: GitHub's decision already folds in
      // rulesets, so a null one means none are required, and a merged or
      // closed PR shows no remaining approvals. A provider built per cycle
      // loses its cache, so every skipped lookup is a request saved each time.
      const rulesByBranch = new Map<string, number | null>();
      for (const node of nodes.values()) {
        if (opts.rules === false) break;
        if (node.state !== 'OPEN' || node.reviewDecision === null) continue;
        if (rulesByBranch.has(node.baseRefName)) continue;
        rulesByBranch.set(
          node.baseRefName,
          await this.requiredFromRules(projectPath, node.baseRefName)
        );
      }

      for (const [n, node] of nodes) {
        const { contexts, complete } = await this.readAllContexts(
          projectPath,
          owner,
          repo,
          node,
          opts.onWarning
        );
        const pr = toPullRequestFromNode(node, {
          roles: opts.roles.get(n) ?? [],
          contexts,
          contextsComplete: complete,
          rulesRequired: rulesByBranch.get(node.baseRefName) ?? null
        });
        if (!opts.roles.has(n)) pr.roles = rolesFromViewer(node, viewer, pr.reviewers);
        out.set(n, pr);
      }
    }
    return out;
  }

  /**
   * The largest `required_approving_review_count` among a branch's
   * `pull_request` rules, null when it has none or they cannot be read.
   *
   * Rulesets are not in the fill and classic protection is not in this
   * endpoint, so the two are combined by the caller. Answers are cached per
   * repo and branch for `RULES_CACHE_MS`: a 403 or 404 caches null, since
   * the token will not gain access within the window; a 5xx or a transport
   * failure yields null for this read only. A rate limit throws.
   */
  private async requiredFromRules(
    projectPath: string,
    branch: string
  ): Promise<number | null> {
    const key = `${projectPath}#${branch}`;
    const cached = this.rulesCache.get(key);
    if (cached && this.now() - cached.at < RULES_CACHE_MS) return cached.required;

    const { owner, repo } = this.splitOwnerRepo(projectPath);
    let required: number | null = null;
    try {
      const res = await this.octokit.request(
        'GET /repos/{owner}/{repo}/rules/branches/{branch}',
        // Optional data: a failing endpoint costs one request, not the retry ladder.
        { owner, repo, branch, per_page: 100, request: { retries: 0 } }
      );
      for (const rule of res.data as Array<{
        type: string;
        parameters?: { required_approving_review_count?: number };
      }>) {
        const count = rule.parameters?.required_approving_review_count;
        if (rule.type !== 'pull_request' || typeof count !== 'number') continue;
        required = required === null ? count : Math.max(required, count);
      }
    } catch (err) {
      if (err instanceof RateLimitedError) throw err;
      if (err instanceof RequestError && (err.status === 403 || err.status === 404)) {
        this.rulesCache.set(key, { required: null, at: this.now() });
        return null;
      }
      this.log.warn('GitHub rulesets read failed', {
        projectPath,
        branch,
        error: err instanceof Error ? err.message : String(err)
      });
      return null;
    }
    this.rulesCache.set(key, { required, at: this.now() });
    return required;
  }

  /**
   * The fill's first page of contexts plus every page after it. `complete`
   * is false when a page could not be read, so the caller reports checks as
   * still running rather than green.
   */
  private async readAllContexts(
    projectPath: string,
    owner: string,
    repo: string,
    node: GHFillNode,
    onWarning: FetchPullRequestsOptions['onWarning']
  ): Promise<{ contexts: GHFillContext[]; complete: boolean }> {
    const first = node.commits.nodes[0]?.commit.statusCheckRollup?.contexts;
    if (!first) return { contexts: [], complete: true };
    const contexts = [...first.nodes];
    const target = warningTarget(projectPath, node.number);
    let pageInfo = first.pageInfo;

    for (let page = 0; pageInfo.hasNextPage && pageInfo.endCursor; page++) {
      if (page === CONTEXTS_MAX_PAGES) {
        this.warn(onWarning, {
          kind: 'page-cap',
          source: 'contexts',
          target,
          message: `${target} has more than ${contexts.length} checks; the rest were not read, so its checks read as still running.`
        });
        return { contexts, complete: false };
      }
      let next: GHFillContextsPage['contexts'] | undefined;
      let reason: string;
      try {
        const { data, errors } = await this.graphqlRead<GHFillContextsResponse>(
          'fillPullRequests.contexts',
          buildContextsPageQuery(owner, repo, node.number, pageInfo.endCursor)
        );
        next = data.repository?.[`p${node.number}`]?.commits.nodes[0]?.commit.statusCheckRollup
          ?.contexts;
        reason = errors.map(e => e.message).join('; ') || 'GitHub returned no checks page';
        if (errors.some(e => !isWorkflowRunError(e))) next = undefined;
      } catch (err) {
        if (err instanceof RateLimitedError) throw err;
        next = undefined;
        reason = err instanceof Error ? err.message : String(err);
      }
      if (!next) {
        this.warn(onWarning, {
          kind: 'request-failed',
          source: 'contexts',
          target,
          message: `GitHub could not read more checks for ${target} (${reason}); its checks read as still running.`
        });
        return { contexts, complete: false };
      }
      contexts.push(...next.nodes);
      pageInfo = next.pageInfo;
    }
    return { contexts, complete: true };
  }

  private warnFillFailed(
    onWarning: FetchPullRequestsOptions['onWarning'],
    projectPath: string,
    prNumber: number,
    err: unknown
  ): void {
    const target = warningTarget(projectPath, prNumber);
    this.warn(onWarning, {
      kind: 'request-failed',
      source: 'fill',
      ...(typeof (err as { status?: unknown }).status === 'number'
        ? { status: (err as { status: number }).status }
        : {}),
      target,
      message: `GitHub could not read ${target} (${err instanceof Error ? err.message : String(err)}); it is missing from this result.`
    });
  }

  /**
   * Move a PR between draft and ready for review.
   *
   * These two mutations are GitHub's only API for the transition -- REST
   * exposes `draft` on create and nowhere else. A failure throws: reporting
   * success on a draft flag that never landed is the bug this replaces.
   */
  private async setDraft(
    pullRequestId: string,
    draft: boolean
  ): Promise<void> {
    const field = draft
      ? 'convertPullRequestToDraft'
      : 'markPullRequestReadyForReview';
    const mutation = `
      mutation GlanceSetDraft($id: ID!) {
        ${field}(input: { pullRequestId: $id }) {
          pullRequest { isDraft }
        }
      }
    `;

    const data = await this.graphqlOrThrow<
      Record<string, { pullRequest?: { isDraft: boolean } } | undefined>
    >('updatePullRequest', mutation, { id: pullRequestId });

    // Kept after the throwing call: `graphqlOrThrow` proves the request
    // succeeded and returned data, not that GitHub landed the flag we asked
    // for. Reporting success on a draft flag that never took is the bug this
    // check exists for.
    if (data[field]?.pullRequest?.isDraft !== draft) {
      throw new Error(
        `updatePullRequest failed: could not set draft=${draft} (GitHub GraphQL ${field})`
      );
    }
  }

  /**
   * Review threads for one PR, keyed by the databaseId of the comment that
   * roots each thread.
   *
   * That key is what makes the join work. REST review comments carry no
   * thread id, so `fetchMRDiscussions` groups them by `in_reply_to_id ?? id`
   * and the resulting root is the same comment GraphQL reports as the
   * thread's first. Fetching `comments(first: 1)` is therefore enough to
   * match a whole thread.
   *
   * Distinct from the fill's thread count, which only needs a count. This
   * one needs per-thread identity, so it is per-PR and paginates rather than
   * reporting unknown on the first page alone.
   *
   * The walk is still bounded, at `THREAD_MAX_PAGES`, so a pathological PR
   * cannot spin it forever. Hitting that bound with pages still remaining
   * logs a warning and returns the partial index rather than throwing:
   * threads past the bound are simply absent from the map, and the caller
   * (`fetchMRDiscussions`) already treats an absent thread as "unknown"
   * rather than "unresolved", so a partial index degrades the same way a
   * missing one does.
   *
   * Throws on any failure. Read callers that can degrade wrap the call;
   * mutation callers must not.
   */
  private async fetchReviewThreadIndex(
    op: string,
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<Map<number, GHReviewThread>> {
    const query = `
      query GlancePullRequestThreads($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviewThreads(first: ${THREAD_PAGE_SIZE}, after: $cursor) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                isResolved
                comments(first: 1) { nodes { databaseId } }
              }
            }
          }
        }
      }
    `;

    const index = new Map<number, GHReviewThread>();
    let cursor: string | null = null;
    // Stays true only if every page up to the bound reported more remaining;
    // a normal `break` below (the common case) flips it to false.
    let boundHit = true;

    for (let page = 0; page < THREAD_MAX_PAGES; page++) {
      // Annotated rather than left to inference: `cursor` is reassigned below
      // from this same call's result, and without the annotation TypeScript's
      // control-flow analysis treats `data`'s type as depending on `cursor`
      // depending on `data` across loop iterations and reports it circular.
      const data: GHPullRequestThreadsResponse = await this.graphqlOrThrow<GHPullRequestThreadsResponse>(
        op,
        query,
        { owner, repo, number: prNumber, cursor }
      );

      const threads = data.repository?.pullRequest?.reviewThreads;
      if (!threads) {
        throw new Error(
          `${op} failed: GitHub reported no pull request ${owner}/${repo}!${prNumber}`
        );
      }

      for (const node of threads.nodes) {
        const rootCommentId = node?.comments?.nodes[0]?.databaseId;
        // A thread whose first comment carries no databaseId cannot be joined
        // to anything REST returned, so indexing it would be indexing nothing.
        if (!node || rootCommentId == null) continue;
        index.set(rootCommentId, {
          nodeId: node.id,
          isResolved: node.isResolved,
          rootCommentId
        });
      }

      if (!threads.pageInfo?.hasNextPage) {
        boundHit = false;
        break;
      }
      cursor = threads.pageInfo.endCursor;
    }

    if (boundHit) {
      // Not a failure: the index is partial, not wrong. The threads that
      // didn't fit are simply missing from it, and the caller already reads
      // a missing thread as unknown rather than resolved or unresolved.
      this.log.warn(`${op}: hit the review-thread page bound with more threads remaining`, {
        projectPath: `${owner}/${repo}`,
        prNumber,
        pages: THREAD_MAX_PAGES
      });
    }

    return index;
  }

  /**
   * Report a shortfall to the caller and the logger.
   *
   * The logger alone is not enough: it defaults to noop, so a truncated or
   * throttled fetch used to return a short list with nothing to distinguish it
   * from a complete one.
   */
  private warn(
    onWarning: FetchPullRequestsOptions['onWarning'],
    warning: FetchPullRequestsWarning
  ): void {
    this.log.warn(warning.message, { ...warning });
    if (!onWarning) return;
    try {
      onWarning(warning);
    } catch {
      // A broken observer must never fail a fetch.
    }
  }

  /**
   * The PRs a search matched, as `owner/repo` + number. No fill: the caller
   * merges hits across searches first, so a PR several searches matched is
   * filled once.
   *
   * Filtering on the issue-shaped search result here means a state filter costs
   * nothing extra: PRs we are about to discard never reach the fill.
   *
   * Walks up to `SEARCH_MAX_PAGES` pages. Stopping there with results
   * outstanding, or a page GitHub rejected, is reported through `onWarning`:
   * this is a bounded scan, not an exhaustive one, and the caller cannot see
   * the difference from the returned list. A rate limit throws instead.
   */
  private async searchPRs(
    qualifiers: string,
    keep: (item: GHSearchItem) => boolean,
    onWarning: FetchPullRequestsOptions['onWarning']
  ): Promise<SearchHit[]> {
    const q = encodeURIComponent(qualifiers);
    const matched: SearchHit[] = [];

    for (let page = 1; page <= SEARCH_MAX_PAGES; page++) {
      let data: { items: GHSearchItem[] };
      try {
        const res = await this.octokit.request(
          `GET /search/issues?q=${q}&per_page=100&sort=updated&page=${page}`
        );
        data = res.data as { items: GHSearchItem[] };
      } catch (err) {
        // A rate limit throws: its hits would be missing from a list that
        // otherwise reads as complete.
        if (err instanceof RateLimitedError) throw err;
        if (err instanceof RequestError && err.response) {
          this.warn(onWarning, {
            kind: 'request-failed',
            source: 'search',
            status: err.status,
            target: qualifiers,
            message: `GitHub search failed with HTTP ${err.status}; PRs matching "${qualifiers}" are missing from this result.`
          });
          break;
        }
        throw err;
      }

      for (const item of data.items) {
        if (!item.pull_request || !keep(item)) continue;
        matched.push({
          repoPath: item.repository_url.replace(`${this.apiBase}/repos/`, ''),
          number: item.number
        });
      }

      if (data.items.length < 100) break;
      if (page === SEARCH_MAX_PAGES) {
        this.warn(onWarning, {
          kind: 'page-cap',
          source: 'search',
          target: qualifiers,
          message: `GitHub search "${qualifiers}" hit the ${SEARCH_MAX_PAGES}-page cap (${SEARCH_MAX_PAGES * 100} results); later matches are missing from this result.`
        });
      }
    }

    return matched;
  }

  /**
   * Every PR in a repository, newest-updated first, as the listing reports
   * it. Discovery only: the caller reads each PR's data through the fill.
   */
  private async listRepoPRs(
    projectPath: string,
    wanted: Set<MRState>,
    updatedAfter: number | null,
    keep: (pr: GHPullRequest) => boolean,
    onWarning: FetchPullRequestsOptions['onWarning']
  ): Promise<GHPullRequest[]> {
    const state = listStateParam(wanted);
    const collected: GHPullRequest[] = [];

    for (let page = 1; page <= LIST_MAX_PAGES; page++) {
      let listed: GHPullRequest[];
      try {
        const res = await this.octokit.request(
          `GET /repos/${projectPath}/pulls?state=${state}&sort=updated&direction=desc&per_page=100&page=${page}`
        );
        listed = res.data as GHPullRequest[];
      } catch (err) {
        if (err instanceof RequestError && err.response) {
          throw ghError('fetchPullRequests', err);
        }
        // No `.response`: a transport failure, not an HTTP result. Rethrow
        // the original error untouched, same as the other five migrated
        // methods, instead of laundering it through `ghError` into a plain
        // `Error` that has lost `.status` and `.request`.
        throw err;
      }
      collected.push(...listed.filter(keep));

      if (listed.length < 100) break;
      // Sorted newest-updated first, so once a page ends before the cutoff
      // every later page is older too.
      const oldest = listed.at(-1);
      if (
        updatedAfter !== null &&
        oldest &&
        Date.parse(oldest.updated_at) < updatedAfter
      ) {
        break;
      }
      if (page === LIST_MAX_PAGES) {
        this.warn(onWarning, {
          kind: 'page-cap',
          source: 'list',
          target: projectPath,
          message: `Listing ${projectPath} hit the ${LIST_MAX_PAGES}-page cap (${LIST_MAX_PAGES * 100} PRs); older PRs are missing from this result.`
        });
      }
    }

    return collected;
  }

  /**
   * The PRs `hits` name, in hit order, through one fill per repository.
   * A PR the fill reports missing or failed is left out; the fill has
   * already warned for a failure. `roles` is keyed by `hitKey`, and a hit
   * it does not name takes the token user's roles from the fill.
   */
  private async fillHits(
    hits: SearchHit[],
    roles: Map<string, string[]>,
    listWeight: boolean,
    onWarning: FetchPullRequestsOptions['onWarning']
  ): Promise<PullRequest[]> {
    const byRepo = new Map<string, number[]>();
    for (const hit of hits) {
      const numbers = byRepo.get(hit.repoPath) ?? [];
      numbers.push(hit.number);
      byRepo.set(hit.repoPath, numbers);
    }
    const filled = new Map<string, PullRequest | null>();
    for (const [repoPath, numbers] of byRepo) {
      const repoRoles = new Map<number, string[]>();
      for (const n of numbers) {
        const known = roles.get(hitKey({ repoPath, number: n }));
        if (known) repoRoles.set(n, known);
      }
      const prs = await this.fillPullRequests(repoPath, numbers, {
        listWeight,
        roles: repoRoles,
        onWarning
      });
      for (const [n, pr] of prs) filled.set(hitKey({ repoPath, number: n }), pr);
    }
    return hits
      .map(hit => filled.get(hitKey(hit)) ?? null)
      .filter((pr): pr is PullRequest => pr !== null);
  }

  /**
   * Splits an "owner/repo" path into the two route params `paginate` needs.
   * Every other call site in this file hands Octokit a whole interpolated
   * path; `paginate` is the one place a route template plus separate params
   * is correct, since it re-derives the next page's URL from the route
   * itself rather than from a path string it was only handed once.
   */
  private splitOwnerRepo(repoPath: string): { owner: string; repo: string } {
    const slash = repoPath.indexOf('/');
    // A theme of this change is refusing to degrade silently on a failure
    // `paginate` can't recover from; fabricating an `owner`/`repo` pair out
    // of a path with no slash (e.g. owner = the whole string, repo = "")
    // would send `paginate` a route it silently mis-follows instead of one
    // that fails loudly.
    if (slash === -1) {
      throw new Error(`splitOwnerRepo: expected "owner/repo", got "${repoPath}"`);
    }
    return { owner: repoPath.slice(0, slash), repo: repoPath.slice(slash + 1) };
  }
}

// ---------------------------------------------------------------------------
// Note mapping
// ---------------------------------------------------------------------------

function toNote(
  c: GHComment,
  resolved: boolean | null = null,
  oldPaths: Map<string, string> = new Map()
): Note {
  // GitHub sends `line: null` on an outdated comment; `original_line` is
  // the same side's line in the commit the comment was made on.
  const line = c.line ?? c.original_line ?? null;
  const position: NotePosition | null = c.path
    ? {
        newPath: c.path,
        oldPath: oldPaths.get(c.path) ?? c.path,
        newLine: c.side === 'LEFT' ? null : line,
        oldLine: c.side === 'LEFT' ? line : null,
        positionType: 'text'
      }
    : null;

  return {
    id: c.id,
    body: c.body,
    author: toNoteAuthor(c.user),
    createdAt: c.created_at,
    system: false,
    type: c.path ? 'DiffNote' : 'DiscussionNote',
    resolvable: c.path ? true : null,
    // Resolution is a property of the thread, not of an individual comment,
    // so it is passed in. GitLab reports the same value on every note of a
    // resolved discussion and this matches that.
    resolved: c.path ? resolved : null,
    position
  };
}

function toNoteAuthor(u: GHNoteUser): NoteAuthor {
  if (!u) {
    return { id: 'github:user:ghost', username: 'ghost', name: 'ghost', avatarUrl: null, bot: false };
  }
  return {
    id: `github:user:${u.id}`,
    username: u.login,
    name: u.name ?? u.login,
    avatarUrl: u.avatar_url,
    bot: u.type === 'Bot'
  };
}

// Statuses the HTTP spec defines as never carrying a body. Octokit's fetch
// wrapper still returns `data: ""` for these, and `new Response("", {
// status: 204 })` is valid under Bun but throws a TypeError under Node,
// which is what this package publishes for (`engines.node >= 18`,
// `--target node`). A test suite that only runs on Bun cannot see this
// divergence, so the null-body statuses are forced to a null body here
// regardless of what Octokit handed back.
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * Rebuild a Response from an Octokit result so the pre-Octokit call sites,
 * and the public restRequest contract, keep seeing what they always saw.
 */
function toResponse(
  status: number,
  headers: Record<string, unknown>,
  data: unknown
): Response {
  const body =
    NULL_BODY_STATUSES.has(status) || data === undefined || data === null
      ? null
      : typeof data === 'string'
        ? data
        : JSON.stringify(data);
  // Octokit hands back the whole header map (lowercase keys, string values)
  // rather than one cherry-picked field, so passing it straight into
  // ResponseInit restores content-type, etag, location, x-ratelimit-*, and
  // everything else a pre-Octokit caller could read off the genuine fetch
  // Response, not just Link. Only string-valued entries are copied. The
  // Headers constructor would coerce anything else rather than throw, which
  // is the trap: an array or object would arrive as "x,y" or
  // "[object Object]" and read as a real header value. Dropping it keeps a
  // never-observed exotic value from looking like data.
  const responseHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') responseHeaders[key] = value;
  }
  const init: ResponseInit = {
    status,
    statusText: reasonPhrase(status),
    headers: responseHeaders
  };
  return new Response(body, init);
}

/**
 * Read GraphQL-level error messages off a thrown error, for
 * `graphqlOrThrow()`. Two different shapes carry this same "the response was a
 * 200 with a GraphQL-level error" outcome:
 *
 * - `GraphqlResponseError`, thrown by `@octokit/graphql` itself whenever the
 *   response has a non-empty `errors` array.
 * - A plain `Error` with a `.data.errors` array, thrown by
 *   `@octokit/plugin-throttling`'s own `RATE_LIMITED`-in-body detection (see
 *   `wrap-request.js`) -- a different class, but the same underlying
 *   GraphQL error payload the old bare-fetch code read directly off
 *   `payload.errors`.
 *
 * Returns null (not a match) for an empty `errors` array so a caller falls
 * through to treating the response as a success, matching the old code's
 * `payload.errors?.length` check rather than a truthiness check on the
 * array itself.
 */
function graphqlErrorMessages(err: unknown): string[] | null {
  if (err instanceof GraphqlResponseError) {
    return err.errors && err.errors.length > 0
      ? err.errors.map(e => e.message)
      : null;
  }
  if (err instanceof Error) {
    const data = (err as unknown as { data?: { errors?: unknown } }).data;
    if (Array.isArray(data?.errors)) {
      const errors = data.errors as Array<{ message: string }>;
      return errors.length > 0 ? errors.map(e => e.message) : null;
    }
  }
  return null;
}
