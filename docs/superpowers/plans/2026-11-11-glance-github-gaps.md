# glance GitHub gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close GLANCE-44, GLANCE-45 and GLANCE-52 in `@mattstack/glance`: GitHub `watchMR` polls with an honest `polling` state, GitHub rebase works, merge picks an allowed method and enters the merge queue, and by-branch reads, create, merge and `restRequest` stop hiding failures.

**Architecture:** Every change lives in `packages/glance` (plus one forced badge change in `packages/glance-react`). GitHub-only behaviour sits in `GitHubProvider` and one small new module (`githubMerge.ts`); shared code (`RealtimeWatcher`, `MRDashboard`) gains a poll-only mode that GitLab never takes. Every interface addition is optional, so outside fakes keep compiling.

**Tech Stack:** TypeScript 5.9, Bun 1.4 test runner, Octokit (`@octokit/core` 7, `@octokit/request` 10), React 19 + vitest for glance-react.

**Spec:** `docs/superpowers/specs/2026-11-11-glance-github-gaps-design.md` (read it before any task; section numbers below refer to it).

## Global Constraints

- Write only under `packages/glance/` (never `packages/glance/harness_credentials.json`: never read, print, copy or stage it), `packages/glance-react/` (Task 3 only), `docs/superpowers/`, `.superpowers/`.
- No live forge call of any kind. Never run the live suite or any file that needs `GLANCE_LIVE=1`. Never point anything at `m4ttheweric/gitq-test-sandbox`. Never publish to npm. Never run rt, the daemon or a built binary against the real HOME.
- GitLab behaviour does not change: same requests, same results. GitLab may gain `false` capability flags and ignore new optional parameters.
- Additive only: every new `GitProvider` member, `ProviderCapabilities` field, `PullRequest` field and `FetchPullRequestsWarning` field is optional.
- No em or en dashes anywhere written. Comments state only a constraint the code cannot show.
- Before every commit touching `packages/glance`, from `packages/glance`: `bun test`, `bun run check-types`, `bun run check:node`, `bun run build`, `bun run check-types:live`; then `bun run purity` from the worktree root. For `packages/glance-react`: `bun run test`, `bun run lint`, `bun run check-types`.
- One commit per task, staging named files only (never `git add -A` or `.`). End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests stub transport the existing way: `(provider as any).octokit = { request, graphql }` (see `tests/gh-automerge.test.ts`), or replace `globalThis.fetch` when the real Octokit client must run (see `tests/gh-merge.test.ts`). Timer delays are captured by replacing `globalThis.setTimeout` with one that records `ms` and never runs the callback (see `tests/actioncable-runtime.test.ts:94`), then disposing after the capture. Such a test must stub `(provider as any).octokit = { request, graphql }` directly: the real Octokit client's throttling plugin schedules every request through `setTimeout`, so with the recorder installed a real-client fill never runs and the test hangs. Tests that need the real client use `useInstantTimers()` from `tests/helpers/gh-fill-fixture.ts` instead and assert no delays.
- When a change moves an existing test's request sequence (for example merge now reads GraphQL first), update that test's stub; never weaken an assertion about behaviour that did not change.
- A capability or support change updates `tests/live/expectations.ts` in the same task, so `tests/live-expectations.test.ts` stays green.

## Review Focus

1. A watcher disposed before its first fetch resolves must deliver no update and no status (Task 1).
2. A repository whose `viewerDefaultMergeMethod` comes back null must still merge with an allowed method (Task 6).
3. A streamed `restRequest` on a 204 or 304 must resolve with a null body, not crash (Task 11).
4. A create whose follow-up step fails and whose read-back also fails must still throw `PartialCreateError` with the PR number and `pullRequest: null` (Task 10).
5. Removing the branch of a merged fork PR whose fork was deleted must report why in `sourceBranchNotDeleted` and send no DELETE, also when the read-back fails (Task 7).

---

### Task 1: Poll-only watcher and the `polling` state

**Files:**
- Modify: `packages/glance/src/RealtimeWatcher.ts`
- Modify: `packages/glance/src/types.ts:445-457` (`MRDashboardProps.connection`)
- Create: `packages/glance/tests/realtime-watcher-poll-only.test.ts`

**Interfaces:**
- Produces: `createRealtimeWatcher<T>(params: { subscribe?: (callbacks: WatcherSubscribeCallbacks) => () => void; fetch: () => Promise<T | null>; onUpdate: (data: T) => void; onStatusChange?: (status: WatcherStatus) => void; options?: RealtimeWatcherOptions }): () => void`. Omitting `subscribe` selects poll-only mode.
- Produces: `WatcherStatus['connection']` and `MRDashboardProps['connection']` include `'polling'`.

