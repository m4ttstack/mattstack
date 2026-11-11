# GitHub Through the Daemon, Plan A: Reads and Router

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The rt daemon picks GitLab or GitHub per repo, and every MR read, MR write and merge verb works on a GitHub repo.

**Architecture:** The reads the daemon makes with raw GitLab REST paths become `GitProvider` methods in glance, with a gitbeaker side and an Octokit side. `getRepoContext` becomes a forge-aware router with one long-lived provider per repo. Handlers call interface methods and check `ctx.forge` or `capabilities`, never `typeof provider.restRequest`.

**Tech Stack:** TypeScript, Bun, `@mattstack/glance` (Octokit, gitbeaker), the rt daemon, the rt MCP server.

**Spec:** `docs/superpowers/specs/2026-11-10-daemon-forge-router-design.md`, sections 1 to 5 and the first two Delivery items. Sections 6 to 8 (comment writes, thread verbs, evidence) are Plan B and Plan C, written after this plan merges.

## Global Constraints

- GitLab behaviour must not change: same success replies and same error strings for every GitLab input. The one exception: request counts for the moved list reads may differ by one on a last page.
- glance uses Octokit for GitHub and gitbeaker for GitLab REST. No new raw `fetch`. Raw HTTP stays only where it is today: GitLab GraphQL, the `restRequest` passthrough, `MRDetailFetcher`, `NoteMutator`.
- A token only ever goes to its own forge's host. The GitLab token keeps the confirmed-host check (`gitlabHostRefusal`).
- No change to the daemon's sync cadence, coalescing or deep and delta rules. Project sync, live watch and the discussions poller keep skipping GitHub repos.
- The `forge:get` guard lists are widened, never narrowed. It never follows a redirect and never returns a `token` or `*_token` value.
- Every GitHub read throws `RateLimitedError` on a rate limit and has a request-count test.
- `packages/glance`: `bun test`, `bun run check-types` and `bun run check:node` clean before every commit, run from `packages/glance`. After any `packages/glance/src` change a later rt test consumes, run `bun run build` there. Read `.claude/rules/workspace-packages.md` before touching `packages/rt-client` or `packages/glance`.
- rt-root tests run from the repo root (`bun test <file>`), never from a subdirectory. Run only the files a task touches.
- No em or en dashes in code, comments, docs or copy. A comment states a constraint the code cannot show.
- One commit per task, message prefixed `glance:` or `daemon:` or `mcp:`, ending with a `Co-Authored-By:` line naming the model that wrote it.
- Stage named files only. Never stage `packages/glance/harness_credentials.json`.
- No live forge calls outside Task 6. Task 6 runs the live suite once, against `m4ttheweric/glance-conformance` only.
- Never run a built rt binary or the daemon. Never touch the main checkout.
- Refusal wording follows the `rt:ui-copy` skill.

## Review Focus

1. A repo whose remote is on neither forge: the verb refuses exactly as today, and no token is read. (Task 7)
2. A GitHub read that hits a rate limit inside a daemon verb: the reply is `{ok: false, error}` naming the limit and when to retry, never a hang. (Task 9)
3. A `forge:get` path that leaves the repo by encoding or case (`repos/o/r/../../user`, `%2e%2e`, `Actions/Secrets`): refused. (Task 10)
4. The GitHub token changes or disappears while the daemon runs: the next call rebuilds the provider or says the token is missing; the old token is not reused. (Task 7)
5. A GitLab listing with more rows than the limit, or an error status with a long body: `truncated` and the error string are byte-identical to today. (Task 2, Task 9)

---

## PR 1: `glance: forge-neutral labels, pipeline list and PR summaries` (0.29.0)

### Task 1: Types, interface and capabilities

**Files:**
- Modify: `packages/glance/src/types.ts`, `packages/glance/src/GitProvider.ts`, `packages/glance/src/errors.ts`, `packages/glance/src/index.ts`
- Modify: `packages/glance/src/GitHubProvider.ts` (`restRequest` only), `packages/glance/src/GitLabProvider.ts` (capabilities only)
- Test: `packages/glance/tests/forge-reads-interface.test.ts` (new), `packages/glance/tests/gh-transport.test.ts`

**Interfaces, produced:**

