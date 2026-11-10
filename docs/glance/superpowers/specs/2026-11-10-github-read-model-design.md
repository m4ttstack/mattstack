# GitHub read model: readiness, reviews, CI and cost

Covers GLANCE-41, GLANCE-42, GLANCE-43 and GLANCE-46 (project P-RT-28, GitHub
parity, phase 2). One design, because one GraphQL fragment feeds all four.

## Intent

A team on GitHub gets the same mattstack as a team on GitLab. Today glance's
GitHub read fills the decision fields with placeholders, so every open PR
reads as blocked, approvals and reviewers are wrong, CI misses failures, and
each PR costs four or five requests. Every consumer above glance (the
notifier, enrich, the daemon's branch cache and project sync, gitq, the shared
components, and later the board and the MCP tools) reads these fields as
facts. After this work they can trust them on GitHub without a GitHub
special case.

The daemon is the main reader. Once the forge router (RT-540) builds GitHub
providers, the branch refresh (`lib/daemon/cache-refresh.ts`, `lib/enrich.ts`),
branch freshness (`lib/daemon/freshness.ts`) and project sync
(`lib/daemon/project-sync.ts`, which fills the store the board reads) all land
in the code this design replaces. On GitLab, keeping those loops cheap and
current took several rounds of iteration, so cost is a first-class
requirement here, not a side effect.

## Goals

- A green, approved GitHub PR reads as ready; each blocking cause is named.
- Reviewers, approvals and the review verdict are real on GitHub.
- CI reflects every check run and commit status, with required-ness, and
  retry works from ids the SDK returned.
- GitHub reads cost one GraphQL request per batch where the PR numbers are
  known, and a rate limit fails fast as "rate limited".
- GitLab behaviour does not change.

## Non-goals

- Comment, reply and review writes (GLANCE-48). Decided separately: they go
  on `GitProvider` as forge-neutral methods, in their own spec.
- The daemon forge router (RT-540) and which daemon loops run on GitHub.
- The board's use of the new fields (board phase).
- Moving search and list discovery to GraphQL (approach B below). Possible
  later, on top of this.
- GitHub Enterprise onboarding (RT-550). Nothing here may assume github.com
  in a way that blocks it: the GraphQL endpoint already follows the
  client's `baseUrl`.

## Anti-goals

- A placeholder presented as a measurement. Unknown stays `null` or
  `checking`; it never becomes a default number or "blocked".
- GitHub faking GitLab's `detailedMergeStatus` vocabulary.
- A cost regression no test can see.
- Changing what an existing field means for GitLab readers.

## Measured cost (2026-11-10)

Read-only runs with glance's `onRequest` hook. GitHub: m4ttstack/mattstack,
the 20 most recent merged PRs, 21 checks each. GitLab:
m4tthew-dev/glance-test-repo.

| Pattern | GitLab today | GitHub today | GitHub, this design |
|---|---|---|---|
| Single PR (`fetchSingleMR`) | 2 calls, 0.5s | 5 calls (4 REST + 1 GraphQL), 2.1s | 1 GraphQL, 1 point, 0.7s |
| 20 branches (`fetchPullRequestsByBranches`) | 1 call, 4s | 81 calls, 21s | 2 GraphQL (find + fill), ~2 points, ~4s |
| ~20 PRs, project list at list weight | 1 call, 1.8s | 22 calls, 2.5s | 1 REST list page + 1 GraphQL fill |
| ~20 PRs, project list full weight | n/a | 42 calls, 3.8s | same as above |

The fill query (fragment below) for 20 PRs by number cost 1 GraphQL point
and took about 4s. GitHub's GraphQL budget (5,000 points an hour) is
separate from REST (5,000 requests an hour, shared with every `gh` call on
the token).

Side finding, out of scope: GitLab `fetchPullRequests({ iids })` at full
weight with 20 iids failed with "Query has complexity of 739, which exceeds
max complexity of 250". The daemon's sync paths do not call it.

## Approaches

- **A. REST discovery, GraphQL fill (chosen).** Search and list stay REST
  and yield PR numbers and roles. Every PR's data comes from one batched
  GraphQL fill. Paths that already know numbers (single, by-branch, iids)
  become GraphQL only.
