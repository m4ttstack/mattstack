# Boxscore on GitHub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A team whose forge is GitHub gets a populated Boxscore leaderboard, with GitHub links, copy, bot filtering and Linear credit, while GitLab behaviour stays byte for byte the same.

**Architecture:** `readSettings()` learns the team's forge. On GitHub, Boxscore builds a glance `GitHubProvider` with a token from `GITHUB_TOKEN` or the daemon's grant-gated `secrets:forge-token` verb. `runRefresh` talks to a small `ForgeSource` seam with a GitLab implementation that wraps today's functions unchanged and a GitHub implementation composed from existing `GitHubProvider` reads. Responses carry an optional `forge`; one `forgeText` helper rewrites GitLab wording to GitHub wording, and is the identity on GitLab.

**Tech Stack:** Bun, TypeScript, Hono, React 19 with `@mattstack/app-kit`, vitest, `@mattstack/glance` 0.33.0 (read only), `@mattstack/rt-client`.

**Spec:** `docs/superpowers/specs/2026-11-12-boxscore-github-design.md`

## Global Constraints

- Write only under `apps/boxscore/` and `docs/superpowers/plans/`. Never edit `packages/glance`, `lib/daemon`, other apps, `plugins/` or `extensions/`.
- No live forge calls in any test; providers and the daemon call are fakes injected through seams. Never read `packages/glance/harness_credentials.json`.
- GitLab behaviour does not change: same requests, same copy, same stored data. Existing tests stay green without edits.
- `forge` is optional on `Env`, `LeaderboardResponse` and `UserDetailResponse`; absent means GitLab.
- GitHub is supported only on `github.com`; `baseUrl` on GitHub is exactly `https://github.com`.
- The GitHub token never goes to a GitLab host, and the GitLab token never goes to GitHub.
- No fetch cadence change. No new request beyond the spec's approved list (section 4).
- No em or en dashes in code, comments, copy or docs. Comments only state a constraint the code cannot show.
- Copy follows the `rt:ui-copy` skill; UI uses kit primitives only (`building-with-mantine-kit`).
- Run app gates from the worktree root: `bun run boxscore:test`, `bun run boxscore:typecheck`, `bun run boxscore:lint`. A single file: `cd apps/boxscore && bun --bun vitest run test/<file>.test.ts`.
- Stage named files only. Commit after every task.

## Review Focus

1. A GitHub login whose case differs from the roster (`Ada` vs `ada`): the person is still credited for PRs, reviews, approvals, commits and runs. Pinned in Task 3.
2. A PR whose GraphQL fill fails (`fetchSingleMR` returns null or warns `fill`): it counts in `mr_detail_partial`, never silently drops. Pinned in Task 3.
3. A commit with `author: null` (email not linked to a GitHub account): skipped, no crash, no row. Pinned in Task 3.
4. Every configured project untracked with rt and no `GITHUB_TOKEN`: a 400 whose text is the daemon's own refusal, and no request leaves the machine. Pinned in Task 2.
5. A GitLab team after this change: every request and every visible string is what it was. Pinned in Task 4 (request log) and Task 7 (`forgeText` identity).

---

### Task 1: The team's forge in settings

**Files:**
- Modify: `apps/boxscore/src/server/config/index.ts`
- Create: `apps/boxscore/src/shared/forge.ts`
- Test: `apps/boxscore/test/config-forge.test.ts`

**Interfaces:**
- Produces: `export type Forge = 'gitlab' | 'github'` in `shared/forge.ts`.
- Produces: `BoxscoreSettings.forge: Forge`. `Env.forge?: Forge`.
- Produces: `export const GITHUB_BASE_URL = 'https://github.com'` in `shared/forge.ts`.

- [ ] **Step 1: Write the failing tests** in `test/config-forge.test.ts`, using the `__setSettingReader`/`__setRosterReader` seams as `config-settings.test.ts` does:
  - `reads forge github and the github.com base url`: `mattstack.integrations: { forge: { provider: 'github', host: 'github.com' } }` gives `forge === 'github'`, `baseUrl === 'https://github.com'`.
  - `an empty github host means github.com`: `{ forge: { provider: 'github' } }` gives `baseUrl === 'https://github.com'`.
  - `a github enterprise host gets no base url`: `{ forge: { provider: 'github', host: 'ghe.example' } }` gives `forge === 'github'`, `baseUrl === ''`, `declaredHost === 'ghe.example'`.
  - `github ignores the confirmed gitlab host`: with `rt.integrations: { forgeHost: 'gitlab.example' }` and provider github, `baseUrl === 'https://github.com'`.
  - `absent or gitlab provider reads as gitlab`: `{}` and `{ forge: { provider: 'gitlab', host: 'gitlab.example' } }` both give `forge === 'gitlab'`; the second, with `rt.integrations.forgeHost: 'gitlab.example'`, keeps `baseUrl === 'https://gitlab.example'`.

