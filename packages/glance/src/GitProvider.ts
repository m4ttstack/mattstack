import type {
  BranchProtectionRule,
  CommentAnchor,
  CreatePullRequestInput,
  Discussion,
  InvalidationBatch,
  JobDetail,
  EnqueuePullRequestInput,
  FetchApprovalRulesOptions,
  MRApprovalRules,
  MergePullRequestInput,
  MergePullRequestResult,
  MergeQueueEntry,
  MergeQueueStatus,
  MergeRequestIndexRow,
  MergeRequestMetrics,
  MRDetail,
  InlineCommentResult,
  NoteRef,
  NoteWriteResult,
  Pipeline,
  PipelineJob,
  PullRequestFileDiff,
  PipelineListEntry,
  PipelineSummary,
  ProjectLabel,
  ProjectRef,
  ProviderCapabilities,
  PullRequest,
  PullRequestSummary,
  FetchSummariesOptions,
  ReviewSubmission,
  ReviewSubmitResult,
  UpdatePullRequestInput,
  UserEvent,
  UserRef,
  WatchEventsOptions,
} from './types.ts';
import type { RealtimeWatcherOptions, WatcherSubscribeCallbacks } from './RealtimeWatcher.ts';

/** MR/PR state filter values. */
export type MRState = 'opened' | 'merged' | 'closed';

/**
 * A fetch returned less than the caller asked for.
 *
 * `fetchPullRequests` resolves to a plain `PullRequest[]`, which has nowhere
 * to say "...and there were more": a bounded scan that stops at its page cap
 * and a complete result are the same value. This is that missing channel.
 * A caller doing best-effort discovery can ignore it; a caller that must not
 * present a partial board should treat any warning as "this list is
 * incomplete" and say so in its UI.
 */
export interface FetchPullRequestsWarning {
  /**
   * `page-cap`: a bounded scan stopped with matches still outstanding.
   * `request-failed`: a non-ok response. For `search`/`list`/`fill`,
   * whatever it would have returned is missing from the result entirely.
   * For `contexts`, the PR stays, with a `pending` pipeline and `checking`
   * readiness, since an unread check may be failing; a failed or canceled
   * pipeline already seen stays as it is.
   * `rate-limited`: reserved for a provider that reports a rate limit
   * without throwing. `GitHubProvider` throws `RateLimitedError` from every
   * read instead, so a short list never reads as complete.
   */
  kind: 'page-cap' | 'request-failed' | 'rate-limited';
  /**
   * Which leg of the fetch: the search API, a repository listing, GitHub's
   * batched GraphQL fill, or a follow-up page of one PR's checks past the
   * fill's first 100. `GitHubProvider` no longer emits `detail`, `reviews`,
   * `checks` or `threads`: the fill replaced those per-PR reads.
   */
  source: 'search' | 'list' | 'detail' | 'reviews' | 'checks' | 'threads' | 'fill' | 'contexts';
  /** Human-readable summary, always populated. */
  message: string;
  /** The HTTP status, when `kind` is `request-failed`. */
  status?: number;
  /**
   * When `kind` is `rate-limited`: the ISO time the limit lifts, if GitHub
   * said. The read behind this warning was refused, not truncated.
   */
  resetAt?: string;
  /**
   * What the warning is about: a search query, a project path, or (for
   * `detail`/`reviews`/`checks`/`threads`/`fill`/`contexts`, every single-PR
   * source) exactly
   * `owner/repo#number` -- build it with `warningTarget`, not by hand.
   *
   * One PR per warning even for a thread-count batch that covers many at
   * once: one warning per affected PR, not one warning naming several.
   *
   * This field is the join key `fetchDashboardBatch` (MRDashboard.ts) uses
   * to attribute a warning to a row, by exact string match against
   * `warningTarget(projectPath, iid)`. A `checks` warning once carried
   * `owner/repo@sha` (the commit the check-runs fetch actually failed on,
   * which felt like the more precise thing to name) while every other
   * source carried `owner/repo#number`; that PR's own warning could never
   * match the lookup, and `DashboardGroup.onWarning` silently never fired
   * for it. `warningTarget` exists so every producer and this field's one
   * consumer read the same format from the same place, instead of relying
   * on every call site independently getting the string literal right.
   */
  target?: string;
  /**
   * The source branch a by-branch read was resolving, set on every warning
   * `fetchPullRequestByBranch` or `fetchPullRequestsByBranches` reports, so a
   * batch caller can attribute it.
   */
  branch?: string;
}

/** Options for `fetchPullRequestByBranch` and `fetchPullRequestsByBranches`. */
export interface ByBranchReadOptions {
  /**
   * Called when the answer may be incomplete: a failed list request, a
   * fallback scan that hit its cap, a found PR whose fill failed, or a
   * warning the fill reported for a PR it kept. Each warning carries
   * `branch`. The result is unchanged (a failed read still resolves to
   * null), and a throw from this callback is ignored. Providers whose
   * `canReportIncompleteBranchReads` is not true never call it.
   */
  onWarning?: (warning: FetchPullRequestsWarning) => void;
}

/**
 * The single-PR `target` every `FetchPullRequestsWarning` for `detail`,
 * `reviews`, `checks`, and `threads` must use: `owner/repo#number`.
 *
 * Every producer of a single-PR warning (`GitHubProvider`) and this field's
 * one consumer (`fetchDashboardBatch` in `MRDashboard.ts`) call this rather
 * than interpolating the string themselves, specifically so the two sides
 * cannot drift the way `checks` (`owner/repo@sha`, a different value
 * entirely) and `threads` (a comma-joined list of several) both did before
 * this function existed -- both changes that looked like local improvements
 * (naming the actual failing commit; reporting a whole batch at once) and
 * both silently broke the one thing `target` exists for: being looked up.
 */
