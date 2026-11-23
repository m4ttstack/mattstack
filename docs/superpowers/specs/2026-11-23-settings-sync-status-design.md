# Shared settings sync status in Console

## Why

A change to an org or team setting in Console reaches teammates through the
daemon's team snapshot: it commits the org clone about 20s after the write
(`debounceSec`), pushes, and every other Mac pulls within `pullIntervalSec`
(300s by default). None of that is visible. After changing a shared setting
(the example that prompted this: the claimview review channel), Matt had no
way to tell whether it had left his Mac, short of running git in
`~/.mattstack/orgs/<org>`.

Success: after a save, Console shows the change going from saved to pushed,
and at any time shows whether anything shared is still waiting on this Mac,
with a button to push it now.

## Goals

- A sync pill in the Settings top bar (`SettingsContextBar`) with one of:
  - **Pushed Nm ago** (nothing waiting): "teammates pull within 5 min".
  - **N waiting**: keys changed on this Mac not yet on origin.
  - **Stuck**: a rebase conflict, a push error, a trial branch, or a layout hold.
- The pill opens a popover: the waiting keys (store, key), the last push time,
  the stuck reason with where to fix it, and **Push now**.
- Save follow-up: after saving an org or team key, the row's existing save note
  steps through saved, then pushing, then pushed (or the stuck reason).
- Live: the pill and the follow-up move when the daemon commits or pushes, with
  no polling.
- The CLI sees the same thing (`rt team status`).

## Non-goals

- Per-teammate delivery ("Alice has pulled it"). Reach stops at origin; the
  pill states the pull window instead.
- Personal (user) and machine stores. The home repo snapshot is out of scope.
- Packs. Pack changes publish through `rt skills sync` and the Packs page.
- Resolving conflicts in Console. Stuck links to where it is fixed today.

## Anti-goals

- Console running git or editing the org clone itself.
- A second push path that skips the org-store guard, role ownership or the
  approved-branch check. Push now runs the daemon's own snapshot round.
- A pill that says "pushed" when the push failed or the token stopped working.

## Constraints

- Console reads rt through rt-client in-process and `runRt` for team verbs
  (`src/server/team.ts`); it keeps doing that.
- Daemon events reach Console through the events bus (`events:emit`) and the
  `relay` list in `src/server/index.ts`.
- The design fixture (`CONSOLE_FIXTURE=design`) must draw every pill state,
  and refuses writes, including Push now.
- UI follows `docs/apps/ui-authoring.md` and the kit; the look is mocked in
  pen.dev and built live with Matt, outside the plan's task loop.

## Approaches

- **A. Console works it out.** Console diffs the store files against origin
  and polls `team:snapshot-status`; one new verb for Push now. Least rt work,
  but it lags the daemon and only Console knows what is waiting.
- **B. The daemon reports it (picked).** The snapshot status carries the
  waiting keys, the daemon emits an event on every commit, push or failure,
  and a verb runs a round now. Live, and the same answer in the CLI.
- Console shelling out to git: ruled out by the constraint above.

Matt picked B: the save follow-up only feels right if it moves the moment the
push lands.

## Design

### rt-client: what is waiting

A pure function in rt-client's settings code, next to the store readers:
given a store file's text at origin's tip and in the working tree, it returns
the top-level keys added, changed or removed (parsed JSONC, deep compare per
key). A store file is `mattstack/org/settings.org.jsonc` or a team's
`mattstack/teams/<team>/settings.team.jsonc`; any other managed path that is
waiting (a `.sops.yaml`, the marketplace file, a roles block) is reported by
path, not key.

### Daemon

- `SnapshotStatus` gains `pending`: a list of
  `{ store: "org" | "team:<name>", keys: string[] } | { path: string }`,
  computed at the end of each round and on each watcher wake from the working
  tree plus commits ahead of `@{u}`. Older daemons omit it; readers treat
  absent as unknown, never as nothing waiting.
