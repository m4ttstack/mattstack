# Orgs root: the org clone moves to `~/.mattstack/orgs/<org>/`

Status: design, in review. Addendum to
`2026-10-01-org-and-teams-design.md`, which this document amends where the
two disagree. Builds on the branch following in #722.

## Goal

An org clone lives under a folder named for what it is. Today the acme org
sits at `~/.mattstack/teams/acme/`, a name left over from the one-team
layout, and its org slug is whatever that folder happens to be called. The
target shape:

```
~/.mattstack/orgs/acme/                   the org clone (org: acme)
  mattstack/org/settings.org.jsonc        org store
  mattstack/teams/widgets/                a team
    settings.team.jsonc
    packs/widgets/
```

Success looks like this:

- A Mac that updates rt finds its org clone moved to `orgs/<org>` with
  nothing else to do: records, the repo index, the Claude marketplace and the
  daemon all follow.
- An org can be named differently from its first team. The live org is
  renamed from its team's name to the company's name in the same move.
- A shared store value that names the org clone no longer spells out a
  folder name, so a rename never touches shared content.
- A Mac on an older rt keeps working until the org repo's `main` takes the
  org layout, the window the parent spec already accepts.

## Decisions taken

| Question | Decision |
|---|---|
| Root folder | `~/.mattstack/orgs/`. `~/.mattstack/teams/` is legacy: only the migration and `rt home init` name it. |
| Org identity | The marker's `org` field (`mattstack/mattstack.jsonc`). The folder name must match it; the `org.folder` setup row reports a mismatch. |
| `${team:<name>}` | Kept as a deprecated alias: any single-segment name resolves to the current org clone. Warns once per process. Removed one release after `${org}` lands in the shared store. |
| `${org}` | New placeholder: the current org clone's root. Throws on a Mac with no org. |
| An unmigrated clone | New rt never reads `teams/`. The `org.folder` row reports a marked clone there as `needs-you` with the remedy `rt setup update --force`. No symlink. |
| rt records | `~/.mattstack/rt/teams/<org>.json` and `rt/invites/<org>.json` keep their folder names; only the per-org file is renamed. |
| Claude marketplace | The migration drives the claude CLI: remove, add, then reinstall the packs that came from that marketplace. When any of it fails, the migration ends `partial` with the commands as its remedy. |
| Daemon | The move runs under a daemon hold that pauses that clone's team sync; the daemon is never restarted by the migration. |
| Stray folders | A folder under `teams/` with no org marker is skipped and named in the outcome. |
| Shared store rewrite | Never from a migration. `${team:<name>}` values on `main` stay until every member runs the new rt; one later commit rewrites them to `${org}`. |
| Conversion script | Gains `--org <name>`; the folder name stays the match key for old values. Splits `linear.teamKey` to the team store; drops the retired switchboard block. |

## 1. Paths

`orgsDir()` is `~/.mattstack/orgs`; `orgDir(org)` is `join(orgsDir(),
org)`. Both live in `lib/rt-paths.ts` (the authority) and
`packages/rt-client/src/settings/paths.ts` (the mirror), as today's
`teamsDir()` and `orgDir()` do. `teamsDir()` is renamed `legacyTeamsDir()`;
its only callers are the migration, the `org.folder` row and `rt home init`.

Every literal `join(home, ".mattstack", "teams")` under `lib/`, `commands/`,
`packages/rt-client`, `scripts/` and the apps goes through `orgsDir()`. The
implementation plan carries the site list (it comes from a sweep that
names the real org, so the sweep itself is not committed). A new guard
test, `lib/__tests__/no-legacy-teams-root.test.ts`, fails any source file
outside the three callers above that spells the legacy root: the literal
`.mattstack/teams`, or `"teams"` joined directly after `".mattstack"` or
after `mattstackHome()`. It never matches a clone-relative
`join(clone, "mattstack", "teams")`, and it skips `__tests__` directories,
whose fixtures must build the legacy root. It is a `no-*` test so it runs
on every PR. The clone-relative paths inside
the org (`mattstack/org`, `mattstack/teams/<team>`, `.sops.yaml` rules, the
marketplace source) do not change.

