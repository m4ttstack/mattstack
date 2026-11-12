# glance GitHub gaps: watchMR, rebase, merge method and queue, honest reads

Date: 2026-11-11. Tickets: GLANCE-44, GLANCE-45, GLANCE-52 (project P-RT-28,
GitHub parity). Package: `packages/glance` (`@mattstack/glance`), with one
forced change in `packages/glance-react`. Ships as glance 0.31.0, unpublished.

## Intent

The rt daemon, the board, gitq and the VS Code extension all reach GitHub
through glance now (the daemon since RT-540). Three groups of GitHub gaps make
those consumers crash, fail on ordinary repository settings, or report a
failure as an answer:

- A single-PR dashboard on GitHub crashes, because `watchMR` throws.
- Rebase is refused although GitHub can rebase; merge and auto-merge fail on a
  squash-only repository; merge fails on a branch that requires a merge queue.
- By-branch reads, create and merge hide failures and fork owners from the
  daemon.

Success: each ticket's acceptance holds, every existing consumer compiles and
behaves as before unless it opts in, and GitLab behaves exactly as it does
today.

## Verified state on main (2026-11-11)

Every claim in the job brief was checked against the code.

| Claim | Verdict | Where |
|---|---|---|
| `GitHubProvider.watchMR` throws unconditionally | true | `src/GitHubProvider.ts:1627-1639` |
| `MRDashboard` single-MR `subscribe` calls it unguarded | true | `src/MRDashboard.ts:512-528` |
| No polling connection state | true; worse, the branch dashboard fakes a push connect on both forges, and the multi-PR dashboard does on GitHub, so both report `connected` while only polling | `src/MRDashboard.ts:576-580, 760-764`; union at `src/RealtimeWatcher.ts`, `src/types.ts:457` |
| `rebasePullRequest` throws, `canRebase` false | true | `src/GitHubProvider.ts:691, 2061-2072` |
| README and `tests/live/expectations.ts` say rebase is permanently unsupported | expectations: true (`tests/live/expectations.ts:74-78`). README: false the other way; its table lists rebase as a GitHub capability and omits auto-merge and the queue | `README.md:30` |
| `mergePullRequest` sends `merge_method` only when passed, never reads allowed methods | true | `src/GitHubProvider.ts:1773-1777` |
| `merge()` has no queue routing | true; `MRDashboardActions.merge` calls `mergePullRequest` directly | `src/MRDashboard.ts:472-473` |
| `PullRequest` has no head-repo field | true; the fill selects no head repository | `src/types.ts:161-281`, `src/githubFill.ts:145-160` |
| `fetchPullRequestByBranch` returns null on a failed or capped read | true (5xx at :1284 and :1315, scan cap at :1334, failed fill through `fetchSingleMR`) | `src/GitHubProvider.ts:1248-1335` |
| `fetchPullRequestsByBranches` returns null for a found PR it could not fill | true | `src/GitHubProvider.ts:1457-1464` |
| `createPullRequest` throws after the PR exists when a label write fails | true; the same holds for reviewers and assignees, and later steps are skipped | `src/GitHubProvider.ts:1510-1530` |
| A landed merge can skip `sourceBranchNotDeleted` | true; a throwing read-back exits before the delete | `src/GitHubProvider.ts:1794-1797` |
| `restRequest` has no size cap | true; Octokit buffers and parses the whole body before `toResponse` rebuilds it. GitLab's `restRequest` returns the `fetch` Response, whose body streams | `src/GitHubProvider.ts:1617-1625, 2916-2982`; `src/GitLabProvider.ts:2065` |
| "A PR behind its base reports that it needs updating" (GLANCE-45 acceptance) | already true: `shouldBeRebased` is `mergeStateStatus === 'BEHIND'`, which raises readiness `behind` and the rebase button. GitHub only reports BEHIND when branch protection requires up-to-date branches | `src/githubFill.ts:578`, `src/readiness.ts:13` |

