# Console wiring: the org base pack

Status: design, in review. Follows `2026-10-06-orgs-root-design.md`
(section 7) and `2026-10-01-org-and-teams-design.md` (section 4).

## Goal

The console's Wiring page was built before orgs. On an org with a base pack
(`acme-base`, `"base": true`, never installed) and a team pack (`widgets`)
that extends it, the page breaks in two places and says something false in
six. After this work the page shows a base fill's text, calls the base what
it is, counts base drift on Health, and never offers a change rt would not
make.

Success:

- Every place the page names a fill's owner tells a base pack apart from an
  installed plugin and from this pack, from a field rt sends, never from a
  guess.
- A base fill's text, used-by list and history open.
- Health reports a drifted base attachment or a base error the way rt's own
  check does.
- An emitted base attachment is labelled as a copy of the base, on the
  graph and on Surface, and its public/internal choice is locked.
- The design fixture has an org base, so parity runs can draw all of it.

## The audit

Read against a live org; the full list with screenshots stayed in the
worktree's ignored `.superpowers/audit/`. Paths are under
`apps/console/src/`.

| # | Finding | Where |
|---|---|---|
| F1 | A base fill's text 404s: the source route admits only the pack, engine and app skill dirs. | `server/skills.ts:1421-1440` |
| F2 | Health ignores `attachments[]` and `baseErrors[]` from `rt skills check`, so it can say "All in sync" while rt reports drift. | `server/skills.ts:125-130`, `HealthTab.tsx:389-398` |
| F3 | A base fill is "acme-base org · installed copy, read only". A base is never installed and `org` is not a version. | `graph/model/drawerContent.ts:157-159, 471` |
| F4 | "acme-base default · picked by this pack", "A acme-base default." | `graph/model/templateModel.ts:590, 662`, `drawerContent.ts:393-400` |
| F5 | "Edit it in the acme-base plugin." | `graph/drawer/UsedByTab.tsx:25` |
| F6 | History shows version `org`: "built with the installed copy, acme-base org". | `graph/drawer/history.ts:44-47, 116-125`, `BuiltFromTable.tsx:108-116` |
| F7 | A link to an emitted base attachment is badged "pack text", though compile rewrites it every time. | `graph/model/drawerContent.ts:575-590` |
| F8 | Surface badges emitted base attachments as compiled verbs and words a toggle as compiling into `skills/`. | `SurfaceTab.tsx:48-58, 141-153, 357` |
| F9 | History and diff are scoped to the pack dir, so a base edit never shows; seam attribution skips base seams. | `server/skills.ts:1233-1246, 1327-1336`, `seamAttribution.ts:180` |
| F10 | Nothing names the base the pack extends; the rebind panel's current fill drops its owner, and candidates read like plugins. | `graph/drawer/RebindPanel.tsx`, `graph/drawer/rebind.ts:105` |
| F11 | "The step's own source lives in the mattstack plugin, a different repo." | `VersionTimeline.tsx:466-469` |
| F12 | No fixture or test covers an org base. | `server/fixtures/design/` |
| R1 | rt reports a base fill's version as the token `org`, though the base's `plugin.json` has a real one. | `lib/skills/sources.ts:280` |
| R2 | `rt skills surface list` cannot tell an emitted base attachment from a compiled verb. | `commands/skills.ts:2336-2340` |
| R3 | No payload says which fill came from a base. | `commands/skills.ts` |
| R4 | `rt skills surface set <emitted> --public` writes the name public and moves nothing. | `commands/skills.ts:2599-2639` |

Checked and fine: no `~/.mattstack/teams` literal in the console; packs come
from `rt skills packs`, which never lists a base; the header's "in sync with
installed <engine>" names the engine; the installed caches bar names the
team pack; `layerLabel` handles `base:<pack>`; binding a base fill works;
`{{pack.name}}` renders verbatim; settings-kit has no wiring code.

## Decisions taken