`rt home init` creates `orgs/` beside the other state dirs. It keeps
creating `teams/`, because an older rt on the same account expects it and
an empty folder costs nothing.

### Org identity

`listOrgs()` (rt-client) and `discoverOrgs()` (`lib/setup/team-settings.ts`)
scan `orgsDir()` for folders holding `mattstack/org/settings.org.jsonc`.
The org slug stays the folder name, so `currentOrg()`, roles, records,
invites and status keep their shape. The marker's `org` is the name the
migration moves a clone to, and `packOrg` already refuses a pack write when
marker and folder disagree.

A new `org.folder` setup row (`lib/setup/validators/`, next to the one-team
row) reports, never gating Install or Finish:

- `ready` when every org under `orgsDir()` has a marker whose `org` equals
  its folder and nothing marked sits under `legacyTeamsDir()`.
- `needs-you` when a marked clone sits under `legacyTeamsDir()`: "Your org
  has not moved yet", remedy `rt setup update --force`.
- `error` when a marker's `org` differs from its folder, or when a clone
  with the same origin sits in both roots: the detail names both paths and
  the remedy says to move the folder to match the marker.

## 2. Placeholders

`expandString` in `packages/rt-client/src/settings/resolve.ts` gains
`${org}`: the current org clone's root, from `ExpandCtx.orgDir`. On a Mac
with no org it throws the closed-set error the other placeholders throw,
never passes through.

`${team:<name>}` changes contract. Today it is lexical,
`join(teamsDir, name)` with no existence check, and
`resolve.test.ts` pins that. Now any single-segment `<name>` resolves to the
current org clone's root, the same value as `${org}`, with one `warn` per
process: "${team:<name>} is deprecated; use ${org}". The `..` and `/` guard
stays, and a Mac with no org throws the same closed-set error as `${org}`,
so a "Just me" Mac that kept a `${team:x}` value in its own store sees that
error from `rt settings list` where it used to see a path under `teams/`.
The name is ignored on purpose: a shared store on `main` carries the org's
old folder name until the window closes, and a Mac that joined after the
admin's rename has no record of that name. `write.ts`'s hint names `${org}`
first.

### Why the shared store keeps `${team:<name>}` for now

An rt that predates this design does not know `${org}` and lets it through
verbatim, so an `rt.roles` hook of `bun ${org}/...` would spawn literally on
every member's Mac. The org store on `main` therefore keeps
`${team:<old folder>}` until every member has updated, and the alias makes
those values resolve on both old and new rt. The rewrite to `${org}` is one
commit in the org repo after the window closes, never part of a migration.

## 3. The migration

`2026-10-06-orgs-root` in `lib/setup/migrations/`, run by `rt setup update`
before `org.pull`. Like every migration it returns one `StepOutcome` and is
recorded only when that outcome is `done` or `skipped`; anything else runs
again at the next update, which a person reaches with `rt setup update
--force` (an update that already stamped this version otherwise reports
`current`). A `dev` version runs it on every update.

For each folder under `legacyTeamsDir()`:

1. **Skip** a folder with no `mattstack/mattstack.jsonc` carrying
   `role: "org"`, or the old `role: "team"` with an `org` field. The outcome's
   detail names it, so a leaked fixture is visible.
2. **Derive the org name** from the marker's `org`, validated with the slug
   rule. The old one-team marker carries `org` too, so a member whose clone
   is still on the old layout migrates the same way.
3. **Refuse** when the clone has uncommitted changes to tracked files
   (untracked files move with the folder), is mid-rebase, or when
   `orgs/<org>` already exists with a different origin. New rt's daemon
   never looks at `teams/` again, so nothing will commit or clean a dirty
   clone left there: the detail names the folder and says to commit the
   changes if they are yours or discard them with `git -C <folder> checkout
   -- .` on a Mac that only pulls, then run the update again. When it exists with
   the same origin, the move is already done: fall through to the record
   steps.