export function warningTarget(projectPath: string, iid: number): string {
  return `${projectPath}#${iid}`;
}

/**
 * Options for `fetchPullRequests`.
 * All fields are optional — omitting everything returns the user's open MRs.
 */
export interface FetchPullRequestsOptions {
  /**
   * Filter by state(s). Defaults to `'opened'`.
   * Pass a single state or an array (e.g. `['opened', 'merged']`).
   * When multiple states are requested and the API only supports one,
   * the provider fetches `all` and filters client-side.
   */
  state?: MRState | MRState[];

  /**
   * Fetch specific MRs by IID: one batched query on GitHub, one query per
   * IID on GitLab. Requires `projectPath` to be set.
   */
  iids?: number[];

  /**
   * Fetch every MR in the project authored by any of these usernames, with
   * full dashboard fields, in one query per author. Lets a caller build a
   * team board without the token user being involved in each MR — no REST
   * discovery pass needed. Requires `projectPath` to be set.
   */
  authorUsernames?: string[];

  /**
   * Project path (e.g. `'group/project'`). Required when `iids` or
   * `authorUsernames` is specified. May also be passed ALONE: returns every
   * MR in the project (member-blind), cursor-paginated, with full dashboard
   * fields.
   */
  projectPath?: string;

  /** Only MRs updated at/after this ISO-8601 instant. Honored by the projectPath-alone mode. */
  updatedAfter?: string;
  /** Project mode: fetch the list-weight fragment (no CI stages/jobs trees). ~10x cheaper
      per page on large projects and immune to GitLab's resolver timeouts on job trees;
      per-MR job detail stays available via fetchSingleMR. GitHub drops only `body`:
      one fill reads the checks too. */
  listWeight?: boolean;

  /**
   * Leave out MRs whose target branch is one of these exact names. Honored by
   * the projectPath-alone and authorUsernames modes. GitLab applies it
   * server-side (`not: { targetBranches }`), so it never resolves those MRs'
   * fields; GitHub drops them after fetching. Empty or absent excludes nothing.
   */
  excludeTargetBranches?: string[];

  /**
   * Called once per way the result fell short: a page cap reached with
   * matches outstanding, a search or listing page that failed, a batched
   * fill that could not read a PR (that PR is dropped from the result), or a
   * follow-up page of one PR's checks that could not be read (the PR stays,
   * with a `pending` pipeline). A quiet fetch made no such compromise.
   *
   * Invoked synchronously during the fetch; a callback that throws is ignored,
   * never surfaced as a fetch failure.
   *
   * GitHub emits `search` and `list` for its page caps, `fill` for a PR its
   * batched read could not resolve, and `contexts` for a checks page past the
   * first 100. A rate limit throws `RateLimitedError` instead of reaching this
   * callback. GitLab paginates its project mode to exhaustion and raises
   * transport failures as exceptions, so it has nothing to report and never
   * calls this.
   */
  onWarning?: (warning: FetchPullRequestsWarning) => void;
}

/**
 * The project path an option requires, or a thrown error naming that option.
 *
 * Shared by both providers so `{ iids }` without a `projectPath` fails the
 * same way everywhere: one provider throwing while the other quietly returned
 * a different query's results is the cross-provider split this prevents.
 */
export function requireProjectPath(projectPath: string | undefined, field: string): string {
  if (!projectPath) {
    throw new Error(`fetchPullRequests: \`${field}\` requires \`projectPath\``);
  }
  return projectPath;
}

/**
 * `updatedAfter` as epoch milliseconds, or null when it was not supplied.
 *
 * @throws when the value is not parseable as an instant. Forwarding an
 *   unparseable bound to the API instead means the filter is silently dropped
 *   and the caller gets more MRs than it asked for.
 */
export function parseUpdatedAfter(updatedAfter: string | undefined): number | null {
  if (updatedAfter == null) return null;
  const parsed = Date.parse(updatedAfter);
  if (Number.isNaN(parsed)) {
    throw new Error(
      `fetchPullRequests: updatedAfter must be an ISO-8601 instant, got "${updatedAfter}"`,
    );
  }
  return parsed;
}

/** Options for `fetchMergeRequestIndex`. Exactly one of `groupPath` or `projectPaths`. */
export interface FetchMergeRequestIndexOptions {
  /** A group, including its subgroups. */
  groupPath?: string;
  /** Explicit "group/project" paths. */
  projectPaths?: string[];
  /**
   * Only MRs updated at/after this ISO-8601 instant. Required: an index with
   * no lower bound walks the project's whole history.
   *
   * The walk is `UPDATED_DESC` keyset pagination, so an MR updated while the
   * walk is in progress can move ahead of the cursor and be missed. A
   * consumer keeping a watermark should take it from the instant the scan
   * started, with a small overlap, never from the instant the scan ended.
   */
  updatedAfter: string;
  /** Any state when omitted. */
  states?: MRState[];
  /** Leave out MRs whose target branch is one of these exact names, server-side. Empty or absent excludes nothing. */
  excludeTargetBranches?: string[];
  /** Called after each page with the rows collected so far. */
  onPage?: (rowsSoFar: number) => void;
  /** Cancels the walk between and during requests; an abort is surfaced as the signal's reason and never retried. */
  signal?: AbortSignal;
}

