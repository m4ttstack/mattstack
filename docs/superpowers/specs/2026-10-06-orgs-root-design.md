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
marker's `org`. The step is idempotent: on every run it checks each piece
below against the clone as it stands now, does only the pieces that are
off, and reports `done` with no work when every piece already matches. It
never decides from the folder name alone that there is nothing to do, so a
run that stopped halfway (a move done, the records or the marketplace not)
finishes at the next run.

For each marked clone under `orgsDir()` and under `legacyTeamsDir()`:

1. **Skip** a folder with no `mattstack/mattstack.jsonc` carrying
   `role: "org"`, or the old `role: "team"` with an `org` field. The detail
   names it, so a leaked fixture is visible.
2. **Derive the target** `orgs/<marker org>`, validated with the slug rule.
   The old one-team marker carries `org` too, so a member whose clone is
   still on the old layout moves the same way. The clone's current folder
   name is `<folder>`; it equals `<org>` once the folder piece is done.
3. **Refuse** a pending folder piece when the clone has uncommitted
   changes to tracked files (untracked files move with the folder), is
   mid-rebase, or when the target already exists with a different origin.
   Nothing commits or cleans a dirty clone that stays behind under
   `teams/`, so the detail names the folder and says to commit the changes
   if they are yours or discard them with a checkout of the tracked files
   on a Mac that only pulls, then run the update again. A target that
   exists with the same origin while the source folder is gone means the
   folder piece is done; the other pieces still run.
4. **Hold the daemon.** A new daemon verb `org:move { from, to }` pauses
   that clone's snapshot engine (a per-clone pause is new; today the engine
   only stops or rescans), copies the records, renames the folder, runs
   the repo relocation below and then removes the old records, in that
   order under the reconciler hold, then rescans team snapshots. The copy
   goes first because the folder is the only thing that remembers the old
   name: once it has moved, nothing says what `rt/teams/<old>.json` was
   called. The old copy stays until the folder has moved, so a move that
   fails leaves every reader keyed on the old folder with its record, and
   a run interrupted after the move still finds the new copy. The engine's
   ownership reads `forgeUsername` from `rt/teams/<org>.json` after the
   rescan, by which time the folder matches. Without a daemon the
   step does the same work directly, in the same order. A daemon that does
   not know the verb (a source checkout newer than the running daemon)
   makes the outcome `failed` with the remedy `rt daemon restart`, then
   `rt setup update --force`; the step never renames beside a running
   daemon.
5. **Copy records**: `rt/teams/<folder>.json` to `<org>.json` under the
   record lock in `lib/team/team-local.ts` (exported for this), and
   `rt/invites/<folder>.json` the same way. The piece is done when
   `<org>.json` exists; it is skipped when neither name exists (a Mac with
   no record for this clone).
6. **Move the folder**: rename the clone to `orgs/<org>`. Done when the
   clone already sits there. Once it sits there, and after the relocation
   below, remove `rt/teams/<folder>.json` and `rt/invites/<folder>.json`
   for the old name; an old-name record with no folder beside it is
   removed on any later run too.
7. **Repo index**: relocate the clone with no `repo` argument, so the
   identity row finds the moved clone and `repos.json`, `cd-cache.json`,
   the `repo-index` kv and `git_badges` follow. Inside `org:move` this is
   `planLocate` and `applyLocate` called directly, with the
   `refreshWatchedRepos` and the event the `repos:locate` handler emits;
   that handler takes the reconciler hold itself, so `org:move` must not go
   through it (`locateMovedRepo` would send `repos:locate` to the daemon
   and wait on the hold `org:move` already holds). Without a daemon the step
   calls `locateMovedRepo({ newPath })` from `lib/repo-locate-dispatch.ts`.
   It runs on every pass: a row that already carries the current path and a
   `nothing-lost` refusal (rt never registered the clone, as on a member's
   Mac) both count as done; `identity-mismatch` and `old-path-exists` are
   failures.
8. **Claude marketplace**: for every Claude config dir
   (`claudeConfigDirs`), read the registered marketplaces
   (`parseMarketplaceList` in `lib/setup/steps/plugins.ts` over
   `claude plugin marketplace list --json`) and find the one whose name is
   this clone's `.claude-plugin/marketplace.json` name. The piece is done
   when its source path is the clone's current folder, and skipped when the
   marketplace is not registered at all. Else read which plugins were
   installed from it and whether each is enabled, then `claude plugin
   marketplace remove <name>`, `add <current folder>` and `claude plugin
   install <plugin>@<name>` for each one, restoring its enabled state.
   Removing a marketplace is believed to uninstall its plugins, and the
   plugins step under `update` leaves a plugin alone once it has gone
   missing, so the reinstall is this step's job; the plan verifies the
   CLI's behaviour first. Rewrite the matching `marketplaces[]` entry in
   `setup-state.json`.
