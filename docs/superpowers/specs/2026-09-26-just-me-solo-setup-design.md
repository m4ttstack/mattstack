# Just me: a solo setup path that installs without a team or a git remote

Status: design, ratified with Matt on 2026-09-26 (RT-328). Slices 1 and 2 of
the ticket; the opt-in install list (slice 3) stays direction only.

## Goal

A person who wants rt and its integrations (flock today) installs
mattstack.app, picks **Just me** on the Team screen, and reaches a green
`rt verify` with no team, no forge token, no `gh` login and no git remote.
The window shows only the apps that work without a team. Later, Settings
offers Create a team and Join a team, and either one upgrades the install in
place without a reinstall.

## Rulings (2026-09-26)

These were ratified in forms and are not open:

1. **Suite-only install stands** (MAT-379 r.1). Everything installs as
   today. *Mode* decides what is live: solo idles and hides the apps that
   need a team, team enables everything. No component checkboxes at install.
2. **Deck owns the per-app on/off.** A per-app `enabled` on the deck record,
   with a mode-derived default and a user override. Not a tray-only hide.
3. **Fast Browser is optional on solo, required on team.** Extends the
   2026-09-02 ruling that made it optional until Chrome exists.
4. **Slices 1 and 2 ship together**: the Just me card, the plan and validator
   branching, the app set, and upgrade in place. Slice 3 (an opt-in install
   list reachable from Settings) is not designed here.
5. **An app declares `requiresTeam` in its `mattstack.deck.json`.** Deck
   parses it in both flavors; rt reads it over deck's API.
6. **Disabled apps are hidden in the window and idle in the checklist.**
   The checklist keeps "unused services show as idle, not absent".
7. **Spec now, execute after monorepo Stage C merges** (gitq into
   `apps/gitq`), so the deck registry and deps.lock work never fights the
   monorepo branch.

## What "solo" is

Solo is not a stored flag. While setup is in flight, the intent file carries
`mode: "solo"` so a resumed `rt setup` and the tray agree on what the user
chose. After Install the intent is cleared and solo is derived: no team
directory under `~/.mattstack/teams/`, so `resolveTeam` yields
`TeamRef { slug: "", name: "", mode: "none" }`. That is the same shape the
plan already produces for a machine with no team; the change is that the
validators now treat it as a supported mode instead of a half-configured
one. Nothing can go stale because nothing is written down.

`SetupIntent.mode` gains `"solo"`. `teamRefFromIntent` maps it to the empty
`none` ref. `homeRepo` stays optional on the intent; Just me never sets it.

## Team screen

`TeamChoiceModel` gains a fourth `choice`, `.solo`, rendered as a card
titled **Just me** with the copy "rt, the daemon and Claude Code on this
Mac. No team repo, no forge account. You can create or join a team later
from Settings." `canContinue` is true for `.solo` with no fields.
`validateAndPrepare` for `.solo` runs only `homeInitCheck()` (the home repo
is initialised locally; a remote is never asked for, and `home.backup`
already reads local-only as supported) and writes the solo intent.

The tray's `SetupResume` and the `--step` argument are unchanged.

## Plan and validators on solo

`composePlan` branches on `team.mode === "none" && team.slug === ""` (a
helper `isSolo(team)` in `contract.ts`, used by every validator below so the
condition is spelled once).

| Group | Solo behaviour |
| --- | --- |
| mac | unchanged |
| accounts | the forge account row is present with `required: false` and `optionalNote: "Works without this. Connect a GitHub or GitLab account later to open PRs and MRs from rt."`; `account.switchboard` and `account.slack-app` absent; pack-declared integrations absent (there is no pack) |
| access | empty: no `access.team-repo`, no `access.forge`, no `access.switchboard` |
| tools | `tool.fast-browser` and `tool.fast-browser-extension` become `required: false` with the existing "works without this" note; `team.marketplace` and `team.sync` absent; `tool.plugins` installs the `mattstack:*` marketplace, which is already what a team of one gets; `repos.root` stays required; every rt-health row unchanged |

Steps whose `applies()` is false on solo report a skip with the detail
`no team (Just me)`: `team.create` and `team.join`. Every other step stays,
including `home.init` (local), `plugins.install`, `deck.managed`,
`services.*`, `claude.permissions`, `herdr.integration`, `snapshot.push`
(the home snapshot commits locally and the daemon handler already treats a
missing remote as nothing to push) and `verify`. `fastbrowser.setup`
runs only when Fast Browser is present, as it does today.

`finalizePlan` needs no change: with no required rows missing, `canInstall`
is true and the Finish gate holds on the same rows as before (writing style
is still finish-gated and not waivable, so a solo machine must still resolve
a style; the default preset ships in the plugin, so it resolves).

`rt setup status` on a solo install shows no team rows and no team faults.

## App set, owned by deck

**Manifest.** `mattstack.deck.json` accepts `requiresTeam: boolean`.
`readDeckManifest` whitelists it (a non-boolean is a parse error, like
`includeInBundle`). Board and boxscore declare `true`. Console, chat and
deck do not.

**Record.** `AppRecord` gains `requiresTeam?: boolean` and
`enabled?: boolean`; absent `enabled` means true, so every existing registry
reads as enabled. `ingestManifest` (dev, from the checkout) and
`readBundledIdentity` (prod, from `Contents/Resources/apps/<name>/`) both
carry `requiresTeam` onto the record the way `badge` travels today.

