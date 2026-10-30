---
paths:
  - "rt-tray/**"
  - "apps/deck/**"
  - "apps/board/**"
  - "apps/console/**"
  - "apps/chat/**"
  - "apps/boxscore/**"
  - "apps/*/mattstack.deck.json"
  - "lib/release/update-machine.ts"
---

# The running dev app

## Getting a change into the running dev app

The dev app (`/Applications/mattstack-dev.app`) takes code from three places.

- **Served apps (board, console, chat, boxscore) and deck run from
  source** in the shared `~/Documents/GitHub/mattstack` checkout (or the older
  `~/Documents/GitHub/repo-tools` folder on a machine that has not moved it). To deploy:
  merge, check `git branch --show-current` is `main`, pull, then
  `deck cmd <app> deploy` (`deck cmd deck deploy`, or the deck row's deploy
  button, for deck itself). That runs the manifest's `dev.deploy`, which
  builds and then restarts; `deck restart <app>` alone restarts the server
  and keeps the old browser bundle.
  `rt release update-machine` also re-registers and restarts them, as its
  `checkout-sync` (labelled "shared checkout sync") and served-suite legs
  (`REGISTERED_APPS` in `lib/release/update-machine.ts` is exactly this
  list plus deck). Deck runs through the dev shim (`rt-tray/Sources-deck-shim`),
  which falls back to `Contents/Helpers/deck-pinned` when source cannot
  run; `api.json`'s `runMode` says which is serving. A pin older than
  `runMode` (deck 1.0.6 today) reads as `standalone`; the last
  `deck-dev-shim:` line in `~/.mattstack/deck/logs/deck.err.log` says
  whether the shim fell back. gitq is not in that re-register list: the
  app bundle carries it only as the `Contents/Helpers/gitq` CLI, built by
  `scripts/build-apps.ts` from `apps/gitq/mattstack.deck.json`'s
  `bundle.build` recipe, and deck never serves it (root `AGENTS.md`,
  "Monorepo layout"), so its changes ship at the next release.
- **Manifest keys in `mattstack.deck.json` are read only at register or
  adopt.** After a manifest change, run `deck register --dir <absolute path>`.
- **Tray and shim changes need a dev app rebuild**: in a scratch tree at the
  target commit, `scripts/fetch-deps.sh arm64`, then `bun install
  --frozen-lockfile` (`build-apps` runs turbo over `packages/*` and needs
  `node_modules` in the scratch tree), then `bun scripts/build-apps.ts`,
  then `rt-tray/build.sh dev`, never in the shared checkout's `rt-tray/`.
  Then replace
  `/Applications/mattstack-dev.app` by moving the old one aside, the way the
  dev-bundle leg of the `rt:release` skill does. A collaborator's dev app
  comes from the release (`rt dev setup`, `rt dev update`); the `dev-publish`
  leg of `rt release update-machine` attaches it on the maintainer's Mac.

## Test drive setup

The dev app (and any DEBUG build) has **Test drive setup…** in the menu bar
menu: the real setup window running on the stub rt
(`rt-tray/Tests/stub-rt/stub.ts` under bun), so the screens can be walked on
this Mac without changing it. The picker offers scenarios (join, create,
Just me, restore, a run that pauses, slow installs; `TestDriveScenario` maps
each to an `RT_STUB_SCENARIO`) and a speed, Instant or Realistic. Each drive
gets its own throwaway HOME and stub state dir under the temp folder, an app
socket that points nowhere, and fakes for every native effect (a settings
pane, a macOS prompt, an admin password, a browser tab), which show as
toasts on the drive's banner instead. **Reset** ends the drive, retires its
rt so nothing pending reaches the stub, and deletes its folder; quitting the
app does the same. The stub comes from the tree the dev app was last built
from, then the checkout its rt wrapper runs (`DevSourceConfigReader`); bun
from `RT_STUB_BUN`, that config, or the usual install paths. A stub that
does not know `stub grant --probe` is too old for the app, one that fails it
any other way won't run, and the picker says which. A new setup verb or screen needs a stub answer too, or the drive
stops on it.
