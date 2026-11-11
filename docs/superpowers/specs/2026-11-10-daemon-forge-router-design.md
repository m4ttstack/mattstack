# Daemon forge router (RT-540)

Status: draft for review, 2026-11-10. Project: GitHub parity (P-RT-28).

## Why

Agents reach a forge through the rt MCP server, which hands every call to
the daemon. The daemon builds its forge client in one function,
`getRepoContext` (`lib/daemon/freshness.ts`), and that function only builds
a `GitLabProvider`. On a GitHub repo it refuses with "github.com is not a
configured GitLab host", so about 28 daemon verbs fail and every MCP tool,
board action and skill above them inherits the failure.

glance 0.28.0 gave GitHub a real PR read model. This work lets the daemon
use it.

## Goals

- The daemon picks GitLab or GitHub per repo, from the repo's remote.
- Every verb in the table below works on a GitHub repo, or refuses in plain
  words that name the ticket that will bring it.
- A token only ever goes to its own forge's host.
- One long-lived provider per repo and token, so glance's caches hold
  across the daemon's 5-minute loop.

## Non-goals

- GitHub Enterprise (RT-550). The lookup is keyed by host so it can be
  added without reshaping this code.
- Project sync on GitHub (RT-542), discussions and comment writes (RT-541,
  GLANCE-48), live refresh (RT-544), CI watch and triage (RT-546), evidence
  upload (RT-547), the board (BOARD-59 and later).
- Renaming MCP tools or rewording their GitLab-only descriptions beyond
  what stops being true here (RT-549 decides the wording).

## Anti-goals

- GitLab behaviour must not change: same replies, same error strings, same
  request counts for every GitLab input.
- No change to the daemon's sync cadence, coalescing or deep and delta
  rules.
- No hand-written HTTP in glance where its client library has the call.
- The raw passthrough must never return a credential or follow a redirect.

## Approaches

**A. GitHub versions inside glance (picked).** The reads the daemon makes
with raw GitLab REST paths become methods on glance's `GitProvider`
interface, with a GitLab and a GitHub implementation. The daemon calls the
interface and stops building forge URLs. Forge API code stays in one
place, under glance's tests, live conformance suite and request-cost
checks, and gitq and the VS Code extension get the reads too. Costs a
glance minor version (0.29.0) and care that GitLab answers are unchanged.

**B. GitHub branches inside the daemon.** Keep `forge-reads.ts` as it is
and write a GitHub arm beside each GitLab arm. Faster, glance untouched.
Forge API code then lives in two places and the daemon's GitHub calls
would bypass glance's typed errors and cost tests.

Matt picked A on 2026-11-10, with the rule that glance uses its client
libraries (Octokit, gitbeaker) wherever they cover the call.

## Decided

1. All eight REST-only reads get a GitHub version (Matt, 2026-11-10).
2. The GitHub versions live in glance (Matt, 2026-11-10).
3. glance uses Octokit for GitHub and gitbeaker for GitLab REST. Raw
   `fetch` stays only where it is today: GitLab GraphQL, the `restRequest`
   passthrough, `MRDetailFetcher` and `NoteMutator`.
4. One forge per team, host-aware lookup, Enterprise later (ruled
   2026-11-09).
5. The GitLab side of the moved reads uses gitbeaker and translates its
   errors back to today's `GitLab returned <status> <statusText>: <body>`
   strings, pinned by tests. Success replies stay identical. Request
   counts may differ by one on a last page (Matt, 2026-11-10). This is the
   one stated exception to "same request counts".
6. GitHub `mr_merge` moves behind the daemon (Matt, 2026-11-10).

## Design

### 1. The router

`getRepoContext` becomes forge-aware. Its return type loosens to:

```ts
{ forge: "gitlab" | "github";
  provider: GitProvider;          // GitLabProvider or GitHubProvider
  projectPath: string;
  projectId: number | null }      // null on GitHub
```

- **Forge pick:** from the origin remote, through the existing
  `isGitLabRemote` / `isGitHubRemote` in `lib/enrich.ts`. A remote on
  neither refuses as today.
- **Token:** GitLab keeps `loadSecrets().gitlabToken` behind
  `gitlabHostRefusal` (the confirmed-host check). GitHub uses
  `resolveGithubToken(secrets.githubToken)`, which falls back to the `gh`
  session. The token lookup takes the host as its key; today only
  `github.com` resolves for GitHub.