- [ ] **Step 2: Run** `cd apps/boxscore && bun --bun vitest run test/config-forge.test.ts`. Expected: FAIL (`forge` undefined).

- [ ] **Step 3: Implement.** `Integrations.forge` gains `provider?: string`. `readSettings()` sets `forge = integrations.forge?.provider === 'github' ? 'github' : 'gitlab'`. On GitHub, `baseUrl = (declaredHost === '' || declaredHost === 'github.com') ? GITHUB_BASE_URL : ''` and `trustedGitLabHost` is not called. GitLab code path unchanged.

- [ ] **Step 4: Run** the new file and `test/config-settings.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** `boxscore: read the team's forge from settings (BOXSCR-5)`.

### Task 2: GitHub token, provider and current user

**Files:**
- Create: `apps/boxscore/src/server/config/github-token.ts`
- Modify: `apps/boxscore/src/server/leaderboard.ts` (`resolveEnv`, setup hints)
- Modify: `apps/boxscore/src/server/source/provider.ts` (`makeProvider`)
- Modify: `apps/boxscore/src/server/config/current-user.ts`
- Test: `apps/boxscore/test/config-github-token.test.ts`, `apps/boxscore/test/config-current-user.test.ts` (add cases)

**Interfaces:**
- Consumes: `Forge`, `GITHUB_BASE_URL`, `BoxscoreSettings.forge` (Task 1).
- Produces: `export async function readGitHubToken(projects: readonly string[], deps?: GitHubTokenDeps): Promise<{ token: string } | { token: null; reason: string }>` with `interface GitHubTokenDeps { env?: Record<string, string | undefined>; forgeToken?: (repoName: string) => Promise<RtResponse<ForgeTokenData>> }`.
- Produces: `export function githubRepoName(projectPath: string): string` = `serializeIdentity({ kind: 'remote', id: \`github.com/${projectPath}\` })`.
- Produces: `export function __setGitHubTokenDeps(d: GitHubTokenDeps | null): void` (test seam, like `__setSettingReader`).
- Produces: `getCurrentUser(baseUrl, token, fetchImpl?, forge?: Forge)`.

- [ ] **Step 1: Write the failing tests** in `test/config-github-token.test.ts`:
  - `GITHUB_TOKEN wins and the daemon is not asked`: env `{ GITHUB_TOKEN: ' t1 ' }` gives `{ token: 't1' }`; the `forgeToken` fake records zero calls.
  - `asks each project in order until one grants`: projects `['o/a', 'o/b']`; fake refuses `o/a` (`{ ok: false, error: 'repo ... not tracked ... rt daemon track ...' }`) and grants `o/b`; result `{ token: 't2' }`; calls are `[githubRepoName('o/a'), githubRepoName('o/b')]`.
  - `every refusal gives the first refusal's text`: both refuse; result `{ token: null, reason: <first error> }`.
  - `no projects gives a reason naming boxscore.projects`.
  - `githubRepoName('Org/Repo')` equals `serializeIdentity({ kind: 'remote', id: 'github.com/Org/Repo' })`.
- Add to `config-current-user.test.ts`: `github reads GET https://api.github.com/user with a Bearer token`: a fake `fetchImpl` records the URL and `Authorization: Bearer tkn`, returns `{ login: 'ada', name: 'Ada' }`, result `{ username: 'ada', name: 'Ada' }`; the request carries no `PRIVATE-TOKEN` header.
- Add to `test/leaderboard.test.ts` a describe `on github` (inject settings with provider github, a `__setGitHubTokenDeps` fake, and a provider factory):
  - `an untracked team answers ConfigError with the daemon's refusal`: every project refused; `getLeaderboard` rejects with `ConfigError` whose message contains the refusal text; the provider factory is never called.
  - `the gitlab token never reaches github`: `GITLAB_TOKEN=gl-secret` in env, `GITHUB_TOKEN=gh-tkn`; the factory receives `env.token === 'gh-tkn'`, `env.forge === 'github'`, `env.baseUrl === 'https://github.com'`.
  - `a github enterprise host answers a ConfigError naming the host`.

