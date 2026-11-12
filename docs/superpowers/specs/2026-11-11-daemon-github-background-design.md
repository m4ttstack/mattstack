# Daemon background jobs on GitHub (RT-542, RT-543, RT-544, RT-545)

Status: draft for review, 2026-11-11. Project: GitHub parity (P-RT-28).

## Why

The daemon now reads and writes GitHub PRs on request through the forge
router (`getRepoContext` in `lib/daemon/freshness.ts`, RT-540). Its
background jobs still assume GitLab:

- Project sync skips GitHub repos (`skipsGitHub` in
  `lib/daemon/project-sync.ts`), so boards on a GitHub repo show no PRs.
- The notifier knows one user id, the GitLab one (`ensureUserId` in
  `freshness.ts`). On a GitHub-only Mac it is null, so every alert about
  your own PRs is suppressed. On a Mac with both forges, a GitHub PR's
  author is compared against the GitLab id.
- `rt daemon track <repo> live` refuses a GitHub remote
  (`commands/daemon.ts`), and the watcher only starts for GitLab, so a
  GitHub PR can be 5 minutes stale and a GitHub-only Mac reports
  "disconnected".
- `parseMrRef` (`lib/runs/outcome.ts`) only matches `/merge_requests/N`, so
  a run that opened a GitHub PR shows no state or CI in console.

## Audit, checked against main on 2026-11-11

The four tickets come from a 2026-11-09 audit. On main:

- Holds: the four bullets above.
- Already fixed: `mr:by-branch` on GitHub returns an error when a lookup
  fails, never "no PR" (`GitHubReadFailure` in `handlers/project-mrs.ts`).
  A GitHub repo no longer fails project sync every cycle: it skips and
  records success, so branch cache GC already runs for it.
- Already fixed: "conflicts" and "needs rebase" alerts read glance's
  neutral `blockerReasons` on both forges, and "ready to merge" reads
  `readiness`. Merge error has no GitHub source: glance's `mergeError` is
  always null there.
- New finding: GitHub's `fetchSingleMR` returns null when its fill fails,
  and `fetchPullRequestByBranch` returns null on any HTTP error. The live
  path writes a null as "this branch has no PR". On GitHub those reads must
  report failure, not null.

## Goals

- A GitHub repo granted `project-mrs` fills the project store on the same
  5-minute cycle and daily deep read as GitLab, and reports healthy.
- Your own GitHub PRs trigger merged, closed, CI failed, CI passed,
  approved, conflicts, needs rebase and ready alerts. A Mac with both forges
  gets alerts for both.
- `rt daemon track <repo> live` works on a GitHub repo, and a PR change
  arrives within about a minute.
- A run whose PR link is a GitHub `/pull/N` URL, or a bare `#N`, shows its
  state and CI result in console.

## Non-goals

- Codeowner sections on GitHub boards, and behind-commit counts on GitHub.
  glance has no GitHub approval-rules read and no behind count. On GitHub,
  demanded sections stay uncovered and `divergedCommitsCount` stays null.
  The board-forge lane is making the board tolerate both.
- Merge error alerts on GitHub (no source in glance).
- Any glance change. The three missing glance reads (approval rules from
  CODEOWNERS, a behind count, a merged-PR index) are listed in the report
  as follow-ups; no tickets are filed here.
- GitHub Enterprise (RT-550). Identity and providers stay keyed so a host
  can be added later.
- RT-464's gates-table half (skip the gates query when a decision row
  already gives `posted`).

## Anti-goals

- GitLab behaviour does not change: same requests, same cadence, same
  store writes, same notifications, same replies. The GitLab arms of every
  changed function keep their current code path. Existing GitLab tests stay
  untouched and green.
- No GitHub read that can fail may be stored as "no PR" or prune a stored
  PR.
- No new poll or interval beyond the ones decided below.

## Approaches

**A. Daemon only, on glance's existing GitHub reads (picked).** Every read
the four jobs need exists in glance except approval rules, a behind count
and a merged-PR index. The index is replaced by `fetchPullRequests` with
`state: ["merged", "closed"]` and `updatedAfter`, which on GitHub is the
update-sorted `/pulls?state=closed` listing that stops at the cutoff.
Sections and behind counts stay off on GitHub.

