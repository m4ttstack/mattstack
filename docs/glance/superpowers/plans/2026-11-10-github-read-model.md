# GitHub Read Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make glance's GitHub PR read real (readiness, reviewers and approvals, CI, cost) by replacing the per-PR REST fill with one batched GraphQL fill.

**Architecture:** Discovery (REST search and list, the GraphQL branch lookup) stays as it is and yields PR numbers. A new pure module, `src/githubFill.ts`, builds the aliased fill query and maps each returned node to a `PullRequest`. `GitHubProvider` sends the fill through a new read-side GraphQL call that keeps partial data and throws `RateLimitedError`. A forge-neutral `readiness` field is derived for both providers and consumed by the dashboard and the notifier.

**Tech Stack:** TypeScript 5.9, Bun test (`packages/glance`, rt root), vitest and Storybook (`packages/glance-react`), Octokit (`@octokit/core`, throttling, retry, graphql).

**Spec:** `docs/glance/superpowers/specs/2026-11-10-github-read-model-design.md`. Read it before any task; section numbers below refer to it.

## Global Constraints

- GitLab output must not change: same `isReady`, `status`, `isCheckingMergeability`, `blockers` and `reviews` for every GitLab-shaped input.
- Additive fields only, except `approvalsRequired: number | null` (and dashboard `reviews.required: number | null`); update every in-repo reader in the same task as the widening.
- Unknown is `null` or `checking`, never a default number and never `blocked`.
- `packages/glance`: `bun test`, `bun run check-types` and `bun run check:node` clean before every commit, run from `packages/glance`. `packages/glance-react`: `bun run test`, `bun run lint`, `bun run check-types`.
- rt-root tests run from the repo root (`bun test <file>`), never from a subdirectory.
- After any `packages/glance/src` change that a later task's rt or board test consumes, run `bun run build` in `packages/glance` (rt and the board resolve `dist/`).
- No em or en dashes in code, comments, docs or copy. Comments state a constraint the code cannot show, never what the code does.
- One commit per task, message prefixed `glance:` (or `notifier:`, `board:`, `glance-react:` where the task lives there), ending with the attribution line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No live forge calls outside Task 12. Task 12 runs the live suite once, against `m4ttheweric/glance-conformance` only; never `m4ttheweric/gitq-test-sandbox`. Never print or stage `packages/glance/harness_credentials.json`.
- Never run a built rt binary or the daemon. Never touch the main checkout.
- No change to the daemon's sync cadence, coalescing or deep/delta rules.

## Review Focus