## Goals

1. GitHub `watchMR` polls, so single-PR dashboards load and update; no
   GitHub dashboard that only polls claims a live connection. The GitLab
   branch dashboard, which also only polls and reports `connected`, keeps
   doing so under the GitLab ruling; it is a known remaining case and a
   candidate follow-up.
2. GitHub rebase works and `canRebase` is true.
3. GitHub merge and auto-merge use a method the repository allows when the
   caller names none.
4. `mergePullRequest` on GitHub enters the merge queue when the base branch
   uses one, and says so in its result.
5. The daemon can tell a fork PR from a same-repo PR, a failed or capped
   by-branch read from a confirmed miss, a partial create from a failed one,
   and whether a landed merge deleted its branch; and it can stop reading a
   `restRequest` body early.

## Non-goals

- Any GitLab behaviour change (standing ruling). GitLab code paths, request
  shapes and results stay identical; GitLab may gain `false` capability flags
  and ignore new optional parameters.
- Consumer changes in `lib/`, `apps/`, `extensions/` or `plugins/` (other
  lanes edit them). Needed consumer work is listed under Required follow-ups.
- GLANCE-50 (GitLab query complexity) and GLANCE-51 (live coverage of the
  queue methods). New live cases must not add coverage failures, but this
  work does not fix GLANCE-51.
- Publishing to npm, or running the live suite.
- New HTTP libraries (ruling: Octokit and gitbeaker only).
- Moving note writes off `GitProvider` (ruling).

## Anti-goals

- Reporting success while proving nothing: a queued merge must never look
  merged, a partial create must never look clean, a polling GitHub dashboard
  must never say `connected`, a failed read must never be indistinguishable from a
  miss for a caller that asks.
- Raising GitHub request volume silently. Every added request is counted
  below.

## Constraints

- Additive interface changes only. New `GitProvider` members, new
  `ProviderCapabilities` fields and new `PullRequest` fields are optional:
  gitq's tests build full `GitProvider` literals with a typed `capabilities`
  object (`apps/gitq/tests/forge-sync.test.ts:78-93` and the others listed
  under Consumers), and a new required member would break them.
- A capability flag wherever the forges differ.
- Write fence: `packages/glance/` (never `harness_credentials.json`),
  `packages/glance-react/` only where a changed type forces it,
  `docs/superpowers/specs/`, `docs/superpowers/plans/`, `.superpowers/`.
- Gates before every commit in `packages/glance`: `bun test`,
  `bun run check-types`, `bun run check:node`, `bun run build`,
  `bun run check-types:live`, and `bun run purity` from the worktree root; in
  `packages/glance-react` (if touched) its test, lint and check-types.
- Never run the live suite or make any live forge call.
- No em or en dashes in anything written.

## Approaches (decided through the shepherd)

