# Org and teams: several teams in one org repo

Status: design, in review. Related: MAT-424. This design covers several
teams inside one org; MAT-424 phase 2 (one Mac holding several separate
orgs, `docs/superpowers/specs/2026-10-01-active-team-design.md` on branch
`mat-424-active-team-spec`) stays parked.

## Goal

One org, several teams, often one shared monorepo. The org holds what every
team shares; each team holds how it works. A member belongs to one team (or
picks one when the org puts them on several), and every app reads the org
layer plus their team's layer.

Success looks like this:

- A second team joins an existing org with its own pack, board setup and
  stats, and neither team copies the other's shared settings.
- The org decides who is on which team.
- Existing members keep working after one conversion and an app update.

## Decisions taken

| Question | Decision |
|---|---|
| Shape | One org repo with team folders inside it. One clone and one sync per Mac. |
| Where the org lives | A git remote plus a folder path. Today that is the root of the existing team repo. |
| Org settings owner | One or more org admins. |
| Team folders | Each team has owners who edit their own folder without the admin. |
| Membership | At the org level: the roster lists every member and their teams. |
| A member on several teams | A user setting picks which team they use the apps as. |
| Org base pack | Fills and attachments in the org folder. Not a plugin, never installed. |
| Installed packs | Each member installs only their active team's pack. |
| Lists across org and team | `claude.plugins` and `claude.marketplaces` add up; every other key: team replaces org. |
| Enforcement | A write guard in rt. No CODEOWNERS. Branch protection is the repo's own business. |
| Forge access | rt never grants or edits forge access on a repo it did not create (the 2026-09-07 governance ruling). The admin grants owners write access. |
| Secrets | Org level only, encrypted to every member. |
| Old layout | Not supported. The one existing team repo is converted once. |
| `board.defaultPack` | Removed. The default pack is the active team's pack. |

## 1. Names

The words change meaning, so every API that takes a slug says which one.

- **Org slug**: the clone's folder name under `~/.mattstack/teams/<org>/`
  (the folder keeps its name; renaming it is out of scope). Every existing
  API whose "team" means the clone now means the org, and PR 1 renames them
  mechanically: `listTeams` and `discoverTeams` become `listOrgs` and
  `discoverOrgs`, `TeamRef` becomes `OrgRef`. The machine-local record
  (`~/.mattstack/rt/teams/<org>.json`, `lib/team/team-local.ts`) and the
  invite pointer stay keyed by the org slug.
- **Team name**: a folder name under `mattstack/teams/`, matching
  `[a-z][a-z0-9-]*`. `SetSettingOpts.team` and settings-kit's `team`
  parameter name a team folder. A write at `org` scope takes no name: there
  is one org per Mac. settings-kit's `/defs` reply carries both `org` and
  `activeTeam`.
- **`--team`**: the org-level verbs that take `--team <clone slug>` today
  (`rt team publish`, `manage-membership`, `members sync`, `members remove`,
  `status` and `pull`) keep it with exactly that meaning, optional since there
  is one org per Mac. The Mac app passes it (`members sync --team <t>` from
  the member-joined alert), so changing its meaning would break the app.
  Team folders are named with `--teams <name>[,<name>]` on `rt team invite`
  and `rt team members set`, positionally on `rt team add` and `rt team use`,
  and with `--team <name>` on `rt skills init`, whose `--zone` keeps naming
  the clone.
- **Pack name**: a team's pack is named after its team folder, so pack
  names are unique across the org's one marketplace. The base pack is named
  `<org>-base` unless the admin names it otherwise.
- **`${team:<name>}`** keeps expanding to the clone root, keyed by the org
  slug. The conversion rewrites any stored value whose path moves.

The marker `mattstack/mattstack.jsonc` becomes
`{ "role": "org", "org": "<org slug>" }`; `namespace` is dropped.

## 2. Layout

```
.claude-plugin/marketplace.json           the org marketplace: every team pack
.sops.yaml                                sops rules for org secrets
mattstack/mattstack.jsonc                 marker
mattstack/org/settings.org.jsonc          org settings, roster, owners, repo sections
mattstack/org/secrets/                    org secrets, encrypted to every member
mattstack/org/packs/acme-base/            org base pack: fills and attachments
mattstack/teams/widgets/settings.team.jsonc
mattstack/teams/widgets/packs/widgets/
mattstack/teams/gadgets/settings.team.jsonc
mattstack/teams/gadgets/packs/gadgets/
```

