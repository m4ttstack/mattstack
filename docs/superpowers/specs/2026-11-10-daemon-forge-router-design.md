# GitHub through the daemon (RT-540, RT-541, RT-547, GLANCE-47, GLANCE-48)

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
- Every MCP forge tool works on a GitHub repo: reads, writes, comments,
  threads, whole reviews and evidence. The few verbs that still refuse say
  why in plain words.
- A token only ever goes to its own forge's host.
- One long-lived provider per repo and token, so glance's caches hold
  across the daemon's 5-minute loop.

## Non-goals

- GitHub Enterprise (RT-550). The lookup is keyed by host so it can be
  added without reshaping this code.
- Project sync on GitHub (RT-542), live refresh (RT-544), CI watch and
  triage (RT-546), per-forge notification identity beyond what new-comment
  alerts need (RT-543), the board (BOARD-59 and later), and moving the
  skills off their `gh` steps (SKILLS-105, 106, 107).
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
   errors back to `GitLab returned <status> <statusText>: <detail>`,
   pinned by tests. gitbeaker keeps only GitLab's message text, so
   `<detail>` is that message (`404 Project Not Found`) where today it is
   the raw JSON body. Matt accepted that wording change on 2026-11-10.
   Success replies stay identical. Request counts may differ by one on a
   last page. On a 429 or 502, gitbeaker retries up to 10 times within
   about a quarter of a second, as it does for every other GitLab call
   glance makes, and `<detail>` is then gitbeaker's retry text. GitLab's
   limits use fixed windows, so the extra requests do not lengthen a
   block. Matt accepted that on 2026-11-10. These are the three stated
   exceptions to "GitLab behaviour must not change".
6. GitHub `mr_merge` moves behind the daemon (Matt, 2026-11-10).
7. Comments, threads, reviews and evidence are in this spec, not later
   tickets (Matt, 2026-11-10).
8. Comment and review writes are methods on `GitProvider` (ruled with the
   read model, 2026-11-10).
9. Evidence images on GitHub upload through GitHub's own CLI,
   `gh ... --attach` (gh 2.99+), run by the daemon. GitHub has no REST or
   GraphQL upload endpoint, so this is the one forge call that does not go
   through glance (Matt, 2026-11-10). Checked live on 2026-11-10: with rt's
   stored device-sign-in token in `GH_TOKEN`, `gh pr comment --attach`
   uploaded an image and rewrote the body's local reference to a
   `github.com/user-attachments/assets/...` URL.

## Design

### 1. The router

`getRepoContext` becomes forge-aware. Its return type loosens to:

```ts
{ forge: "gitlab" | "github";
  provider: GitProvider;          // GitLabProvider or GitHubProvider
  projectPath: string;
  projectId: number | null }      // null on GitHub
```

- **Forge pick:** a remote that `isGitHubRemote` (`lib/enrich.ts`)
  recognises takes the GitHub path. Every other remote takes today's
  path untouched, so a confirmed self-managed GitLab host keeps working
  and anything else refuses as today.
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
- **`projectId`:** GitHub has none, so no `GET /projects/:path` is made
  and `projectId` is null. The context also carries
  `repositoryId: string`, the form `fetchMRDiscussions` takes:
  `gitlab:<projectId>` or `github:<repo id>`. On GitHub the repo id is
  read once per repo, on first need, and cached.
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
| `fetchPullRequestSummaries(projectPath, {state, author?, sourceBranch?, targetBranch?, search?, limit, sort?})` | gitbeaker `MergeRequests.all` | one GraphQL `pullRequests` (or `search` when `author` or `search` is set), no fill |

- A GitHub "pipeline" in the list is one workflow run. Its id is the run
  id, which is numeric, so `PipelineListRow.id` and `pipelineId` keep
  their types.