/** Options for `fetchProjectPipelines`. */
export interface FetchProjectPipelinesOptions {
  /** Only pipelines triggered by this username. */
  username?: string;
  /** ISO-8601 instants; GitLab applies both to the pipeline's `updated_at`. */
  updatedAfter: string;
  updatedBefore: string;
  /** Cancels the walk between and during requests; an abort is surfaced as the signal's reason and never retried. */
  signal?: AbortSignal;
}

/** Options for `fetchUserEvents`. */
export interface FetchUserEventsOptions {
  /** The forge's action filter, e.g. "pushed". */
  action: string;
  /**
   * Calendar dates (YYYY-MM-DD). GitLab treats both as exclusive, so a caller
   * wanting the days D1..D2 inclusive passes the day before D1 and the day
   * after D2.
   */
  after: string;
  before: string;
  /** Cancels the walk between and during requests; an abort is surfaced as the signal's reason and never retried. */
  signal?: AbortSignal;
}

/** Options for `fetchMergeRequestMetrics`. */
export interface FetchMergeRequestMetricsOptions {
  /** Cancels the walk between and during requests; an abort is surfaced as the signal's reason and never retried. */
  signal?: AbortSignal;
}

/** Options for `fetchGroupProjects`. */
export interface FetchGroupProjectsOptions {
  /** Cancels the walk between and during requests; an abort is surfaced as the signal's reason and never retried. */
  signal?: AbortSignal;
}

/** Options for `fetchProject`. */
export interface FetchProjectOptions {
  /** Cancels the walk between and during requests; an abort is surfaced as the signal's reason and never retried. */
  signal?: AbortSignal;
}

/**
 * Provider-agnostic interface for a Git hosting service.
 *
 * `GitLabProvider` implements this today; `GitHubProvider` will follow.
 * `Connection` stores a `GitProvider` and uses only this interface — it never
 * reaches into provider-specific internals.
 */
export interface GitProvider {
  /** The provider slug stored in `connected_accounts.provider`. */
  readonly providerName: string;

  /** The base URL for this provider instance, e.g. "https://gitlab.com". */
  readonly baseURL: string;

  /** Validate the stored credentials and return the authenticated user. */
  validateToken(): Promise<UserRef>;

  /**
   * Resolve a username to that provider's user, or null when no such user
   * exists.
   *
   * Returns the same `UserRef` shape `PullRequest.author` carries, so a
   * consumer can render a configured username exactly the way it renders an
   * author, instead of hand-rolling a REST call with the token this provider
   * is already holding (MAT-159). A miss is an answer, not an error: null
   * means the provider looked and found nobody, while transport and auth
   * failures still throw.
   */
  fetchUser(username: string): Promise<UserRef | null>;

  /**
   * Fetch pull/merge requests the current user is involved in.
   *
   * - No args or `{}`: returns open MRs (authored + assigned + reviewing)
   * - `{ state }`: filter by state(s)
   * - `{ iids, projectPath }`: batch-fetch specific MRs by IID
   * - `{ authorUsernames, projectPath }`: every MR in the project authored by
   *   any of those users (for team boards)
   * - `{ projectPath }`: every MR in the project (team/project view), paginated
   *
   * Contract every implementation owes a caller, so the same input cannot mean
   * different things on different providers:
   *
   * - `iids` or `authorUsernames` without `projectPath` **throws**. Neither is
   *   answerable without a project, and quietly answering a different question
   *   (the involvement set) is worse than failing.
   * - A present-but-empty `iids` or `authorUsernames` selects that mode and
   *   returns `[]`. It asks for no MRs, not for every MR.
   * - `updatedAfter` that is not parseable as an instant **throws**, in every
   *   mode, rather than being forwarded to the API and dropped there.
   * - `onWarning` is the only signal that the returned array is short. A
   *   provider that truncates or loses MRs must call it; see
   *   `FetchPullRequestsWarning`.
   *
   * Which options each provider honors:
   *
   * | option        | GitLab                        | GitHub                    |
   * | ------------- | ----------------------------- | ------------------------- |
   * | `state`       | all modes                     | all modes                 |
   * | `updatedAfter`| `projectPath`-alone mode only | all modes                 |
   * | `listWeight`  | `projectPath`-alone mode only | all modes                 |
   * | `onWarning`   | never fires (see below)       | page caps, failed searches and fills, unread checks pages |
   *
   * GitLab returns full dashboard fields from every mode and paginates its
   * project mode to exhaustion, so it has no truncation to report; GitHub
   * reads discovery under bounded page walks and each PR through a batched
   * GraphQL fill, so it can, and a rate limit throws `RateLimitedError`.
   */
  fetchPullRequests(options?: FetchPullRequestsOptions): Promise<PullRequest[]>;

  /**
   * Fetch a single MR/PR by project path and IID.
   * Returns null if the project or MR doesn't exist.
   */
  fetchSingleMR(projectPath: string, mrIid: number, currentUserNumericId: number | null): Promise<PullRequest | null>;

  /**
   * Fetch a single MR/PR by its source branch within a project.
   * Returns null if no matching MR/PR exists for that branch, and also when
   * the read could not tell: on GitHub a failed list request, a fallback
   * scan that ended at its 500-PR cap, or a found PR whose fill failed.
   * `options.onWarning` tells those apart from a confirmed miss where
   * `capabilities.canReportIncompleteBranchReads` is true.
   * @param state - Filter by state. Defaults to `'opened'`. Pass `'all'` to include merged/closed.
   */
  fetchPullRequestByBranch(
    projectPath: string,
    sourceBranch: string,
    state?: MRState | 'all',
    options?: ByBranchReadOptions,
  ): Promise<PullRequest | null>;

