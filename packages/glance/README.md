# @mattstack/glance

Provider-agnostic SDK for GitHub and GitLab: types, REST/GraphQL clients, real-time subscriptions, and dashboard helpers. Works in any Node/Bun runtime.

## Install

```bash
npm install @mattstack/glance
# or
bun add @mattstack/glance
```

## Quick Start

```ts
import { GitLabProvider } from '@mattstack/glance';

const provider = new GitLabProvider('https://gitlab.com', process.env.GITLAB_TOKEN!);
const user = await provider.validateToken();
const prs = await provider.fetchPullRequests();
```

## Providers

Two built-in providers implement the `GitProvider` interface:

| Provider | Class | Capabilities |
|---|---|---|
| GitLab | `GitLabProvider` | Full: merge, rebase, approve, auto-merge, retry pipeline, re-review, resolve discussions |
| GitHub | `GitHubProvider` | Core: merge (with merge queue), approve, rebase, auto-merge, polling `watchMR` |

```ts
import { createProvider } from '@mattstack/glance';

// Auto-create the right provider by slug
const provider = createProvider('gitlab', 'https://gitlab.com', token);

// With optional logger
const provider = createProvider('gitlab', 'https://gitlab.com', token, {
  logger: console
});
```

### Provider Methods

| Method | Description |
|---|---|
| `validateToken()` | Verify credentials, returns `UserRef` |
| `fetchUser(username)` | Resolve a username to a `UserRef`, or `null` if no such user |
| `fetchPullRequests(options?)` | Fetch MRs — supports `state` filter and batch `iids` fetching |
| `fetchSingleMR(path, iid, userId)` | Fetch one MR by project path and IID |
| `fetchPullRequestByBranch(path, branch, state?)` | Find an MR by source branch |
| `fetchPullRequestsByBranches(path, branches)` | Batch-fetch MRs by source branches *(optional, not all providers)* |
| `createPullRequest(input)` | Create a new MR |
| `updatePullRequest(path, iid, input)` | Update an existing MR (title, description, draft status, etc.) |
| `mergePullRequest(path, iid, input?)` | Merge an MR. Resolves with a `MergePullRequestResult` once the merge landed, or, on a GitHub base branch with a merge queue, once the PR joined the queue: it is still open and `queued` carries its queue entry. A failed source-branch cleanup is in `sourceBranchNotDeleted`, never thrown |
| `rebasePullRequest(path, iid)` | Rebase an MR onto its target branch |
| `approvePullRequest(path, iid)` | Approve an MR |
| `unapprovePullRequest(path, iid)` | Remove your approval |
| `setAutoMerge(path, iid)` | Enable auto-merge when pipeline passes |
| `cancelAutoMerge(path, iid)` | Cancel auto-merge |
| `enqueuePullRequest(path, iid, input?)` | Add a PR to the merge queue (GitHub) |
| `fetchMergeQueueStatus(path, iid)` | Whether a PR's branch has a merge queue, and whether the PR is in it (GitHub) |
| `retryPipeline(path, pipelineId)` | Retry a pipeline |
| `requestReReview(path, iid, usernames?)` | Request re-review |
| `resolveDiscussion(path, iid, discussionId)` | Resolve a discussion thread |
| `unresolveDiscussion(path, iid, discussionId)` | Unresolve a discussion thread |
| `createComment(path, iid, body, options?)` | Post a top-level comment: a resolvable thread on GitLab (`resolvable: false` for a plain note), a pull request comment on GitHub |
| `createInlineComment(path, iid, body, anchor)` | Comment on a diff line; the `CommentAnchor` takes `path` plus `line`, `oldLine` or both |
| `replyToDiscussion(path, iid, discussionId, body)` | Reply inside a thread; on GitHub only `gh-review-thread-<id>` threads take replies (`canReplyToGeneralComments` is false), and a pull request comment or a review summary is refused before any request |
| `updateComment(path, iid, note, body)` | Replace a comment's body; `note` is a `NoteRef`, and on GitHub its `kind` picks the endpoint |
| `deleteComment(path, iid, note)` | Delete a comment; GitHub cannot delete a review |
| `submitReview(path, iid, review)` | Post a summary, diff comments, replies and resolves with an outcome of `comment`, `approve` or `request_changes`; returns `pending-drafts` or `bad-anchors` with nothing posted when the forge refuses |
| `watchMR(path, iid, userId, onUpdate, options?)` | Real-time MR subscription (returns `dispose()`) |
| `subscribePullRequestEvents?(path, prs, callbacks)` | Push-only events for already-fetched MRs, no fetch or poll (GitLab; absent on GitHub) |
| `fetchMRDiscussions(repoId, iid)` | Fetch MR discussions and notes |
| `fetchBranchProtectionRules(path)` | Fetch branch protection rules |
| `deleteBranch(path, branch)` | Delete a branch |
| `fetchProjectLabels?(path, options?)` | A project's labels, with `search` and `maxRows`; `truncated` says the cap cut the list (`canFetchProjectLabels`) |
| `fetchPipelineList?(path, options)` | Pipelines (GitHub workflow runs) newest first, by `ref`, `sha` or MR `iid`, as `PipelineListEntry` rows (`canFetchPipelineList`) |
| `fetchCommitParents?(path, sha)` | A commit's parent shas (`canFetchCommitParents`) |
| `fetchPipelineFailedJobs?(path, pipelineId)` | A pipeline's failed jobs; on GitLab, plus those of the child pipelines its bridges trigger (`canFetchPipelineFailedJobs`) |
| `fetchPullRequestSummaries?(path, options)` | Scalar `PullRequestSummary` rows by state, author, branch or search, without the dashboard fill (`canFetchPullRequestSummaries`) |
| `fetchMergeRequestIndex?(options)` | Scalar rows for MRs updated at or after `updatedAfter`, for `projectPaths` or a `groupPath` (GitLab) or `projectPaths` only (GitHub) (`canFetchMergeRequestIndex`) |
| `fetchApprovalRules?({ projectPath, updatedAfter \| iids })` | Approval rules per open MR or PR; GitHub reads 50 per GraphQL request, and an entry with `unknownReason` was not read (`canFetchApprovalRules`) |
| `fetchCodeownerSections?({ projectPath })` | CODEOWNERS section names, or `null` without the file; GitHub returns the owners lowercased with an `@` prefix (`canFetchCodeownerSections`) |
| `fetchDivergedCount?(path, iid)` | How many commits the base has moved on for one MR, or `null` without a comparison (`canFetchDivergedCount`) |
| `fetchDivergedCounts?(path, iids)` | The same for a batch, 25 per request; GitHub only (`canFetchDivergedCount`) |
| `addPullRequestLabels?(path, iid, labels)` | Add labels, leaving the others in place (`canEditLabels`) |
| `removePullRequestLabels?(path, iid, labels)` | Remove labels, leaving the others in place (`canEditLabels`) |
| `fetchPullRequestDiffs?(path, iid, options?)` | One page of up to 100 per-file diffs; a file with no inline patch has an empty `diff` and `tooLarge: true` (GitHub; `canFetchPullRequestDiffs`) |
| `restRequest(method, path, body?, op?, io?)` | Raw authenticated REST API pass-through; `io.redirect: 'manual'` returns a redirect instead of following it. GitHub accepts `op` for parameter-order parity and ignores it; its response body streams, so a caller can stop reading early |