| Question | Decision |
|---|---|
| Scope | Every finding, F1 to F12 and R1 to R4, in one PR. |
| How rt says "base" | Tag every item. Each payload carries its own origin, so a payload stays readable with several bases or orgs. |
| The `org` token | Unchanged. It is the version token compile writes into part headers; changing it recompiles every team pack. The real version rides beside it. |
| Surface toggle for an emitted base attachment | Locked. Verbs read it at `../../attachments/<name>/`; making it public would move it to `skills/`, break those links and trip compile's clash rule. rt refuses the flip too. |

## 1. rt: origin fields

An item is from a base in two cases, and rt tags both:

- **By name:** its plugin is a base root (a name in `PluginRoots.folderOnly`,
  which only base roots join). A fill bound as `acme-base:reply-rules`.
- **By path:** its folder passes `isEmittedAttachmentDir` (imported from
  `lib/skills/base-attachments.ts`, unchanged): compile's copy inside the
  team pack, carrying `compiled.json`. This covers a board-only base fill
  that compile emits into the team pack and materialize binds as
  `widgets:<name>`, which by name alone would read as the team's own text.

`orgBasePackRoots` (`lib/skills/sources.ts`) also returns `baseVersion`,
read through `packPluginIdentity` (`lib/skills/provenance.ts`), the reader
`resolveBase` already uses, with an empty string folded to null, so
composition and check never disagree on a base's version. The
`PluginRoots.byName` entry for a base gains `baseVersion` beside
`version: "org"`. Two helpers in `sources.ts`:

- `originOf(roots, plugin)` returns `{ origin: "base", base, baseVersion }`
  for a base root, else `{}`.
- `originOfDir(dir)` reads `compiled.json` when `isEmittedAttachmentDir(dir)`
  and returns `{ origin: "base", base, baseVersion }` from its `base` and
  `version`, else `{}`. A `compiled.json` that will not parse gives `{}`.

An item tagged by path wins over its name. The fields are added, never
renamed, and absent for anything not from a base:

| Payload | Item | New fields |
|---|---|---|
| `rt skills composition --json` | `verbs[].slots[]` | `origin`, `base`, `baseVersion` |
| | `fills[]` | same |
| | `binders[].slots[]` | same |
| | top level | `extends: { name, version } \| null` |
| `rt skills anatomy --json` | `template`, each `parts[].source` | `origin`, `base`, `baseVersion` |
| `rt skills surface list --json` | `rows[]` | `base: "<name>"` |

`origin` is the string `"base"` and `base` the base pack's name. A binder
slot carries no fill path today; rt resolves the bound fill the way the
verb slot does and tags it the same way.

The composition `extends` comes from `planBaseAttachments` (already called
by check for `extendsBase`): its `plan.base`, as `{ name, version }`, or
null. No new `extends` parser.

A surface row is keyed by the bare leaf name it has today
(`enumerateSkillEntries`), and its `base` comes from that leaf's own dir
through `originOfDir`. A grouped emitted unit (`group/leaf`) tags its leaf
row.

None of this edits `lib/skills/compile.ts` or
`lib/skills/base-attachments.ts`, which another lane is changing; it only
imports from the latter. The payload types in `commands/skills.ts` and
`lib/skills/anatomy.ts` gain the optional fields.

## 2. rt: the surface refusal

- `runSet` refuses before writing when `want` is `public` and any named row
  has a `base`: a `SkillsRefusal` titled "<name> comes from <base>", why "The
  org base pack decides. Verbs read it from attachments/, so it stays
  internal." Under `--json` that is the existing refusal envelope
  (`ok: false`, the message in `compileErrors`, exit 2).
- The interactive palette leaves base rows out of its options.
- `list` reports a base row's `status` as `internal`, whatever
  `surface.jsonc` says, since that is where it sits and stays. A base name
  already in the file's `public` list (an earlier flip wrote it) is
  harmless: `apply` already skips compiled rows, and `set <name>
  --internal` stays allowed and removes the name from the file. This changes the
  `status` value `list --json` reports for such a row (the keys stay); the
  PR body calls it out.

