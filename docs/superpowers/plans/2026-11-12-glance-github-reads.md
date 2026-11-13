# GitHub codeowner rules, behind count and merged-PR index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub's merged-PR index, codeowner approval rules, owner list and behind counts to glance behind capability flags, and turn them on in the daemon's GitHub project sync.

**Architecture:** Pure query builders and node mappers live in two new glance files (`githubApprovalRules.ts`, `githubDiverged.ts`) plus a GitHub parser in `codeowners.ts`; `GitHubProvider` gets thin methods over `graphqlRead` and Octokit REST. The daemon's GitHub read set (`project-sync-github.ts`) and `project-sync.ts` call them, with section tags made sticky on GitHub through one shared helper.

**Tech Stack:** Bun, TypeScript 5.9, Octokit (`@octokit/core` + plugins), bun:test.

**Spec:** `docs/superpowers/specs/2026-11-12-glance-github-reads-design.md` (read it before any task; every task's requirements include it).

## Global Constraints

- Octokit and gitbeaker only; GitLab behaviour does not change; one forge per team; GitHub Enterprise is later.
- Every new `GitProvider` member and `ProviderCapabilities` flag is optional (`?`).
- `GitLabProvider.ts`: exactly three added lines in its `capabilities` literal (`canFetchApprovalRules: true`, `canFetchCodeownerSections: true`, `canFetchDivergedCount: true`); nothing else in that file.
- Never touch `NoteMutator.ts`, `retry.ts`, the GitLab client, the live harness pacing, or `harness_credentials.json` (never read, print or stage it).
- Never run the live suite or anything needing `GLANCE_LIVE=1`; no live forge call of any kind; never point anything at `m4ttheweric/gitq-test-sandbox`; never publish to npm; never run rt, the daemon or a built binary against the real HOME.
- No em or en dashes in anything written. Comments only for a constraint the code cannot show.
- Stage named files only. One commit per task.
- Before every commit touching `packages/glance`, from `packages/glance`: `bun test`, `bun run check-types`, `bun run check:node`, `bun run build`, `bun run check-types:live`; and from the worktree root `bun run purity`. All must pass.
- Daemon tasks run tests from the worktree root (bunfig preload): `bun test lib/daemon/__tests__/project-sync.test.ts lib/daemon/__tests__/project-sync-github.test.ts lib/daemon/__tests__/project-sync-github-sync.test.ts`, then `bun run typecheck`. Run `bun run build` in `packages/glance` first so the daemon resolves the new types from `dist/`.
- Every new glance test file starts with `useForgeStub()` and `useInstantTimers()` (from `tests/helpers/gh-fill-fixture.ts`): GraphQL throttling spaces requests a second apart, and the stub must reset between tests.
- Costs the spec states must not move: rules 50 PRs per GraphQL request, compares 25 per request, index 100 rows per REST page, re-measure one batched request per cycle on GitHub (cap 25). If code needs a different number, stop and ask.

## Review Focus

1. A GraphQL error under one PR (a team the token cannot read) must mark only that PR unknown, not fail or blank the batch: Task 3 pins it.
2. A capped connection that overflowed must read as unknown, never complete: Task 3 pins `reviewRequests` totalCount 101.
3. An index walk whose rows straddle `updatedAfter` across a page boundary must stop exactly and keep only rows at or after it, and `signal` aborts must not retry: Task 5 pins both.
4. A sticky GitHub tag must not resurrect a section no demand names, and an unknown PR must keep its stored tag under the deep's `replaceAll`: Task 7 pins both.
5. A PR whose base branch was deleted (`baseRef: null`) must give a null count, not drop the batch: Task 4 pins it.

---

### Task 1: Types, interface members and capability flags

**Files:**
- Modify: `packages/glance/src/types.ts` (`ProviderCapabilities`, `MRApprovalRules`, `PullRequest.divergedCommitsCount` doc, `FetchApprovalRulesOptions` doc)
- Modify: `packages/glance/src/GitProvider.ts` (four optional members after `fetchUserEvents?`)
- Modify: `packages/glance/src/GitLabProvider.ts` (three lines in `capabilities`)
- Modify: `packages/glance/src/GitHubProvider.ts` (three new flags, all `false` for now)
- Modify: `packages/glance/tests/live/expectations.ts` (four entries per provider)
- Modify: `packages/glance/tests/live-expectations.test.ts` (add the four methods to its hardcoded `OPTIONAL` list, or its "only optional interface methods may be declared absent" test fails)
- Test: `packages/glance/tests/github-reads-capabilities.test.ts` (new)

**Interfaces:**
- Produces, in `types.ts`: `ProviderCapabilities.canFetchApprovalRules?: boolean`, `canFetchCodeownerSections?: boolean`, `canFetchDivergedCount?: boolean`; `MRApprovalRules.unknownReason?: string`.
- Produces, in `GitProvider`:
  - `fetchApprovalRules?(options: FetchApprovalRulesOptions): Promise<MRApprovalRules[]>`
  - `fetchCodeownerSections?(options: { projectPath: string }): Promise<string[] | null>`
  - `fetchDivergedCount?(projectPath: string, mrIid: number): Promise<number | null>`
  - `fetchDivergedCounts?(projectPath: string, mrIids: number[]): Promise<Map<number, number | null>>`

- [ ] **Step 1: Write the failing test** `github-reads-capabilities.test.ts`:
  - `test('GitLab reports the reads it already has')`: `new GitLabProvider(...)` capabilities have `canFetchApprovalRules`, `canFetchCodeownerSections`, `canFetchDivergedCount` all `true`; `typeof p.fetchDivergedCounts` is `'undefined'`.
  - `test('a GitProvider-typed GitLab exposes the three reads')`: assign a `GitLabProvider` to a `GitProvider` variable and assert `typeof gp.fetchApprovalRules`, `gp.fetchCodeownerSections`, `gp.fetchDivergedCount` are `'function'` (compile-time proof the signatures line up).
- [ ] **Step 2: Run** `cd packages/glance && bun test tests/github-reads-capabilities.test.ts`. Expected: FAIL (flags undefined / type errors).
- [ ] **Step 3: Implement** the types, members and flags above. JSDoc on each member: what it reads, the capability to check, and per-forge notes from the spec (GitHub's sections are lowercased `@owner`; `unknownReason` meaning; `fetchDivergedCounts` map semantics: an entry per PR read, null when there is no comparison, no entry when that PR's read failed). Update `divergedCommitsCount`'s doc: GitHub PRs leave it null from every fetch and `fetchDivergedCounts` reads it. In `expectations.ts` add entries for both providers: GitLab `fetchApprovalRules`/`fetchCodeownerSections`/`fetchDivergedCount` supported with their capability, `fetchDivergedCounts` `absent` with a note; GitHub all four `absent` with note "lands in this change" (later tasks flip each).
- [ ] **Step 4: Run** the test, then the full glance gate list. Expected: PASS.
- [ ] **Step 5: Commit** `glance: optional GitHub-parity read members and capability flags`.

### Task 2: GitHub CODEOWNERS owner list

**Files:**
- Modify: `packages/glance/src/codeowners.ts`
- Modify: `packages/glance/src/GitHubProvider.ts` (method + flag `canFetchCodeownerSections: true`)
- Modify: `packages/glance/tests/live/expectations.ts` (GitHub entry supported)
- Test: `packages/glance/tests/gh-codeowners.test.ts` (new)

**Interfaces:**
- Produces: `GITHUB_CODEOWNERS_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'] as const`; `parseGitHubCodeowners(text: string): string[]`; `GitHubProvider.fetchCodeownerSections(options: { projectPath: string }): Promise<string[] | null>`.

- [ ] **Step 1: Write the failing tests:**
  - `parseGitHubCodeowners`: input
    ```
    # comment
    *       @Org/Platform  @alice
    /docs/  docs@example.com @org/docs # trailing
    *.js    @ALICE
    ```
    returns `['@alice', '@org/docs', '@org/platform']` (lowercased, deduped, sorted, email dropped, trailing comment dropped). A blank or comment-only file returns `[]`.
  - Provider, using `stubForge({ graphql })`: when `gh` (`.github/CODEOWNERS`) and `root` both resolve, the `.github` text wins; when only `docs` resolves, it is used; when none resolve, `null`; a present blob with `text: null` throws `/CODEOWNERS/`; `isTruncated: true` throws; a null `repository` throws. One request per call (`urls.length === 1`).
- [ ] **Step 2: Run** `bun test tests/gh-codeowners.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The query aliases `gh`, `root`, `docs` as `object(expression: "HEAD:<path>") { ... on Blob { text isTruncated } }`, sent through `graphqlOrThrow` (any error throws). Doc: precedence, emails excluded and why, lowercasing.
- [ ] **Step 4: Run** the tests and the glance gate list. Expected: PASS.
- [ ] **Step 5: Commit** `glance: GitHub fetchCodeownerSections`.

### Task 3: GitHub codeowner approval rules

**Files:**
- Create: `packages/glance/src/githubApprovalRules.ts`
- Modify: `packages/glance/src/GitHubProvider.ts` (method + flag `canFetchApprovalRules: true`)
- Modify: `packages/glance/tests/live/expectations.ts`
- Test: `packages/glance/tests/gh-approval-rules.test.ts` (new)

**Interfaces:**
- Produces in `githubApprovalRules.ts`:
  - `APPROVAL_RULES_BATCH = 50`, `APPROVAL_RULES_PAGE_MAX = 50`
  - `interface GHApprovalNode { number: number; isDraft: boolean; updatedAt: string; baseRefName: string; reviewRequests: { totalCount: number; nodes: Array<{ asCodeOwner: boolean; requestedReviewer: { __typename: string; login?: string; combinedSlug?: string } | null }> }; latestOpinionatedReviews: { totalCount: number; nodes: Array<{ state: string; author: { login: string } | null; onBehalfOf: { totalCount: number; nodes: Array<{ combinedSlug: string }> } }> } }`
  - `buildApprovalRulesByNumberQuery(owner: string, repo: string, numbers: number[]): string` (aliases `p<n>: pullRequest(number: n)`)
  - `buildApprovalRulesPageQuery(owner: string, repo: string): string` (variables `$first: Int!`, `$after: String`; `pullRequests(states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}, ...)` with `pageInfo { hasNextPage endCursor }`)
  - `rulesFromNode(node: GHApprovalNode): { rules: ApprovalRuleLite[] } | { unknownReason: string }`
- Produces: `GitHubProvider.fetchApprovalRules(options: FetchApprovalRulesOptions): Promise<MRApprovalRules[]>`.

- [ ] **Step 1: Write the failing tests** (`rulesFromNode` directly, then the provider via `stubForge({ graphql })`):
  - A codeowner request for team `org/platform` and one for user `Alice` gives `[{type:'CODE_OWNER',section:'@alice',approved:false},{type:'CODE_OWNER',section:'@org/platform',approved:false}]`; a request with `asCodeOwner: false` adds nothing.
  - An `APPROVED` review with `onBehalfOf` `org/platform` plus a pending request for it gives one `@org/platform` rule, `approved: true`. A `CHANGES_REQUESTED` review on behalf of a team gives `approved: false`.
  - `reviewRequests.totalCount: 101` with 100 nodes gives `unknownReason`; so do a `latestOpinionatedReviews.totalCount` above its nodes, an `onBehalfOf.totalCount` above its nodes, and a codeowner request with `requestedReviewer: null`.
  - An `APPROVED` review with an empty `onBehalfOf` (a user owner's approval) adds no rule.
  - iids mode with 60 numbers sends 2 requests (50 + 10), and keeps a draft PR. An error with `path: ['repository','p7','reviewRequests','nodes',0,'requestedReviewer']` gives `{iid:7, rules:[], unknownReason}` while `p8` maps normally; a `NOT_FOUND` error on `p9` leaves 9 out.
  - updatedAfter mode: drafts left out; `excludeTargetBranches: ['release']` drops a `baseRefName: 'release'` node; the walk stops at the first node older than `updatedAfter` without requesting the next page; `pageSize: 80` sends `first: 50`; `pageSize: 0` and `1.5` throw; an error path `['repository','pullRequests','nodes',2,...]` marks that node unknown; a null node with errors throws.
  - Both `updatedAfter` and `iids` throws `/mutually exclusive/`. A rate-limited response throws `RateLimitedError`.
- [ ] **Step 2: Run** `bun test tests/gh-approval-rules.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use `graphqlRead` (keeps partial data with errors). Section mapping: team `'@' + combinedSlug.toLowerCase()`, user `'@' + login.toLowerCase()`; merge per section, approved if any entry approved; sort by section. Rules come from `latestOpinionatedReviews` only. The method doc carries the spec's "Supported and not supported" list verbatim in substance.
- [ ] **Step 4: Run** the tests and the glance gate list. Expected: PASS.
- [ ] **Step 5: Commit** `glance: GitHub fetchApprovalRules from GitHub's codeowner evaluation`.