1. **A fill alias that comes back null between discovery and fill** (PR deleted, or invisible to the token): list paths drop it with no warning, single paths return `null`. Pinned in Task 8.
2. **The contexts follow-up page fails** on a PR with more than 100 checks: the PR must not read `success`. It keeps `pipeline` with status `pending` plus a `request-failed` warning with source `contexts`, and readiness reads `checking`. Pinned in Task 8.
3. **A stored row without `readiness`** (written by an older SDK, read back from the daemon's project store): the dashboard and the notifier fall back to today's logic and never read it as blocked. Pinned in Tasks 3 and 11.
4. **A team-only review request** (no user reviewers, `reviewDecision: REVIEW_REQUIRED`, count unreadable): `approved` false, `approvalsRequired` null, label "Review required", no "x of y". Pinned in Tasks 5 and 11.
5. **A rate limit in the middle of a list fill**: the call throws `RateLimitedError` with `resetAt`, instead of returning a short list that reads as complete. Pinned in Task 8.

---

### Task 1: Readiness types and the GitLab derivation

**Files:**
- Modify: `packages/glance/src/types.ts` (beside `PullRequest`, ~151-270)
- Create: `packages/glance/src/readiness.ts`
- Modify: `packages/glance/src/GitLabProvider.ts` (`toMR`, ~445-540, and every other site that builds a GitLab `PullRequest`)
- Modify: `packages/glance/src/index.ts` (exports)
- Test: `packages/glance/tests/readiness-gitlab.test.ts`

**Interfaces:**
- Produces (types.ts): `ReadinessState`, `ReadinessReason`, `Readiness` exactly as in spec section 2; `PullRequest.readiness?: Readiness`.
- Produces (readiness.ts): `export function gitlabReadiness(pr: PullRequest): Readiness`. It reads only fields the PR already has: `state`, `draft`, `detailedMergeStatus`, `conflicts`, `shouldBeRebased`, `pipeline?.status`, `approved`, `mergeabilityChecks`, `unresolvedThreadCount`, `mergeError`.
- Produces: `export function blockerReasons(pr: PullRequest): ReadinessReason[]`, the shared blocker list (conflicts, behind, checks-failing, checks-running, approvals, threads via the 0.27.0 discussions rule, merge-error). Task 3 reuses it so the dashboard and readiness cannot disagree.

- [ ] **Step 1: Write the failing tests** in `readiness-gitlab.test.ts`:
  - `mergeable status reads ready with no reasons`: `detailedMergeStatus: 'mergeable'` gives `{ state: 'ready', reasons: [] }`.
  - `each transitional status reads checking`: for each of `TRANSITIONAL_MERGE_STATUSES`, `state === 'checking'`.
  - `not_approved reads blocked with approvals`: `detailedMergeStatus: 'not_approved', approved: false` gives `reasons` containing `'approvals'`.
  - `conflict plus failed pipeline names both`: `conflicts: true`, `pipeline.status: 'failed'` gives `reasons` equal to `['conflicts', 'checks-failing']` (order as listed in `ReadinessReason`).
  - `DISCUSSIONS_NOT_RESOLVED FAILED names threads; INACTIVE with open threads does not`.
  - `a blocked status with no known cause reads other`: `detailedMergeStatus: 'jira_association_missing'`, no blockers, gives `['other']`.
  - `draft, merged and closed take their own state with empty reasons`.
  - `toMR attaches readiness`: a `GitLabProvider` read through its existing GraphQL stub returns a PR whose `readiness` equals `gitlabReadiness` of the same PR.

- [ ] **Step 2: Run** `bun test tests/readiness-gitlab.test.ts` from `packages/glance`. Expected: FAIL, `readiness.ts` not found.

- [ ] **Step 3: Implement** `gitlabReadiness` and `blockerReasons` in `src/readiness.ts`, the types in `types.ts`, and set `readiness: gitlabReadiness(pr)` as the last step of every GitLab `PullRequest` construction. Export the three types and `gitlabReadiness` from `index.ts`.

- [ ] **Step 4: Run** the new test, then the full `bun test`, `check-types`, `check:node`. Expected: PASS, no other test changes.

- [ ] **Step 5: Commit** `glance: add a forge-neutral readiness field, derived for GitLab`.

### Task 2: Widen the required approval count

**Files:**
- Modify: `packages/glance/src/types.ts` (`approvalsRequired: number | null`; `MRDashboardProps.reviews.required: number | null`)
- Modify: `packages/glance/src/GitLabProvider.ts:525` (keep `?? 0`: GitLab always reports a number)
- Modify: `packages/glance/src/GitHubProvider.ts` (`toPullRequest`: keep `0` for now; Task 5 replaces it)
- Modify: `packages/glance/src/MRDashboard.ts:151-152` (`genuinelyApproved`)
- Modify: `apps/board/src/view.ts:425-432` (`approvalSlots`), `apps/board/src/client/board/row-status.ts:961`
- Modify: `packages/glance-react/lib/stories/MRRowPlayground.stories.tsx`, `MRCardPlayground.stories.tsx` (types only)
- Test: `packages/glance/tests/mrdashboard-status.test.ts` (add), `apps/board/src/__tests__/` (the existing file covering `approvalSlots`; add one case)

**Interfaces:**
- Produces: `approvalSlots(mr)` returns `{ filled: number; required: number } | null`, with `null` when `reviews.required` is null.

- [ ] **Step 1: Write the failing tests:**
  - `genuinelyApproved is false when required is null and nobody approved`: `approved: true, approvalsRequired: null, approvedBy: []` gives `reviews.isApproved === false`.
  - `genuinelyApproved is unchanged for GitLab's zero-rule case`: `approvalsRequired: 0, approvedBy: []` gives `false`; `approvalsRequired: 0, approvedBy: [u]` gives `true`.
  - Board: `approvalSlots returns null for an unknown count`, and the existing numeric cases are unchanged.

- [ ] **Step 2: Run** both tests (glance from `packages/glance`; board with `bun test src/__tests__/<that file>` from `apps/board`, since its suite only loads its preload from the app directory). Expected: FAIL.

- [ ] **Step 3: Implement.** `genuinelyApproved = mr.approved && !((mr.approvalsRequired ?? 0) === 0 && mr.approvedBy.length === 0)`. Board callers of `approvalSlots` draw no slots on `null`; `row-status.ts:961` treats `null` like `> 0` being unknown and uses the verdict wording `'no review yet'`.

- [ ] **Step 4: Run** the glance gates, `bun run build` in `packages/glance`, then the board's typecheck and the touched board test, and `check-types` in `packages/glance-react`. Expected: all clean.

- [ ] **Step 5: Commit** `glance: let the required approval count be unknown`.

### Task 3: The dashboard reads readiness

**Files:**
- Modify: `packages/glance/src/MRDashboard.ts` (~120-160 and the returned props)
- Modify: `packages/glance/src/types.ts` (`MRDashboardProps.readiness: Readiness | null`)
- Test: `packages/glance/tests/mrdashboard-readiness.test.ts`

**Interfaces:**
- Consumes: `Readiness`, `blockerReasons` (Task 1).
- Produces: `MRDashboardProps.readiness` (the PR's field, or `null` when absent).

- [ ] **Step 1: Write the failing tests:**
  - `GitLab parity matrix`: for a table of at least 12 GitLab-shaped PRs (mergeable, each transitional status with and without draft, conflicts and failing pipeline, not_approved, discussions, merge error, draft, merged, closed), `getMRDashboardProps` with `readiness` set by `gitlabReadiness` gives the same `isReady`, `status`, `isCheckingMergeability` and `blockers` as the same PR with `readiness` deleted.
  - `GitHub ready`: `readiness: { state: 'ready', reasons: [] }`, `detailedMergeStatus: null` gives `isReady: true`, `status: 'mergeable'`.
  - `GitHub checking is optimistic`: `readiness.state: 'checking'`, no draft, no conflicts, pipeline `success` gives `isReady: true`, `isCheckingMergeability: true`, `status: 'mergeable'`; the same with `conflicts: true` gives `isReady: false`, `status: 'blocked'`.
  - `GitHub blocked`: `readiness: { state: 'blocked', reasons: ['approvals'] }` gives `isReady: false`, `status: 'blocked'`.
  - `absent readiness falls back`: a GitHub-shaped PR with no `readiness` and `detailedMergeStatus: null` gives today's output (`isReady: false`), and `props.readiness === null`.

- [ ] **Step 2: Run** `bun test tests/mrdashboard-readiness.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** per spec section 2: when `mr.readiness` is present, `isCheckingMergeability = readiness.state === 'checking'` and `isReady = readiness.state === 'ready' || (isCheckingMergeability && !isDraft && !hasConflicts && !pipelineFailing)`; otherwise today's expressions run. `status` derivation is unchanged in shape. Pass `readiness` through as a prop.

- [ ] **Step 4: Run** the glance gates, including the existing `mrdashboard-status`, `mrdashboard-transitional` and `mrdashboard-batch` tests unchanged. Expected: PASS.

- [ ] **Step 5: Commit** `glance: derive dashboard readiness from the neutral field`.

### Task 4: The fill query and node types

**Files:**
- Create: `packages/glance/src/githubFill.ts`
- Test: `packages/glance/tests/gh-fill-query.test.ts`
- Create: `packages/glance/tests/helpers/gh-fill-fixture.ts`

**Interfaces:**
- Produces (githubFill.ts):
  - `export const FILL_BATCH_SIZE = 25`
  - `export interface GHFillActor { __typename: 'User' | 'Bot' | 'Mannequin' | 'Organization' | 'EnterpriseUserAccount'; login: string; avatarUrl: string | null; databaseId?: number | null; name?: string | null }`
  - `export type GHFillContext = ({ __typename: 'CheckRun'; databaseId: number; name: string; status: string; conclusion: string | null; startedAt: string | null; completedAt: string | null; detailsUrl: string | null; isRequired: boolean; checkSuite: { workflowRun: { databaseId: number; runNumber: number; workflow: { name: string } } | null } | null } | { __typename: 'StatusContext'; context: string; state: string; targetUrl: string | null; createdAt: string; isRequired: boolean })`
  - `export interface GHFillNode` with every field of the spec section 1 fragment, author fields typed `GHFillActor | null`, and `commits.nodes[0].commit.statusCheckRollup: { state: string; contexts: { totalCount: number; pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: GHFillContext[] } } | null`.
  - `export function buildFillQuery(owner: string, repo: string, numbers: number[], opts: { listWeight: boolean }): string`, aliasing each PR as `p<number>` with `isRequired(pullRequestNumber: <number>)` inline; `listWeight` omits `body` only.
  - `export function buildContextsPageQuery(owner: string, repo: string, number: number, after: string): string` (alias `p<number>`, `contexts(first: 100, after: "<after>")`).
  - `export function parseFillAliases(query: string): number[]` (used by the test fixture).
- Produces (fixture): `ghNode(over?: DeepPartial<GHFillNode>): GHFillNode` defaulting to an open, non-draft PR #1 with `mergeStateStatus: 'CLEAN'`, `reviewDecision: 'APPROVED'`, one approving user review, one required successful check run with a workflow run id; and `stubForge(handlers: { fill?: (numbers: number[], query: string) => Record<number, GHFillNode | null>; rest?: (url: string) => Response | undefined }): { urls: string[] }`, installing a `globalThis.fetch` stub (pattern: `tests/gh-transport.test.ts:34-44`) that answers `POST .../graphql` by parsing aliases and REST by `rest`.

- [ ] **Step 1: Write the failing tests:**
  - `one alias per number, isRequired inlined`: `buildFillQuery('o', 'r', [7, 12], { listWeight: false })` contains `p7: pullRequest(number: 7)`, `p12: pullRequest(number: 12)`, `isRequired(pullRequestNumber: 7)` and `isRequired(pullRequestNumber: 12)`, and `parseFillAliases` of it returns `[7, 12]`.
  - `listWeight drops only body`: the `listWeight: true` query lacks the token ` body ` and still contains `statusCheckRollup`, `latestReviews`, `latestOpinionatedReviews`, `branchProtectionRule`.
  - `owner and repo are passed as string literals safely`: a repo name containing `"` is escaped (JSON string encoding).
  - `contexts page query`: contains `after: "CUR"` and `isRequired(pullRequestNumber: 5)`.

- [ ] **Step 2: Run** `bun test tests/gh-fill-query.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the module and the fixture. The fragment text is spec section 1 verbatim.

- [ ] **Step 4: Run** the glance gates. Expected: PASS.

- [ ] **Step 5: Commit** `glance: add the GitHub fill query`.

### Task 5: Reviewers and approvals mapping

**Files:**
- Modify: `packages/glance/src/githubFill.ts`
- Test: `packages/glance/tests/gh-fill-reviews.test.ts`

**Interfaces:**
- Consumes: `GHFillNode`, `GHFillActor`, `ghNode` (Task 4).
- Produces:
  - `export function toUserRefFromActor(actor: GHFillActor | null): UserRef`. A `Bot` gives `username: '<login>[bot]'`, `id: 'github:user:<databaseId>'`. `null` gives the ghost placeholder `{ id: 'github:user:ghost', username: 'ghost', name: 'Deleted user', avatarUrl: null }`.
  - `export interface ReviewSummary { reviewers: Reviewer[]; approvedBy: UserRef[]; approved: boolean; approvalsRequired: number | null; approvalsLeft: number }`
  - `export function mapReviews(node: GHFillNode, rulesRequired: number | null): ReviewSummary`, where `rulesRequired` is the rulesets count (Task 9 supplies it; `null` means none found or unreadable).

- [ ] **Step 1: Write the failing tests** (each a `ghNode` override):
  - `a reviewer stays listed after approving`: no review requests, one `APPROVED` in `latestReviews` gives `reviewers` with that user and `reviewState: 'APPROVED'`.
  - `comment-only reviewer is listed as REVIEWED`: a `COMMENTED` review in `latestReviews`, absent from `latestOpinionatedReviews`.
  - `a comment after an approval keeps the approval`: `latestOpinionatedReviews` has `APPROVED`, `latestReviews` has `COMMENTED` for the same user, gives `approvedBy` containing the user.
  - `re-requested reviewer reads UNREVIEWED`: user in both `reviewRequests` and `latestReviews`.
  - `two required, one approval`: `branchProtectionRule.requiredApprovingReviewCount: 2`, one approval, `REVIEW_REQUIRED` gives `approvalsRequired: 2`, `approvalsLeft: 1`, `approved: false`.
  - `rulesets beat a smaller classic count`: protection 1, `rulesRequired: 2` gives `approvalsRequired: 2`.
  - `no requirement reads approved, not awaiting`: `reviewDecision: null`, no protection, `rulesRequired: null` gives `approvalsRequired: 0`, `approved: true`, `approvalsLeft: 0`.
  - `requirement with unreadable count`: `REVIEW_REQUIRED`, protection null, `rulesRequired: null` gives `approvalsRequired: null`, `approvalsLeft: 0`, `approved: false`.
  - `team-only request`: `reviewRequests` holds only a `Team`, `REVIEW_REQUIRED` gives `reviewers: []`, `approved: false`, `approvalsRequired: null`.
  - `changes requested blocks`: `CHANGES_REQUESTED` gives `approved: false`, reviewer state `REQUESTED_CHANGES`.
  - `deleted and bot authors map without throwing`: a review with `author: null` and one with a `Bot` author map to the ghost placeholder and `coderabbitai[bot]`.

- [ ] **Step 2: Run** `bun test tests/gh-fill-reviews.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** per spec section 3.

- [ ] **Step 4: Run** the glance gates. Expected: PASS.

- [ ] **Step 5: Commit** `glance: map GitHub reviewers and approvals from the fill`.

### Task 6: CI mapping and GitHub readiness

**Files:**
- Modify: `packages/glance/src/githubFill.ts`
- Modify: `packages/glance/src/types.ts` (`PipelineJob.runId?: string | null`, `Pipeline.runIds?: string[]`)
- Test: `packages/glance/tests/gh-fill-ci.test.ts`, `packages/glance/tests/gh-fill-readiness.test.ts`

**Interfaces:**
- Consumes: Task 4 types, `ReviewSummary` (Task 5).
- Produces:
  - `export function mapPipeline(contexts: GHFillContext[], prUrl: string, headRef: string, headSha: string | null): Pipeline | null` (`null` when `contexts` is empty).
  - `export function githubReadiness(input: { state: MRState; isDraft: boolean; mergeStateStatus: string; reviewDecision: string | null; pipeline: Pipeline | null; unresolvedThreadCount: number | null; contextsComplete: boolean }): Readiness`.

- [ ] **Step 1: Write the failing CI tests:**
  - `required failure fails the pipeline`: one required `FAILURE` check run gives `status: 'failed'`, the job `allowFailure: false`.
  - `optional failure is a warning, not a failure`: one optional `FAILURE` plus one required `SUCCESS` gives `status: 'success'`, the failing job `allowFailure: true`.
  - `no required contexts: every check counts`: all `isRequired: false`, one `FAILURE`, gives `status: 'failed'`.
  - `commit statuses count`: a `StatusContext` with `state: 'FAILURE'`, required, gives `status: 'failed'` and a job with id `github:status:<context>`.
  - `canceled reads canceled, not pending`: one required `CANCELLED` and the rest `SUCCESS` gives `status: 'canceled'`.
  - `explicit job mappings`: `STALE` and `STARTUP_FAILURE` give job `failed`, `ACTION_REQUIRED` gives `manual`, `QUEUED`/`WAITING`/`REQUESTED`/`PENDING` give `pending`.
  - `ids are real`: a check run job id is `github:check:<databaseId>` with `runId: '<workflowRun.databaseId>'`; `Pipeline.runIds` lists each distinct run once; `Pipeline.id` is `github:run:<id>` of the run holding the first failed required job, else of the highest run id; `numericPipelineId`-style parsing of `Pipeline.id` (tail after the last `:`) gives that number.
- [ ] **Step 2: Write the failing readiness tests**, one per row of the spec section 2 GitHub table, plus:
  - `BLOCKED names every cause`: `BLOCKED`, `REVIEW_REQUIRED`, a required failing check and 2 unresolved threads give `reasons` `['checks-failing', 'approvals', 'threads']` (order as in `ReadinessReason`).
  - `BLOCKED with no visible cause reads other`.
  - `merged ignores UNKNOWN`: `state: 'merged'`, `UNKNOWN` gives `state: 'merged'`.
  - `incomplete contexts read checking`: `contextsComplete: false` with `CLEAN` gives `state: 'checking'`.
- [ ] **Step 3: Run** both files. Expected: FAIL.
- [ ] **Step 4: Implement** per spec sections 2 and 4.
- [ ] **Step 5: Run** the glance gates. Expected: PASS.
- [ ] **Step 6: Commit** `glance: map GitHub CI and readiness from the fill`.

### Task 7: Rate limits fail fast and read as rate limited

**Files:**
- Modify: `packages/glance/src/errors.ts` (`RateLimitedError`)
- Modify: `packages/glance/src/githubClient.ts` (~76-111)
- Modify: `packages/glance/src/GitHubProvider.ts` (REST read paths: convert a throttled `RequestError` through `toRateLimitedError`)
- Modify: `packages/glance/src/GitProvider.ts` (`FetchPullRequestsWarning.kind` adds `'rate-limited'`, optional `resetAt?: string`)
- Modify: `packages/glance/src/EventsWatcher.ts` (`classifyError`, `retryAfterMs`)
- Modify: `packages/glance/src/index.ts` (export `RateLimitedError`)
- Test: `packages/glance/tests/github-client.test.ts`, `packages/glance/tests/events-watcher-loop.test.ts`

**Interfaces:**
- Produces:
  - `export class RateLimitedError extends Error { readonly kind: 'primary' | 'secondary'; readonly resetAt: string | null; readonly retryAfterMs: number | null; readonly operation: string }`
  - `export const RATE_LIMIT_RETRY_DEADLINE_S = 30` and `export function toRateLimitedError(err: unknown, operation: string): RateLimitedError | null` in `githubClient.ts` (403 or 429 with `x-ratelimit-remaining: '0'` or a `retry-after` header; GraphQL `RATE_LIMITED` errors).

- [ ] **Step 1: Write the failing tests:**
  - `a primary limit past the deadline fails after one request`: stubbed 403 with `x-ratelimit-remaining: 0` and a reset an hour out; one fetch, the read throws `RateLimitedError` with `kind: 'primary'` and `resetAt` set.
  - `a short Retry-After is honoured and retried`: 429 with `retry-after: 1` then 200; two fetches, success (use `withInstantTimers`).
  - `a secondary limit past the deadline fails fast`: `retry-after: 120`; one fetch, `kind: 'secondary'`.
  - `the watcher reads Octokit's shape as rate-limited`: `classifyError` of a `RequestError` 403 with `x-ratelimit-remaining: '0'` and of a `RateLimitedError` both give `'rate-limited'`; `retryAfterMs` reads `err.response.headers['retry-after']` from a plain object and `err.retryAfterMs`.
  - `graphql() keeps MAT-133`: the existing `gh-transport.test.ts` swallow tests still pass unchanged.
- [ ] **Step 2: Run** the three files. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement** per spec section 5.
- [ ] **Step 4: Run** the glance gates. Expected: PASS.
- [ ] **Step 5: Commit** `glance: fail fast on GitHub rate limits and report them as such`.

### Task 8: The fill in GitHubProvider (known-number paths)

**Files:**
- Modify: `packages/glance/src/githubFill.ts` (`toPullRequestFromNode`)
- Modify: `packages/glance/src/GitHubProvider.ts` (new `graphqlRead`, `fillPullRequests`; `fetchSingleMR`, `fetchPullRequests({ iids })`, `fetchPullRequestsByBranches`, `fetchPullRequestByBranch`, `fetchSingleMRAfterMutation`)
- Modify: `packages/glance/src/GitProvider.ts` (`FetchPullRequestsWarning.source` adds `'fill' | 'contexts'`)
- Test: `packages/glance/tests/gh-fill-provider.test.ts`, `packages/glance/tests/gh-fill-cost.test.ts`
- Modify (migrate to the fixture): `tests/github-batch-by-branches.test.ts`, `tests/gh-by-branch.test.ts`, `tests/gh-refetch-warning.test.ts`, `tests/pipeline-sha.test.ts`, `tests/pr-merged-at.test.ts`, `tests/reviewers-assignees.test.ts` (the parts that exercise these paths)

**Interfaces:**
- Consumes: Tasks 4 to 7.
- Produces:
  - `export function toPullRequestFromNode(node: GHFillNode, ctx: { roles: string[]; contexts: GHFillContext[]; contextsComplete: boolean; rulesRequired: number | null }): PullRequest`, filling every `PullRequest` field (spec section 1, including `readiness`, `conflicts: mergeStateStatus === 'DIRTY' || mergeable === 'CONFLICTING'`, `shouldBeRebased: mergeStateStatus === 'BEHIND'`, `isStacked`, `diffStats`, auto-merge fields, `unresolvedThreadCount` null past 100 threads).
  - `private async graphqlRead<T>(op: string, query: string): Promise<{ data: T | null; errors: string[] }>`: throws `RateLimitedError` (via `toRateLimitedError`, Task 7) and any transport error; never returns null for a failure that carried no data, it throws.
  - `private async fillPullRequests(projectPath: string, numbers: number[], opts: { listWeight: boolean; roles: Map<number, string[]>; onWarning?: FetchPullRequestsOptions['onWarning'] }): Promise<Map<number, PullRequest | null>>`, batching by `FILL_BATCH_SIZE`, fetching a contexts page per PR whose `hasNextPage` is true.

- [ ] **Step 1: Write the failing provider tests** (`gh-fill-provider.test.ts`, using `stubForge`):
  - `fetchSingleMR returns the mapped PR`: values for `readiness`, `reviewers`, `pipeline.id`, `approvalsRequired` match the node.
  - `fetchSingleMR returns null with a fill warning when the fill fails`: GraphQL answers HTTP 502; result `null`, one warning `{ kind: 'request-failed', source: 'fill', target: 'o/r#1' }`.
  - `a null alias is a missing PR`: `fetchSingleMR` returns `null` with no warning; `fetchPullRequests({ iids: [1, 2] })` with alias 2 null returns only PR 1 and no warning.
  - `partial GraphQL response keeps resolved PRs`: data for 1, an error for 2; result has PR 1, one warning for `o/r#2`.
  - `150 contexts fetch one more page`: first page `hasNextPage: true`; the contexts page returns a failing required check; `pipeline.status === 'failed'`.
  - `failed contexts page reads checking`: the contexts page answers 502; `pipeline.status === 'pending'`, `readiness.state === 'checking'`, one warning with source `contexts`.
  - `byBranches resolves through the fill, not fetchSingleMR`: 3 branches, 2 hits; result map has 2 entries with full fields.
  - `byBranch keeps the REST head filter`: the REST `pulls?head=` URL is requested once, then one fill for the found number.
  - `a rate-limited fill throws, not a short list`: `fetchPullRequests({ iids: [1..30] })` where the second fill batch is rate limited throws `RateLimitedError` (Review Focus 5).
  - `fetchSingleMRAfterMutation keeps its message`: a failed fill after a merge produces today's `ReadBackFailedError` message shape.
- [ ] **Step 2: Write the failing cost tests** (`gh-fill-cost.test.ts`), counting `onRequest` calls with a real provider over `stubForge` (rulesets REST answered `[]`):
  - `fetchSingleMR: 1 GraphQL + 1 rulesets REST on a cold cache` (Task 9 adds the rulesets call; until then assert 1 GraphQL, and Task 9 updates this test).
  - `iids x20: 1 GraphQL`.
  - `byBranches x20: 2 GraphQL`.
  - `byBranch: 1 REST + 1 GraphQL`.
  - `150 contexts: 2 GraphQL`.
- [ ] **Step 3: Run** both files. Expected: FAIL.
- [ ] **Step 4: Implement**, then migrate the listed existing tests to `stubForge`, keeping each test's intent (what it pins) and changing only how responses are served. Delete assertions that pin the removed REST calls (detail GET, reviews paginate, check-runs) and say so in the commit body.
- [ ] **Step 5: Run** the glance gates. Expected: PASS.
- [ ] **Step 6: Commit** `glance: read known GitHub PRs through one batched GraphQL fill`.

### Task 9: Required count from rulesets, cached

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts` (new `requiredFromRules`; pass into `fillPullRequests`)
- Test: `packages/glance/tests/gh-required-approvals.test.ts`, `packages/glance/tests/gh-fill-cost.test.ts`

**Interfaces:**
- Produces: `private async requiredFromRules(projectPath: string, branch: string): Promise<number | null>`, `GET /repos/{o}/{r}/rules/branches/{branch}`, largest `parameters.required_approving_review_count` among `type: 'pull_request'` rules, `null` when none. Cache: `Map` per provider keyed `projectPath#branch`, `RULES_CACHE_MS = 600_000`. A 403 or 404 caches `null`; a transport failure or 5xx is not cached and yields `null` for this read. A rate limit rethrows `RateLimitedError`.

- [ ] **Step 1: Write the failing tests:**
  - `largest pull_request rule wins`: rules `[{type:'pull_request', parameters:{required_approving_review_count:1}}, {type:'pull_request', parameters:{required_approving_review_count:3}}, {type:'deletion'}]` gives `3`.
  - `no rules gives null`.
  - `cached for 10 minutes per repo and branch`: two `fetchSingleMR` calls on the same base branch make 1 rules request; a different base branch makes another; advancing a fake clock past 600000 ms makes another.
  - `a 5xx is not cached`.
  - Cost: `fetchSingleMR` on a cold cache is 1 GraphQL + 1 REST; warm, 1 GraphQL.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement**, fetching rules once per distinct `(projectPath, baseRefName)` in a fill batch, after the fill returns.
- [ ] **Step 4: Run** the glance gates. Expected: PASS.
- [ ] **Step 5: Commit** `glance: read GitHub's required approvals from rulesets`.

### Task 10: List and search paths, my reviews, retry and re-request

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts` (`fetchPullRequests` project, `authorUsernames` and involvement modes through `fillPullRequests`; remove `enrich`, `fetchReviews`, `fetchCheckRuns`, `fetchUnresolvedThreadCounts`, the REST `toPullRequest` and their types once unused; `retryPipeline`; `requestReReview`)
- Test: `packages/glance/tests/gh-fill-provider.test.ts`, `packages/glance/tests/gh-fill-cost.test.ts`, `packages/glance/tests/gh-ci.test.ts`
- Modify (migrate): `tests/gh-fetch-prs.test.ts`, `tests/gh-transport.test.ts` (the reviews pagination block becomes a fill-shaped equivalent), `tests/gh-review-threads.test.ts`, `tests/fetch-contract.test.ts`, `tests/mrdashboard-batch.test.ts` (GitHub parts)

**Interfaces:**
- Consumes: Tasks 7 to 9.
- Produces: no new public names. The involvement search gains `reviewed-by:@me` with role `'reviewer'`.

- [ ] **Step 1: Write the failing tests:**
  - `project list: 1 REST page + 1 GraphQL for 20 PRs, at either weight` (cost file).
  - `exclusion, page caps and updatedAfter unchanged`: the existing `gh-fetch-prs` cases for `excludeTargetBranches`, the page-cap warning and the early stop still pass after migration.
  - `a PR I reviewed stays in my list`: the involvement search for `reviewed-by:@me` returns PR 9 (no longer review-requested); the result includes PR 9 with `roles` containing `'reviewer'`.
  - `listWeight keeps CI`: a project read at `listWeight: true` has a non-null `pipeline` and `description: null`.
  - `retryPipeline reruns failed jobs`: `retryPipeline('o/r', 42)` posts to `/repos/o/r/actions/runs/42/rerun-failed-jobs`.
  - `requestReReview reaches past reviewers`: with no usernames, a PR whose only reviewer has already approved (no pending request) re-requests that user.
  - `requestReReview with nobody to ask still throws` (existing message).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** and migrate the listed tests as in Task 7, step 4.
- [ ] **Step 4: Run** the glance gates, then `bun run build` in `packages/glance`. Expected: PASS; `rg -n "fetchCheckRuns|fetchReviews|fetchUnresolvedThreadCounts" packages/glance/src` prints nothing.
- [ ] **Step 5: Commit** `glance: read every GitHub PR list through the fill`.

### Task 11: Notifier and the approval label

**Files:**
- Modify: `lib/notifier.ts` (~300-360: `isReadyForNotification`, `shouldRearmReady`, `shouldRearmConflicts`; `BranchSnapshot` gains `readinessState: ReadinessState | null`)
- Test: `lib/__tests__/notifier.test.ts`
- Create: `packages/glance-react/lib/components/forge/approval-label.ts`
- Modify: `packages/glance-react/lib/components/forge/ReviewerStatus.tsx:25`, `MRRow.tsx:167,185`
- Test: `packages/glance-react/lib/components/forge/approval-label.test.ts`
- Modify: `packages/glance-react/lib/stories/MRRow.stories.tsx` (add "GitHub, review required, count unknown" and "GitHub, 1 of 2" stories)

**Interfaces:**
- Consumes: `MRDashboardProps.readiness` (Task 3), `reviews.required: number | null` (Task 2).
- Produces: `export function approvalLabel(reviews: MRDashboardProps['reviews']): string`.

- [ ] **Step 1: Write the failing notifier tests:**
  - `GitHub ready notifies`: `readiness.state: 'ready'`, `statusDetail: ''`, approvals satisfied, not stacked gives a ready notification on the false to true edge.
  - `GitHub checking does not notify and does not re-arm`: a was-ready entry going to `checking` keeps the fired key.
  - `GitLab unchanged`: the existing `statusDetail === 'mergeable'` cases pass with `readiness` present and with it absent.
  - `absent readiness falls back` (Review Focus 3): an entry with no `readiness` uses the old `statusDetail` rule.
- [ ] **Step 2: Write the failing label tests:** `required null and not approved gives "Review required"`; `required null and approved gives "Approved"`; `1 of 2 gives "1/2 approvals, 1 remaining"` (today's exact string, moved unchanged); `GitLab counts unchanged` for the existing shapes.
- [ ] **Step 3: Run** `bun test lib/__tests__/notifier.test.ts` from the repo root and `bun run test` in `packages/glance-react`. Expected: FAIL.
- [ ] **Step 4: Implement.** Notifier readiness: `entry.mr.readiness ? entry.mr.readiness.state === 'ready' : entry.mr.statusDetail === 'mergeable'`, keeping the approvals and stacked guards; both re-arm helpers treat `readinessState === 'checking'` like a transitional `statusDetail`. Components call `approvalLabel` and draw no "x/y" when `required` is null.
- [ ] **Step 5: Run** the gates for rt (targeted notifier tests), glance-react (`test`, `lint`, `check-types`), then render the two new stories in Storybook through Fast Browser in light and dark, screenshot both, and say plainly what looks wrong.
- [ ] **Step 6: Commit** `notifier, glance-react: read the neutral readiness and an unknown approval count`.

### Task 12: Live values, gitq check, docs and release prep

**Files:**
- Modify: `packages/glance/tests/live/consumerFlows.ts` (~1290-1320 U9, ~564-640 U10)
- Test: `apps/gitq/src/core/__tests__/` (the existing forge-sync test file; add a GitHub-shaped case)
- Modify: `packages/glance/AGENTS.md` (the "gitq today pins glance by version" sentence), `packages/glance/README.md` (readiness, `approvalsRequired` nullable, `RateLimitedError`), `packages/glance/CHANGELOG.md` (Unreleased: Minor Changes and the typed break), `packages/glance/package.json` (`0.28.0`)

- [ ] **Step 1: Write the gitq test:** a GitHub-shaped PR with one optional failing check and one required success gives node `pipelineStatus` equal to `normalizePipelineStatus('success')`; one with a required canceled check gives `normalizePipelineStatus('canceled')`.
- [ ] **Step 2: Run** it. Expected: PASS without gitq source changes (it is a verification task); if it fails, stop and report rather than adapting gitq.
- [ ] **Step 3: Replace U9's and U10's shape checks with values:** U9: the green approved open PR reads `isReady: true` and `readiness.state` in `['ready', 'checking']` (retry the read until not `checking`, bounded by the harness's existing settle helper), the draft reads `readiness.state: 'draft'`. U10: the assigned reviewer appears in `reviews.reviewers` after approving, with `reviewState: 'APPROVED'`.
- [ ] **Step 4: Run the live suite once** with `GLANCE_LIVE=1` against glance-conformance per `packages/glance/AGENTS.md`, and record the readiness values observed (including whether `UNKNOWN` was seen) in the commit body.
- [ ] **Step 5: Update the docs and changelog, bump to `0.28.0`, run** the glance gates and `bun run build`.
- [ ] **Step 6: Commit** `glance: live value checks, docs and 0.28.0 for the GitHub read model`.
