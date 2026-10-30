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
- **The board also runs from the bundle, so a board state db schema bump
  needs a dev app rebuild.** Only the served board (port 11006) runs from
  source. `rt cron`'s `board-triage` and `board-peer` triggers, and the
  status writers the board hands launched panes (`review-status`,
  `respond-status`, `doctor-status`, `gate`), run the compiled
  `Contents/Helpers/board` (the daemon resolves `tool: "board"` through
  `deps.lock`). After a deploy that bumps `SCHEMA_VERSION` in
  `apps/board/src/state/db.ts`, that older binary refuses the migrated
  `~/.mattstack/board/state.db` ("newer than this board understands") until
  the dev app is rebuilt from the merged ref.
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