`lib/rt-paths.ts` gains the org and team folder paths, mirrored in
`packages/rt-client/src/settings/paths.ts`.

The org's location is a remote plus a path, and nothing assumes the org repo
is small or dedicated, so a future org can keep this folder in a repo that
also holds code (see Out of scope).

### Which repos a team's pack claims

`mattstack/team.jsonc` is deleted. Today it declares the repos a zone's pack
claims (`readZonesFrom` in `lib/skills/init.ts`) as a mirror of
`board.projects`. The claim now reads settings directly: a team's pack
claims the projects in `board.projects` as resolved for that team (org, then
the team folder), on the host in `board.gitlabHost`, else the forge host in
`mattstack.integrations`. In a monorepo every team inherits the org's
`board.projects`, so every team's pack claims the shared repo; a team that
works in its own repo sets `board.projects` in its folder. Materialize,
`rt skills init`, `chooseZone` and the stale-file sweep read the claim this
way. `board.projects` replaces across layers, so `initPack` writes a new
claim as the team's resolved list plus the new repo into the team folder,
never the new repo alone (which would drop the org's shared repo for that
team).

## 3. Settings layers

### Order

Weakest first:

`default < org < team < user < org.repo < team.repo < user.repo < machine < machine.repo`

`team` is the active team's `settings.team.jsonc`. A Mac with no active team
reads `org` and skips `team`.

### Registry

- A new scope, `org`. Every key that allows `team` also allows `org`. `org`
  and `org.repo` join `TEAM_LOCKED_SCOPES` (`resolve.ts`).
- Org-only keys: `mattstack.roster`, and a new `mattstack.org`:
  `{ admins: [username], teams: { <team>: { owners: [username] } } }`.
- A new merge mode, `add`, for arrays: every layer's list is concatenated,
  weakest first, user and machine layers included, with duplicates removed.
  Nothing subtracts an inherited item; a member who does not want an
  inherited plugin disables it in Claude Code, and setup under `ctx.update`
  already leaves a disabled plugin alone. `claude.plugins` and
  `claude.marketplaces` use it; another list opts in with a one-line registry
  change.
- An `add` key resolves with per-item provenance (the layer each item came
  from), so `computePlugins` (`lib/setup/steps/plugins.ts`) keeps its trust
  split: items from `org`, `org.repo`, `team` or `team.repo` are
  team-authored (installed, never auto-enabled), and items from user or
  machine layers are trusted.
- Objects keep merging key by key, so `board.slack` can carry the Slack app
  ids at the org and the channel at the team.
- `explainSetting` and the console's settings page name the org layer and
  the team layer separately.
- `board.defaultPack` and `board.members` move to `RETIRED_KEYS`
  (`registry-machinery.ts`) in PR 2, so a leftover value can still be unset.

### Who you are

The write guard and the active team both need the member's forge username,
and the resolver is synchronous and daemon-free. So the username is stored as
`forgeUsername` in the machine-local record
(`~/.mattstack/rt/teams/<org>.json`), using whichever provider the org's
forge is (GitHub or GitLab). `rt team join` and `rt team create` write it, and
a new update-safe setup step, `team.identity`, writes it only while it is
absent (and is added to the set pinned in
`lib/setup/__tests__/update-safe.test.ts`).

An org whose host is no recognized forge (`forgeFromHost` returns null)
records `$USER`, the same fallback `lib/team/invite.ts` already uses, so its
creator is still its admin under that name.

`forgeLogin` (`lib/team/forge.ts`) already prefers the rt-held forge token
over the CLI's own sign-in, so the username can be recorded on any Mac whose
forge account row is connected. When it still cannot be (no token and no
signed-in CLI): the active team comes from `mattstack.activeTeam` alone, every
org and team write is refused with "rt can't tell who you are", and setup
shows a `team.identity` row. Its action is the forge account's existing
`connect` (the Mac app has no action that runs `gh auth login`); connecting
reruns the step.

### Membership and the active team

The roster moves to the org. Each entry gains `teams`:

```jsonc
"mattstack.roster": [
  { "username": "dev1", "name": "Dev One", "agePublicKey": "age1...", "teams": ["widgets"] },
  { "username": "dev2", "teams": ["widgets", "gadgets"] }
]
```