- [ ] **Step 2: Run** the three files. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `readGitHubToken`: trimmed `env.GITHUB_TOKEN` first; else `forgeToken` per project (default: rt-client `resolveForgeToken(repoName, 'github', { sockPath: join(process.env.HOME ?? homedir(), '.mattstack', 'rt', 'rt.sock') })`). Under `process.env.VITEST` with no injected `forgeToken`, return `{ token: null, reason: 'tests must inject forgeToken' }` without calling the daemon.
  - `resolveEnv()`: GitLab branch unchanged. GitHub branch: empty `baseUrl` throws `ConfigError('GitHub is not connected: boxscore reads GitHub only on github.com, and the team names <declaredHost>.')`; empty `projects` throws `resolveScope()`'s existing `boxscore.projects is empty` error before any token read (call `resolveScope()` first in the GitHub branch); token from `readGitHubToken(settings.projects)`, a null throws `ConfigError('GitHub token is not available: <reason>')`; `linearApiKey` from `readSecrets()`; returns `{ forge: 'github', baseUrl, token, linearApiKey }`.
  - `makeProvider(env)`: `env.forge === 'github'` builds `new GitHubProvider(env.baseUrl, env.token)`; else today's line.
  - `getCurrentUser`: when `forge === 'github'`, fetch `https://api.github.com/user` with `Authorization: Bearer <token>` and `Accept: application/vnd.github+json`, map `login` to `username`. The cache key adds the forge. `buildLeaderboard` passes `env.forge`.

- [ ] **Step 4: Run** the three files plus `test/config-secrets.test.ts` and `test/leaderboard-host-race.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** `boxscore: GitHub token from forge-token, GitHub provider (BOXSCR-5)`.

### Task 3: The GitHub source adapter

**Files:**
- Create: `apps/boxscore/src/server/source/forge-source.ts` (the seam and the GitLab implementation)
- Create: `apps/boxscore/src/server/source/github.ts`
- Create: `apps/boxscore/src/server/source/logins.ts`
- Modify: `apps/boxscore/src/server/source/index.ts` (exports)
- Test: `apps/boxscore/test/source-github.test.ts`, `apps/boxscore/test/logins.test.ts`

**Interfaces:**
- Produces, in `forge-source.ts`:
  ```ts
  export interface ForgeDetail { metrics: StoredMetrics; commits: StoredPushEvent[] }
  export interface ForgeSource {
    resolveIdentity(username: string, io: SourceIO): Promise<StoredIdentity>;
    scanProject(projectPath: string, updatedAfter: string, io: SourceIO): Promise<IndexRow[]>;
    fetchDetail(row: IndexRow, io: SourceIO): Promise<ForgeDetail | null>;
    fetchPipelines(projectPath: string, username: string, window: TimeWindow, io: SourceIO): Promise<StoredPipeline[]>;
    /** GitLab reads push events per user after the project id step; GitHub returns commits from fetchDetail. */
    readonly readsPushEvents: boolean;
    /** Warnings raised inside reads that still returned rows (caps); runRefresh drains them into its result. */
    takeWarnings(): LeaderboardWarning[];
  }
  export function gitlabSource(provider: SourceProvider): ForgeSource;
  ```
  `gitlabSource` delegates to today's `resolveIdentity`, `scanProject`, `fetchMetrics` (mapped to `{ metrics, commits: [] }`, null stays null) and `fetchPipelinesFor`, with `readsPushEvents: true` and `takeWarnings` always `[]`.
- Produces, in `github.ts`:
  ```ts
  export interface GitHubSourceProvider {
    fetchUser(username: string): Promise<UserRef | null>;
    fetchMergeRequestIndex(o: FetchMergeRequestIndexOptions): Promise<MergeRequestIndexRow[]>;
    fetchSingleMR(projectPath: string, iid: number, me: number | null, onWarning?: (w: FetchPullRequestsWarning) => void): Promise<PullRequest | null>;
    fetchMRDiscussions(repositoryId: string, iid: number): Promise<MRDetail>;
    restRequest(method: string, path: string): Promise<Response>;
  }
  export function githubSource(provider: GitHubSourceProvider, opts: { knownLogins: readonly string[] }): ForgeSource;
  ```
- Produces, in `logins.ts`: `export function loginCanon(known: readonly string[]): (login: string | null) => string | null` returning the known spelling on a case-insensitive match, else the login unchanged.

- [ ] **Step 1: Write the failing tests.** `test/logins.test.ts`: `loginCanon(['ada'])('Ada') === 'ada'`, `('eve') === 'eve'`, `(null) === null`.
  `test/source-github.test.ts`, with a hand-written fake `GitHubSourceProvider` whose `restRequest` serves canned JSON by path (pages linked by a `Link: <...page=2>; rel="next"` header) and records every call:
  - `resolveIdentity maps fetchUser`: asked for `ada`, `{ id: 'github:user:42', username: 'Ada', name: 'Ada' }` gives `{ username: 'ada', name: 'Ada', resolved: true, userId: 42 }` (the stored row keeps the requested roster spelling); null gives `resolved: false`.
  - `scanProject rewrites the author to the roster spelling`: index row author `Ada`, known `['ada']`, stored `authorUsername === 'ada'`.
  - `fetchDetail composes the reads`: fill returns body `'b'`, diffStats `{ additions: 10, deletions: 2, filesChanged: 1 }`, approvedBy `[{ username: 'Bob' }]`; discussions return one diff note by `bob` and one issue comment by `ada`; files return `[{ filename: 'a.ts', additions: 10, deletions: 2 }]`; commits return the GitHub shape `[{ author: { login: 'Ada' }, commit: { author: { date: '2026-05-03T10:00:00Z' } } }, { author: null, commit: { author: { date: '2026-05-04T10:00:00Z' } } }]`. Known `['ada', 'bob']`. Expect `metrics.description === 'b'`, `diffStats` as given, `fileStats === [{ path: 'a.ts', additions: 10, deletions: 2 }]`, `labels` from the index row, `approvedByUsernames === ['bob']`, notes `[{ authorUsername: 'bob', inline: true, system: false, ... }, { authorUsername: 'ada', inline: false, system: false, ... }]`, `commits === [{ username: 'ada', createdAt: '2026-05-03T10:00:00Z', repositoryId: 'github:o/r' }]`. `fetchMRDiscussions` was called with `'github:o/r'`.
  - `paging follows Link rel=next` for files and commits (two pages each, all rows kept).
  - `a null fill throws`: `fetchSingleMR` resolves null; `fetchDetail` rejects with a message naming `o/r#7`.
  - `a fill warning throws`: `fetchSingleMR` calls `onWarning` with a `FetchPullRequestsWarning` of `source: 'fill'`, `kind: 'request-failed'`, `message: 'boom'`, then returns a PR; `fetchDetail` rejects with `boom`.
  - `a contexts warning does not fail the PR`: the same with `source: 'contexts'`; `fetchDetail` resolves with the metrics.
  - `a non-ok REST page throws` naming the path and status.
  - `250 commits adds a warning`: commits pages total 250; `takeWarnings()` then returns one warning with code `mr_detail_partial`, naming `o/r#7` and saying commits are capped at 250, and a second `takeWarnings()` returns `[]`.
  - `fetchPipelines lists Actions runs per user`: requested path is exactly `/repos/o/r/actions/runs?actor=ada&created=2026-05-01T00:00:00Z..2026-05-31T00:00:00Z&per_page=100&page=1`; runs `{ id: 9, actor: { login: 'Ada' }, status: 'completed', conclusion: 'failure', created_at: 'x' }` gives `{ id: 'github:run:9', projectPath: 'o/r', username: 'ada', status: 'failed', createdAt: 'x' }`; conclusions `success` gives `success`, `cancelled` gives `canceled`, `timed_out` gives `timed_out`; `conclusion: null, status: 'in_progress'` gives `in_progress`.
  - `more than 1000 runs warns`: `total_count: 1001` makes `takeWarnings()` return one `pipeline_fetch_failed` warning naming `o/r` and `ada`.
  - `readsPushEvents is false`.

