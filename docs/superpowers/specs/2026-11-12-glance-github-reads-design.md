# GitHub codeowner rules, behind count and merged-PR index (GLANCE-54)

## Why

The daemon's project sync runs on GitHub since PR #1102, but it runs on
glance's existing reads, and three are missing. A GitHub board therefore has
no codeowner tabs (BOARD-66 depends on this), no behind-base count, and finds
merged PRs through an update-sorted closed-PR listing whose PRs all go
through the heavy GraphQL fill. GitLab already has each read. This work adds
the three reads to `GitHubProvider` with GitLab's shapes, behind capability
flags, and turns them on in the daemon's GitHub sync.

Matt is cost-sensitive about GitHub request volume, and the 5-minute sync
cycle is deliberate. Every read below states what it costs per repo per hour
at 20 and at 100 open PRs, and the PR body states the total.

## Goals

- `GitHubProvider.fetchMergeRequestIndex`: the merged/closed index GitLab
  has, so the delta stops filling terminal PRs it only needs scalars for.
- `GitHubProvider.fetchApprovalRules` and `fetchCodeownerSections`:
  codeowner rules per PR and the repo's owner list, from GitHub's own
  codeowner evaluation.
- `GitHubProvider.fetchDivergedCounts` (batched) and `fetchDivergedCount`
  (single, GitLab's shape): how many commits a PR is behind its base.
- The daemon's GitHub sync uses all three: the delta's index, the section
  sweeps (deep, delta, backfill) and the behind-count re-measure.

## Non-goals

- The board's GitHub tab decision and the ask picker (BOARD-66). This work
  supplies the data; owner names become available as sections.
- The events path's approval heal in `lib/daemon/freshness.ts` (outside the
  fence). It already skips GitHub; GitHub section tags heal on the 5-minute
  sections delta instead (a GitHub review bumps the PR's `updatedAt`).
- GitHub Enterprise, group (org-wide) indexes, and any GitLab change.

## Anti-goals

- A short or partial answer that reads as complete: an unreadable PR's rules
  are reported as unknown, never as "no rules".
- Any new field in the main batched fill. A field that errors there drops
  the PR from the board.
- Changing what `needsRebase` means (the board-auto-doctor lane reads it).
- Changing GitLab behaviour, or any member gitq's fakes would have to add.

## Constraints

- Standing rulings: Octokit and gitbeaker only; GitLab behaviour does not
  change; one forge per team; GitHub Enterprise is later.
- Every interface change is additive: new `GitProvider` members and new
  `ProviderCapabilities` flags are optional (gitq's tests build full fakes).
- Write fence: `packages/glance/` on the GitHub side (not the GitLab client,
  `NoteMutator`, `retry.ts`, the live harness pacing or
  `harness_credentials.json`), plus exactly three added lines in
  `GitLabProvider.ts`'s capabilities literal (shepherd, 2026-11-12; PR #1110
  has that file open, so main comes in before the push if it merged);
  `lib/daemon/project-sync.ts`,
  `lib/daemon/project-sync-github.ts` and their tests; `lib/daemon/cache-refresh.ts`
  only for the behind-count GitHub skip (none is needed there: the skip
  lives in `project-sync.ts`); the root `bun.lock` glance version line.
- The live suite is never run here. Live conformance cases are written for
  the shepherd to run with Matt.
- glance's version is chosen right before the push, one past main's.

## Approaches (decided by Matt, 2026-11-12)

**Scope.** Glance plus the daemon wiring in one PR (picked over glance-only
with a follow-up), at the costs this spec states.

**Codeowner rules.** A: GitHub's own codeowner evaluation, in a dedicated
GraphQL read. Picked over B (parse CODEOWNERS and match each PR's changed
files in glance, with team membership reads), which costs one or more REST
file reads per PR plus one per team, needs `read:org`, and makes every glob
rule ours to get right.

**Behind count.** A: a dedicated batched GraphQL compare, 25 PRs per
request, plus a single-PR form. Picked over B (ride the existing fill: free,
but counts go stale on unchanged PRs and a compare failure drops PRs) and C
(REST compare per PR: 120 requests an hour at GitLab's re-measure cap).

**Codeowner tags on GitHub are sticky** (shepherd, 2026-11-12). The
daemon keeps a GitHub PR's codeowner tag until merge or close, matching the
rule GitLab boards follow (`sectionsMatching`: approval does not drop the
match). Picked over tags following GitHub's live state, which would drop a
PR from an owner's tab the moment that owner reviews. A tag from a request
someone removed by hand also stays until the PR closes; the PR body says so.

**Merged-PR index.** One sensible shape: the REST closed listing the delta
already pays for, mapped straight to `MergeRequestIndexRow` with no fill.

## Design: glance

### Types and flags (`types.ts`, `GitProvider.ts`)

New optional `ProviderCapabilities` flags:

- `canFetchApprovalRules?`: `fetchApprovalRules` is available.
- `canFetchCodeownerSections?`: `fetchCodeownerSections` is available.
- `canFetchDivergedCount?`: `fetchDivergedCount` is available, and on
  GitHub also `fetchDivergedCounts`.

GitLab sets all three true (it already has these methods; nothing about its
behaviour changes). GitHub sets all three true and flips
`canFetchMergeRequestIndex` from false to true. Nothing in the monorepo
branches on `canFetchMergeRequestIndex` today (boxscore calls its own
provider type).

New optional `GitProvider` members, typed exactly as GitLab's existing
methods so `GitLabProvider` satisfies them unchanged:

- `fetchApprovalRules?(options: FetchApprovalRulesOptions): Promise<MRApprovalRules[]>`
- `fetchCodeownerSections?(options: { projectPath: string }): Promise<string[] | null>`
- `fetchDivergedCount?(projectPath: string, mrIid: number): Promise<number | null>`
- `fetchDivergedCounts?(projectPath: string, mrIids: number[]): Promise<Map<number, number | null>>`
  (GitHub only; GitLab leaves it absent)

`providerConformance.ts` picks the new members up automatically.
`tests/live/expectations.ts` is an exhaustive record over every
`GitProvider` method, so it gains entries for all four on both providers
(GitLab's `fetchDivergedCounts` is `support: 'absent'`), and
`tests/metrics-reads-capabilities.test.ts`, which asserts GitHub's
`fetchMergeRequestIndex` is undefined, flips.

`MRApprovalRules` gains `unknownReason?: string`. When set, `rules` is
empty and means "not read", never "no rules"; the string says why in one
sentence. GitLab never sets it.

Doc updates: `PullRequest.divergedCommitsCount` no longer says GitHub
"would need a compare per PR"; it says GitHub's PRs leave it null from every
fetch and `fetchDivergedCounts` reads it. The `FetchApprovalRulesOptions`
docs gain GitHub's page size default and the draft rule.

### `fetchMergeRequestIndex` on GitHub

- `groupPath` throws (`fetchMergeRequestIndex: groupPath is GitLab-only; pass projectPaths on GitHub`).
  Passing neither or both throws as on GitLab. `updatedAfter` is required
  and must parse.
- Per project path: `GET /repos/{path}/pulls?state=<s>&sort=updated&direction=desc&per_page=100&page=N`,
  where `s` is `closed` when every requested state is merged or closed,
  `open` when only opened, and `all` otherwise (or when `states` is absent).
- Walks pages until a page is short or its last row is older than
  `updatedAfter`. No silent cap: past 100 pages (10,000 PRs) it throws,
  naming the path, instead of returning a short list.
- Keeps rows with `updated_at >= updatedAfter`. State maps `open` to
  `opened`, `closed` with `merged_at` to `merged`, other `closed` to
  `closed`; then filters to `states`. `excludeTargetBranches` drops rows
  whose `base.ref` is listed, client-side.
- Row: `iid` = number, `projectPath` = the path as passed, `title`, `state`,
  `createdAt`, `updatedAt`, `mergedAt`, `authorUsername` = `user.login` or
  null, `sourceBranch` = `head.ref`, `labels` = label names.
- `onPage(rowsSoFar)` after each page. `signal` aborts between and during
  requests and is never retried; transient retry is the GitHub client's
  existing GET retry (the builder checks `githubClient.ts` and states the
  exact behaviour in the method doc rather than copying GitLab's wording).

Cost: one REST request per 100 PRs updated in the window, per repo.

### `fetchApprovalRules` on GitHub

Options as GitLab's: `projectPath`, exactly one of `updatedAfter` or `iids`
(both throws), `pageSize`, `excludeTargetBranches`.

Per PR, the GraphQL selection is:

```graphql
number isDraft updatedAt baseRefName
reviewRequests(first: 100) { totalCount nodes { asCodeOwner requestedReviewer {
  __typename ... on User { login } ... on Team { combinedSlug } } } }
latestReviews(first: 20) { totalCount nodes { state author { login }
  onBehalfOf(first: 5) { totalCount nodes { combinedSlug } } } }
```

`latestReviews` (which includes `COMMENTED`) rather than
`latestOpinionatedReviews`, so a team member's comment review still carries
the team's rule.

- **iids mode**: aliased `p<n>: pullRequest(number: n)`, 50 PRs per
  request. Drafts are kept (the caller named them).
- **updatedAfter mode**: `repository.pullRequests(states: OPEN,
  orderBy: {field: UPDATED_AT, direction: DESC}, first: <pageSize>, after)`,
  default page size 50; a `pageSize` above 50 is clamped to 50 (it changes
  request count, never the result), and a non-positive or non-integer one
  throws as on GitLab. Stops once a node is older than `updatedAfter`.
  Drafts are left out, matching GitLab's `draft: false` (GitHub does not
  request code owners on a draft anyway). `excludeTargetBranches` drops by
  `baseRefName`.

Rules per PR, one per owner. The section is the owner lowercased: a team is
`'@' + combinedSlug.toLowerCase()` (`@org/team`), a user is
`'@' + login.toLowerCase()`. GitHub team slugs are lowercase and logins are
case-insensitive, so lowercasing keeps the rules and the owner list
(`fetchCodeownerSections`) joinable.

- A review request with `asCodeOwner: true` gives `{ type: 'CODE_OWNER',
  section: owner, approved: false }`.
- A latest review whose `onBehalfOf` names a team gives that team's rule,
  `approved: true` when the review state is `APPROVED`, otherwise false.
- Several entries for one owner merge into one rule, approved if any is.
- Rules are sorted by section, so every producer stores the same order.

Unknown, never guessed:

- A GraphQL error on a PR's alias or node (for example a team the token
  cannot read without `read:org`, or SAML) gives
  `{ iid, rules: [], unknownReason }`.
- A codeowner request whose `requestedReviewer` comes back null (a reviewer
  the token cannot see) gives the same.
- A capped connection that overflowed (`totalCount` above the nodes read on
  `reviewRequests`, `latestReviews` or any `onBehalfOf`) gives the same, so
  a truncated list never reads as complete.
- A PR the iids mode cannot find (`NOT_FOUND`) is left out of the result,
  as GitLab leaves out an iid it does not return.
- A failed request (HTTP error, rate limit) throws, as GitLab's does.

Supported and not supported, stated in the method doc:

- Supported: team owners, with approval read from GitHub's `onBehalfOf`, so
  no team membership read is needed; user owners while their codeowner
  request is pending.
- Not seen: a user owner's review of any kind. GitHub clears a requested
  reviewer's request as soon as they submit any review (approve, request
  changes or comment) and records no `onBehalfOf` for users, so that
  owner's rule leaves the PR once they review. Also not seen: owners
  GitHub itself does not request (no write access, drafts), and a
  codeowner request someone removed by hand. The daemon section says how
  tags treat this.

Cost: one GraphQL request per 50 PRs. Points per request about 11 (50 PRs,
three small nested connections), against GitHub's 5,000 an hour.

### `fetchCodeownerSections` on GitHub

One GraphQL request reading the default branch's three candidate files:

```graphql
repository(owner, name) {
  gh: object(expression: "HEAD:.github/CODEOWNERS") { ... on Blob { text isTruncated } }
  root: object(expression: "HEAD:CODEOWNERS") { ... on Blob { text isTruncated } }
  docs: object(expression: "HEAD:docs/CODEOWNERS") { ... on Blob { text isTruncated } }
}
```

- GitHub's precedence: `.github/`, then the root, then `docs/`; the first
  that exists is the one GitHub uses. None present returns null.
- A present file whose `text` is null or `isTruncated` is true throws, as
  GitLab's does for withheld text, since an empty list means "no owners".
- A missing repository throws.
- Parsing (`parseGitHubCodeowners` in `codeowners.ts`): drop blank lines and
  `#` comments (a `#` starting the line or after whitespace); the first
  token is the pattern; each later token starting with `@` is an owner.
  Owners are lowercased, deduplicated and sorted.
- Email owners are left out: rules name GitHub logins, so an email could
  never match one and would only make an empty tab. The doc says so.
- Last-match-wins and pattern syntax do not matter here: this read lists
  owners, and per-PR matching is GitHub's own.

Cost: one GraphQL request per call.

### `fetchDivergedCounts` and `fetchDivergedCount` on GitHub

Per PR: `p<n>: pullRequest(number: n) { baseRef { compare(headRef:
"refs/pull/<n>/head") { behindBy } } }`, 25 PRs per request.
`refs/pull/<n>/head` lives in the base repository, so fork PRs work too.
`behindBy` on the base ref compared with the head is the number of base
commits the head lacks, GitLab's `diverged_commits_count`.

- `fetchDivergedCounts` returns a map with an entry for each PR it read:
  the count, or null when the base branch is gone (`baseRef` null) or GitHub
  returns no comparison. A PR whose alias errored or was not found has no
  entry, so a caller keeps the value it had. A failed request throws.
- `fetchDivergedCount(projectPath, iid)` is a batch of one: the count or
  null; an alias error or a missing PR rejects, as GitLab's rejects on a
  failed request.
- `refs/pull/<n>/head` as a compare head is not verified until the live run.
  The live case asserts a known count on a fixture PR. If GitHub refuses it,
  the fallback is `headRefName` for same-repository PRs (unknown for forks),
  decided after that run.
- 25 compares in one request may run into GitHub's GraphQL timeout on large
  divergences. A timed-out alias has no entry, the safe outcome; the live
  run watches for it, and the batch size drops if it shows.

Cost: one GraphQL request per 25 PRs, about 1 point each (no connections).

### Live conformance cases

Written under `packages/glance/tests/live/`, never run here:

- Index: a PR the run merges appears as a `merged` row inside
  `updatedAfter`, with its source branch.
- Behind count: a PR branched before a later default-branch commit reports
  `behindBy >= 1`; a fresh PR off the tip reports 0.
- Codeowner sections and rules: read the fixture's CODEOWNERS; when it has
  none, the rules assertions skip with a message saying so.

### Version

One past main's glance version at push time, with the `CHANGELOG.md` entry
and the one `bun.lock` line; the README's SDK section lists the new reads.

## Design: daemon

### `project-sync-github.ts`

- `GitHubSyncProvider` adds `fetchMergeRequestIndex`, `fetchApprovalRules`,
  `fetchCodeownerSections` and `fetchDivergedCounts`.
- `githubFetchDelta`'s index adapter calls
  `fetchMergeRequestIndex({ projectPaths: [path], updatedAfter,
  states: ['merged', 'closed'] })` instead of the filled terminal listing.
  It keeps today's author canonicalisation (a scope author matched
  case-insensitively takes the scope's spelling), because `fetchDeltaFrom`
  compares authors exactly. The adapter's `fetchSingleMR` is
  `githubFetchSingle`: a never-stored terminal PR that becomes its branch's
  answer now costs one fill, where it used to come free from the listing's
  fills.
- New `githubFetchRules(ctx, opts)` and `githubFetchKnownSections(ctx)`.

### `project-sync.ts`

- `githubReads` gains `fetchRules` and `fetchKnownSections`, so the deep
  section sweep, the sections delta and `backfillSections` run on GitHub.
  The "not available on GitHub yet" notice, `githubSectionsLogged` and their
  test go.
- Sticky tags on GitHub only: in every sweep (deep, delta and
  `backfillSections`), an open GitHub PR's new tag set is the union of its
  fresh match and its stored tags still among the demanded sections. The
  deep sweep's `replaceAll` therefore writes stored tags for PRs whose rule
  has gone, and keeps those PRs in `byIid` from the store as it does for
  other matches. Tags leave with the PR when it merges or closes (the
  opened-only sweep prunes it) or when no demand names the section.
  GitLab's sweeps are unchanged.
- Unknown rules: an entry with `unknownReason` keeps the PR's stored tag in
  every sweep. The deep sweep's `replaceAll` carries the stored tag over for
  it, the delta leaves it out of `freshTags`, and `backfillSections` skips
  it. One `warn` per sweep gives the count and the first reason. GitLab
  never sets the field, so its paths are unchanged.
- Behind counts: the GitHub skip in `remeasureDivergedCounts` goes. On
  GitHub the picks are capped at 25 (one batched request) and read through a
  new `fetchDivergedBatch` override, defaulting to the GitHub context's
  `fetchDivergedCounts`. Every iid with an entry counts as measured; an iid
  with none counts as failed. GitLab keeps its cap of 10 and its per-MR read.
- `needsRebase` is untouched: the re-measure writes only
  `divergedCommitsCount`, as on GitLab.

### `cache-refresh.ts`

No change: it already calls `remeasureDivergedCounts` for every repo with
the `project-mrs` grant, and the GitHub skip is inside that function.

## Cost per repo per hour

The cycle runs 12 times an hour. "Section demand" means a board has
declared a codeowner tab for the repo.

| Read | 20 open PRs | 100 open PRs | Rides the fill? |
| --- | --- | --- | --- |
| Merged index (every cycle) | 12 REST, replacing today's same 12 listing pages | 12 REST, same | No: replaces it, and drops today's 0 to 12 terminal fills |
| Codeowner rules, sections delta (only with section demand) | 12 GraphQL | 12 GraphQL | No: separate read |
| Codeowner rules, daily deep and backfill | 1 a day | 2 a day | No |
| Codeowner owner list | 1 a day, plus 1 per backfill | same | No |
| Behind counts (every cycle) | 12 GraphQL; each PR re-measured every cycle | 12 GraphQL; each PR every 20 minutes | No: separate read |

Assumes fewer than 100 terminal and 50 open PRs change per 5 minutes; each
further 100 terminal or 50 open PRs costs one more request that cycle.
Forced syncs (a board's manual refresh) run the same delta, sections delta
included, so each adds its own 1 to 3 requests on top of the hourly
figures; the PR body says so.

Total added per repo per hour: with section demand, +24 new requests less
the 0 to 12 terminal fills the index removes, so +12 to +24; without it,
+12 less those fills, so 0 to +12. Rare extras: one fill per never-stored
terminal PR that becomes its branch's answer, and one per newly tagged PR
the sweep has to hydrate (both also exist on GitLab).

## Left to the builder

- Exact GraphQL error-path mapping to PR numbers in the updatedAfter mode.
- Test fixtures and how the request-count tests assert the costs above.
- The method docs' exact retry wording, from `githubClient.ts`.
- Live case fixture setup within the existing harness, without touching its
  pacing.