- **B. GraphQL everywhere.** Search and list also move to GraphQL. One data
  shape, one fewer REST page per delta, and it avoids REST search's 30
  searches a minute. Rejected for now: same daemon cost, and it re-derives
  discovery rules that are not broken (the 0.26 `excludeTargetBranches`
  modes, page-cap warnings, the `updatedAfter` early stop the delta relies
  on, the role merge) in the same change as the fill. B is A plus a
  discovery swap, so it stays open.
- **C. Keep REST, patch gaps.** Smallest change; still 3+ calls per PR, so it
  fails the cost goal. Rejected.

Matt picked A on 2026-11-10 after the measurements.

## Design

### 1. The fill

One private method, `fillPullRequests(projectPath, numbers, onWarning)`,
returns `Map<number, PullRequest | null>`. It sends aliased
`repository { p<n>: pullRequest(number: <n>) { ...fields } }` queries,
batched so one request stays well under GitHub's node limit (start at 25 PRs
per request; the builder tunes from measured cost). It replaces the per-PR
detail GET, `fetchReviews`, `fetchCheckRuns` and
`fetchUnresolvedThreadCounts` on every read path.

The field set, as measured:

```graphql
id databaseId number title body state isDraft url createdAt updatedAt mergedAt
mergeable mergeStateStatus reviewDecision additions deletions changedFiles
headRefName headRefOid baseRefName
baseRepository { databaseId nameWithOwner defaultBranchRef { name } }
baseRef { branchProtectionRule { requiredApprovingReviewCount } }
author { __typename login avatarUrl ... on User { databaseId name } ... on Bot { databaseId } }
assignees(first: 20) { nodes { login databaseId name avatarUrl } }
reviewRequests(first: 20) { nodes { requestedReviewer {
  ... on User { login databaseId name avatarUrl } ... on Team { slug } } } }
latestReviews(first: 50) { nodes { state submittedAt
  author { __typename login avatarUrl ... on User { databaseId name } ... on Bot { databaseId } } } }
latestOpinionatedReviews(first: 50) { nodes { state submittedAt
  author { __typename login avatarUrl ... on User { databaseId name } ... on Bot { databaseId } } } }
reviewThreads(first: 100) { totalCount nodes { isResolved } }
autoMergeRequest { mergeMethod enabledBy { login } }
commits(last: 1) { nodes { commit { oid statusCheckRollup { state
  contexts(first: 100) { totalCount pageInfo { hasNextPage endCursor }
    nodes { __typename
      ... on CheckRun { databaseId name status conclusion startedAt completedAt
        detailsUrl isRequired(pullRequestNumber: <n>)
        checkSuite { workflowRun { databaseId runNumber workflow { name } } } }
      ... on StatusContext { context state targetUrl createdAt
        isRequired(pullRequestNumber: <n>) } } } } } } }
```

`isRequired` needs the PR number inline, which is why the fill aliases each
PR by number rather than using `nodes(ids:)` or a connection.

Verified on m4ttstack/mattstack#1074 (2026-11-10): `latestOpinionatedReviews`
omits comment-only reviews (a CodeRabbit `COMMENTED` review appears only in
`latestReviews`), and GraphQL reports a bot's login without the `[bot]`
suffix REST adds (`coderabbitai` vs `coderabbitai[bot]`). So reviewer state
comes from `latestReviews`, `approvedBy` from `latestOpinionatedReviews`, and
a `Bot` author's `username` is rebuilt as `<login>[bot]` with its
`databaseId`, so `id` and `username` match what REST gave consumers before
(the `authorUsernames` search, project sync's `scopeAuthors`, the board's
`filterByMember`).

Read paths after the change:

| Method | Discovery | Fill |
|---|---|---|
| `fetchSingleMR` | none | 1 PR |
| `fetchPullRequests({ iids })` | none | the iids |
| `fetchPullRequestsByBranches` | existing GraphQL branch query, unchanged | the PRs found |
| `fetchPullRequestByBranch` | existing REST head filter and fork scan, unchanged | the PR found |
| `fetchPullRequests({ projectPath })`, `authorUsernames`, involvement | existing REST list or search, unchanged | the PRs found |

`fetchPullRequestByBranch` keeps its REST discovery (1 REST + 1 GraphQL),
because its fork scan and ordering are pinned behaviour (U2) and approach A
leaves discovery alone.

