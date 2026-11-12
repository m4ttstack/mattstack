# The board follows the team's forge (BOARD-59)

Status: draft for review, 2026-11-11. Project: GitHub parity (P-RT-28).

## Why

The board is GitLab-only by construction. Its team settings are a GitLab
host and a list of GitLab project paths, every repo identity it sends the
daemon is built from that host, and its URL parser only understands
GitLab's `/-/merge_requests/N`, so `buildBoard` silently drops any row
whose URL has no `/-/`. A team whose one forge is GitHub gets the setup
page, or an empty board if someone fills in the GitLab keys by hand.

The rest of mattstack now follows each repo's forge: the daemon picks
GitLab or GitHub per repo (RT-540), its thread and review verbs work on
GitHub (RT-541), and project sync on GitHub (RT-542) is being built in a
parallel lane. This change makes the board a forge-neutral reader of the
same daemon stores, so a GitHub team's PRs appear on the board once the
daemon fills them.

## Goals

- A team whose forge is GitHub reaches the board, not the setup page, and
  its PRs show in the same sections as GitLab MRs once the daemon's
  project store holds them.
- GitHub rows carry the right forge link, logo and wording everywhere the
  board names the forge.
- `buildBoard` keeps GitHub rows.
- Review and respond gates on a GitHub PR attach to its row.
- No board code path builds a forge client from a hard-coded forge: every
  GitLab client construction goes through one door that refuses on a
  GitHub team.
- Existing GitLab teams keep working with no settings change.

## Non-goals

- Board writes and identity on GitHub: merge, auto-merge, rebase, retry,
  draft toggle, held doctor notes, "who am I" (BOARD-63).
- Auto-doctor and needs-rebase on GitHub (BOARD-64).
- The re-review latch on GitHub (BOARD-65).
- Codeowner tabs, codeowner posts and the `approval_state` read on GitHub
  (BOARD-66). The console's ask picker (`apps/console/src/server/suggest.ts`)
  stays as it is.
- Filling the daemon's project store for GitHub (RT-542, lane
  `gh-daemon-background`).
- GitHub Enterprise. The forge value is keyed by host so it can be added
  without reshaping this code.

## Anti-goals

- GitLab behaviour must not change: same settings, same identities, same
  URLs parsed the same way, same requests, same error strings for every
  GitLab input.
- No new poll, no interval change and no new forge request from the board.
  The board stays a pure reader of the daemon's project store and threads
  store.
- No GitHub row offers an action that then fails.
- No `state.db` schema change.

## Constraints

- Standing rulings: one forge per team; Octokit and gitbeaker only (this
  change adds no forge client code); GitHub Enterprise later.
- Settings follow the rt:settings contract. This change adds no key; it
  rewords two existing rows.
- New per-MR actions go in the right-click menu, never a card button. This
  change adds none; it only hides some on GitHub rows.
- UI is checked in Fast Browser in both colour schemes against a local
  fixture board, never the live board.
- RT-542's current design leaves two gaps on GitHub that the board must
  tolerate: no codeowner approval rules (rows carry no `codeownerSections`)
  and a null behind count (`behindTarget: null`).

## Approaches

**A. One forge value replaces `gitlabHost` (picked).** `loadConfig`
resolves a single forge value, `{kind: "gitlab" | "github", host}`, and
every `config.gitlabHost` read moves to it. URL parsing takes the forge
and understands both URL shapes. Every GitLab client construction goes
through one `gitlabOnly` accessor that refuses on a GitHub team. The
client hides GitLab-only menu items on GitHub rows. Touches about 25 call
sites, each mechanically.

**B. Reuse `gitlabHost` as the forge host.** Set it to `github.com` for a
GitHub team and widen the URL parser. Smallest diff, but GitLab clients
stay buildable against a GitHub host, which breaks the ticket's
no-hard-coded-forge criterion, and the names mislead BOARD-63 onward.

**C. A full board forge gateway for reads and writes.** One interface
over every board forge call with a GitLab implementation and a GitHub one
over daemon verbs. Ready for BOARD-63, but builds most of BOARD-63's
surface here, against this job's scope.

The shepherd picked A on 2026-11-11.

## Decided

1. The board reads GitHub PRs only from the daemon's stores. No board
   poll, no board-owned GitHub client. Live GitHub rows depend on RT-542
   (shepherd, 2026-11-11).