- [ ] **Step 1: Write the failing tests** in `tests/realtime-watcher-poll-only.test.ts`:
  - `first update already carries polling`: record `onStatusChange` and `onUpdate` calls in one ordered log; expect the log to start `['status:polling', 'update']`.
  - `healthy poll waits pollIntervalMs with at most 10% jitter`: `pollIntervalMs: 60_000`; captured next delay is within `[54_000, 66_000]`.
  - `a failed poll retries no sooner than pollIntervalMs`: fetch throws; captured delay `>= 60_000`; status `{ connection: 'reconnecting', consecutiveErrors: 1 }` with `lastError.message` equal to the thrown message.
  - `a RateLimitedError waits for retryAfterMs when later`: fetch throws `new RateLimitedError('limited', { kind: 'secondary', resetAt: null, retryAfterMs: 300_000, operation: 'x' })`; captured delay `>= 300_000`.
  - `recovery returns to polling`: fail once, then succeed; last status is `{ connection: 'polling', consecutiveErrors: 0 }`.
  - `a null fetch reports polling and delivers nothing`: fetch resolves null; `onUpdate` never called; a `polling` status is emitted.
  - `dispose before the first fetch resolves delivers nothing`: dispose while the fetch promise is pending, then resolve it; no update, no status.
  - `push mode keeps its fast first retry`: with a `subscribe` that never connects and a failing fetch, the captured retry delay is `< 2_000`.
- [ ] **Step 2: Run** `bun test tests/realtime-watcher-poll-only.test.ts` from `packages/glance`. Expected: FAIL (`polling` never emitted).
- [ ] **Step 3: Implement** poll-only mode in `createRealtimeWatcher`. Healthy delay: `pollIntervalMs` (default unchanged, 30_000) with the existing ±10% jitter. Failure delay in poll-only mode: `max(fullJitterBackoff, pollIntervalMs, rateLimitWaitMs)`, where `rateLimitWaitMs` is `retryAfterMs`, else `Date.parse(resetAt) - Date.now()`, else 0, for a `RateLimitedError` (import from `./errors.ts`). Status: emit `polling` before the first `onUpdate` and after any successful fetch that changes the state (null included); `reconnecting` on failures. Push mode (with `subscribe`) keeps its current timing and status logic byte for byte. Add `'polling'` to both unions with a one-line doc: "data is fresh as of the last poll; no push channel".
- [ ] **Step 4: Run** the new file plus `tests/mrdashboard-status.test.ts`. Expected: PASS.
- [ ] **Step 5: Run the gates and commit** `glance: poll-only watcher mode and the polling connection state`.

### Task 2: GitHub `watchMR` and poll-only dashboards

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts:1627-1639` (`watchMR`)
- Modify: `packages/glance/src/MRDashboard.ts:542-603` (`createBranchDashboard`), `:663-793` (`createDashboardGroup`)
- Modify: `packages/glance/src/GitProvider.ts:855-870` (`watchMR` doc), `tests/live/expectations.ts` (GitHub `watchMR`: `support: 'supported'`, note "Polls every 60s by default; GitHub has no push channel.")
- Create: `packages/glance/tests/gh-watch-mr.test.ts`
- Modify: `packages/glance/tests/mrdashboard-status.test.ts`

**Interfaces:**
- Consumes: Task 1's poll-only `createRealtimeWatcher`.
- Produces: `GitHubProvider.watchMR(projectPath, mrIid, currentUserNumericId, onUpdate, options?): () => void`, poll-only, default interval `60_000`.

- [ ] **Step 1: Write the failing tests.** In `tests/gh-watch-mr.test.ts`:
  - `watchMR does not throw and delivers the PR from one GraphQL fill per poll` (fill stub from `tests/helpers/gh-fill-fixture.ts` with `useInstantTimers()`; one `graphql` call before the first update, and the rules REST read only when cold, as `tests/gh-fill-cost.test.ts:97` counts).
  - `default interval is 60s` (captured delay within `[54_000, 66_000]`) and `pollIntervalMs overrides it` (`5_000` gives `[4_500, 5_500]`); these two stub `octokit` directly and use the recording `setTimeout` (Global Constraints).
  - `a fill warning reports reconnecting with its message`: fill rejects; status `reconnecting`, `lastError` is a `ReadBackFailedError` with `writeApplied: false`, `operation: 'watchMR'`.
  - `a contexts warning still delivers the PR` (second checks page fails; PR delivered with pipeline status `pending`).
  - `createDashboard({ mrIid }) on GitHub delivers connection polling`.
  In `tests/mrdashboard-status.test.ts`:
  - `branch dashboard without subscribePullRequestEvents reports polling`.
  - `group dashboard without subscribePullRequestEvents reports polling`.
  - `branch dashboard with subscribePullRequestEvents still reports connected` (GitLab-shaped fake; pins the ruling).
- [ ] **Step 2: Run** both files. Expected: FAIL (`watchMR` throws; dashboards report `connected`).
- [ ] **Step 3: Implement.** `watchMR` runs `createRealtimeWatcher` with no `subscribe`; fetch is `fetchSingleMR(projectPath, mrIid, currentUserNumericId, onWarning)`, throwing `new ReadBackFailedError(warning.message, { operation: 'watchMR', projectPath, iid: mrIid, writeApplied: false })` only for a `source: 'fill'` warning. Capture the warning in the callback and throw after `fetchSingleMR` returns: a throw inside `onWarning` is swallowed by the provider's `warn()` (`GitHubProvider.ts:3519-3528`). Options: `pollIntervalMs ?? 60_000`, `onStatusChange`, `logger ?? this.log`, `logContext ?? \`watchMR:${projectPath}!${mrIid}\``. In `MRDashboard.ts`, both dashboards omit `subscribe` when `provider.subscribePullRequestEvents` is absent and keep today's code otherwise.
- [ ] **Step 4: Run** the two files and `tests/live-expectations.test.ts`. Expected: PASS.
- [ ] **Step 5: Run the gates and commit** `glance: GitHub watchMR polls every 60s; GitHub dashboards report polling`.