### Task 4: GitHub behind counts

**Files:**
- Create: `packages/glance/src/githubDiverged.ts`
- Modify: `packages/glance/src/GitHubProvider.ts` (two methods + flag `canFetchDivergedCount: true`)
- Modify: `packages/glance/tests/live/expectations.ts`
- Test: `packages/glance/tests/gh-diverged.test.ts` (new)

**Interfaces:**
- Produces: `DIVERGED_BATCH_SIZE = 25`; `buildDivergedQuery(owner: string, repo: string, numbers: number[]): string` with `p<n>: pullRequest(number: n) { baseRef { compare(headRef: "refs/pull/<n>/head") { behindBy } } }`; `GitHubProvider.fetchDivergedCounts(projectPath: string, mrIids: number[]): Promise<Map<number, number | null>>`; `GitHubProvider.fetchDivergedCount(projectPath: string, mrIid: number): Promise<number | null>`.

- [ ] **Step 1: Write the failing tests:**
  - The query for `[12]` contains `compare(headRef: "refs/pull/12/head")`.
  - 30 iids send 2 requests (25 + 5). `behindBy: 3` maps `12 -> 3`; `baseRef: null` maps to `null`; `compare: null` maps to `null`; an error on `p13` leaves 13 out while 12 stays; `NOT_FOUND` on `p14` leaves 14 out; `[]` sends no request and returns an empty map.
  - `fetchDivergedCount('o/r', 12)` returns 3; an alias error rejects; a missing PR rejects.