- [ ] **Step 2: Run** both files. Expected: FAIL.

- [ ] **Step 3: Implement** `forge-source.ts`, `logins.ts` and `github.ts` to those interfaces. Notes:
  - `fetchDetail` runs the four reads in sequence (fill, discussions, files pages, commits pages); labels come from `row.labels`.
  - A note is inline when its `position` is not null or its `type === 'DiffNote'`.
  - `created=` bounds drop milliseconds: `iso.replace(/\.\d{3}Z$/, 'Z')`.
  - Stop paging when no `rel="next"` link is present.
  - Call `io.signal?.throwIfAborted()` before every provider call: glance's GitHub reads take no signal, so cancel works between requests.
  - Commit authors are kept when they match `knownLogins` (roster plus org roster); `buildFetchResult` already narrows push events to the roster, so the adapter does not filter further.

- [ ] **Step 4: Run** both files. Expected: PASS.

- [ ] **Step 5: Commit** `boxscore: GitHub source adapter over existing glance reads (BOXSCR-5)`.

### Task 4: Refresh runs through the forge seam

**Files:**
- Modify: `apps/boxscore/src/server/refresh/run.ts`
- Modify: `apps/boxscore/src/server/leaderboard.ts` (build the source)
- Test: `apps/boxscore/test/refresh-github.test.ts`; `apps/boxscore/test/refresh.test.ts` unchanged