```ts
export interface ProjectLabel { name: string; description: string | null; color: string | null }
export interface PipelineSummary { id: number; status: string; ref: string | null; sha: string | null; source: string | null; webUrl: string | null; createdAt: string | null }
export type SummaryState = 'opened' | 'merged' | 'closed' | 'all';
export interface PullRequestSummary {
  iid: number; title: string; state: 'opened' | 'merged' | 'closed'; draft: boolean;
  sourceBranch: string; targetBranch: string; author: string | null;
  webUrl: string | null; detailedMergeStatus: string | null; mergedAt: string | null;
}
export interface FetchSummariesOptions { state: SummaryState; author?: string; sourceBranch?: string; targetBranch?: string; search?: string; limit: number }

// errors.ts
export class ForgeHttpError extends Error { readonly status: number; readonly statusText: string; readonly bodyText: string }

// GitProvider
fetchProjectLabels(projectPath: string, options?: { search?: string; maxRows?: number }): Promise<{ labels: ProjectLabel[]; truncated: boolean }>;
fetchPipelineList(projectPath: string, options: { ref?: string; sha?: string; iid?: number; limit: number }): Promise<PipelineSummary[]>;
fetchCommitParents(projectPath: string, sha: string): Promise<string[]>;
fetchPipelineFailedJobs(projectPath: string, pipelineId: number): Promise<PipelineJob[]>;
fetchPullRequestSummaries(projectPath: string, options: FetchSummariesOptions): Promise<{ rows: PullRequestSummary[]; truncated: boolean }>;
addPullRequestLabels(projectPath: string, mrIid: number, labels: string[]): Promise<void>;
removePullRequestLabels(projectPath: string, mrIid: number, labels: string[]): Promise<void>;
```

- `author: "me"` means the token's own user on both forges.
- Capabilities added, true on both: `canFetchProjectLabels`, `canFetchPipelineList`, `canFetchCommitParents`, `canFetchPipelineFailedJobs`, `canFetchPullRequestSummaries`, `canEditLabels`.
- `GitHubProvider.restRequest(method, path, body?, op?, io?: { redirect?: 'manual' })`, same parameter order as GitLab's.

- [ ] **Step 1:** Write `forge-reads-interface.test.ts`: both providers expose each method as a function and each new capability as `true`; `ForgeHttpError` carries its three fields. In `gh-transport.test.ts`, add: `restRequest('GET', '/x', undefined, 'op', { redirect: 'manual' })` passes `redirect: 'manual'` to fetch and returns the 302 unfollowed.
- [ ] **Step 2:** Run `bun test tests/forge-reads-interface.test.ts tests/gh-transport.test.ts`. Expected: FAIL, methods undefined.
- [ ] **Step 3:** Add the types, the error class, the interface members (required, not optional) and the capability flags. Add method stubs that throw `not implemented` on each provider where the method does not exist yet, so the build stays green; Tasks 2 to 5 replace them. Extend GitHub's `restRequest`.
- [ ] **Step 4:** Run the two files, then `bun run check-types`. Expected: PASS.
- [ ] **Step 5:** Commit `glance: interface for labels, pipeline list and PR summaries`.

### Task 2: GitLab reads on gitbeaker

**Files:**
- Modify: `packages/glance/src/GitLabProvider.ts`
- Test: `packages/glance/tests/gitlab-forge-reads.test.ts` (new)

**Interfaces:** consumes Task 1. Produces the GitLab side of `fetchProjectLabels`, `fetchPipelineList`, `fetchPullRequestSummaries`, and a private `forgeHttpError(err: unknown): never` that turns a `GitbeakerRequestError` into `ForgeHttpError` (status, status text, response body text) and rethrows anything else.

The reference behaviour is today's daemon code: `listLabels`, `listPipelines` and `listMrsLive` in `lib/daemon/forge-reads.ts`, and `listMrsByTarget` in `lib/daemon/handlers/mr.ts`. Match their query parameters exactly:

- Labels: `per_page=100`, optional `search`; stop at `maxRows` (default 1000) with `truncated: true`.
- Pipelines: with `iid`, the MR's own pipelines; otherwise `order_by=id`, `sort=desc`, optional `ref`, `sha`; `per_page=limit`, one page.
- Summaries: `order_by=updated_at`, `sort=desc`; `author: "me"` sends `scope=created_by_me`, any other author sends `scope=all` plus `author_username`, no author sends `scope=all`; `source_branch`, `target_branch`, `search` when set; fetch until `limit + 1` rows are in hand, return `limit` rows and `truncated` when more existed.
- Row mapping equals `targetSummary` in `forge-reads.ts`.

- [ ] **Step 1:** Write the tests with stubbed fetch: one per method asserting the request path and query above and the mapped rows; `fetchPullRequestSummaries` with 101 rows and `limit: 100` returns 100 rows and `truncated: true`, and with a short page and no `x-next-page` header stops; a 404 with body `{"message":"404 Project Not Found"}` rejects with `ForgeHttpError` whose `status` is 404, `statusText` is `Not Found` and `bodyText` contains `404 Project Not Found`.
- [ ] **Step 2:** Run `bun test tests/gitlab-forge-reads.test.ts`. Expected: FAIL, `not implemented`.
- [ ] **Step 3:** Implement the three methods on `this.gb` (`ProjectLabels.all`, `Pipelines.all`, `MergeRequests.allPipelines`, `MergeRequests.all`) with explicit pagination options so gitbeaker never walks past the caps.
- [ ] **Step 4:** Run the file, `bun run check-types`, `bun run check:node`. Expected: PASS.
- [ ] **Step 5:** Commit `glance: GitLab labels, pipeline list and MR summaries on gitbeaker`.

### Task 3: GitHub labels, pipelines, commit parents, failed jobs

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts`
- Test: `packages/glance/tests/gh-forge-reads.test.ts` (new), `packages/glance/tests/gh-fill-cost.test.ts`

**Interfaces:** consumes Task 1.

- `fetchProjectLabels`: Octokit paginate on `GET /repos/{o}/{r}/labels`, `per_page: 100`; `search` filters by case-insensitive substring of the name, client-side; `color` gets a leading `#`.
- `fetchPipelineList`: `GET /repos/{o}/{r}/actions/runs` with `branch` from `ref`, `head_sha` from `sha`, `per_page: limit`. With `iid`, read the PR's head sha first (one `GET /pulls/{n}`), then list by `head_sha`. One run maps to one `PipelineSummary`: `id` the run id, `status` through the same status vocabulary `mapPipeline` in `githubFill.ts` produces, `source` the run's `event`, `webUrl` its `html_url`.
- `fetchCommitParents`: `GET /repos/{o}/{r}/commits/{sha}`, `parents[].sha`.
- `fetchPipelineFailedJobs`: `GET /repos/{o}/{r}/actions/runs/{id}/jobs?filter=latest`, paginated, jobs whose conclusion is `failure`, `timed_out` or `cancelled`, mapped to `PipelineJob` as the existing job mapping does.
- A non-2xx becomes `ForgeHttpError`; a rate limit becomes `RateLimitedError` (use `toRateLimitedError`).

- [ ] **Step 1:** Write `gh-forge-reads.test.ts` with `stubForge`/`useForgeStub` from `tests/helpers/gh-fill-fixture.ts`: mapping per method; `fetchPipelineList` with `iid` makes exactly 2 requests and without makes 1; a 403 with `x-ratelimit-remaining: 0` rejects with `RateLimitedError`; a 404 rejects with `ForgeHttpError` status 404. Add request-count cases to `gh-fill-cost.test.ts`: labels 1 request per 100, commit parents 1, failed jobs 1 per 100 jobs.
- [ ] **Step 2:** Run both files. Expected: FAIL.
- [ ] **Step 3:** Implement the four methods.
- [ ] **Step 4:** Run both files, `bun run check-types`, `bun run check:node`. Expected: PASS.
- [ ] **Step 5:** Commit `glance: GitHub labels, workflow runs, commit parents and failed jobs`.

