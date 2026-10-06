# rt dev setup: build mattstack from your own clone

Date: 2026-10-06. Branch: `rt-301-dev-setup`. Ticket: RT-301. Status: design
approved in brainstorming.

## Problem

Running mattstack-dev.app (daemon, CLI and served apps from a source checkout)
has only ever been set up on the maintainer's Mac, by hand: clone, install bun
and Go, build the dev app with Xcode, point rt at the checkout, register each
app with deck. A collaborator on prod mattstack.app has no supported way in.

The ticket's first idea, a dev app whose first launch clones the sources,
cannot work as written: on a Mac with no checkout the dev app refuses to take
over (`FlavorLaunch.devTakeoverRoute` returns `.unavailable`, and
`AppDelegate` answers `devTakeoverUnavailable`), because its
`Contents/MacOS/rt` is a shim that runs source through bun. The bootstrap has
to happen before the dev app opens, from prod's compiled rt.

## Goal

A collaborator on prod runs one command and ends up on mattstack-dev, with
the daemon, CLI and every served app running from their own clone of
`m4ttstack/mattstack`, ready to push branches and open PRs. A second command
keeps that setup current. No Swift changes.

## Decisions

| Decision | Ruling |
|---|---|
| Surface | CLI only: `rt dev setup` and `rt dev update`. No tray or Swift work in this change. |
| Contribution model | Collaborators with write access to `m4ttstack/mattstack` clone it directly (no forks), so their repo identity matches the maintainer's and identity-keyed code (the dev tray's Rebuild from menu, worktrees, sync) works unchanged. |
| Where the dev app comes from | A signed, notarized `mattstack-dev-<version>.zip` attached to each release. |
| Who builds it | The maintainer's Mac, as a step of the `rt:release` flow after CI publishes. GitHub Actions does not build it; no VM run. |
| Tools | A real git, bun and Go on the machine (node optional), never the binaries inside prod's bundle. Versions come from the clone's own pins. |
| Rebuild without the signing cert | `build-dev-app.ts` refuses before doing anything and says why. Hiding the tray menu is a follow-up once Swift work resumes. |
| Scope | rt, the served apps and skills. Tray and shim changes still need the maintainer's cert and stay out of the guided path. |

## `rt dev setup`

A new top-level `dev` branch in `lib/command-tree-def.ts`, description "Set
this Mac up to build mattstack from your own clone". Run from prod's compiled
rt at a terminal; `--json` for programs. Not `agentSafe`: it installs software
and replaces an app, so it never reaches the `rt_verb` MCP tool (a test pins
this).

Each stage is one rt-ui step row (`openStep`), checks whether it is already
done before acting, and records nothing a later stage cannot re-derive, so a
second run resumes where the first stopped.

1. **Tools.** Check the tool table (below) and offer to install anything
   missing or too old.
2. **Access.** Through the `gh` rt bundles, check that the person's GitHub
   login can push to `m4ttstack/mattstack` (`permissions.push` on the repo).
   Not logged in is a refusal with `gh auth login` as `next` (that login also
   gives git its credentials for pushing). Logged in without push access is a
   refusal: "Ask the mattstack maintainers to add you as a collaborator".
   Both happen before anything is cloned.
3. **Clone.** Into `<repo root>/mattstack`, the repo root the machine already
   chose (`lib/setup/repo-root.ts`). A folder that is already a clone of
   `m4ttstack/mattstack` is reused untouched (no checkout, pull or reset); an
   empty folder is cloned into; a folder holding anything else is a refusal
   that names the folder. The repo root can be anywhere (`~/code`, `~/src`),
   so `resolveSharedCheckout` (`lib/release/shared-checkout.ts`), which
   `update-machine` and the skills verbs use to find the checkout, prefers the
   stored source path (step 5) when it holds a `cli.ts`, and falls back to its
   fixed candidates otherwise. On the maintainer's Mac the stored path already
   is the shared checkout, so nothing changes there.
4. **Build.** `bun install` in the clone (its `postinstall` builds glance,
   rt-client, settings-kit and tui-kit), then `bun run ui:build`, since in dev
   mode `resolveRtUi` reads `ui/dist/rt-ui` from the checkout and the dev
   bundle carries no copy.
