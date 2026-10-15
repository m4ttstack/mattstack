---
paths:
  - "packages/rt-client/src/settings/**"
  - "lib/team/**"
  - "packages/settings-kit/**"
  - "scripts/move-*.ts"
---

# Settings

## Settings architecture

Every key any mattstack app reads lives in the suite settings stores behind
the resolver in `packages/rt-client`. Before adding a key, porting config, or
touching `~/.mattstack`, read `docs/settings-architecture.md` (scope model,
registry checklist, defaults and default notes, the call-time HOME and sops footguns).
The working rules for `getSetting`/`setSetting`, scope choice and defaults are
the `rt-settings` skill (`skills/rt-settings/SKILL.md`); this file does not
repeat them.

Shared settings live in an org clone (`~/.mattstack/orgs/<org>/`) as an
org store and one store per team folder. The resolver reads the org layer
and the active team's layer (`activeTeam()` in rt-client). A shared write is
refused unless this Mac's role owns the file
(`packages/rt-client/src/settings/org-roles.ts`, `lib/team/roles.ts`). Read
`docs/settings-architecture.md` and
`docs/superpowers/specs/2026-10-01-org-and-teams-design.md` for the layout,
selection and ownership rules.

The org store is guarded by `orgStoreChangeRefusal`
(`packages/rt-client/src/settings/org-store-guard.ts`) in `setSetting`,
`publishTeam` and the daemon's auto-commit scope: a team owner may change
only which of their own teams people are on, and only an org owner may change
`owners`.

A team's pack is its Claude plugin at `mattstack/teams/<team>/plugin/`
(`teamPackDir`, `lib/team/team-pack-path.ts`). The older layout, with the
pack nested in a `packs/` folder inside the team folder, is read by
nothing but the detector that names the conversion, and
`lib/__tests__/no-nested-team-pack.test.ts` keeps that spelling out of
source and live docs.

The branch an org clone has checked out is the branch rt reads, syncs and
publishes on that Mac (`orgBranch` in `lib/team/org-branch.ts`), so an admin
can try a breaking change on a branch while every other member stays on the
org's data branch. From layout 4 that branch is the marker's `dataBranch`
(`mattstack` by default; `dataBranchOf` in `lib/team/org-branch.ts`) and
`main` keeps only the marker as a pointer (`lib/team/main-pointer.ts`).
Never hard-code `main` for the org clone's data: publish, team sync, pack
sync, `rt team status` and the conversion scripts follow the checkout or
the marker. `main` is named only where the pointer is read or written.
`rt team create` starts a new org on its data branch and `publishTeam`
pushes the pending pointer to `main`, refusing a non-empty origin. `rt team
invite` reads `main`'s pointer and refuses unless the clone is on the
branch it names; the invite seals `dataBranch`, and `rt team join` clones
that branch alone, then narrows the cone after the redeem.
`rt team branch use <name>` (`lib/team/trial-branch.ts`; org admins and
owners) switches the clone in place to a trial branch, made from the data
branch's published tip when origin has none, and records it in the
team-local record. The daemon auto-commits only on an approved branch, the
data branch or the recorded trial (`approvedBranches` in
`lib/team/approved-branch.ts`); the `org.branch` row says when it is paused.
Each Mac's sparse cone follows its role (`coneFor` in `lib/team/org-cone.ts`):
org owners and admins hold `.claude-plugin` and `mattstack`, everyone else
the org files and their teams. A dropped team folder with changes stays, and
the `org.sparse` row names it.
The org marker carries a layout version (`layout` in `mattstack/mattstack.jsonc`;
an explicit positive integer wins, and absent reads as 2 for `role: "org"` and 1
for a one-team `role: "team"`, a fixed default (`ORG_LAYOUT_ABSENT_DEFAULT`),
never `ORG_LAYOUT`, so a bump never reads an unconverted repo as ready). Every
marker rt writes carries an explicit `layout`: `rt team create` writes
`ORG_LAYOUT`, `scripts/move-team-packs-to-plugin.ts` writes 2,
`scripts/move-to-team-directory.ts` writes 3, and
`scripts/move-to-data-branch.ts` writes 4 with `dataBranch`
(`--data-branch <name>`; `--no-pointer` leaves `main` alone for a trial;
a pointer `main` refuses lands on `<data branch>-pointer`).
`ORG_LAYOUT` in `lib/team/org-marker.ts` is 4; layouts 3 and 4
(`READABLE_LAYOUTS`) share every path, so both are readable. It moves only with a breaking change to the repo's shape or to the shared settings' shape, never with a
release; the admin's runbook for such a change is the `rt-settings` skill
(`skills/rt-settings/SKILL.md`, "Changing the org repo's layout"). `orgLayoutState` (`lib/team/org-layout.ts`) is the one classifier
every reader uses, and it shares `pickOrgClone` with `readZonesFrom`: a clone
needs `.git/config`, the first by name holding the org store wins, else the
first org-kind clone, and a stale folder beside it is skipped. A clone on a
layout outside `READABLE_LAYOUTS` is `waiting`: materialize writes nothing, `rt skills` verbs
(`rt skills init` too) draw a `refused` note and exit 2, the migrations that
read the org skip, and the `org.layout` row reads a clone below the readable layouts
as a calm `skipped` row and a clone above it, or a held pull, as `needs-you`
with the update step.
The daemon's team pull holds a clone whose fetched tip is above `ORG_LAYOUT`
(`layoutGate` in `lib/daemon/home-snapshot.ts`, `git show` under `LC_ALL=C`),
so an older app never fast-forwards onto a layout it cannot read; a git
failure other than a missing marker throws, and the engine logs it once and
lets the pull through. A layout 3 clone whose `main` now holds a pointer is
held with a `moved` verdict instead: `convergeDataBranch`
(`lib/team/org-data-branch.ts`) moves it in place onto the data branch when
it is clean, from the daemon, `rt team pull` and the `org.folder` step;
unpublished org commits are cherry-picked across, and a dirty clone, a
detached HEAD, or commits outside the data paths or that clash hold the
move, with the `org.layout` row saying why. `team.sync` gives a held clone
no remedy. After every
pull that moves a clone the daemon converges (`createOnPulled` in
`lib/daemon/team-snapshots.ts`), then runs `composePullHooks` over the
intercept hook and `createMaterializePullHook`.
The old `~/.mattstack/teams/` root is legacy: `lib/__tests__/no-legacy-teams-root.test.ts`
keeps it out of source, and the `org.folder` step of `rt setup update` moves a
clone found there.

An org's name is its marker's `org` (`mattstack/mattstack.jsonc`), and the
clone's folder follows it: the `org.folder` step converges the folder, the
`rt/teams` and `rt/invites` records, the repo index and the Claude
marketplace on every `rt setup update` and full `rt setup apply`, and moves
a layout 3 clone onto its data branch (`convergeDataBranch`) but writes
nothing else into the clone. `rt team rename <name>` (admins only) commits and
publishes the new marker and converges this Mac at once; a member's Mac
follows at its next update. The `${org}` placeholder and its deprecated
`${team:<name>}` alias are described in `docs/settings-architecture.md` and
the `rt-settings` skill; shared stores keep the alias until every member
runs an rt that knows `${org}`. Read
`docs/superpowers/specs/2026-10-06-orgs-root-design.md` before touching
converge, rename or either placeholder.
