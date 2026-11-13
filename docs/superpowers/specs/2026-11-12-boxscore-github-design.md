# Boxscore on GitHub (BOXSCR-5)

Status: draft for review. Project P-RT-28 GitHub parity.

## Intent

A team whose forge is GitHub opens Boxscore and sees a populated
leaderboard, built from the same metrics a GitLab team gets. Today Boxscore
always builds a `GitLabProvider` (`apps/boxscore/src/server/source/provider.ts:79`),
refuses with a 400 when there is no GitLab token
(`server/leaderboard.ts:91-104`), and four of the reads it needs
(`fetchMergeRequestMetrics`, `fetchProjectPipelines`, `fetchUserEvents`,
`fetchProject`) do not exist on glance's `GitHubProvider`.

## Goals

- A GitHub team sees a populated leaderboard and per-person detail.
- The GitLab token is never sent to GitHub, and the GitHub token is never sent
  to GitLab or any other host.
- Every link (evidence rows, Linear credit) points at the team's forge.
- GitHub bot accounts (`name[bot]`) are excluded like GitLab service accounts.
- Linear issues whose attachments are GitHub PRs are credited.
- Copy names the team's forge: "PR" and "GitHub" on GitHub, "MR" and
  "GitLab" on GitLab.

## Non-goals

- No change to GitLab behaviour, requests, copy or stored data.
- No edit under `packages/glance` (two other lanes are changing it). Moving
  the GitHub metric reads into glance is a follow-up.
- No new daemon verb and no change to `secrets:read`.
- No fetch cadence change. Refresh stays manual (the topbar button).
- GitHub Enterprise Server is out of scope (see "Calls made").
- A team on both forges at once. One forge per team, picked from the team's
  forge (standing ruling).

## Anti-goals

- A GitHub team whose leaderboard renders but silently reads zeros because a
  read returned nothing. Every failed read surfaces as a response warning,
  as on GitLab.
- Any request carrying a token to a host the token was not issued for.

## Constraints and rulings

Standing rulings (do not reopen): GitLab behaviour does not change; one forge
per team, picked from the team's forge; forge-aware copy; every new request
cost goes to Matt stated per repo per refresh and per hour before it is
turned on; no fetch cadence change without asking.

Matt, 2026-11-12: Boxscore on GitHub is wanted; coding days use commit date
on GitHub; pipelines count GitHub Actions runs only.

Brainstorm answers (shepherd, 2026-11-12, through herd_ask):

1. **Token path.** Boxscore builds its own glance `GitHubProvider`. The token
   is `GITHUB_TOKEN` from the environment, else the existing grant-gated
   daemon verb `secrets:forge-token {repoName, forge: 'github'}`
   (`lib/daemon/handlers/secrets.ts:173`, rt-client `resolveForgeToken`), the
   same path gitq uses. No daemon change.
2. **Per-PR metrics.** Composed from existing glance reads, 6 to 8 requests
   per PR needing detail (GitLab: 1). See "Reads and cost".
3. **Coding days.** Commits on roster-authored PRs in the window, dated by the
   commit's author date, credited to the commit's GitHub author when that
   login is on the roster. A commit with no linked GitHub user is skipped.
4. **Pipelines.** GitHub Actions runs listed per (repo, roster user), the same
   shape and cost as GitLab today.

## Approaches considered

For the token:

- **Own provider, forge-token verb (picked).** Reuses the per-repo grant
  gate that exists. The token stays on the local daemon path.
- New `secrets:read` scope with `githubToken`. Widens a token-gated,
  grant-exempt verb, which is not a default.
- Daemon runs the GitHub reads. Token never reaches Boxscore, but it means
  several new daemon verbs.

For the per-PR metrics:

- **Compose existing glance reads (picked).** 6 to 8 requests per PR; glance
  keeps owning approvals and comments; no glance edit.
- One Boxscore-owned GraphQL query through `restRequest`. 1 request per PR,
  but GitHub query text would live in Boxscore until moved to glance.
- Wait for a glance `fetchMergeRequestMetrics` on GitHub. Leaves the
  GitHub leaderboard empty until the glance lanes free up.

