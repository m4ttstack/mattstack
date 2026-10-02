# Org and teams: several teams in one org repo

Status: design, awaiting review. Related: MAT-424. This design covers
several teams inside one org; MAT-424 phase 2 (one Mac holding several
separate orgs, `docs/superpowers/specs/2026-10-01-active-team-design.md` on
branch `mat-424-active-team-spec`) stays parked.

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
| Lists across org and team | `claude.plugins` and `claude.marketplaces` add up; every other key: team replaces org. |
| Enforcement | A write guard in rt. No CODEOWNERS. Branch protection is the repo's own business. |
| Secrets | Org level only, encrypted to every member. |
| Old layout | Not supported. The one existing team repo is converted once. |
| `board.defaultPack` | Removed. The default pack is the active team's pack. |

## 1. Layout

```
.claude-plugin/marketplace.json           the org marketplace: every team pack
mattstack/mattstack.jsonc                 marker: this is an org repo
mattstack/org/settings.org.jsonc          org settings, roster, owners, repo sections
mattstack/org/secrets/                    org secrets, encrypted to every member
mattstack/org/packs/acme-base/            org base pack: fills and attachments
mattstack/teams/widgets/settings.team.jsonc
mattstack/teams/widgets/packs/widgets/
mattstack/teams/gadgets/settings.team.jsonc
mattstack/teams/gadgets/packs/gadgets/
```

The clone stays at `~/.mattstack/teams/<org>/`; renaming that folder is out
of scope. `lib/rt-paths.ts` gains the org and team folder paths, mirrored in
`packages/rt-client/src/settings/paths.ts`.

The org's location is a remote plus a path, and nothing assumes the org repo
is small or dedicated, so a future org can keep this folder in a repo that
also holds code (see Out of scope).

`team.jsonc`, the compatibility shim for `merge-manifests.sh`, is deleted.

## 2. Settings layers

### Order

Weakest first:

`default < org < team < user < org.repo < team.repo < user.repo < machine < machine.repo`

`team` is the active team's `settings.team.jsonc`. A Mac with no active team
reads `org` and skips `team`.

### Registry

- A new scope, `org`. Every key that allows `team` also allows `org`.
- Org-only keys: the roster (`mattstack.roster`), team owners and org admins
  (a new `mattstack.org` key: `{ admins: [username], teams: { <team>: { owners: [username] } } }`).
- A new merge mode, `add`, for arrays: the layers' lists are concatenated,
  weakest first, with duplicates removed. `claude.plugins` and
  `claude.marketplaces` use it. Any other list can opt in later with a
  one-line registry change.
- Objects keep merging key by key, so `board.slack` can carry the Slack app
  ids at the org and the channel at the team.
- `explainSetting` and the console's settings page name the org layer and
  the team layer separately.

### Membership and the active team

The roster moves to the org. Each entry gains `teams`:

```jsonc
"mattstack.roster": [
  { "username": "dev1", "name": "Dev One", "agePublicKey": "age1...", "teams": ["widgets"] },
  { "username": "dev2", "teams": ["widgets", "gadgets"] }
]
```

`activeTeam()` in rt-client resolves the active team from the member's forge
username (the confirmed GitLab identity rt already holds):

| The roster lists you on | `mattstack.activeTeam` (user scope) | Active team |
|---|---|---|
| no team | any | none: org layer only, and the `team.none` setup row |
| one team | ignored | that team |
| several teams | names one of them | that team |
| several teams | unset or not one of them | none, and the `team.choose` setup row |