5. **Point rt at it.** Store the checkout and the absolute bun path through
   the same code as `rt settings source-path` (`saveSourcePath`,
   `bunPathForStorage`). Only after step 4 succeeds, so a broken clone never
   becomes what dev mode runs.
6. **Dev app.** Download the dev zip (see "Choosing the dev zip"), verify it
   against the release's `SHA256SUMS`, unzip into a scratch directory and move
   it to `/Applications/mattstack-dev.app`.
7. **Switch.** Open the dev app. Opened by hand, it takes the Mac over
   through the existing `rt flavor takeover` path; `~/.local/bin/rt` becomes
   the dev wrapper.
8. **Serve from source.** Wait for the dev daemon to answer, then
   `deck register --dir <clone>/apps/<app>` for each of `REGISTERED_APPS`
   (board, console, chat, boxscore, deck), the list `update-machine` already
   uses.

The run ends with a summary and a `next` callout: open mattstack.app to
switch back at any time. The summary also says once that the tray's Rebuild
menu is for tray changes and needs the maintainer's signing certificate.

Run from dev mode, `setup` reports that this Mac is already set up and points
at `rt dev update`.

## `rt dev update`

Run from dev mode; from prod it refuses with `rt dev setup` as `next`.

- **Tools:** re-check against the clone's current pins and offer to install
  what is now missing or too old.
- **rt-ui:** rebuild when `ui/dist/rt-ui` is missing or older than the newest
  file under `ui/`.
- **Dev app:** when a release newer than the installed dev app has a dev zip,
  quit the dev app, swap in the new one and relaunch it. The quit, swap and
  relaunch reuse the dev-bundle leg of `lib/release/update-machine.ts`, with a
  download in place of the build.
- **The checkout is theirs:** no pull, rebase or branch change.

## The tool table

One table in code, the only place a tool is added:

| Tool | Need | Version source | Check | Install |
|---|---|---|---|---|
| git | required | any | `git --version` | Command Line Tools (the existing `apple-clt` route) |
| bun | required | `packageManager` in the clone's `package.json` | `bun --version` | bun's official installer, pinned to that version |
| Go | required | the `go` line in `ui/go.mod` | `go version` | Homebrew `go` |
| node | warning | `>= 20` | `node --version` | Homebrew `node` |

- **Versions come from the clone.** A pin bump on `main` reaches every
  collaborator at their next `rt dev update` with no rt release. Before the
  clone exists, `setup` reads the two files from `main` on GitHub (the repo is
  public).
- **Too old counts as missing** for bun and Go; for node it is a warning.
- **Installs go through a new `installDevTool`** in
  `lib/setup/tools-install.ts`, beside `installTool` and sharing its vendor
  and Homebrew runners, but never its bundled-link path: `installTool` links
  the app's own bun when one is bundled, which is exactly what dev mode must
  not run on. `rt tools install` keeps its behavior; `VENDOR_INSTALLERS` and
  `BREW_FORMULAE` are unchanged. bun's installer runs from `bun.sh` (added to
  `VENDOR_ALLOWED_HOSTS`) under `bash` with an rt-owned `bun-v<version>`
  argument; Go and node install with `brew install`. With no Homebrew, it
  refuses with the official download page.
- **Consent:** at a terminal `setup` and `update` ask before installing.
  Under `--json` or `RT_BATCH` they never install: they refuse with the
  install command as `next`.
- **Prompts never share the terminal with a running step.** A stage that has
  to ask (an install, a GitHub login) clears its rt-ui step, asks, and
  reopens the step, per the rt-ui bridge's rule that nothing paints while a
  prompt owns the tty.
- bun is the official installer's `~/.bun/bin/bun`, which is also the dev
  daemon shim's default.

## The dev app in each release

CI is unchanged: `release.yml` builds, notarizes and publishes prod only.

A new step in the `rt:release` flow, on the maintainer's Mac after CI has
published the release:

1. Build the dev app at the tag in a scratch tree. This is the build the
   dev-bundle leg of `update-machine` already runs, so one build is both
   installed on the maintainer's Mac and uploaded.
2. `build.sh dev` sets a new Info.plist key, `MSDevReleaseBuild = true`, when
   the build is for a release (an environment variable the step passes).