Provider capabilities are exposed via `provider.capabilities` — check flags like `canMerge`, `canRebase`, `canAutoMerge`, `canResolveDiscussions`, etc. before calling provider-specific methods.

---

## Dashboard API

### `createDashboard`

High-level factory that bundles real-time MR watching with pre-bound mutation actions.

#### Single MR by IID

```ts
import { createDashboard } from '@mattstack/glance';

const dashboard = createDashboard({
  provider,
  projectPath: 'group/project',
  mrIid: 42,
  userId
});

// Actions are available immediately
await dashboard.actions.merge();
await dashboard.actions.approve();
await dashboard.actions.toggleDraft(false); // mark ready

// Subscribe delivers real-time MRDashboardProps on each update
dashboard.subscribe((mr) => {
  console.log(mr.status, mr.pipeline?.status);
  renderUI(mr, dashboard.actions);
});

// Monitor connection health
dashboard.onStatusChange((status) => {
  console.log(status.connection); // 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'polling'
});

// When done, stop the subscription
dashboard.dispose();
```

| Property | Type | Description |
|---|---|---|
| `actions` | `MRDashboardActions` | Pre-bound mutation methods — available immediately |
| `isInitialLoading` | `boolean` | `true` until the first data payload arrives |
| `subscribe(cb)` | `(cb: (mr: MRDashboardProps) => void) => void` | Register a listener for real-time updates |
| `onStatusChange(cb)` | `(cb: (status: WatcherStatus) => void) => void` | Monitor connection health |
| `dispose()` | `() => void` | Stop the subscription and clean up |

