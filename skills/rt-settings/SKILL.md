---
name: rt:settings
description: Use when reading or writing any mattstack app setting (rt, deck, mr-board, gitq, console), adding or registering a settings key, choosing its scope (org/team/user/machine), reading or writing another team's value, porting an app's config file into ~/.mattstack, changing a setting from a script, or writing code that reads configuration from anywhere other than the settings resolver: a hand-edited settings jsonc, an invented config file or store path, an env var for something a human configures. Also use when a setting resolves undefined (or getSetting throws unknown-key) for a key that looks configured, and when the org repo's shape changes in a way an older rt cannot read: bumping ORG_LAYOUT, writing a conversion, trying a new org layout on the dev app, or an org.layout row that reads skipped or needs-you.
---

# The settings contract

Every mattstack app setting is a declared key in the suite settings stores,
resolved by one shared resolver. The instinct "just write a config file" —
or "just sed the jsonc" — is the bug this contract exists to prevent.

## The contract

1. Read with `getSetting`, write with `setSetting` — from
   `@mattstack/rt-client` in apps, from `lib/settings/resolve.ts` /
   `lib/settings/write.ts` inside the mattstack repo, and `rt settings
   get/set/list/explain` from shells and scripts (a `set` takes a JSON
   value, so wrap string values in JSON double-quotes: a literal as
   `'"matt"'`, a shell variable as `"\"$var\""`; and it always names its
   scope with `--scope org|team|user|machine`, since scope is never
   inferred). Never edit a settings `*.jsonc` by hand (sed/jq included),
   never invent an app config file, never construct a store path —
   `setSetting` preserves comments and refuses malformed or duplicate-key
   files that a hand edit would silently corrupt into a store that reads
   as empty.
2. Every key is DECLARED: a registry row in
   `packages/rt-client/src/settings/registry-defs.ts` (type, allowed scopes,
   merge, description — add a `default` only after clearing line 5; a
   ported `board.*` row never has one). An explicit `getSetting` of an undeclared key
   THROWS; an undeclared key found in a store file warns and is skipped.
   A new key is the registry row first, then delivery: rt itself sees the
   row immediately. Board, console, deck and gitq link rt-client as an
   in-tree `workspace:*` package, so the next `bun install` (root
   `postinstall` rebuilds rt-client's `dist/`) or turbo build picks up the
   new key; deck and gitq additionally bundle rt-client into their own
   compiled binaries, so each needs a rebuild at the next release to ship
   it. gitq's npm bundle (`dist/gitq.js`) also carries rt-client, so an
   npm-installed `gitq` only sees the key after `bun run release` from
   `apps/gitq`; the add-a-key checklist in the routed doc carries the real
   per-consumer delivery steps. A key that resolves undefined (or throws
   unknown-key) in one app while `rt settings` knows it is a stale
   `dist/` (rebuild rt-client), not a missing value.
3. Scopes, weakest to strongest: `default < org < team < user < org.repo <
   team.repo < user.repo < machine < machine.repo`. Most-specific wins:
   machine outranks user outranks team outranks org. Pick the scope by whose
   intent it is: the same for every team in the org goes to `org`, how one
   team works goes to `team`, this human on every machine goes to `user`,
   this machine only goes to `machine`. Every key that allows `team` also
   allows `org`. Path literals are legal only in the machine store; a
   shared value names a path with a variable the resolver expands on read:
   `${repoRoot}`, `${worktree}`, `${home}`, or `${org}` (the org clone's
   root, so `"bun ${org}/mattstack/scripts/hook.sh"`; a member's clone is
   sparse (cone mode) and holds only `.claude-plugin/`, `mattstack/` and
   the repo's top-level files, so a path under `${org}` names something
   there). `${team:<name>}` is a
   deprecated alias for `${org}` that ignores the name and warns, and both
   throw on a Mac with no org. An older
   rt passes `${org}` through verbatim, so an org or team store keeps
   `${team:<org>}`, in existing values and new ones, until every member
   runs an rt that knows `${org}`; then one commit rewrites them all. A
   machine store takes `${org}` now.
   The `team` layer is the ACTIVE team's folder only; other teams' folders
   are never folded in. The active team is the one `mattstack.activeTeam`
   names when the roster lists you on it, else your first roster team; a
   Mac with no stored forge username takes the folder `mattstack.activeTeam`
   names when it exists. Name one to reach it: read with
   `getSetting(key, { team: "gadgets" })`, write with
   `setSetting(key, value, "team", { team: "gadgets" })` or
   `rt settings set <key> <value> --scope team --team gadgets` (`--team`
   goes only with `--scope team`). A team write that names no team lands in
   the active team, and is refused when there is none. An `org` write takes
   no name.
   The row's `merge` says how layers combine: `replace` (strongest layer
   wins), `deep` (objects merge field by field, so the org can hold one
   field of an object and a team another), `add` (arrays from every
   layer, user and machine included, concatenate weakest first with
   duplicates dropped; `claude.plugins` and `claude.marketplaces` use it,
   and `getSetting` also returns `items` with each item's layers).
4. The stores are git-backed and travel — scope lives in the filename. The
   user store (`user/settings.user.jsonc`) AND the machine store
   (`user/local/<machine-key>/settings.local.jsonc` — tracked, keyed per
   machine) live in the personal home repo (`~/.mattstack/user` IS that
   repo), and the home-snapshot daemon auto-commits and pushes them within
   ~80s. The org store
   (`~/.mattstack/orgs/<org>/mattstack/org/settings.org.jsonc`) and each
   team store
   (`~/.mattstack/orgs/<org>/mattstack/teams/<team>/settings.team.jsonc`)
   live in the one org repo on this Mac, which the team sync engine
   commits and pushes the same way, so an `org` or `team` write reaches
   every member with no hand commit. The engine reads, pulls and pushes the
   branch the clone has checked out (`orgBranch`), and it never pulls a
   clone onto a tip whose layout is above this rt's `ORG_LAYOUT` (the
   section below). `setSetting` prints a tip only when that sync cannot
   run. Which team you work as is `rt team use <team>`, which also swaps
   the team pack and restarts the apps that read it; the org-only
   `mattstack.directory` holds each team's review channel and Linear key. Roles in the org's `mattstack.org` setting decide
   who writes: an admin writes the org store and every team's, a team's
   owner writes that team's store, and a member writes neither. A refused
   team write names that team's owners, then the org's admins; a refused
   org write names the admins.