## 3. Console: one owner helper

`app/wiring/owner.ts` holds `ownerOf(item, pack)`, returning one of:

- `{ kind: "base", name, version }` when the item's `origin` is `"base"`
  (`name` is `base`, `version` is `baseVersion`, possibly null). Checked
  first, so a team-pack copy of a base file is a base.
- `{ kind: "pack" }` when the ref's plugin is the selected pack,
- `{ kind: "plugin", name, version }` otherwise.

Every finding below reads the owner through it, never by comparing plugin
names or reading `version === "org"`. The server types in
`server/skills.ts` and the anatomy types gain the optional fields; an older
rt that sends none reads as today.

Words, used everywhere a base is named:

| Place | Plugin (today) | Base |
|---|---|---|
| Input card subtitle (F4) | `mattstack default · picked by this pack` | `acme-base · org base · picked by this pack` |
| Drawer sentence (F4) | `A mattstack default. 2 skills ... use it.` | `From the org's acme-base base pack. 2 skills ... use it.` |
| Drawer meta (F3) | `mattstack 0.30.19 · installed copy, read only` | `acme-base 0.1.0 · org base pack, read only here` (no version when null) |
| Used-by footer (F5) | `Edit it in the mattstack plugin. ...` | `Edit it in the org's acme-base base pack. Every skill above picks up the change on its next compile.` |
| Built-from row (F6) | `mattstack 0.30.19` | `acme-base 0.1.0`, installed column `org base`, no "current" verdict from the token; the row's status follows the verb's check status |
| Built-from note (F6) | `... built with the installed copy, mattstack 0.30.19 ...` | `<skill> was built from the org's acme-base base pack. rt check says whether it is current.` |
| Rebind current fill and candidates (F10) | `mattstack · bound ...` | `acme-base · org base · bound ...` |

The rebind panel lists every fill `composition.fills` reports, as today:
for a board-only base fill that is the team-pack copy (`widgets:<name>`,
tagged by path), and for an inlined base fill the base original
(`acme-base:<name>`). Each reads its owner through `ownerOf`, so both say
`org base`. A drawer or card for a team-pack copy also carries section 5's
sentence about compile rewriting it.

## 4. Console: base fill text (F1)

The source route adds, to the roots rt reported, the plugin root of each
`composition.fills[]` entry whose `origin` is `"base"` and whose path lies
outside the pack, through the same `pluginRootOf`/`pluginSkillDirs` pair
the engines use. Roots still come only from rt, never the request, and the
realpath confinement is unchanged. A team-pack copy is already under the
pack dir. Test: a base fill path is served; a sibling file of the base
pack outside its skill dirs is still 404.

## 5. Console: base attachments (F7, F8)