`board.members` retires; the dual write in `lib/team/invite.ts` and
`lib/team/members.ts` goes, and the board reads only the roster. Hidden
members stay the apps' own overlays (`board.hiddenMembers`,
`boxscore.hiddenMembers`).

`activeTeam()` in rt-client:

| The roster lists you on | `mattstack.activeTeam` (user scope) | Active team |
|---|---|---|
| no team | any | none: org layer only, and the `team.none` setup row |
| one or more teams | names one of them | that team |
| one or more teams | unset or not one of them | the first team in your roster entry |
| unknown (no stored username) | names a team folder | that team |
| unknown | unset | none, and the `team.identity` row |

The first team in a roster entry is the member's primary team, and the admin
orders it. A member the admin later adds to a second team keeps working as
their first team until they run `rt team use`; nothing flips them to "no
team", so no "choose a team" row exists.

The board and boxscore show the roster entries for the active team. The
roster and every team's settings are readable by every member, so an app may
show and contact other teams' members (for example, asking another team's
code owner for a review); "your team" scopes defaults and writes, never what
you can see.

### Which keys sit where

The rule: only what is truly the same for every team goes to the org;
everything about how a team works goes to the team. Any org value can be
overridden by a team, and a shared value can move up later.

| Org | Team |
|---|---|
| `board.gitlabHost` | `board.title`, `board.tabs`, `board.doctorSkill`, `board.triage.doctorSkill`, `board.reReview` |
| `mattstack.integrations` (forge, Slack app, Linear, switchboard) | `board.ticketPrefixes` |
| `board.botUsernames`, `boxscore.botPatterns` | `board.slack` channel (the app ids stay at the org) |
| `board.projects`, `mattstack.tracking` | every other `boxscore.*` key (projects, size bands, Linear done states, ignored MRs, excluded files) |
| `claude.marketplaces`, the org part of `claude.plugins` | the team's own pack in `claude.plugins` |
| every per-repo section of a repo more than one team claims (worktree pool, ready steps, roles, branch naming, Doppler template, intercepts, and any other `repos.<identity>` value) | per-repo sections for repos only this team claims |
| `mattstack.roster`, `mattstack.org` | `skills.writingStyle`, `ci.watch.budgetMinutes` |

Any key the table does not name: a global value goes to the team, and a value
inside a repo section follows that repo's row.

### `board.defaultPack`

Removed with the `seedDefaultPack` step in `lib/setup/steps/skills.ts` and
the board's legacy config read (`apps/board/src/config.ts`). The board
resolves a launch's pack as the tab's `pack`, else the active team's pack:
the one non-base pack in the active team's folder. The "no pack" pill now
means no active team, or a team with no pack.

## 4. Packs

- A team pack lives at `mattstack/teams/<team>/packs/<team>/`. A team folder
  holds one pack; the one-team-pack-per-zone refusal in `lib/skills/init.ts`
  becomes one per team folder. `rt skills init` targets the active team, or
  `--team <name>` for a team the caller owns.
- `rt team add` scaffolds the full pack file set (`renderPackFiles`), so the
  marketplace entry never points at a folder without a `plugin.json`.
  `rt skills init` on a pack that has never compiled carries on with the
  claim, materialize, compile and install instead of refusing with
  `pack-exists`; a pack that has compiled output is still never changed.
- The org base pack lives at `mattstack/org/packs/<base>/` with
  `"base": true`. It holds fills and attachments only and is never
  installed. Nothing in this work creates it: the admin adds the folder by
  hand when the org first needs shared fills.
- A team pack names its base with a bare name: `"extends": "acme-base"`,
  found in the org folder. The `<plugin>@<marketplace>` form is removed (the
  live pack uses no `extends` today).
- Compile reads base fills from the org folder (`lib/skills/sources.ts`).
- Materialize reads the base's `pack/skills.jsonc` from the org folder
  (`baseLayer` in `lib/skills/materialize.ts`) on every member's Mac.
- Pack discovery for compile, check, bind and materialize looks in team
  folders and the org folder.
- A team gets an org-defined verb (for example `watch-ci`) by listing it in
  its pack's verb roster (`pack/stubs.jsonc`, not `mattstack.roster`) and
  compiling: with no team fill for a slot, the org's fill
  lands. A team can override any slot with its own fill. The compiled verb is
  the team's (`widgets:watch-ci`), internal stages stay internal, and an org
  change reaches a team at its next recompile.
