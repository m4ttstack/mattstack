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
- An org can be renamed by its admin with one command, and every member's
  Mac follows at its next update. The live org is renamed from its team's
  name to the company's name this way.
- A file the org shares (a reference a skill opens, a skill the board opens)
  reaches every team's pack without being copied by hand.
- A shared store value that names the org clone no longer spells out a
  folder name, so a rename never touches shared content.
- A Mac on an older rt keeps working until the org repo's `main` takes the
  org layout, the window the parent spec already accepts.

## Decisions taken

| Question | Decision |
|---|---|
| Root folder | `~/.mattstack/orgs/`. `~/.mattstack/teams/` is legacy: only converge, the `org.folder` row and `rt home init` name it. |
| Org identity | The marker's `org` field (`mattstack/mattstack.jsonc`). The folder name must match it; the `org.folder` setup row reports a mismatch. |
| `${team:<name>}` | Kept as a deprecated alias: any single-segment name resolves to the current org clone. Warns once per process. Removed one release after `${org}` lands in the shared store. |
| `${org}` | New placeholder: the current org clone's root. Throws on a Mac with no org. |
| An unmigrated clone | New rt never reads `teams/`. The `org.folder` row reports a marked clone there as `needs-you` with the remedy `rt setup update --force`. No symlink. |
| rt records | `~/.mattstack/rt/teams/<org>.json` and `rt/invites/<org>.json` keep their folder names; only the per-org file is renamed. |
| Claude marketplace | Converge drives the claude CLI: remove, add, then reinstall the packs that came from that marketplace. When any of it fails, the step ends `partial` with the commands as its remedy. |
| Daemon | The move runs under a daemon hold that pauses that clone's team sync; the daemon is never restarted by converge. |
| Stray folders | A folder under `teams/` with no org marker is skipped and named in the outcome. |
| Shared store rewrite | Never from converge. `${team:<name>}` values on `main` stay until every member runs the new rt; one later commit rewrites them to `${org}`. |
| Conversion script | Gains `--org <name>`; the folder name stays the match key for old values. |
| Renaming | `rt team rename <name>` writes the marker and publishes; every Mac converges its folder on its next update. The same converge step does the first move to `orgs/`. |
| Base pack attachments | Compile writes a base pack's attachments into the team pack it compiles, so a file a skill opens at run time reaches every team. A team's own attachment of the same name wins. |

## 1. Paths

`orgsDir()` is `~/.mattstack/orgs`; `orgDir(org)` is `join(orgsDir(),
org)`. Both live in `lib/rt-paths.ts` (the authority) and
`packages/rt-client/src/settings/paths.ts` (the mirror), as today's
`teamsDir()` and `orgDir()` do. `teamsDir()` is renamed `legacyTeamsDir()`;
its only callers are converge, the `org.folder` row and `rt home init`.

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
converge step (section 3) moves a clone to, and `packOrg` already refuses a
pack write when marker and folder disagree.

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
commit in the org repo after the window closes, never part of converge.

## 3. Converging the folder to the org's name

The org's name lives in the org repo, as the marker's `org`. Each Mac's
folder follows it: a function `convergeOrgFolder` moves a clone whose folder
does not match its marker, and moves a marked clone out of the legacy root.
It is not a one-time migration. It runs on every `rt setup update` and every
full `rt setup apply`, so the same code serves the move to `orgs/` on the
first update and every later rename.

It runs as the update-safe step `org.folder`, placed before `org.pull` in
`runUpdateWith`, and `org.pull` calls it again when a pull changed the
marker's `org`. The step is idempotent: a Mac whose folder already matches
reports `done` with no work.

For each marked clone (under `orgsDir()` whose marker disagrees with its
folder, or under `legacyTeamsDir()`):

1. **Skip** a folder with no `mattstack/mattstack.jsonc` carrying
   `role: "org"`, or the old `role: "team"` with an `org` field. The detail
   names it, so a leaked fixture is visible.
2. **Derive the target** `orgs/<marker org>`, validated with the slug rule.
   The old one-team marker carries `org` too, so a member whose clone is
   still on the old layout moves the same way.