  /**
   * Batch-fetch MRs by source branches in a single operation.
   * Returns a Map<branch, PullRequest | null>. Branches with no open MR map to null,
   * as does a branch whose PR was found but could not be filled; on GitHub
   * `options.onWarning` reports that case, and any warning the fill raised
   * for a PR it kept, with `branch` set.
   * Optional: providers that don't implement this fall back to
   * sequential fetchPullRequestByBranch calls.
   */
  fetchPullRequestsByBranches?(
    projectPath: string,
    branches: string[],
    state?: MRState | 'all',
    options?: ByBranchReadOptions,
  ): Promise<Map<string, PullRequest | null>>;

  /**
   * Create a new merge request / pull request.
   * Returns the created PullRequest.
   *
   * Can reject with `ReadBackFailedError` (`writeApplied: true`): the PR
   * exists but could not be read back. On GitHub it can also reject with
   * `PartialCreateError`: the PR exists but a reviewers, assignees or labels
   * step failed; `failedSteps` and `pullRequest` say which.
   */
  createPullRequest(input: CreatePullRequestInput): Promise<PullRequest>;

  /**
   * Update an existing merge request / pull request.
   * Returns the updated PullRequest.
   */
  updatePullRequest(projectPath: string, mrIid: number, input: UpdatePullRequestInput): Promise<PullRequest>;

  /**
   * Fetch branch protection rules for a repository.
   * Returns an array of rules (one per protected branch/pattern).
   *
   * Implementations throw on a partial read failure rather than returning
   * the rules already read: callers gate destructive actions on this list,
   * and once it is returned a partial list cannot be told apart from a
   * complete one, so returning it would be silent data loss wearing the
   * shape of success (MAT-147). If a caller ever needs to act on whatever
   * was readable, the honest fix is a return type that can say which
   * branches were unreadable, not an implementation quietly choosing
   * between the two ways of hiding that fact.
   */
  fetchBranchProtectionRules(projectPath: string): Promise<BranchProtectionRule[]>;

  /**
   * Delete a branch from the repository.
   * @throws if the branch doesn't exist or is protected.
   */
  deleteBranch(projectPath: string, branch: string): Promise<void>;

  /**
   * Fetch discussions (comments, threads) for a specific MR/PR.
   * Returns the MRDetail with discussions populated.
   */
  fetchMRDiscussions(repositoryId: string, mrIid: number): Promise<MRDetail>;

  // ── Metric-grade reads (optional; check the matching capability flag) ───

  /**
   * Cheap index of merge requests across a group (with subgroups) or a set
   * of projects, bounded by `updatedAfter`. Scalar fields only: this is the
   * list a metrics consumer keeps history from, and it is what GitLab's
   * resolvers can page through without timing out on a busy monorepo.
   * Check `capabilities.canFetchMergeRequestIndex`.
   *
   * Bounded transient retry: up to 3 attempts per request, each under a 30s
   * deadline. Caller cancellation via `options.signal` is never retried.
   */
  fetchMergeRequestIndex?(options: FetchMergeRequestIndexOptions): Promise<MergeRequestIndexRow[]>;

  /**
   * One MR's metric-grade detail: description, summary and per-file diff
   * stats, labels, approver usernames, and every note (paginated to
   * exhaustion) with its author, time, system flag, and whether it sits on
   * a diff line. Null when the project or MR does not exist.
   * Check `capabilities.canFetchMergeRequestMetrics`.
   *
   * Bounded transient retry: up to 3 attempts per request, each under a 30s
   * deadline. Caller cancellation via `options.signal` is never retried.
   */
  fetchMergeRequestMetrics?(
    projectPath: string,
    mrIid: number,
    options?: FetchMergeRequestMetricsOptions,
  ): Promise<MergeRequestMetrics | null>;

  /**
   * Full paths of a group's projects, subgroups included. Check
   * `capabilities.canFetchGroupProjects`. Throws when the group does not
   * exist or is not visible to the token.
   *
   * Bounded transient retry: up to 3 attempts per request, each under a 30s
   * deadline. Caller cancellation via `options.signal` is never retried.
   */
  fetchGroupProjects?(groupPath: string, options?: FetchGroupProjectsOptions): Promise<string[]>;

  /**
   * Resolve a "group/project" path, or null when it does not exist. Check
   * `capabilities.canFetchProject`.
   *
   * Bounded transient retry: up to 3 attempts per request, each under a 30s
   * deadline. Caller cancellation via `options.signal` is never retried.
   */
  fetchProject?(projectPath: string, options?: FetchProjectOptions): Promise<ProjectRef | null>;

  /**
   * A project's pipelines inside a window, optionally for one user.
   * Check `capabilities.canFetchProjectPipelines`.
   *
   * Bounded transient retry: up to 3 attempts per request, each under a 30s
   * deadline. Caller cancellation via `options.signal` is never retried.
   */
  fetchProjectPipelines?(projectPath: string, options: FetchProjectPipelinesOptions): Promise<PipelineSummary[]>;

  /**
   * A user's activity feed for one action between two dates. `userId` is
   * the scoped id `UserRef.id` carries (`fetchUser` returns it).
   * Check `capabilities.canFetchUserEvents`.
   *
   * Bounded transient retry: up to 3 attempts per request, each under a 30s
   * deadline. Caller cancellation via `options.signal` is never retried.
   */
  fetchUserEvents?(userId: string, options: FetchUserEventsOptions): Promise<UserEvent[]>;

