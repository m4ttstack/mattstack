# Daemon Background Jobs on GitHub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the rt daemon's project PR sync, desktop notifications, live refresh and run outcomes on GitHub repos (RT-542, RT-543, RT-544, RT-545).

**Architecture:** Daemon-only, on glance's existing GitHub reads. Every GitLab code path stays as it is; each changed function gains a GitHub arm chosen by the repo's forge. GitHub reads that can fail silently (a failed fill returning null) are wrapped so a failure is an error, never "no PR".

**Tech Stack:** Bun, TypeScript, `@mattstack/glance` (workspace), `bun:test`.

**Spec:** `docs/superpowers/specs/2026-11-11-daemon-github-background-design.md`

## Global Constraints

- Write fence: `lib/daemon/project-sync.ts`, `lib/daemon/cache-refresh.ts`, `lib/daemon/freshness.ts`, `lib/daemon/handlers/project-mrs.ts`, `lib/daemon/run-outcome-refresher.ts`, `lib/daemon/discussions-poller.ts`, `lib/notifier.ts`, `lib/runs/outcome.ts`, `commands/daemon.ts`, new files under `lib/daemon/`, their `__tests__` folders, and `lib/daemon/handlers/mr.ts` for the GitHub write-back skip only (plus its tests). Never `packages/glance`, `lib/ci/`, `lib/mcp/`, `apps/`, `extensions/`, `plugins/`.
- GitLab behaviour does not change: same requests, cadence, store writes, notifications, replies, log wording. Existing GitLab tests stay untouched and green.
- No new poll or interval beyond: GitHub project sync on the existing 5-minute cycle and daily deep with top-up cap 15; glance's GitHub events watcher at its 60-second default for live repos; run-outcome failure backoff of `openTtlMs * 2^(failures - 1)` capped at 6 hours.
- No GitHub read that can fail may be stored as "no PR" or prune a stored PR.
- Tests stub the provider or `fetch`; no live forge calls. Never run rt, the daemon or a built binary; never set HOME in a command.
- Run tests from the worktree root, one touched file at a time: `bun test <file>`. Before the PR: `bun run typecheck` and `bun run purity`.
- No em or en dashes in anything written. Comments only for constraints the code cannot show. Stage named files only.

## Review Focus

