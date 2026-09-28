# Deck "new code" redeploy pill

Date: 2026-09-28
Status: approved

## Problem

In mattstack-dev.app, deck runs the mattstack apps (board, console, chat,
boxscore, and deck itself) from the shared source checkout, and each row has a
`deploy` button that rebuilds and restarts the app. Nothing tells Matt when the
checkout has moved past what an app is running, so he guesses when to press it.

Flock solves the same problem with a build stamp baked into its bundle and a
"New build · Restart" pill that appears when the stamp on disk differs from the
one the process launched with. Deck has no build artifact to stamp, so the
equivalent signal is git: the commit an app was last deployed from, against the
checkout's current HEAD, restricted to the paths that app is built from.

## Scope

Dev mode only. Every piece of this feature (git calls, record writes, the
status field, the pill) is gated on `isDevMode()` (`src/api/dev-mode.ts`, the
bundle's `MSDevBuild`). A production deck, or a deck outside a bundle, never
runs git for this, never writes `lastDeploy`, and never emits `newCode`.

Only mattstack-owned rows (`managedBy` `rt` or `deck`) whose dev link resolves
`linked` take part. User apps never do.

Out of scope for this iteration: uncommitted edits (Flock's `+dirty`),
per-app precise workspace dependency paths, and auto-deploy.

## Design

### Record: `lastDeploy`

`AppRecord` gains an optional `lastDeploy?: { sha: string; at: string }`
(full sha, ISO time). It is written in three places, all dev-mode only:

1. **Deploy start.** When `POST /api/v1/apps/:name/commands/deploy` starts a
   run through the manifest branch, deck stamps HEAD of the linked checkout
   before returning. Stamping at start, not finish, records the code the build
   reads; if HEAD moves during the run, the pill correctly reappears. A failed
   deploy keeps the stamp (the pill is about "is there newer code", not
   "did the last deploy succeed"; the run's exit status already shows the
   latter). `build` and any other command never stamp.
2. **Deck's own boot.** When deck boots with `runMode: source`, it stamps its
   own record with the checkout's HEAD, since that is the code the process
   loaded. A `pinned` or `standalone` deck does not stamp itself.
3. **Baseline.** When the status check meets an eligible row with no
   `lastDeploy`, it writes the current HEAD and reports no new code. Deck
   cannot know what an app loaded before this feature existed, so the first
   observation starts clean, matching Flock's "no stamp, no offer".

### Detection: `newCodeFor(record)`

A new module, `src/registry/new-code.ts`:

- Resolves the checkout root with `git rev-parse --show-toplevel` in the dev
  link's directory, and `appDir` as that directory relative to the root (so
  both the `mattstack` and older `repo-tools` folder names work).
- Reads HEAD, and if it differs from `lastDeploy.sha`, runs
  `git diff --quiet <lastDeploy.sha> HEAD -- <appDir> packages/ bun.lock`.
  Exit 1 means new code, exit 0 means none, anything else is an error.
- Caches the answer per (app, lastDeploy.sha, HEAD), so the board's 5s poll
  only runs `git diff` when HEAD or the stamp actually moves. Reading HEAD
  itself is one cheap `git rev-parse` per eligible row per poll.
- On any git failure (sha no longer present, not a repo, a checkout removed
  mid-check) or a baseline that cannot be written, reports no new code and
  logs one `warn` per app and failure through deck's logger. It never throws
  into `buildStatus`. A deploy stamp that cannot be written warns the same way
  and never fails the run it belongs to.

Returns `{ deployed: string; head: string } | null` (short shas).

### Status: `StatusRow.newCode`

`buildStatus` (`src/api/status.ts`) sets `newCode` on eligible rows when
`opts.devMode` is true, from `newCodeFor`. The field is absent otherwise, the
same way `devLink` is.

### Board: the pill

In `CommandsCell` (`core/board/AppsTable.tsx`), when `row.newCode` is set, the
`deploy` button renders as a solid amber pill (tui-kit `Button` with
`intent="warn" variant="filled"`) labelled "Redeploy", with the tooltip "New
code since last deploy: `<deployed>` to `<head>`". Its accessible name is
"Redeploy `<app>`", so it contains the visible label. Pressing it runs the
same `onRunCommand(name, 'deploy')` as the plain button. Colours come from the
kit's warn intent per `docs/apps/ui-authoring.md`, never a raw hex. The
kit's `filled|warn` cell is recorded contrast debt (white on orange, 3.3:1 in
light, 3.0:1 in dark), which Matt accepted for this pill. The drawer's
`SourceScreen` has no command buttons (it lists command names as a fact), so
the pill lives in the table only. `newCode` is emitted only to local callers
(`opts.local`), like `devDir`.

The pill clears on the first poll after the deploy starts, because the stamp
moved to HEAD. `core/generated/board.{js,css}` is regenerated in the same
commit as the board source.

## Testing

- `new-code.test.ts` against a temp git repo with an `apps/x` and `packages/y`
  layout: a commit under `apps/x` reports new code; a commit under
  `packages/` reports new code; a commit touching only another path reports
  none; no stamp baselines and reports none; an unknown sha reports none and
  warns once.
- Command route: `deploy` in dev mode stamps HEAD; `build` does not; a
  production deck stamps nothing and runs no git.
- `buildStatus`: `newCode` absent in production and on user rows.
- Deck self: source boot stamps; pinned and standalone do not.
- Board: a logic/render test that `newCode` swaps the deploy button for the
  pill; `bun run build:board` regenerated.
- UI validation: render the dev board in Fast Browser with a row that has new
  code, screenshot light and dark, and report what reads wrong.