  /**
   * Reads the approval rules of the project's open PRs, one entry per PR.
   * Gated on `capabilities.canFetchApprovalRules`. A rule's `section` is the
   * owner; GitHub lowercases it (`@org/team`, `@login`) so it joins with
   * `fetchCodeownerSections`. An entry with `unknownReason` set means that
   * PR's rules were not read, which is not the same as "no rules".
   */
  fetchApprovalRules?(options: FetchApprovalRulesOptions): Promise<MRApprovalRules[]>;

  /**
   * Reads the CODEOWNERS section names for a project, or null when it has no
   * CODEOWNERS file. Gated on `capabilities.canFetchCodeownerSections`.
   * GitHub's sections are the owners, lowercased with an `@` prefix; email
   * owners are dropped because a review request cannot name one.
   */
  fetchCodeownerSections?(options: { projectPath: string }): Promise<string[] | null>;

  /**
   * Reads how many commits one PR's base has moved on, or null when there is
   * no comparison. Gated on `capabilities.canFetchDivergedCount`.
   */
  fetchDivergedCount?(projectPath: string, mrIid: number): Promise<number | null>;

  /**
   * Batched `fetchDivergedCount`. The map has an entry for each PR that was
   * read, null when that PR has no comparison, and no entry when that PR's
   * read failed. Gated on `capabilities.canFetchDivergedCount`.
   */
  fetchDivergedCounts?(projectPath: string, mrIids: number[]): Promise<Map<number, number | null>>;

  // ── Mutation capabilities ───────────────────────────────────────────────

  /**
   * Reports which mutation operations this provider supports.
   * Callers should check these flags to conditionally show/hide UI
   * affordances without knowing which provider they're talking to.
   */
  readonly capabilities: ProviderCapabilities;

  // ── MR lifecycle mutations ──────────────────────────────────────────────

  /**
   * Merge (accept) a pull request / merge request.
   * All input fields are optional — omitting them defers to the project's
   * configured defaults (merge method, squash policy, delete-source-branch).
   *
   * Resolves once the merge landed, or, on a merge-queue base, once the PR
   * is queued (see below). A failed source-branch cleanup is reported in
   * `sourceBranchNotDeleted`, never thrown. A rejection means the merge
   * failed, or its write was applied but the PR could not be read back
   * (`ReadBackFailedError` with `writeApplied: true`): a landed merge, or
   * on a merge-queue base a queued PR that has not merged. It can also mean
   * nothing was written: a PR already in the queue whose read-back failed
   * (`writeApplied: false`; see below).
   *
   * On GitHub the merge method, when not given, is the viewer's default
   * (the method they last used here, else the repository default; when that
   * is not allowed, the first allowed of merge, squash, rebase), and a
   * method the repository forbids is refused before the write. When the
   * base branch uses a merge queue, the PR is enqueued instead (`sha`
   * becomes the expected head) and the result is the still-open PR with
   * `queued` set; a PR already in the queue gets no second write. The queue
   * applies its own settings, so `mergeMethod`, `squash`, `commitMessage`,
   * `squashCommitMessage` and `shouldRemoveSourceBranch` are refused there
   * when given at all, `false` included. A queued PR whose read-back fails
   * throws `MergeReadBackFailedError` with `queued` set and `writeApplied`
   * false when nothing was written.
   */
  mergePullRequest(projectPath: string, mrIid: number, input?: MergePullRequestInput): Promise<MergePullRequestResult>;

  /**
   * Approve a pull request / merge request.
   * On GitLab: POST /merge_requests/:iid/approve
   * On GitHub: POST /pulls/:number/reviews with event "APPROVE"
   */
  approvePullRequest(projectPath: string, mrIid: number): Promise<void>;

  /**
   * Revoke an existing approval.
   * On GitLab: POST /merge_requests/:iid/unapprove.
   * On GitHub: dismisses the token user's own review (PUT
   * /pulls/:number/reviews/:review_id/dismissals) -- GitHub has no bare
   * "unapprove" endpoint, so this targets the review that currently carries
   * the approval rather than deleting an approval record.
   * Check `capabilities.canUnapprove` before calling.
   */
  unapprovePullRequest(projectPath: string, mrIid: number): Promise<void>;

  /**
   * Rebase the MR source branch onto the target branch.
   * On GitHub this is updatePullRequestBranch with the REBASE method.
   * Check `capabilities.canRebase` before calling.
   */
  rebasePullRequest(projectPath: string, mrIid: number): Promise<void>;

  /**
   * Enable auto-merge: the MR will be merged automatically when the
   * pipeline succeeds and all approval rules are met.
   * On GitLab: PUT /merge_requests/:iid/merge with merge_when_pipeline_succeeds.
   * On GitHub: GraphQL `enablePullRequestAutoMerge` with a merge method the
   * repository allows (the viewer's default, which is the method they last
   * used here or else the repository default; when that is not allowed, the
   * first allowed of merge, squash, rebase); on a merge queue branch no
   * method is sent, since the queue
   * decides. Requires the repository's `allow_auto_merge` setting to be on.
   * Check `capabilities.canAutoMerge` before calling.
   */
  setAutoMerge(projectPath: string, mrIid: number): Promise<void>;