`listWeight` keeps the full rollup on GitHub. GitLab's list weight keeps
`headPipeline { id status }` and drops only the jobs trees, because those
time out GitLab's resolvers; on GitHub the full fragment measured the same
1 point, and the daemon's project sync reads at list weight
(`project-sync.ts:187,237`), so dropping checks there would leave the
board's store with `pipeline: null` and unnamed blockers. On GitHub
`listWeight` drops only `body` (my call).

Failure rules, replacing today's per-call rules:

- The whole fill request failing (HTTP, transport, rate limit, GraphQL
  errors with no data): the single-PR paths keep today's contract and return
  `null` with an `onWarning` (`GitProvider.ts:343-347`; the daemon's
  `freshness.ts:647` relies on it), and `fetchSingleMRAfterMutation` keeps
  building its message from that warning. The list paths report every
  affected PR through `onWarning` and leave it out. A PR is never returned
  with fields from a failed read. A rate limit is the one exception that
  throws (`RateLimitedError`, section 5), on every path, so a caller can back
  off instead of writing nulls into a cache.
- One alias coming back null (PR deleted or not visible) drops that PR; a
  list path does not warn for it, matching today's 404 rule.
- A partial GraphQL response (data plus `errors`) keeps the PRs whose
  aliases resolved and warns for the rest.
- `reviewThreads` past 100 or `contexts` past 100: threads report
  `unresolvedThreadCount: null` as today; contexts trigger a follow-up page
  for that PR only (`commit.statusCheckRollup.contexts(after:)`), so a
  failure on check 101 is never missed.
- A null `author` (deleted account, "ghost") maps to a placeholder
  `UserRef` and never throws. Same for review authors and reviewers.

The read path needs a GraphQL call that does not swallow failures. Today
`graphql()` returns null on any failure by design (MAT-133), and
`graphqlOrThrow()` serves the mutations and two reads
(`GitHubProvider.ts:1354`, `:2763`) but discards partial data. The fill uses
a third, read-side variant that returns partial data with its errors and
throws a typed error on a rate limit (section 5).

### 2. Readiness (GLANCE-41)

New field on `PullRequest`, filled by both providers:

```ts
export type ReadinessState = 'ready' | 'blocked' | 'checking' | 'draft' | 'merged' | 'closed';
export type ReadinessReason =
  | 'conflicts' | 'behind' | 'checks-failing' | 'checks-running'
  | 'approvals' | 'changes-requested' | 'threads' | 'merge-error' | 'other';
export interface Readiness { state: ReadinessState; reasons: ReadinessReason[] }

interface PullRequest {
  // ...existing fields unchanged...
  /** Forge-neutral merge readiness. Absent on PRs built by SDKs before this release. */
  readiness?: Readiness;
}
```

Optional on the type because the daemon's project store holds PRs as JSON
(`lib/daemon/project-mrs-store.ts`), and rows written by an older SDK lack it
until the next sync rewrites them (delta within 5 minutes for changed PRs,
deep within 24 hours). Every consumer treats an absent `readiness` as
"unknown": fall back to today's logic, never to "blocked".

`reasons` is empty when `state` is `ready`, `draft`, `merged` or `closed`,
and lists every known blocker when `blocked`. `checking` means the forge has
not decided yet.

**GitHub mapping** (`mergeStateStatus`, with the verdict and rollup naming
the cause):

| `mergeStateStatus` | `state` | reasons |
|---|---|---|
| `CLEAN`, `HAS_HOOKS` | `ready` | |
| `UNSTABLE` | `ready` | (failing checks are not required; GitHub allows the merge) |
| `DIRTY` | `blocked` | `conflicts` |
| `BEHIND` | `blocked` | `behind` |
| `DRAFT` | `draft` | |
| `BLOCKED` | `blocked` | from the data: `changes-requested` if `reviewDecision` is `CHANGES_REQUESTED`; `approvals` if `REVIEW_REQUIRED`; `checks-failing` / `checks-running` from required contexts; `threads` if unresolved threads > 0; `other` if none of these explain it |
| `UNKNOWN` | `checking` | |

Merged and closed PRs take `merged` / `closed` from `state` regardless of
`mergeStateStatus` (merged PRs report `UNKNOWN`, measured).