2. `board.projects` stays the repo list on both forges. On a GitHub team
   the forge and host come from the team's forge connection,
   `mattstack.integrations.forge`. A GitLab team keeps `board.gitlabHost`
   exactly as today: no migration, no new key (Matt, 2026-11-11).
3. On a GitHub row the right-click menu leaves out every action that still
   calls GitLab directly, each server route refuses a GitHub MR with one
   plain sentence as a backstop, and features owned by later tickets skip
   GitHub rows quietly. Thread reply and resolve stay. The PR body lists
   each hidden action and skipped feature with the ticket that turns it
   back on (shepherd, 2026-11-11).
4. Approach A (shepherd, 2026-11-11).

## Design

### 1. The forge value

`apps/board/src/config.ts` gains:

```ts
export type BoardForge = { kind: 'gitlab' | 'github'; host: string };
```

`BoardConfig.gitlabHost` is replaced by `BoardConfig.forge: BoardForge`.

**Resolution in `loadConfig`:**

1. Read `mattstack.integrations` with the same resolver `loadConfig`
   already uses. If its `forge` is present with `provider: "github"`, the
   forge is `{kind: "github", host: "https://" + <normalized host>}`. The
   normalized host strips a scheme, trailing slashes and lowercases.
2. Otherwise, if `board.gitlabHost` is set, the forge is
   `{kind: "gitlab", host: <board.gitlabHost verbatim>}`. Verbatim matters:
   today's `projectPathFromWebUrl` matches the stored string as a prefix,
   and GitLab behaviour must not change.
3. Otherwise the config is incomplete and `parseConfig` throws, exactly as
   a missing `gitlabHost` does today, so `boardConfigured()` is false and
   the setup page answers.

A team forge of GitHub wins over a stray `board.gitlabHost`, since the
team has one forge. A GitLab team has `mattstack.integrations.forge`
absent, null or `provider: "gitlab"`, and takes branch 2, unchanged.

**`parseConfig`** accepts either a `gitlabHost` string or a `forge`
object shaped like the integrations value (`{provider, host}`), and
requires one of them alongside `projects` and `members`. A fixture
`config.json` uses the same fields. Its missing-field message names
`gitlabHost` when neither is present, so today's message is unchanged for
a GitLab config.

**Configured on GitHub** means: the team forge says GitHub, and
`board.projects` and the roster are non-empty.

**Registry wording** (`packages/rt-client/src/settings/registry-defs.ts`,
wording only, no type or scope change, so `schema.lock.json` does not
move):

- `board.gitlabHost`: description says it is the team's GitLab host, for a
  team on GitLab; `defaultNote` becomes "Required on a GitLab team."
- `board.projects`: description says it is the repos the board tracks, as
  paths on the team's forge (`group/project` on GitLab, `owner/repo` on
  GitHub), shared by the whole team.

Both follow rt:ui-copy.

### 2. URL parsing

`projectPathFromWebUrl(webUrl, forge)` replaces the `gitlabHost` argument
with the forge value:

- GitLab: today's logic, byte for byte, against `forge.host`.
- GitHub: the URL must start with `forge.host`; the rest must match
  `<owner>/<repo>/pull/<n>` (with optional trailing path, query or hash),
  and the function returns `<owner>/<repo>`. Anything else returns null.

GitHub repo paths are case-insensitive, so on a GitHub team `buildBoard`
compares the parsed path against `board.projects` case-insensitively, and
returns the `board.projects` spelling as the row's project. GitLab keeps
its exact match.

Every caller passes `config.forge`: `data.ts` (`buildBoard`),
`manifest-bindings.ts`, `run-owner-io.ts`, `peer/launch-ask.ts`,
`bin/triage.ts`, and the server call sites listed in the Agent notes.

`triage/stack.ts`'s `projectKeyOf` also learns the GitHub shape (it keys a
stack by the text before `/-/` today, and a GitHub URL would key as
`.../pull`).

### 3. Repo identity

The identity rule does not change: a repo's rt identity is
`<host>/<path>`, encoded by `repoIdentityField`. Only the host's source
moves to `config.forge.host`:

- `deriveRtRepos(forge.host, projects)`.
- `resolveLaunchRepo`, `codeownerSlackOn`, `boardRepoSlug` (in
  `manifest-bindings.ts`) and `daemonOwnerIo` take `forge.host` (or the
  forge) where they took `gitlabHost`.
- The error "could not derive its rt repo identity from board.gitlabHost"
  becomes forge-neutral wording that still names the setting to fix on
  each forge.