3. Notarize and staple it with `scripts/release/notarize.sh` through its
   `NOTARY_PROFILE` path. A Mac with no saved profile needs a one-time
   `xcrun notarytool store-credentials`. `update-machine` checks for the
   profile before any leg runs: with none, the publish leg is skipped with
   that command in its detail and every other leg still runs. A publish that
   fails later is reported but does not halt the legs after it, since nothing
   on the Mac depends on it.
4. Zip it as `mattstack-dev-<version>.zip`, attach it with
   `gh release upload`, and append its line to the release's `SHA256SUMS`
   (download, append, re-upload with `--clobber`).

No dmg and no appcast entry: the dev app has no Sparkle feed.

### Choosing the dev zip

`setup` and `update` take the newest release that has a dev zip. When that is
not the running prod version (the upload is still pending, or a release
skipped it), they say which version they used. No release with a dev zip is
a refusal that says so.

### Telling a collaborator an update exists

`rt setup update` already runs at every app launch. In dev mode, when the
installed dev app carries `MSDevReleaseBuild` and a newer release has a dev
zip, it raises a notification whose fix is `rt dev update`. A dev app built
locally without the key never sees it.

## Rebuild without the signing cert

The dev tray's Rebuild and Rebuild from items run
`bun scripts/build-dev-app.ts --local --yes` in the chosen tree. Without a
Developer ID identity that build signs ad hoc and replaces the notarized dev
app, so Gatekeeper prompts and macOS permissions reset on every rebuild.

- `build-dev-app.ts` checks for a `Developer ID Application` identity
  (`security find-identity -v -p codesigning`, the check `build.sh` already
  makes) before anything else, and with none exits non-zero having changed
  nothing.
- The tray then shows its usual failed state ("Rebuild (<tree>), last try
  failed" and the red build-failed pill). The reason reaches the person as a
  macOS notification through rt's notifier: "Rebuilding the dev app needs
  the maintainers' signing certificate. You only need it for tray changes: your rt, app
  and skill changes already run from your clone." The same words go to
  `dev-app-build.log`. `notify()` in `lib/notifier.ts` already works from any
  process (durable queue, tray socket, osascript fallback), so no daemon verb
  is needed.
- Follow-ups for when Swift work resumes: hide both items when no identity is
  present, and have Rebuild use the stored bun path instead of the hardcoded
  `~/.bun/bin/bun` (`DevBuildWatcher.swift`).

## Failures

- A stage that cannot finish throws `UserActionableError`: a short plain
  sentence, the command to run as `next`, and raw child output (installers,
  clone, `bun install`) as `log`. The last lines of a child's output show
  under the failure block; all of it goes to the CLI log through
  `withoutUrls`.
- Prerequisites are checked before anything changes: tools, push access and
  the existence of a dev zip (found and checked against `SHA256SUMS` before
  the clone, then installed in step 6). A setup that is going to fail does so
  before the clone.
- Before step 7, prod still owns the Mac and a re-run resumes. If the dev app
  opens but its takeover fails, the existing takeover rules decide which app
  serves; `setup` reports the error with opening mattstack.app as the way
  back.
- A refusal by policy (no push access, an unrelated folder at the clone path,
  `update` from prod) is a `refused` note, not a failure.

## Testing

- Unit tests over injectable seams, the pattern of `update-machine` and
  `tools-install`: the tool table (pin parsing, too old, missing, the refusal
  under `--json` and `RT_BATCH`), the clone decisions (empty, our clone,
  something else), choosing the dev zip (this version, an older one, none),
  the push-access check, and resume after each stage.
- `--json` envelopes pinned as snapshots, in the manner of
  `commands/__tests__/setup-copy.test.ts`, plus a guard that neither verb is
  `agentSafe`.
- The cert check in `build-dev-app.ts`: a seam test with no identity proves it
  exits before any build or swap.
- `rt-release` skill: the new step and its preflight, edited through the
  writing-skills process.
- One real run under an isolated HOME, which stops at its first refusal (no
  repo root, a missing tool or no network) and proves that refusal reads
  plainly and changes nothing outside that HOME. Getting further needs real
  tools, a GitHub login and push access, so the first full run is the first
  collaborator's Mac. No VM.

## Out of scope

- Any Swift change, including hiding the Rebuild menu.
- Forks and contributors without write access.
- Tray or rt-ui changes through the guided path.
- Building the dev app in GitHub Actions.