#### Single MR by branch name

```ts
const dashboard = createDashboard({
  provider,
  projectPath: 'group/project',
  branch: 'feat/my-feature',
  userId
});

// Resolves the MR IID from the branch automatically.
// Re-resolves on each poll, so it picks up new MRs on the same branch.
dashboard.subscribe((mr) => renderUI(mr, dashboard.actions));
```

#### Multi-MR: `DashboardGroup`

Pass an array of IIDs to watch multiple MRs over a single WebSocket:

```ts
const group = createDashboard({
  provider,
  projectPath: 'group/project',
  mrIid: [42, 43, 44, 45],
  userId
});

group.subscribe((mrs) => {
  for (const [iid, mr] of mrs) {
    renderRow(mr, group.actionsFor(iid));
  }
});

// Dynamically update the tracked IIDs without destroying the group
group.updateIids([42, 43, 44, 45, 46]);
group.updateIids(prev => prev.filter(id => id !== 43));
```

| Property | Type | Description |
|---|---|---|
| `actionsFor(iid)` | `(iid: number) => MRDashboardActions` | Get actions for a specific MR |
| `isInitialLoading` | `boolean` | `true` until the first data payload arrives |
| `subscribe(cb)` | `(cb: (mrs: Map<number, MRDashboardProps>) => void) => void` | Real-time updates for all MRs |
| `updateIids(iids)` | `(iids: number[] \| (prev: number[]) => number[]) => void` | Dynamically add/remove tracked MRs |
| `onStatusChange(cb)` | `(cb: (status: WatcherStatus) => void) => void` | Monitor connection health |
| `dispose()` | `() => void` | Stop all subscriptions and clean up |

### `getMRDashboardProps`

Lower-level helper that transforms a raw `PullRequest` into render-ready `MRDashboardProps`. Useful when you already have the MR data from `fetchPullRequests()` or `fetchSingleMR()`:

```ts
import { getMRDashboardProps } from '@mattstack/glance';

const prs = await provider.fetchPullRequests();
const dashboards = prs.map(getMRDashboardProps);
// dashboards[0].status → 'mergeable' | 'blocked' | 'draft' | ...
// dashboards[0].mergeButton.visible, .disabled, .label
// dashboards[0].provider → 'gitlab' | 'github'
```

### `MRDashboardProps`

Pre-computed, UI-ready props — no conditional logic needed in the component layer:

| Field | Description |
|---|---|
| `provider` | `'gitlab'` or `'github'` — use to pick brand icon |
| `iid`, `title`, `webUrl`, `state` | Identity |
| `isDraft` | Whether the MR is in draft mode |
| `author`, `assignees`, `createdAt` | Authorship |
| `sourceBranch`, `targetBranch` | Branch info |
| `behindTarget` | `number \| null` — commits behind the target branch, `null` when the fetch path did not ask. Informational, not a blocker |
| `status` | `'mergeable' \| 'blocked' \| 'draft' \| 'merged' \| 'closed'` |
| `statusDetail` | Specific blocker reason (e.g., `'CI_MUST_PASS'`, `'NEED_REBASE'`) |
| `isReady` | `true` when the forge says the MR can merge (GitLab `detailedMergeStatus === 'mergeable'`, GitHub `readiness.state === 'ready'`), or while it is still checking and nothing visible blocks it |
| `readiness` | `{ state, reasons } \| null`: the forge-neutral verdict. `state` is `'ready' \| 'blocked' \| 'checking' \| 'draft' \| 'merged' \| 'closed'`; `reasons` names what blocks (`'conflicts'`, `'behind'`, `'checks-failing'`, `'checks-running'`, `'approvals'`, `'changes-requested'`, `'threads'`, `'merge-error'`, `'other'`). `'checking'` means the forge has not decided yet, never a block. `null` for a `PullRequest` built before this field existed |
| `pipeline` | Pipeline status breakdown: passing, failing, running counts, `hasWarnings`, individual `jobs` |
| `reviews` | Reviewer state: required, given, remaining, approvedBy, per-reviewer breakdown. `required` is `number \| null`: `null` means the forge did not say how many approvals are required, never zero |
| `mergeButton` | `{ visible, disabled, loading, label }` |
| `rebaseButton` | `{ visible, loading, label }` — `visible` tracks GitLab's `shouldBeRebased` |
| `autoMergeButton` | `{ visible, isActive, strategy, setBy, label, cancelLabel }` |
| `blockers` | Flags: `isDraft`, `hasConflicts`, `needsRebase`, `pipelineFailing`, `pipelineRunning`, `awaitingApprovals`, `hasUnresolvedDiscussions`, `hasMergeError`, `any`. `needsRebase` means GitLab requires a rebase before merge, not that the target branch moved |
| `isMerging`, `isRebasing`, `isLoading` | In-progress spinner states |
| `connection` | `'connecting' \| 'connected' \| 'disconnected' \| 'reconnecting' \| 'polling' \| 'idle'` |

### `MRDashboardActions`

Pre-bound mutation methods — call without passing project path or IID:

| Action | Description |
|---|---|
| `merge(input?)` | Merge the MR |
| `rebase()` | Rebase onto target branch |
| `approve()` | Approve the MR |
| `unapprove()` | Remove approval |
| `setAutoMerge()` | Enable auto-merge |
| `cancelAutoMerge()` | Cancel auto-merge |
| `retryPipeline(id)` | Retry a pipeline |
| `requestReReview(usernames?)` | Request re-review |
| `toggleDraft(draft)` | Toggle draft / ready-for-review status |
| `can` | Provider capability flags |

---

## Real-Time Architecture

### Shared WebSocket Connection

All `watchMR` and `subscribePullRequestEvents` calls on a single `GitLabProvider` instance share **one WebSocket connection** via ActionCable. A group dashboard makes one `subscribePullRequestEvents` call for the whole group and refreshes through one batched fetch. Each MR subscribes 3 channels (merge status, approval state, reviewers) on the shared connection. The connection is ref-counted:

- **First watcher** → opens the WebSocket
- **Subsequent calls** → subscribe additional channels on the existing connection
- **`dispose()` a watcher** → unsubscribes that MR's channels
- **Last watcher disposed** → disconnects the WebSocket

This means watching 30 MRs uses 1 WebSocket with 90 channel subscriptions, not 30 separate connections.

### `createRealtimeWatcher`

Generic self-healing subscription + polling module used internally by `watchMR` and `createDashboard`. Also exported for custom use:

- Adaptive poll rate (fast when push is down, slow when healthy)
- Full-jitter exponential backoff on fetch failures
- Push-event debouncing (burst events → one refetch)
- Immediate refetch on reconnect
- Connection status reporting via `WatcherStatus`
- Poll-only mode: omit `subscribe` and the watcher only polls, reporting `polling` (fresh as of the last poll) once a poll succeeds and `reconnecting` while polls fail

```ts
import { createRealtimeWatcher } from '@mattstack/glance';
import type { WatcherStatus, WatcherSubscribeCallbacks, RealtimeWatcherOptions } from '@mattstack/glance';
```

---

## Discussion & Note Mutations

The SDK exports specialized classes for working with MR discussions:

### `MRDetailFetcher`

Fetches full MR discussion threads. Used to populate reviewer summaries and comment panels.

### `NoteMutator`

Creates and manages notes (comments) on MRs. Returns `CreatedNote` with the note's metadata.

Its project argument is a numeric id or a project path.

```ts
import { MRDetailFetcher, NoteMutator } from '@mattstack/glance';
import type { CreatedNote } from '@mattstack/glance';
```

### `getReviewerSummaries`

Utility that merges reviewer state with discussion threads into a unified list:

```ts
import { getReviewerSummaries } from '@mattstack/glance';
import type { ReviewerSummary } from '@mattstack/glance';

const detail = await provider.fetchMRDiscussions(repoId, iid);
const summaries = getReviewerSummaries(mr, detail.discussions);
// summaries[0].reviewer, .commentCount, .discussions
```

---

## Types

All domain types are exported:

```ts
import type {
  // Core domain
  PullRequest,
  PullRequestsSnapshot,
  MergeabilityCheck,
  UserRef,
  Reviewer,
  MergeRequestReviewState,
  ReviewDisplayState,
  Pipeline,
  PipelineJob,
  DiffStats,

  // Discussion
  Discussion,
  Note,
  NoteAuthor,
  NotePosition,
  MRDetail,
  ReviewerSummary,

  // Dashboard
  MRStatus,
  MRState,
  MRDashboardProps,
  MRDashboardActions,
  Dashboard,
  DashboardGroup,
  CreateDashboardOptions,

  // Provider
  GitProvider,
  FetchPullRequestsOptions,
  ProviderCapabilities,
  ProviderSlug,
  BranchProtectionRule,
  ProjectLabel,
  PipelineListEntry,
  PullRequestSummary,
  FetchSummariesOptions,
  SummaryState,

  // Mutations
  CreatePullRequestInput,
  UpdatePullRequestInput,
  MergePullRequestInput,
  MergePullRequestResult,
  MergeMethod,
  CreatedNote,

  // Real-time
  RealtimeWatcherOptions,
  WatcherSubscribeCallbacks,
  WatcherStatus,
  ActionCableCallbacks,

  // Server
  FeedEvent,
  FeedSnapshot,
  ServerNotification,

  // Logger
  ForgeLogger,
} from '@mattstack/glance';
```

### GitHub `Pipeline.id`

A GitHub pull request has no single pipeline, so `Pipeline.id` is
`github:run:<n>` for the lowest Actions run id among the checks on the head
commit (`github:checks:<pr url>` when no check belongs to a run). It stays the
same while that commit's runs fail one after another, and changes on a new
push.