- Known drift: materialize reads the base live, but compile runs only when a
  team owner recompiles, so a member's bindings can be newer than the team's
  compiled fills in between. `rt skills sync` on a member's Mac skips the
  recompile without failing, since the guard refuses the member's write.
- The marketplace lists every team pack with its source under
  `mattstack/teams/<team>/packs/<team>`. Plugin ids do not change.

### What a Mac installs

- The plugins step installs and converges only the active team's marketplace
  entry plus the resolved `claude.plugins`, not every entry in
  `marketplace.json`.
- Materialize still writes a bindings file for every pack in the org, so a
  board tab may name another team's pack when that pack is installed.
- A bindings file's header records `// zone: <org>/<team>`. The stale-file
  sweep sets a file aside only when the org clone is present, that team
  folder's settings read, and the team no longer has that pack or no longer
  claims that repo. A missing team folder or org clone sets nothing aside.

## 5. Writes and the write guard

Roles come from `mattstack.org` and the stored `forgeUsername`. They replace
`joinedByRt` as the write gate in `write.ts` (`refuseIfJoined`),
`team-local.ts` (`assertNotJoined`), the secrets store and the sync engine.

| Role | May write |
|---|---|
| Org admin | everything rt manages in the clone: `mattstack/`, `.sops.yaml`, `.claude-plugin/` |
| Team owner | `mattstack/teams/<their team>/` |
| Member | nothing; their sync engine only pulls |

- Every write path checks the role: `setSetting` at `org` or `team` scope,
  settings-kit's `/set`, `/unset` and `/prune`, `rt skills bind`, `compile`
  and `init`, the secrets store, and roster changes. Each refuses a write
  outside what the caller owns and names the owner.
- The team sync engine (`lib/daemon/team-snapshots.ts`) pushes only for an
  admin or owner, and stages only the paths that role owns. A hand edit
  outside them is never pushed. `team.sync` names it, including when it
  stops a pull (a fast-forward or rebase that the dirty file blocks).
- Root files belong to the admin. `rt team add` writes a new team's
  marketplace entry, so an owner never needs to touch the marketplace.

The guard catches accidents from anyone using rt; it does not stop someone
who bypasses rt.

Forge access is not rt's job. An invite keeps granting read only on a repo
rt created, and nothing on any other repo. An owner's push needs write access
the admin grants on the forge; when an owner's sync push is refused, setup
shows a `needs-you` row, `team.push-access`, telling them to ask the admin.

`forgeRole` (`lib/setup/token-create.ts`), which picks the scopes rt asks for
when a member creates a forge token, keys on the role, not on `joinedByRt`:
an admin or owner gets owner scopes, a member gets member scopes. A member
who later becomes an owner has a read-only token, so `team.push-access` also
fires on "your token cannot push", and its action is the forge account's
`connect` with owner scopes prefilled through `token-create.ts`. A repo whose branch
protection blocks direct pushes must let its admins and owners through.

## 6. Secrets

- Secrets live only in `mattstack/org/secrets/`, sops-encrypted to every
  roster member's `agePublicKey`. `.sops.yaml` rules point there.
- Adding or removing a roster entry re-encrypts, through the mechanism the
  roster drives today (`lib/team/members.ts`).
- `lib/secrets/team-store.ts` reads the org secrets folder. The switchboard
  tokens and the board's Slack app secrets move there.
- Team-level secrets are out of scope; the layout leaves room for
  `mattstack/teams/<team>/secrets/` later.

## 7. Verbs, joining and setup

- `rt team create` makes the new layout: the org folder, the creator as org
  admin, and a first team folder with the creator as its owner, named by
  `--team <name>` (default: the org slug). It also writes the creator's
  roster entry with that team (today create adds the creator to no roster,
  which would leave them on no team), and records `forgeUsername`.
- `rt team add <team> --owner <username>` (admin): creates the team folder,
  its settings file and pack skeleton, the marketplace entry, and the owners
  in `mattstack.org`. Changing owners later is an admin settings edit of
  `mattstack.org`.
- `rt team invite --teams <team>[,<team>]` (admin only; a team owner is
  refused with "only an org admin invites"): with no `--teams` it uses the
  inviter's active team, so the Mac app's Invite button
  (`team invite --handle <h> --json`) keeps working unchanged. The roster
  entry it adds carries those teams, first team first. `rt team join` keeps
  its name and joins the org.
