# Forge Leaderboard

A local, single-operator dashboard that ranks a hand-picked set of GitLab users against
each other across a window, on both **volume** metrics (lines, MRs merged/reviewed,
pipelines) and **quality / consistency** metrics (review depth, review latency, revert
rate, MR size health, coding-day streak, review reciprocity), with an optional
**self-vs-self trend** view.

The token stays **server-side only** ... the browser never sees it.

> ## ⚠️ Read this before you share it with anyone
>
> These metrics are the textbook gameable proxies. Lines-of-code and MR-count reward large
> diffs and lots of tiny MRs; raw "MRs reviewed" rewards rubber-stamping. The quality
> columns exist precisely as **counterweights** ... pair every speed/volume number with its
> quality partner (latency with depth, merges with revert rate) and prefer the **trend**
> view (you vs. your past self) over absolute ranking.
>
> This is fine for self-tracking and friendly comparison. **Do not let it become a real
> scoreboard people are measured on**, or the numbers will quietly stop meaning anything
> (Goodhart's Law). Individual output leaderboards are uniformly described as harmful in the
> engineering-metrics literature; that warning is the whole reason the trend view and the
> quality counterweights exist.

---

## Architecture

- **`src/server`** is a [`@mattstack/app-server`](https://github.com/m4ttstack/app-server)
  app: a single Hono route table (`src/server/routes.ts`, mounted as `AppType` for the
  client's typed RPC) served through `serveMattstackApp` from `src/server/index.ts`. The
  metric math, GitLab fetch/store layer, and CLI live under it (`metrics/`, `store/`,
  `refresh/`, `linear/`, `cli.ts`); see "Notes & limitations" below for how that part works.
- **`src/app`** is a [`@mattstack/app-kit`](https://github.com/m4ttstack/mattstack/tree/main/packages/ui) app
  on the kit shell with no rail (`MattstackShell rail={false}`; the page context and actions
  sit in the app bar, `src/app/shell/`), [wouter](https://github.com/molefrog/wouter) for
  routing (`src/app/routes.ts` maps `/`, `/user/:name` and `/user/:name/:stat` to a small
  `AppRoute` union; anything else is the not-found page), and
  [`@tanstack/react-query`](https://tanstack.com/query) for data fetching
  (`src/app/hooks/useLeaderboard.ts`, `useUserDetail`) over a Hono RPC client
  (`src/app/api.ts`, typed against the server's `AppType`) so query params and response
  shapes stay compiler-checked end to end. Charts come from `@mattstack/app-kit/charts`.
- **`src/shared`** holds the wire types (`types.ts`) and metric metadata (`metrics.ts`)
  both sides import ... the one place a metric's key, label, and formatting are defined.
- **Settings** are not a committed config file: they live in the rt settings store and are
  edited in console (`/settings#boxscore`); the app bar's settings link opens it in a new tab.
  `rt settings list` still works for a read-only check from the terminal; see "Setup" below.

## UI

Every stat belongs to one of five groups: delivery, volume, quality, consistency and
collaboration.

- **Leaderboard** (`/`): a leaders strip (one leader per group) over the standings table,
  tabbed Overview plus one tab per group. The page header switches the range (7d, 30d,
  90d), values or trend (each value beside its change from the prior equal window), and
  table or cards (one card per stat, every person ranked).
- **Person** (`/user/:name/:stat`): a profile header, a summary of where the person leads
  and places, a stat rail grouped by group, and the selected stat's panel: its value, rank
  and definition, plus evidence drawn for that stat (histograms, a push calendar, merge
  days, bands, author strips, pipeline status) over the MRs, notes or pipelines behind it.
  `/user/:name` opens the first stat.
- **Refresh**: the topbar's Refresh button rescans GitLab. A warm refresh keeps the last
  numbers on screen, dimmed, under a stepper; a window with nothing stored yet shows a
  skeleton table and a first-load status that says when it is still waiting on GitLab.

The designs are the boards in `docs/apps/design/boxscore/` (repo root);
`scripts/parity/run.md` checks the app against them.

## Setup

Requires [Bun](https://bun.sh) 1.1+.

```bash
bun install
```

Configuration lives in rt settings, not in a committed file (edit it in console's
`/settings#boxscore`, or read it from the terminal). List boxscore's current values with:

```bash
rt settings list | grep boxscore
```

The roster comes from the shared `mattstack.roster` key. The GitLab token goes only to the host
you confirmed with `rt setup gitlab connect --host <host>` (`rt.integrations.forgeHost`), or to
gitlab.com when the team declares it in `mattstack.integrations`; any other team-declared host is
shown in the setup hint but never sent the token. The team's Linear key is in `mattstack.directory`; everything
boxscore-specific (`boxscore.projects`, `boxscore.hiddenMembers`, `boxscore.sizeBand`,
`boxscore.linearDoneStates`, `boxscore.excludeFilePatterns`, `boxscore.ignoredMrs`,
`boxscore.botPatterns`, `boxscore.defaultRange`) is set the same way. See the `rt:settings`
skill for how to write a key.

Secrets (the GitLab PAT and, optionally, a Linear API key) live in the rt secrets store
under `gitlabToken` / `linearApiKey`, scope `extension`. Use a **read-only** GitLab PAT
(`read_api` scope only, never full `api`). For a one-off run outside the daemon,
`GITLAB_TOKEN` / `LINEAR_API_KEY` env vars still take priority.

The port comes from deck via `PORT` (11005 in `mattstack.deck.json`, used as the fallback
when `PORT` isn't set).

Bot discovery (scanning the store for suspected non-human commenters) is a CLI
subcommand, not a UI page:

```bash
bun src/server/cli.ts --format bots
```

## On GitHub

A team whose code lives on github.com points boxscore at GitHub with one setting, then
gives it a token.

1. Set `mattstack.integrations.forge.provider` to `github`. Leave the forge host empty or
   set it to `github.com`.
2. List the team's repos in `boxscore.projects` as `<owner>/<repo>`.
3. Give boxscore a GitHub token, either way:
   - track one configured repo with rt, and boxscore borrows rt's GitHub token for it:
     `rt daemon track <repo> live branches`
   - or set `GITHUB_TOKEN` in the environment the server runs in. It takes priority.

The GitLab token is never sent to GitHub, and the GitHub token never goes to a GitLab host.

### What each metric reads on GitHub

| Metric             | Source on GitHub                                                                    |
| ------------------ | ----------------------------------------------------------------------------------- |
| Code added/deleted | the PR's additions and deletions, and its files list for excluded paths             |
| PRs merged         | authored PRs merged in the window                                                   |
| PRs reviewed       | other people's PRs with your in-window comment or approval                          |
| Pipelines          | Actions runs you started on each repo                                               |
| Review depth       | review (diff) comments per reviewed PR; issue comments and summaries are not inline |
| Review latency     | first comment by someone other than the author or a bot, minus the PR open          |
| Revert rate        | merged PRs a later `Revert "..."` PR names                                          |
| PR size health     | share of merged PRs in the `boxscore.sizeBand` band                                 |
| Coding days        | distinct days with a commit (author date) on the team's PRs                         |
| Merge streak       | consecutive days with a merged PR                                                   |
| Reciprocity        | reviews given over reviews received                                                 |

GitHub App accounts (`dependabot[bot]`, `github-actions[bot]`) are bots: they get no row and
their comments never count as a review.

### What a refresh costs

Refresh is manual, so per hour is per refresh times the clicks in that hour. GitHub allows
5000 REST requests and 5000 GraphQL points per hour per token.

| Read                     | Requests                                                                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR index, per repo       | 1 per 100 PRs updated since the last scan (usually 1)                                                                                                                                               |
| Per-PR metrics, per repo | 6 to 8 per PR needing detail: 1 GraphQL, 3 REST discussions, 1 files page and 1 GraphQL thread index only when inline comments exist, 1 files page, 1 commits page; more pages past 100 of any list |
| Actions runs, per repo   | 1 per roster user, plus 1 per further 100 runs                                                                                                                                                      |
| Identities, per refresh  | 1 per roster user per day                                                                                                                                                                           |

Not in the table: glance's PR read adds 1 rulesets request per repo and base branch of an
open PR awaiting review, and 1 per further 100 status contexts on a PR's head commit.

The first refresh of a window reads detail for every roster PR in it. A warm refresh reads
detail only for PRs whose `updatedAt` moved past their stored snapshot, whether open,
closed or merged, since GitHub bumps `updatedAt` on every commit, comment, review and label.
With nothing changed, a repo costs 1 index request plus 1 Actions runs request per roster
user per refresh; each PR that changed adds its 6 to 8. Per hour, multiply by the refreshes
in that hour. The per-project id read and the per-user events read do not run on GitHub.

PR detail runs 2 PRs at a time on GitHub (6 on GitLab), about 300 to 600 REST requests a
minute, to stay under GitHub's secondary rate limit. The total is the same; a first refresh
of a large window is slower.

### Limits on GitHub

- **github.com only.** A GitHub Enterprise host answers a setup error naming the host.
- **Coding days are commit author dates on the team's PRs,** not pushes: a commit that never
  reaches a PR in a configured repo does not count.
- **A commit needs a GitHub login to count.** A commit whose author email is not linked to a
  GitHub account has no login, so it adds no coding day.
- **250 commits per PR.** GitHub lists no more, and a PR at the cap adds a warning.
- **1000 Actions runs per person per repo per window.** GitHub stops a filtered run list
  there, and a capped count adds a warning.
- **Commits force-pushed off an open PR stay counted,** because the store never deletes a
  commit it has read.

## Run

```bash
bun run dev:server   # Bun/Hono API server, hot-reloading, on :11005 (or $PORT)
bun run dev          # Vite dev server on :5173, proxying /api and /ws to it
```

Open the Vite URL (`http://localhost:5173`). The page header changes the range, toggles
the trend view and switches table/cards; the topbar's Refresh button forces a refresh ...
all without restarting.

For a production-style run: `bun run build && bun run serve` (the server then serves the
built app straight out of `dist/`).

## Viewer roles

The team's owners (and the org's admins) decide, per member, how much of boxscore that member sees:

| Role          | What the member sees                                                                      |
| ------------- | ----------------------------------------------------------------------------------------- |
| **Team view** | The whole board: leaderboard, every person's page, ranks.                                 |
| **Self view** | Only their own person page, with every rank, leader and team comparison removed. Default. |

- **Self view is the default.** A roster member not listed in `boxscore.roles` gets it, so
  Team view is a grant.
- **An org admin's Mac, and an owner's Mac for the team it is working as, always get Team
  view**, and so does a Mac in no org. The role comes from the org's `mattstack.org` and the
  username this Mac recorded when it joined or created the org; a Mac with no recorded
  username gets the roles setting like a member.
- **An owner of another team is a member here**, so roles apply on their Mac when they work
  as this team.
- **An owner or admin sets roles** in console's Boxscore group, or from boxscore's header gear,
  which frames that same group. A member's Mac shows the control read-only.
- **Locked:** when boxscore cannot identify the viewer (the GitLab user lookup failed, or the
  username is not on the roster), it shows a message instead of any stats, with a link to
  console's Boxscore group.

This is a courtesy boundary, not a security one: each member's boxscore runs on their own Mac
with their own GitLab token and their own store, so a determined member can read the store or
ask GitLab directly.

## How the metrics work (and how they're gamed)

| Metric                  | Source                                                | Gaming vector                                                                           |
| ----------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Code added/deleted, Net | GraphQL `diffStatsSummary` on merged MRs              | verbose code; resisting deletion                                                        |
| MRs merged              | authored + `state: merged` in window                  | artificial micro-PRs                                                                    |
| MRs reviewed            | non-authored MRs with your in-window note or approval | rubber-stamping                                                                         |
| Pipelines               | REST `?username=` per project                         | trivial re-runs                                                                         |
| **Review depth**        | mean inline (DiffNote) comments per reviewed MR       | nitpick-spam (a per-MR mean, never a total; a median collapses to 0 for most reviewers) |
| **Review latency**      | first non-author note minus MR open (p50/p90)         | a hollow "looking 👀" note ... pair with depth                                          |
| **Revert rate**         | merged MRs later reverted (`Revert "…"` / label)      | fix-forward evades detection (labeled "detected only")                                  |
| **MR size health**      | % of merged MRs in the reviewable band                | two-sided band resists both mega- and micro-PRs                                         |
| **Coding-day streak**   | distinct push-active days (events API)                | a daily trivial push ... which is most of the habit anyway                              |
| **Reciprocity**         | reviews given / reviews received                      | spray-reviewing (gate the given side on depth)                                          |
| **Trend**               | this window minus the prior equal window              | almost nothing ... you only beat your past self                                         |

See `gitlab-leaderboard-spec.md` for the exact definitions.

## Notes & limitations

- **GitLab transport is owned by [`@mattstack/glance`](https://github.com/m4ttstack/mattstack/tree/main/packages/glance),**
  not this repo ... GraphQL/REST field names, pagination, and retries live there. If a
  query fails, the error surfaces in the response `warnings`; verify field names against
  `<baseUrl>/-/graphql-explorer` and adjust glance, not boxscore.
- **Approvals tier fallback:** if approval data isn't accessible, "MRs reviewed" and
  "reciprocity" fall back to note-author detection, flagged in the UI metric notes.
- **One store, no cache:** every fetched MR, pipeline, and push event lands in a single
  sqlite database at `~/.mattstack/boxscore/boxscore.sqlite` (override with `BOXSCORE_DB`).
  There is no per-window envelope cache ... a window is a query over the store, computed
  fresh from whatever rows currently satisfy it. That means a roster change (adding or
  hiding a member) is reflected on the very next refresh, with no stale cache to bypass.
  **Refresh** re-scans each configured project from its last watermark and upserts what
  changed; a plain load re-runs the same query against what's already stored, with no
  network call.
- **Merged MRs are re-fetched until their snapshot settles.** Each stored metrics row
  carries the MR's `updatedAt` at fetch time (`mr_metrics.metrics_updated_at`); a refresh
  skips a merged MR only once that stamp covers the index's latest `updatedAt`. If review
  activity (a note, an approval) moved the MR after the snapshot, it is re-fetched. This
  matters because reviews land right before merge: a snapshot taken while the MR was still
  open would otherwise freeze that review out, undercounting MRs reviewed, review depth,
  review latency, reciprocity, and even the diff totals. On GitLab, non-merged rows are
  always re-fetched; on GitHub, any PR whose snapshot covers its `updatedAt` is skipped
  (see "What a refresh costs" under On GitHub).
- **A project removed from `boxscore.projects` earns nothing,** on either forge: its MRs,
  reviews, pipelines and coding days drop out, and so does a Linear ticket's credit through
  one of its MRs, whether attached or only named in the text. Its rows stay in the store,
  so adding it back brings its credit back on the next load. Project paths match ignoring
  case. On GitLab, push events carry a project id, which each refresh records per
  configured project; until every configured project has one, pushes stored before ids
  were recorded still count, so a project removed before that can keep its older coding
  days until they age out of the window.
- **Trend storage** is limited to "current vs. one prior window." No long-run time series.
- **Coding days** only count push events visible to your token.

## Development

| Script                 | What it does                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `bun run dev`          | Start the Vite dev server (`src/app`).                                                                                          |
| `bun run dev:server`   | Start the Bun/Hono API server (`src/server`) with hot reload.                                                                   |
| `bun run build`        | Typecheck then production build (`vite build`) into `dist/`.                                                                    |
| `bun run build:bundle` | Bundle the server to `dist-bin/app` with the built client embedded; `bash scripts/binary-gate.sh` serves it under a fresh HOME. |
| `bun run serve`        | Run the production server against the built `dist/`.                                                                            |
| `bun run report`       | Ranked standings table from the terminal (see below).                                                                           |
| `bun run validate`     | Run the evaluator; exits non-zero on any ranking-integrity error.                                                               |
| `bun run test`         | Vitest: server tests (`test/`) plus component tests (`src/app/**`).                                                             |
| `bun run typecheck`    | `tsc --noEmit` over the whole tree (server, app, shared).                                                                       |
| `bun run lint`         | ESLint over `src`.                                                                                                              |

`scripts/binary-gate.sh` moves `dist/` aside while it runs, so run it from a
worktree, never from a checkout deck serves boxscore from.

The metric layer (`src/server/metrics/`) is pure functions over a normalized model
(`src/server/store/model.ts`), so all the math is tested offline without a live GitLab.

### Headless mode + the evaluator

The whole pipeline (fetch → compute → **classify/rank**) is decoupled from the UI: ranking
and "who's #1" are decided server-side and travel in the JSON (`rank` per metric, `leaders`
map), driven by one source of truth for metric metadata in `src/shared/metrics.ts`. The UI
just renders. You can run and evaluate everything from the terminal:

```bash
bun run report                       # ranked standings table (per-metric leaders)
bun run report -- --range 7d --trend # 7-day window with trend deltas
bun run report -- --format json      # raw response JSON
bun run validate -- --refresh        # run the evaluator; exits non-zero on any integrity error
```

`bun run validate` is the feedback loop: it asserts ranking integrity (rank 1 ⇔ best value,
leaders correct, ties shared, trend consistency) and surfaces data-quality smells (a metric
that's uniform/all-zero across everyone often means it isn't populating). This is how the
bot-polluted review-latency and review-depth calculation bugs were caught and fixed.
