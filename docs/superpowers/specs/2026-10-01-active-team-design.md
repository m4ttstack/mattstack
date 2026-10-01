# Active team: several teams on one Mac

Status: design, awaiting review. Ticket: MAT-424 (phase 2). Phase 1 (PRs #634
and #637) made a second team zone impossible; this design replaces that
refusal with a model that supports it.

## Goal

A person can belong to several teams on one Mac. Exactly one team is active
at a time, and switching is a deliberate, uncommon act, like switching
workspace in Linear. Everything team-shaped follows the switch: settings,
board tabs and roster, pack defaults, GitLab host, switchboard and its token,
plugins, and each app's data. Nothing merges across teams.

The second payoff is robustness. Today about twenty call sites take "the
first team", four scanners disagree on what counts as a team, and team writes
never say which team they mean. Naming the team everywhere removes a class
of accident even on a one-team Mac.

Success looks like this:

- Joining a second team works and leaves the first team's settings, secrets
  and app data untouched.
- After a switch, no value, credential or row from the other team is visible
  in any app or verb.
- A one-team Mac and a "just me" Mac behave as they do today.

## Decisions taken

| Question | Decision |
|---|---|
| Scope of a switch | Everything follows the one active team. No per-tab team pin, no mixed-team board. |
| Where the active team lives | Machine scope. A switch on this Mac changes only this Mac. |
| One-per-machine things | GitLab host, switchboard URL and token, and plugins all follow the switch. |
| App data | Separate store per team on disk for board and boxscore. |
| Live work at switch time | Warn once, then switch. Nothing is killed. |
| Leaving a team | `rt team leave` archives, then removes. |
| Approach | The active team is resolved inside the settings resolver. |
| Switcher placement | CLI and tray only. The web apps show the team as a label. |
| "Just me" machines | Unchanged, with no active team. |

Approaches considered and set aside: swapping a profile folder on disk
(copies state around, churns the home repo sync, and can leave a Mac
half-swapped), and passing a team explicitly on every read with no ambient
default (touches every `getSetting` call in every app, and the CLI still
needs an ambient answer).

## 1. The active team and the resolver

### The key

`rt.activeTeam`: a string slug, machine scope only, no default. The resolver
reads the machine store before any team store, so the lookup has no cycle.

### Which team is active

One function, `activeTeam()`, in rt-client, used by the resolver and exported
for everyone else:

| Zones on disk | `rt.activeTeam` | Result |
|---|---|---|
| none | any | no team (solo) |
| one | unset, or names it | that zone |
| one | names a missing zone | that zone, with a one-time warning |
| several | names one of them | that team |
| several | unset or stale | no team; one warning per process; setup shows the "choose a team" row |

The one-zone rows mean an updated build on an unmigrated Mac keeps working.

### One definition of a team

`listTeams()` returns a sorted list and stays the only answer to "which
teams does this Mac hold". Its predicate is unchanged
(`mattstack/settings.team.jsonc` exists). `discoverTeams(p)` keeps the same
predicate and sorts too. The three other scanners keep their own narrower
questions (a git clone to sync, a zone that can host a pack, a pending
invite) and are documented as such next to `listTeams`.

### Reads

`getSetting`, `listSettings` and `explainSetting` read exactly one team
store: the active team's. `ResolveOpts` gains `team?: string`, which names
another team's store instead. A named team that has no zone is an error, not
an empty read. The alphabetical fold and the phase 1 multi-team warning are
removed.

`explainSetting` names the team in its team layers.

### Per-team personal values

Some user and machine values belong to one team: the confirmed forge host,
the switchboard URL, the default pack. The user store and the machine store
each gain a `teams.<slug>` section, shaped like `repos.<identity>`.

A registry row opts in with `perTeam: true`. For such a key:

- A read resolves the active (or named) team's section in each store. A
  global value in the same store is a fallback below the section.
- A write at user or machine scope goes to the active team's section when a
  team is active, and to the global value on a solo Mac.
- With no active team on a Mac that holds zones, the key resolves only its
  global value.

Scope order, weakest first:

`default < team < user < user teams.<slug> < team.repo < user.repo < machine < machine teams.<slug> < machine.repo`

First set of `perTeam` keys: `rt.integrations`, `board.switchboardUrl`,
`board.defaultPack`, `board.defaultMember`, `board.hiddenMembers`,
`board.workspaces`, `boxscore.hiddenMembers`. Adding a key to this set later
is a registry change plus a migration that moves its global value.

### Writes

`SetSettingOpts.team` stays. The rules:

- A team-scope write with `team` omitted goes to the active team. With no
  active team it is refused.
- settings-kit's `/set`, `/unset` and `/prune` require `team` on a
  team-scope write and refuse one that is not the active team. The page gets
  its team from `/defs`, so a browser tab left open across a switch cannot
  write to the wrong team.
- settings-kit's React `set` and `unset` send the team from `/defs`.
- `rt settings set --scope team` defaults to the active team and prints
  which team it wrote. `rt settings get`, `list` and `explain` gain
  `--team`.
- `lib/variations.ts`, board's roster and tab writes, console and board's
  config modal all pass the active team.
- `refuseIfJoined` is unchanged: an invite-joined clone stays read-only.

## 2. Join, switch and setup

### Join and create

`assertOnlyTeam` and `ONE_TEAM_RULE` are removed. `rt team join` and
`rt team create` add the zone and then activate it through the switch path
below. Re-joining a team already on the Mac is unchanged and does not
switch.

`createTeam` takes an `activate` flag. `rt team create` passes true. The
zone-creating path of `rt skills init` passes false and says the new zone
was added without switching (section 5).

### Verbs

- `rt team list`: the teams on this Mac, the active one marked. `--json`.
- `rt team switch <slug>`: changes the active team. A picker when the slug
  is omitted at a terminal; off a terminal the usage error is unchanged.
  `--check` reports what is live for the current team and changes nothing.
  `--yes` skips the question. `--json`.

### What a switch does

In order, holding the existing setup-update lock so a switch and a
launch-time update never overlap:

1. Check the target zone exists. Collect live work for the current team
   (open board lanes, runs, herds). At a terminal, list it and ask once.
2. Write `rt.activeTeam`. On a Mac the migration left unassigned (several
   zones, none active), this first switch also runs the migration's moves
   for the chosen team.
3. Run the update-safe setup steps and `verify` for the new team, the same
   run `rt setup update` does (marketplaces, plugins, pack cache, deck app
   set).
4. Restart the served team apps and tell the daemon to re-read (account
   health, intercept rules).

Failure handling: every step after 2 is idempotent. If one fails, the Mac is
on the new team with a fault in Setup status, and running the switch again
repairs it. There is no rollback and no half-switched state: the active team
changed at step 2 or it did not.

Switching to the team that is already active reruns steps 3 and 4, which
makes it the repair verb as well.

### Setup

- `TeamRef` is the active team wherever `teams[0]` is taken today
  (`teamRefFromIntent`, `composePlan`, `createApplyContext`, the connect
  verbs, `commands/verify.ts`, `commands/tools.ts`, the daemon's accounts
  sweep).
- The `--team` override on `rt setup plan` and `rt team status` stays and
  now reads that team's settings through the `team` read option. Today it
  only picks the folder while values come from the fold; `readTeamSnapshot`
  and `mintInvite` get the same fix.
- The `team.one-per-machine` row and `SEVERAL_TEAMS_NOTE` are replaced by a
  `team.choose` row, shown only when several zones exist and none is active.
  It is `needs-you`, not required, and its action is the team picker.
  `verify` reports it, so `rt setup update` notifies.
- `rt setup intent solo` still refuses when any zone exists.

### Daemon

Zone sync (the team snapshot engines) and the invite poller keep covering
every team, so an inactive team stays current and a switch needs no pull.
Account health covers the active team only. The intercept rules are rebuilt
from the active team's store.

## 3. Credentials and the per-team singletons

### Forge tokens: by host

`rt/gitlabToken` and `rt/githubToken` become one token per host. Two teams
on the same host share it. A team on a new host gets its own connect prompt
in setup, with the scopes from `lib/setup/token-create.ts` as today.

The git credential helper answers for any host confirmed by any team on this
Mac, not only the active team's. Panes started under the previous team keep
running after a switch and still fetch and push.

### Other personal secrets: by team

Linear key, Slack token, sdm email, switchboard token and switchboard admin
token move into a per-team namespace in the personal secrets store. Readers
resolve the active team's namespace; a caller holding a `team` option reads
that team's. The daemon's `secrets:read` board scope resolves the active
team's namespace. On a solo Mac the secrets stay where they are today.

The team sops store is already per slug and does not change.

### Switchboard

`rt.integrations` and `board.switchboardUrl` are `perTeam`, so each team has
its own confirmed URL and its own token.

- Join writes the joining team's latch. The "a different URL is already
  confirmed" warning can only fire within one team now.
- Only the team-declared https URL is trusted, as today.
- `account.switchboard` and `account.board-peering` check the active team
  only. Peering reads that team's token; the board `.env` token is no longer
  consulted once the migration has copied it.

`lib/team/join.ts`, `lib/team/board-token.ts`,
`lib/setup/validators/accounts.ts` and `lib/setup/validators/access.ts`
change together, as AGENTS.md requires.

### GitLab host for the board

No special handling. `board.gitlabHost` is a team key, so the board serves
the active team's host after its restart.

### Plugins

A switch installs the new team's marketplaces and plugins. A plugin that rt
installed for the previous team and the new team does not declare is
disabled, not removed; setup-state records it per team, and it returns to
its recorded state on switching back. A plugin the user installed is never
touched. Open Claude sessions keep what they loaded until `/reload-plugins`.

## 4. Board, boxscore, console and deck

### Data on disk

- Board state: `~/.mattstack/board/teams/<slug>/`.
- Boxscore database: `~/.mattstack/boxscore/teams/<slug>/`.

Each app picks its folder once at start from the active team and does not
re-resolve while running; the switch restarts it. Until the migration has
run, an app that finds no team folder reads the old location.

### Board

Tabs, roster, projects, prefixes, bot lists, title and GitLab host come from
the active team's store through the resolver. A tab's `pack` field is
unchanged, since a team can serve more than one pack. `board.defaultPack` is
a per-team value. Lanes from another team are not in this team's state and
are there again after switching back.

Known limit: a pane still running for an inactive team can raise a gate. The
notification still arrives and names the team, but the lane is only visible
on the board after switching back.

### Boxscore

Reads the active team's roster, projects and config. No cross-team view.

### Console

The settings page shows the active team's layer, labelled with the team name
as it has been since phase 1, and its writes send that team.

### Showing the team

Board, boxscore and console show the active team's name in the header as a
plain label. They do not carry a switch control, because a switch restarts
the page's server.

### Deck

Apps marked `requiresTeam` are enabled when an active team exists.

## 5. Tray, leaving a team, and pack creation

### Tray

Settings, Team shows the active team as today, plus a team picker when the
Mac holds more than one. The button reads "Add a team…" and opens the invite
flow; an invite for a team already on the Mac re-joins it. Picking another
team runs `rt team switch <slug> --check`, shows the live work in a confirm
sheet, runs the switch with `--yes`, and posts a notification when it ends.
The menu bar menu shows the active team's name. Swift holds no decision: it
calls `rt team list`, the check, and the switch. `rt team status` and
`rt team invite` from the pane resolve the active team, so they no longer
fail as ambiguous.

### `rt team leave <slug>`

Refuses:

- the active team while another team exists (switch first)
- a zone with uncommitted or unpushed changes
- a team with live work

Then, in order:

1. Moves into one dated archive folder under `~/.mattstack/rt/archive/`:
   the zone, that team's board and boxscore data, its machine record and
   pending invite record, its `teams.<slug>` settings sections (written out
   as a file, then removed from the stores), and per-pack files for packs
   only that team served.
2. Deletes that team's secrets. A host token stays if another team on this
   Mac uses the same host.
3. Disables plugins rt installed only for that team.

Leaving the only team is allowed after a confirmation and returns the Mac to
"just me": `rt.activeTeam` is unset. It does not change the team's roster;
the output says the owner removes the member.

The archive is never read back by rt. Coming back to a team is a new invite.

### Pack creation

`rt skills init` and the creating-a-pack skill keep sending a second pack to
a new zone, which now succeeds. A zone created this way is added without
switching to it, and the output says so: starting a pack should not move the
whole Mac to another team. Packs keep working for a repo whichever team is
active, because bindings are keyed by repo and pack.

## 6. Migration, build order, testing, docs

### Migration

One dated `MigrationDef`, run once per Mac:

| Zones | What it does |
|---|---|
| none | nothing |
| one | sets `rt.activeTeam`; moves global values of `perTeam` keys into `teams.<slug>`; moves secrets into the team namespace and forge tokens under their confirmed host; copies a board `.env` switchboard token into the team's secret; moves board and boxscore data into the team folders |
| several | moves nothing and leaves the `team.choose` row; the first switch assigns the existing data, secrets and sections to the chosen team |

Apps and readers fall back to the old locations until it has run.

### Build order

One plan, landed as separate PRs that each leave main working:

1. Resolver: `rt.activeTeam`, `activeTeam()`, single-team reads, the `team`
   read option, `teams.<slug>` sections, sorted `listTeams`. Join still
   refuses a second team.
2. Callers: every `teams[0]` and unnamed team write moves to the active
   team; `--team` overrides read the named team.
3. Secrets by team, forge tokens by host, the credential helper.
4. Per-team app data for board and boxscore, and the header label.
5. `rt team list`, `rt team switch`, the migration, the `team.choose` row,
   and removal of the phase 1 refusal and row. This PR turns the feature on.
6. `rt team leave`.
7. Tray picker and "Add a team…", then docs.

### Testing

- Resolver unit tests on a two-zone fixture (`acme`, `globex`): active team
  only, named team, per-team sections, and each row of the active-team
  table.
- A `no-*` guard test that fails on a new `teams[0]` or a team-scope write
  with no team outside the resolver.
- An end to end test under an isolated HOME: join two teams, switch both
  ways, and check that settings, secrets and app data folders never cross.
- Migration tests for the zero, one and several zone cases.
- Switch failure: a failing step leaves the new team active and a rerun
  repairs it.
- Leave: each refusal, the archive contents, and the shared-host token case.
- The tray pane and the header labels get a look in both schemes.

### Docs

`docs/settings-architecture.md`, `docs/home-repo.md`, the teams guide and
the install page replace the one-team rule with the active-team model. The
switchboard section of AGENTS.md is updated for the per-team latch. The
`rt-settings` skill gains the `perTeam` rule and the `team` read option.

## Out of scope

- A board that shows two teams at once, or a tab pinned to another team.
- A cross-team view in boxscore.
- Syncing the active team between Macs.
- A switch control inside the web apps.
- Restoring a team from its archive.
