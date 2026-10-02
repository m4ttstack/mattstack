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
  `status` and `pull`) drop the flag, since there is one org per Mac. `--team`
  survives only where it names team folders: `rt team invite`,
  `rt team members set` and `rt skills init`.
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

When the forge is recognized but the CLI is signed out, so no username can be
recorded: the active team comes from `mattstack.activeTeam` alone, every org
and team write is refused with "rt can't tell who you are", and setup shows a
`team.identity` row whose action signs in and reruns the step.

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
| one team | ignored | that team |
| several teams | names one of them | that team |
| several teams | unset or not one of them | none, and the `team.choose` setup row |
| unknown (no stored username) | names a team folder | that team |
| unknown | unset | none, and the `team.identity` row |

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
shows a `needs-you` row, `team.push-access`, telling them to ask the admin. A repo whose branch
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
  `--team <name>` (default: the org slug).
- `rt team add <team> --owner <username>` (admin): creates the team folder,
  its settings file and pack skeleton, the marketplace entry, and the owners
  in `mattstack.org`. Changing owners later is an admin settings edit of
  `mattstack.org`.
- `rt team invite --team <team>[,<team>]` (admin): the invite carries the org
  remote, and the roster entry it adds carries those teams. `rt team join`
  keeps its name and joins the org.
- `rt team members set <username> --teams <team>[,<team>]` (admin) changes a
  member's teams.
- `rt team use <team>` writes `mattstack.activeTeam`, refuses a team the
  roster does not list you on, then runs the update-safe plugins and
  materialize steps for the new team and restarts the board and boxscore
  through deck. The previous team's pack is disabled, not removed, so
  switching back is quick. The daemon and the CLI read settings on every call
  and need nothing.
- The one-org-per-Mac rule stays: `assertOnlyTeam` (`lib/team/one-team.ts`)
  and the `team.one-per-machine` row keep refusing a second clone.
- Setup rows, all `needs-you`, none required or finish-gated: `team.choose`
  (several teams, none chosen; action `rt team use`), `team.none` (no team
  lists you), `team.identity` (no stored username), and `team.push-access`
  (section 5).
- Setup's team reads (`OrgRef`, `readTeamSnapshot`, `composePlan`, the
  connect verbs) read the org layer plus the active team.
- The switchboard mechanics are unchanged; its URL and tokens come from the
  org layer. `lib/team/join.ts`, `lib/team/board-token.ts`,
  `lib/setup/validators/accounts.ts` and `lib/setup/validators/access.ts`
  change together.

## 8. Converting the existing team repo

There is one team repo today, so a one-off script under `scripts/` converts
it in one commit; no shipped verb and no reader for the old layout.

1. Split `mattstack/settings.team.jsonc` into `org/settings.org.jsonc` and
   `teams/<team>/settings.team.jsonc` by the table in section 3. The script
   prints the split for review before writing.
2. Move the roster to the org, add `teams: ["<team>"]` to every entry, add
   any `board.members` username the roster lacks, and write `mattstack.org`
   with the repo owner as org admin and team owner.
3. Move `mattstack/secrets/` to `mattstack/org/secrets/` and update
   `.sops.yaml`.
4. Move `mattstack/packs/<pack>/` to `mattstack/teams/<team>/packs/<team>/`,
   update the marketplace source, and bump the pack's version so every
   member's update reinstalls it from the new path.
5. Rewrite stored values whose `${team:<name>}` path moved; write the new
   marker; delete `team.jsonc`.

### Rollout

1. Merge, and ship one app and plugin release.
2. Once the admin's Mac runs it, run the conversion and push.
3. Members update the app. The launch-time `rt setup update` pulls the clone,
   records `forgeUsername`, reinstalls the team pack (its version moved),
   materializes, and unsets `board.defaultPack` (a dated `MigrationDef`).

Between steps 2 and 3 a member's older rt reads the moved files as missing.
That window is accepted: it affects two members, who update right after.

## 9. Build order

Four stacked PRs. The old layout stops being read at PR 1, and the dev app
runs from main, so the four merge together and the conversion follows at
once on the admin's Mac:

1. Names, layout and resolver: the renames in section 1, the paths, the
   `org` scope, the `add` merge with per-item provenance, `mattstack.org`,
   roster `teams`, `forgeUsername`, `activeTeam()`, the repo claim read from
   settings.
2. Packs: discovery in team and org folders, the bare-name base read by
   compile and materialize, the zone header and sweep, the install filter,
   the init rule per team folder, retiring `board.defaultPack` and
   `board.members`.
3. Writes and secrets: roles replacing `joinedByRt`, the write guard in
   every write path and the sync engine, org secrets, `rt team create`,
   `add`, `invite --team`, `members set --teams`, `use`, and the setup rows.
4. The conversion script and the migration that unsets `board.defaultPack`.

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