It can move once for the same head commit: a run's checks appear only when its
jobs start, so a run created earlier than the ones already visible, with a
lower id, can show up on a later read. This is accepted behaviour. Keeping the
first id seen would mean holding per-commit state across reads, and a provider
instance lives only as long as its caller. A consumer that keys work on the id
(the board's auto-doctor keys its red-pipeline pass on it) can act once more
for that commit; one that must not should compare `Pipeline.sha` as well.

### Utility Exports

| Export | Description |
|---|---|
| `createProvider(slug, url, token, options?)` | Factory — creates the right provider by slug |
| `SUPPORTED_PROVIDERS` | `['gitlab', 'github'] as const` |
| `parseRepoId(id)` | Extract numeric ID from `"gitlab:42"` → `42` |
| `repoIdProvider(id)` | Extract provider from `"gitlab:42"` → `"gitlab"` |
| `getReviewDisplayState(raw)` | Map raw review state → UI display state |
| `getReviewerSummaries(mr, discussions)` | Merge reviewer state with discussion threads |
| `noopLogger` | Silent logger implementation |
| `parseGitLabRepoId(path)` | Parse GitLab project path to numeric ID |
| `MR_DASHBOARD_FRAGMENT` | GraphQL fragment for MR dashboard queries |
| `stripDraftPrefix(title)` | Remove a GitLab draft marker (`Draft:`, `[draft]`, `(Draft)`) from a title |
| `draftTitle(title, draft)` | Compute the wire title for a target draft state, without double-prefixing |
| `ReadBackFailedError` | Thrown when a write landed but the MR could not be read back — see below |

### `ReadBackFailedError`

`createPullRequest`, `updatePullRequest`, and `mergePullRequest` each write,
then read the MR back to return it. The write and the read are separate calls,
so a read that fails says nothing about whether the write did. When the
read-back cannot be completed these throw `ReadBackFailedError` with
`writeApplied: true`, which means the edit is on the forge and re-issuing it
would apply it twice.

```ts
import { ReadBackFailedError } from '@mattstack/glance';

try {
  await provider.updatePullRequest(path, iid, { draft: true });
} catch (err) {
  if (err instanceof ReadBackFailedError && err.writeApplied) {
    // The edit landed; only describing the result failed. Re-fetch, don't re-write.
  } else {
    throw err;
  }
}
```

| Property | Description |
|---|---|
| `writeApplied` | `true` when a write preceded this read. `false` only where none did (a watcher poll) |
| `operation` | SDK operation that gave up, e.g. `"updatePullRequest"` |
| `projectPath`, `iid` | Which MR the read-back was for |
| `cause` | The last underlying read failure, when there was one |

It extends `Error`, so a caller that does not branch on it behaves exactly as
before. A *failed draft transition* is a different case and still throws a
plain `Error`: there the read worked and the MR genuinely is not in the
requested state.

### `RateLimitedError`

Every `GitHubProvider` read throws `RateLimitedError` when GitHub's primary or
secondary rate limit refuses it and waiting would outlast a poll, list reads
included, so a short list never reads as complete. A GitHub read fills up to
25 pull requests per batched GraphQL request.

```ts
import { RateLimitedError } from '@mattstack/glance';

try {
  await provider.fetchPullRequests();
} catch (err) {
  if (err instanceof RateLimitedError) {
    // err.kind is 'primary' or 'secondary'; err.resetAt and err.retryAfterMs
    // say when to try again, or null when GitHub did not.
  } else {
    throw err;
  }
}
```

| Property | Description |
|---|---|
| `kind` | `'primary'` (hourly quota) or `'secondary'` (burst limit); they reset on different clocks |
| `resetAt` | ISO time the limit lifts, or `null` |
| `retryAfterMs` | How long GitHub asked callers to wait, or `null` |
| `operation` | The request that hit the limit |

One exception: when `mergePullRequest` lands the merge and only the
head-repository read for `shouldRemoveSourceBranch` is rate limited, it does
not throw. It resolves with `sourceBranchNotDeleted` saying the read was rate
limited and, when GitHub said, when the limit resets. A caller that retries on
`RateLimitedError` would otherwise re-issue a merge that already landed.

### `CrossOriginRedirectError`

Every `GitLabProvider` request, and `NoteMutator` and `MRDetailFetcher`,
follows a redirect only while it stays on the GitLab host's origin (scheme,
host and port), or moves from `http://` to `https://` on the same host with
both on their default ports (`http://gl.example:8080` to `https://gl.example`
is refused). A hop
anywhere else throws `CrossOriginRedirectError` before any request goes there,
because fetch keeps the `PRIVATE-TOKEN` header on a cross-origin redirect. It
is never retried, so a `baseURL` on a host name that redirects to another name
must use the name GitLab answers on. `restRequest` with
`io.redirect: 'manual'` still returns the 3xx instead.

| Property | Description |
|---|---|
| `fromHost` | The host the refused hop was sent to |
| `toHost` | The host the redirect pointed at (empty for a non-network URL) |
| `status` | The redirect status |

GitHub needs no check: Octokit sends the token as `Authorization`, which fetch
drops on a cross-origin redirect.

### `WriteOutcomeUnknownError`

The `GitHubProvider` comment writes (`createComment`, `createInlineComment`,
`replyToDiscussion`, `updateComment`, `deleteComment`) and the review POST in
`submitReview` go out once, with no retry, under an abort signal: 15 s for a
comment write (`writeTimeoutMs`) and 60 s for the review POST
(`reviewTimeoutMs`). On a comment write, a timeout, a lost answer or a 5xx
throws `WriteOutcomeUnknownError`, which means GitHub may still have applied
the write: GitHub can apply a write and still answer 5xx. Look at the pull
request before sending it again. A 4xx still throws `ForgeHttpError`.

`submitReview` throws a plain `Error` instead, whose message starts
`publish failed and its outcome is unknown` and whose `cause` is the
`WriteOutcomeUnknownError`. Check `cause` rather than the error itself.

| Property | Description |
|---|---|
| `operation` | The write that gave up, e.g. `"createComment"` |
| `reason` | `'timed-out'`, `'no-answer'` or `'server-error'` (a 5xx) |
| `cause` | The underlying error, when there was one; a `ForgeHttpError` with the status for `'server-error'` |

## License

[MIT](LICENSE)