### Task 4: GitHub PR summaries

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts`
- Test: `packages/glance/tests/gh-summaries.test.ts` (new), `packages/glance/tests/gh-fill-cost.test.ts`

**Interfaces:** consumes Task 1.

- No `author` and no `search`: GraphQL `repository.pullRequests(states, headRefName, baseRefName, first: 100, orderBy: {field: UPDATED_AT, direction: DESC})` through `graphqlRead`, selecting only the summary fields. `state: 'all'` sends all three states.
- With `author` or `search`: GraphQL `search(type: ISSUE)` with `repo:`, `is:pr`, the state qualifier, `author:` (`@me` for `"me"`), `head:`, `base:` and the search text.
- Page until `limit + 1` rows; return `limit` rows and `truncated`. This method never calls `fillPullRequests`.
- `detailedMergeStatus` is always null. `state` is `merged` when `merged` is true.

- [ ] **Step 1:** Write tests: each filter combination builds the expected query variables or search string; 101 nodes with `limit: 100` gives `truncated: true`; a merged PR maps to `state: 'merged'` with `mergedAt`; a GraphQL `RATE_LIMITED` error rejects with `RateLimitedError`. Cost cases: 50 rows is 1 GraphQL request, 150 rows is 2, and no REST request is made.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement `fetchPullRequestSummaries`.
- [ ] **Step 4:** Run the files and the type checks. Expected: PASS.
- [ ] **Step 5:** Commit `glance: GitHub PR summaries without the fill`.

### Task 5: Label adds and removes

**Files:**
- Modify: `packages/glance/src/GitLabProvider.ts`, `packages/glance/src/GitHubProvider.ts`
- Test: `packages/glance/tests/label-edits.test.ts` (new)

**Interfaces:** consumes Task 1.

- GitLab: one `MergeRequests.edit` with `addLabels` or `removeLabels` joined by commas, the same request `putMergeRequest` in `lib/daemon/handlers/mr.ts` sends today.
- GitHub: `POST /repos/{o}/{r}/issues/{n}/labels` with `{labels}` for adds; one `DELETE /repos/{o}/{r}/issues/{n}/labels/{name}` per removed label, name URL-encoded, a 404 on a label the PR does not carry is not an error. Writes use `retries: 0`.
- An empty list makes no request on either forge.

- [ ] **Step 1:** Write tests: the request per forge for one add and two removes; a label named `needs review/ui` is encoded in the GitHub DELETE path; a 404 on remove resolves; an empty list makes zero requests.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement both methods on both providers.
- [ ] **Step 4:** Run the file and the type checks. Expected: PASS.
- [ ] **Step 5:** Commit `glance: add and remove PR labels on both forges`.

### Task 6: Post-merge rate limit, live checks, release 0.29.0

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts` (the head-repository read in `mergePullRequest`), `packages/glance/tests/gh-fill-provider.test.ts`
- Modify: `packages/glance/tests/live/conformance.ts` (or the file that holds the live cases; confirm), `packages/glance/CHANGELOG.md`, `packages/glance/package.json`, `packages/glance/README.md` or `docs/glance` API page where `GitProvider` methods are listed

**Interfaces, produced:** when the merge PUT succeeded and the head-repository read is rate limited, `mergePullRequest` throws `ReadBackFailedError` with `writeApplied: true`, `cause` the `RateLimitedError`, and a message that says the PR merged and the source branch was not deleted.

- [ ] **Step 1:** Change the existing test that expects a `RateLimitedError` whose message matches `/^mergePullRequest merged o\/r#9 but .* was rate limited: /` to expect `ReadBackFailedError` with `writeApplied === true`, `cause instanceof RateLimitedError`, and a message containing `merged` and `source branch was not deleted`.
- [ ] **Step 2:** Run `bun test tests/gh-fill-provider.test.ts`. Expected: FAIL on that case.
- [ ] **Step 3:** Change the throw. Read `ReadBackFailedError`'s constructor in `src/errors.ts` first and pass the PR's iid as it requires.
- [ ] **Step 4:** Add one live case per new read on each forge (labels, pipeline list, commit parents, failed jobs, summaries, label add then remove), asserting values, not shapes. Run the whole glance suite, `check-types`, `check:node`.
- [ ] **Step 5:** Run the live suite once, against `m4ttheweric/glance-conformance` only. Record pass, fail and skip counts in the task report. A failure in a new case is fixed before the commit; a pre-existing failure is reported, not fixed.
- [ ] **Step 6:** Bump to `0.29.0`, write the CHANGELOG entry (new reads, label edits, `restRequest` parameters on GitHub, the `ReadBackFailedError` change marked as a behaviour change), update the method list in the docs, run `bun run build`.
- [ ] **Step 7:** Commit `glance: 0.29.0, a rate-limited post-merge read reports the merge as landed`.