**GitLab mapping**, from the existing signals and nothing new fetched:
`detailedMergeStatus === 'mergeable'` is `ready`; a transitional status
(`TRANSITIONAL_MERGE_STATUSES`) is `checking`; anything else is `blocked`
with reasons from the blockers `getMRDashboardProps` already computes
(conflicts, `shouldBeRebased` as `behind`, pipeline, approvals, the 0.27.0
discussions rule, merge error), and `other` when none apply.

**Consumers moved in this work:**

- `getMRDashboardProps` (`MRDashboard.ts`): keeps today's optimistic rule,
  fed by readiness instead of the GitLab string.
  `isCheckingMergeability` is `readiness.state === 'checking'`, and `isReady`
  is `readiness.state === 'ready' || (checking && !draft && !conflicts &&
  !pipelineFailing)` for an open PR, so GitLab output does not change and
  the "false BLOCKED flash" guard now covers GitHub's `UNKNOWN` too. Draft,
  merged and closed keep the legacy `isReady` / `isCheckingMergeability`
  reading (`MRDashboard.ts`), which is what GitLab output needs. `MRStatus`
  gets no new member: `status` stays `mergeable` / `blocked` / `draft` /
  `merged` / `closed`, derived from that `isReady`. When `readiness` is
  absent, today's derivation runs unchanged. New prop `readiness` passes the
  field through for consumers that want the settled state. `statusDetail`
  keeps the raw GitLab value.
- `lib/notifier.ts`: `isReadyForNotification` uses settled readiness
  (`readiness.state === 'ready'`) instead of `statusDetail === 'mergeable'`,
  keeping its approvals and stacked guards; `shouldRearmReady` and
  `shouldRearmConflicts` treat `checking` as transitional, so the
  anti-flap behaviour holds on both forges.
- `packages/glance-react` `MRStatusBadge` and `MRActions`: read `status` and
  `isReady`, so they follow automatically; the GitLab tooltip stays.
- gitq links glance as `workspace:*` (`apps/gitq/package.json:22`) and the
  bundled gitq CLI builds from the tree, so it sees these changes in the
  next bundle (`packages/glance/AGENTS.md` still says gitq pins by version;
  correct that line in this work). Only its CI readers
  (`forge-sync.ts:273,332`, `data.ts:199`) see a behaviour change (section
  4). They get a verification task with GitHub-shaped fixtures, not an
  adaptation; moving gitq to `readiness` is a follow-up.

### 3. Reviewers and approvals (GLANCE-42)

- **Reviewers** are requested reviewers plus every author in
  `latestReviews` (comment-only reviews included), deduped by user. State: `APPROVED` maps to
  `APPROVED`, `CHANGES_REQUESTED` to `REQUESTED_CHANGES`, `COMMENTED` to
  `REVIEWED`, and still-requested users with no review to `UNREVIEWED`. A
  re-requested user who had reviewed shows `UNREVIEWED` (GitHub's request is
  newer). Team review requests: kept off `reviewers` (which are users) and
  noted for the board phase.
- **Approved** follows the verdict: `approved` is true unless
  `reviewDecision` is `REVIEW_REQUIRED` or `CHANGES_REQUESTED`. A repo with
  no review requirement reports `reviewDecision: null`, which reads as
  approved, so it never shows as awaiting approval (matching GitLab's
  no-rules behaviour). `genuinelyApproved` (`MRDashboard.ts:151`) widens its
  test from `approvalsRequired === 0` to "required is 0 or null", so a PR
  nobody approved never reads `isApproved` on GitHub.
- **`approvedBy`** comes from `latestOpinionatedReviews`, so a comment after
  an approval keeps it.
