# The team pack moves to `mattstack/teams/<team>/plugin/`

Date: 2026-10-07. Builds on
`docs/superpowers/specs/2026-10-01-org-and-teams-design.md` (the org layout)
and `docs/superpowers/specs/2026-10-06-orgs-root-design.md` (the conversion
script, the base attachments). Where this spec and section 4 of the parent
spec disagree on the team pack's path, this spec wins.

## Goal

Today a team's pack sits at `mattstack/teams/<team>/packs/<team>/` inside the
org repo, so the team's name appears twice in every path and a team folder
looks as if it could hold several packs when it holds exactly one. The pack
moves to `mattstack/teams/<team>/plugin/`: the team's Claude plugin, beside the
team's settings. Nothing else in the org repo moves.

```
mattstack/teams/widgets/settings.team.jsonc        team settings, auto-committed as today
mattstack/teams/widgets/plugin/                    the team pack: the plugin a member installs
mattstack/teams/widgets/plugin/.claude-plugin/plugin.json
mattstack/teams/widgets/plugin/pack/skills.jsonc   the pack manifest (merge fragment)
mattstack/teams/widgets/plugin/pack/stubs.jsonc
mattstack/teams/widgets/plugin/pack/surface.jsonc
mattstack/teams/widgets/plugin/skills/             compiled verbs
mattstack/teams/widgets/plugin/attachments/        fills, references, emitted base attachments
mattstack/teams/widgets/plugin/PACK.md
mattstack/teams/widgets/plugin/requirements.jsonc
```

The marketplace entry's source becomes `./mattstack/teams/<team>/plugin`.
Plugin ids (`<team>@<marketplace>`) do not change.

## Decisions taken

- **Hard break, no fallback.** rt reads only `mattstack/teams/<team>/plugin/`
  as a team's pack root. Nothing reads `mattstack/teams/<team>/packs/<team>/`
  except the detector in section 4 and the conversion script. The org repo
  converts in the same step as the release that ships this.
- **The pack keeps its own folder.** Settings and pack stay in separate
  folders, so the snapshot's ownership rule stays what it is: the pack folder
  is janitor-only (saved by `rt skills sync`), `settings.team.jsonc`
  auto-commits.
- **The conversion script only converts the current org layout.** It moves
  `teams/<team>/packs/<team>/` to `teams/<team>/plugin/` for every team in an
  org repo. The legacy team-repo conversion (`mattstack/packs/<pack>`, marker
  `role: team`) and its tests are removed: the one team repo converted already.
- **An unconverted clone fails clearly, once, in one place.** A shared
  detector throws one `UserActionableError` that names the fix: run the
  conversion script, then `rt setup update`. No new setup checklist row.
- **A guard test keeps the old spelling out of source** and out of the live
  docs, with an allowlist for the detector and the conversion script.
- **The org base pack does not move.** `mattstack/org/packs/<base>/` and
  everything that reads it are out of scope.

## 1. Paths

One word, `plugin`, names the pack folder, and it is spelled in two places:

- `lib/rt-paths.ts` (the authority): `teamPackDir(org, team)` becomes
  `join(teamFolderDir(org, team), "plugin")`. Its doc comment says the
  folder is the team's Claude plugin.
- `packages/rt-client/src/settings/paths.ts` (the mirror): the same change.
  `lib/__tests__/settings-paths-parity.test.ts` keeps pinning both to the
  same string.

Everything else derives from those or from one new module,
`lib/team/team-pack-path.ts`, which holds the clone-relative forms rt writes
into files and messages:

```ts
export const TEAM_PACK_FOLDER = "plugin";
/** `mattstack/teams/<team>/plugin`, the pack's path inside the org repo. */
export function teamPackRel(team: string): string;
/** `./mattstack/teams/<team>/plugin`, the marketplace entry's source. */
export function teamPackSource(team: string): string;
/** `mattstack/teams/<team>/packs/<team>`, the pre-move path. Only the detector and the conversion script may use it. */
export function nestedTeamPackRel(team: string): string;
```

`zonePackDir(zone)` in `lib/skills/init.ts` becomes
`join(zone.dir, TEAM_PACK_FOLDER)`. Every site that spelled `"packs", team`
or `` `./mattstack/teams/${team}/packs/${team}` `` calls one of these instead;
the guard test (section 8) makes sure no new spelling appears.

## 2. Every reader follows

The inventory of readers and the change at each:

| Where | Today | After |
|---|---|---|
| `packages/rt-client/src/settings/active-team.ts` `activeTeamPack` | reads `<teamPackDir>/pack/skills.jsonc` | unchanged code; the new `teamPackDir` points it at `plugin/` |
| `lib/skills/init.ts` `zonePackDir`, `readZonesFrom`, `initPack` | `join(zone.dir, "packs", zone.team)`; source string built inline | `join(zone.dir, TEAM_PACK_FOLDER)`; `teamPackSource(zone.team)` |
| `lib/skills/packs.ts` `orgFolderPacks` | `join(teamsDir, team, "packs", team)` | `join(teamsDir, team, TEAM_PACK_FOLDER)` |
| `lib/skills/materialize.ts` `claimingPacksIn` | loops every `packs/*` under the team folder; a "team holds N packs" error | reads the one pack at `plugin/`; returns zero or one entry; the N-packs error and its tests go |
| `commands/skills.ts` `teamShaped` (the manifest heuristic) | `parts.at(-2) === "packs" && parts.at(-4) === "teams" && parts.at(-5) === "mattstack"` | `parts.at(-1) === "plugin" && parts.at(-3) === "teams" && parts.at(-4) === "mattstack"`; the comment names the new shape |
| `commands/skills.ts` `packRootDir`, zone filters | through `zonePackDir` | unchanged code |
| `lib/setup/requirements.ts` `readPackRequirements` | `.../teams/<team>/packs/<team>/requirements.jsonc` | `join(teamPackDir(org, team), REQUIREMENTS_FILE)` through the rt-paths authority, so the file follows the pack; an unconverted clone comes back as an `error` entry (section 4), never a throw |
| `lib/team/add.ts` `rt team add` | writes `renderPackFiles` under `packs/<team>/`; source string inline | writes under `plugin/`; `teamPackSource(team)` |
| `lib/skills/init.ts` and `lib/team/add.ts` `team-marketplace-conflict` | refuse an entry whose source differs | unchanged; after conversion the source matches, and an unconverted clone fails earlier through the detector |
| `lib/daemon/home-snapshot.ts` `teamStandingZones` | `mattstack/teams/<team>/packs/` is the janitor-only zone | `mattstack/teams/<team>/plugin/` is the zone; `settings.team.jsonc` stays outside it and keeps auto-committing |
| `lib/team/share-pack.ts`, `lib/skills/init.ts` `sharePathsFor` | share `paths[0]` is the pack folder | unchanged code; the value becomes `mattstack/teams/<team>/plugin` |
| `lib/skills/changes.ts` `PACK_SCOPE` | `pack`, `skills`, `attachments`, `.claude-plugin`, `surface.jsonc` relative to the pack | unchanged |
| `lib/skills/pack-org.ts`, `lib/skills/sources.ts` `orgOfPackDir`, `packages/rt-client/src/settings/org-roles.ts` | walk up to the org marker, or match `mattstack/teams/<team>/` | unchanged; they are team-folder granular |
| `lib/setup/pack-cache.ts`, `lib/setup/steps/plugins.ts` | follow the marketplace entry's `source` | unchanged |
| `apps/board/src` | `teamPack` comes from `activeTeamPack` | unchanged |
| `apps/console/src/server/effectiveInputs.ts` | a comment spells the old path | the comment names `plugin/` |

A team folder with no `plugin/pack/skills.jsonc` is a settings-only team
(`hasPack: false`), as a folder with no `packs/<team>/` is today, unless the
detector says it is unconverted.

## 3. What a member's Mac installs