3. **Refuse** when the clone has uncommitted changes to tracked files
   (untracked files move with the folder), is mid-rebase, or when the target
   already exists with a different origin. Nothing commits or cleans a dirty
   clone that stays behind under `teams/`, so the detail names the folder
   and says to commit the changes if they are yours or discard them with
   `git -C <folder> checkout -- .` on a Mac that only pulls, then run the
   update again. When the target exists with the same origin, the move is
   already done: fall through to the record steps.
4. **Move under the daemon's hold.** A new daemon verb
   `org:move { from, to }` pauses that clone's snapshot engine (a per-clone
   pause is new; today the engine only stops or rescans), runs the rename,
   the record renames and the repo relocation below under the reconciler
   hold, then rescans team snapshots. The records are renamed before the
   rescan, because the engine's ownership reads `forgeUsername` from
   `rt/teams/<org>.json`. Without a daemon the step does the same work
   directly. A daemon that does not know the verb (a source checkout newer
   than the running daemon) makes the outcome `failed` with the remedy
   `rt daemon restart`, then `rt setup update --force`; the step never
   renames beside a running daemon.
5. **Rename records**: `rt/teams/<old>.json` to `<org>.json` under the
   record lock in `lib/team/team-local.ts` (exported for this), and
   `rt/invites/<old>.json` the same way. Each is skipped when already done.
6. **Repo index**: relocate the clone with no `repo` argument, so the
   identity row finds the moved clone and `repos.json`, `cd-cache.json`,
   the `repo-index` kv and `git_badges` follow. Inside `org:move` this is
   `planLocate` and `applyLocate` called directly, with the
   `refreshWatchedRepos` and the event the `repos:locate` handler emits;
   that handler takes the reconciler hold itself, so `org:move` must not go
   through it (`locateMovedRepo` would send `repos:locate` to the daemon
   and wait on the hold `org:move` already holds). Without a daemon the step
   calls `locateMovedRepo({ newPath })` from `lib/repo-locate-dispatch.ts`.
   A `nothing-lost` refusal means rt never registered the clone (a member's
   Mac) and counts as done; `identity-mismatch` and `old-path-exists` are
   failures.
7. **Claude marketplace**: for every Claude config dir
   (`claudeConfigDirs`), read which plugins were installed from the
   marketplace and whether each is enabled, then `claude plugin marketplace
   remove <name>`, `add <new folder>` and `claude plugin install
   <plugin>@<name>` for each one, restoring its enabled state; the name
   comes from `.claude-plugin/marketplace.json`. Removing a marketplace is
   believed to uninstall its plugins, and the plugins step under `update`
   leaves a plugin alone once it has gone missing, so the reinstall is this
   step's job; the plan verifies the CLI's behaviour first. Rewrite the
   matching `marketplaces[]` entry in `setup-state.json`.
8. **Secrets**: the sops rules are clone-relative; nothing moves.

The outcomes combine into one: `done` when nothing needed moving or every
move finished; `failed` (detail naming the folder and the reason, remedy
`rt setup update --force` after the fix) when any clone was refused or a
move failed; `partial` (remedy carrying the exact claude commands) when the
move and records are done but the marketplace step failed or claude is
missing. A rerun checks each piece on its own, so a Mac that stopped halfway
finishes without redoing what is done. The step never writes into the
clone.

### When a member's Mac converges

`rt setup update` runs once per rt version unless forced, so a rename that
reaches a member's clone through a pull converges at their next update: the
next release, or `rt setup update --force`, which the rename's own
announcement names. Until then the member's folder keeps the old name and
everything keeps working, since every reader keys on the folder; the
`org.folder` row reads `error` with that remedy. Members only pull, so the
pack-write refusal on a mismatch never touches them.

## 4. Renaming an org

`rt team rename <name>` is the admin's verb.

- Only an org admin may run it (`currentRole` is `admin`); anyone else is
  refused with `rename-not-admin`.
- `<name>` must pass the slug rule and differ from the current name; a
  name already used by another clone under `orgsDir()` is refused.
- It refuses a clone with uncommitted changes or one behind its origin, the
  same guards `rt team publish` applies.
- It writes the marker's `org`, commits `org: rename to <name>` on the
  checked-out branch (branch following applies: a rename on a trial branch
  reaches only Macs on that branch), and publishes.