Open PR 1 here. Per the repo's rule: wait for CodeRabbit and CI, address findings, merge with Matt's confirmation. PR 2 branches from main after it lands.

---

## PR 2: `daemon: pick the forge per repo` (RT-540)

### Task 7: The router

**Files:**
- Modify: `lib/daemon/freshness.ts`
- Test: `lib/daemon/__tests__/freshness-forge-router.test.ts` (new); existing `freshness-*.test.ts` stay unchanged and green

**Interfaces, produced:**

```ts
export type RepoContext =
  | { forge: "gitlab"; provider: GitLabProvider; projectPath: string; projectId: number }
  | { forge: "github"; provider: GitHubProvider; projectPath: string; projectId: null };

getRepoContext(repoName: string, repoPath?: string, projectPathOverride?: string): Promise<RepoContext>;
getGitLabContext(repoName: string, repoPath?: string, projectPathOverride?: string): Promise<Extract<RepoContext, { forge: "gitlab" }>>;
```

- `getGitLabContext` wraps the router and throws `unsupported: <verb area> needs a GitLab repo` text supplied by the caller when the repo is GitHub. Every existing caller that needs `projectId` or a `GitLabProvider` type (`discussions-store.ts`, `handlers/discussions.ts`, `mr-upload.ts`, `project-sync.ts`, `project-mrs.ts` where it needs GitLab-only calls) switches to it in this task, with no behaviour change on GitLab.
- GitHub providers live in a separate map inside the freshness core: `Map<repoName, { provider: GitHubProvider; token: string }>`. The token comes from `resolveGithubToken((await loadSecrets()).githubToken)`. A different resolved token drops the entry and builds a new provider. No token throws `missing GitHub token (run: rt setup github connect)`.
- The forge pick uses `isGitLabRemote` and `isGitHubRemote` from `lib/enrich.ts`. The GitLab path is byte-for-byte today's code, including `gitlabHostRefusal`. A remote on neither forge reaches today's refusal without resolving a GitHub token.
- GitHub providers are built with the same `providerRequestHook()` so requests are logged at debug.
- The `providers` map, `ensureProvider`, `ensureUserId` and the reconcile loop are not touched.
- Project sync (`project-sync.ts`) checks the forge before it asks for a context and skips a GitHub repo, with one info log per repo per daemon start, so it no longer fails every cycle there. Add a test for the skip and the single log line.