- A link card or link drawer is a base copy when its pack-relative path
  starts with `attachments/<rel>/` for a `check.attachments[]` row's `rel`
  (its `name`, which is the unit's rel path, `group/leaf` for a grouped
  unit). It gets the badge `from acme-base` (the row's `base`) instead of
  `pack text`, and the sentence adds "Compile copies it from the org's
  acme-base base pack and rewrites it on every compile; edit it there."
- Surface: a row with `base` gets a `from acme-base` badge in place of
  `compiled`, sits under the Compiled filter as today, shows as internal,
  and its toggle is disabled with a tooltip "The org base pack decides.
  Verbs read it from attachments/, so it stays internal." No compile
  wording is shown for it.

## 6. Console: Health (F2)

`SkillsCheckResponse` gains `attachments` and `baseErrors` (optional).
rt's attachment statuses are `in-sync`, `stale`, `never-compiled` and
`orphaned`:

- `stale` counts into the Source newer card,
- `never-compiled` into the Never compiled card,
- `orphaned` (its base no longer has it, or the pack no longer extends a
  base; the next compile removes it) into no card,

and every non-`in-sync` row and every `baseErrors` entry is listed in an
"Org base" group naming the base and the status in rt's words. Any of them
puts the page in its drift state, so "All in sync" shows only when verbs,
attachments and base errors are all clean, matching rt's `anyStale`. The
Sync bar shows when rt would sync.

## 7. Console: history, diff and the base (F9, F11)

The base and the team pack share the org repo. The base's paths are named
in a `base:<name>/` coordinate, `<name>` the base and the rest its path
inside the base pack (`base:acme-base/attachments/reply-rules/SKILL.md`),
so they never collide with a pack-relative path.

- **History** (`/api/skills/history`) for a verb that binds a base fill
  adds that fill's dir as a second pathspec to the same `git -C packDir
  log`, given repo-root-relative (`:(top)<path>`, the fill dir's realpath
  relativized against `--show-toplevel`, itself a realpath, so a symlinked
  org clone still matches). A base commit then shows in the verb's list,
  and its `files` under a base dir take the `base:<name>/` coordinate, the
  same form dirty files use.
- **Diff** (`/api/skills/diff`) keeps its `--relative` pack diff and, for
  the base fill dirs the pack's composition names, runs a second
  `git diff --no-color <from>..<to> -- :(top)<path>...` with no
  `--relative`. Its file paths are rewritten to the `base:<name>/`
  coordinate and returned in a new `baseDiff` field beside `diff`, bounded
  by the same byte cap (shared, the pack diff first).
- **Dirty files** (`dirtyFilesIn`) take the base fill dirs as extra scopes
  and report them in the same coordinate.
- **Seam attribution:** `seamPackPath` returns `base:<name>/<seam.path>`
  for a seam whose source `ownerOf` calls a base and whose absolute path
  lies under that base's root, in place of its `pluginOf(seam.ref) !==
  index.pack` bail; the timeline parses `baseDiff` with those paths, so a
  base hunk attributes to its seam. A seam with no resolvable path stays
  unattributed, as today.
- When a base dir sits outside the pack's repo (git says so), the routes
  drop that pathspec rather than fail.
- A board-only base fill is bound to its team-pack copy, so it adds no base
  pathspec: an edit on the base side shows in no history or diff until
  compile copies it again, and the copy's change then shows in the pack's
  own diff.
- The VersionTimeline note says "The step's own source lives in its engine
  plugin, and base fills in the org's base pack, outside this pack's
  folder."

## 8. Console: naming the base (F10)

The Wiring toolbar shows `extends acme-base` beside the pack picker when
composition's `extends` is set; absent or null shows nothing.

## 9. Fixtures and tests (F12)

The design fixture gains an `acme-base` base with one fill bound into a
verb and one emitted attachment a verb links to, plus a scenario
`base-drift` where that attachment is stale and a base error is listed.
Tests:

- rt: `originOf` and `originOfDir` (by name, by path, path winning, a bad
  `compiled.json`); `baseVersion` matching check's; the composition,
  binder and anatomy fields and `extends`; the surface `base` field and a
  base row listed internal; the refusal (human and `--json`) and
  `set --internal` still allowed; all in the existing
  `commands/__tests__/skills-*.test.ts` and `lib/skills/__tests__/` files.
- Console: `owner.ts` unit tests (base before pack); model tests for each
  wording row in section 3; the source route admitting a base fill; Health
  placing each attachment status; Surface's locked row; the link badge
  matching a grouped unit; history, diff and dirty files with the base
  pathspec; a base hunk attributing to its seam.

## Verification

`bun run console:test` (or the app's `test`, `typecheck`, `lint`), `bun run
check`, the targeted rt tests, and the console rendered in Fast Browser in
light and dark against both the live org and the fixture's `base-drift`
scenario, every changed view looked at and described.

## Out of scope

- Changing the `org` version token or anything compile emits.
- Showing a base pack as its own selectable pack.
- Editing a base from the console.
