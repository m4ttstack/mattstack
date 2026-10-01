# Per-pack binding scope for shared repos

Status: spec approved 2026-09-30.

## Problem

One monorepo is bound by many team packs (around 20 teams share one repo).
Today `merge-manifests.sh` folds every team fragment that claims a repo into
one `~/.mattstack/repos/<repo>/skills.jsonc`, keyed by engine and slot
(`bindings["mattstack:stage-gates"].domain`). Two packs that fill the same
slot differently are a hard merge error that writes nothing for anyone, so a
second team (gadgets) cannot give its own `stage-*` fills to a repo a first
team (widgets) already binds. Pipelines collide the same way.

Compile already runs per pack: `rt skills compile --pack P` bakes fills into
P's own `skills/` and `attachments/`, and the installed verbs (`/widgets:work`,
`/gadgets:work`) never read the manifest at run time. The collision exists
only in the merged source file and in the two runtime readers with no pack
notion (the board's `board:*` launches and `resolve-args.sh`).

A person can belong to several teams and chooses the pack by the command they
run.

## Goals

- Each pack compiles from its own fills for a repo; one team's bindings never
  collide with another team's.
- Fills every team in a repo shares (MR template, squash and labels, CI
  triage, reply rules, board plumbing) are written once.
- A broken pack affects only that pack.
- The board, the console and runtime lookups read the same per-pack data that
  compile reads.

## Non-goals

- Choosing a pack from an MR's ticket or author (see Follow-ups).
- Merging two packs' reviews for a reviewer who is in both teams.
- Chains of base packs.

## Design

### 1. Per-pack manifests

For each repo and each pack that claims it, materialize writes
`~/.mattstack/repos/<repo>/packs/<pack>/skills.jsonc`, where `<pack>` is the
plugin's short name (`widgets`, the same value `--pack` takes). The file is
built from four layers, later layers winning per slot:

1. mattstack defaults (the engine pack's own fragment, `plugins/mattstack/pack/skills.jsonc`)
2. the base pack named by the pack's `extends` (one level)
3. the pack's own fragment (`packs/<pack>/pack/skills.jsonc` in its team zone)
4. the user's `~/.mattstack/user/skills/overrides.jsonc`

`pipelines` layer the same way, per work type. `skills.enabled` stays a union.

The file keeps the provenance header, now naming the layer each binding came
from (`default`, `base:<pack>`, `pack`, `override`).

Hard errors, each scoped to the one pack:

- `extends` names a pack that is not installed.
- Two packs in the same team zone claim the same repo (still ambiguous).

Across packs nothing conflicts. The old `repos/<repo>/skills.jsonc` is retired
(Migration).

### 2. The base pack

A base pack is an ordinary pack plugin (for example `acme-base`)
published from whichever team repo owns it.

- A pack declares it in its fragment: `"extends": "acme-base@<marketplace>"`.
  The manifest schema gains `extends` (string, `<plugin>@<marketplace>`).
- The team lists the base in `claude.plugins`, so `plugins.install` already
  installs it for every member; members do not join the base's team.
- Materialize reads the base's fragment from the installed plugin's
  `pack/skills.jsonc`.
- When the base changes, the extending pack's file is stale until the next
  materialize. `rt skills sync --pack <pack>` materializes before its drift
  check, so a sync of the extending pack sees the change and recompiles;
  `check` alone reports drift only after a materialize has run.

### 3. Authoring tools and the console

- `rt skills compile`, `check` and `composition --pack P` read
  `repos/<repo>/packs/P/skills.jsonc` by path. `findDefaultManifest`'s header
  grep and newest-mtime pick go away. A pack that binds several repos
  compiles against the first repo its team zone declares (`team.jsonc`'s
  `projects`, in order); `--repo <slug or host/path>` picks another and
  `--manifest` still overrides.
- `rt skills bind --pack P` writes P's fragment and regenerates P's file.
  Binding a slot the base fills is an override, never an error.
- `composition` reports each slot's layer. `binders` lists only this pack's
  file, so other packs' bindings leave the pack's view.
- Console wiring shows each slot's layer (default, base, this pack, your
  override), and the Rebind caption shows the real key
  (`mattstack:stage-gates`), not the verb name.

### 4. The board

Review, respond and doctor pick a pack per launch:

1. the tab's `pack`, a new optional field on a board tab; a tab's explicit
   `reviewSkill` still wins when set
2. the user's default pack, a new user-scoped setting `board.defaultPack`,
   which setup sets to the user's first team's pack

`resolveBoardSkill` reads `bindings["board:<kind>"]` from that pack's file.
The launched wrapper gets `MATTSTACK_PACK=<pack>`, and `resolve-args.sh`
reads `repos/<repo>/packs/$MATTSTACK_PACK/skills.jsonc` when it is set.
Without a pack, resolution falls back to mattstack's generic skill and the
row says so.

A codeowner review uses the reviewer's pack: a person reviews with their own
team's lens, and the ticket's own team reviews with theirs.

### 5. The merge moves to TypeScript

The per-pack loop, `extends` and layer provenance move into `lib/skills/`
(merge + materialize). `merge-manifests.sh` becomes a thin wrapper that runs
`rt skills materialize`. This also advances the settings resolver spec's
planned retirement of the script.

## Migration

- The next setup run or `rt skills materialize` writes the per-pack files,
  then renames the old `repos/<repo>/skills.jsonc` to `skills.jsonc.migrated`
  (renamed, never deleted).
- Compiled packs keep working unchanged: they bake the repo key, which does
  not change, and read no manifest at run time.
- The widgets pack keeps working without `extends`. Moving its shared fills
  into a base pack is a separate step owned by the team.
- `lib/setup/pack.ts`'s pipeline check reads the per-pack file (it reads the
  wrong shape today; fixing it rides along).

## Failure reporting

Materialize reports per pack. The `skills.materialize` setup step and row name
the pack and the fix, for example: "gadgets extends acme-base, which
is not installed; add it to the team's claude.plugins". Other packs on the
same repo are written normally.

## Testing

- Merge (unit): layer order; base overridden by the pack; the same slot in two
  packs coexisting; missing base; two packs in one zone; overrides winning;
  pipelines per pack; provenance per layer; migration rename.
- Compile and composition: read the pack's own file; composition reports
  layers and lists only this pack's binders.
- Board: tab pack, then `board.defaultPack`; `MATTSTACK_PACK` reaches the
  launched skill; `resolve-args.sh` reads the per-pack file.
- End to end: two packs on one repo compile different `stage-gates` fills with
  no error.

## Follow-ups

- Team matching for mixed tabs: each pack declares the ticket teams it covers
  (`"teams": ["WID"]` in the team zone's config), and the board matches an MR's
  ticket prefix against those declarations, with duplicate claims reported at
  merge time. Built only if mixed tabs prove it is needed.
- A reviewer in both teams: run both packs' reviews and merge the findings.
- `rt skills sync` with a GitHub-installed engine: compile against the
  installed engine and update only the pack plugin.