- **Required count** (decided 2026-11-10): `approvalsRequired` becomes
  `number | null`. Sources, in order, taking the larger when both answer:
  - `baseRef.branchProtectionRule.requiredApprovingReviewCount`, read in the
    fill at no extra request. Null when the repo has no classic protection
    on that branch or the token cannot see it.
  - The branch's rulesets (`GET /repos/{o}/{r}/rules/branches/{branch}`,
    readable with read access; it does not include classic protection), the
    largest `required_approving_review_count` among `pull_request` rules.
    Cached per provider, per repo and target branch, for 10 minutes (my
    call). The lookup runs only for an open PR with a non-null
    `reviewDecision`, and its GET is sent once, without retries.
  - When both are unreadable or empty: `null` if `reviewDecision` is
    `REVIEW_REQUIRED` or `CHANGES_REQUESTED` (a requirement exists, count
    unknown), `0` if `reviewDecision` is null (GitHub's own "no review
    required", visible without admin).

  `approvalsLeft` stays a number: `max(0, required - approvals)` when known,
  and 0 when unknown, with the verdict carrying "still needs review". The
  shared components build their total from `given + remaining`
  (`MRRow.tsx:167,185`, `ReviewerStatus.tsx:25`), so they change to show the
  verdict alone ("Review required", "Approved") when `reviews.required` is
  null; otherwise an unknown count would draw a made-up "1/2". GitLab always
  reports a number, so its display does not change. Dashboard
  `reviews.required` becomes `number | null`.
- **Board typecheck**: the board reads `reviews.required` as a number
  (`apps/board/src/view.ts:430`, `client/board/row-status.ts:961`). Widening
  the type forces a type-only change there: treat null as "count unknown"
  and draw no slots. The board serves GitLab teams today, whose count is
  never null, so nothing visible changes; the board's real GitHub work stays
  in the board phase.
- **My review list**: the involvement search adds `reviewed-by:@me` with
  role `reviewer`, so a PR leaves "my reviews" only on merge or close, not on
  reviewing.
- **`requestReReview`** with no usernames re-requests everyone in the new
  `reviewers` list (past reviewers included), not only pending requests.

### 4. CI (GLANCE-43)

- `pipeline` is built from the rollup: one job per `CheckRun` and per
  `StatusContext`, all contexts (follow-up pages past 100).
- `allowFailure = !isRequired`. The pipeline is `failed` only when a
  required context failed; an optional failure sets the dashboard's
  `hasWarnings`. With no required contexts configured, every check counts
  (GitHub then lets any failure through, but the PR author still wants to
  see red; my call, matching today's behaviour on repos without
  protection).
- Job-level `cancelled` already maps to `canceled`
  (`GitHubProvider.ts:558`); the bug is the overall status, which falls
  through to `pending` (`:526-535`). The overall status becomes: `failed` if
  any counted job failed; else `canceled` if a counted job was canceled (a
  canceled required check blocks the merge, so readiness gives
  `checks-failing`); else `running` / `pending`; else `success`. `stale`,
  `startup_failure` and `action_required` get explicit job mappings
  (failed, failed, manual); only `queued`, `waiting`, `requested` and
  `pending` read as pending.
- Ids: a job from a check run is `github:check:<databaseId>`; a status
  context is `github:status:<context>`. Each job carries its workflow run
  id (new optional `PipelineJob.runId: string | null`).
- `Pipeline.id` is `github:run:<databaseId>` of the run to act on: the
  first run with a failed required job, else the most recent run. The board
  parses ids with `numericPipelineId` (tail after the last `:`), so this
  works there unchanged. New optional `Pipeline.runIds: string[]` lists every
  run on the head commit.
- `retryPipeline(projectPath, runId)` on GitHub calls
  `POST /actions/runs/{id}/rerun-failed-jobs` (GitLab's pipeline retry also
  retries failed jobs only). "Retry failed" across a PR is a loop over
  `runIds` whose jobs failed; consumers can do that from SDK data alone.
  Commit statuses from external CI have no retry, and say so in the error.

### 5. Rate limits (GLANCE-46)

- REST: `onRateLimit` and `onSecondaryRateLimit` in `githubClient.ts` retry
  only when `retryAfter` is within a deadline (30s, my call) and at most
  twice; otherwise the request fails at once with a typed
  `RateLimitedError` (`kind: 'primary' | 'secondary'`, `resetAt`,
  `retryAfterMs`). A poll can no longer hang until the hourly reset.
- GraphQL: the fill's read variant raises the same `RateLimitedError`
  instead of returning null. The existing `graphql()` keeps its MAT-133
  contract for its other callers.
- A rate limit throws `RateLimitedError` on every read path, list paths
  included, so a short list never reads as complete. The `rate-limited`
  warning kind stays in the union, unused.
- `EventsWatcher.classifyError` recognises Octokit's shape (`err.status`
  403 or 429 with `x-ratelimit-remaining: 0` or `retry-after`, and
  `RateLimitedError`) as `rate-limited`, and `retryAfterMs` reads Octokit's
  `err.response.headers` object as well as a `Headers` instance, so
  `Retry-After` is honoured on GitHub.