| Decision | Picked | Rejected, and why |
|---|---|---|
| Default GitHub `watchMR` poll interval | 60s, overridable with `pollIntervalMs` (Matt's pick) | 30s (twice the cost), 15s (four times) |
| How a polling dashboard reports its connection | New `'polling'` member on the connection unions; GitLab dashboards report exactly what they do today | A separate `transport` field with `connection: 'disconnected'` reads as an outage on a working dashboard |
| Where merge enters the merge queue | Inside `GitHubProvider.mergePullRequest`, after one GraphQL read shared with the method pick | Only in the dashboard action leaves the board and gitq failing on queue repos; an opt-in flag helps no consumer until each changes |
| How by-branch reads flag an incomplete answer | Optional `onWarning` callback; results stay null | Throwing changes behaviour for every current caller |
| What a partial GitHub create throws | `PartialCreateError extends ReadBackFailedError` | A standalone class leaves daemon and gitq treating the existing PR as "no PR", so gitq retries the create |

Calls I made and the shepherd accepted: GitHub picks `viewerDefaultMergeMethod`
when the caller names none; rebase uses GraphQL `updatePullRequestBranch`
with `updateMethod: REBASE`; `PullRequest.sourceProjectPath`; a merge whose
read-back fails still deletes the branch and reports it on the error;
`restRequest` streams its body; version 0.31.0 (each recent PR took its own
minor, and `docs/releasing.md` has no rule for folding into an unpublished
one).

## Design

### 1. GitHub `watchMR` and the polling state (GLANCE-44)

**Poll-only watcher.** `createRealtimeWatcher`'s `subscribe` parameter
becomes optional. Without it the watcher is poll-only: it fetches on start,
then every `pollIntervalMs`, with the same disposal. Failures back off with
the existing full-jitter rule, but in poll-only mode a retry never comes
sooner than `pollIntervalMs` (my call: the push mode's 2s first retry exists
to recover a live channel; here it would only multiply requests against a
failing or rate-limited token). A `RateLimitedError` waits until its
`retryAfterMs` or `resetAt` when that is later still. Push mode keeps its
current timing exactly. Its status is:

- `connecting` until the first fetch settles;
- `polling` after a successful fetch, including one that resolves null (a
  branch with no PR yet, a PR that does not exist): the read succeeded, there
  was just nothing to deliver;
- `reconnecting` with `consecutiveErrors` and `lastError` while fetches fail,
  back to `polling` on the next success.

The first `onUpdate` already carries `polling` (the state is set before the
update is delivered), so a dashboard never shows `connecting` beside fresh
data.

**Union.** `WatcherStatus['connection']` and `MRDashboardProps['connection']`
gain `'polling'`. Doc comments say it means "data is fresh as of the last
poll; no push channel". This breaks an outside exhaustive switch over the
union; the CHANGELOG says so.

**`GitHubProvider.watchMR`** runs a poll-only watcher whose fetch is
`fetchSingleMR(projectPath, mrIid, userId, onWarning)`. A warning with
`source: 'fill'` makes the fetch throw (so the watcher reports
`reconnecting` with the warning's message) instead of silently delivering
nothing. A `contexts` warning does not: the PR is delivered with its pending
pipeline, as `fetchPullRequests` does, so a PR with more than 100 checks keeps
updating when a later checks page fails. A PR that does not exist resolves
null and delivers nothing, as GitLab's watcher does. Default interval 60s;
`options.pollIntervalMs` overrides it. `options.onStatusChange` is honoured;
the logger is `options.logger` else the provider's own, and the log context
is `options.logContext` else `watchMR:<projectPath>!<iid>`.

**Dashboards.** `createSingleDashboard` is unchanged: it now works on GitHub
because `watchMR` does. `createBranchDashboard` and `createDashboardGroup`
choose poll-only mode when the provider has no `subscribePullRequestEvents`
(GitHub); with it (GitLab) they run exactly as today, including the branch
dashboard's existing immediate `onConnected()`. Their GitHub poll interval
stays at today's 30s, so their healthy request volume does not change; their
failure retries follow the poll-only rule above, so they send fewer requests
than today while failing.

**glance-react.** `ConnectionStatusBadge`'s local `ConnectionState` gains
`'polling'` with a `STATUS_CONFIG` entry; it is a healthy state, hidden by
default like `connected` and shown with `showWhenConnected`. Its label
follows rt:ui-copy (2 to 6 words). The story gains the state, and the badge
is rendered in Storybook through Fast Browser and screenshotted in both
schemes before the task is done. `useDashboard` needs no change
(`ConnectionStatus` derives from `WatcherStatus`).

**Cost.** Each poll is one `fetchSingleMR`: one GraphQL fill (1 rate-limit
point), plus one GraphQL request per extra page of checks past the first 100,
plus one REST rulesets read for an open PR with a review decision when the
fill's 10-minute rules cache (`RULES_CACHE_MS`, `src/GitHubProvider.ts:438`)
has expired (`tests/gh-fill-cost.test.ts:97`). At the 60s default that is
60 GraphQL plus up to 6 REST requests per hour per open single-PR dashboard
(more GraphQL only for a PR with over 100 checks), and never more than one
poll per interval while reads fail. Branch and multi-PR dashboards: no change
while healthy, fewer while failing. The shepherd was told the full count.

### 2. Rebase (GLANCE-45)

`rebasePullRequest` reads the PR's node id and head sha (one GraphQL read),
then sends

```graphql
mutation { updatePullRequestBranch(input: {
  pullRequestId: $id, expectedHeadOid: $head, updateMethod: REBASE
}) { pullRequest { headRefOid } } }
```

`expectedHeadOid` refuses a rebase over a push that landed in between.
GitHub's own refusals (already up to date, conflicts, a fork that does not
allow maintainer edits) surface as thrown errors in the existing
`<op> failed: ...` shape. Like GitLab's rebase, the call resolves once GitHub
accepts it; callers read the PR to see the new head. `canRebase` becomes
true; the `GitProvider.rebasePullRequest` doc stops saying GitLab-only.

Cost: 2 requests per rebase (was a throw).

The "behind" acceptance is already met; a unit test pins it:
`mergeStateStatus: BEHIND` gives readiness `behind`, `blockers.needsRebase`
and a visible rebase button.

### 3. Merge method and merge queue (GLANCE-45)

**Merge context read.** One private GraphQL read serves merge and auto-merge:

```graphql
repository(owner, name) {
  viewerDefaultMergeMethod mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed
  pullRequest(number) { id headRefOid isMergeQueueEnabled isInMergeQueue
    mergeQueueEntry { position state } }
}
```

**`mergePullRequest` on GitHub:**

1. Read the merge context.
2. Queue path, when `isMergeQueueEnabled`:
   - Refuse before any write if the input gives any value, `false`
     included, for `mergeMethod`, `squash`, `commitMessage`,
     `squashCommitMessage` or `shouldRemoveSourceBranch`: the queue applies
     its own settings. This matches `mr_merge`, which refuses any defined
     value. `sha` is honoured as the enqueue's `expectedHeadOid`.
   - Already in the queue: no write; the result's `queued` is the current
     entry. If the read-back then fails it throws `MergeReadBackFailedError`
     with `writeApplied: false` (nothing was written) and `queued` set.
   - Otherwise `enqueuePullRequest` with the node id from the context (no
     extra node-id read). This includes a PR the queue dropped earlier (my
     call): a `mergePullRequest` call is an explicit request to merge, and
     GitHub's own merge button re-adds a dropped PR the same way. `mr_merge`
     keeps its stricter `requeue` policy, because it checks the queue itself
     and never reaches this path.
   - Read the PR back and resolve `{ ...pr, queued: { position, state } }`.
     The PR's `state` is still `opened`.
3. Direct path otherwise: the method is the caller's `mergeMethod`, else
   `'squash'` when `squash` is true, else `viewerDefaultMergeMethod`
   (lowercased); if that is somehow not allowed, the first allowed of merge,
   squash, rebase. `squash: false` means "not a squash" (my call: it is the
   caller saying so, and today it yields a merge commit): the default is used
   unless it is squash, in which case the first allowed of merge, rebase; a
   repository that allows only squash refuses it before the write. A
   caller-named method the repository forbids is refused before the write,
   naming the allowed methods. `merge_method` is always sent; the
   commit-message pick uses the resolved method.
4. Read-back and branch removal as in section 4d.

`MergePullRequestResult` gains `queued?: MergeQueueEntry`, set only on the
queue path. `MRDashboardActions.merge` returns `Promise<MergePullRequestResult>`
(a subtype of `PullRequest`, so readers and mocks keep compiling). Requests
per direct merge: one more than today (the context read); the branch-delete
path saves one (4d), so a merge with branch removal costs the same as today.

**`setAutoMerge` on GitHub** replaces its REST node-id read with the context
read (same request count) and passes `mergeMethod` to
`enablePullRequestAutoMerge`, whose own default is MERGE. The method comes
from the same pick function as the direct merge path with no caller input
(`viewerDefaultMergeMethod`, else the first allowed of merge, squash,
rebase), upper-cased to GitHub's enum. On a queue branch it omits
`mergeMethod`, since the queue decides.

**Daemon check (shepherd's note).** `mr_merge` asks GitHub about the queue
itself (`lib/mcp/github-merge.ts:162-180`) and calls merge only when the
queue is off, so it never takes the queue path; and even if it did,
`daemonMergeProvider.mergePullRequest` reads the PR back and
`mergeOnGitHub` reports `merged` only when its state is `merged`
(`github-merge.ts:131-146, 182-187`), so a queued result cannot read as a
landed merge there. One gap remains, outside the fence: `mr:action` replies
a bare `{ ok: true }` and drops `queued`
(`lib/daemon/handlers/mr.ts:252-256, 285-288`), so a direct `mr:action`
merge caller on a GitHub queue branch sees plain success; it is a required
follow-up. The board's `runMrAction` treats any resolve as success
(`apps/board/src/mr-action.ts:73-82`), but the board only merges through
`GitLabProvider` (`apps/board/src/server.ts:3888`), so it is unaffected.
`mr_merge` pays one extra GraphQL read per GitHub merge (its own queue check
plus glance's context read).

**Sequencing.** glance is linked as `workspace:*`, so merging this work is
its in-repo release: the daemon picks it up on its next restart from main,
before any follow-up lands. Two behaviours change for the daemon on that day,
both accepted by the shepherd with the follow-ups below: a GitHub create
whose reviewer, assignee or label step fails returns `ok: true` with the PR
number instead of `ok: false` (follow-up 1), and an `mr:action` merge on a
GitHub queue branch enqueues and returns `ok: true` instead of failing with a
405 (follow-up 2). The report asks for follow-ups 1 and 2 to land soon after.

### 4. Honest reads and writes (GLANCE-52)

**4a. Head repository.** `PullRequest.sourceProjectPath?: string | null`:
the `owner/repo` the source branch lives in; null when GitHub reports no head
repository (a deleted fork); absent on GitLab. The GitHub fill selects
`headRepository { nameWithOwner }` at both weights; no extra request.
Capability `canReportSourceProject?: boolean`: true on GitHub, false on
GitLab. A caller tells a fork PR from a same-named base branch by comparing
`sourceProjectPath` with the project path. `fetchPullRequestByBranch` keeps
its current matching.

**4b. By-branch warnings.** Both reads take an optional last parameter
`options?: { onWarning?: (warning: FetchPullRequestsWarning) => void }`.
Results are unchanged (null stays null). `FetchPullRequestsWarning` gains an
optional `branch?: string`, set on every by-branch warning so a batch caller
can attribute it. GitHub fires:

- `request-failed`, source `list`, with `status`: the fast-path or a
  fallback-page REST read failed (`target` is the project path);
- `page-cap`, source `list`: the 500-PR fallback scan ended with no match;
- `request-failed`, source `fill`: the PR was found but its fill failed
  (`target` is `warningTarget(projectPath, number)`), for the single read
  and for each such PR in the batch;
- whatever the fill itself reports for a PR it kept, such as a `contexts`
  warning for a failed checks page (the PR is returned with a pending
  pipeline, as in `fetchPullRequests`), forwarded with `branch` set.

A warning callback that throws is ignored, as in `fetchPullRequests`.
Capability `canReportIncompleteBranchReads?: boolean`: true on GitHub, false
on GitLab (which ignores the parameter). No extra requests.

**4c. Partial create.** `createPullRequest` on GitHub attempts every
follow-up step it was asked for (reviewers, assignees, labels), recording
each failure (HTTP, transport or rate limit) instead of stopping at the
first, then reads the PR back. If any step failed it throws
`PartialCreateError`, exported from `errors.ts`:

- extends `ReadBackFailedError`, with `writeApplied: true`, `operation:
  'createPullRequest'`, `projectPath`, `iid`;
- `failedSteps: Array<{ step: 'reviewers' | 'assignees' | 'labels'; message: string; cause?: unknown }>`;
- `pullRequest: PullRequest | null`, the read-back, null when it failed;
- a message naming the PR number and the failed steps.

With no failed step, behaviour is today's (including `ReadBackFailedError`
when only the read-back fails). GitLab sets these fields in its single create
call, so it cannot partially fail and is unchanged.

**4d. Merge read-back and branch removal.** After the merge write lands,
`mergePullRequest` reads the PR back; whether or not that succeeds, it then
removes the source branch when asked. The branch and its repository come from
the read-back's `sourceBranch` and `sourceProjectPath` when the read-back
succeeded (saving today's extra REST read), else from one REST read of the PR
(`head.ref`, `head.repo.full_name`), as now. If the read-back failed it
throws `MergeReadBackFailedError` (exported; extends `ReadBackFailedError`,
`writeApplied: true`, or false in the already-queued case of section 3, so the flag is a constructor argument) carrying `sourceBranchNotDeleted?: string` with the
result's meaning, and `queued?: MergeQueueEntry` on the queue path. So a
landed merge always reports the branch outcome, on the result or on the
error.

**4e. Bounded `restRequest`.** `restRequest` asks Octokit not to parse a
successful body (`request.parseSuccessResponseBody: false`) and hands the
`fetch` body stream to the Response it returns, with status and headers
(including `Content-Length`) intact. A caller stops at its own size by
cancelling the reader, which the daemon's `readCapped`
(`lib/daemon/forge-reads.ts:237`) already does; this matches GitLab, so no
interface change and no flag. Non-2xx responses still resolve, built from
Octokit's error as today. Other internal `api()` callers keep parsed bodies.

### 5. Capability flags

| Flag | GitHub | GitLab |
|---|---|---|
| `canRebase` (existing) | false -> true | true (unchanged) |
| `canEnqueue` (existing, now also gates queue routing) | true | false |
| `canReportSourceProject?` (new, optional) | true | false |
| `canReportIncompleteBranchReads?` (new, optional) | true | false |

No flag for `watchMR` (both forges support it; the status says which
transport), the merge-method pick (GitHub-internal), streaming `restRequest`
(parity) or `PartialCreateError` (GitHub-only by construction).

### 6. Docs, expectations, version

- README providers table lists what each provider supports.
- `GitProvider.ts` docs for `watchMR`, `rebasePullRequest`,
  `mergePullRequest`, `setAutoMerge`, both by-branch reads and `restRequest`.
- `tests/live/expectations.ts`: GitHub `watchMR` and `rebasePullRequest`
  become supported, with notes.
- `package.json` 0.31.0; CHANGELOG 0.31.0 entry with a breaking-change line
  for the `'polling'` union member; `dist` rebuilt.

### 7. Tests

Unit tests (`bun test`, octokit-request stubs as in `tests/gh-merge.test.ts`)
cover every behaviour above, including request counts in the style of
`tests/gh-fill-cost.test.ts` for watchMR per tick, merge, merge with branch
removal, setAutoMerge and rebase; GitLab-shaped fakes prove branch and group
dashboards still report `connected` with a push provider; a pull-counting
stream proves `restRequest` lets a reader stop early.

Live conformance cases are written and typechecked
(`bun run check-types:live`), never run. GitHub cases: `watchMR` delivers an
update and reports `polling`; rebase moves a behind branch onto its base;
merge with no method uses the repository default; a squash-only merge and
auto-merge on the fixture switched to squash-only for the case and restored in
a `finally` (recorded as a skip with the reason when the token cannot change
repository settings; if the case finds the fixture already squash-only at its
start, a run was killed mid-case, so it restores the settings first and
records that in the report); `sourceProjectPath` on a same-repo PR; a create with a
reviewer GitHub refuses throws `PartialCreateError` for a PR that exists,
then closes it; `restRequest` stops early on a large response. The queue path
runs against an optional queue-protected repo entry in the credentials
template and records a skip with the reason when none is configured.

## Consumers checked

| Consumer | Uses | Impact |
|---|---|---|
| rt daemon, `lib/daemon/handlers/mr.ts` | merge, rebase (gated on `canRebase`), setAutoMerge, enqueue/queue status (gated on `canEnqueue`), create, batch by-branch with a per-branch workaround, `restRequest` | Rebase on GitHub now runs instead of refusing; merge routes through the queue; new signals unused until follow-ups |
| rt daemon, `lib/mcp/github-merge.ts` | queue status, enqueue, merge, setAutoMerge via daemon verbs | Unchanged behaviour; one extra GraphQL read per GitHub merge |
| rt daemon, `lib/daemon/forge-reads.ts`, `file-diff.ts`, `freshness.ts`, `project-sync.ts`, `project-mrs.ts`, `enrich.ts`, `herd-lanes.ts`, `ignored-mrs.ts`, `discussions.ts` | `restRequest`, by-branch reads | `readCapped` now saves memory on GitHub; nulls unchanged |
| board, `apps/board/src/mr-action.ts`, `src/server.ts:3888` | merge, rebase, setAutoMerge through a structural provider, always a `GitLabProvider` | Unchanged |
| gitq, `apps/gitq/src/core/forge-sync.ts`, `src/server/data.ts`, tests | create (catches `ReadBackFailedError` with `writeApplied`), by-branch reads; typed `GitProvider` fakes | A partial create now records the PR number; fakes compile because every addition is optional |
| VS Code extension, `extensions/vscode/rt-context/src/gitlab.ts` | by-branch reads on `GitLabProvider` | Unchanged |
| glance-react, `lib/hooks/useDashboard.ts`, `lib/components/forge/ConnectionStatusBadge.tsx` | dashboards, connection union | Badge gains `polling` (forced change) |
| rt-client, `packages/rt-client/src/commands.ts` | `mr:action` data types | Unchanged (follow-up to carry `queued`) |
| boxscore, `apps/boxscore/src/server/source/*` | own `restRequest` options type | Unchanged |

## Required follow-ups (outside the fence)

1. Daemon `mr:create` must read `PartialCreateError.failedSteps` and report
   the failed steps instead of a clean create
   (`lib/daemon/handlers/mr.ts:367-374`).
2. Daemon `mr:action` merge should pass `queued` through, and read
   `sourceBranchNotDeleted` from a `MergeReadBackFailedError`
   (`lib/daemon/handlers/mr.ts:252-275, 285-288`;
   `packages/rt-client/src/commands.ts:1232`).
3. Daemon `liveByBranchOnGitHub` can drop its per-branch summary read for
   `onWarning` (`lib/daemon/handlers/mr.ts:192-209`); `project-mrs.ts:268`
   can see the scan cap the same way.
4. `mr_resolve_branch` and `mr_create` with `ifExists` should compare
   `sourceProjectPath` to reject a fork PR on a same-named branch.

Candidate, not required: the GitLab branch dashboard only polls but reports
`connected` (Goal 1); moving it to `polling` is a GitLab behaviour change and
needs its own ruling.

Follow-ups 1 and 2 change what the daemon reports on the day this merges
(see Sequencing in section 3), so they should land soon after.

## Left to the builder

Internal helper names, exact error and warning wording (inside the shapes
above), test file layout, the badge label within rt:ui-copy, and how the live
cases share fixture setup.