**B. Add the missing glance reads first.** Full board parity, but it waits
on a glance release from another lane and widens this job.

**C. Leave project sync for later.** Smallest change; GitHub boards keep
showing nothing.

The shepherd picked A on 2026-11-11.

## Decided

1. Approach A (shepherd, 2026-11-11). List the three missing glance reads
   in the report as follow-ups; file no tickets.
2. GitHub repos with the `project-mrs` grant sync on the existing 5-minute
   cycle and daily deep, with the same pipeline top-up cap of 15 (Matt,
   2026-11-11). Stated cost per granted repo per hour: 24 REST list pages,
   0 to 24 GraphQL fills, 0 to 60 top-up reads typical (180 cap); typical
   total 30 to 100. The behind-count re-measure does not run on GitHub.
3. Repos tracked live on GitHub start glance's events watcher at its
   60-second default, with a targeted refresh per event (Matt, 2026-11-11).
   Stated cost: 60 requests an hour per live repo, mostly 304s, up to 3
   pages on a busy minute, plus the per-event reads.
4. A failed run-outcome lookup doubles its wait (10, 20, 40 minutes and so
   on), capped at 6 hours, reset by a success. Open PRs keep the 10-minute
   refresh (shepherd, 2026-11-11).
5. The write fence widens to `lib/daemon/handlers/mr.ts` for one change
   only: remove the GitHub write-back skip (shepherd, 2026-11-11).
6. Standing rulings: Octokit and gitbeaker only; GitLab behaviour does not
   change; one forge per team; GitHub Enterprise is later.

## Design

### 1. Project sync on GitHub (RT-542)

`syncProjectMRs` stops skipping GitHub. The skip notice and its test go.

**Reads per forge.** `defaultReads` today resolves a GitLab context. It
splits into two read sets behind the same shape:

- GitLab: today's code, unchanged (`getGitLabContext`, `fetchDeltaFrom`,
  approval rules, codeowner sections, `gitlabBranchSearch` for excluded
  targets).
- GitHub (a new `lib/daemon/project-sync-github.ts`): `fetchProject`,
  `fetchAuthors`, `fetchDeltaFor` and `fetchSingle`, with no `fetchRules`
  and no `fetchKnownSections`.

`syncImpl`, `backfillAuthors` and `backfillSections` pick the read set from
the repo's forge (`getRepoContext`). Test overrides keep working: an
override wins over either set, as today.

**GitHub reads.**

- Deep, unscoped: `fetchPullRequests({projectPath, state: "opened",
  listWeight: true})`. Cost: one REST page per 100 open PRs plus one
  GraphQL fill per 25.
- Deep, scoped to authors, and `backfillAuthors`: the same listing,
  filtered to the scope's authors in the daemon. glance's author mode runs
  one search per author, all at once, and GitHub allows 30 searches a
  minute, so a 40-author board would trip the search limit and fail the
  deep. The listing costs the same as the unscoped deep. (My call.)
- Delta: two listings with `updatedAfter`, `listWeight: true`: open PRs,
  then merged and closed PRs. Each normally stops after one REST page; a
  fill runs only for PRs that changed. A terminal PR enters the store under
  the same rule `fetchDeltaFrom` applies to GitLab index rows: it updates a
  stored PR, or it is kept when it would become its branch's
  `findBySourceBranch` answer and is in scope; otherwise it is dropped. The
  GitHub delta already holds the full PR, so the branch-reuse case needs no
  extra read.
- `fetchSingle`: `fetchSingleMR` with an `onWarning` hook; a fill failure
  throws, so the top-up and hydration paths log and skip it as they do
  for any failed read.

**A short read never prunes.** Each GitHub read passes `onWarning`. A
warning whose `source` is not `contexts` (a list or search page cap, a
failed list page, a failed fill batch) means PRs are missing from the
result, so the read throws and the sync fails. A deep that fails that way
falls back to delta exactly as a failed GitLab deep does; a delta that fails
does not advance freshness, so the next cycle retries the same window. A
`contexts` warning keeps the PR with checks pending, and is only logged.
`RateLimitedError` propagates as a sync failure.