- A Mac with both forges whose GitLab id resolves first must still resolve the GitHub id (Task 3 test `resolves GitHub after GitLab is already resolved`).
- A GitHub token change while a live watch runs must restart the watch on the new provider (Task 9 test `a token change restarts the GitHub watch`), and the next GitHub identity read must use the new token (Task 3 test `a new token re-reads the GitHub user`).
- A board demand naming `Octo` must match a GitHub PR by `octo`, while GitLab keeps its exact match (Task 5 tests `authorListed ignores case on GitHub only` and Task 6 test `GitHub delta keeps a scope author in another case`).
- A merged GitHub PR whose branch now carries a newer open PR must not displace the open one; a merged PR that is the branch's newest is kept (Task 5 test `terminal rows follow fetchDeltaFrom's reuse rule`).
- You approving your own GitHub PR must not fire "MR Approved" (Task 4 test `self-approval on a GitHub PR is suppressed`).

---

### Task 1: Parse GitHub PR links in run outcomes

**Files:**
- Modify: `lib/runs/outcome.ts:21-31`
- Test: `lib/runs/__tests__/outcome.test.ts`

**Interfaces:**
- Produces: `parseMrRef(value: string | null | undefined): { iid: number; url: string | null } | null` (signature unchanged).

- [ ] **Step 1: Write the failing test** in the `parseMrRef` describe:

```ts
test("reads a GitHub pull url on any host and a #iid", () => {
  expect(parseMrRef("https://github.com/acme/app/pull/12")).toEqual({ iid: 12, url: "https://github.com/acme/app/pull/12" });
  expect(parseMrRef("https://ghe.example.com/acme/app/pull/7/files")).toEqual({ iid: 7, url: "https://ghe.example.com/acme/app/pull/7/files" });
  expect(parseMrRef("https://github.com/acme/app/pull/12?w=1")).toEqual({ iid: 12, url: "https://github.com/acme/app/pull/12?w=1" });
  expect(parseMrRef("#34")).toEqual({ iid: 34, url: null });
  expect(parseMrRef("https://github.com/acme/app/pulls")).toBeNull();
  expect(parseMrRef("#0")).toBeNull();
});
```

- [ ] **Step 2: Run** `bun test lib/runs/__tests__/outcome.test.ts`. Expected: the new test fails; the old ones pass.
- [ ] **Step 3: Implement.** Add a `PULL_URL = /\/pull\/(\d+)(?:[/?#]|$)/` tried after `MR_URL` for http(s) links, and widen the bare form to `/^[!#]?(\d+)$/`.
- [ ] **Step 4: Run** the same file. Expected: all pass.
- [ ] **Step 5: Commit** `git add lib/runs/outcome.ts lib/runs/__tests__/outcome.test.ts && git commit -m "runs: read GitHub /pull/N and #N links in outcomes (RT-545)"`

### Task 2: Back off failed run-outcome lookups

**Files:**
- Modify: `lib/daemon/run-outcome-refresher.ts` (opts, `failedAt`, the due check, the failure and success branches)
- Test: `lib/daemon/__tests__/run-outcome-refresher.test.ts`

**Interfaces:**
- Produces: `OutcomeRefresherOpts.maxBackoffMs?: number` (default `6 * 60 * 60_000`). The base wait is `openTtlMs`.

- [ ] **Step 1: Write the failing tests**, using the file's existing harness (fake `now`, a `getMr` that records calls):
  - `a failing run waits 10, 20, then 40 minutes between asks`: `getMr` always `{ ok: false }`. Ticks at t=0 (call 1), t=10m (call 2), t=29m (no call), t=30m (call 3), t=69m (no call), t=70m (call 4). Assert the call count after each tick.
  - `the backoff caps at maxBackoffMs`: with `openTtlMs: 10m, maxBackoffMs: 30m`, failures at t=0, 10m, 30m, then the next ask happens at t=60m, not later (30m cap). Assert calls at 60m and 90m.
  - `a success resets the backoff`: fail at t=0 and t=10m, succeed at t=30m with `state: "opened"`, then the next ask is at t=40m (plain open TTL). Then make it fail again at t=40m: the next ask is at t=50m (first failure wait).
- [ ] **Step 2: Run** `bun test lib/daemon/__tests__/run-outcome-refresher.test.ts`. Expected: the three new tests fail; existing ones pass (the first failure still waits `openTtlMs`, so `a failed call ... is not retried before the TTL` holds).
- [ ] **Step 3: Implement.** Replace `failedAt: Map<string, number>` with `Map<string, { at: number; failures: number }>`; due when `now - at >= Math.min(openTtlMs * 2 ** (failures - 1), maxBackoffMs)`; a failure increments, a success deletes.
- [ ] **Step 4: Run** the same file. Expected: all pass.
- [ ] **Step 5: Commit** `git add lib/daemon/run-outcome-refresher.ts lib/daemon/__tests__/run-outcome-refresher.test.ts && git commit -m "run outcomes: double the wait after each failed lookup, capped at 6 hours (RT-545)"`

### Task 3: Your identity on each forge

**Files:**
- Modify: `lib/notifier.ts` (add the `SelfIds` type only)
- Modify: `lib/daemon/freshness.ts` (per-token GitHub self cache replacing the per-provider `githubSelfIds`, `getSelfIds`, `resolveUserIdAcrossTracking`, `resolveSelfUsername`, new `cachedSelfUsername`, wrappers)
- Test: `lib/daemon/__tests__/freshness-self-identity.test.ts` (new; copy the spies and `repoWithOrigin` helper from `freshness-forge-router.test.ts`: `loadSecrets`, `resolveGithubToken`, `readUserIntegrationOverrides`, `fetch` answering `https://api.github.com/user` with `{ id: 9, login: "octo" }` and GitLab `/user` with `{ id: 7, username: "gl-me" }`)

**Interfaces:**
- Produces in `lib/notifier.ts`: `export interface SelfIds { gitlab: number | null; github: number | null }`.
- Produces in `lib/daemon/freshness.ts` (core method plus exported wrapper each):
  - `getSelfIds(): SelfIds`: synchronous, from caches. `gitlab` is today's `userId`; `github` is the id cached for the GitHub token most recently used to build a GitHub context, or null.
  - GitHub self cache: `Map<token, { id: number; login: string }>`, written only on a successful `validateToken`. `getSelfUserId(ctx)` reads and fills it through the token its provider was built with (the `githubProviders` entry), so repos sharing a token make one `/user` call. GitHub counts as resolved exactly when the cache holds the current token's user: a failed read is retried on the next call, and a new token starts unresolved.
  - `resolveUserIdAcrossTracking(repoIndex, tracking): Promise<void>`: the GitLab half unchanged, except that its early return and its warning cover GitLab only. Then, unless GitHub is resolved, it takes the first tracked repo with the `branches` or `project-mrs` grant whose remote is GitHub, builds its `getRepoContext` and calls `getSelfUserId`.
  - `resolveSelfUsername(repoName: string, repoPath: string): Promise<string | null>`: GitLab repo as today; GitHub repo returns the cached login of that repo's provider, reading `/user` once if needed.
  - `cachedSelfUsername(repoName: string, repoPath: string): Promise<string | null>`: no network. It finds the forge with `isGitHubRepo(repoPath)` (the cached `git config` read). A GitHub repo gets the login cached for the current GitHub token, or null (never the GitLab name); any other repo gets the GitLab `selfUsername`.
- Consumes: existing `getRepoContext`, `getSelfUserId(ctx)`.

- [ ] **Step 1: Write the failing tests:**
  - `getSelfIds reports the GitHub id after resolution`: one tracked GitHub repo (`mode: "poll", caches: ["branches"]`), `secrets = { githubToken: "ghp_x" }`; after `resolveUserIdAcrossTracking`, `getSelfIds()` equals `{ gitlab: null, github: 9 }`, and exactly one request went to `/user` on api.github.com.
  - `resolves GitHub after GitLab is already resolved`: one GitLab repo and one GitHub repo, both tokens. After one call, `getSelfIds()` is `{ gitlab: 7, github: 9 }`.
  - `a failed GitHub read is retried; a success is not re-read`: the first `/user` answers 401, so `getSelfIds().github` is null. The second `resolveUserIdAcrossTracking` makes one more `/user` request and resolves 9. A third call makes no request. Two tracked GitHub repos sharing the token cause one `/user` request in total.
  - `a GitHub-only Mac never logs the GitLab warning`: spy the freshness logger's `warn` (or capture through `lazyChildLogger`'s test seam as other freshness tests do). No `gitlabToken` and GitHub user read fails (401): exactly one warning whose message contains `which GitHub user you are` and `rt setup github connect`, none containing `userId is unresolved`. A second call adds no warning.
  - `a new token re-reads the GitHub user`: resolve with `ghp_a`, then set `secrets.githubToken = "ghp_b"` and build the context again; `getSelfIds().github` is null until `resolveUserIdAcrossTracking` runs again, which makes one more `/user` request.
  - `cachedSelfUsername returns the GitHub login for a GitHub repo and the GitLab username for a GitLab one`: after resolution, `cachedSelfUsername(githubRepo, path)` is `"octo"` and `cachedSelfUsername(gitlabRepo, path)` is `"gl-me"`.
  - `cachedSelfUsername never gives a GitHub repo the GitLab name`: with only the GitLab username resolved and a GitHub repo never routed in this process, `cachedSelfUsername(githubRepo, path)` is null, and no request was made.
  - `resolveSelfUsername on a GitHub repo returns the login`: equals `"octo"`, with no GitLab request.
- [ ] **Step 2: Run** `bun test lib/daemon/__tests__/freshness-self-identity.test.ts`. Expected: fail (missing exports).
- [ ] **Step 3: Implement** in `freshness.ts`. Keep the GitLab warning text `userId is unresolved; self-authored MR transitions are being suppressed (no gitlabToken, or token validation failed)` exactly, logged only when a tracked repo with the grants is not on GitHub. The GitHub warning text is `rt could not tell which GitHub user you are, so alerts about your own GitHub PRs are off (no GitHub token, or GitHub refused it); run: rt setup github connect`. `disposeFreshness` clears the new cache.
- [ ] **Step 4: Run** the new file plus `bun test lib/daemon/__tests__/freshness-poll-userid.test.ts` and `bun test lib/daemon/__tests__/freshness-forge-router.test.ts`. Expected: all pass.
- [ ] **Step 5: Commit** `git add lib/notifier.ts lib/daemon/freshness.ts lib/daemon/__tests__/freshness-self-identity.test.ts && git commit -m "daemon: resolve your GitHub identity beside the GitLab one (RT-543)"`

### Task 4: Notifications compare each PR with its own forge's identity

**Files:**
- Modify: `lib/notifier.ts` (`isSelfAuthored`, `detectBranchTransitions`, `checkAndNotify` on the instance and the free function)
- Modify: `lib/daemon/cache-refresh.ts:435` (pass `getSelfIds()`)
- Modify: `lib/daemon/freshness.ts` (`processKeys` and `runGapFill` notify with `getSelfIds()`; `MappingOverrides.notify` becomes `(entries: Record<string, any>, self: SelfIds) => void`)
- Test: `lib/__tests__/notifier-github.test.ts` (new)

**Interfaces:**
- Consumes: `SelfIds`, `getSelfIds()` (Task 3).
- Produces: `checkAndNotify(cacheEntries, ports?, self: number | null | SelfIds = null)`; a bare number is the GitLab id. `__test__.isSelfAuthored(entry, self: number | null | SelfIds)`. An entry is GitHub when `entry.mr.author.id` starts with `github:`; anything else is GitLab.

- [ ] **Step 1: Write the failing tests**, with `createNotifier({ broadcast })` and a unique branch key per test (pattern: the R031 isolation test in `notifier.test.ts`). The entry factory builds `mr: { author: { id: "github:user:77" }, state, pipeline: { status }, blockers: { awaitingApprovals, hasConflicts, needsRebase }, reviews: { isApproved, approvedBy }, readiness: { state, reasons: [] }, status, webUrl }`, and every test uses `self = { gitlab: null, github: 77 }`:
  - `a GitHub PR fires merged, closed, CI failed, CI passed, approved, conflicts, needs rebase and ready`: one sub-case per alert, each a baseline call then a transition call. Assert the broadcast event titles in order: `"MR Merged 🎉"`, `"MR Closed"`, `"Pipeline Failed"`, `"Pipeline Passed ✓"`, `"MR Approved 👍"` (approver `github:user:5`), `"Merge Conflicts"`, `"Needs Rebase"`, `"Ready to Merge ✓"` (readiness `ready`, `awaitingApprovals: false`).
  - `a GitHub PR is not matched against the GitLab id`: author `github:user:77`, `self = 77` (bare number) and then `self = { gitlab: 77, github: null }`: running to failed fires nothing.
  - `a Mac with both forges gets both`: one GitLab entry (`gitlab:user:7`) and one GitHub entry (`github:user:77`) in the same map, `self = { gitlab: 7, github: 77 }`: both pipelines fail and two `Pipeline Failed` events fire.
  - `self-approval on a GitHub PR is suppressed`: approved by `github:user:77` only, so no `MR Approved` event.
  - `isSelfAuthored keeps the bare-number GitLab meaning`: `isSelfAuthored(gitlab:123 entry, 123)` true; `isSelfAuthored(github:user:123 entry, 123)` false.
- [ ] **Step 2: Run** `bun test lib/__tests__/notifier-github.test.ts`. Expected: fail.
- [ ] **Step 3: Implement.** Add a `selfIdFor(entry, self): number | null` helper and use it per entry in `detectBranchTransitions` (the author gate and the `shouldNotifyApprovalTransition` call). `BranchSnapshot` is unchanged. Update both daemon callers.
- [ ] **Step 4: Run** the new file, `bun test lib/__tests__/notifier.test.ts`, `bun test lib/__tests__/notifier-fired-hygiene.test.ts`, `bun test lib/daemon/__tests__/freshness-mapping.test.ts` and `bun test lib/daemon/__tests__/freshness-poll-userid.test.ts`. Expected: all pass.
- [ ] **Step 5: Commit** `git add lib/notifier.ts lib/daemon/cache-refresh.ts lib/daemon/freshness.ts lib/__tests__/notifier-github.test.ts && git commit -m "notifier: match each PR against its own forge's identity (RT-543)"`

### Task 5: GitHub reads for project sync

**Files:**
- Create: `lib/daemon/scope-authors.ts`
- Create: `lib/daemon/project-sync-github.ts`
- Test: `lib/daemon/__tests__/project-sync-github.test.ts` (new)

**Interfaces:**
- Produces in `scope-authors.ts`: `authorListed(authors: readonly string[], pr: { id?: string | null; author?: { username?: string | null } | null }): boolean`. It is false when the PR has no author username. A PR whose `id` starts with `github:` matches ignoring case; every other PR matches exactly (`authors.includes`).
- Produces in `project-sync-github.ts`:
  - `type GitHubSyncProvider = Pick<GitHubProvider, "fetchPullRequests" | "fetchSingleMR">`
  - `interface GitHubSyncContext { provider: GitHubSyncProvider; projectPath: string }`
  - `githubFetchOpen(ctx: GitHubSyncContext, authors: readonly string[] | null): Promise<PullRequest[]>`: one `fetchPullRequests({ projectPath, state: "opened", listWeight: true, onWarning })`. When `authors` is set it drops PRs where `authorListed` is false. Ignored targets are not filtered here: the store's `ignoreFor` (`project-mrs-store.ts`) drops them on both forges.
  - `githubFetchDelta(ctx: GitHubSyncContext, updatedAfter: string, stored: ProjectMRStore | undefined): Promise<PullRequest[]>`: runs `fetchDeltaFrom` (from `project-sync.ts`, unchanged) over an adapter. The adapter's `fetchPullRequests` passes through with `onWarning`. Its `fetchMergeRequestIndex` calls `fetchPullRequests({ projectPath, state: ["merged", "closed"], updatedAfter, listWeight: true, onWarning })` and maps each PR to a `MergeRequestIndexRow`. `authorUsername` takes the stored scope's spelling when `authorListed` matches it. Its `fetchSingleMR` returns the PR already read when it has one, else `githubFetchSingle`. `excludeTargetBranches` is always `[]`.
  - `readSingleStrict(provider: Pick<GitHubProvider, "fetchSingleMR">, projectPath: string, iid: number): Promise<PullRequest | null>`: `fetchSingleMR(projectPath, iid, null, onWarning)`, throwing under the warning rule below; null only for a real miss. Task 8 uses it too.
  - `githubFetchSingle(ctx: GitHubSyncContext, iid: number): Promise<PullRequest | null>`: `readSingleStrict(ctx.provider, ctx.projectPath, iid)`.
  - Warning rule for every read above: a warning whose `source` is `contexts` is logged at debug; any other warning makes the read throw `new Error(\`GitHub read incomplete: ${warning.message}\`)` after the call returns. A `RateLimitedError` propagates unchanged.

- [ ] **Step 1: Write the failing tests** with a fake provider that records each `fetchPullRequests` options object and can emit warnings:
  - `authorListed ignores case on GitHub only`: `authorListed(["Octo"], { id: "github:pr:1", author: { username: "octo" } })` is true; `authorListed(["Octo"], { id: "gitlab:mr:1", author: { username: "octo" } })` is false; with no author it is false.
  - `githubFetchOpen lists open PRs once and filters authors`: three PRs by `octo`, `Dev` and `x`, with `authors = ["OCTO", "dev"]`. The result is the first two, from exactly one call with `{ state: "opened", listWeight: true }` and no `authorUsernames`. With `authors = null`, all three come back.
  - `a fill or page-cap warning fails the read; a contexts warning does not`: a `{ kind: "request-failed", source: "fill" }` warning rejects with `GitHub read incomplete`; `{ kind: "page-cap", source: "list" }` rejects; `{ kind: "page-cap", source: "contexts" }` resolves with the PRs.
  - `githubFetchSingle throws on a failed fill and returns null for a real miss`: a warning plus null rejects; null with no warning resolves null.
  - `terminal rows follow fetchDeltaFrom's reuse rule`. The store's scope authors are `["octo"]`. It holds open #5 on branch `b`, merged #2 on `c` and merged #4 on `e`. The delta's terminal listing returns:
    - merged #3 on `b` (the branch has an open PR);
    - merged #8 on `c` by `Octo` (newer than #2, no open PR, in scope ignoring case);
    - closed #9 on `d` (a branch the store never saw);
    - merged #11 on `e` by `stranger` (out of scope).
    The result contains #8 only among those four, and the provider's `fetchSingleMR` was never called, since the adapter reused the PR it had already read.
  - `one delta cycle costs two list reads`: with no changes, `fetchPullRequests` was called exactly twice (open with `updatedAfter`, then `["merged", "closed"]` with `updatedAfter`) and `fetchSingleMR` zero times.
- [ ] **Step 2: Run** `bun test lib/daemon/__tests__/project-sync-github.test.ts`. Expected: fail (modules missing).
- [ ] **Step 3: Implement** both files to the interfaces above.
- [ ] **Step 4: Run** the same file and `bun test lib/daemon/__tests__/project-sync.test.ts`. Expected: all pass.
- [ ] **Step 5: Commit** `git add lib/daemon/scope-authors.ts lib/daemon/project-sync-github.ts lib/daemon/__tests__/project-sync-github.test.ts && git commit -m "daemon: GitHub reads for project sync (RT-542)"`

### Task 6: Project sync runs on GitHub repos

**Files:**
- Modify: `lib/daemon/project-sync.ts` (remove `skipsGitHub` and `githubSkipLogged`; choose the read set by forge; sections, behind counts, self and the delta scope filter)
- Delete: `lib/daemon/__tests__/project-sync-github-skip.test.ts`
- Test: `lib/daemon/__tests__/project-sync-github-sync.test.ts` (new)

**Interfaces:**
- Consumes: `githubFetchOpen`, `githubFetchDelta`, `githubFetchSingle`, `GitHubSyncContext`, `authorListed` (Task 5); `resolveSelfUsername`, `cachedSelfUsername`, `getRepoContext`, `isGitHubRepo` (Task 3 and existing).
- Produces: `ProjectSyncOverrides.forge?: "gitlab" | "github"` and `ProjectSyncOverrides.githubContext?: (repoName: string) => Promise<GitHubSyncContext>`; `RemeasureOverrides.forge?: "gitlab" | "github"`. When `forge` is absent, production resolves it with `isGitHubRepo(repoIndex[repo])`. Individual fetch overrides (`fetchProject`, `fetchAuthors`, `fetchDelta`, `fetchSingle`) still win on either forge. On GitHub `fetchRules` and `fetchKnownSections` are absent whatever the overrides say.

- [ ] **Step 1: Write the failing tests** with `forge: "github"`, a `githubContext` override backed by a fake provider, and a temp store (the `tmpStore` pattern in `project-sync.test.ts`):
  - `a GitHub repo fills the store and reports healthy`: the deep stores the listed open PRs, broadcasts `project-mrs`, and `readSyncHealth(repo)` is undefined.
  - `a failed GitHub deep with a record falls back to delta and prunes nothing`: seed a record older than `DEEP_RECONCILE_MS`. The deep listing emits a `fill` warning. The store keeps its PRs, and the delta runs.
  - `a cold GitHub deep that fails records a sync error`: no record, a `page-cap`/`list` warning. The promise rejects, and `readSyncHealth(repo)` is set.
  - `a scoped GitHub deep lists once, adds your login and skips sections`: a demand with authors `["Dev"]` and sections `["Backend"]`, and `selfUsername: "octo"` (the existing seam). The fake provider saw one `fetchPullRequests` call with no `authorUsernames`. `store.read(repo).scope.authors` equals `["Dev", "octo"]`, `scope.sections` is undefined, and no rules read happened (a `fetchRules` override that throws is never called).
  - `a scoped GitHub deep resolves your login per repo`: no `selfUsername` override, and `spyOn(freshnessModule, "resolveSelfUsername")` resolving `"octo"`. The spy was called with `(repo, path)` and `scope.authors` includes `octo`.
  - `GitHub delta keeps a scope author in another case`: scope authors `["Octo"]`; a delta PR by `octo` lands in the store.
  - `backfillSections on GitHub reads nothing and logs once`: two calls, zero provider calls, and one `info` call with message `codeowner sections are not available on GitHub yet`.
  - `the GitHub top-up re-reads an in-flight PR and skips a failed one`: the record holds open #1 and #2, both with `pipeline.status: "running"` and fresh `updatedAt`, and the delta returns nothing. The provider's `fetchSingleMR` returns #1 with `pipeline.status: "success"`, and for #2 emits a `fill` warning and returns null. Afterwards #1's stored pipeline is `success`, #2's entry is unchanged, and the sync resolves.
  - `remeasureDivergedCounts makes no read on GitHub`: `forge: "github"` with a `fetchDiverged` that throws; it resolves `[]`.
  - `backfillAuthors on GitHub adds the GitHub login, not the GitLab username`: no `selfUsername` override; `spyOn(freshnessModule, "cachedSelfUsername")` resolves `"octo"` and `spyOn(freshnessModule, "getSelfUsername")` returns `"gl-me"`. `scope.authors` includes `octo` and not `gl-me`.
- [ ] **Step 2: Run** `bun test lib/daemon/__tests__/project-sync-github-sync.test.ts`. Expected: fail.
- [ ] **Step 3: Implement.** Swap `authors.includes(pr.author.username)` in the delta scope filter for `authorListed(authors, pr)`. Skip the section sweep, the delta re-sweep and the approval reads when the read set has no `fetchRules`. In `remeasureDivergedCounts`, return `[]` for GitHub before any read. Keep the `info` seam for the backfill notice.
- [ ] **Step 4: Run** the new file, `bun test lib/daemon/__tests__/project-sync.test.ts`, `bun test lib/daemon/__tests__/project-sync-health.test.ts` and `bun test lib/daemon/__tests__/project-sync-github.test.ts`. Expected: all pass.
- [ ] **Step 5: Commit** `git rm lib/daemon/__tests__/project-sync-github-skip.test.ts && git add lib/daemon/project-sync.ts lib/daemon/__tests__/project-sync-github-sync.test.ts && git commit -m "daemon: project sync runs on GitHub repos (RT-542)"`

### Task 7: GitHub PRs reach the project store from lookups and mutations

**Files:**
- Modify: `lib/daemon/handlers/project-mrs.ts` (`mr:by-branch` upserts on GitHub on both paths)
- Modify: `lib/daemon/handlers/mr.ts` (the three GitHub write-back skips: `writebackFor` near line 183, `mr:action` near line 286, `mr:update` near line 458)
- Modify: `lib/daemon/freshness.ts` (`upsertProject` in `processKeys` uses `authorListed`)
- Test: `lib/daemon/handlers/__tests__/project-mrs-github-store.test.ts` (new); update `lib/daemon/handlers/__tests__/mr-github.test.ts` assertions that expect no write-back

**Interfaces:**
- Consumes: `authorListed` (Task 5).
- Produces: a shared in-scope rule for a found PR, `!scope || !pr.author?.username || authorListed(scope.authors, pr) || tagged`, used by both `mr:by-branch` paths and `upsertProject`.

- [ ] **Step 1: Write the failing tests:**
  - `mr:by-branch on GitHub stores a found PR on the batched path`: `getContext` returns `{ forge: "github", provider: { fetchPullRequestsByBranches } }` finding #4. The reply has `{ pr, source: "forge" }` and `store.findBySourceBranch(repo, branch)` returns #4.
  - `mr:by-branch on GitHub respects scope, ignoring case`: scope authors `["Octo"]`. A PR by `octo` is stored; a PR by `stranger` is returned but not stored.
  - `mr:by-branch on GitHub still errors when the branch lookup fails`: the batch throws, and the reply is `{ ok: false }` (unchanged behaviour, pinned).
  - `mr:by-branch on GitHub stores a PR found on the per-branch path`: `overrides.fetchByBranch` returns `{ pr, projectPath, github: true }`. The PR is stored, and the old `by-branch store upsert skipped` debug line is gone.
  - In `mr-github.test.ts`, the success paths flip from "no write-back" to one write-back each. Rename and assert:
    - `merge writes the returned PR back` (line 62; `writebacks` has one entry);
    - `approve schedules the follow-up write-back` (line 88; one entry after the follow-up runs);
    - `a title edit writes the updated PR back` (line 110);
    - `addLabels and removeLabels ... write the read PR back` (line 98; one entry);
    - `labels ride createPullRequest with no second write, and the PR is written back` (line 134);
    - `a refresh read returns the PR and writes it back` (line 183);
    - `mr:by-branch makes one batched read for every missed branch and stores what it found` (line 237).
    Refusals and failures keep `writebacks` empty: rebase refused, squash refused (both), a failed label write, every miss and every rate-limit case.
  - New in `mr-github.test.ts`: `update on GitHub keeps its /pull URL reply and writes the PR back`. The reply's `url` is the PR's `webUrl` (a `/pull/` URL), `putMergeRequest` is never reached (no GitLab REST call is recorded), and `writebacks` has one entry.
- [ ] **Step 2: Run** `bun test lib/daemon/handlers/__tests__/project-mrs-github-store.test.ts` and `bun test lib/daemon/handlers/__tests__/mr-github.test.ts`. Expected: the new assertions fail.
- [ ] **Step 3: Implement.** In `mr.ts`, change only the write-back:
  - `writebackFor`: drop the GitHub early return, so it always calls `storeWriteback`.
  - `mr:action`: drop the GitHub early return and its debug line, so GitHub takes the same follow-up path as GitLab (returned PR, delayed retry follow-up, or follow-up read).
  - `mr:update`: keep the GitHub block and its `return` (its reply carries the `/pull/N` URL, and the GitLab code after it must not run). Replace only the debug line with `if (pr) storeWriteback(repoName, projectPath, pr)` inside the same never-fail try/catch the GitLab arm uses (log `write-back failed` at warn).
- [ ] **Step 4: Run** both files plus `bun test lib/daemon/handlers/__tests__/mr-lists-github.test.ts` and `bun test lib/daemon/__tests__/freshness-mapping.test.ts`. Expected: all pass.
- [ ] **Step 5: Commit** `git add lib/daemon/handlers/project-mrs.ts lib/daemon/handlers/mr.ts lib/daemon/freshness.ts lib/daemon/handlers/__tests__/project-mrs-github-store.test.ts lib/daemon/handlers/__tests__/mr-github.test.ts && git commit -m "daemon: GitHub lookups and mutations write the project store (RT-542)"`

### Task 8: Event mapping never stores a failed GitHub read

**Files:**
- Modify: `lib/daemon/freshness.ts` (`RepoTarget`, `TargetedFetcher`, `processKeys`)
- Test: `lib/daemon/__tests__/freshness-mapping-github.test.ts` (new; reuse `fakePR` and the env helpers from `freshness-mapping.test.ts`, with GitHub ids `github:pr:N` and `github:user:N`)

**Interfaces:**
- Produces: `RepoTarget = { repoName; projectPath; forge?: "gitlab"; provider: TargetedFetcher } | { repoName; projectPath; forge: "github"; provider: GitHubTargetedFetcher }`, where `GitHubTargetedFetcher = Pick<GitHubProvider, "fetchSingleMR" | "fetchPullRequestsByBranches">`. A target without `forge` behaves exactly as today.
- Consumes: `getSelfIds()` (Task 3), `authorListed` and `readSingleStrict` (Task 5).

- [ ] **Step 1: Write the failing tests:**
  - `an mr event whose fill fails writes nothing`: cached branch with PR #3; `fetchSingleMR` emits a `fill` warning and returns null. The entry's `mr` is unchanged and no notify happens.
  - `a branch event null re-reads the cached PR`: the batch returns null for the branch, and `fetchSingleMR(#3)` returns the PR with `state: "merged"`. The entry is updated to merged.
  - `a branch event null whose re-read fails writes nothing`: the batch returns null, and the re-read emits a `fill` warning. The entry is unchanged.
  - `a branch event null re-read returning null writes nothing`: the entry is unchanged.
  - `a branch event on a branch with no cached PR writes null as today`: the entry's `mr` stays null and `fetchedAt` moves.
  - `the approval heal never runs on GitHub`: an `approved` cause with a tagged stored PR and a `fetchRulesByIid` that throws. No throw is logged and no tag changes.
  - `fetchSingleMR gets null as its user id on GitHub`: assert the third argument is null.
  - `a teammate push whose fill fails writes nothing to the project store`: the grant has `project-mrs`, the branch is not ours, and the store holds #6 on that branch. `fetchSingleMR(#6)` emits a `fill` warning and returns null. The stored #6 is unchanged and no `project-mrs` broadcast happens.
- [ ] **Step 2: Run** `bun test lib/daemon/__tests__/freshness-mapping-github.test.ts`. Expected: fail.
- [ ] **Step 3: Implement** the GitHub arms of the `mr` and `branch` cases and the teammate-push read; the GitLab arms keep their exact calls.
- [ ] **Step 4: Run** the new file, `bun test lib/daemon/__tests__/freshness-mapping.test.ts` and `bun test lib/daemon/__tests__/freshness-pending-cap.test.ts`. Expected: all pass.
- [ ] **Step 5: Commit** `git add lib/daemon/freshness.ts lib/daemon/__tests__/freshness-mapping-github.test.ts && git commit -m "daemon: GitHub events never store a failed read as no PR (RT-544)"`

### Task 9: Live watch on GitHub repos

**Files:**
- Modify: `lib/daemon/freshness.ts` (`RepoWatch`, `reconcileFreshnessImpl`, `startWatch`, event id reporting)
- Modify: `commands/daemon.ts:52,617-619,679,745-758` (accept GitHub, refusal reason, picker hint, doc comment)
- Modify: `lib/daemon/discussions-poller.ts` (doc comment: live GitHub repos get `notes` events)
- Test: `lib/daemon/__tests__/freshness-github-watch.test.ts` (new; `createFreshness(env)`, a temp repo with a `git@github.com:` origin, spies on `loadSecrets`, `resolveGithubToken`, `loadRepoTracking` and `GitHubProvider.prototype.watchEvents` returning a recorded dispose function, and `fetch` for `/user`)
- Test: `commands/__tests__/daemon-tracking.test.ts` (add one test)

**Interfaces:**
- Consumes: `getRepoContext`, `getSelfUserId` (existing), `RepoTarget` with `forge: "github"` (Task 8).
- Produces: `RepoWatch.forge: "gitlab" | "github"`, `RepoWatch.provider: GitLabProvider | GitHubProvider`. The snapshot's `lastEventId` stays `number | null`; a GitHub string id is reported as `Number(id)` when it is all digits and fits `Number.isSafeInteger`, else null.

- [ ] **Step 1: Write the failing tests:**
  - `reconcile starts a GitHub watch for a live GitHub repo`: `watchEvents` is called once with that repo's `owner/repo` and an options object with no `intervalMs`; `unit.getSnapshot()` has the repo with `state: "live"`; the env's `mr:status` broadcast says `connected`.
  - `no GitHub token, no watch, one info line`: two reconciles, zero `watchEvents` calls, one info log naming the repo.
  - `a token change restarts the GitHub watch`: reconcile with `ghp_a`, then `ghp_b`. The first dispose ran, and `watchEvents` was called twice.
  - `a watch on a repo no longer live is disposed`: tracking flips to `poll`; dispose runs; the snapshot is empty and `mr:status` says `disconnected`.
  - `a GitHub batch reaches the mapping with forge github`: the env's cache holds an entry for branch `feat` whose `mr.iid` is 3. Invoke the recorded `onInvalidations` with `{ invalidations: [{ kind: "mr", ref: "3" }], syncedAt, cursor }`, and assert that `spyOn(GitHubProvider.prototype, "fetchSingleMR")` saw `(projectPath, 3, null, <function>)`.
  - `a GitHub cursor's string id reports as a number`: invoke the recorded `onCursor` with `{ since: null, lastEventId: "41234567890", seenIds: ["41234567890"] }`. The snapshot shows `lastEventId: 41234567890`.
  - In `daemon-tracking.test.ts`: `live is accepted on a GitHub remote`. Use a repo whose origin is `git@github.com:acme/track-live.git`; `manageTracking([name, "live"])` saves `{ mode: "live", caches: ["branches"] }` with no refusal on stderr. The existing refusal test keeps its assertions; the refusal's hint now reads `live watching needs a GitLab or GitHub remote`.
- [ ] **Step 2: Run** `bun test lib/daemon/__tests__/freshness-github-watch.test.ts` and `bun test commands/__tests__/daemon-tracking.test.ts`. Expected: the new tests fail.
- [ ] **Step 3: Implement.** In `reconcileFreshnessImpl`, a live repo whose remote `isGitHubRemote` takes a GitHub arm. It builds the context through `getRepoContext`. On a throw, it logs one info line per repo per process and skips. It resolves the self id with `getSelfUserId(ctx)`, restarts a watch whose provider differs from the context's, and starts one with `forge: "github"`. Every GitLab line is unchanged. In `commands/daemon.ts`, accept `isGitLabRemote(url) || isGitHubRemote(url)` and set the refusal hint as above. Change the picker hint to `events watcher (15s on GitLab, 60s on GitHub) + 5-min cycle`, and update the doc comment line to match. Update the poller doc comment.
- [ ] **Step 4: Run** both files plus `bun test lib/daemon/__tests__/freshness-factory.test.ts`, `bun test lib/daemon/__tests__/freshness-token-gate.test.ts` and `bun test lib/daemon/__tests__/freshness-provider-rotation.test.ts`. Expected: all pass.
- [ ] **Step 5: Commit** `git add lib/daemon/freshness.ts commands/daemon.ts lib/daemon/discussions-poller.ts lib/daemon/__tests__/freshness-github-watch.test.ts commands/__tests__/daemon-tracking.test.ts && git commit -m "daemon: live events watch on GitHub repos (RT-544)"`

### Task 10: Branch gates

**Files:** none new.

- [ ] **Step 1: Run** `bun run typecheck`. Expected: exit 0.
- [ ] **Step 2: Run** `bun run purity`. Expected: exit 0.
- [ ] **Step 3: Run** `bun test lib/__tests__/no-raw-output.test.ts`. Expected: pass (no new raw output).
- [ ] **Step 4: Run** `rg -n "\x{2014}|\x{2013}" $(git diff --name-only --diff-filter=d origin/main...HEAD)` from the worktree root. Expected: no matches.
- [ ] **Step 5:** Fix anything red in the task that introduced it, with its own commit.