- [ ] **Step 2: Run** `bun test tests/gh-diverged.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** over `graphqlRead`. Doc: `refs/pull/<n>/head` works for forks; unverified until the live run, fallback named in the spec.
- [ ] **Step 4: Run** the tests and the glance gate list. Expected: PASS.
- [ ] **Step 5: Commit** `glance: GitHub fetchDivergedCounts and fetchDivergedCount`.

### Task 5: GitHub merged-PR index

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts` (method, flip `canFetchMergeRequestIndex` to `true`)
- Modify: `packages/glance/tests/metrics-reads-capabilities.test.ts` (GitHub index now present)
- Modify: `packages/glance/tests/live-expectations.test.ts` (its "expectationFor selects the right table" assertion that GitHub's `fetchMergeRequestIndex` is `absent` flips to `supported`)
- Modify: `packages/glance/tests/live/expectations.ts` (`fetchMergeRequestIndex` supported, note: projectPaths only, groupPath throws)
- Modify: `packages/glance/tests/live/conformance.ts`: `runMetricsReadConformance` today returns early only when every metric read is absent. Change it so each check whose method the fixture's expectations declare `absent` is skipped (the absence check already records it), instead of calling an undefined method; and the "group mode" index check throws `Inconclusive('groupPath is GitLab-only')` on GitHub.
- Test: `packages/glance/tests/gh-merge-request-index.test.ts` (new)

**Interfaces:**
- Produces: `GitHubProvider.fetchMergeRequestIndex(options: FetchMergeRequestIndexOptions): Promise<MergeRequestIndexRow[]>`; `INDEX_MAX_PAGES = 100`.

- [ ] **Step 1: Write the failing tests** (REST via `stubForge({ rest })`):
  - `states: ['merged','closed']` requests `state=closed&sort=updated&direction=desc&per_page=100&page=1`; `['opened']` uses `state=open`; absent or mixed uses `state=all`.
  - Row mapping for `{number: 5, title, state: 'closed', merged_at: '...', created_at, updated_at, user: {login: 'Bob'}, head: {ref: 'feat'}, base: {ref: 'main'}, labels: [{name: 'x'}]}` gives `{iid: 5, projectPath: 'o/r', state: 'merged', authorUsername: 'Bob', sourceBranch: 'feat', labels: ['x'], ...}`; `merged_at: null` gives `closed`; `user: null` gives `authorUsername: null`.
  - Page 1 of 100 rows all inside the window, page 2 whose 40th row is older than `updatedAfter`: 2 requests, rows after the cutoff excluded, `onPage` called with 100 then the kept total.
  - `excludeTargetBranches: ['main']` drops `base.ref: 'main'` rows.
  - `groupPath` throws `/GitLab-only/`; neither or both throws; a bad `updatedAfter` throws.
  - After 100 full pages whose last rows are all inside the window, the walk throws naming `o/r` without requesting page 101 (stub 100 full in-window pages; assert 100 requests).
  - `states: ['merged']` sends `state=closed` and drops rows with `merged_at: null`.
  - A pre-aborted `signal` rejects with the signal's reason and the stub sees no request; `onPage: () => controller.abort(new Error('stop'))` after page 1 rejects with that error and page 2 is never requested.
- [ ] **Step 2: Run** `bun test tests/gh-merge-request-index.test.ts tests/metrics-reads-capabilities.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** a private walk (not `listRepoPRs`, whose 20-page cap warns instead of throwing), passing `request: { signal }` to Octokit, checking `signal.aborted` before each page, and rethrowing `signal.reason` when a request fails while the signal is aborted (Octokit wraps a custom abort reason as a retryable 500). The method doc says an abort mid-request may still wait out the client's GET retries before it surfaces; no caller passes a signal on GitHub today. Method doc states GitHub's retry as `githubClient.ts` actually does it (GET 5xx retry plugin; rate limits throw `RateLimitedError`).
- [ ] **Step 4: Run** the tests and the glance gate list. Expected: PASS.
- [ ] **Step 5: Commit** `glance: GitHub fetchMergeRequestIndex`.

### Task 6: Live conformance cases and README

**Files:**
- Create: `packages/glance/tests/live/parityReadsConformance.ts`
- Modify: `packages/glance/tests/live/runner.ts` to call the new runner for every fixture (GitLab and GitHub), so `report.assertFullCoverage(fixture.name, ALL_METHODS)` sees all four new methods on both; no pacing change
- Modify: `packages/glance/README.md` (SDK section lists the four reads with their flags)

**Interfaces:**
- Consumes: `check`, `assert`, `Inconclusive`, `createBranch`, `commitFile`, `runPrefix` from `conformance.ts`; `ProviderFixture`; `Reporter`.
- Produces: `runParityReadsConformance(fixture: ProviderFixture, report: Reporter): Promise<void>`.

- [ ] **Step 1: Write the cases** (never run here). Any method the fixture's expectations declare `absent` gets an absence check (`typeof provider.x === 'undefined'`), as `runMetricsReadConformance` does. GitLab, read-only: `fetchCodeownerSections` returns an array or null; `fetchApprovalRules({ projectPath, updatedAfter })` returns well-formed entries (`Inconclusive` when none); `fetchDivergedCount` on an open MR returns a number or null (`Inconclusive` when the fixture has no open MR); `fetchDivergedCounts` is absent. GitHub:
  - Index: a PR this run merges into its own throwaway branch appears as a `merged` row inside `updatedAfter` with its source branch.
  - Behind count: a PR whose branch was cut before a commit this run adds to its base reports `>= 1` through both `fetchDivergedCounts` and `fetchDivergedCount`; a PR cut from the tip reports 0. Records the elapsed time of a 25-PR batch when the fixture has 25 open PRs, else `Inconclusive`.
  - Codeowner sections and rules: `fetchCodeownerSections`; when null, rules assertions throw `Inconclusive('fixture has no CODEOWNERS')`. With a team owner: a PR touching an owned path gets an unapproved `@org/team` rule; after the approver identity approves and then leaves a comment-only review, the rule reads `approved: true`.
- [ ] **Step 2: Verify** `bun run check-types:live` and the glance gate list pass (the cases compile; the live suite is not run).
- [ ] **Step 3: Commit** `glance: live cases and README for the GitHub parity reads`.

### Task 7: Daemon section sweeps on GitHub, sticky and unknown-aware

**Files:**
- Modify: `lib/daemon/project-sync-github.ts` (`GitHubSyncProvider`, `githubFetchRules`, `githubFetchKnownSections`)
- Modify: `lib/daemon/project-sync.ts` (`githubReads`, `sweepTags`, deep sweep, sections delta, `backfillSections`; remove `githubSectionsLogged` and the "not available on GitHub yet" notice)
- Test: `lib/daemon/__tests__/project-sync.test.ts`, `lib/daemon/__tests__/project-sync-github-sync.test.ts`

**Interfaces:**
- Produces in `project-sync-github.ts`: `GitHubSyncProvider = Pick<GitHubProvider, 'fetchPullRequests' | 'fetchSingleMR' | 'fetchMergeRequestIndex' | 'fetchApprovalRules' | 'fetchCodeownerSections' | 'fetchDivergedCounts'>`; `githubFetchRules(ctx: GitHubSyncContext, opts: { updatedAfter?: string; iids?: number[] }): Promise<MRApprovalRules[]>`; `githubFetchKnownSections(ctx: GitHubSyncContext): Promise<string[] | null>`.
- Produces in `project-sync.ts`: `export function sweepTags(rules: MRApprovalRules[], demanded: string[], stored: (iid: number) => string[] | undefined, opts: { sticky: boolean }): { tags: Map<number, string[]>; unknown: MRApprovalRules[] }`. For a known entry: `sectionsMatching(rules, demanded)`, unioned when `sticky` with `stored(iid)` filtered to `demanded`, sorted. For an `unknownReason` entry: `stored(iid)` filtered to `demanded`, sorted, and the entry goes in `unknown`. (Writing the stored demanded tags back is the same as leaving the PR out of `freshTags` except for a stored section no demand names any more, which every sweep drops anyway.)

- [ ] **Step 1: Write the failing tests:**
  - `sweepTags`: sticky keeps a stored `@org/a` when fresh rules are empty and `@org/a` is demanded; sticky drops a stored `@org/b` no longer demanded; non-sticky returns fresh only; an unknown entry returns its stored demanded tags and lands in `unknown`.
  - GitHub deep (scoped, `forge: 'github'`, overrides for `fetchAuthors`, `fetchRules`, `fetchKnownSections`): a stored PR tagged `@org/a` whose fresh rules are `[]` (approved by a user owner) stays tagged after `replaceAll`; an `unknownReason` entry keeps its stored tag; `knownSections` is stored from `fetchKnownSections`.
  - GitHub sections delta: fresh `[]` for a stored-tagged PR records no tag change (`tagChangedIids` empty); a newly tagged stranger is hydrated through `fetchSingle` and tagged.
  - GitHub `backfillSections` runs (no notice), tags matches, and records `knownSections`.
  - GitLab deep with the same inputs is not sticky: the fresh `[]` untags (existing behaviour pinned).
  - One warn per sweep when any entry is unknown: `ProjectSyncOverrides.info` is replaced by `warn?: (obj: object, msg: string) => void` (default `log.warn`); the test passes a spy and asserts exactly one call per sweep whose object carries `unknown: <count>` and `reason: <first unknownReason>`.
  - Existing tests in `project-sync-github-sync.test.ts` that pin the old behaviour: rewrite "a scoped GitHub deep lists once, adds your login and skips sections" to "a scoped GitHub deep lists once, adds your login and sweeps sections" (its `fetchRules` override returns rules instead of throwing); delete "backfillSections on GitHub reads nothing and logs once" (the notice is gone; the new backfill test replaces it).
- [ ] **Step 2: Run** the daemon test command from Global Constraints. Expected: FAIL.
- [ ] **Step 3: Implement.** `githubReads` wires `fetchRules`/`fetchKnownSections` through the existing `context`; the three sweeps call `sweepTags` with `sticky: forge === 'github'` and `stored` reading `record.mrs[iid]?.codeownerSections` (backfill reads the current store). The deep builds `tags` and `matched` from `sweepTags`' non-empty entries, so a sticky PR is kept in `byIid` from the store exactly as other matches are.
- [ ] **Step 4: Run** the daemon test command and `bun run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `daemon: codeowner sections on GitHub, sticky until merge or close`.

### Task 8: Daemon delta index and behind-count re-measure on GitHub

**Files:**
- Modify: `lib/daemon/project-sync-github.ts` (`githubFetchDelta`)
- Modify: `lib/daemon/project-sync.ts` (`remeasureDivergedCounts`, `RemeasureOverrides`, `GITHUB_DIVERGED_REMEASURE_CAP`)
- Test: `lib/daemon/__tests__/project-sync-github.test.ts`, `lib/daemon/__tests__/project-sync.test.ts`

**Interfaces:**
- Consumes: `GitHubSyncProvider` from Task 7.
- Produces: `export const GITHUB_DIVERGED_REMEASURE_CAP = 25`; `RemeasureOverrides.fetchDivergedBatch?: (repoName: string, projectPath: string, iids: number[]) => Promise<Map<number, number | null>>`.

- [ ] **Step 1: Write the failing tests:**
  - `githubFetchDelta`: the index adapter calls `fetchMergeRequestIndex` with `{ projectPaths: ['o/r'], updatedAfter, states: ['merged','closed'] }` and `fetchPullRequests` is called once (opened only), so one delta cycle makes one listing plus one index call and no terminal fill (rewrite "one delta cycle costs two list reads" accordingly); a row authored `bob` with scope author `Bob` comes back as `Bob`; a never-stored reuse row is filled through `fetchSingleMR`.
  - `remeasureDivergedCounts` with `forge: 'github'` and 30 open stored PRs: `fetchDivergedBatch` called once with 25 iids (oldest-measured first, as `pickRemeasure` orders); returned counts land via `setDivergedCounts`; an iid missing from the map is counted failed and re-picked first next run; a null value marks measured without writing; a rejected batch counts all 25 failed and does not throw. GitLab with the same store still calls `fetchDiverged` per iid with cap 10.
  - `needsRebase` on a stored PR is unchanged after a GitHub re-measure.
  - Existing tests that pin the old behaviour: in `project-sync-github-sync.test.ts`, rewrite "remeasureDivergedCounts makes no read on GitHub" into the batched GitHub test above; in `project-sync-github.test.ts`, rewrite "a warning on the terminal listing fails the delta" to "a failed index read fails the delta" (the index rejects), and rewrite "terminal rows follow fetchDeltaFrom's reuse rule" so its fake serves terminal rows through `fetchMergeRequestIndex` and expects never-stored PR 8 to be filled through `fetchSingleMR`.
- [ ] **Step 2: Run** the daemon test command. Expected: FAIL.
- [ ] **Step 3: Implement.** Remove the GitHub early return. The default `fetchDivergedBatch` resolves the GitHub context the way `githubReads` does and calls `fetchDivergedCounts`. `lib/daemon/cache-refresh.ts` stays unchanged.
- [ ] **Step 4: Run** the daemon test command and `bun run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `daemon: GitHub delta reads the merged-PR index; behind counts re-measure on GitHub`.

### Task 9: Version, changelog and lockfile (at push time)

**Files:**
- Modify: `packages/glance/package.json` (`version`), `packages/glance/CHANGELOG.md`, root `bun.lock` (the `packages/glance` `version` line only)

- [ ] **Step 1:** `git fetch origin main` and read `git show origin/main:packages/glance/package.json`; if PR #1110 (or anything touching `packages/glance/src/GitLabProvider.ts`) merged, merge `origin/main` in and re-run every gate.
- [ ] **Step 2:** Set the version one minor past main's (from 0.31.0 that is 0.32.0), the matching `bun.lock` line, and a CHANGELOG entry listing the four reads, the new flags, `unknownReason`, and GitHub's `canFetchMergeRequestIndex` flip.
- [ ] **Step 3:** Run the full glance gate list, `bun run purity`, the daemon test command and `bun run typecheck`. Expected: all PASS.
- [ ] **Step 4: Draft the PR body** at `.superpowers/pr-body.md` (not committed): the spec's "Cost per repo per hour" table and total (+12 to +24 with section demand, 0 to +12 without), the forced-sync note, the sticky-tag caveat (a tag from a request someone removed by hand stays until the PR closes; a PR converted to draft drops its tags, as on GitLab), and the two items unverified until the live run (`refs/pull/<n>/head` as a compare head; 25 compares per request).
- [ ] **Step 5: Commit** `glance 0.32.0: GitHub codeowner rules, behind counts and merged-PR index (GLANCE-54)` (version per Step 2).
