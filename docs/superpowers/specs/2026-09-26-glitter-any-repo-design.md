# glitter: any repo, no registration

## Problem

`rt glitter` only knows repos rt has registered. You have to launch it inside
one, its repo list shows only registered repos (the daemon's `repos:status`
rows), and launching it registers the repo you are standing in. GitHub
Desktop, the model for glitter, works on any repo you point it at and keeps
every repo's status fresh on its own.

## Goal

- `rt glitter` runs from anywhere and works on any git repo on disk.
- Its repo list shows every repo the `rt cd` scan finds, registered or not.
- Nothing glitter does registers a repo: no repo index row, no data dir, no
  daemon sweep membership.
- Unregistered repos get badges that stay fresh while glitter is open, paced
  the way GitHub Desktop paces its sidebar indicators.
- The daemon's workload does not change.

Out of scope: changing auto-registration in any other rt command, an "add a
folder outside the repo roots" flow, and running glitter with the daemon down.

## Decisions (ratified 2026-09-26)

1. No registration applies to glitter only. Every other rt command keeps
   registering as today.
2. Launch opens the repo you are in; outside a repo, the repo you last had
   open in glitter.
3. The repo list is everything the scan finds, in one list.
4. Glitter computes unregistered repos' status itself, with the git-core
   pieces it already uses for the open repo. The daemon is not asked.
5. Pacing copies GitHub Desktop's `RepositoryIndicatorUpdater`.
6. Glitter fetches unregistered repos in the background, at most once per 30
   minutes each.

## Design

### Launch without registering

`glitter` drops `context: "repo"` in `lib/command-tree-def.ts` (that context
runs `requireRepoIdentity`, which registers). `commands/glitter.ts` resolves
its own start repo:

1. Inside a git repo: `getRepoRoot()` (`lib/git.ts`) plus
   `identityForRootReadOnly()` (`lib/repo.ts`), which already exists for exactly this: identity with no
   index row and no data dir.
2. Otherwise: the last-opened repo from state.db kv (namespace `glitter`, key
   `lastRepo`, value `{ identity, worktree }`), if its worktree still exists.
3. Otherwise (first launch outside a repo, or a stale last repo): the rt-ui
   repo picker over the scanned list, before the board opens. The pick
   resolves through `identityForRootReadOnly()`, never `getRepoIdentity()`.

The driver writes `lastRepo` on launch and on every repo switch.

### The repo list

The list is the union of two sources, keyed by serialized identity so
`repoGroup`, `repoLabel` and `current` in `lib/mission/model.ts` work
unchanged:

- **Registered repos:** `repos:status` rows from the daemon, as today.
- **Unregistered repos:** `getKnownReposCached({ includeMissing: false })`
  rows with `registered === false`. That is the file the daemon's
  `cd-cache-refresh` keeps warm, so reading it asks the daemon for nothing.
  Each row's identity comes from `identityForRootReadOnly(path)`, computed
  once when the list loads and again when the list is re-read.

The repo glitter is standing in joins the list even when the cache predates
it. A scanned repo whose identity matches a `repos:status` row is dropped (the
registered row wins). Unregistered rows carry their scan path, so
`handleRepo` switches to one before its first badge lands instead of refusing
with "no known worktree".

### The indicator updater

A new `lib/mission/indicator-updater.ts`, a port of GitHub Desktop's
`app/src/lib/stores/helpers/repository-indicator-updater.ts`:

- First pass 2 minutes after launch, then every 15 minutes, plus a random skew
  of up to 30 seconds.
- One repo at a time. Skips registered repos (the daemon's sweep owns them)
  and the open repo (glitter already refreshes it live).
- Pauses when the terminal loses focus and resumes where it left off.
- Re-reads the list from the cache at the start of each pass.

Per repo, the updater runs only existing, tested code:

1. `pathExists` on the scan path; a gone repo drops its badge.
2. `createGitClient(path).snapshot()` and `fetchState()` (`packages/git-core`),
   then `toBadge` (`lib/git-badge.ts`). The badge publishes right away.
3. If `fetchState().lastFetchedAt` is null or older than 30 minutes and the
   repo has an `origin`, `client.fetch()` with the sweep's 60-second abort,
   then re-read `snapshot()` for ahead/behind and publish again.

Badges live in driver memory only. A glitter restart starts from no badges for
unregistered repos, the same as GitHub Desktop's first pass.

The updater takes its clock, timers, client factory and focus signal as
dependencies so its tests run on a fake clock.

### Focus events

rt-ui does not report terminal focus today. The mission view turns on
Bubble Tea v2's focus reporting (`FocusMsg` / `BlurMsg`) and sends `focus` and `blur` events up the NDJSON
channel; the driver wires them to the updater's `resume` and `pause`. A
terminal that never reports focus leaves the updater running, which matches
GitHub Desktop with its window focused.

### Registered-only actions

Worktree provisioning and pool rows (`worktree:list`, `worktree:provision`)
stay available for registered repos. For an unregistered repo glitter lists
worktrees from git alone (`listGitWorktrees`, already merged in
`mergeWorktreeTrees`) and hides the provision action.

## Testing

- **Updater unit tests** on a fake clock: the 2-minute delay, the 15-minute
  cadence, one repo in flight at a time, skipping registered and open repos,
  pause and resume mid-pass, the 30-minute fetch gate, and a vanished path.
- **Driver and model tests:** the merged list (dedupe, registered wins, the
  current repo always present), switching to an unregistered repo before its
  first badge, and `lastRepo` read and write.
- **No-registration guard:** a test that launches the glitter command path in
  a temp repo under an isolated HOME and asserts the repo index has no row and
  no data dir was created.
- **pty gate** (`e2e/pty/`): launch glitter in an unregistered temp repo and
  see the board paint with that repo current.

## Acceptance

- `rt glitter` in an unregistered repo opens on it and leaves the repo index
  unchanged.
- `rt glitter` outside any repo reopens the last repo, or shows the picker the
  first time.
- The repo list shows every repo `rt cd` would, and unregistered ones gain
  badges within one pass.
- With glitter unfocused, no git process runs for unregistered repos.
- The daemon's request log shows no new request kinds from glitter.