For a GitHub repo the derived identity is `github.com/<owner>/<repo>`,
which is what the daemon derives from a GitHub remote, so the existing
`readProjectMRs`, `readDiscussions` and `forge:file-diff` calls reach the
right store with no change.

### 4. The one GitLab door

A single accessor in `config.ts`, `gitlabOnly(config)`, returns the GitLab
host on a GitLab team and throws a `ForgeNotSupported` refusal on a GitHub
team. Every construction of a GitLab client goes through it:

- the `gitlab()` helper in `server.ts` (`GitLabProvider`),
- the held-draft post's `NoteMutator` (`/drafts`),
- the latch's `latchGateway` and `MRDetailFetcher` (server and
  `bin/triage.ts`),
- `bin/triage.ts`'s identity `GitLabProvider`.

On a GitHub team the board never loads the GitLab token
(`getGitlabToken` resolves null without reading secrets), so a GitLab
token stored on a GitHub team's Mac is never handed to anything.

**What each GitLab-only path does on a GitHub team or row:**

| Path | On GitHub | Turned back on by |
|---|---|---|
| `/mr/action` (merge, rebase, set and cancel auto-merge, retry) | refuses with the one sentence | BOARD-63 |
| `/draft` (mark ready, mark as draft) | refuses | BOARD-63 |
| `/drafts` post (held doctor note) | refuses; dismiss still works | BOARD-63 |
| Roster display names (`fetchUser`) | skipped; roster names show | BOARD-63 |
| Manual doctor launch identity (`validateToken`) | identity resolves null, as on a tokenless board, so the launch proceeds without branch-writing fix classes | BOARD-63 |
| Latch step after a review signal | skipped quietly | BOARD-65 |
| `bin/triage.ts` non-peer pass (auto-doctor, respond ask, latch) | skipped with one info line per run, as a seatless board runs none | BOARD-64, BOARD-65 |
| Codeowner `approval_state` read (`forge:get`) | skipped; rows carry no owner rules | BOARD-66 |

The refusal sentence follows rt:ui-copy. Each route checks the forge
before its token check, so a GitHub team never sees "gitlab token not
configured". The server checks the row's forge (its `provider`, else its
URL) as well as the team forge, so a GitHub row is refused even if one
ever appears on a GitLab board.

Thread reply and resolve (`thread-write.ts`) already go through
`discussions:reply` and `discussions:resolve`, which work on GitHub, and
stay. `forge:file-diff` works on both forges and stays. Peer mode in
`bin/triage.ts` is not forge-specific and keeps running.

### 5. The client

On a GitHub row (`onGitHub` in `mr-ref.ts`, which reads `provider`, then
the URL):

- The right-click menu's forge section leaves out merge, rebase, set and
  cancel auto-merge, mark ready and mark as draft, in both the row menu and
  the bulk menu, and auto-merge never leads the top section. "open in
  github" and "refresh from github" stay, with forge-aware labels; the
  section heading names the forge.
- `DraftModal`'s post control is not offered; dismiss stays.
- Forge words follow the row: `CommentsDrawer`'s "open in gitlab" links,
  `action-runner.ts`'s "refreshing ... from gitlab" toast, and
  `ReviewDraftCard`'s diff link (GitHub's changed-files page is
  `<pr url>/files`, GitLab's stays `<mr url>/diffs`).
- Rows with `behindTarget: null` and no `codeownerSections` render without
  errors and show no behind count.

GitLab rows render exactly as today.

### 6. The setup page

`unconfigured.ts` says what the board lists in forge-neutral words, and
tells a team admin to set `board.projects` on any forge and
`board.gitlabHost` on a GitLab team, with a GitHub team's host coming from
its forge connection. Wording by rt:ui-copy.

### 7. Gates

Gates join rows by MR URL (`mr:` subjects) and by a run's recorded MR
(`gates/run-mr.ts`). Both are string matches on the row's `webUrl`, so a
GitHub row picks up its gates once it is on the board. The review and
respond panes post through MCP tools, which go through the daemon's
forge router, so their posts reach GitHub without board code.
`ReviewGateSheet` already words a GitHub PR as a PR. This change adds
tests that a gate whose subject is a GitHub PR URL attaches to the GitHub
row, and that `run-mr.ts` resolves a run recording a GitHub PR.

### 8. Request volume

Unchanged or lower. The board adds no request. On a GitHub team it makes
none of the GitLab calls it makes today (the hourly roster name lookup,
identity reads, latch reads), and the triage pass's forge reads are
skipped.