  /**
   * Add a pull request to its target branch's merge queue.
   * On GitHub: GraphQL `enqueuePullRequest`. Unlike `mergePullRequest`, this
   * works while other entries are queued. `expectedHeadSha` refuses the
   * enqueue if the branch has moved since it was reviewed.
   * GitLab leaves this absent. Check `capabilities.canEnqueue` before calling.
   */
  enqueuePullRequest?(
    projectPath: string,
    mrIid: number,
    input?: EnqueuePullRequestInput,
  ): Promise<MergeQueueEntry>;

  /**
   * Whether a pull request's target branch uses a merge queue, and whether
   * the pull request is in it now. GitLab leaves this absent.
   * Check `capabilities.canEnqueue` before calling.
   */
  fetchMergeQueueStatus?(projectPath: string, mrIid: number): Promise<MergeQueueStatus>;

  /**
   * Cancel a previously enabled auto-merge.
   * On GitLab: POST /merge_requests/:iid/cancel_merge_when_pipeline_succeeds.
   * On GitHub: GraphQL `disablePullRequestAutoMerge`.
   * Check `capabilities.canAutoMerge` before calling.
   */
  cancelAutoMerge(projectPath: string, mrIid: number): Promise<void>;

  // ── Discussion mutations ────────────────────────────────────────────────

  /**
   * Resolve a discussion thread on an MR.
   * On GitLab: PUT /merge_requests/:iid/discussions/:discussion_id with
   * resolved=true.
   * On GitHub: GraphQL `resolveReviewThread`.
   * Check `capabilities.canResolveDiscussions` before calling.
   */
  resolveDiscussion(projectPath: string, mrIid: number, discussionId: string): Promise<void>;

  /**
   * Unresolve a previously resolved discussion thread.
   * On GitLab: PUT /merge_requests/:iid/discussions/:discussion_id with
   * resolved=false.
   * On GitHub: GraphQL `unresolveReviewThread`.
   * Check `capabilities.canResolveDiscussions` before calling.
   */
  unresolveDiscussion(projectPath: string, mrIid: number, discussionId: string): Promise<void>;

  // ── Comment writes ──────────────────────────────────────────────────────

  /**
   * Post a new top-level comment.
   * On GitLab: a resolvable discussion, or a plain note when
   * `resolvable: false`.
   * On GitHub: a pull request comment, never resolvable whatever the option.
   */
  createComment(
    projectPath: string,
    mrIid: number,
    body: string,
    options?: { resolvable?: boolean }
  ): Promise<NoteWriteResult>;

  /**
   * Post a comment on a diff line.
   * On GitLab: one positioned discussion; GitLab can silently drop the
   * position, which comes back as `anchored: false` with no retry.
   * On GitHub: a review comment at the head commit, on side `RIGHT` at
   * `anchor.line`, or side `LEFT` at `anchor.oldLine` when `line` is absent.
   */
  createInlineComment(
    projectPath: string,
    mrIid: number,
    body: string,
    anchor: CommentAnchor
  ): Promise<InlineCommentResult>;

  /**
   * Reply inside an existing thread.
   * On GitHub only `gh-review-thread-<id>` threads take replies; any other
   * id is refused before a request. Check
   * `capabilities.canReplyToGeneralComments`.
   */
  replyToDiscussion(
    projectPath: string,
    mrIid: number,
    discussionId: string,
    body: string
  ): Promise<NoteWriteResult>;

  /**
   * Replace a comment's body.
   * On GitHub, `note.kind` picks the endpoint; with no kind the diff comment
   * is tried first and the pull request comment on a 404, and a comment that
   * belongs to another pull request is refused before any write.
   */
  updateComment(projectPath: string, mrIid: number, note: NoteRef, body: string): Promise<void>;

  /** Delete a comment; `note.kind` resolves as in `updateComment`. GitHub cannot delete a review. */
  deleteComment(projectPath: string, mrIid: number, note: NoteRef): Promise<void>;

  /**
   * Post a whole review: a summary, diff comments, replies and resolves, with
   * an outcome. Nothing posts when the caller already has a pending review
   * (`pending-drafts`) or the forge refuses a comment's anchor (`bad-anchors`).
   * On GitLab: pending comments published once, then approve and resolve; a
   * failure before the publish deletes what it created. At most 100 comments
   * and replies together; more is refused before any request.
   * On GitHub: one review POST, then replies and resolves. Every reply must
   * name a `gh-review-thread-<id>`, checked before any request. An approve
   * GitHub refuses on the caller's own pull request posts as a comment with
   * `approved: false` and `approveError`. A reply that fails is listed in
   * `replyErrors` and its resolve is skipped.
   */
  submitReview(projectPath: string, mrIid: number, review: ReviewSubmission): Promise<ReviewSubmitResult>;

  // ── Pipeline mutations ──────────────────────────────────────────────────

  /**
   * Retry a failed or canceled pipeline.
   * On GitLab: POST /pipelines/:id/retry
   * On GitHub: POST re-run for the workflow run.
   */
  retryPipeline(projectPath: string, pipelineId: number): Promise<void>;

  /**
   * Retry a single failed or canceled job.
   * On GitLab: POST /projects/:id/jobs/:job_id/retry
   * On GitHub: POST re-run for a specific job.
   */
  retryJob(projectPath: string, jobId: number): Promise<void>;

  /**
   * Fetch the trace/log output for a job.
   * On GitLab: GET /projects/:id/jobs/:job_id/trace
   * Returns plain text log content.
   */
  fetchJobTrace(projectPath: string, jobId: number): Promise<string>;

