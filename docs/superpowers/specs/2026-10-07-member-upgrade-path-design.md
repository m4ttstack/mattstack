# The member upgrade path: from the one-team clone to the org layout

A member's Mac on v2.21.0 holds a copy of the org repo under the legacy
root (`~/.mattstack/teams/<team>/`) on the one-team layout. Two things reach
that Mac in either order: the new app, through Sparkle, and the converted
org repo, which the daemon copies down once the admin merges it to `main`.
This spec makes the new rt bring the Mac to the org layout in both orders
with no command from the member, and adds the layout version gate that
makes the next breaking repo change safe in any order.

## Goal

Starting from the exact member state below, with no CLI command and no
retry hack, the Mac ends at `~/.mattstack/orgs/<org>/` on the org layout,
whichever lands first: the new app or the converted `main`. Records, the
repo index and the Claude marketplace follow the clone; the team plugin is
installed from `teams/<team>/plugin/`; the per-repo skills files are written
from the new layout; no `failed` or `needs-you` row is left behind. During
the window between a member's app update and the admin's merge, the member
sees one calm line and nothing else.

## Decisions taken

- **The new rt converges in both orders.** No branch per rt version, no
  second reader of the old layout. The `plugin/` hard break stands: once a
  clone is converted, nothing reads `packs/<team>`.
- **An unconverted clone is a waiting state, not a failure.** The update
  run leaves every file alone, ends `ok`, raises no notification, and
  `rt setup status` shows one `skipped` row that explains the wait.
- **A layout version lives in the org marker, apart from the app version.**
  It moves only when the repo's shape changes in a way an older rt cannot
  read. Each rt knows the highest layout it reads; the daemon holds a clone
  at the last commit it can read when `main` moves above that.
- **The gate ships to the old app first.** It is designed and built against
  today's `main` in this job, then copied to a patch release cut from the
  v2.21.0 tag (a separate job). Members take that patch before the layout
  release, so even this upgrade has no old-app window.
- **Org repo migrations (the admin side) are the named follow-up**, not
  built here. This job builds the member half of that feature for the one
  upgrade in front of us.

Names in this spec are placeholders: the org is `acme`, the team `widgets`,
the members `dev1` and `dev2`, the forge `gitlab.example.com`.

## 1. The member's starting state

What v2.21.0 left on a member's Mac after `rt team join`:

- The clone at `~/.mattstack/teams/widgets/`, checked out on `main`, whose
  marker `mattstack/mattstack.jsonc` reads
  `{ "role": "team", "namespace": "widgets", "org": "acme" }`. Inside:
  `mattstack/packs/widgets/` (the pack, with `.claude-plugin/plugin.json`),
  `mattstack/settings.team.jsonc`, `mattstack/team.jsonc`,
  `mattstack/secrets/`, `.sops.yaml`, and `.claude-plugin/marketplace.json`
  naming the `widgets` marketplace with one plugin whose source is
  `./mattstack/packs/widgets`.
- The record `~/.mattstack/rt/teams/widgets.json` with `joinedByRt: true`
  and the member's age public key. No `forgeUsername`.
- `~/.mattstack/rt/setup-state.json` finished (`finishedAt` set), with
  `lastUpdate.version` at `2.21.0` and none of the migrations that landed
  after the tag.
- Claude Code with the `widgets` marketplace registered as the directory
  `~/.mattstack/teams/widgets` and the plugin `widgets@widgets` installed.
- Per-repo skills files under `~/.mattstack/repos/<host>-<path>/packs/widgets/skills.jsonc`
  for each registered repo the team's pack claims.
- The clone is not in the repo index: join never registered it.

The org repo's `main` is on the same layout. The admin's converted branch
holds the org layout: marker `{ "role": "org", "org": "acme" }`,
`mattstack/org/settings.org.jsonc`, `mattstack/org/secrets/`,
`mattstack/org/packs/<base>/`, `mattstack/teams/widgets/settings.team.jsonc`,
the team pack at `mattstack/teams/widgets/plugin/` with its version bumped,
and the marketplace source `./mattstack/teams/widgets/plugin`.

## 2. Recognising the clone

`markerState` in `lib/team/org-marker.ts` already reads the legacy marker
(`role: "team"` with an `org`) as an org clone named by that `org`, so
`org.folder` finds it under the legacy root and moves it to
`~/.mattstack/orgs/acme/`. That stays. The marker reader gains the layout:

```ts
export type MarkerState =
  | { kind: "none" }
  | { kind: "invalid"; why: string }
  | { kind: "org"; org: string; layout: number };
```

`layout` is the marker's `layout` field when it is a positive integer; else
`2` for `role: "org"` and `1` for `role: "team"`. So no existing repo has to
write the field: the converted branch reads as layout 2 as it stands, and
the field is written from layout 3 on. `rt team create` writes
`layout: ORG_LAYOUT` into a new org's marker from now on, so a repo born
today states its shape. A marker whose `layout` is present and not a
positive integer is `invalid`.

`ORG_LAYOUT = 2` is the one constant naming the highest layout this rt
reads, exported from `lib/team/org-marker.ts` beside the reader. The
constant moves only with a breaking layout change, never with a release.

One classifier answers "what shape is this Mac's org in", used by every
piece below so they agree:

```ts
export type OrgLayoutState =
  | { kind: "none" }
  | { kind: "ready"; slug: string }
  | { kind: "waiting"; slug: string; dir: string; layout: number };

export function orgLayoutState(p: Pick<Probes, "readDir" | "readFile" | "exists" | "home">): OrgLayoutState;
```

It scans `orgsDirUnder(p.home)` for folders with `.git/config` (the same
set `cloneSlugs` returns). `ready` is a clone whose marker reads layout
`ORG_LAYOUT` and whose org settings file exists. `waiting` is a clone whose
marker reads a layout below `ORG_LAYOUT` (the legacy clone, after
`org.folder` moved it) or above it (a clone pulled past this rt, by hand or
by a daemon from a newer rt). `none` is no clone. With several clones, the
first by name decides, the way `currentOrg` does. It lives in
`lib/team/org-layout.ts`, with the marker reader as its only dependency.

## 3. The update run

`runUpdateWith` orders the run today as pending migrations, then every
update-safe step in contract order. The new order:

1. `org.folder`
2. `org.pull`
3. pending migrations
4. `team.identity`
5. the other update-safe steps in contract order
6. `verify`

`updateItems` builds that list; `lib/setup/__tests__/update-safe.test.ts`
pins the order. The two org steps move ahead of the migrations because a
migration that reads the org (`sdm-resources-key` today) must see the clone
where the resolver reads it, at `orgs/<org>`, and must see what `main`
holds now. Nothing a migration does feeds `org.folder` or `org.pull`.
`AGENTS.md`'s "Setup after an update" paragraph names the new order.

A migration that reads the org answers `skipped` only when the Mac truly has
nothing for it to do, and says so:

- `none`: "This Mac is in no org".
- `waiting`: "Your org has not moved to its new layout yet; nothing to move
  on this Mac". That is final for a member, since a member's Mac never
  writes a shared store: the admin's conversion commit carries the change,
  and the member's pull delivers it. The `sdm-resources-key` migration keeps
  its ownership refusal (`continue`) for a store this Mac may not write.
- `ready`: as today.

A migration is still recorded on `done` or `skipped` and never on `failed`;
no migration leaves itself unrecorded to run again.