- `fetchPullRequestSummaries` returns the light row the daemon's
  `MrTargetSummary` needs (iid, title, state, draft, branches, author,
  url, mergedAt, and GitLab's `detailedMergeStatus`, null on GitHub). It
  carries no `readiness`: that comes from the fill, which a listing does
  not run, and GitLab replies gain no field. It backs `mr:list-live`
  and `mr:by-target`. It does not run the batched
  fill: a listing is one request per 100 rows.
- A truncated walk is an error or a `truncated: true`, exactly as each
  daemon verb reports it today.
- Each GitHub read throws `RateLimitedError` like the rest of the read
  model, and gets a request-count test.
- `GitHubProvider.restRequest` gains the `op` and `io: {redirect}`
  parameters GitLab's has.
- The new methods are optional interface members guarded by a
  capability flag each, the convention `enqueuePullRequest` follows; all
  flags are true on both providers when PR 1 lands.
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
| `mr:list-live`, `mr:by-target` | work through `fetchPullRequestSummaries` |
| `mr:live-by-branch` | works through one batched read, one request for up to 25 branches; a branch it returns null for is confirmed with one read of open pull requests filtered by that branch, and a pull request that exists but cannot be read is an error, never "no PR" |
| `project:labels`, `pipeline:list`, `mr:commit-parents`, `mr:pipeline-failed-jobs` | work through the new reads |
| `forge:get` | works, see section 4 |
| `forge:file-diff`, `project-mrs:read`, `mr:by-branch` | work (already interface-only) |
| `discussions:*`, `mr:comment*`, `mr:note-update`, `mr:review-submit` | work, see section 7 |
| `mr:upload` | refuses and names `evidence_attach`, see section 8 |
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
  `private-vulnerability-reporting`, `secret-scanning`,
  `organization-secrets`, `organization-variables`,
  `security-advisories`. Log and artifact downloads answer
  with a redirect to a signed URL and so are refused by the redirect rule.
- RT-554 narrows this list for file paths and repo names; see 2026-11-13-gitlab-get-github-guard-narrowing-design.md.
- Refused query keys: `access_token`, `client_secret`, `token`.
- The 256 KiB cap, the `token` / `*_token` redaction and the
  percent-encoding checks are shared with the GitLab arm.
- Paging comes from the `Link` header (`nextPage`), `totalPages` is null.
- The MCP tool keeps the name `gitlab_get`; its description says it reads
  the repo's own forge. A rename is RT-549's call.

### 5. Carried from the read model

- **A merge that landed never fails over branch cleanup.** After a merge that
  landed, no source-branch cleanup failure throws (a rate-limited or
  forbidden head-repository read, an unknown head repository, a failed
  delete). `mergePullRequest` resolves with the merged PR and a
  `sourceBranchNotDeleted` sentence, and `mr:action` and `mr_merge` pass
  that sentence on to the caller. A failed verification read-back is
  separate and still throws `ReadBackFailedError` with
  `writeApplied: true`, which both already treat as landed.
- **Long-lived providers:** section 1.
- **Not here:** batching the pipeline top-up, keeping the cache when a
  whole fill batch fails, and aliasing contexts pages across PRs all sit
  in project sync, which GitHub does not reach until RT-542. They move to
  that ticket.

### 6. Comment and review writes in glance (GLANCE-48, GLANCE-47)

New `GitProvider` methods. The GitLab side wraps today's `NoteMutator`
calls unchanged (same endpoints, same errors, same timeouts or lack of
them; RT-382 owns GitLab write timeouts). The GitHub side uses Octokit
with `retries: 0` and a timeout on every write, so a slow forge can never
turn one comment into two.

| Method | GitLab | GitHub |
|---|---|---|
| `createComment(projectPath, iid, body, {resolvable?})` | `createNote` / `createDiscussion` | `POST issues/{n}/comments`; never resolvable |
| `createInlineComment(projectPath, iid, body, anchor)` | `fetchDiffRefs` + `createPositionedDiscussion` | `POST pulls/{n}/comments` with the head `commit_id`, `path`, `line`, `side` |
| `replyToDiscussion(projectPath, iid, discussionId, body)` | `createNote` with the discussion id | `POST pulls/{n}/comments/{root}/replies`, from `gh-review-thread-<root>` |
| `updateComment(projectPath, iid, note, body)` | `updateNote` | `PATCH pulls/comments/{id}` or `issues/comments/{id}` |
| `deleteComment(projectPath, iid, note)` | `deleteNote` | `DELETE` on the matching comment |
| `submitReview(projectPath, iid, review)` | the draft-note flow, moved from `review-submit.ts` | one `POST pulls/{n}/reviews`, then replies |

- **Anchor:** `{path, line, oldPath?, oldLine?}`. On GitHub a comment with
  only an old line goes on side `LEFT` at that line; otherwise `RIGHT`.
- **Note reference:** `{id, kind?: "general" | "diff"}`. GitHub keeps
  PR-level and diff comments in two id spaces. When `kind` is absent,
  GitHub tries the diff comment first and the PR-level comment on a 404.
- **Results** are forge-neutral: `{noteId, discussionId | null,
  resolvable, url}`, with `url` built by the provider.
- **Replying to a PR-level comment on GitHub** refuses: those have no
  thread. The message says to post a new comment.
- **`submitReview`** takes `{outcome: "comment" | "approve" |
  "request_changes", summary, comments[], replies[]}`.
  - GitHub: the summary, verdict and inline comments land as one review
    in one request, so there is nothing to roll back. Replies and
    resolves follow one by one, and each failure is reported per reply.
  - GitHub allows one pending review per user per PR. If the caller
    already has one, the method refuses with the same `pending-drafts`
    result GitLab gives, since submitting would publish it too.
  - A comment GitHub rejects for its position fails the whole review
    before anything posts; the result is `bad-anchors`.
  - GitLab keeps its exact step order, rollback and results.
- **Thread reads (GLANCE-47):** `fetchMRDiscussions` on GitHub also
  returns each review's summary text as a non-resolvable discussion
  (`gh-review-<id>`), and reports the right side, old line and old path
  for comments on removed lines and renamed files. Bot authors are marked
  on the note. The dead private `graphql()` is removed.
- `capabilities` gains `canReplyToGeneralComments` (false on GitHub) and
  `canRequestChanges` (true on both).

### 7. Daemon thread verbs on GitHub (RT-541)

The handlers in `lib/daemon/handlers/discussions.ts` stop building
`NoteMutator` and stop reading `gitlabToken`. Each calls the provider
method above through the router.

| Verb | On GitHub |
|---|---|
| `discussions:read`, `discussions:refresh` | `fetchMRDiscussions` with the context's `repositoryId` |
| `discussions:resolve` | works today in glance; PR-level comments refuse |
| `discussions:diffs` | a glance read of the PR's changed files, returning the same `MrDiffRow` shape |
| `discussions:reply` | `replyToDiscussion` |
| `mr:comment` | `createComment`; the reply says `resolvable: false` |
| `mr:comment-inline` | the same `checkAnchor` step, then `createInlineComment`; GitLab's degrade-and-retry stays GitLab-only |
| `mr:note-update` | `updateComment`; `kind` comes from the thread store when the note is known |
| `mr:review-submit` | `submitReview`; `review-submit.ts` keeps payload parsing and anchoring |

- Reply shapes do not change. `noteId` stays a number on both forges.
- `mr:review-submit` keeps its two outcomes (`comment`, `approve`).
  Exposing `request_changes` to agents is a tool change for SKILLS-105.
- **New-comment notifications:** the poller's own-note filter compares
  author ids of the form `<forge>:user:<n>`, using the signed-in user for
  that repo's forge. The GitHub user id is read once per token and
  cached. The bot filter uses the note's bot mark on GitHub and keeps the
  username pattern on GitLab.
- The poller already sweeps only repos granted the "discussions" cache,
  so GitHub request volume follows the same rule as GitLab's. A thread
  read on GitHub costs two paged REST lists and one GraphQL call per PR;
  the plan measures it before the poller is turned on for GitHub.

### 8. Evidence on GitHub (RT-547)

- **`evidence_attach`** on a GitHub PR writes the evidence section into
  the PR description and uploads the images in one step. A new daemon
  verb, `mr:describe-with-attachments` `{repoName, iid, description,
  attachments[]}`, GitHub only:
  1. Each attachment passes the same checks as a GitLab upload today:
     `checkUploadPath`, the redaction refusal, the evidence-record
     refusal and the ticket-copy refusal. GitHub caps an image at
     10 MB (a video at 100 MB), so an image over 10 MB is refused
     before gh runs.
  2. The daemon writes the description to a temp file in which each new
     image is a relative reference, then runs
     `gh pr edit <n> --repo <o/r> --body-file <file> --attach <path>...`.
     gh uploads the files and rewrites the references.
  3. It reads the PR body back and returns the hosted URL for each
     attachment, so `evidence_attach` can record them in the run's
     `evidence-uploads` field and reuse them next time. A reused image is
     written as its URL and is not attached again.
- **Running gh:** the app's bundled gh when present, else the one found
  on `ghSearchPath()`. The environment is `PATH`, `HOME`, `GH_TOKEN` (from
  `resolveGithubToken`) and `GH_PROMPT_DISABLED`; the token is never an
  argument. A gh older than 2.99, or none, refuses with the command to
  update it. If gh rejects the token for upload, the verb says so and the
  description is still written with the images named as local files.
- **Partial failures (settled in Plan C from gh 2.103.3's source):** gh
  checks every file, then uploads them in order and stops at the first
  failure. It writes the PR body only when at least one upload landed,
  with only those references rewritten, and still exits nonzero. Uploads
  that land before a failed PR write are orphaned: the read-back finds no
  URL for them, and the next attach uploads them again.
- **`mr_upload`** has no PR to attach to, and gh uploads only as part of
  a PR or comment write, so on GitHub it refuses in every argument form
  and names `evidence_attach`. This is the ticket's own acceptance.
- **Visibility:** an attachment is readable by whoever can read the repo,
  as a GitLab upload is. On a public repo that is everyone.
- RT-547 says any hosting "must bring back the evidence boards gate".
  Ruled in Plan C: on GitHub the skill's evidence-boards gate runs as on
  GitLab, and the daemon's evidence refusals in step 1 apply to every
  attachment.

## Delivery

Four PRs, in order:

1. `glance: forge-neutral labels, pipeline list and PR summaries`
   (0.29.0), with the `ReadBackFailedError` change.
2. `daemon: pick the forge per repo` (RT-540), with the merge move.
3. `glance: comment and review writes, thread fidelity` (0.30.0,
   GLANCE-48, GLANCE-47), then `daemon: threads and reviews on GitHub`
   (RT-541) in the same PR or the next, as the plan sizes it.
4. `daemon: evidence on GitHub PRs` (RT-547).

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

- Writes: each new glance write has a stubbed test on both forges, a
  no-retry test on GitHub, and a GitLab test pinning today's request
  sequence. `submitReview` on GitLab keeps `review-submit.ts`'s existing
  tests, moved with the code.
- Threads: daemon tests per verb in section 7 with a GitHub-shaped
  provider; a notification test with a GitHub author, a bot and the
  user's own note.
- Evidence: the daemon verb is tested with a fake gh on a temp `PATH`
  (argv, env without the token in argv, version refusal, read-back). One
  live attach against glance-conformance in the live run.

## Left to the builder

- Exact method names and option shapes, kept consistent with
  `GitProvider.ts`.
- Whether `fetchPullRequestSummaries` on GitHub uses `pullRequests` or
  `search` per filter combination, decided by measured request counts.
- How the GitLab-only accessor is typed.
- The wording of each refusal, following `rt:ui-copy`.