Claude copies the marketplace entry's source folder into its plugin cache,
keyed by the version in `.claude-plugin/plugin.json`. `convergePackCache`
(after every org pull) and `installPlugins` (in `rt setup update`) compare
the served version with the installed one and run `claude plugin update`
when they differ; a changed source with the same version reads as current.
So the conversion commit bumps the pack's patch version, the way `rt skills
sync` does, and lands the move, the marketplace source and the bump in one
commit: a member's next pull then updates the plugin from `plugin/`, with no
reinstall and no marketplace remove and add, since the marketplace folder
(the org clone) does not move. The plugin disabled state survives an update,
as the e2e plugin contract test pins.

The plugin root is `plugin/`, so the installed copy holds exactly what the
pack held before: `settings.team.jsonc` stays out of every member's plugin
cache.

## 4. The detector and the one failure

`lib/team/team-pack-path.ts` also exports:

```ts
/** True when a team folder still holds its pack at the pre-move path and nothing at plugin/. */
export function isUnconvertedTeamPack(fs: { exists(path: string): boolean }, teamFolder: string, team: string): boolean;
/** The one error every reader raises for an unconverted clone. */
export function unconvertedTeamPackError(org: string, team: string): UserActionableError;
```

The detector takes only `exists`, so `readZonesFrom` (an `InitFs`),
`readPackRequirements` (`Probes`) and `orgFolderPacks` (which has no fs
seam and passes `existsSync`) all call it as they are. It is true when
`<teamFolder>/packs/<team>/pack/skills.jsonc` exists and
`<teamFolder>/plugin/pack/skills.jsonc` does not.

The error is a `UserActionableError` whose `next` is the conversion command
and whose `thenRun` is `rt setup update`, the two-command shape
`failureFor` in `lib/errors.ts` already draws as "Run X, then Y":

> Your org repo still keeps the widgets pack at mattstack/teams/widgets/packs/widgets
> why: rt reads a team's pack from mattstack/teams/widgets/plugin now
> next: Run bun scripts/move-team-packs-to-plugin.ts ~/.mattstack/orgs/acme --write, then rt setup update

(The conversion command names the clone this Mac uses, so the member can
paste it to an admin.)

Who checks, in the order a Mac meets them:

- `readZonesFrom` (`lib/skills/init.ts`), the zone list every skills verb
  and materialize read, throws it for the first unconverted team folder. That
  covers `rt skills init`, `compile`, `check`, `sync`, `materialize`,
  `bind`, and the update run's `skills.materialize` step. That step's
  per-repo catch in `lib/setup/skills-materialize.ts` keeps only the
  error's message today; it learns to append a `UserActionableError`'s
  `next` and `thenRun` to the repo's `detail`, so the tray shows the fix,
  not just the title.
- `orgFolderPacks` (`lib/skills/packs.ts`), pack discovery for compile and
  check by `--pack-dir`, throws it too, so `rt skills compile` inside an
  unconverted clone names the fix rather than "no pack here".
- `readPackRequirements` (`lib/setup/requirements.ts`) does not throw: it
  runs from `composePlan`, `createApplyContext` and `rt tools`, where a
  throw fails the whole plan before any row draws. It returns
  `[{ pack: team, tools: [], integrations: [], error: <the error's message, next and thenRun as one sentence> }]`,
  which the tools validator already draws as an error row, so the checklist
  names the fix on the one row it always emits per pack.

The board's `activeTeamPack` keeps returning `null` (no pack): rt-client is
a library the apps read at render time, and the Mac's rt names the fix.

The detector module and the conversion planner
(`scripts/lib/move-team-packs.ts`) are the only production code that spells
the old path, and the guard test allowlists exactly those two files. The
script's wrapper builds its input paths through `nestedTeamPackRel`, so it
stays off the allowlist. The header comment of `lib/setup/requirements.ts`
spells the old path today and is rewritten with the function.

## 5. The snapshot zone

`teamStandingZones` in `lib/daemon/home-snapshot.ts` claims
`mattstack/teams/<team>/plugin/` for `skills-publish` in place of
`mattstack/teams/<team>/packs/`. Nothing else in that function changes: the
legacy `mattstack/packs/` zone for a pre-org clone and the
`mattstack/org/packs/` zone stay. `settings.team.jsonc` sits outside the
zone, so the watch commits it as today. The test fixture's `WIDGETS_PACK`
and `GADGETS` constants move to the new path.

## 6. The conversion script

`scripts/convert-team-repo-to-org.ts` and `scripts/lib/convert-team-repo.ts`
are renamed to `scripts/move-team-packs-to-plugin.ts` and
`scripts/lib/move-team-packs.ts`, because that is what the script now does;
their test becomes `scripts/__tests__/move-team-packs.test.ts`. The
team-repo split (settings table, roster, secrets, sops rules, `team.jsonc`)
and its flags (`--org`, `--org-placeholder`, `--team`, `--team-repo`,
`--roster-confirmed`) go with the legacy path.

Usage:

```
bun scripts/move-team-packs-to-plugin.ts <clone-dir> --admin <username> [--write]
```

The planner (`planMove(input)`), a pure function over the files it is
given, returns `{ moves, deletes, writes, report }`:

- **Input:** the marker, the marketplace, and for every folder under
  `mattstack/teams/` the nested manifest `packs/<team>/pack/skills.jsonc`
  and plugin manifest `packs/<team>/.claude-plugin/plugin.json` when they
  exist, plus `mattstack/org/settings.org.jsonc` and every
  `mattstack/teams/<team>/settings.team.jsonc`.
- **Refusals (throw, nothing planned):** a marker that is not `role: org`;
  a team folder that holds both `packs/<team>/` and `plugin/`; a
  `packs/<other>/` whose name is not the team's; a `packs/<team>/` without
  a parseable `plugin.json`; a store that does not parse; no team folder
  with a nested pack at all ("nothing to move").
- **Moves:** `mattstack/teams/<team>/packs/<team>` to
  `mattstack/teams/<team>/plugin` for every team with a nested pack. `git mv`
  of the folder leaves `packs/` empty, and git drops the empty parent.
- **Writes:** the moved pack's `.claude-plugin/plugin.json` with its patch
  version bumped; `.claude-plugin/marketplace.json` with each moved pack's
  entry pointed at `./mattstack/teams/<team>/plugin` (and its `version`
  bumped where the entry carries one); the org store and each team store
  with every value that spelled `<prefix>/mattstack/teams/<team>/packs/<team>`
  rewritten to `<prefix>/mattstack/teams/<team>/plugin`, for `${org}` and
  `${team:<name>}` prefixes alike, through the existing `rewritePaths`
  helper, which the planner keeps. A store with nothing to rewrite is not
  written.
- **Report:** one line per move, per version bump, per rewritten value, and
  a line for a team folder left alone because it has no pack.

The wrapper keeps every safety rule the current script has, unchanged in
words: the clone root check, no symbolic links on any touched path, team
sync off on this Mac, the recorded forge username matching `--admin`, a
clean clone with no ignored files in the managed folders, a branch checked
out that origin has and that is neither ahead nor behind, a dry run without
`--write`, destinations that must not exist, and the rollback that restores
the start commit and every pre-existing empty folder when a step throws. It
commits as `org: move team packs to plugin/` and ends by naming `git show`
and `rt team publish`.

The wrapper tests that pin those rules (symlinks, ignored destinations,
rollback bytes and empty folders, the sync and identity refusals, the dry
run) are kept and re-pointed at a fixture org repo in the current layout,
with placeholder names. The planner tests that pinned the split go.

`lib/__tests__/no-settings-bypass.test.ts` allowlists the two old files by
path with an exact count of raw store reads (4 and 2). The rename re-points
both rows to `scripts/lib/move-team-packs.ts` and
`scripts/move-team-packs-to-plugin.ts` with the counts the new code has
(the planner no longer parses team stores for a split, only the two stores
it rewrites, and the wrapper no longer reads a forge declaration from a
legacy store) and reasons that describe the move.

## 7. Docs and skills

Live docs say the new path and nothing about the old one:

- `docs/home-repo.md` (the janitor-only bullet) and
  `docs/settings-architecture.md` (the `packs/` sentence).
- `website/docs/start/teams.mdx` (the layout line) and
  `website/docs/skills/packs.mdx` (the team pack path and the attachments
  path), through the `rt:docs` skill.
- `AGENTS.md`: the settings-architecture paragraph gains one sentence naming
  `mattstack/teams/<team>/plugin/` as the pack, and the guard test's name.
- `plugins/mattstack`: `README.md`, `docs/your-first-pack.md`, the
  `creating-a-pack`, `extending-a-pack` and `editing-skills` skills, the
  `parameterized-skills` convention reference and the org-marker schema
  description. Edited under `mattstack:editing-skills` and
  `superpowers:writing-skills`, with a plugin version bump and a
  `CERTIFICATION.md` row appended per edited skill.

Historical specs and plans (`docs/superpowers/plans/*`, the two parent
specs) are point-in-time records and are not edited; this spec supersedes
the path they name.

## 8. The guard test

`lib/__tests__/no-nested-team-pack.test.ts`, modeled on
`no-legacy-teams-root.test.ts` (same `SCAN` roots, same skips for tests,
fixtures, `dist` and `node_modules`), fails any production TypeScript file
that spells the pre-move team pack path:

- `"packs"` joined after a team variable: `/"packs",\s*(team|zone\.team)\b/`;
- a template or string with `teams/<x>/packs/`: `/teams\/(\$\{[^}]*\}|<[^>]*>|[a-z0-9-]+)\/packs\//`.

The first pattern names only the two team variables, so it never matches
the base pack join `"org", "packs", name` in `lib/skills/base-attachments.ts`
or the bindings path `"packs", pack, "skills.jsonc"` in
`lib/skills/manifest-paths.ts`; the second never matches
`mattstack/org/packs/` or `repos/<slug>/packs/<pack>/`, which have no
`teams/` before them. The allowlist is `lib/team/team-pack-path.ts` and
`scripts/lib/move-team-packs.ts`.

A second block scans the live Markdown (`docs/*.md`, `website/docs/**`,
`plugins/mattstack/**/*.md`, `skills/**/*.md`, `AGENTS.md`, excluding
`docs/superpowers/` and `plugins/mattstack/CERTIFICATION.md`) for
`teams/<x>/packs/` and fails on a hit, so a doc cannot teach the old path.

## 9. Testing

Unit tests, each beside its code, run from the repo root one file at a time
(never the full suite locally):

- `lib/__tests__/rt-paths.test.ts`, `settings-paths-parity.test.ts` and
  `packages/rt-client/src/settings/__tests__/paths.test.ts`,
  `active-team.test.ts`: `teamPackDir` ends in `/plugin`.
- `lib/team/__tests__/team-pack-path.test.ts` (new): the three path
  helpers; the detector is true only for nested-without-plugin, false for
  plugin-only, nested-plus-plugin (not rt's call; the script refuses that)
  and neither; the error's title, why and both `next` commands.
- `lib/skills/__tests__/init.test.ts`, `packs.test.ts`,
  `materialize.test.ts`, `base-attachments.test.ts`, `sources.test.ts`:
  fixtures build `plugin/`; `readZonesFrom` and `orgFolderPacks` throw the
  detector's error for a nested fixture; the multi-pack materialize cases
  are removed; `rt skills init` writes the marketplace source
  `./mattstack/teams/widgets/plugin`.
- `commands/__tests__/skills*.test.ts`: the `teamPackDir` test helper
  builds `plugin/`; the `teamShaped` heuristic case asserts a team pack's
  `pack/skills.jsonc` is still never taken as a manifest; the
  `acme-base` under a team folder case goes.
- `lib/team/__tests__/add.test.ts`, `share-pack.test.ts`,
  `commands/__tests__/team.test.ts`, `onboarding-org.test.ts`: `rt team add`
  writes under `plugin/` and the new source.
- `lib/setup/__tests__/requirements.test.ts`, `apply.test.ts`,
  `materialize-world.ts`, `steps-b.test.ts`, `steps-c.test.ts`,
  `skills-materialize.test.ts`, `pack.test.ts`: fixtures move to `plugin/`;
  `readPackRequirements` returns one `error` entry carrying the fix for a
  nested fixture, and `composePlan` still composes; the materialize step's
  per-repo `detail` carries the error's next and thenRun.
- `lib/__tests__/no-settings-bypass.test.ts`: its two script rows name the
  renamed files with their new counts.
- `lib/daemon/__tests__/home-snapshot.test.ts`: the janitor-only zone is
  `mattstack/teams/widgets/plugin/`; `settings.team.jsonc` still
  auto-commits.
- `scripts/__tests__/move-team-packs.test.ts`: the planner over a fixture
  org repo in the current layout (two teams, one base pack, a settings-only
  team, a hook value spelling the nested path under `${org}` and under
  `${team:acme}`), every refusal, and the kept wrapper tests.
- `lib/__tests__/no-nested-team-pack.test.ts` passes on the branch.

Gates: `bun run typecheck`, `bun test lib/__tests__`, `bun run check`, the
`plugin-mattstack` job's checks after the version bump (certify,
`rt skills check --strict`), and CI green on the PR.

## 10. Rollout

1. Merge this PR and cut the release that ships it (app and plugin).
2. In the same step, the admin turns team sync off, runs the conversion
   script with `--write` against the org clone, reviews the commit, runs
   `rt team publish`, and turns sync back on.
3. Members update the app. The launch-time `rt setup update` runs
   `org.pull`, the daemon's `convergePackCache` sees the bumped version and
   updates the plugin from `plugin/`, and `skills.materialize` writes the
   bindings from the new path.

Between steps 1 and 2, a Mac already on the new rt with the unconverted
clone fails every skills verb and the materialize step with the detector's
error, which names step 2. Between steps 2 and 3, a Mac still on the old rt
reads the team folder as having no pack and may set that pack's bindings
aside; its next update rewrites them. Both windows are short and affect two
members, who update right after, which is why the hard break was chosen.

## Out of scope

- The org base pack's location (`mattstack/org/packs/<base>/`).
- The legacy team-repo conversion (removed, not replaced).
- Team-level secrets (`mattstack/teams/<team>/secrets/` is still only a
  reservation in the parent spec).
- A data migration for an org repo whose stores spell the nested path: the
  conversion script rewrites them as part of the move.
- Converting the live org clone: the shepherd runs the script after the
  merge and release.

## Risks

- A pending pack share recorded before the conversion names the old
  folder; `owedShares` drops a share whose folder is gone. The conversion
  commit carries everything that share would have, so nothing is lost.
- `readServedPacks` reads the version from the entry's source; the move,
  the source and the bump land in one commit, so no pull sees a source with
  no `plugin.json`.
- The `teamShaped` heuristic is the one place a wrong shape silently
  misreads a fragment as a manifest; its test is the first the plan writes.