  /**
   * A project's labels, optionally filtered by `search`, capped at `maxRows`.
   * `truncated` is true when the cap cut the list short.
   * GitLab applies `search` server-side; GitHub keeps names containing it, case-insensitively, client-side.
   * Check `capabilities.canFetchProjectLabels` before calling.
   */
  fetchProjectLabels?(
    projectPath: string,
    options?: { search?: string; maxRows?: number },
  ): Promise<{ labels: ProjectLabel[]; truncated: boolean }>;

  /**
   * A project's pipelines, newest first, filtered by ref, sha or MR iid.
   * On both forges `iid` overrides `ref` and `sha`. GitLab lists every pipeline
   * the MR has run; GitHub lists only the runs on the PR's current head sha.
   * Check `capabilities.canFetchPipelineList` before calling.
   */
  fetchPipelineList?(
    projectPath: string,
    options: { ref?: string; sha?: string; iid?: number; limit: number },
  ): Promise<PipelineListEntry[]>;

  /**
   * Pull request rows without the dashboard resolvers.
   * On GitHub, `author` or `search` reads the search index instead, which can
   * lag a just-created PR and stops at 1000 results (reported as `truncated`).
   * Check `capabilities.canFetchPullRequestSummaries` before calling.
   */
  fetchPullRequestSummaries?(
    projectPath: string,
    options: FetchSummariesOptions,
  ): Promise<{ rows: PullRequestSummary[]; truncated: boolean }>;

  /**
   * Add labels to a pull request, leaving the others in place.
   * Check `capabilities.canEditLabels` before calling.
   */
  addPullRequestLabels?(projectPath: string, mrIid: number, labels: string[]): Promise<void>;

  /**
   * Remove labels from a pull request, leaving the others in place.
   * Check `capabilities.canEditLabels` before calling.
   */
  removePullRequestLabels?(projectPath: string, mrIid: number, labels: string[]): Promise<void>;

  /**
   * The commit's parent shas.
   * Check `capabilities.canFetchCommitParents` before calling.
   */
  fetchCommitParents?(projectPath: string, sha: string): Promise<string[]>;

  /**
   * The pipeline's failed jobs, independent of the MR cache's fragment weight,
   * plus those of every same-project downstream pipeline its bridges trigger
   * (a child's failure never appears among the parent's own jobs). Rows under a
   * bridge that cannot fail the parent come back allowFailure. All or nothing:
   * one failed listing anywhere in the tree throws, so a partial result never
   * reads as clean. On GitHub, a workflow run's own failed jobs (it has no
   * downstream pipelines), counting cancelled and timed-out jobs too, where
   * GitLab returns only failed ones; `allowFailure` is always false on GitHub,
   * since its REST jobs carry no required flag. Check
   * `capabilities.canFetchPipelineFailedJobs` before calling.
   */
  fetchPipelineFailedJobs?(projectPath: string, pipelineId: number): Promise<PipelineJob[]>;

  /**
   * A pull request's per-file diffs, one page of up to 100 files; `truncated`
   * is set when 100 came back, as GitLab's reads do. A file with no patch
   * (binary, or too large for GitHub to inline) comes back with an empty
   * `diff` and `tooLarge: true`. Check `capabilities.canFetchPullRequestDiffs`
   * before calling.
   */
  fetchPullRequestDiffs?(
    projectPath: string,
    mrIid: number,
    options?: { signal?: AbortSignal }
  ): Promise<{ diffs: PullRequestFileDiff[]; truncated: boolean }>;

  /**
   * Fetch the child/downstream pipeline for a trigger bridge job.
   * Returns null if no downstream pipeline exists.
   *
   * Pass `pipelineId` (the parent pipeline) whenever it is known: GitLab's
   * `GET /jobs/:id` 404s for bridge jobs, so without the parent id the only
   * fallback that can find a bridge (`/pipelines/:id/bridges`) is
   * unreachable and a genuine bridge job resolves to null (MAT-155).
   */
  fetchDownstreamPipeline(projectPath: string, jobId: number, pipelineId?: number): Promise<Pipeline | null>;

  /**
   * Unified job detail fetch — single GET /jobs/:id, discriminated return type.
   * Pass `pipelineId` as a hint: if /jobs/:id returns 404 (bridge jobs don't appear
   * there), falls back to scanning /pipelines/:pipelineId/bridges instead.
   */
  fetchJobDetail(projectPath: string, jobId: number, pipelineId?: number): Promise<JobDetail>;

  // ── Review mutations ────────────────────────────────────────────────────

  /**
   * Re-request review attention on an MR from its reviewers.
   * If `reviewerUsernames` is provided, only those reviewers are pinged;
   * otherwise all current reviewers are re-requested.
   *
   * Both providers throw, rather than resolve, when there is nothing to
   * re-request: no `reviewerUsernames` given and the MR/PR has no existing
   * reviewers. Resolving in that case would be a silent no-op -- the caller
   * would believe reviewers were re-pinged when none were. This contract is
   * shared code's responsibility to keep in sync across providers; do not
   * let one provider throw here while the other resolves.
   */
  requestReReview(projectPath: string, mrIid: number, reviewerUsernames?: string[]): Promise<void>;

  // ── REST pass-through (used by note mutations, job traces, etc.) ────────