**Ignored target branches.** On GitLab, `rt.ignoredMrs` globs expand to
exact branch names through a branch search, so the server never reads
those MRs. GitHub filters target branches in the client anyway, so on
GitHub the daemon drops PRs whose `targetBranch` matches a glob
(`isIgnoredMr` in `ignored-mrs.ts`) right after each read. No branch search
runs. (My call.)

**Codeowner sections.** With no `fetchRules` in the GitHub read set:

- A scoped deep skips the section sweep and stores no `scope.sections`, so
  `project-mrs:read` reports demanded sections as `uncoveredSections`.
- `backfillSections` returns without a request, logging once per repo per
  daemon start at info.
- The delta's section re-sweep never runs, since `scope.sections` is never
  set.
- The events path's approval-heal reads approval rules only on GitLab.

**Behind counts.** `remeasureDivergedCounts` returns at once for a GitHub
repo, before any read.

**Self in scope.** A scoped deep adds the repo's own user to the authors.
On GitHub that is the token user's login, read through the same cached
`/user` call the notifier uses (section 2). `backfillAuthors` reads the
cached value only, as it does on GitLab.

**Store writes on GitHub.** `mr:by-branch` upserts a found GitHub PR into
the store under the same scope rule as GitLab, on both its batched and
per-branch paths. In `handlers/mr.ts` the GitHub write-back skip goes, so
an rt merge, approve or edit on GitHub updates the store as on GitLab.

**Health.** GitHub syncs record success and failure through
`project-sync-health.ts` like GitLab, so `project-mrs:read` carries
`syncError` when a GitHub sync fails, and the repo counts in
`failedRepos`, holding back its branch cache GC for that cycle as on
GitLab.

### 2. Identity per forge and notifications (RT-543)

**Who you are.** `freshness.ts` keeps today's GitLab user id resolution
untouched and adds the GitHub one. The token user's GitHub id and login
come from `validateToken` on the repo's GitHub provider, cached per
provider (so per token), as `getSelfUserId` already does. A failed read is
not cached.

`resolveUserIdAcrossTracking` also resolves the GitHub identity: for the
first tracked GitHub repo with the `branches` or `project-mrs` grant, it
builds the context and reads the GitHub user once. Cost: one `/user` call
per GitHub token per daemon process.

`getSelfIds()` returns `{ gitlab: number | null; github: number | null }`.