- It then runs `convergeOrgFolder` on this Mac, so the admin's folder,
  records, repo index and marketplace follow at once.
- The result names what members do next: their Mac converges at its next
  update, or now with `rt setup update --force`.

The command is `agentSafe: false`; renaming is a person's decision.
`--json` returns `{ ok, from, to, converged }` and the refusal codes above.
A command description in `lib/command-tree-def.ts` reads "Rename your org".

The marketplace's own name (`.claude-plugin/marketplace.json`), the base
pack's folder name and the team folder names are independent of the org's
name and are not touched. `${team:<old>}` values in the shared store keep
resolving through the alias.

## 5. Invite and join

`rt team invite` keeps carrying the inviter's org slug (the folder) in the
pointer; `rt team join` clones to `orgs/<pointer slug>`. Right after the
clone, join reads the marker. When its `org` differs from the pointer's
slug, join removes the fresh clone, restores the records it wrote before
cloning (the way its existing clone-failure path does) and refuses with
`invite-stale`: "This invite names the org by an old name; ask for a fresh
one". An admin's invite always carries the current name, since the
admin's folder converges as part of the rename.

## 6. The conversion script

`scripts/convert-team-repo-to-org.ts` takes `--org <name>`, the marker's
`org`, validated with the slug rule; without it the clone's basename is the
org, as today. The basename stays the match key for `${team:<basename>}` in
old values. The script writes `${team:<basename>}` into rewritten paths by
default and `${org}` under `--org-placeholder`, for an org whose members all
run the new rt. (The `mattstack.integrations` split and the switchboard drop
shipped in #726.)

## 7. The org base pack reaches every team

The parent spec puts shared fills and attachments in an org base pack
(`mattstack/org/packs/<base>/`, `"base": true`, never installed) and has
compile inline a base's fills into a team's verbs. That covers text a skill
carries. It does not cover a file a skill opens at run time by path, or one
the board opens by name: the base is never installed, so at run time the
file must sit inside the team's pack, the one thing a Mac installs.

Compile therefore writes a base's attachments into the team pack it
compiles:

- A team pack names its base with `"extends": "<base>"` in its
  `pack/skills.jsonc` (already supported).
- For each `attachments/<name>/` in the base, compile writes
  `attachments/<name>/` in the team pack with `compiled:` metadata naming
  the base and its version, exactly as it writes compiled stages today.
- A team that has its own source `attachments/<name>/` keeps it: the
  team's copy wins, and compile emits nothing for that name.
- The emitted files go through the same placeholder expansion as a compiled
  stage, in the team pack's context, so `{{verb.path:<verb>}}` and
  `{{pack.path:<attachment>/<file>}}` resolve to the team pack. A new
  placeholder, `{{pack.name}}`, expands to the compiling pack's plugin name,
  so a base attachment can name a team verb as `{{pack.name}}:ship`.
- `rt skills check` reports an emitted attachment whose base source changed
  as drift, and compile removes an emitted attachment whose base source is
  gone (it removes only output it wrote, by its `compiled:` metadata).

Then the shared attachments move: a base pack named for the org is created
(`<org>-base`, so `acme-base` for the acme org), the org-wide attachments move into
it with their team-specific names replaced by `{{pack.name}}`, and each
mixed attachment splits into a base version and a team override. That is
pack editing in the org repo under the editing-skills process (bump,
certify, compile, check), not rt code.

## 8. Docs and text

`AGENTS.md`, `docs/settings-architecture.md`, `docs/home-repo.md`,
`website/docs/start/teams.mdx`, `website/docs/skills/packs.mdx`, the
`rt-settings` skill, the mattstack plugin's pack skills and the org marker
schema name `~/.mattstack/orgs/`, `rt team rename` and the base pack's
attachments. The plugin edit bumps its version and runs certify. The VM
clean-room scripts switch roots when the release binary carries the new
root. Specs and plans under `docs/superpowers/` are history and are left
alone.

## 9. Rollout

1. **Org repo data prep** on `org-trial`: delete the empty legacy
   `mattstack/packs/`. The marker keeps its current name; the rename is
   the last step, through the feature.
2. **Roots and placeholders** (rt PR): the path helpers, every literal join,
   the guard test, `${org}`, the alias, the `org.folder` row, the test
   fixtures.
3. **Converge** (rt PR): `convergeOrgFolder`, the `org.folder` step, the
   `org:move` daemon verb with the per-clone pause, the record renames, the
   repo relocation, the marketplace re-registration with reinstall, rerun
   safety, the `steps-*.test.ts` twins.
4. **Rename and conversion** (rt PR): `rt team rename`, `invite-stale` in
   join, the conversion script's `--org` and `--org-placeholder`.
5. **Base pack attachments** (rt PR): compile writes a base's attachments
   into the team pack, `{{pack.name}}`, check and cleanup.
6. **Docs and plugin text** (rt PR).
7. **Release.** Members update; their clones move from `teams/` to
   `orgs/<current name>` and the alias keeps their hooks working.
8. **Merge `org-trial`** to the org repo's `main`; members run
   `rt setup update --force` (already the plan for the org layout).
9. **Rename**: the admin runs `rt team rename <name>` on `main`; members
   converge at their next update or with `--force`.
10. **Base pack content**: create `<org>-base`, move the shared
    attachments, split the mixed ones, recompile the team pack, publish.
11. **The `${org}` rewrite**: one commit in the org repo once no member runs
    an older rt, then the alias is removed one release later.

Steps 2 to 6 are PRs on the mattstack repo, each reviewed and green before
merging. The release in step 7 never ships without steps 2 to 4. On the
admin's Mac the dev app runs from source, so after step 3 merges the
sequence is: pull the shared checkout, `rt daemon restart`, `rt setup
update`; the clone moves to `orgs/` and the apps are checked in light and
dark.

## 10. Testing

- Unit tests for `orgsDir`, both scanners, `${org}`, the alias (any name,
  the segment guard, no org), the `org.folder` row's three states and the
  guard test.
- Converge tests through `steps-*.test.ts`-style fakes: a clean move from
  `teams/`, a rename inside `orgs/`, a folder already matching (no work),
  an unmarked folder skipped, a dirty clone refused, a rerun after each
  partial state, `nothing-lost` from the relocation, the marketplace step
  when claude is absent (`partial` with the commands), a daemon that does
  not know `org:move`, a member's clone still on the old layout, and
  `org.pull` re-running converge after a pull that changed the marker.
- A real-git test for `org:move` under the daemon hold, and for join
  refusing a clone whose marker disagrees with the pointer and leaving no
  clone or record behind.
- `rt team rename` tests: admin only, slug rule, same name, a taken name,
  dirty and behind refusals, the marker commit on a trial branch, and the
  local converge that follows; the `--json` envelope.
- Compile tests for base attachments: emitted with `compiled:` metadata, a
  team override wins, placeholders resolve in the team pack's context,
  `{{pack.name}}`, drift after a base change, cleanup after a base removal.
- Conversion script tests for `--org` and both placeholder forms.
- The e2e settings test keeps asserting `${team:e2eteam}` expansion, now
  through the alias, and gains `${org}`.
- UI: console's scope badge, board and boxscore checked in the dev app in
  light and dark after the move and after the rename.

## Out of scope

- Installing the org base pack itself, or a base pack on its own.
- Renaming the rt record folders (`rt/teams`, `rt/invites`).
- Renaming `--team` on the org-level verbs.
- Renaming a team folder (`mattstack/teams/<team>`).
- Several orgs on one Mac (MAT-424 phase 2).

## Risks

1. A marker and folder that disagree block every pack write until the Mac
   converges. Members only pull, and the admin converges as part of the
   rename.
2. `${org}` in the shared store before members update breaks every role hook
   on older rt. Step 11 waits for the window to close.
3. A stale marketplace path fails silently, because the plugins step swallows
   "already added". Converge removes, re-adds and reinstalls explicitly.
4. The daemon races the move. The `org:move` verb runs under the hold, and
   converge refuses to rename beside a daemon that lacks the verb.
5. A literal `teams` join survives the rename of the helper. The `no-*`
   guard test catches it on every PR.
6. A base attachment written for one team leaks that team's name into
   another. `{{pack.name}}` replaces the name, and the base pack review in
   step 10 reads every moved file.