- `rt team members set <username> --teams <team>[,<team>]` (admin) changes a
  member's teams.
- `rt team use <team>` writes `mattstack.activeTeam`, refuses a team the
  roster does not list you on, then runs the update-safe plugins and
  materialize steps for the new team and restarts the board and boxscore
  through deck. Because the member chose the switch, the new team's pack is
  enabled (a team pack otherwise stays team-authored: installed, never
  auto-enabled), and the previous team's pack is disabled, not removed. The
  daemon and the CLI read settings on every call and need nothing.
- `rt team status --json` gains `role`, `activeTeam` and `teams`. Existing
  fields keep their shape.
- The one-org-per-Mac rule stays: `assertOnlyTeam` (`lib/team/one-team.ts`)
  and the `team.one-per-machine` row keep refusing a second clone.
- Setup rows, all `needs-you`, none required or finish-gated: `team.none`
  (no team lists you), `team.identity` (no stored username) and
  `team.push-access` (section 5). The Mac app lists an optional row on Done
  only when its action is `steps` or `open-url` (`ReadinessModel.swift`), so
  `team.none` carries a `steps` action, and `team.identity` and
  `team.push-access` carry the forge `connect` (shown in the checklist and
  in Setup status) with a `steps` fallback where the row also has to read on
  Done.
- Setup's team reads (`OrgRef`, `readTeamSnapshot`, `composePlan`, the
  connect verbs) read the org layer plus the active team.
- The switchboard mechanics are unchanged; its URL and tokens come from the
  org layer. `lib/team/join.ts`, `lib/team/board-token.ts`,
  `lib/setup/validators/accounts.ts` and `lib/setup/validators/access.ts`
  change together.

## 8. Onboarding through the Mac app

The Mac app's wizard (welcome, team, checklist, install, done) only spawns rt
verbs and decodes the plan contract (`rt-tray/Sources-core/Setup/`,
`PlanModels.swift`), so every rule here lives in rt. The new rows use
existing fields and action kinds, so no Swift change is needed for create,
join or solo.

### Create

The team screen runs `rt team create <name>`, as today. The name becomes the
org slug and the first team's name; the wizard keeps its one name field. The
creator is admin, owner of that team, and on the roster, and `forgeUsername`
is recorded (create already uses the CLI's own sign-in for
`gh repo create`; with `--remote`, `forgeLogin` uses the rt-held token, else
the `$USER` fallback).

### Join

The team screen runs `rt team join --dry-run` on the pasted code; Install's
`team.join` step redeems it.

- The sealed pointer gains `username` (the invited handle) and `teams`, and
  its `v` bumps. A pointer from before the bump is refused with "ask for a new
  invite".
- The dry run reports the org and the teams. The clone does not exist before
  Install, so the pre-Install plan takes the teams from the pointer, never
  from settings.
- Join already refuses to redeem without a forge login (`forge-login-unknown`
  in `lib/team/join.ts`). It now also compares that login with the pointer's
  `username`, case-insensitively, and refuses a mismatch before redeeming:
  "This invite is for <x>; you're signed in as <y>." Today nothing compares
  them, and a mismatch would leave the joiner on no team.
- Join records `forgeUsername` from that login and writes
  `mattstack.activeTeam` to the pointer's first team, so the active team is
  known before `plugins.install` runs and the first Install installs the
  right team pack.
- Secrets follow today's flow: the inviter's Mac gets the member-joined alert
  and its confirm runs `members sync`. Only admins invite, so the Mac that
  gets the alert is an admin's and the sync is allowed. Until then the joiner
  sees today's waiting rows.

### Solo and the second-org guard

Solo is unchanged, and `rt setup intent solo` still refuses when a clone
exists. Settings' "Join another team…" and "Create a team…" reopen the
wizard as today; a second org is refused by `assertOnlyTeam`. Joining another
team in the same org is not an invite: the admin adds the team to the
member's roster entry (`rt team members set`), and the member switches with
`rt team use`. An invite for the org already on the Mac re-joins, as today.

### The update run

Today no update-safe step pulls the clone; only the daemon's timer does. A
member whose app updates before the timer fires would run the new code
against the old layout. So two update-safe steps are added at the front of
the update run, and to the set pinned in `lib/setup/__tests__/update-safe.test.ts`:

1. `org.pull`: one fetch and rebase cycle, the same as `rt team pull`. A
   failure is a failed item and the run continues.
2. `team.identity`: records `forgeUsername` while it is absent.

Then the existing update-safe steps run. `skills.materialize` no longer seeds
`board.defaultPack`.

### Has a team

`requiresTeam` on board and boxscore keeps meaning "this Mac has an org"
(`deck.managed` keys on the clone). A member on no team keeps both apps on,
with the "no pack" pill and the `team.none` row. The Apps pane's "Needs a
team" caption keys on `team status` reporting `solo` (no clone), which keeps
its meaning.

### Restore on a new Mac

The wizard's restore card replays a member's clones and packs from their home
repo. The machine-local record (`createdByRt`, `joinedByRt`) is not part of
the home repo, so today a restored creator loses it. Under this design the
role comes from the roster and `forgeUsername`, and `team.identity` runs in
the full apply as well as the update run, so a restored Mac gets its admin,
owner or member role back with no extra step.

### A failed join check

On a fresh Mac the forge token is connected on the checklist, after the team
screen, so the login check cannot run during the team screen's dry run. A
mismatch surfaces at Install as a failed `team.join` step, whose message
names both logins and the fix: "This invite is for <x>; you're signed in as
<y>. Ask for an invite for <y>, or connect <x>'s token."

### The Mac app's own surfaces

The wizard, the checklist, Done, Setup status, the Apps pane, the
member-joined alert and the menu bar need no change. Settings › Team does,
since it was written for one team per repo (`Sources/Settings/TeamPane.swift`,
`Sources-core/Settings/TeamSettingsModel.swift`):

- It decodes the new `team status --json` fields `role`, `activeTeam` and
  `teams` as optionals, so an older rt keeps working with a newer app and the
  reverse.
- The Team section shows the org name and a "Your team" row. When the roster
  lists the member on more than one team, that row is a picker that runs
  `rt team use <team>` and reloads.
- The Invite section shows only for an org admin. When the org has more than
  one team, it carries a team picker passed as `--teams`; otherwise it sends
  no `--teams` and rt uses the admin's active team.
- The copy changes from "your team owner" and "This Mac holds one team
  today" to "your org admin" and "This Mac holds one org".