5. A registry `default` is the sharpest field on a row: it materializes as
   a present value on every install. A `board.*` row ported from the
   board's legacy config never carries `default:`: the fallback lives in
   the app-side read (`getSetting(k).value ?? fallback`), never in the
   row, and writing both is still the bug. A fresh `board.*` key that was
   never in that file may carry one (`board.reReview`, `board.peerAsks`
   do), and its row says so. Keys ported from an app's legacy config file omit
   defaults for a second reason: the ownership latch —
   `getSetting(key).value === undefined` means the legacy file still owns
   it, and a default flips the key store-authoritative. Any registry
   block's own comment binds every row added under it.
6. A secret is never a setting: tokens and keys live in the sops-encrypted
   secrets store, read env-first, then the daemon's token-gated
   `secrets:read`.
7. Repo-scoped sections key on the RAW `host/path` identity, never the
   serialized `remote:…` wire form — the rt:repo-identity skill owns that
   boundary.
8. A `repoOnly` key (`rt.roles`, `rt.intercepts`, `rt.worktrees`,
   `rt.worktreeReadyApproval`, `rt.hooks`, `rt.sync`, `rt.branchNaming`,
   `rt.presets`, `rt.variations`, `rt.dopplerTemplate`, `rt.ignoredMrs`,
   `board.codeowners`)
   lives only in repo sections: every write names the repo (`--repo`,
   `repoIdentity`), and a global value is refused on read and write. The
   same value for several repos is one write per repo; a convention for
   every team goes in each repo's section of the org store, one team's in
   that repo's section of the team store. `rt.gitStatus` is the one
   per-repo key that also takes a global value.

`rt settings explain <key>` shows per-scope provenance and is the first
move on any "why is this value what it is" question.

## Changing the org repo's layout

A layout change is a change to the org repo's shape that an older rt cannot
read: a moved folder, a renamed store, or a change to the shape of the
shared settings that an older app would misread or lose, such as a
migration that moves keys into a new org key and deletes the old ones (the
team directory did this). Each gets the same `ORG_LAYOUT` bump and branch
flow below. The marker
(`mattstack/mattstack.jsonc`) carries `layout`; `ORG_LAYOUT` in
`lib/team/org-marker.ts` is the highest layout this rt reads, and it moves
only with such a change, never with a release. A clone on any other layout
is `waiting`, not a failure: materialize writes nothing, the `rt skills`
verbs refuse with the waiting sentence, the apps run as on a Mac with no
org, and the `org.layout` row of `rt setup status` says why. The daemon
never pulls a clone onto a tip above its `ORG_LAYOUT`: it holds at the last
commit it reads and the row says to update the app (every app from v2.21.1
on holds this way; `rt team pull` and `rt skills sync` hold too). rt reads,
syncs and publishes the branch the clone has checked out, so an admin can
try the new shape on a branch while every member stays on main;
`rt team invite` refuses off main. Automatic org migrations, where rt
converts the admin's clone itself, are a planned follow-up and not built:
the conversion is a script the admin runs once.