- [ ] **Step 1:** Write the tests through `createFreshness` with stubbed seams (follow `freshness-provider-rotation.test.ts` for the pattern): a github.com remote returns `forge: "github"`, `projectId: null`, the parsed `projectPath`, and a `GitHubProvider`; two calls return the same provider instance; a changed GitHub token returns a new instance; no GitHub token throws the message above; the GitLab token is never passed to a `GitHubProvider` and the GitHub token never to a `GitLabProvider` (assert on constructor arguments through the seam); a `bitbucket.org` remote throws today's refusal and the GitHub token resolver is not called; `getGitLabContext` on a GitHub repo throws; a gitlab.com remote returns exactly what it returns today.
- [ ] **Step 2:** Run `bun test lib/daemon/__tests__/freshness-forge-router.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the router, the GitHub map and `getGitLabContext`; switch the GitLab-only callers.
- [ ] **Step 4:** Run the new file and every `lib/daemon/__tests__/freshness-*.test.ts`. Run `bunx tsc --noEmit -p .` (or the repo's `check-types` script; confirm in `package.json`). Expected: PASS.
- [ ] **Step 5:** Commit `daemon: getRepoContext picks the forge per repo`.

### Task 8: MR verbs that use the interface

**Files:**
- Modify: `lib/daemon/handlers/mr.ts`, `lib/daemon/mr-writeback.ts` (or where `applyMRWriteback` lives; confirm)
- Test: `lib/daemon/handlers/__tests__/mr-github.test.ts` (new); `mr-create.test.ts`, `mr-update.test.ts`, `mr-writeback.test.ts` unchanged and green

**Interfaces:** consumes `RepoContext` (Task 7) and glance 0.29.0 (`addPullRequestLabels`, `removePullRequestLabels`). `MRHandlerOverrides.getContext` now returns `Promise<RepoContext>`-shaped values; tests pass `{ forge: "github", provider: stub, projectPath, projectId: null }`.

On a GitHub context:

- `mr:action`: `rebase` returns `{ok: false, error}` when `provider.capabilities.canRebase` is false, before any call. Other actions run as today.
- `mr:create`, `mr:update`: a payload with `squash` returns an error before anything is written, saying GitHub picks squash at merge time. `addLabels` / `removeLabels` call the two glance methods; `labels` on create goes through `updatePullRequest({labels})` after the create. The result URL is the returned PR's `webUrl`.
- `mr:get`: a null from `fetchSingleMR` returns `GitHub has no pull request #<n> in <path>, or the token cannot read it`. No `missingMrReason` call.
- `fetchSingle` passes no user id on GitHub (`getCurrentUserId()` is GitLab's).
- `mr:fetch-job-detail` and `mr:fetch-job-trace` call the interface as today; add one GitHub case each to the new test file.
- Every `applyMRWriteback` call is skipped, with one `ctx.log.debug`, and the verb still returns its result.

On GitLab, labels and squash keep `putMergeRequest` and the hand-built URL: no change.

- [ ] **Step 1:** Write `mr-github.test.ts` with a stub provider recording calls: `rebase` refuses with no provider call; `merge` calls `mergePullRequest` and returns `{ok: true}`; a merge that throws `ReadBackFailedError` with `writeApplied` returns `{ok: true}`; `mr:update` with `addLabels: ["a"]`, `removeLabels: ["b"]` calls the two methods and returns the PR's `webUrl`; `mr:update` with `squash: true` returns an error and makes zero provider calls; `mr:get` on a miss returns the message above; the writeback spy is never called for any of them.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the GitHub branches.
- [ ] **Step 4:** Run the new file and the three existing ones. Expected: PASS.
- [ ] **Step 5:** Commit `daemon: MR actions, create, update and get on GitHub`.

### Task 9: List, label and pipeline verbs through glance

**Files:**
- Modify: `lib/daemon/forge-reads.ts`, `lib/daemon/handlers/mr.ts`
- Test: `lib/daemon/__tests__/forge-reads.test.ts` (existing GitLab cases rewritten onto a stub provider with the same expected replies), `lib/daemon/handlers/__tests__/mr-lists-github.test.ts` (new), `lib/daemon/__tests__/mr-ci-verbs.test.ts`

**Interfaces, produced in `forge-reads.ts`:**

```ts
export function forgeFailure(err: unknown, forge: "gitlab" | "github"): string;
// ForgeHttpError -> "GitLab returned 404 Not Found: <first 200 chars of body>" (or "GitHub returned ...");
// RateLimitedError -> its message plus " (retry in <n>s)" when retryAfterMs is set; anything else -> String(err)
```

- `listMrsLive`, `listLabels`, `listPipelines` and `listMrsByTarget` keep their names, limits, conflict check (`PIPELINE_IID_CONFLICT`) and reply shapes, and call `fetchPullRequestSummaries`, `fetchProjectLabels`, `fetchPipelineList`. `listMrsByTarget` asks for `limit: BY_TARGET_MAX_PAGES * BY_TARGET_PER_PAGE` and turns `truncated` into today's "more than 2000 MRs target ..." error. `listLabels` turns `truncated` into today's "more than 1000 labels matched; narrow the search".
- `mr:live-by-branch` on GitHub calls `provider.fetchPullRequestsByBranches(projectPath, branches)` once (the batched fill) and maps a missing branch to `null`. On GitLab it keeps summaries plus `fetchSingle`.
- `mr:commit-parents` and `mr:pipeline-failed-jobs` call the interface methods on both forges.
- All seven `typeof provider.restRequest` checks and the two `typeof provider.fetch...` checks are deleted. `RestProvider` stays only as `forgeGet`'s parameter type.

- [ ] **Step 1:** Rewrite the GitLab cases in `forge-reads.test.ts` so the stub is a provider (methods returning rows or throwing `ForgeHttpError`) and every expected reply, `truncated` flag and error string is the one the file asserts today. Add: a `ForgeHttpError(404, "Not Found", <300 chars>)` yields `GitLab returned 404 Not Found: ` plus exactly the first 200 chars. Write `mr-lists-github.test.ts`: each of the seven verbs returns mapped data from a GitHub stub; `mr:live-by-branch` with 3 branches makes one `fetchPullRequestsByBranches` call; a `RateLimitedError` with `retryAfterMs: 60000` from the provider yields `{ok: false}` whose error contains `rate limit` and `retry in 60s`.
- [ ] **Step 2:** Run the three files. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the three files plus `lib/mcp/__tests__/forge-read-tools.test.ts` and `mr-read-tools.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `daemon: list, label and pipeline reads go through glance`.

### Task 10: `forge:get` on GitHub

**Files:**
- Modify: `lib/daemon/forge-reads.ts`, `lib/daemon/handlers/mr.ts` (the `forge:get` handler), `lib/mcp/forge-read-tools.ts` (description text only)
- Test: `lib/daemon/__tests__/forge-get-github.test.ts` (new); the GitLab `forge:get` cases in `forge-reads.test.ts` unchanged and green

**Interfaces, produced:**

```ts
export const GITHUB_REFUSED_SEGMENTS: readonly string[];  // the spec section 4 list, verbatim
export const GITHUB_REFUSED_QUERY_KEYS: readonly string[]; // ["access_token", "client_secret", "token"]
export function checkGithubForgePath(path: unknown, projectPath: string): { ok: true; path: string } | { ok: false; error: string };
export function forgeGet(provider: RestProvider, projectPath: string, input: ForgeGetInput, forge?: "gitlab" | "github"): Promise<...>; // default "gitlab"
```

- `checkGithubForgePath` applies the same control-character, `?`, `#`, `://`, backslash, malformed-escape, double-encoding and dot-segment checks as `checkForgePath`. Then: a leading `:repo` segment expands to `repos/<owner>/<repo>`; the decoded, lower-cased path must start with `repos/<owner>/<repo>/` or equal `repos/<owner>/<repo>` (compare lower-cased), else it is refused as outside the repo; any segment equal to a refused segment, and the two-segment entry `actions/oidc`, is refused.
- GitHub paging: `nextPage` is the `page` value of the `Link` header's `rel="next"` URL; `totalPages` is null. `per_page` and `page` are set as on GitLab.
- The redirect refusal, the 256 KiB cap, `scrubTokens` and `scrubTokenText` are shared, unchanged.
- The MCP tool `gitlab_get` keeps its name; its description says it reads the repo's own forge and that on GitHub the path must sit under the repo.

- [ ] **Step 1:** Write the tests: one refusal per entry in `GITHUB_REFUSED_SEGMENTS` (loop over the constant, and assert its length is 17 so a deletion fails the test); `Actions/Secrets` and `actions%2Fsecrets` refused; `repos/o/r/../../user`, `%2e%2e`, `user`, `repos/other/repo/pulls` and `orgs/o/members` refused; `:repo/pulls` and `repos/O/R/pulls` (other case) accepted; each refused query key refused; a 302 returns the redirect refusal naming only the host; a body with `"token":"x"` comes back redacted; a `Link` header with `page=3; rel="next"` gives `nextPage: 3`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the GitHub arm and pass `ctx.forge` from the handler.
- [ ] **Step 4:** Run the new file, `forge-reads.test.ts`, `lib/mcp/__tests__/forge-read-tools.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `daemon: forge:get reads GitHub under the repo, behind its own guard list`.

### Task 11: GitHub merge behind the daemon

**Files:**
- Modify: `packages/rt-client/src/commands.ts`, `lib/daemon/handlers/mr.ts`, `lib/mcp/github-merge.ts`
- Test: `lib/daemon/handlers/__tests__/mr-merge-queue.test.ts` (new), `lib/mcp/__tests__/github-merge.test.ts`

**Interfaces, produced:**

```ts
// daemon verbs, typed in commands.ts
"mr:merge-queue-status": { payload: { repoName: string; iid: number }; data: MergeQueueStatus };
"mr:enqueue":            { payload: { repoName: string; iid: number; expectedHeadSha?: string }; data: { position: number | null; state: string } };
```

- Both verbs return `unsupported: this forge has no merge queue` when `capabilities.canEnqueue` is false.
- In `github-merge.ts`, `realProvider()` is replaced by an adapter that implements the existing `GithubMergeProvider` seam over daemon verbs for the target's repo identity: `fetchMergeQueueStatus` and `enqueuePullRequest` call the two new verbs; `setAutoMerge` calls `mr:action` `setAutoMerge`; `mergePullRequest` calls `mr:action` `merge` and then `mr:get` with `refresh: true` to return the PR. `mergeOnGitHub`, `waitForQueue` and every result string are unchanged; the wait loop stays in the MCP server.
- `GitHubProvider` is no longer imported in `lib/mcp/`.

- [ ] **Step 1:** Write `mr-merge-queue.test.ts`: status and enqueue map the provider's return; a provider with `canEnqueue: false` refuses with no call. In `github-merge.test.ts`, keep every existing case (they inject `seams.provider`) and add adapter cases with a fake daemon query: each adapter method sends the expected verb and payload; a daemon `{ok: false, error}` rejects with that error text; `mergePullRequest` returns the PR from `mr:get`.
- [ ] **Step 2:** Run both. Expected: FAIL.
- [ ] **Step 3:** Implement the verbs and the adapter. Rebuild `packages/rt-client` as `.claude/rules/workspace-packages.md` says.
- [ ] **Step 4:** Run both files and `lib/mcp/__tests__/mr-target.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `mcp: GitHub merges go through the daemon`.

### Task 12: Remaining daemon callers, tool refusals, docs

**Files:**
- Modify: `lib/daemon/file-diff.ts`, `lib/daemon/herd-lanes.ts`, `lib/mcp/mr-read-tools.ts`, `lib/mcp/mr-composite-tools.ts`, `lib/mcp/ci-tools.ts`, `lib/mcp/git-tools.ts`, `lib/mcp/tools.ts` (descriptions), `.claude/rules/mcp-and-gates.md`, `docs/architecture.md` if it names the GitLab-only provider
- Test: `lib/daemon/__tests__/forge-file-diff.test.ts`, `lib/daemon/__tests__/herd-lanes.test.ts`, `lib/mcp/__tests__/mr-read-tools.test.ts`, `lib/mcp/__tests__/mr-composite-tools.test.ts`

- `file-diff.ts` and `herd-lanes.ts` take their provider from `getRepoContext` and stop calling `new GitHubProvider`. Behaviour and replies are unchanged.
- A GitHub refusal in an MCP tool is removed only when every daemon verb that tool calls now works on GitHub. From the verb map: `mr_view`, `mr_list`, `mr_for_branch`, `mr_pipeline`, `mr_job_trace`, `pipeline_jobs`, `project_labels`, `pipeline_list`, `gitlab_get`, `mr_approve`, `mr_ready`, `mr_retry`, `mr_create`, `mr_update`, `mr_merge`, `mr_resolve_branch` lose it. `mr_rebase` keeps a refusal that comes from the daemon. Tools that call `discussions:*`, `mr:comment*`, `mr:note-update`, `mr:review-submit` or `mr:upload` keep theirs until Plan B and Plan C. For each tool, read its handler and confirm the verbs it calls before removing anything; report any tool whose verb set differs from this list.
- Tool descriptions drop "GitLab only" where the tool now covers both.
- `ci_watch` and `ci_triage` stay as they are (RT-546).
- `mcp-and-gates.md`: update the paragraphs on GitLab reads, `gitlab_get` and `mr_merge` to describe both forges and the GitHub guard list.

- [ ] **Step 1:** Update the tests: the file-diff and herd-lanes tests inject a GitHub `RepoContext` and assert no provider is constructed in the module; for each tool losing its refusal, the test that asserted the refusal now asserts the daemon verb is called with the GitHub identity; for each tool keeping one, the refusal test stays.
- [ ] **Step 2:** Run the four files. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the four files, then `bun run check` from the repo root for the static gates. Expected: PASS.
- [ ] **Step 5:** Commit `mcp: forge tools stop refusing GitHub where the daemon now answers`.

Open PR 2. Same merge rule as PR 1. After merge, the dev daemon runs this only once the main checkout syncs and the daemon restarts; do neither without Matt.