- **Cache:** GitHub providers live in their own map, one per repo, keyed
  with the token they were built for; a changed GitHub token drops the
  entry. The existing `providers` map stays GitLab-only, because
  `ensureUserId`, `ensureProvider` and the reconcile loop all read it as
  GitLab (builder's call, mine). The long-lived GitHub provider is what
  makes glance's 10-minute rulesets cache hold between daemon calls.
- **Missing token:** GitHub refuses with
  `missing GitHub token (run: rt setup github connect)`.
- **`projectId`:** GitHub has none, so no `GET /projects/:path` is made.
  Callers that need a number (`NoteMutator`, upload, the discussions
  store) check `forge` first and refuse.
- A GitLab-typed accessor (`getGitLabContext`) wraps the router for the
  callers below that stay GitLab-only, so their types do not loosen.

`lib/daemon/file-diff.ts` and `lib/daemon/herd-lanes.ts` build a
`GitHubProvider` per call today; they move to the router. `lib/enrich.ts`
(also used by the CLI) keeps its own construction. `lib/mcp/github-merge.ts`
stops building one (section 3).

### 2. New glance reads (0.29.0)

Added to `GitProvider`, implemented on both providers. GitLab
implementations must return what the daemon's current REST code returns.

| Method | GitLab | GitHub |
|---|---|---|
| `fetchProjectLabels(projectPath, {search?})` | gitbeaker `ProjectLabels.all` | Octokit paginate `GET /repos/{o}/{r}/labels`, search filtered client-side |
| `fetchPipelineList(projectPath, {ref?, sha?, iid?, limit?})` | gitbeaker `Pipelines.all` / MR pipelines | `GET /repos/{o}/{r}/actions/runs` with `branch`, `head_sha`; `iid` resolves the PR head sha first |
| `fetchCommitParents(projectPath, sha)` | exists (gitbeaker) | `GET /repos/{o}/{r}/commits/{sha}`, `parents[].sha` |
| `fetchPipelineFailedJobs(projectPath, pipelineId)` | exists (gitbeaker) | `GET /repos/{o}/{r}/actions/runs/{id}/jobs?filter=latest`, failed conclusions |
| `fetchPullRequestSummaries(projectPath, {state, author?, sourceBranch?, targetBranch?, search?, limit})` | gitbeaker `MergeRequests.all` | one GraphQL `pullRequests` (or `search` when `author` or `search` is set), no fill |

- A GitHub "pipeline" in the list is one workflow run. Its id is the run
  id, which is numeric, so `PipelineListRow.id` and `pipelineId` keep
  their types.
- `fetchPullRequestSummaries` returns the light row the daemon's
  `MrTargetSummary` needs (iid, title, state, draft, branches, author,
  url, mergedAt, and GitLab's `detailedMergeStatus`, null on GitHub). It
  carries no `readiness`: that comes from the fill, which a listing does
  not run, and GitLab replies gain no field. It backs `mr:list-live`,
  `mr:live-by-branch` and `mr:by-target`. It does not run the batched
  fill: a listing is one request per 100 rows.
- A truncated walk is an error or a `truncated: true`, exactly as each
  daemon verb reports it today.
- Each GitHub read throws `RateLimitedError` like the rest of the read
  model, and gets a request-count test.
- `GitHubProvider.restRequest` gains the `op` and `io: {redirect}`
  parameters GitLab's has.
- `capabilities` gains a flag per new read, true on both.
- `addPullRequestLabels` and `removePullRequestLabels` join the
  interface. GitLab's `add_labels` / `remove_labels` are deltas, and
  GitHub's `updatePullRequest({labels})` replaces the whole set, so the
  GitHub side uses the issue add-label and remove-label endpoints.

### 3. Daemon verbs on GitHub

| Verb | On GitHub |
|---|---|
| `mr:get` | works: `fetchSingleMR`; a miss reads the reason from the provider's error |
| `mr:action` | works for merge, approve, unapprove, setAutoMerge, cancelAutoMerge, retryPipeline, retryJob, toggleDraft, requestReReview; `rebase` refuses by `capabilities.canRebase` (GLANCE-45) |
| `mr:create`, `mr:update` | work; label adds and removes go through the two new label methods; a call that passes `squash` refuses before anything is written ("GitHub picks squash at merge time") |
| `mr:fetch-job-detail`, `mr:fetch-job-trace` | work through the interface |
| `mr:list-live`, `mr:live-by-branch`, `mr:by-target` | work through `fetchPullRequestSummaries` |
| `project:labels`, `pipeline:list`, `mr:commit-parents`, `mr:pipeline-failed-jobs` | work through the new reads |
| `forge:get` | works, see section 4 |
| `forge:file-diff`, `project-mrs:read`, `mr:by-branch` | work (already interface-only) |
| `discussions:*`, `mr:comment*`, `mr:note-update`, `mr:review-submit` | refuse: "not on GitHub yet (RT-541)" |
| `mr:upload` | refuses: "GitHub has no PR upload API (RT-547)" |
| project sync, live watch | skip GitHub repos with one info log per repo per daemon start (RT-542, RT-544) |

- **Merge on GitHub.** `lib/mcp/github-merge.ts` builds its own
  `GitHubProvider` today. Its logic (queue status, enqueue, requeue after
  a drop, auto-merge, plain merge) moves into the daemon behind new verbs
  `mr:merge-queue-status` and `mr:enqueue`, plus the existing `mr:action`
  for merge and setAutoMerge. The MCP tool keeps its inputs, results and
  wording, and keeps the wait loop on its side so a long wait never holds
  a daemon request open; each poll is one `mr:merge-queue-status` call.
  On GitLab the two new verbs refuse by `capabilities.canEnqueue`.
- The seven `typeof provider.restRequest` guards go. Each verb either
  calls an interface method or checks `ctx.forge` / `capabilities`.
- `forge-reads.ts` keeps its GitLab REST code only for `forge:get`. The
  list, label and pipeline functions become thin calls to glance, with
  their limits, truncation rules and error wording kept.
- On GitHub, result URLs come from the PR's `webUrl`. GitLab keeps its
  hand-built URL, so its replies do not change.
- The daemon reply types do not change; `detailedMergeStatus` is null on
  GitHub.
- The write-back into the project-MRs store (`applyMRWriteback`) is
  skipped for GitHub repos, with a debug log, until RT-542 fills that
  store for GitHub. The verbs still return their result.
- `mr-read-tools.ts`, `mr-composite-tools.ts` and `ci-tools.ts` drop a
  GitHub refusal only where the verb beneath it now works.

### 4. `forge:get` on GitHub

The raw passthrough is the one place a mistake leaks a credential, and
the repo rule says its guard lists are widened, never narrowed, without a
design review. This section is that review for the GitHub arm.

- GET only, through `restRequest` with `redirect: "manual"`; a 3xx is
  refused, naming the host only.
- The path must sit under the repo: `:repo` expands to
  `repos/{owner}/{repo}`, and a path that does not start there is refused.
  This is stricter than GitLab's arm, which allows any API path.
- Refused segments on GitHub: `secrets`, `variables`, `hooks`, `keys`,
  `deploy_keys` (alias), `installations`, `tokens`, `runners`,
  `registration-token`, `remove-token`, `environments`, `codespaces`,
  `dependabot`, `actions/oidc`, `autolinks`, `invitations`,
  `private-vulnerability-reporting`. Log and artifact downloads answer
  with a redirect to a signed URL and so are refused by the redirect rule.
- Refused query keys: `access_token`, `client_secret`, `token`.
- The 256 KiB cap, the `token` / `*_token` redaction and the
  percent-encoding checks are shared with the GitLab arm.
- Paging comes from the `Link` header (`nextPage`), `totalPages` is null.
- The MCP tool keeps the name `gitlab_get`; its description says it reads
  the repo's own forge. A rename is RT-549's call.

### 5. Carried from the read model

- **Post-merge rate limit reads as a failed merge.** When the merge
  landed but the head-repository read was rate limited, glance throws
  `ReadBackFailedError` with `writeApplied: true` and the
  `RateLimitedError` as `cause`. `mr:action` and `mr_merge` already treat
  that as landed. The source branch is not deleted in that case; the
  error message says so.
- **Long-lived providers:** section 1.
- **Not here:** batching the pipeline top-up, keeping the cache when a
  whole fill batch fails, and aliasing contexts pages across PRs all sit
  in project sync, which GitHub does not reach until RT-542. They move to
  that ticket.

## Delivery

Two PRs, glance first:

1. `glance: forge-neutral labels, pipeline list and PR summaries` (0.29.0),
   with the `ReadBackFailedError` change.
2. `daemon: pick the forge per repo` (RT-540), consuming it.

## Testing

- glance: stubbed tests per new read on both forges, a request-count test
  per GitHub read, and GitLab tests pinning today's reply shapes. Live
  conformance gains the new reads on both forges (one run, against
  glance-conformance only).
- Daemon: each verb in section 3 gets a GitHub-shaped test through a
  stubbed provider, plus a refusal test for each verb that refuses.
  A token-routing test proves the GitLab token is never passed to a
  `GitHubProvider` and the reverse. Existing GitLab tests stay untouched
  and green.
- `forge:get`: the GitLab guard tests are mirrored for GitHub, one per
  refused segment and query key, plus the path-scope and redirect cases.

## Left to the builder

- Exact method names and option shapes, kept consistent with
  `GitProvider.ts`.
- Whether `fetchPullRequestSummaries` on GitHub uses `pullRequests` or
  `search` per filter combination, decided by measured request counts.
- How the GitLab-only accessor is typed.
- The wording of each refusal, following `rt:ui-copy`.