  /**
   * Make an authenticated REST API request to the provider.
   * Used for operations that don't have a typed method yet (job traces,
   * pipeline retries, etc.).
   *
   * `path` is always provider-relative -- the same shape on either provider,
   * e.g. `/user`, never `/api/v4/user` or `/api/v3/user`. Implementations
   * translate that path to the provider's actual API URL: GitHub joins it
   * onto its API root (`https://api.github.com`, or the GHES `/api/v3` root);
   * GitLab joins it onto `${baseURL}/api/v4`. A path that already starts with
   * `/api/v4` is rejected by GitLab rather than silently accepted (MAT-130):
   * this method used to concatenate `baseURL + path` verbatim, so every
   * existing GitLab caller had learned to include that prefix itself, and
   * tolerating both shapes would leave that ambiguity in place indefinitely
   * instead of surfacing it once, at the one call site that needs to change.
   *
   * A non-2xx resolves rather than throwing, so callers branch on `res.ok`.
   * The exception is a rate limit: GitLab waits out a 429 (up to 30s for a
   * GET, 65s for a write) and then throws `RateLimitedError`, and GitHub
   * throws it for a rate-limited GET.
   *
   * GitHub's Response is rebuilt from its HTTP client rather than returned
   * from `fetch`, so `res.url` is always empty there. Status, statusText,
   * headers, and body are all carried through; `url` is the one field the
   * Response constructor cannot set, so it cannot be restored.
   *
   * On both providers a successful body streams: it is not read before the
   * Response resolves, so a caller can cancel `res.body`'s reader after the
   * bytes it wants and the rest is not read further. `Content-Length` is
   * carried through. A 4xx/5xx body is read in full on GitHub.
   */
  restRequest(
    method: string,
    path: string,
    body?: unknown,
    op?: string,
    io?: { redirect?: 'manual' },
  ): Promise<Response>;

  /**
   * Subscribe to real-time updates for a single MR/PR.
   *
   * Calls `onUpdate` whenever the MR state changes (pipeline status, approvals,
   * merge status, rebase progress, etc.), giving consumers a fully-typed
   * PullRequest without having to manage raw WebSocket frames or ActionCable
   * protocol details.
   *
   * Returns a dispose function — call it to unsubscribe and clean up.
   *
   * **GitLab**: Implemented via ActionCable WebSocket subscription on
   *   `userMergeRequestUpdated`, backed by a `MR_DETAIL_QUERY` re-fetch on
   *   each event to return a complete, strongly-typed PullRequest.
   * **GitHub**: Poll-only, since GitHub has no push channel: one
   *   `fetchSingleMR` every `options.pollIntervalMs` (default 60s), status
   *   `polling`. A failed fill reports `reconnecting` with a
   *   `ReadBackFailedError`; a failed checks page still delivers the PR.
   *
   * @param projectPath - e.g. "group/project"
   * @param mrIid - the numeric MR/PR number
   * @param currentUserNumericId - used to compute roles; pass null if unknown
   * @param onUpdate - called with the latest PullRequest snapshot on each change
   * @returns dispose — call to cancel the subscription
   */
  watchMR(
    projectPath: string,
    mrIid: number,
    currentUserNumericId: number | null,
    onUpdate: (pr: PullRequest) => void,
    options?: RealtimeWatcherOptions,
  ): () => void;

  /**
   * Push-only subscription for a set of already-fetched MRs: no fetch and no
   * poll, just the transport's connect, disconnect and per-message event
   * callbacks. Built for `createRealtimeWatcher`'s `subscribe`, so a caller
   * that batches its own fetch (the group dashboard) gets push without one
   * `watchMR` loop per MR.
   *
   * Optional: absent on providers with no push channel (GitHub today).
   * GitLab multiplexes it over the same shared cable as `watchMR`.
   *
   * @param prs - MRs to subscribe, as returned by a fetch (`id` locates the
   *   provider's own subscription key)
   * @returns dispose, which unsubscribes this call's MRs only
   */
  subscribePullRequestEvents?(
    projectPath: string,
    prs: ReadonlyArray<Pick<PullRequest, 'id' | 'iid'>>,
    callbacks: WatcherSubscribeCallbacks,
  ): () => void;

  /**
   * Watch the project's events feed and translate activity into cache
   * invalidation hints. The SDK owns the poll loop: interval, jitter,
   * retry, and backoff. The caller persists the cursor via
   * `options.onCursor` and passes it back on the next start.
   *
   * Optional, and implemented on both providers today. Still feature-detect
   * with `provider.watchEvents?.(...)` or `capabilities.canWatchEvents`: the
   * interface keeps it optional, so a provider added later may not have it.
   *
   * Known feed blind spots (rely on a slow full refresh for these):
   * metadata-only MR edits and pipeline status transitions emit no event.
   * GitHub is blinder than GitLab on both counts: its feed carries no CI
   * events at all, so `pipelines` never fires, and it retains only hours of
   * history, so a watcher down longer than that must full-sync rather than
   * trust its cursor. It also polls at 60s by default, not 15s.
   *
   * @returns dispose. Call to stop the loop.
   */
  watchEvents?(
    projectPath: string,
    options: WatchEventsOptions,
    onInvalidations: (batch: InvalidationBatch) => void,
  ): () => void;
}

/**
 * Parse the numeric project/repo ID from a scoped repositoryId string.
 * e.g. "gitlab:42" → 42, "github:12345" → 12345
 */
export function parseRepoId(repositoryId: string): number {
  const parts = repositoryId.split(':');
  return parseInt(parts.at(-1) ?? '0', 10);
}

/**
 * Extract the provider prefix from a scoped repositoryId.
 * e.g. "gitlab:42" → "gitlab", "github:12345" → "github"
 */
export function repoIdProvider(repositoryId: string): string {
  return repositoryId.split(':')[0] ?? 'unknown';
}