`rt team use <team>` writes `mattstack.activeTeam` and refuses a team the
roster does not list you on.

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
| `board.gitlabHost` | `board.title`, `board.tabs`, `board.members`, `board.doctorSkill`, `board.triage.doctorSkill` |
| `mattstack.integrations` (forge, Slack app, Linear, switchboard) | `board.ticketPrefixes` |
| `board.botUsernames`, `boxscore.botPatterns` | `board.slack` channel (the app ids stay at the org) |
| `board.projects`, `mattstack.tracking` | every other `boxscore.*` key (projects, size bands, Linear done states, ignored MRs, excluded files) |
| `claude.marketplaces`, the org part of `claude.plugins` | the team's own pack in `claude.plugins` |
| every per-repo section of the shared repo (worktree pool, ready steps, roles, branch naming, Doppler template, intercepts) | per-repo sections for repos only this team uses |
| `mattstack.roster`, `mattstack.org` | |

### `board.defaultPack`

Removed from the registry, with the `seedDefaultPack` step in
`lib/setup/steps/skills.ts`. The board resolves a launch's pack as the tab's
`pack`, else the active team's pack. The "no pack" pill now means no active
team, or a team with no pack.

## 3. Packs

- A team pack lives at `mattstack/teams/<team>/packs/<pack>/`. A team folder
  holds one pack that claims repos; the old one-team-pack-per-zone refusal in
  `lib/skills/init.ts` becomes one per team folder.
- The org base pack lives at `mattstack/org/packs/<base>/` with
  `"base": true`. It holds fills and attachments only and is never
  installed.
- A team pack names its base with a bare name: `"extends": "acme-base"`,
  found in the org folder. The `<plugin>@<marketplace>` form is removed.
- Compile reads base fills from the org folder (`lib/skills/sources.ts`), so
  only the machine that compiles the pack needs the org clone, which every
  member has anyway.
- Materialize reads the base's `pack/skills.jsonc` from the org folder
  (`baseLayer` in `lib/skills/materialize.ts`), on every member's Mac.
- Pack discovery for compile, check, bind and materialize looks in team
  folders and the org folder.
- A team gets an org-defined verb (for example `watch-ci`) by listing it in
  its own roster and compiling: with no team fill for a slot, the org's fill
  lands. A team can override any slot with its own fill. The compiled verb is
  the team's (`widgets:watch-ci`), internal stages stay internal, and an org
  change reaches a team at its next recompile (`rt skills sync` recompiles on
  drift).
- The marketplace at the repo root lists every team pack with its source
  under `mattstack/teams/<team>/packs/<pack>`. Plugin ids do not change.
- Materialize writes a bindings file for every pack in the org on every Mac;
  the stale-file sweep from #622 is unchanged.

## 4. Writes and the write guard

Roles come from `mattstack.org` and the member's forge username:

| Role | May write |
|---|---|
| Org admin | everything under `mattstack/` |
| Team owner | `mattstack/teams/<their team>/` |
| Member | nothing; their sync engine only pulls |

The guard sits in two places:

- Every write path: `setSetting` at `org` or `team` scope, settings-kit's
  `/set`, `/unset` and `/prune`, `rt skills bind`, `compile` and `init`, and
  roster changes. Each refuses a write outside what the caller owns and names
  the owner. `SetSettingOpts.team` names the team; it defaults to the active
  team.
- The team sync engine (`lib/daemon/team-snapshots.ts`) stages only the
  folders the member owns. A hand edit outside them is never pushed, and the
  `team.sync` row names it.

The guard catches accidents from anyone using rt; it does not stop someone who
bypasses rt. Owners push to the default branch as they do today, so a repo
whose protection blocks direct pushes must let its admins and team owners
through.

## 5. Secrets

- Secrets live only in `mattstack/org/secrets/`, sops-encrypted to every
  roster member's `agePublicKey`. `.sops.yaml` rules point there.
- Adding or removing a roster entry re-encrypts, through the mechanism the
  roster drives today (`lib/team/members.ts`).
- `lib/secrets/team-store.ts` reads the org secrets folder. The switchboard
  tokens and the board's Slack app secrets move there.
- Team-level secrets are out of scope; the layout leaves room for
  `mattstack/teams/<team>/secrets/` later.

## 6. Joining, creating and setup