**Serving.** A disabled service is not started at boot, not started by the
sweep, and is stopped when its record flips to disabled. `/api/apps` (the
launcher catalog the tray window reads) omits disabled apps. `/api/v1/apps`
(the admin list) includes them with `enabled` and `requiresTeam` visible.
`PATCH /api/v1/apps/<name>` accepts `{ enabled: boolean }` for
mattstack-owned rows; user apps are out of scope.

**Default.** rt's `deck.managed` step, which already reaches deck's API,
applies the mode default: on solo, every app with `requiresTeam: true` is
PATCHed to `enabled: false`; on a team install, every app is PATCHed to
`enabled: true`. The step applies the default at Install and again during
an upgrade (below), and nowhere else, so a user's manual flip in Settings is
never overwritten by a later `rt setup` run or a daemon restart.

**Flavors.** The deck-app-set-by-flavor rule stands: prod serves the
bundle's explicit list, dev serves the machine's registrations. `enabled`
narrows either set; it never adds to it.

## Tray

**Settings > Apps** is a new pane: one row per mattstack-owned app from
`/api/v1/apps`, with the display name, description and a toggle bound to
the PATCH. Rows for `requiresTeam` apps on a solo install carry the caption
"Needs a team. Create or join one under Team to use this." and stay
toggleable (a user who wants to look at board anyway may). Deck itself has
no toggle.

**The window** lists `/api/apps` as today, so a disabled app has no tab.
Deck's tab stays.

**Checklist and Setup status** show a disabled app's service row as idle
(the existing skipped glyph), never absent.

## Upgrade in place

`rt team status --json` gains `{ "mode": "solo" }` when no team is known
(today the fields are simply null). `TeamSettingsModel` reads it.

On a solo install, **Settings > Team** replaces the invite UI with two
buttons, **Create a team** and **Join a team**. Both open the setup window
at the Team screen through the existing `showSetup(step: .team, joinCode:)`
entry point (the join-link path already uses it). In that entry the Team
screen hides Just me and Restore, and Back is disabled on the Team screen.
From there the flow is the normal one: Continue runs `rt team create` or
the join dry-run, the checklist recomposes with the team rows (access
group, required forge account, team marketplace, Fast Browser required
again), Install runs only the steps whose `applies()` is now true
(`team.create` or `team.join`, `secrets.write` for the forge token,
`plugins.install` for the team marketplace, `deck.managed` re-applying the
default so board and boxscore come on), then Done.

`SetupFlowModel` needs one new input, `entry: .firstRun | .upgrade`, that
the Team screen and the window-close rule read. Nothing about Install's
step runner changes: it already skips steps that do not apply.

## Testing

- Plan snapshots in `lib/setup/__tests__/`: a solo plan (no access rows,
  forge account optional, Fast Browser optional, no team rows) plus the
  existing create, join and restore snapshots byte-identical to today.
- Step tests: `applies()` false and the skip detail for `team.create` and
  `team.join` on solo; `deck.managed` PATCHes exactly the
  `requiresTeam` apps on solo and every app on team, and never PATCHes on a
  status run.
- Deck: `readDeckManifest` accepts and rejects `requiresTeam`; a record
  with `enabled: false` is absent from `/api/apps`, present in
  `/api/v1/apps`, not started at boot, stopped on flip; the PATCH refuses a
  user app; the byte-compared deps.lock fixture is unchanged.
- Tray XCTest: `TeamChoiceModel.canContinue` for `.solo`; the upgrade entry
  hides Just me and Restore; `TeamSettingsModel` reads `mode: "solo"`.
- Screenshots, light and dark, from the dev app: Team screen with the four
  cards, Done, Settings > Apps, Settings > Team on a solo install.
- Clean room: one VM run of Just me with no `gh` login and no forge token
  ends in a green `rt verify`, `rt setup status` with no team faults, and a
  window showing console and chat only. A second run upgrades that VM with
  Create a team and ends with board served.

## Order

1. Deck: manifest field, record fields, serving rules, routes. Lands after
   monorepo Stage C merges (ruling 7).
2. rt: intent, `isSolo`, validators, steps, `deck.managed` default,
   `rt team status` mode. Can start on a branch now; its PR merges after 1.
3. Tray: Team screen card, Settings > Apps, Settings > Team upgrade entry,
   `SetupFlowModel.entry`. After 2.
4. Screenshots and the two VM runs. After 3, before the release that
   carries this.

Each is its own PR with the monorepo's usual gates.

## Not in this spec

- The opt-in install list (slice 3). It would reopen ruling 1 and is
  recorded on RT-328 as direction only.
- Changing what the bundle installs or exposes on PATH.
- gitq, which stays Matt's machine only for the web app (RT-281).
- User-added deck apps: `enabled` applies to mattstack-owned rows only.
- A CLI-only install without the app. The app is the installer, updater and
  daemon host (settled ruling, MAT-383); solo makes its window smaller, not
  optional.

## Source

RT-328 and the read-through it names; the distribution roadmap's settled
rulings; `apps/deck/src/registry/{records,bundle-catalog,bundled-identity,
manifest,deck-manifest}.ts`; `rt-tray/Sources/Setup/SetupCoordinator.swift`;
flock's rt surface (`rt cd`, `rt nav`, `rt glitter`, `rt run`, `rt runner
--herdr`, `rt herd status/list`, herdr on PATH), which fixes the solo core
at rt, the daemon, herdr and Claude Code.