**Interfaces:**
- Consumes: `ForgeSource`, `gitlabSource`, `githubSource` (Task 3).
- Produces: `RefreshRunOptions.source?: ForgeSource`. When absent, `runRefresh` uses `gitlabSource(provider as SourceProvider)`, so every existing caller and test is unchanged.
- Produces: `export function sourceFor(env: Env, provider: GitProvider, settings: BoxscoreSettings): ForgeSource` in `forge-source.ts`, picking `githubSource` when `env.forge === 'github'` with `knownLogins` = roster plus org roster usernames.

- [ ] **Step 1: Write the failing test** `test/refresh-github.test.ts` (store setup as in `refresh.test.ts`), with a fake `ForgeSource` and a fake `GitHubSourceProvider` passed through `githubSource`:
  - `github refresh stores metrics, commits and runs`: one roster PR; after `runRefresh({ ..., source })`, `store.pushEventsBetween(WINDOW.start, WINDOW.end)` holds the commit row, `upsertMrMetrics` stored the PR's metrics, pipelines holds the run.
  - `github refresh skips the project id and push event phases`: the progress phases seen do not include `pushes`; the fake records no `fetchProject` or `fetchUserEvents`.
  - `a failed detail counts in mr_detail_partial`: the fake `fetchDetail` rejects for one of two PRs; warnings include one `mr_detail_partial` with `1/2`.
  - `source warnings reach the returned warnings`: a fake source whose `takeWarnings()` returns one `pipeline_fetch_failed` warning; it appears in what `runRefresh` returns.

- [ ] **Step 2: Run** it. Expected: FAIL.