- Only an org admin invites. The invite carries the org remote and adds a
  roster entry with the invitee's teams. `rt team join` keeps its name and
  joins the org.
- The one-org-per-Mac rule stays: `assertOnlyTeam` (`lib/team/one-team.ts`)
  and the `team.one-per-machine` row keep refusing a second org clone.
- `rt team create` makes the new layout: the org folder, the creator as org
  admin, and a first team folder with the creator as its owner.
- A new verb adds a team folder (admin only) with its owners.
- Two setup rows, both `needs-you`, neither required nor finish-gated:
  `team.choose` (several teams, none chosen; its action is `rt team use`)
  and `team.none` (no team lists you).
- Setup's team reads (`TeamRef`, `readTeamSnapshot`, `composePlan`, the
  connect verbs) read the org layer plus the active team.
- The switchboard mechanics are unchanged; its URL and tokens come from the
  org layer. `lib/team/join.ts`, `lib/team/board-token.ts`,
  `lib/setup/validators/accounts.ts` and `lib/setup/validators/access.ts`
  change together.

## 7. Converting the existing team repo

There is one team repo today, so a one-off script under `scripts/` converts
it in one commit; no shipped verb and no reader for the old layout.

1. Split `mattstack/settings.team.jsonc` into `org/settings.org.jsonc` and
   `teams/<team>/settings.team.jsonc` by the table in section 2. The script
   prints the split for review before writing.
2. Move the roster to the org, add `teams: ["<team>"]` to every entry, and
   write `mattstack.org` with the repo owner as org admin and team owner.
3. Move `mattstack/secrets/` to `mattstack/org/secrets/` and update
   `.sops.yaml`.
4. Move `mattstack/packs/<pack>/` to `mattstack/teams/<team>/packs/<pack>/`
   and update the marketplace source.
5. Delete `team.jsonc`.

### Rollout

1. Merge, and ship one app and plugin release.
2. Once the admin's Mac runs it, run the conversion and push.
3. Members update the app. The launch-time `rt setup update` pulls the
   clone, reinstalls the team pack from its new source, materializes, and
   unsets `board.defaultPack` (a dated `MigrationDef`).

Between steps 2 and 3 a member's older rt reads the moved files as missing.
That window is accepted: it affects two members, who update right after.

## 8. Build order

Four stacked PRs. The old layout stops being read at PR 1, and the dev app
runs from main, so the four merge together and the conversion follows at
once on the admin's Mac:

1. Layout and resolver: the `org` scope, the `add` merge mode, the paths,
   `mattstack.org`, roster `teams`, `activeTeam()`, `rt team use`, the two
   setup rows.
2. Packs: discovery in team and org folders, the bare-name base read by
   compile and materialize, the init rule per team folder, removal of
   `board.defaultPack`.
3. Writes and secrets: the write guard in every write path and the sync
   engine, org secrets, invites and join, `rt team create`.
4. The conversion script and the migration that unsets `board.defaultPack`.

## Testing

- Resolver: a fixture org `acme` with teams `widgets` and `gadgets` on the
  shared repo `acme/widgets`: layer order, the `add` merge, team replacing
  org, and every row of the active-team table.
- Write guard: each role against each folder, through `setSetting`,
  settings-kit and the skills verbs, and what the sync engine stages.
- Packs: compile and materialize with the base read from the org folder; a
  missing base names the folder it looked in; discovery in team folders.
- Secrets: recipients follow the roster on add and remove.
- Conversion: the script against a fixture of the old layout, checking the
  split, the roster, secrets, the pack move and the marketplace entry.
- End to end under an isolated HOME: an org with two teams, a member of each,
  and a member on both switching with `rt team use`.
- The board and boxscore rendered in Fast Browser in both schemes, showing the
  active team's roster.
- Docs: `docs/settings-architecture.md` (scopes, the `add` merge),
  `docs/home-repo.md` (team clones become org clones), the `rt-settings`
  skill, and the creating-a-pack and extending-a-pack skills (bare-name base).

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