These Swift changes are PR 5 of the stack (section 10). Because the new
fields decode as optionals, an app without them would still work, only
showing Invite to members (who get rt's refusal) and offering no team picker.

## 9. Converting the existing team repo

There is one team repo today, so a one-off script under `scripts/` converts
it in one commit; no shipped verb and no reader for the old layout.

1. Split `mattstack/settings.team.jsonc` into `org/settings.org.jsonc` and
   `teams/<team>/settings.team.jsonc` by the table in section 3. The script
   prints the split for review before writing.
2. Move the roster to the org, add `teams: ["<team>"]` to every entry, add
   any `board.members` username the roster lacks, add the admin's own entry
   if it is missing, and write `mattstack.org` with the repo owner as org
   admin and team owner.
3. Move `mattstack/secrets/` to `mattstack/org/secrets/` and update
   `.sops.yaml`.
4. Move `mattstack/packs/<pack>/` to `mattstack/teams/<team>/packs/<team>/`,
   update the marketplace source, and bump the pack's version so every
   member's update reinstalls it from the new path.
5. Rewrite stored values whose `${team:<name>}` path moved; write the new
   marker; delete `team.jsonc`.

Roster usernames were typed by whoever sent each invite, and the active team
now matches them against each member's forge login. So the script prints
every roster username and asks the admin to confirm each is that member's
forge username before it writes. The `team.none` row names the login rt
looked for, so a miss after rollout says exactly what to fix.

### Rollout

1. Merge the stack (section 10), and ship one app and plugin release of its
   own.
2. Once the admin's Mac runs it, run the conversion and push.
3. Members update the app. The launch-time `rt setup update` unsets
   `board.defaultPack` (a dated `MigrationDef`, which runs before the steps),
   then `org.pull` pulls the converted layout, `team.identity` records
   `forgeUsername`, `plugins.install` reinstalls the team pack (its version
   moved), and `skills.materialize` writes the bindings.

Between steps 2 and 3 a member's older rt reads the moved files as missing.
That window is accepted: it affects two members, who update right after.

## 10. Build order

Five stacked PRs, each based on the one before it and each green against its
own base. Nothing merges to main until all five are reviewed and green. They
then land top down (PR 5 into PR 4, and so on down to PR 1), and PR 1 merges
to main as one commit, so main moves from the old layout to the new one in a
single step and is never half converted. The stack rebases on main as main
moves, not once at the end. A release follows the merge at once, then the
conversion, then members update. The Mac app change in PR 5 is tested with a
dev app built from the stack branch in a scratch tree, never in the shared
checkout.

1. Names, layout and resolver: the renames in section 1, the paths, the
   `org` scope, the `add` merge with per-item provenance, `mattstack.org`,
   roster `teams`, `forgeUsername`, `activeTeam()`, the repo claim read from
   settings.
2. Packs: discovery in team and org folders, the bare-name base read by
   compile and materialize, the zone header and sweep, the install filter,
   the init rule per team folder, retiring `board.defaultPack` and
   `board.members`.
3. Writes, secrets and onboarding: roles replacing `joinedByRt` (including
   `forgeRole`), the write guard in every write path and the sync engine, org
   secrets, `rt team create` with the creator's roster entry, `add`,
   `invite --teams` with its default, `members set --teams`, `use`, the
   pointer's `username` and `teams` with the join check, the `org.pull` and
   `team.identity` update steps, the `team status --json` fields, and the
   setup rows.
4. The conversion script and the migration that unsets `board.defaultPack`.
5. The Mac app's Settings › Team pane (section 8).

## Testing

- Resolver: a fixture org `acme` with teams `widgets` and `gadgets` on the
  shared repo `acme/widgets`: layer order, the `add` merge and its per-item
  provenance, team replacing org, and every row of the active-team table.
- Plugins: the trust split with items from each layer, and the install
  filter to the active team's pack.
- Write guard: each role against each path, through `setSetting`,
  settings-kit, the skills verbs and the secrets store, and what the sync
  engine stages and pushes.
- Packs: compile and materialize with the base read from the org folder; a
  missing base names the folder it looked in; discovery in team folders; the
  repo claim from `board.projects` for a shared repo and a team-only repo;
  the sweep against the zone header.
- Secrets: recipients follow the roster on add and remove.
- Conversion: the script against a fixture of the old layout, checking the
  split, the roster and `board.members` merge, secrets, the pack move and
  version bump, the marketplace entry and the `${team:}` rewrite.
- End to end under an isolated HOME: an org with two teams, a member of each,
  and a member on both switching with `rt team use`.
- Onboarding, through the same verbs the Mac app spawns, under an isolated
  HOME: create (`team create`, then `setup plan --json` and `setup apply`)
  leaves the creator admin, owner and on the roster with the first team
  active; join (`team join --dry-run`, then apply) shows the pointer's teams
  before Install, installs only the first team's pack, and refuses a
  mismatched login and an old-version pointer; a member the admin adds to a
  second team keeps their first team; the update run orders the migration,
  `org.pull`, `team.identity` and `plugins.install` as section 8 says.
- Restore under an isolated HOME: a restored Mac with no machine-local record
  gets its role back from the roster after `team.identity`.
- The Mac app: a `PlanModels` decode test with the new rows, the Done screen
  listing `team.none`, `TeamSettingsModel` decoding `team status --json` with
  and without the new fields, and the Team pane rendered in the dev app in
  light and dark for an admin with two teams, an owner and a member,
  screenshotted and looked at.
- The board and boxscore rendered in Fast Browser in both schemes, showing the
  active team's roster.
- Docs: `docs/settings-architecture.md` (scopes, the `add` merge),
  `docs/home-repo.md` (team clones become org clones), the `rt-settings`
  skill, and the creating-a-pack and extending-a-pack skills (bare-name base,
  team folders).

## Out of scope

- Several orgs on one Mac (MAT-424 phase 2).
- Team-level secrets.
- An org plugin with verbs every member invokes by name.
- The cross-team review feature on the board.
- Renaming `~/.mattstack/teams/`.
- An org folder inside a repo that also holds code. It would need an opt-in
  exception to the rule that rt never writes into target repos, and rt would
  read the folder from the member's existing checkout instead of a second
  clone.
- Moving the existing team pack's shared fills into the org base pack; that
  is the next step after this lands.