**Missing identity warning.** Today one warning says "userId is
unresolved; ... (no gitlabToken, or token validation failed)". It becomes
one warning per forge that has tracked repos but no resolved user, naming
that forge and its fix: "rt could not tell which GitHub user you are, so
alerts about your own GitHub PRs are off" with the `rt setup github
connect` command, and the GitLab one with `rt setup gitlab connect`. Each
fires once per daemon process. Wording follows `rt:ui-copy`.

**The notifier.** `checkAndNotify`'s third argument widens from
`number | null` to `number | null | SelfIds`. A bare number still means the
GitLab id, so every existing caller and test keeps its meaning. Both
daemon callers (`cache-refresh.ts`, the live path in `freshness.ts`) pass
`getSelfIds()`.

For each branch entry, the forge comes from the PR author's id prefix
(`github:user:N` or `gitlab:user:N`); an id with neither prefix is treated
as GitLab, as today. `isSelfAuthored` and the self-approval check compare
against that forge's id. A GitLab entry therefore sees exactly today's
number, and a GitHub PR is never compared with a GitLab id. The persisted
`BranchSnapshot` keeps its shape: approver ids stay numbers, and all
approvers of one PR share its forge.

The alerts themselves need no other change. Merged, closed, CI, approved,
conflicts, needs rebase and ready read fields glance fills on GitHub.

**Viewer-scoped reads.** The live path passes the GitLab user id to
`fetchSingleMR` only on GitLab; GitHub ignores the argument and gets null.

### 3. Live refresh on GitHub (RT-544)

**Tracking.** `rt daemon track <repo> live` accepts a GitHub remote
(`isGitHubRemote`) as well as a GitLab one. Any other remote is refused as
today, with the reason "live watching needs a GitLab or GitHub remote".
The interactive picker's hint drops "GitLab only" and says the watcher
checks about every 15 seconds on GitLab and every minute on GitHub.

**Starting the watcher.** `reconcileFreshness` handles a live GitHub repo
by building its context through the router, then calling the GitHub
provider's `watchEvents` with no interval, so glance's 60-second default
and `X-Poll-Interval` apply. No GitHub token: no watcher, one info line per
repo per process, as GitLab does. `RepoWatch.provider` widens to either
provider, and the watch records its forge.

**Token rotation.** At each reconcile, a GitHub watch whose provider is no
longer the router's provider for that repo (the token changed) is stopped
and started again, as GitLab's token check does today.

**Cursor.** glance's GitHub cursor carries string event ids and its own
`seenIds`; it is stored and resumed through the existing cursor store
unchanged. A cursor from another forge makes glance cold-start. The status
snapshot's `lastEventId` reports a GitHub id as a number when it parses
as one, so the snapshot keeps its type.

**Event mapping on GitHub.** The same `processKeys` runs, with these
differences:

- `mr` events: `fetchSingleMR` with an `onWarning` hook. A failed fill is
  logged and skipped, never written as null. The approval-heal runs only
  on GitLab.
- `branch` events for one of your branches: one
  `fetchPullRequestsByBranches(projectPath, [ref], "all")`, which throws on
  failure, in place of `fetchPullRequestByBranch`, which returns null on an
  HTTP error. A teammate's push resolves through the project store and
  `fetchSingleMR` as on GitLab, with the same failure rule.
- `notes` events: unchanged; `refreshDiscussions` already works on GitHub.
- The gap-fill: unchanged; it already uses `fetchPullRequestsByBranches`.
- After a batch that changed an entry, `checkAndNotify` gets
  `getSelfIds()`.

**Connection state.** GitHub watches count in `getAggregatedConnection`, so
a GitHub-only Mac with a live repo reports connected.

**What the feed misses.** CI status changes and metadata-only edits emit no
event on GitHub either. The 5-minute cycle and the pipeline top-up stay
the safety net, as on GitLab. The discussions poller's doc comment is
updated: a live GitHub repo now gets `notes` events too.

### 4. Run outcomes read GitHub PR links (RT-545)

**Parsing.** `parseMrRef` accepts:

- a GitLab `/merge_requests/N` URL (as today);
- a GitHub `/pull/N` URL, on any host;
- a bare `N`, `!N` (as today) or `#N`.

The returned `url` is the link as given, null for a bare reference.
`buildOutcome` and the refresher both read through it, so a GitHub run's
outcome is built and refreshed through `mr:get`, which already works on
GitHub.

**Backoff.** In `run-outcome-refresher.ts` a failed lookup records its
failure count. A run is not asked again until `10 minutes * 2^(failures -
1)` has passed, capped at 6 hours. A success clears the count, and an open
PR then keeps the 10-minute refresh. Counts live in memory, so a daemon
restart asks again at once. Closed and merged PRs stay final, as today.
RT-553's GitHub cadence note in `lib/daemon.ts` still holds.

## Testing

All tests stub the provider or `fetch`; no live forge calls.

- Project sync: a GitHub-shaped stub provider drives deep (unscoped and
  scoped), delta (open, terminal stored, terminal reuse, terminal dropped),
  top-up and backfill. Tests show that a fill or page-cap warning fails the
  read and prunes nothing; that ignored targets are dropped; that sections
  stay uncovered with no rules read; and that the behind re-measure makes
  no read. A request-count test covers one delta cycle.
- Identity: GitHub self resolution is cached per token and retried after a
  failure; the per-forge warning names the right forge.
- Notifier: one test per alert kind with a GitHub author, a test that a
  GitHub PR is not matched against the GitLab id (same number, other
  forge), a both-forges test, and today's GitLab tests unchanged.
- Live: reconcile starts a GitHub watch for a live GitHub repo and none
  without a token; a token change restarts it; `branch` and `mr` events on
  GitHub never write null on a failed read; connection reports connected.
  `rt daemon track` accepts a GitHub remote and refuses another with the
  new reason.
- Outcomes: `parseMrRef` cases for each form; backoff doubles, caps at 6
  hours and resets on success.

## Left to the builder

- Names and file layout inside the fence, consistent with the code around
  them.
- How the GitHub read set reuses `fetchDeltaFrom`'s terminal-row rule
  (shared helper or a GitHub copy with the same tests).
- The exact wording of the new warnings and refusal, following
  `rt:ui-copy`.