4. **Move under the daemon's hold.** A new daemon verb
   `org:move { from, to }` pauses that clone's snapshot engine (a per-clone
   pause is new; today the engine only stops or rescans), runs the rename and
   the record renames and the repo relocation below under the reconciler
   hold, then rescans team snapshots on the new root. The records are
   renamed before the rescan, because the engine's ownership reads
   `forgeUsername` from `rt/teams/<org>.json`. Without a daemon the migration
   does the same work directly. A daemon that does not know the verb (a
   source checkout newer than the running daemon) makes the outcome
   `failed` with the remedy `rt daemon restart`, then `rt setup update
   --force`; the migration never renames beside a running daemon.
5. **Rename records**: `rt/teams/<folder>.json` to `<org>.json` under the
   record lock in `lib/team/team-local.ts` (exported for this), and
   `rt/invites/<folder>.json` the same way. Each is skipped when already
   done.
6. **Repo index**: relocate the clone with no `repo` argument, so the
   identity row finds the moved clone and `repos.json`, `cd-cache.json`,
   the `repo-index` kv and `git_badges` follow. Inside `org:move` this is
   `planLocate` and `applyLocate` called directly, with the
   `refreshWatchedRepos` and the event the `repos:locate` handler emits;
   that handler takes the reconciler hold itself, so `org:move` must not go
   through it (`locateMovedRepo` would send `repos:locate` to the daemon
   and wait on the hold `org:move` already holds). On the no-daemon path the
   migration calls `locateMovedRepo({ newPath })` from
   `lib/repo-locate-dispatch.ts`. A `nothing-lost` refusal means rt never
   registered the clone (a member's Mac) and counts as done;
   `identity-mismatch` and `old-path-exists` are failures.
7. **Claude marketplace**: for every Claude config dir
   (`claudeConfigDirs`), read which plugins were installed from the
   marketplace and whether each is enabled, then `claude plugin marketplace
   remove <name>`, `add <orgs/<org>>` and `claude plugin install
   <plugin>@<name>` for each one, restoring its enabled state; the name
   comes from `.claude-plugin/marketplace.json`. Removing a marketplace is
   believed to uninstall its plugins, and the plugins step under `update`
   leaves a plugin alone once it has gone missing, so the reinstall is the
   migration's job; the plan verifies the CLI's behaviour first. Rewrite the
   matching `marketplaces[]` entry in `setup-state.json`.
8. **Secrets**: the sops rules are clone-relative; nothing moves.

The outcomes combine into one: `skipped` when nothing under
`legacyTeamsDir()` is marked; `failed` (detail naming the folder and the
reason, remedy `rt setup update --force` after the fix) when any clone was
refused or the move failed; `partial` (remedy carrying the exact claude
commands) when the move and records are done but the marketplace step
failed or claude is missing; else `done`. A rerun checks each piece on its
own, so a Mac that stopped halfway finishes without redoing what is done.
The migration never writes into the clone.

### Ordering against the org repo

The migration keys on the marker's `org`, present on both layouts, so a
member may migrate before or after their clone has the org layout. The only
couplings are the two above: the shared store keeps `${team:<old>}` until
the window closes, and the org layout's marker must name the folder the
migration chooses. For the live org that means the marker on `org-trial` is
corrected to the company's name before any Mac runs the migration.

## 4. Invite and join

`rt team invite` keeps carrying the inviter's org slug (the folder) in the
pointer; `rt team join` clones to `orgs/<pointer slug>`. Right after the
clone, join reads the marker. When its `org` differs from the pointer's
slug, join removes the fresh clone, restores the records it wrote before
cloning (the way its existing clone-failure path does) and refuses with
`invite-stale`: "This invite names the org by an old name; ask for a fresh
one". Inside the window no invite can carry the old name, since `rt team
invite` refuses off `main` and the live org merges after the admin has
migrated.

## 5. The conversion script

`scripts/convert-team-repo-to-org.ts` takes `--org <name>`, the marker's
`org` and the folder the migration will choose, validated with the slug
rule. The clone's basename stays the match key for `${team:<basename>}` in
old values. The script writes `${team:<basename>}` into rewritten paths by
default and `${org}` under `--org-placeholder`, for an org whose members all
run the new rt.

`mattstack.integrations` is split: `linear.teamKey` lands in the team store
and `linear.workspace`, `forge` and the slack app fields stay in the org
store (the key is `merge: "deep"`, so the two layers compose).
`mattstack.integrations.switchboard` is dropped and reported as retired.

## 6. Docs and text

`AGENTS.md`, `docs/settings-architecture.md`, `docs/home-repo.md`,
`website/docs/start/teams.mdx`, `website/docs/skills/packs.mdx`, the
`rt-settings` skill, the mattstack plugin's pack skills and the org marker
schema name `~/.mattstack/orgs/`. The plugin edit bumps its version and
runs certify. The VM clean-room scripts switch roots when the release
binary carries the new root. Specs and plans under `docs/superpowers/` are
history and are left alone.

## 7. Rollout

1. **Org repo data prep** on `org-trial`: the marker's `org` becomes the
   company's name; the empty legacy `mattstack/packs/` is deleted.
2. **Roots and placeholders** (rt): the path helpers, every literal join,
   the guard test, `${org}`, the alias, the `org.folder` row, the test
   fixtures.
3. **Migration** (rt): the migration, the `org:move` daemon verb with the
   per-clone pause, the record renames, the repo relocation, the marketplace
   re-registration with reinstall, rerun safety, and the `steps-*.test.ts`
   twins.
4. **Conversion script** (rt): `--org`, `--org-placeholder`, the
   integrations split, the switchboard drop.
5. **Docs and plugin text** (rt).
6. **Release.** Members run `rt setup update`; their clones move and the
   alias keeps their hooks working.
7. **Merge `org-trial`** to the org repo's `main`, still carrying
   `${team:<old folder>}`.
8. **The `${org}` rewrite**: one commit in the org repo once no member runs
   an older rt, then the alias is removed one release later.

Steps 2 to 5 are PRs on the mattstack repo, each reviewed and green before
merging. The release in step 6 never ships without steps 1 to 3. On the
admin's Mac the dev app runs from source, so after step 3 merges the
sequence is: pull the shared checkout, `rt daemon restart`, `rt setup
update`; the migration moves the live clone and the apps are checked in
light and dark.

## 8. Testing

- Unit tests for `orgsDir`, both scanners, `${org}`, the alias (any name,
  the segment guard, no org), the `org.folder` row's three states and the
  guard test.
- Migration tests through `steps-*.test.ts`-style fakes: a clean move, an
  unmarked folder skipped, a dirty clone refused, a rerun after each partial
  state, `nothing-lost` from the relocation, the marketplace step when
  claude is absent (`partial` with the commands), a daemon that does not
  know `org:move`, and a member's clone still on the old layout.
- A real-git test for `org:move` under the daemon hold, and for join
  refusing a clone whose marker disagrees with the pointer and leaving no
  clone or record behind.
- Conversion script tests for `--org`, both placeholder forms, the
  integrations split and the switchboard drop.
- The e2e settings test keeps asserting `${team:e2eteam}` expansion, now
  through the alias, and gains `${org}`.
- UI: console's scope badge, board and boxscore checked in the dev app in
  light and dark after the live move.

## Out of scope

- Moving attachments into the org base pack. The base pack cannot serve an
  attachment a skill reads directly, which is a separate design.
- Renaming the rt record folders (`rt/teams`, `rt/invites`).
- Renaming `--team` on the org-level verbs.
- Several orgs on one Mac (MAT-424 phase 2).

## Risks

1. A marker and folder that disagree land the live clone in the wrong place
   and block every pack write. Step 1 of the rollout fixes the marker first.
2. `${org}` in the shared store before members update breaks every role hook
   on older rt. Step 8 waits for the window to close.
3. A stale marketplace path fails silently, because the plugins step swallows
   "already added". The migration removes, re-adds and reinstalls
   explicitly.
4. The daemon races the move. The `org:move` verb runs under the hold, and
   the migration refuses to rename beside a daemon that lacks the verb.
5. A literal `teams` join survives the rename of the helper. The `no-*`
   guard test catches it on every PR.