### Task 3: `ConnectionStatusBadge` learns `polling`

**Files:**
- Modify: `packages/glance-react/lib/components/forge/ConnectionStatusBadge.tsx`
- Modify: `packages/glance-react/lib/stories/ConnectionStatusBadge.stories.tsx`
- Create: `packages/glance-react/lib/components/forge/ConnectionStatusBadge.test.ts` (vitest; render with `renderToStaticMarkup` from `react-dom/server` and `createElement`, so no new dependency)

**Interfaces:**
- Consumes: Task 1's union (`ConnectionStatus` in `lib/hooks/useDashboard.ts` derives from it; no hook change).
- Produces: `ConnectionState` includes `'polling'`.

- [ ] **Step 1: Write the failing tests:** `polling is hidden by default like connected` (renders nothing); `polling renders its label with showWhenConnected` (label present, no spinner, no pulse).
- [ ] **Step 2: Run** `bun run test` in `packages/glance-react`. Expected: FAIL (type error or missing config).
- [ ] **Step 3: Implement.** Add `'polling'` to `ConnectionState` and `STATUS_CONFIG` (`color: 'neutral'`, `variant: 'subtle'`, `dot: true`), and give its dot a colour class beside the existing ones at `ConnectionStatusBadge.tsx:95-99` (a neutral token such as `bg-muted-foreground`; confirm it exists in the kit's tokens); hide it by default exactly like `connected`. Label: 2 to 6 words per the rt:ui-copy skill (load it), for example "Polling for updates". Add the state to the story's "all states" render.
- [ ] **Step 4: Run** `bun run test`, `bun run lint`, `bun run check-types` in `packages/glance-react`. Expected: PASS.
- [ ] **Step 5: Render check.** Start Storybook (`bun storybook` in `packages/glance-react`, port 6006; stop it by PID afterwards), open the ConnectionStatusBadge story through Fast Browser (the `fast-browser:browser-driver` agent on `haiku`/`medium`), screenshot light and dark, and say plainly what looks wrong. Save the screenshots under `.superpowers/` for the report.
- [ ] **Step 6: Commit** `glance-react: ConnectionStatusBadge shows the polling state`.

### Task 4: `sourceProjectPath` on GitHub pull requests

**Files:**
- Modify: `packages/glance/src/types.ts` (`PullRequest`, `ProviderCapabilities`)
- Modify: `packages/glance/src/githubFill.ts:65-160` (node type, `fillFields`), `:520-595` (mapping)
- Modify: `packages/glance/src/GitHubProvider.ts:687` and `packages/glance/src/GitLabProvider.ts:971` (capabilities)
- Modify: `packages/glance/tests/helpers/gh-fill-fixture.ts` (add `headRepository`), `tests/gh-fill-query.test.ts`, `tests/gh-fill-provider.test.ts`

**Interfaces:**
- Produces: `PullRequest.sourceProjectPath?: string | null` (GitHub: head repo `owner/repo`, null for a deleted fork; GitLab: absent). `ProviderCapabilities.canReportSourceProject?: boolean` (GitHub true, GitLab false).

- [ ] **Step 1: Write the failing tests:** `fill selects headRepository at both weights` (query string contains `headRepository { nameWithOwner }` for `listWeight` true and false); `sourceProjectPath maps a same-repo PR, a fork and a deleted fork` (`'o/r'`, `'fork/r'`, `null`); `capability flags` (GitHub true, GitLab false). `tests/gh-fill-cost.test.ts` counts stay unchanged.
- [ ] **Step 2: Run** the three files. Expected: FAIL.
- [ ] **Step 3: Implement** the field (`headRepository: { nameWithOwner: string } | null` on `GHFillNode`; `sourceProjectPath: node.headRepository?.nameWithOwner ?? null`) and the flags, with doc comments on both new fields.
- [ ] **Step 4: Run** the files plus `tests/gh-fill-fixture-restore.test.ts`. Expected: PASS.
- [ ] **Step 5: Run the gates and commit** `glance: sourceProjectPath on GitHub pull requests`.

### Task 5: GitHub rebase

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts:691` (`canRebase: true`), `:2061-2072` (`rebasePullRequest`)
- Modify: `packages/glance/src/GitProvider.ts:540-546` (doc), `tests/live/expectations.ts:74-78` (GitHub `rebasePullRequest`: `{ support: 'supported', capability: 'canRebase' }`), `tests/live/conformance.ts` comments at `runUnsupportedConformance` and `runGitLabMutationConformance` that say GitHub cannot rebase
- Create: `packages/glance/tests/gh-rebase.test.ts`
- Modify (behaviour changes, update the assertion): `tests/smoke.test.ts:185` (`canRebase` is now true); `tests/live-expectations.test.ts:97-99` (it asserts GitHub's `rebasePullRequest` is `unsupported`; after this task and Task 2 GitHub has no `unsupported` entry, so assert the tables differ on `fetchMergeRequestIndex`, GitHub `absent`, instead)

**Interfaces:**
- Produces: `rebasePullRequest(projectPath, mrIid): Promise<void>`: one GraphQL read `repository(owner, name) { pullRequest(number) { id headRefOid } }`, then `updatePullRequestBranch(input: { pullRequestId, expectedHeadOid, updateMethod: REBASE }) { pullRequest { headRefOid } }`, both through `graphqlOrThrow` with op `'rebasePullRequest'`.

- [ ] **Step 1: Write the failing tests:** `sends updatePullRequestBranch with REBASE and the head it read` (variables carry the read `id` and `headRefOid`; query contains `updateMethod: REBASE`); `costs two GraphQL requests and no REST`; `a missing pull request throws` (`rebasePullRequest failed: GitHub returned no pull request for o/r!7`); `a GraphQL refusal surfaces` (message starts `rebasePullRequest failed: GitHub GraphQL returned`); `canRebase is true`; `a BEHIND pull request asks for a rebase` (fill node with `mergeStateStatus: 'BEHIND'` through `getMRDashboardProps`: `blockers.needsRebase` true, `rebaseButton.visible` true, `readiness.reasons` contains `'behind'`).
- [ ] **Step 2: Run** `tests/gh-rebase.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `rebasePullRequest` as in Interfaces.
- [ ] **Step 4: Run** it plus `tests/live-expectations.test.ts`. Expected: PASS.
- [ ] **Step 5: Run the gates and commit** `glance: GitHub rebase through updatePullRequestBranch`.

### Task 6: Merge context, merge-method pick and auto-merge method

**Files:**
- Create: `packages/glance/src/githubMerge.ts`
- Modify: `packages/glance/src/GitHubProvider.ts:1768-1798` (`mergePullRequest` direct path), `:2119-2143` (`setAutoMerge`); `packages/glance/src/GitProvider.ts:548-556` (`setAutoMerge` doc: GitHub picks an allowed method)
- Create: `packages/glance/tests/gh-merge-method.test.ts`
- Modify: `packages/glance/src/types.ts:565-570` (`MergeMethod` doc) and `:596-605` (`MergePullRequestInput` doc): on GitHub an omitted method is now the repository's default, not "merge"; `:651-652` (`canEnqueue` doc: also gates merge's queue routing)
- Modify (stub updates only; each must serve the merge context read before what it already serves, behaviour unchanged): `tests/gh-merge.test.ts`, `tests/gh-automerge.test.ts`, `tests/gh-enqueue.test.ts:23-33` (merge read-back case), `tests/gh-fill-provider.test.ts:485` (serve the context, then 502 for the fill) and `:905-1000` (`landedMerge`'s `stubForge` must answer the context query), and the `check:node` smoke `tests/node-smoke.mjs:200-229` (both setAutoMerge checks answer every query with the mutation payload and one reads `mutations[0].id`; answer the context query first and assert on the mutation call)

**Interfaces:**
- Produces in `githubMerge.ts`:
  - `export interface GitHubMergeContext { nodeId: string; headSha: string; headBranch: string; headRepo: string | null; defaultMethod: MergeMethod | null; allowed: Record<MergeMethod, boolean>; queueEnabled: boolean; inQueue: boolean; queueEntry: MergeQueueEntry | null }`
  - `export const MERGE_CONTEXT_QUERY: string` selecting `viewerDefaultMergeMethod mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed pullRequest(number: $number) { id headRefOid headRefName headRepository { nameWithOwner } isMergeQueueEnabled isInMergeQueue mergeQueueEntry { position state } }`
  - `export function pickMergeMethod(op: string, projectPath: string, ctx: Pick<GitHubMergeContext, 'defaultMethod' | 'allowed'>, input?: Pick<MergePullRequestInput, 'mergeMethod' | 'squash'>): MergeMethod`
- Produces on `GitHubProvider`: `private mergeContext(op: string, projectPath: string, mrIid: number): Promise<GitHubMergeContext>` (one `graphqlOrThrow`; null pull request throws `${op} failed: GitHub returned no pull request for ${projectPath}!${mrIid}`).

- [ ] **Step 1: Write the failing tests** in `tests/gh-merge-method.test.ts`. `pickMergeMethod` table (spec section 3, step 3):
  - caller `mergeMethod: 'rebase'` on a repo allowing it gives `'rebase'`;
  - `squash: true` gives `'squash'`;
  - no input, default `SQUASH`, squash-only gives `'squash'`;
  - no input, default null, all allowed gives `'merge'`; default null, only rebase allowed gives `'rebase'` (Review Focus 2);
  - `squash: false`, default squash, merge allowed gives `'merge'`; `squash: false`, squash-only throws `mergePullRequest failed: o/r does not allow a merge that is not a squash (allowed: squash)`;
  - caller `mergeMethod: 'merge'` on a squash-only repo throws `mergePullRequest failed: o/r does not allow merge merges (allowed: squash)`.
  Provider tests:
  - `merge on a squash-only repo sends merge_method squash` (PUT body);
  - `merge sends the caller's method and picks its commit message` (squash picks `squashCommitMessage`);
  - `a forbidden method sends no PUT`;
  - `a direct merge costs the context read, the PUT and the read-back` (1 GraphQL + 1 PUT + fill);
  - `setAutoMerge passes the picked method` (mutation variables `mergeMethod: 'SQUASH'` on a squash-only repo; no REST node-id read);
  - `setAutoMerge omits mergeMethod on a queue branch`.
- [ ] **Step 2: Run** the new file. Expected: FAIL.
- [ ] **Step 3: Implement** `githubMerge.ts` and wire `mergeContext` + `pickMergeMethod` into the direct merge path (always send `merge_method`; `mergeCommitFields(input, method)` with the resolved method) and into `setAutoMerge` (`mergeMethod: method.toUpperCase()` unless `queueEnabled`; node id from the context). The queue branch of `mergePullRequest` is Task 8; until then a queue-enabled context takes the direct path.
- [ ] **Step 4: Run** `tests/gh-merge-method.test.ts`, `tests/gh-merge.test.ts`, `tests/gh-automerge.test.ts`. Expected: PASS.
- [ ] **Step 5: Run the gates and commit** `glance: GitHub merge and auto-merge use an allowed merge method`.

### Task 7: Merge read-back always reports branch removal

**Files:**
- Modify: `packages/glance/src/errors.ts`, `packages/glance/src/index.ts:132-140` (export)
- Modify: `packages/glance/src/GitHubProvider.ts:1794-1849` (`mergePullRequest` tail, `removeMergedSourceBranch`), `:970-996` (`fetchSingleMRAfterMutation` verb union gains `'Queued'` for Task 8)
- Create: `packages/glance/tests/gh-merge-readback.test.ts`
- Modify: `tests/gh-merge.test.ts` (its `stubGitHub` must serve the context's `headRefName` and `headRepository` for every delete and fork case; drop its now-dead raw `GET /pulls/N` branch at line 98); `tests/gh-fill-provider.test.ts:930-975` (behaviour change: the REST head-repo read is gone, so its rate-limited and forbidden head-read cases are deleted, and its unknown-head-repo case becomes `headRepository: null` in the context)

**Interfaces:**
- Consumes: Task 6's merge path and `GitHubMergeContext.headBranch`/`headRepo`.
- Produces: `export class MergeReadBackFailedError extends ReadBackFailedError { readonly sourceBranchNotDeleted?: string; readonly queued?: MergeQueueEntry; constructor(message: string, details: { operation: string; projectPath: string; iid: number; writeApplied: boolean; cause?: unknown; sourceBranchNotDeleted?: string; queued?: MergeQueueEntry }) }`, `name = 'MergeReadBackFailedError'`. `writeApplied` is a constructor argument (false in Task 8's already-queued case).
- Produces: `private removeMergedSourceBranch(branch: string, headRepo: string | null): Promise<string | null>`, fed from the merge context (spec section 4d as amended): no REST read of the PR; a null `headRepo` resolves the "head repository is unknown" reason without a DELETE.

- [ ] **Step 1: Write the failing tests:**
  - `read-back fails, delete succeeds`: throws `MergeReadBackFailedError` (also `instanceof ReadBackFailedError`), `writeApplied: true`, `sourceBranchNotDeleted` undefined; the DELETE targets the context's `headRepository` and `headRefName`; no REST `GET /pulls/7`.
  - `read-back fails, delete refused`: `sourceBranchNotDeleted` starts `The source branch "feat" was not deleted:`.
  - `read-back succeeds`: a merge with branch removal makes 4 requests (context, PUT, fill, DELETE) and no REST `GET /pulls/7`; a fork PR's DELETE targets the fork.
  - `a deleted fork reports why and sends no DELETE`, with the read-back succeeding and with it failing (`headRepository: null`; message names the unknown head repository; Review Focus 5).
  - `without shouldRemoveSourceBranch a failed read-back still throws MergeReadBackFailedError with no branch field`.
- [ ] **Step 2: Run** the new file. Expected: FAIL.
- [ ] **Step 3: Implement** the class (exported from `index.ts`) and the reordered tail: read back in a try; remove the branch when asked, from the merge context; then return the result or throw `MergeReadBackFailedError` carrying the original message and cause.
- [ ] **Step 4: Run** it plus `tests/gh-merge.test.ts`. Expected: PASS.
- [ ] **Step 5: Run the gates and commit** `glance: a landed GitHub merge always reports whether its branch was deleted`.

### Task 8: Merge enters the merge queue

**Files:**
- Modify: `packages/glance/src/types.ts:467-468` (`MRDashboardActions.merge`), `:628-631` (`MergePullRequestResult`)
- Modify: `packages/glance/src/GitHubProvider.ts` (`mergePullRequest` queue branch; `enqueuePullRequest` shares a private `enqueueByNodeId`)
- Modify: `packages/glance/src/GitProvider.ts:505-521` (`mergePullRequest` doc: queue routing, default method)
- Create: `packages/glance/tests/gh-merge-queue.test.ts`

**Interfaces:**
- Consumes: Task 6's `GitHubMergeContext`; Task 7's `MergeReadBackFailedError`.
- Produces: `MergePullRequestResult = PullRequest & { sourceBranchNotDeleted?: string; queued?: MergeQueueEntry }`; `MRDashboardActions.merge: (input?: MergePullRequestInput) => Promise<MergePullRequestResult>`; `private enqueueByNodeId(op: string, projectPath: string, mrIid: number, nodeId: string, expectedHeadSha: string | null): Promise<MergeQueueEntry>`.

- [ ] **Step 1: Write the failing tests:**
  - `a queue branch enqueues with the context's node id` (no REST node-id read, no PUT; result `queued` equals the mutation's `{ position, state }`; result `state` is `'opened'`).
  - `input.sha becomes expectedHeadOid`.
  - `a PR the queue dropped is enqueued again` (`inQueue: false`).
  - `already in the queue makes no write` (no mutation; `queued` is the context's `mergeQueueEntry`).
  - `queue-incompatible input is refused before any write`, one case each for `mergeMethod`, `squash: false`, `commitMessage`, `squashCommitMessage`, `shouldRemoveSourceBranch: false` (zero mutations, zero PUTs; message names the field).
  - `read-back failure after enqueue`: `MergeReadBackFailedError`, `writeApplied: true`, `queued` set.
  - `read-back failure when already queued`: `writeApplied: false`, `queued` set.
  - `the dashboard merge action returns the queued result` (`createDashboard(...).actions.merge()` resolves with `queued`).
- [ ] **Step 2: Run** the new file. Expected: FAIL.
- [ ] **Step 3: Implement** the queue branch (spec section 3, step 2) and the type changes; `enqueuePullRequest` keeps its public behaviour by resolving its node id then calling `enqueueByNodeId`.
- [ ] **Step 4: Run** it plus `tests/gh-enqueue.test.ts` and `tests/gh-merge.test.ts`. Expected: PASS.
- [ ] **Step 5: Run the gates and commit** `glance: GitHub merge enters the merge queue when the base uses one`.

### Task 9: By-branch reads report incomplete answers

**Files:**
- Modify: `packages/glance/src/GitProvider.ts:52-103` (`FetchPullRequestsWarning.branch`), `:370-395` (both by-branch signatures and docs)
- Modify: `packages/glance/src/types.ts` (`ProviderCapabilities.canReportIncompleteBranchReads`)
- Modify: `packages/glance/src/GitHubProvider.ts:1248-1466` (both reads), capabilities; `packages/glance/src/GitLabProvider.ts:971` (flag `false` only)
- Create: `packages/glance/tests/gh-by-branch-warnings.test.ts`

**Interfaces:**
- Produces: `export interface ByBranchReadOptions { onWarning?: (warning: FetchPullRequestsWarning) => void }` (exported from `GitProvider.ts` and `index.ts`); `fetchPullRequestByBranch(projectPath, sourceBranch, state?, options?: ByBranchReadOptions)`; `fetchPullRequestsByBranches?(projectPath, branches, state?, options?: ByBranchReadOptions)`; `FetchPullRequestsWarning.branch?: string`; `ProviderCapabilities.canReportIncompleteBranchReads?: boolean` (GitHub true, GitLab false).

- [ ] **Step 1: Write the failing tests** (every warning carries `branch`; every result is unchanged):
  - `a failed fast-path list warns request-failed/list with its status` (502; result null; `target: 'o/r'`).
  - `a failed fallback page warns request-failed/list`.
  - `a scan that hits the 500-PR cap warns page-cap/list` (five full pages, no match).
  - `a found PR whose fill fails warns request-failed/fill` (`target: warningTarget('o/r', 12)`).
  - `a confirmed miss warns nothing` (short page, no match).
  - `the batch warns fill for a found but unfilled PR and keeps null`.
  - `the batch forwards a contexts warning with branch and keeps the PR`.
  - `a throwing onWarning is ignored`.
  - `capability flags` (GitHub true, GitLab false).
- [ ] **Step 2: Run** the new file. Expected: FAIL.
- [ ] **Step 3: Implement** a private safe emitter that adds `branch` and swallows listener errors; thread it into both list legs, the scan cap, `fetchSingleMR`'s and `fillPullRequests`' `onWarning` (the batch maps each warning's PR number back to its branches).
- [ ] **Step 4: Run** it plus `tests/gh-by-branch.test.ts` and `tests/github-batch-by-branches.test.ts`. Expected: PASS.
- [ ] **Step 5: Run the gates and commit** `glance: GitHub by-branch reads report failed and capped reads`.

### Task 10: Partial create throws `PartialCreateError`

**Files:**
- Modify: `packages/glance/src/errors.ts`, `packages/glance/src/index.ts:132-140`
- Modify: `packages/glance/src/GitHubProvider.ts:1480-1537` (`createPullRequest`)
- Create: `packages/glance/tests/gh-create-partial.test.ts`
- Modify as needed: `tests/reviewers-assignees.test.ts`, `tests/draft.test.ts` (expectations that create stops at the first failed step)

**Interfaces:**
- Produces: `export type CreateFollowUpStep = 'reviewers' | 'assignees' | 'labels'`; `export interface FailedCreateStep { step: CreateFollowUpStep; message: string; cause?: unknown }`; `export class PartialCreateError extends ReadBackFailedError { readonly failedSteps: FailedCreateStep[]; readonly pullRequest: PullRequest | null; constructor(message: string, details: { projectPath: string; iid: number; failedSteps: FailedCreateStep[]; pullRequest: PullRequest | null; cause?: unknown }) }` with `operation: 'createPullRequest'`, `writeApplied: true`, `name = 'PartialCreateError'`. Message: `Created PR #<iid> but could not apply <steps joined by ", ">: <first step's message>`.

- [ ] **Step 1: Write the failing tests:** `a refused label write throws PartialCreateError` (`instanceof ReadBackFailedError`, `writeApplied` true, `iid` 42, `failedSteps` `[{ step: 'labels', ... }]` with the 422 in `message`, `pullRequest` non-null); `a refused reviewer step still applies assignees and labels` (request log contains both POSTs); `a transport failure is recorded as a failed step`; `a failed step plus a failed read-back still throws PartialCreateError with pullRequest null` (Review Focus 4); `with no failed step create returns the PR as before`.
- [ ] **Step 2: Run** the new file. Expected: FAIL.
- [ ] **Step 3: Implement** step-by-step attempts that record failures (HTTP, transport, `RateLimitedError`), then the read-back, then the throw.
- [ ] **Step 4: Run** it plus the existing create tests. Expected: PASS.
- [ ] **Step 5: Run the gates and commit** `glance: a partially applied GitHub create throws PartialCreateError`.

### Task 11: `restRequest` streams its body

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts:1617-1625` (`restRequest`), `:2916-2982` (`api`), `:3780` (`toResponse`)
- Modify: `packages/glance/src/GitProvider.ts:809-840` (`restRequest` doc: the body streams on both providers)
- Create: `packages/glance/tests/gh-rest-stream.test.ts`

**Interfaces:**
- Produces: `private api(method, path, body?, io?: { redirect?: 'manual'; stream?: boolean }): Promise<Response>`; `restRequest` passes `stream: true`, which sets Octokit's `request.parseSuccessResponseBody: false`. `toResponse` passes a `ReadableStream` body through untouched.

- [ ] **Step 1: Write the failing tests** with the real Octokit client and a fake `globalThis.fetch`:
  - `a reader can stop early`: the fake serves 64 chunks of 16 KiB from a pull-counting `ReadableStream` with `Content-Length`; reading 256 KiB then `reader.cancel()` leaves fewer than 64 pulls; `res.headers.get('content-length')` is preserved; status 200.
  - `a JSON body still parses` (`await res.json()` equals the served object).
  - `a 404 still resolves with ok false and a readable body`.
  - `a 204 and a 304 resolve with a null body` (Review Focus 3).
  - `other api() callers keep parsed bodies`: `discussionRepo` (`GitHubProvider.ts:1131`, reached through `fetchMRDiscussions`) still reads its repository.
- [ ] **Step 2: Run** the new file. Expected: FAIL (pull count equals 64).
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run** it plus `tests/gh-transport.test.ts` and `tests/gh-forge-reads.test.ts`. Expected: PASS.
- [ ] **Step 5: Run the gates and commit** `glance: GitHub restRequest streams its body so a caller can stop early`.

### Task 12: Live conformance cases (written, typechecked, never run)

**Files:**
- Create: `packages/glance/tests/live/githubGapsConformance.ts`
- Modify: `packages/glance/tests/live/conformance.ts` (export `check`, `assert`, `Inconclusive`, `createBranch`, `commitFile`, `runPrefix`; in `runUnsupportedConformance`, the "supported-path not exercised here" `watchMR` skip applies to GitLab only)
- Modify: `packages/glance/tests/live/runner.ts` (call `runGitHubGapsConformance(fixture, report)` after `runMergeConformance`)
- Modify: `packages/glance/harness_credentials.example.json` `_readme` (one line on `GLANCE_HARNESS_GITHUB_QUEUE_REPO`)

**Interfaces:**
- Consumes: everything above.
- Produces: `export async function runGitHubGapsConformance(fixture: ProviderFixture, report: Reporter): Promise<void>` (returns at once unless `fixture.name === 'github'`).

- [ ] **Step 1: Write the cases** (spec section 7), each through `check` with the method name it proves, cleaning up branches and PRs in `finally`:
  - `watchMR`: `pollIntervalMs: 5_000`; `pollUntil` the first update (30s cap); status `polling`; dispose.
  - `rebasePullRequest`: on two throwaway branches as the GitLab cycle does (`conformance.ts:1966-1972`): a target off the default branch and a one-commit source off the target; open the PR against the target, advance the target, rebase, `pollUntil` the PR head's parent is the target's new head. Never push to the default branch.
  - `mergePullRequest` default method: no method passed; the merge commit's shape matches `viewerDefaultMergeMethod` (squash: one parent and the PR's commits squashed; merge: two parents).
  - squash-only: read the fixture's merge settings; if already squash-only, restore them and record that a killed run left them; set squash-only (`PATCH /repos/{o}/{r}` through `restRequest`), merge with no method and arm auto-merge with no method, restore in `finally`; a 403 or 404 on the PATCH records a skip with the reason.
  - `fetchPullRequestByBranch` / `sourceProjectPath`: a same-repo PR reports the fixture's `owner/repo`.
  - `createPullRequest`: reviewer `glance-no-such-user-<runPrefix>` throws `PartialCreateError` whose `iid` is an open PR; close it.
  - `restRequest`: `GET /repos/{o}/{r}/commits?per_page=100` read through a 4 KiB cap and cancelled; the read stops at the cap.
  - queue (an environment variable rather than the spec's credentials-template entry, deliberately: it matches the existing `GLANCE_HARNESS_GITHUB_APPROVER` and sandbox variables and keeps the credentials file unchanged): with `GLANCE_HARNESS_GITHUB_QUEUE_REPO=owner/repo` set, a PR there merged with no input resolves with `queued`; unset, record a skip for `mergePullRequest` "queue path not run: GLANCE_HARNESS_GITHUB_QUEUE_REPO is unset".
- [ ] **Step 2: Run** `bun run check-types:live` and `bun test tests/live-expectations.test.ts tests/live-report.test.ts` from `packages/glance`. Expected: PASS. Do not run the live suite.
- [ ] **Step 3: Run the gates and commit** `glance: live conformance cases for watchMR, rebase, merge method, queue and honest reads`.

### Task 13: Version, docs and dist

**Files:**
- Modify: `packages/glance/package.json` (`"version": "0.31.0"`), `packages/glance/CHANGELOG.md` (new `## 0.31.0` above `## 0.30.0`), `packages/glance/README.md:26-31` (providers table)

- [ ] **Step 1: Write the CHANGELOG entry** in the 0.30.0 entry's style: a first "Breaking for an outside exhaustive switch" line for the `'polling'` member; then one bullet per change (watchMR polling and its 60s cost: 60 GraphQL plus up to 6 REST per hour; poll-only retries; rebase; merge method; queue routing and `queued`; `MergeReadBackFailedError`; `sourceProjectPath` and `canReportSourceProject`; by-branch `onWarning`, `branch` and `canReportIncompleteBranchReads`; `PartialCreateError`; streamed `restRequest`); and a "Consumers" bullet naming the daemon follow-ups from the spec.
- [ ] **Step 2: Fix the README table** so the GitHub row lists merge, approve, rebase, auto-merge, merge queue and polling watchMR, and the GitLab row stays accurate.
- [ ] **Step 3: Run every gate** (`bun test`, `bun run check-types`, `bun run check:node`, `bun run build`, `bun run check-types:live` in `packages/glance`; `bun run test`, `bun run lint`, `bun run check-types` in `packages/glance-react`; `bun run purity` at the root). Expected: all green; `dist/` rebuilt.
- [ ] **Step 4: Commit** `glance 0.31.0: changelog, README and version`. Do not publish.