- A new handler `team:snapshot-run { slug }` calls the instance's `runNow()`
  and waits for its push, returning the round's result. Same refusals as an
  automatic round.
- The team snapshot emits `team-snapshot-updated { slug }` through the events
  bus after a commit, a push, a push or commit failure, and a conflict
  change.

### CLI

- `rt team status --json` carries `pending` and the push fields it already has.
- `rt team push`: runs `team:snapshot-run` for the active org; prints what it
  pushed or why it could not. Plain-language description per
  `.claude/rules/command-tree.md`.

### Console server

- `GET /api/settings/sync`: per org clone, the pill state (pushed, waiting,
  stuck with reason), `lastPushAt`, `pending`, and `pullIntervalSec`.
- `POST /api/settings/sync/push`: runs `rt team push --json`.
- `relay` adds `{ match: t => t === 'team-snapshot-updated', topic: 'settings-sync' }`.
- Fixture scenarios: one per pill state.

### Console UI

- `SyncPill` in `SettingsContextBar`, after the team; hidden for a viewer with
  no org. Popover lists waiting keys as links that open the row
  (`?explain=<key>`), and shows Push now.
- The save note on an org or team row subscribes to `settings-sync` and steps
  saved, pushing, pushed, using `pending`: pushing while its key is in
  `pending`, pushed once it leaves and `lastPushAt` is past the save.
- Rows whose key is in `pending` carry a small "not pushed" mark.

### Push on save (Matt's decision)

A Console save of an org or team key calls the push route right after the
write lands, so it goes out within seconds rather than after the daemon's
~80s debounce-plus-push delay. Saves close together share one round (the
coalescing in `team:snapshot-run`). Writes from the CLI and other tools keep
the normal delay.

## My calls (check these)

- Stuck covers four causes: `conflicted`, `lastPushError`, a trial branch
  (`rt team status`'s `trial`) and `layoutHold`. Each names its fix: the
  `team.sync` or `org.branch` setup row, or "update the app".
- Push now waits for the push and shows its result inline in the popover;
  a refusal (not an owner of that store) reads as the guard's own message.
- The CLI verb is `rt team push`, separate from `rt team publish`, which also
  shares new packs.
- On a trial branch the pill reads "On trial branch <name>" rather than
  Pushed, since teammates on the data branch never see it.

- `pending` looks inside `repos.<identity>`: an entry is
  `{ store, repo?, key }`, so a repo-layer save on a team row gets its
  follow-up and mark too.
- Paths this Mac may never push (`unownedDirty`, a `pullOnly` clone) are not
  in `pending`. The popover lists them under "Can't push from this Mac" with
  the reason, and they never hold the pill on "N waiting".
- `heldBack` paths count as waiting, with "waiting for its pack's share".
- Stuck also covers `lastCommitError`, `lastPullError`, and a `lastPullAt`
  older than twice `pullIntervalSec` ("Can't reach the org repo"), so a dead
  token never reads as Pushed.
- `lastPushAt` survives a daemon restart: the daemon reads it back from the
  push record it already persists. The pill and the save follow-up only ever
  compare against this Mac's own push, never origin's tip time (which can be a
  teammate's commit).
- A fourth pill state, **Unknown** (muted, "Can't read sync status"), covers a
  daemon that is down and an older daemon with no `pending`. It has its own
  fixture scenario.
- `team:snapshot-run` needs a new engine path: `runNow()` only commits and
  schedules the push (`pushDelaySec`, 60s), so the path commits, pulls and
  pushes now, cancels the push and retry timers, and coalesces concurrent
  calls into one round.
- The event uses the events-bus `event` frame (the emit pattern Console's
  relay forwards), not the existing `team:snapshot` broadcasts.

## Left to the builder

- Where the key diff lives in rt-client and its exact name.
- Whether `pending` is computed per round or cached between watcher wakes.
- Pill, popover and mark visuals: settled in pen.dev with Matt.