## Design

### 1. Which forge

`readSettings()` (`server/config/index.ts`) already reads
`mattstack.integrations`. It gains `forge: 'gitlab' | 'github'`, from
`mattstack.integrations.forge.provider`: `'github'` gives GitHub, anything
else (absent included) gives GitLab, so every GitLab team reads exactly as
today.

On GitHub:

- `baseUrl` is `https://github.com` when the declared forge host is
  `github.com` (or empty), and `''` otherwise. An empty `baseUrl` on GitHub
  raises a `ConfigError` naming the declared host and saying Boxscore reads
  GitHub only on github.com.
- `mayOfferGitLabTokenToHost` and `rt.integrations.forgeHost` are not read.
  They govern the GitLab token only.

On GitLab nothing in `readSettings()` changes.

### 2. The token and the provider

`Env` gains `forge`. `resolveEnv()` (`server/leaderboard.ts`) branches:

- **GitLab:** unchanged (`readSecrets()`, `gitlabToken`, the same hints).
- **GitHub:** the token is `GITHUB_TOKEN` (trimmed), else
  `resolveForgeToken(repoName, 'github')` for each configured project in
  order until one returns a token. `repoName` is
  `serializeIdentity({ kind: 'remote', id: 'github.com/<owner>/<repo>' })`, the
  same identity board derives (`apps/board/src/config.ts:62-73`). When every
  project is refused, the `ConfigError` carries the first refusal's own text
  (it names `rt daemon track <repo> live branches`). `readSecrets()` is still
  called, for `linearApiKey` only; its `gitlabToken` is ignored on GitHub.
  The daemon call passes a `sockPath` resolved from HOME at call time, as
  `config/secrets.ts` does, and under vitest it is a seam, like
  `readSecrets`'s `deps`.

`forge` is optional on `Env` and on both response types; absent means
GitLab. Existing typed literals in tests (`test/refresh.test.ts`,
`test/progress.test.ts`, `src/app/App.test.tsx`, `test/builders.ts`) keep
compiling unchanged.

`makeProvider(env)` (`server/source/provider.ts`) builds
`new GitHubProvider(env.baseUrl, env.token)` when `env.forge === 'github'`,
else the `GitLabProvider` it builds today. The test seam is unchanged.

`getCurrentUser` (`server/config/current-user.ts`) gains a forge-aware path:
on GitHub it calls `GET https://api.github.com/user` with
`Authorization: Bearer <token>`, cached the same way, keyed on host and token.
The GitLab path is unchanged.

### 3. The GitHub source adapter

`runRefresh` calls source functions that today assume GitLab. A new module,
`server/source/github.ts`, implements the same `SourceProvider`-shaped calls
for GitHub, using only existing `GitHubProvider` methods. `runRefresh` picks
the adapter from `env.forge`. GitLab keeps the current code path untouched.

Per step:

| Step | GitLab today | GitHub |
|---|---|---|
| Identity | `GET /users?username=` | `provider.fetchUser(login)`; `userId` is the numeric part of `github:user:N` |
| PR index | `fetchMergeRequestIndex` | the same method (it exists on GitHub) |
| Per-PR metrics | `fetchMergeRequestMetrics` (1 GraphQL) | composed, see below |
| Pipelines | `fetchProjectPipelines` per (project, user) | Actions runs per (repo, user), see below |
| Project id | `fetchProject` per project | not run |
| Push events | `fetchUserEvents` per user | not run; commit events come from the per-PR read |

**Per-PR metrics** fill the same `StoredMetrics` shape
(`server/store/index.ts`) so the metric math is untouched:

- `fetchSingleMR(projectPath, iid, null)`: `description` from the body,
  `diffStats` from additions, deletions and changed files,
  `approvedByUsernames` from `approvedBy` (latest opinionated review per
  reviewer, state APPROVED).
- `fetchMRDiscussions('github:<owner>/<repo>', iid)`: every note becomes
  `{ authorUsername, createdAt, system: false, inline }`, where `inline` is
  true for a review (diff) comment and false for an issue comment or a
  review summary. GitHub has no system notes. An approval with an empty
  body is not a note, matching GitLab, where an approval is a system note
  the metrics skip.