### 6. Cost tests

Request counts become a tested contract, through `onRequest` against
recorded responses (no live calls in the unit suite):

- `fetchSingleMR`: exactly 1 GraphQL request, plus 1 REST rulesets request
  when that repo and branch are not in the 10-minute cache.
- `fetchPullRequestByBranch`: 1 REST + 1 GraphQL (plus the rulesets rule).
- `fetchPullRequests({ iids })` with 20 numbers: 1 request.
- `fetchPullRequestsByBranches` with 20 branches: 2 requests.
- Project list of 20 PRs: 1 REST page + 1 GraphQL request, at either
  weight.
- A PR with 150 contexts: 2 requests (fill plus one contexts page).
- The required-count lookup: 1 request per repo and branch inside the cache
  window, 0 after.

The live suite (`GLANCE_LIVE=1`, glance-conformance) replaces U9's
`typeof isReady` and U10's display-set checks with value assertions: a
green, approved PR reads `ready`; a PR in GitHub's computing window reads
`checking`; conflicts, behind, failing required check and draft each give
their reason.

## Acceptance (from the tickets)

- A green, approved GitHub PR reads as ready to merge; conflicts, behind,
  failing checks and draft each give the right reason; a computing PR reads
  as checking. (41)
- Reviewers stay listed after reviewing, with their state; a comment after
  an approval keeps it; two required approvals shows 1 of 2 after one when
  the count is readable; no requirement does not read as awaiting approval;
  a PR I reviewed stays in my list; re-request reaches past reviewers; a
  deleted account does not fail the list. (42)
- A failure past the first 100 checks shows; commit statuses count; a
  canceled run does not read as pending; a failing optional check does not
  fail the PR; retry works from SDK data. (43)
- A 20-PR read stays at the request counts in section 6; a rate limit
  reports as rate limited within the deadline and honours `Retry-After`.
  (46)
- GitLab behaviour does not change; tests assert values for GitHub-shaped
  PRs, not shapes.

## Constraints

- `packages/glance` publishes to npm; in-repo consumers (gitq, rt-client,
  the board, the VS Code extension) link the workspace. Additive fields
  only, except `approvalsRequired` widening to `number | null`, which is a
  typed break: it needs a minor bump with a changelog entry
  (`packages/glance/docs/releasing.md`) and the in-repo readers updated in
  the same change.
- `packages/glance/dist/` must be rebuilt after source changes; rt-client,
  root typecheck and the VS Code extension resolve it.
- `bun test`, `check-types` and `check:node` clean before every commit in
  `packages/glance`; `test`, `lint`, `check-types` in `glance-react`.
- One live run per session, only against glance-conformance, never
  gitq-test-sandbox.
- No change to the daemon's sync cadence, coalescing or deep/delta rules.

## Left to the builder

- Batch size for the fill, from measured point cost.
- How the fill's query string is built, and whether the aliased branch
  query in `fetchPullRequestsByBranches` (which today returns only `number`)
  folds into it.
- Where `Readiness` derivation lives for GitLab (provider or a shared
  helper), as long as `getMRDashboardProps` and the provider agree.
- Placeholder shape for a ghost user.
- Task order and commit boundaries.

## Calls I made (for Matt to check)

- `readiness` optional on the type, absent means unknown.
- `UNSTABLE` reads as ready.
- The dashboard keeps today's optimistic `isReady` during `checking` on both
  forges; no new `MRStatus` value.
- Single-PR reads keep returning `null` with a warning on a failed fill;
  only a rate limit throws.
- `fetchPullRequestByBranch` keeps its REST discovery.
- `listWeight` on GitHub drops only `body`.
- With no required checks configured, every failing check fails the pipeline.
- A canceled check reads `canceled` overall and blocks as `checks-failing`.
- Required count: classic protection from the fill, rulesets cached 10
  minutes, `0` when GitHub says no review is required, else `null`.
- `approvalsLeft` is 0 when the count is unknown; the components show the
  verdict alone then.
- A type-only board change for the widened `reviews.required`.
- gitq gets a verification task, not an adaptation.
- Bot authors keep REST's `<login>[bot]` username.
- REST rate-limit retry deadline: 30s.
- `Pipeline.id` names the failing (else latest) run; `runIds` lists all.
- Team review requests stay off `reviewers` for now.