`org.pull` learns one more trigger: when the pull moved the marker's layout
(1 to 2 on the day `main` converts), it reports it in its detail ("Pulled
acme, now on the org layout") and calls `ctx.reloadTeam`, which it does
already. The later steps in the same run then read the converted clone.

## 4. The waiting state

When `orgLayoutState` is `waiting`, every piece that reads the org leaves
the Mac exactly as it is:

- `materializeSkills` returns `{ skipped: true, waiting: true, reason }`
  before it reads any zone. It writes nothing and sets nothing aside: the
  per-repo skills files from v2.21.0 stay as they are until the converted
  layout is pulled. Today the same clone reads as "no org", every repo comes
  back undeclared, and `setAsideStale` renames the member's board bindings
  to `.stale`; that is the bug this closes. The `skills.materialize` step and
  the materialize tail of `plugins.install` report `skipped` with the
  reason.
- The skills verbs (`rt skills check`, `compile`, `sync`, `bind`,
  `materialize`) refuse with a `refused` note carrying the same sentence,
  the way the unconverted-team-pack detector refuses today.
- `plugins.install` installs the trusted plugins as today and leaves the
  team plugin alone: with no org store there is no active team, so
  `computePlugins` names none, which is already its behaviour. The
  marketplace re-point `org.folder` performs reinstalls `widgets@widgets`
  from the moved clone at its old source path, so the member keeps the
  plugin they had.
- `verify` passes. No validator emits an `error` or `needs-you` row for a
  waiting clone: `orgFolderRow` reads `ready` once the clone is under
  `orgs/`, `teamSyncRow` watches the clone as any other, and the org rows
  (`orgRows`, the pack requirement rows) only draw for a `ready` org.

The reason is one sentence, from one constant in `lib/team/org-layout.ts`:

> Your org has not moved to its new layout yet. rt finishes the move when it does.

For a clone above `ORG_LAYOUT` the sentence names the versions instead:

> Your org uses layout 3 and this app reads up to 2. Update the app.

### What the member sees

- **Nothing pushed.** The update run ends `ok`, so no `setup_update`
  notification and exit 0.
- **One row** in `rt setup status` and the app's Setup status window:
  `org.layout`, title "Org layout", kind `tool`, not required, recheck
  `on-activate`. `ready` reads "acme on layout 2". A legacy clone reads
  `skipped` with the waiting sentence and no action. A clone above
  `ORG_LAYOUT`, or a daemon hold (section 6), reads `needs-you` with the
  update sentence and a `steps` action naming the app update. `skipped` is
  the one calm non-ready status the contract has, and `finishBlockers`
  ignores it.
- **The apps** behave as on a Mac with no org (the board's "no pack" pill)
  until the converted layout is pulled, then come back on their own.

## 5. After the daemon pulls the converted layout

The snapshot engine runs `onPulled` after every pull that moved the clone.
Today that is `convergePackCache` (the plugin update when the served version
changed) followed by the intercept hook. The daemon's `afterPull` becomes a
chain, in this order:

1. `convergePackCache`, as today. The marketplace registration is the clone
   directory, which did not move, so `claude plugin update widgets@widgets`
   re-reads `marketplace.json` and installs the pack from its new source.
2. The intercept hook, as today.
3. A materialize hook, `createMaterializePullHook` in
   `lib/daemon/materialize-pull-hook.ts`, built like the intercept hook:
   runs `materializeSkills(p, {})` for every registered repo, logs the tally
   at `info` when anything was written or set aside and at `debug`
   otherwise, logs `skipped` reasons at `debug`, and never throws. It runs
   after every moving pull, not only a layout change: a pulled pack edit or
   a `board.projects` change rewrites the bindings the same way, which is
   what "re-materializes after a pull that changes the pack or bindings"
   means. Materialize is a file walk and a handful of JSON writes, so the
   cost is a few milliseconds per repo.

`startTeamSnapshots` keeps one `afterPull` seam; `lib/daemon.ts` composes
the two hooks with `composePullHooks([...])` from the same file, which runs
each in turn and never lets one hook's throw stop the next.

So in the first order (app first, merge later): the daemon's next pull
fast-forwards the clone onto the org layout, the pack cache converges the
plugin to the `plugin/` source, the bindings are written from the new
layout, and the `org.layout` row reads `ready` at the next status read.
Nothing waits for a launch.

The converge keys on the active team, which needs `forgeUsername` on the
record. `team.identity` records it in the update run while the clone is
still waiting, since `legacyDeclaredForge` reads the forge from the
one-team store. A Mac where that could not happen (no forge token yet)
pulls and materializes fine and updates the plugin at its next update run,
once "Who you are" is answered; that is the existing `team.identity` row.

## 6. The layout version gate

The daemon's pull gains a gate so an rt never fast-forwards a clone onto a
layout it does not read. `SnapshotSpec.pull` gains an optional
`gate?: (ref: string) => Promise<string | null>`; `doPull` calls it after
the fetch and before any fast-forward or rebase, with
`refs/remotes/origin/<branch>`. A non-null answer is a hold: the pull
returns `{ outcome: "skipped", detail }` with that sentence, `lastPullAt`
is stamped (the fetch reached the remote), and the status gains
`layoutHold: { layout, reads } | null`, set on a hold and cleared by any
later pull that passed the gate. The home snapshot sets no gate.

`teamSnapshotSpec` supplies the gate: `git show <ref>:mattstack/mattstack.jsonc`
parsed through `markerState`. A layout above `ORG_LAYOUT` holds, with the
update sentence from section 4 naming both numbers. A marker that is
missing, `none` or `invalid` at the tip does not hold: the gate guards one
thing, and a clone with no readable marker is already a `team.sync`
problem. A layout at or below `ORG_LAYOUT` passes.

`rt team pull` runs through the same engine, so it holds the same way and
prints the sentence. The `team.sync` row keeps reporting the skip detail as
today; the `org.layout` row reads the hold from the daemon status and draws
`needs-you` with the update sentence, so the member learns it once, in
plain words, with the app update as the step.

A hold is not an error: the daemon keeps fetching on its timer and logs the
hold once at `info` and again only when the held layout changes, so a
member on an old app for a week does not fill the log.

The constant that decides is `ORG_LAYOUT`, and the only other place that
spells a layout number is `markerState`'s defaults. The next breaking layout
bumps `ORG_LAYOUT`, writes `layout: 3` in the conversion commit, and every
older rt holds while every newer one converts.

## 7. The two orders, end to end

**App first.** Launch runs the update: `org.folder` moves the clone to
`orgs/acme`, copies the records, re-points the marketplace and reinstalls
the plugin from the old source; `org.pull` fast-forwards (`main` is
unchanged); the migrations run with the clone where the resolver looks and
answer honestly; `team.identity` records the login; `skills.materialize`
reports `skipped` with the waiting sentence and `plugins.install` ends
`done` with that sentence as its materialize note; `verify` passes with the
`org.layout` row `skipped`. No notification. Later the
admin merges; the daemon's next pull fast-forwards onto layout 2 and the
chain in section 5 updates the plugin and writes the bindings.

**Merge first.** A Mac on v2.21.1 holds the copy at the last layout-1
commit and shows the update line; a Mac still on v2.21.0 copies `main` down
and runs without its team settings until it updates, which is why the patch
ships first. Launch of the new app runs the update: `org.folder` moves the clone (its marker is now
`role: "org"`), `org.pull` is up to date, the migrations see a `ready` org,
`team.identity` records the login from the org store, `skills.materialize`
writes the bindings from `plugin/`, `plugins.install` updates
`widgets@widgets` to the bumped version, `verify` passes with `org.layout`
`ready`.

In both: the clone at `~/.mattstack/orgs/acme`, the record at
`rt/teams/acme.json` with the legacy one removed, the repo index untouched
(the clone was never in it, and `locate` answers nothing-lost), the
marketplace registered at the new directory, the plugin at the bumped
version, the bindings `widgets:board-*` present, the base pack attachments
present in the installed plugin, the `sdm.resources` key readable from the
team store, and no `failed` or `needs-you` row.

## 8. Rollout for the two members

1. Merge this job. Copy the gate (section 6) and the `org.layout` row to a
   patch branch cut from the v2.21.0 tag, with `ORG_LAYOUT` at 1 and the
   marker reader as it was at the tag, and release it as v2.21.1. `main`
   already carries the breaking change, so the patch cannot come from it.
2. Both members take v2.21.1. This is the one time the admin needs to know
   they updated; from here on the order never matters.
3. Cut the layout release from `main` and merge the converted branch to the
   org repo's `main`, in either order. A Mac on v2.21.1 holds the copy and
   shows the update line; a Mac on the layout release converts.
4. Once both members are on the layout release and `main` is merged, delete
   the converted branch.

From then on, a breaking layout change is the same three steps: bump
`ORG_LAYOUT` in the release that reads the new shape, ship it, merge the
converted `main` whenever it is ready. An rt that reads the old layout holds
with the update sentence; an rt that reads the new one converts.

## 9. Testing

Unit tests sit beside each touched file; the end-to-end tests live in
`commands/__tests__/member-upgrade.test.ts`, built the way
`onboarding-org.test.ts` drives `runUpdateWith` on a real temp HOME with a
fake `claude` on PATH and real git.

**The fixture.** `legacyMemberHome()` builds a temp HOME shaped exactly as
section 1 describes: the bare origin on the one-team layout (`git init
--bare`, a seeded commit on `main`), the clone under `teams/widgets` with
`joinedByRt`, the finished setup state stamped `2.21.0`, a registered repo
with a remote the pack claims and a `skills.jsonc` already materialized for
it, and the fake claude's state holding the `widgets` marketplace at the
legacy directory with `widgets@widgets` installed. `convertOrigin()` pushes
the org layout (marker, split stores, `teams/widgets/plugin` with a bumped
version, the base pack, the new marketplace source) onto the origin's
`main`.

**The two orders.**

1. App first: `runUpdate` on the fixture; assert the clone moved, the
   records copied, the marketplace re-pointed and the plugin reinstalled,
   every outcome `done` or `skipped`, no `failed`, no notification, the
   `skills.jsonc` byte-identical, the `org.layout` row `skipped` with the
   waiting sentence. Then `convertOrigin()`, start `startTeamSnapshots` in
   process on the temp orgs dir with the real engine and a fake claude, and
   `pullNow`; assert the pull fast-forwarded, the plugin update ran, the
   bindings were rewritten from `plugin/` (the `widgets:board-*` ids), and
   the `org.layout` row reads `ready`. Then `runUpdate` once more (the next
   release) and assert it changes nothing.
2. Merge first: `convertOrigin()` then a plain `git pull` in the legacy
   clone (what the old daemon did), then `runUpdate`; assert the same end
   state in one run, with `skills.materialize` and `plugins.install`
   `done`.

Both orders assert the migration ledger holds `sdm-resources-key` with a
`skipped` outcome whose detail is the honest one for that order, and that
the per-repo `sdm.resources` value resolves after conversion.

**The gate.** In `lib/daemon/__tests__/home-snapshot.test.ts`'s real-git
style: an origin whose tip marker reads `layout: 3`; `pullNow` returns
`skipped` with the update sentence, the working tree stays at the old
commit, `lastPullAt` is stamped, `layoutHold` is set; pushing a `layout: 2`
tip clears it on the next pull. A tip with no marker passes. The
`org.layout` row test reads the hold through a fake daemon status.

**Unit coverage per file.** `org-marker.test.ts` (layout defaults, explicit
field, invalid field), `org-layout.test.ts` (none, ready, waiting below and
above, several clones), `apply` update-order test (the pinned list),
`sdm-resources-key` wording per state, `skills-materialize` waiting
(nothing written, nothing set aside), `materialize-pull-hook.test.ts`
(runs, logs, never throws), `composePullHooks` (a throw in one does not
stop the next), `team-snapshots` chain order, `rt-health` row states,
`team create` writes `layout`.

**Gates.** `bun run typecheck`, `bun run check`, the targeted unit tests
for every touched file, and the two e2e orders. Nothing runs against the
real HOME.

## 10. Docs

- `AGENTS.md`: the update order in "Setup after an update", and one
  paragraph on the layout gate (where `ORG_LAYOUT` lives and what bumps it).
- `docs/settings-architecture.md`: the layout version in the marker.
- The release skill's clean-room walkthrough gains an update leg (a VM on
  v2.21.0 with a member-shaped home, update, confirm the `org.layout` row
  and the move). `skills/` is outside this job's write fence, so the leg is
  written in this spec's follow-ups for the dispatcher.

## Follow-ups

- **Org repo migrations (admin side).** A dated list of layout migrations
  in rt, applied to the admin's clone by their rt (an update run or `rt team
  upgrade`), published as one commit the admin reviews, with a branch as
  optional staging. The conversion scripts become its first entries, and
  nobody runs a script from a checkout again. `ORG_LAYOUT`, `markerState`
  and `orgLayoutState` are its member half.
- **The v2.21.1 patch** from section 8, step 1.
- **Member version reporting**, so an admin sees who is on what rt before
  a contract step. Not needed while the gate holds old apps safely.
- **The release skill's clean-room update leg**, from section 10.

## Out of scope

- Reading the one-team layout after a clone is converted.
- Converting the org repo itself: the admin's branch is done and verified.
- Switching a clone's branch for it: rt keeps following the checkout.

## Risks

- The converted marketplace must keep the name `widgets` and the plugin
  name `widgets`; a renamed marketplace is a new registration, not an
  update, and `convergePackCache` would skip it as "not registered". The
  e2e fixture pins the same names; the rollout checks the admin's branch
  keeps them.
- `claude plugin update` re-reading a changed `source` inside a registered
  directory marketplace is the behaviour the plugin-folder spec relies on;
  the opt-in real-claude contract test (`RT_CLAUDE_PLUGIN_E2E=1`) is where
  that is proven against a real claude.
- A member whose forge token is absent at update time keeps the old plugin
  until the next update run after "Who you are" is answered; bindings and
  settings still converge from the pull.