9. **Secrets**: the sops rules are clone-relative; nothing moves.

The outcomes combine into one: `done` when every piece matched or every
pending piece finished; `failed` (detail naming the folder and the reason,
remedy `rt setup update --force` after the fix) when a folder piece was
refused or a rename, move or relocation failed; `partial` (remedy carrying
the exact claude commands) when records, folder and index are done but the
marketplace piece failed or claude is missing. The step never writes into
the clone.

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
one". The admin who ran the rename mints invites under the new name at
once, since the rename converges that Mac; another admin's Mac, or an
invite minted before the rename, carries the old name until that Mac
converges, and the refusal covers both.

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
  `pack/skills.jsonc`. Materialize and the manifest merge already read it;
  compile today registers every org base pack for fills and never reads
  `extends`, so it learns to, and a pack without `extends` emits nothing.
- **Which attachments:** every `attachments/<name>/` in the base except one
  whose `SKILL.md` carries `metadata.provides`: that is a fill, and
  compile already inlines it into the team's verbs.
- **Where:** `attachments/<name>/` in the team pack. Each emitted folder
  carries `compiled.json` at its root, naming the base, its version and
  every file compile wrote there. That file is the provenance: a folder
  with it is compile's output and is rewritten on every compile; a folder
  without it is the team's own. `isCompiledDir` in `commands/skills.ts` and
  the mcp lint treat a folder carrying `compiled.json` as compiled output,
  the way they treat a `SKILL.md` opening with the compiler header.
- **The team's copy wins:** a team source `attachments/<name>/` (no
  `compiled.json`) keeps its content and compile emits nothing for that
  name. To override a base attachment the team deletes the emitted folder
  and authors its own.
- **Clashes:** a base attachment whose name is a compile target of the team
  pack (either side, `verbSides`) or a hand-authored `skills/<name>` is a
  compile error naming both.
- **Order:** compile emits the base attachments first, before any target
  compiles, so `{{pack.path:<attachment>/<file>}}` in a team verb finds the
  emitted file on disk on a clean compile as well as a recompile. The
  existence check in `packPath` stays; its comment, which says only
  pack-authored source is addressable, is updated to say emitted base
  attachments are too, since they are on disk before targets compile.
- **Placeholders:** an emitted `.md` file gets exactly three placeholders:
  `{{pack.name}}` (new) expands to the compiling pack's plugin name, so a
  base attachment can name a team verb as `{{pack.name}}:ship`;
  `{{verb.path:<verb>}}` and `{{pack.path:<attachment>/<file>}}` resolve
  as for a fill, in the team pack. `verb.path` is computed from the emitted
  file's own depth under the pack, so a file at
  `attachments/<name>/references/x.md` gets one more `../` than the
  folder's `SKILL.md`. Any other `{{...}}` text in a `.md` file passes
  through unchanged, and every non-`.md` file is copied byte for byte, so a
  script or a template example that carries braces compiles. This is a new
  function beside `substituteIncludesOnly`, not `substitute`, which needs
  an engine's slots and stage metadata.
- **Drift and cleanup:** `rt skills check` compares each emitted folder to a
  fresh emit and reports a difference as drift. Compile removes an emitted
  folder (one carrying `compiled.json`) whose base no longer has that
  attachment, or whose pack no longer extends a base.

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
  `teams/`, a rename inside `orgs/`, every piece already matching (no
  work), a folder that matches with a stale record, index row or
  marketplace path (only that piece runs), an unmarked folder skipped, a
  dirty clone refused, a rerun after an interruption at each point of the
  record-folder-index order, `nothing-lost` from the relocation, the marketplace step
  when claude is absent (`partial` with the commands), a daemon that does
  not know `org:move`, a member's clone still on the old layout, and
  `org.pull` re-running converge after a pull that changed the marker.
- A real-git test for `org:move` under the daemon hold, and for join
  refusing a clone whose marker disagrees with the pointer and leaving no
  clone or record behind.
- `rt team rename` tests: admin only, slug rule, same name, a taken name,
  dirty and behind refusals, the marker commit on a trial branch, and the
  local converge that follows; the `--json` envelope.
- Compile tests for base attachments: emitted with `compiled.json`, a fill
  or include not emitted, a team override wins, a name clash refused,
  `{{pack.path}}` to an emitted file on a clean compile, the three
  placeholders in a nested `.md`, braces in a script untouched,
  `{{pack.name}}`, drift after a base change, cleanup after a base removal
  and after `extends` is dropped, `isCompiledDir` on an emitted folder.
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