- [ ] **Step 3: Implement.** Steps 1 to 4 of `runRefresh` call `source.resolveIdentity`, `source.scanProject`, `source.fetchDetail` and `source.fetchPipelines`. A `fetchDetail` result pushes `{ ...metrics, updatedAt: row.updatedAt }` and its `commits` into the same pending batch; `flush` writes metrics with `upsertMrMetrics` and commits with `upsertPushEvents`. The project id and push event steps run only when `source.readsPushEvents`. Before returning (and in the detail step's `finally`, so a cancel keeps them), `runRefresh` appends `source.takeWarnings()` to its warnings. `buildLeaderboard` passes `source: sourceFor(env, provider, settings)`.

- [ ] **Step 4: Run** `test/refresh-github.test.ts`, `test/refresh.test.ts`, `test/progress.test.ts`, `test/abort.test.ts`, `test/leaderboard.test.ts`. Expected: all PASS, with `refresh.test.ts` unedited (it pins the GitLab call log).

- [ ] **Step 5: Commit** `boxscore: refresh through a forge source seam (BOXSCR-5)`.

### Task 5: Forge on responses, links

**Files:**
- Modify: `apps/boxscore/src/shared/forge.ts`, `apps/boxscore/src/shared/types.ts`
- Modify: `apps/boxscore/src/server/metrics/evidence.ts` (`EvidenceContext`, `mrUrl`)
- Modify: `apps/boxscore/src/server/leaderboard.ts` (both responses, `ColdCacheError`), `apps/boxscore/src/server/routes.ts` (cold response), `apps/boxscore/src/server/fixture/index.ts`, `apps/boxscore/src/server/fixture/design-evidence.ts`
- Test: `apps/boxscore/test/forge.test.ts`, `apps/boxscore/test/evidence.test.ts`, `apps/boxscore/test/leaderboard.test.ts`, `apps/boxscore/test/fixture.test.ts` (add cases)

**Interfaces:**
- Produces: `export function changeUrl(forge: Forge | undefined, baseUrl: string, projectPath: string, iid: number): string`.
- Produces: `LeaderboardResponse.forge?: Forge`, `UserDetailResponse.forge?: Forge`, `ColdCacheResponse.forge?: Forge`, `EvidenceContext.forge?: Forge`.
- Produces: `export function changeRef(forge: Forge | undefined, iid: number): string`: `#12` on GitHub, `!12` otherwise.
- Produces: `fixtureForge(): Forge`, reading `BOXSCORE_FIXTURE_FORGE` (`'github'` or GitLab).

- [ ] **Step 1: Write the failing tests.**
  - `forge.test.ts`: `changeUrl('github', 'https://github.com', 'o/r', 7) === 'https://github.com/o/r/pull/7'`; `changeUrl(undefined, 'https://gl.example', 'g/p', 7) === 'https://gl.example/g/p/-/merge_requests/7'`; same for `'gitlab'`.
  - `evidence.test.ts`: `github evidence links point at pull requests`: `buildUserEvidence(..., { ...ctx, forge: 'github', baseUrl: 'https://github.com' })` gives every merged-PR row an `href` matching `^https://github\.com/[^/]+/[^/]+/pull/\d+$`.
  - `leaderboard.test.ts`: a GitLab response has `forge === 'gitlab'`; a GitHub one has `forge === 'github'`.
  - `forge.test.ts`: `changeRef('github', 12) === '#12'`, `changeRef(undefined, 12) === '!12'`.
  - `evidence.test.ts`: on GitHub, PR-keyed cells read `#<iid>`; on GitLab, `!<iid>` as today.
  - `leaderboard.test.ts`: a cold GitHub team's `ColdCacheError` response carries `forge: 'github'`; `getUserDetail` on GitHub passes `forge` into the evidence (its merged rows link to `/pull/`).
  - `fixture.test.ts`: with `BOXSCORE_FIXTURE_FORGE=github`, `fixtureLeaderboard(false).forge === 'github'`, `fixtureColdCache().forge === 'github'`, `baseUrl === 'https://github.com'`, every evidence `href` that pointed at a merge request matches the GitHub pull shape; without it, the fixture output is unchanged (`forge === 'gitlab'`, links as today).

- [ ] **Step 2: Run** the four files. Expected: FAIL.

- [ ] **Step 3: Implement.** `mrUrl` in `evidence.ts` calls `changeUrl(ctx.forge, baseUrl, ...)` and every `` `!${m.iid}` `` cell calls `changeRef(ctx.forge, m.iid)`; any other server-built change-request `href` does the same (`rg -n "merge_requests|'!'|\`!\\$" src/server`). `getUserDetail` passes `forge: env.forge` into `buildUserEvidence`'s ctx. The leaderboard, detail and cold-cache responses set `forge: env.forge ?? 'gitlab'` (the cold response is built where `ColdCacheError` is answered). The fixture reads `fixtureForge()` for `forge`, `baseUrl`, its evidence links and refs. `ColdCacheError` (`server/leaderboard.ts`) gains `forge` the way it carries `scope`, and `server/routes.ts` copies it into the `ColdCacheResponse`.

- [ ] **Step 4: Run** the four files. Expected: PASS.

- [ ] **Step 5: Commit** `boxscore: forge on responses, GitHub PR links (BOXSCR-5)`.

### Task 6: Linear credit for GitHub PRs, GitHub bots

**Files:**
- Modify: `apps/boxscore/src/server/linear/fetch.ts`, `apps/boxscore/src/server/refresh/run.ts` (pass forge and projects)
- Modify: `apps/boxscore/src/shared/bots.ts`
- Test: `apps/boxscore/test/linear.test.ts`, `apps/boxscore/test/linear-resolve.test.ts`, `apps/boxscore/test/bots.test.ts` (add cases)

**Interfaces:**
- Produces: `parseChangeUrl(url: string, forge: Forge): { projectPath: string; iid: number } | null`. `parseMrUrl` stays exported and unchanged (GitLab).
- Produces: `resolveLinearTickets(apiKey, sourceMrs, warnings, roster, signal?, onProgress?, forge?: { kind: Forge; projects: readonly string[] })`. Absent means GitLab, today's behaviour.

- [ ] **Step 1: Write the failing tests.**
  - `parseChangeUrl('https://github.com/o/r/pull/12', 'github')` gives `{ projectPath: 'o/r', iid: 12 }`; with `/files`, `?x=1` and `#c` suffixes too; `https://github.com/o/r/issues/12` gives null; a GitLab MR URL with `'github'` gives null.
  - `linear-resolve.test.ts`: `credits a GitHub PR attachment`: an issue with attachment `{ url: 'https://github.com/O/R/pull/5', sourceType: 'github' }`, a source MR `o/r#5` by `ada`, projects `['o/r']`, forge github; the issue is credited to `ada`. And `takes the attachment whatever its sourceType` (sourceType `null`). And `a gitlab team ignores GitHub attachments`.
  - `bots.test.ts`: `scanSuspectedBots` lists `dependabot[bot]` from a stored note on a GitHub store; `dependabot[bot]` and `github-actions[bot]` are bots; `ada` and a GitLab `project_5_bot` still behave as today; `BUILTIN_BOT_PATTERN_LABELS` includes `*[bot]`.

- [ ] **Step 2: Run** the three files. Expected: FAIL.

- [ ] **Step 3: Implement.** In `resolveAttachments`, on GitHub take every attachment `parseChangeUrl(n.url, 'github')` accepts, then map its `projectPath` to the configured project whose lowercase matches, dropping it when none does. GitLab keeps `n.sourceType === 'gitlab'` plus `parseMrUrl`. `runRefresh` passes `{ kind: env.forge ?? 'gitlab', projects: settings.projects }`. `BUILTIN_BOT_PATTERNS` gains `{ source: '\\[bot\\]$', labels: ['*[bot]'] }`.

- [ ] **Step 4: Run** the three files plus `test/ticket-grade.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** `boxscore: credit GitHub PR attachments, exclude GitHub bots (BOXSCR-5)`.

### Task 7: Forge-aware copy

**Files:**
- Modify: `apps/boxscore/src/shared/forge.ts` (`forgeText`, `GITHUB_COPY`)
- Create: `apps/boxscore/src/app/forge/forge.ts` (`ForgeContext`, `useForgeText`)
- Modify: `apps/boxscore/src/app/App.tsx` (provide the context from the leaderboard response)
- Modify the render sites of forge-named strings: `app/detail/panelCopy.ts` consumers (`StatPanel.tsx`, `ProfileHeader.tsx`, `PersonSummary.tsx`), `app/leaderboard/StandingsTable.tsx`, `app/leaderboard/LeadersStrip.tsx`, `app/leaderboard/CardsGrid.tsx`, `app/detail/evidence/*`, `app/refresh/RefreshStatus.tsx`, `app/lib/progress.ts`, `app/access/LockedPage.tsx`
- Modify server strings: `server/metrics/evidence.ts` (summaries, headings), `server/refresh/run.ts` (progress labels, warning texts), `server/leaderboard.ts` (hints), `server/viewer-scope.ts` (`LOCKED_MESSAGE` use sites)
- Modify: `apps/boxscore/src/server/fixture/index.ts`, `apps/boxscore/src/server/fixture/design-evidence.ts` (route text through `forgeText`)
- Test: `apps/boxscore/test/forge.test.ts`, `apps/boxscore/test/fixture.test.ts`, `apps/boxscore/src/app/detail/detail.test.tsx`, `apps/boxscore/src/app/leaderboard/leaderboard.test.tsx`, `apps/boxscore/src/app/refresh/refresh.test.tsx` (add GitHub cases)

**Interfaces:**
- Produces: `export function forgeText(text: string, forge: Forge | undefined): string`.
- Produces: `export const GITHUB_COPY: Readonly<Record<string, string>>`, whole-string GitHub replacements consulted before the word rewrite.
- Produces: `ForgeContext = createContext<Forge>('gitlab')`, `useForgeText(): (text: string) => string`.

- [ ] **Step 1: Write the failing tests.**
  - `forge.test.ts`: `forgeText(s, 'gitlab') === s` and `forgeText(s, undefined) === s` for every string in `panelCopy`, `METRICS` labels and descriptions, and a sample of server strings (loop over them). On GitHub: `'MRs merged'` gives `'PRs merged'`; `'Source: GitLab MRs you authored'` gives `'Source: GitHub PRs you authored'`; `'merge request'` gives `'pull request'`; `'MRI'` and `'SMR'` are unchanged (word boundaries); `'Source: GitLab pushes to tracked projects'` gives `'Source: GitHub commits on your PRs'`; `'Source: GitLab pipelines you triggered'` gives `'Source: GitHub Actions runs you triggered'`; the coding-days evidence summary `'<n> distinct days with a push'` gives `'<n> distinct days with a commit'`; the `codingDays` description gives `'Number of distinct days the user authored at least one commit on their PRs during the window.'`.
  - `leaderboard.test.tsx`: rendered with a `forge: 'github'` response, the column header reads `PRs merged` and no text node contains `MR` as a word or `GitLab`; with the existing GitLab response, `MRs merged` as today.
  - `detail.test.tsx`: a GitHub detail response shows `Source: GitHub PRs you authored` on the merged panel.
  - `refresh.test.tsx` (`src/app/refresh/`): a cold GitHub board (`ColdCacheResponse` with `forge: 'github'`) renders `RefreshStatus` with no `MR` word and no `GitLab`, and a stalled progress reads `still waiting on GitHub`.
  - `forge.test.ts`: on GitHub, `GITHUB_COPY` turns the coding-days evidence heading `'Pushes'` into `'Commits'`, the panelCopy codingDays definition into `'Distinct days you authored at least one commit on your PRs.'`, and the reviewDepth description's `(DiffNote)` mention into wording without it.
  - `fixture.test.ts`: with `BOXSCORE_FIXTURE_FORGE=github`, no string in `fixtureDetail(...)` evidence or `fixtureRefresh()` contains `MR` as a word or `GitLab`.

- [ ] **Step 2: Run** them. Expected: FAIL.

- [ ] **Step 3: Implement.** `forgeText` returns `text` unchanged unless `forge === 'github'`; on GitHub it returns `GITHUB_COPY[text]` when present, else applies, in order: `/\bmerge requests\b/g` to `pull requests`, `/\bmerge request\b/g` to `pull request`, `/\bMerge requests\b/g` to `Pull requests`, `/\bMRs\b/g` to `PRs`, `/\bMR\b/g` to `PR`, `/\bGitLab\b/g` to `GitHub`. Strings with a number (`'<n> distinct days with a push'`) get the push-to-commit change from a dedicated `/\bdays? with a push\b/` rule inside `forgeText` on GitHub. App components read strings through `useForgeText()`; `App.tsx` provides `ForgeContext` from `data?.forge ?? cold?.forge ?? 'gitlab'`, so the first refresh of a cold GitHub board already reads GitHub. Server strings go through `forgeText(s, env.forge)` (evidence through `ctx.forge`); the fixture's evidence text and `fixtureRefresh()` label go through `forgeText(s, fixtureForge())`. On GitHub, `LOCKED_MESSAGE` reads `"boxscore couldn't tell who you are. Check that rt can read a GitHub token for one of boxscore's projects and that your GitHub username is on the team roster in console."` through `GITHUB_COPY`.

- [ ] **Step 4: Run** `bun run boxscore:test`. Expected: PASS, no existing test edited.

- [ ] **Step 5: Render and look.** Start the fixture server twice (`BOXSCORE_FIXTURE=design` and `BOXSCORE_FIXTURE=design BOXSCORE_FIXTURE_FORGE=github`, under an isolated HOME, per `scripts/parity/run.md`), open the leaderboard and one person's detail in Fast Browser, and screenshot both forges in light and dark. Check: GitHub copy reads PR/GitHub everywhere, links go to `github.com/.../pull/N`, no `[bot]` name appears in any reviewer evidence, nothing overflows; GitLab screens match today. Write down anything that reads wrong and fix it before committing.

- [ ] **Step 6: Commit** `boxscore: forge-aware copy (BOXSCR-5)`.

### Task 8: End-to-end GitHub leaderboard and docs

**Files:**
- Test: `apps/boxscore/test/leaderboard-github.test.ts`
- Modify: `apps/boxscore/README.md`, `apps/boxscore/AGENTS.md` (one line: GitHub transport and the forge seam)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the failing test** `leaderboard-github.test.ts`: GitHub settings with two roster members, `GITHUB_TOKEN` env, a provider factory returning a fake `GitHubProvider` (same fake as Task 3) with two merged PRs by `ada` reviewed and approved by `bob`, inline comments, a `dependabot[bot]` comment, commits on three days, and two Actions runs. A third PR by `bob`, titled `Revert "<title of ada's first PR>"`, merges a day after it. `bob` comments on `ada`'s PRs hours after each opens, and `ada` replies on `bob`'s revert PR. `getLeaderboard({ refresh: true, ... })` gives `forge === 'github'`, `ada`'s `mrsMerged === 2`, additions and deletions non-zero, `codingDays === 3`, `pipelines === 2`, wait for review non-null, merge streak non-zero, size health non-null, reverted count `1` and revert rate non-zero; `bob`'s `mrsReviewed === 2`, `reviewDepth > 0` and response time non-null; `dependabot[bot]` is not a row and its comment does not count as a review; every recorded request went to the fake (no other host), and no request carried the `GITLAB_TOKEN` value. The detail response's merged rows link to `https://github.com/o/r/pull/<n>`.

- [ ] **Step 2: Run** it. Expected: PASS once Tasks 1 to 7 are in; if it fails, fix the owning task's code, not the test.

- [ ] **Step 3: Write the README GitHub section**: setup (`mattstack.integrations.forge.provider = github`, track one configured project with `rt daemon track <repo> live branches` or set `GITHUB_TOKEN`), what each metric reads on GitHub, the request cost table from the spec's section 4, and the limits (github.com only, coding days are commit author dates on the team's PRs, 250 commits per PR, 1000 Actions runs per person per repo per window, commits force-pushed off an open PR stay counted).

- [ ] **Step 4: Run the full gates** from the worktree root: `bun run boxscore:test`, `bun run boxscore:typecheck`, `bun run boxscore:lint`, `bun run typecheck`, `bun run purity`. Expected: all green.

- [ ] **Step 5: Commit** `boxscore: GitHub end-to-end test and README (BOXSCR-5)`.