- `restRequest('GET', '/repos/<o>/<r>/pulls/<n>/files?per_page=100&page=K')`,
  paged by the `Link` header: `fileStats` from each file's `filename`,
  `additions`, `deletions`.
- `labels` come from the index row already stored (the index read carries
  them).
- `restRequest('GET', '/repos/<o>/<r>/pulls/<n>/commits?per_page=100&page=K')`,
  paged. For each list item `c` in the response array: the GitHub user is
  `c.author?.login` (the top-level `author`, GitHub's linked account) and
  the author date is `c.commit.author.date` (the git commit's author
  block). An item whose `c.author?.login` matches a roster username
  (case-insensitive, stored with the roster's spelling) becomes a
  `StoredPushEvent { username, createdAt: c.commit.author.date,
  repositoryId: 'github:<owner>/<repo>' }`. An item with `c.author: null`
  is skipped. Test fixtures use this exact nesting, copied from GitHub's
  documented response. GitHub returns at most 250 commits per PR; a PR at
  that cap adds a warning.

`fetchSingleMR` returns `null` when its GraphQL fill fails and reports the
failure only through its optional `onWarning` callback. The adapter passes
`onWarning`, and a `null` result or a `fill` warning counts as that PR's
detail failure (thrown inside the per-PR try, so it lands in
`mr_detail_partial` with its message), never a silent skip.

The commit events are written with the metrics in the same batch flush. The
store's push-event key (username, timestamp, repository) makes a re-fetch
idempotent. A settled merged PR is not re-fetched, so its commits stay as
stored.

The metrics step's eligible set is unchanged (roster-authored in window, or a
revert by anyone).

GitHub logins are case-insensitive, and the metrics compare usernames
exactly. So the GitHub adapter rewrites every login it stores (PR author,
note authors, approvers, commit authors, run actors) to the roster's
spelling when it matches a roster or org-roster username ignoring case,
and leaves any other login as GitHub returned it.
Reads apply the same mapping against the current roster, so a login stored
before its owner joined the roster, or under another case, still matches:
the board query and the metrics step's eligibility check both compare
through it. GitLab compares stored usernames exactly.

**Pipelines:** per (repo, roster user),
`restRequest('GET', '/repos/<o>/<r>/actions/runs?actor=<login>&created=<start>..<end>&per_page=100&page=K')`,
paged. Each run becomes `StoredPipeline { id: 'github:run:<id>', projectPath,
username: <login>, status, createdAt: run.created_at }`. Status: conclusion
`success` gives `success`, `failure` gives `failed`, `cancelled` gives
`canceled`, any other conclusion (`timed_out`, `startup_failure`, `skipped`,
`neutral`, `action_required`) passes through lowercased and counts as
"other", as the approved answer says, and a run with no conclusion yet
takes its `status` lowercased. `created=` bounds are sent as
`YYYY-MM-DDTHH:MM:SSZ` (no milliseconds). GitHub stops a filtered run list
at 1000 results; a (repo, user) pair whose `total_count` exceeds 1000 adds a
`pipeline_fetch_failed`-coded warning saying the count is capped.

A `restRequest` response that is not ok raises an error naming the path and
status, caught by the step's existing per-item warning handling.

Cancel works between requests on GitHub, not mid-request: glance's GitHub
`restRequest`, `fetchSingleMR` and `fetchMRDiscussions` take no signal. The
adapter checks the signal before each call, as `runRefresh` already does
per item.

### 4. Reads and cost (approved)

Refresh is manual, so per hour is per refresh times the clicks in that hour.
GitHub allows 5000 REST requests and 5000 GraphQL points per hour per token.

Per repo per refresh:

- PR index: 1 request per 100 PRs updated since the last scan (usually 1).
- Per-PR metrics: 6 to 8 requests per PR needing detail (1 GraphQL, 3 REST
  discussions, 1 files page and 1 GraphQL thread index only when inline
  comments exist, 1 files page, 1 commits page; more pages past 100 of any
  list).
- Not counted above: glance's PR read adds 1 rulesets request per repo and
  base branch of an open PR awaiting review, and 1 per further 100 status
  contexts on a PR's head commit.
- Actions runs: 1 request per roster user (plus 1 per further 100 runs).

Per refresh, not per repo: identities, 1 request per roster user per day.

Not run on GitHub: the per-project id read and the per-user events read.

The first refresh of a window reads detail for every roster PR in it. A warm
refresh reads detail only for PRs whose `updatedAt` moved past their stored
snapshot, whatever their state (open, closed or merged): GitHub bumps
`updatedAt` on new commits, comments, reviews and labels, which is everything
the metrics read. With nothing changed, a repo costs 1 index request plus 1
Actions runs request per roster user per refresh; each changed PR adds its 6
to 8. Per hour is that times the refreshes in the hour. GitLab keeps its
merged-only rule: a non-merged MR is re-read every refresh. The choice is the
`ForgeSource.reusesFreshSnapshots` capability (`'any'` on GitHub, `'merged'`
on GitLab), so the metric math stays forge-blind.

PR detail runs 2 PRs at a time on GitHub (`ForgeSource.detailConcurrency`,
`GITHUB_DETAIL_CONCURRENCY`), about 300 to 600 REST requests a minute, to
stay under GitHub's secondary rate limit. GitLab stays at 6. The total
requests are the same; a first refresh of a large window is slower.

### 5. Links

The leaderboard and detail responses (`shared/types.ts`) gain
`forge: 'gitlab' | 'github'` beside `baseUrl`. A shared helper
(`shared/forge.ts`) builds a change-request URL:
`<baseUrl>/<path>/-/merge_requests/<iid>` on GitLab,
`<baseUrl>/<path>/pull/<iid>` on GitHub. `server/metrics/evidence.ts:52`
uses it; so does any other server-built `href` to a change request. The
fixture responses carry `forge` too.

### 6. Linear credit

`server/linear/fetch.ts`:

- `parseMrUrl` becomes forge-aware: on GitHub it parses
  `https://github.com/<owner>/<repo>/pull/<n>` (with an optional trailing
  path, query or hash) to `{ projectPath: '<owner>/<repo>', iid: n }`.
- On GitLab the attachment filter stays `sourceType === 'gitlab'`. On GitHub
  it takes every attachment whose URL parses as a github.com PR, whatever
  its `sourceType`: Linear's value for GitHub PR attachments is unverified
  here (no live sample), and the URL shape is the evidence that matters.
- The parsed `<owner>/<repo>` is matched to a configured project
  case-insensitively and replaced by the configured spelling, so `mrKey`
  lookups hit.
- A PR in a project outside `boxscore.projects` is never looked up, since
  `mr_index` can keep rows from a removed project. It still counts as an
  attachment, so the issue gets no text-link fallback.
- The rest of the grading is unchanged.

`resolveLinearTickets` gets the forge through its existing arguments or
`env`. GitLab keeps its current regex and filter.

### 7. Bots

`shared/bots.ts` gains a built-in pattern `\[bot\]$`, label `*[bot]`, which
matches GitHub App accounts (`dependabot[bot]`, `github-actions[bot]`). A
GitLab username cannot contain brackets, so GitLab results do not change.
The GitHub ghost account is `ghost`, already covered.

### 8. Forge-aware copy

Every user-facing string that names the forge or its change request reads
from the response's `forge`:

- `shared/metrics.ts` labels and descriptions ("MRs merged" or "PRs merged").
- `app/detail/panelCopy.ts` source lines ("Source: GitHub PRs you authored").
- Coding days on GitHub: "commits" in place of "pushes" (panel source and the
  evidence summary, `server/metrics/evidence.ts:270-281`).
- Pipelines on GitHub: "Actions runs" where the copy names the source.
- Server-built evidence summaries and table headings in `evidence.ts`.
- `app/lib/progress.ts`, `app/access/LockedPage.tsx` and its server copy in
  `server/viewer-scope.ts`, `app/refresh/RefreshStatus.tsx`,
  `app/leaderboard/StandingsTable.tsx`, the `app/detail/evidence/*`
  components, the setup hints in `leaderboard.ts`, and the progress labels
  and warning texts in `refresh/run.ts` ("Fetching MR details", "MRs for
  ...").

Call sites keep the GitLab wording as written and pass it through
`forgeText(text, forge)` (`shared/forge.ts`; the app's `useForgeText` hook
wraps it). On GitHub, `forgeText` returns the whole-string rewrite from the
`GITHUB_COPY` table when one exists, and otherwise applies a short word
rewrite (MR to PR, merge request to pull request, GitLab to GitHub, a day with
a push to a day with a commit). Absent or `gitlab` returns the text
unchanged, so the GitLab wording stays byte for byte what it is today. A
drift guard test fails when a `GITHUB_COPY` key no longer appears as a string
in the app source. Copy follows the `rt:ui-copy` skill.

### 9. Fixture and UI validation

`BOXSCORE_FIXTURE_FORGE=github` (with `BOXSCORE_FIXTURE=design`) makes the
fixture responses carry `forge: 'github'`, `baseUrl: 'https://github.com'`,
GitHub links and GitHub copy. Boxscore's UI shows no bot list (bots surface only through the CLI's suspected-bot scan), so bot exclusion is proven by tests, not the fixture. The UI change is rendered
in Fast Browser against that fixture in both colour schemes, and against the
GitLab fixture to confirm it is unchanged.

### 10. Docs

`apps/boxscore/README.md` gains a GitHub section: setup (track one project
with rt, or set `GITHUB_TOKEN`), what each metric reads on GitHub, and the
limits (coding days are commit dates on PRs, 250 commits per PR, 1000 Actions
runs per person per repo per window, github.com only, and commits
force-pushed off an open PR stay counted because the store never deletes).

## Calls made (mine, for review)

- **github.com only.** The forge-token verb returns the `rt` `githubToken`,
  a github.com credential. Sending it to a declared GitHub Enterprise host
  would repeat BOXSCR-4's risk, so a non-github.com GitHub host gets a
  setup hint, not a request.
- **First granting project.** The token is asked for each configured project
  in order until one grants; the first refusal's text is the hint when none
  does.
- **Current user on GitHub** reads `GET /user` once per host and token, like
  GitLab's `/api/v4/user`.
- **No schema bump.** GitHub ids fit the existing columns; the host guard
  (PR #1116) clears a store whose host changes, which covers a team that
  moves from GitLab to GitHub.
- **Commit events are written in the metrics step**, not a separate step, so
  no new progress phase appears; the "Fetching push events" phase is skipped
  on GitHub.
- **`approvalsAvailable` stays true** on GitHub: approvals come from
  `fetchSingleMR`.

## Left to the builder

- Exact module boundaries inside `server/source/` and how `runRefresh` picks
  the adapter, as long as the GitLab path's requests do not change.
- The copy helper's name and shape.
- Fixture data for the GitHub scenario.

## Acceptance

- A GitHub team (fixture-backed tests, no live calls) gets a populated
  leaderboard: merged PRs, reviews, review depth, wait and response times,
  pipelines, coding days, streaks, size health and reverts all non-zero for
  a member with activity.
- A GitHub refresh sends no request to a GitLab host, and the GitLab token
  never appears in a GitHub request (test with a recording fake).
- On GitLab, the requests a refresh makes and the response's copy are
  unchanged (existing tests stay green unmodified, which `forge` being
  optional allows, plus a test pinning that a GitLab team's response
  carries `forge: 'gitlab'`).
- Evidence links point at `github.com/<owner>/<repo>/pull/<n>` on GitHub.
- `dependabot[bot]` is excluded from review metrics and shows as a bot.
- A Linear issue with a GitHub PR attachment is credited to the PR's author.
- Copy says PR and GitHub on GitHub, MR and GitLab on GitLab, checked in
  Fast Browser in both colour schemes.

## Source

BOXSCR-5; brief `ag-6d3783de`; PRs #1099 (BOXSCR-4) and #1116 (BOXSCR-6).