## Testing

- **Config:** `loadConfig` and `parseConfig` tests for each resolution
  branch: GitHub team forge, GitLab with `board.gitlabHost` (unchanged
  output), GitHub forge beside a stray `board.gitlabHost`, neither set
  (throws, setup page). `boardConfigured()` true for a GitHub team.
- **URL parsing:** GitHub URLs with and without trailing path, query and
  hash; a GitHub URL on a GitLab team and the reverse return null; every
  existing GitLab case still passes unchanged.
- **`buildBoard`:** keeps GitHub rows, matches project case-insensitively
  on GitHub, still drops rows outside `board.projects`, and handles
  `behindTarget: null` and absent `codeownerSections`.
- **Identity:** `deriveRtRepos` and `daemonRepoField` give
  `remote:github.com%2F<owner>%2F<repo>` on GitHub and the same values as
  today on GitLab.
- **The door:** `gitlabOnly` throws on GitHub; each route in section 4
  refuses a GitHub MR with the sentence before any token check; nothing
  constructs `GitLabProvider`, `NoteMutator` or `MRDetailFetcher` on a
  GitHub team (stubbed constructors that fail the test if called).
- **Triage:** on a GitHub team the non-peer pass runs no forge call and
  logs one line.
- **Client:** row-actions tests that a GitHub row's menu and the bulk menu
  hold none of the hidden items and keep open and refresh with GitHub
  labels; GitLab menus unchanged.
- **Gates:** a GitHub `mr:` subject attaches to its row; `run-mr.ts`
  resolves a run recording a GitHub PR.
- **Fixture:** a second fixture team, `apps/board/tests/fixture-github/`,
  with a GitHub forge in `config.json` and invented GitHub rows in
  `data.json` covering an approved PR, a draft own PR, a PR with an open
  review-post gate, a PR with threads, and a row with `behindTarget: null`.
  The board is rendered from it in Fast Browser in light and dark, and the
  right-click menu on a GitHub row is opened and checked. Everything in it
  is invented (the repo is public and swept by `bun run purity`).
- **Gates before the PR:** the board's suite from `apps/board`, the board's
  type check, `bun run purity` from the worktree root, and
  `bun test packages/rt-client/src/settings/__tests__/<each touched file>`
  from the worktree root.

## Left to the builder

- Exact names: the accessor, the refusal type, the GitHub URL regex.
- Whether the forge-aware client labels come from one helper beside
  `forgeNoun` or inline per site.
- The exact refusal and setup page wording, by rt:ui-copy.
- Whether `getGitlabToken` returns null on GitHub inside its memoized
  loader or at each caller, as long as no secret is read on a GitHub team.
- How the capture baselines treat the new fixture (a new baseline set, or
  Fast Browser screenshots only), following `apps/board/AGENTS.md`.

## Agent notes

Server call sites of `config.gitlabHost` and `projectPathFromWebUrl` on
main at 5f3c4051d (`apps/board/src/server.ts`): 618-623 (`gitlab()`), 637
(`daemonOwnerIo`), 908, 961, 1317-1334 (`approval_state`), 1393, 1899,
1939 (`fetchUser`), 2258-2265 (file diff), 2776-2777, 2986-2987,
3185-3186 (`resolveLaunchRepo`), 3295 (manual doctor identity), 3502-3530
(`/drafts` post, `NoteMutator`), 3532+ (`/draft`), 3578, 3590, 3841-3888
(`/mr/action`), 5590-5672 (latch step: `validateToken`, `MRDetailFetcher`,
`latchGateway`). Elsewhere: `src/data.ts:107-115,198`,
`src/config.ts:49-130,271-277,391,711-760`, `src/latch/gateway.ts`,
`src/manifest-bindings.ts:39-48,109,178`, `src/run-owner-io.ts:23-45`,
`src/peer/launch-ask.ts:24-27`, `src/triage/stack.ts:29`,
`src/triage/projects.ts:35`, `src/file-diff-route.ts:38`,
`bin/triage.ts:170-180,226-229,260,340-390`, `src/unconfigured.ts:26-27`.
Client: `src/client/board/row-actions.ts:600-725` (the `gitlab` section),
`ActionMenu.tsx:28,39,427`, `DraftModal.tsx`, `CommentsDrawer.tsx:105,610`,
`action-runner.ts:256`, `ReviewDraftCard.tsx:288`, `mr-ref.ts:10-13`.

