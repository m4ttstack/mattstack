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
can try a breaking change on a branch while every other member stays on main.
Never hard-code `main` for the org clone: publish, team sync, pack sync,
`rt team status` and the conversion script all follow the checkout. Two
exceptions: `rt team create` starts a new org on main, and `rt team invite`
refuses off main, because joiners clone main.
The org marker carries a layout version (`layout` in `mattstack/mattstack.jsonc`;
an explicit positive integer wins, and absent reads as 2 for `role: "org"` and 1
for a one-team `role: "team"`, a fixed default (`ORG_LAYOUT_ABSENT_DEFAULT`),
never `ORG_LAYOUT`, so a bump never reads an unconverted repo as ready). Every
marker rt writes carries an explicit `layout`: `rt team create` writes
`ORG_LAYOUT`, `scripts/move-team-packs-to-plugin.ts` writes 2, and
`scripts/move-to-team-directory.ts` writes 3.
`ORG_LAYOUT` in `lib/team/org-marker.ts` is the highest layout this rt reads
and moves only with a breaking change to the repo's shape or to the shared settings' shape, never with a
release; the admin's runbook for such a change is the `rt-settings` skill
(`skills/rt-settings/SKILL.md`, "Changing the org repo's layout"). `orgLayoutState` (`lib/team/org-layout.ts`) is the one classifier
every reader uses, and it shares `pickOrgClone` with `readZonesFrom`: a clone
needs `.git/config`, the first by name holding the org store wins, else the
first org-kind clone, and a stale folder beside it is skipped. A clone on
another layout is `waiting`: materialize writes nothing, `rt skills` verbs
(`rt skills init` too) draw a `refused` note and exit 2, the migrations that
read the org skip, and the `org.layout` row reads a clone below `ORG_LAYOUT`
as a calm `skipped` row and a clone above it, or a held pull, as `needs-you`
with the update step.
The daemon's team pull holds a clone whose fetched tip is above `ORG_LAYOUT`
(`layoutGate` in `lib/daemon/home-snapshot.ts`, `git show` under `LC_ALL=C`),
so an older app never fast-forwards onto a layout it cannot read; a git
failure other than a missing marker throws, and the engine logs it once and
lets the pull through. `team.sync` gives a held clone no remedy. After every
pull that moves a clone the daemon converges (`createOnPulled` in
`lib/daemon/team-snapshots.ts`), then runs `composePullHooks` over the
intercept hook and `createMaterializePullHook`.
The old `~/.mattstack/teams/` root is legacy: `lib/__tests__/no-legacy-teams-root.test.ts`
keeps it out of source, and the `org.folder` step of `rt setup update` moves a
clone found there.

An org's name is its marker's `org` (`mattstack/mattstack.jsonc`), and the
clone's folder follows it: the `org.folder` step converges the folder, the
`rt/teams` and `rt/invites` records, the repo index and the Claude
marketplace on every `rt setup update` and full `rt setup apply`, and never
writes into the clone. `rt team rename <name>` (admins only) commits and
publishes the new marker and converges this Mac at once; a member's Mac
follows at its next update. The `${org}` placeholder and its deprecated
`${team:<name>}` alias are described in `docs/settings-architecture.md` and
the `rt-settings` skill; shared stores keep the alias until every member
runs an rt that knows `${org}`. Read
`docs/superpowers/specs/2026-10-06-orgs-root-design.md` before touching
converge, rename or either placeholder.