In this order:

1. **Land the rt change on main** (a PR, as any rt change): bump `ORG_LAYOUT`, write the readers
   for the new shape, and write the conversion script. The layout 2 one is
   `bun scripts/move-team-packs-to-plugin.ts <clone-dir> --admin <username>`
   (plans; `--write` moves and commits). A conversion to layout 3 or later
   also writes `layout: <n>` in the marker. Every marker rt writes carries
   an explicit `layout` (`rt team create` writes `ORG_LAYOUT`, the layout 2
   script writes 2), and a `role: "org"` marker with no field reads 2, a
   fixed default (`ORG_LAYOUT_ABSENT_DEFAULT`) that never follows the bump,
   so an unconverted clone never reads as ready.
2. **Test it on the dev app.** The dev app runs rt from the shared
   checkout (the one `rt dev setup` recorded, else
   `~/Documents/GitHub/mattstack`), which sits on main, so once the change
   is merged, pulled there and the daemon restarted (rt:build-dev-app's
   pull and restart, with its #rt notice) its rt reads the new layout and
   your own clone, still on the old layout, reads as waiting. Put the clone
   on a branch and convert there: in `~/.mattstack/orgs/<org>`,
   `git switch -c <branch>` and `git push -u origin <branch>` (the script
   needs origin to have the branch); turn team sync off on this Mac
   (`rt settings set rt.teamSnapshot '{"enabled": false}' --scope machine`,
   then `rt daemon restart`; the script refuses while sync is on, since
   sync could publish the move before you review it); run the script with
   `--write`; review with `git show`; `rt team publish`; turn sync back on
   (`rt settings unset rt.teamSnapshot --scope machine`, then
   `rt daemon restart`). `rt setup status` now shows `org.layout` as
   `ready` on your Mac, read from that branch, and members' clones stay on
   main. Use it until you are happy; to try again, reset the branch and
   rerun the script.
3. **Merge the converted branch into the org repo's main**, before or after
   the release. Merge first: every member's daemon holds at the last
   old-layout commit and their row names the app update, so nothing on
   their Macs changes until they update. Release first: a member on the new
   app sees the waiting row and runs without their org settings until the
   merge lands. Before merging, check the branch keeps the marketplace name
   and plugin name in `.claude-plugin/marketplace.json`: a renamed
   marketplace is a new registration no member's Mac can make.
4. **Release the rt that reads the new layout** with rt:release. If any
   member could be on an app older than the gate (below v2.21.1), declare
   the intermediate update in `rt-tray/sparkle-minimum-update`
   (`release=<this version>`, `minimum=<the latest published release>`,
   which must be v2.21.1 or later). The release's appcast step
   (`scripts/release/appcast.sh`) refuses unless the published feed
   already carries the minimum's item, and the prepare leg of rt:release
   checks `releases/latest` before the tag.
5. **Members convert on their own.** On the new app, the daemon's next pull
   fast-forwards the clone onto the converted commit, and its pull hooks
   update the pack plugin and rewrite the bindings; a launch's `rt setup
   update` (`org.folder`, `org.pull`, migrations, then the update-safe
   steps) sees a ready org. Nobody but the admin runs the conversion.
6. **Delete the branch** once main holds the conversion and every member is
   on the layout release, and switch your clone back: `git switch main`.

The gate itself reached the old line as v2.21.1, a patch release tagged from
`release/v2.21.x`, a branch cut from the v2.21.0 tag because main already
carried the breaking change; a fix that must reach Macs before the next
minor goes the same way.

## Where the details live

| Need | Read |
|---|---|
| Full architecture: three-layer rule, store files on disk, resolver semantics, the add-a-key checklist, porting + ownership latch, the marker's layout version, footguns (call-time HOME, stale copies, sops cwd) | `docs/settings-architecture.md` in the mattstack checkout (on a dev Mac the one `rt dev setup` recorded, else `~/Documents/GitHub/mattstack`; the app bundle's skills folder carries no docs) |
| Which identity form keys what — raw vs serialized | `docs/repo-identity.md`, same checkout |
| Per-app key tables (which key, which scope, what shape) | `docs/superpowers/specs/2026-08-20-suite-settings-migration.md`, same checkout |
| Resolver API | `packages/rt-client/README.md`, same checkout (every consumer links the workspace package; nothing is published) |
