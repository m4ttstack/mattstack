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

`orgBasePackRoots` (`lib/skills/sources.ts`) also returns `baseVersion`, the
`version` in the base's `.claude-plugin/plugin.json`, or `null` when the file
or field is missing. The `PluginRoots.byName` entry for a base gains
`baseVersion` beside `version: "org"`. One helper in `sources.ts`,
`originOf(roots, plugin)`, returns `{ origin: "base", baseVersion }` for a
name in `roots.folderOnly`, else `{}`.

The fields are added, never renamed, and are absent for anything that is
not from a base:

| Payload | Item | New fields |
|---|---|---|
| `rt skills composition --json` | `verbs[].slots[]` | `origin`, `baseVersion` |
| | `fills[]` | `origin`, `baseVersion` |
| | `binders[].slots[]` | `origin`, `baseVersion` |
| `rt skills anatomy --json` | `template`, each `parts[].source` | `origin`, `baseVersion` |
| `rt skills surface list --json` | `rows[]` | `base: "<name>"` when the folder carries `compiled.json` |

`origin` is the string `"base"`. A binder slot carries no fill path today;
its origin comes from the bound plugin name the same way. A surface row's
`base` is read from the `compiled.json` `base` field; a folder whose
`compiled.json` will not parse gets no `base`, so it reads as a compiled
row, as today.

None of this touches `lib/skills/compile.ts` or
`lib/skills/base-attachments.ts`, which another lane is editing. The
payload types in `commands/skills.ts` and `lib/skills/anatomy.ts` gain the
optional fields.

## 2. rt: the surface refusal

`runSet` refuses before writing when `want` is `public` and any named row
has a `base`: a `SkillsRefusal` titled "<name> comes from <base>", why "The
org base pack decides. Verbs read it from attachments/, so it stays
internal." Under `--json` that is the existing refusal envelope
(`ok: false`, the message in `compileErrors`, exit 2). The interactive
palette leaves base rows out of its options. Making a base row internal is
a no-op and stays allowed.

## 3. Console: one owner helper

`app/wiring/owner.ts` holds `ownerOf(item, pack)`, returning one of:

- `{ kind: "pack" }` when the ref's plugin is the selected pack,
- `{ kind: "base", name, version }` when the item's `origin` is `"base"`
  (version is `baseVersion`, possibly null),
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

## 4. Console: base fill text (F1)

The source route adds, to the roots rt reported, the plugin root of each
`composition.fills[]` entry whose `origin` is `"base"`, through the same
`pluginRootOf`/`pluginSkillDirs` pair the engines use. Roots still come
only from rt, never the request, and the realpath confinement is unchanged.
Test: a base fill path is served; a sibling file of the base pack outside
its skill dirs is still 404.

## 5. Console: base attachments (F7, F8)

- A link card or link drawer whose path lands in an emitted base attachment
  (the folder name matches a surface row, or a `check.attachments[]` row,
  with a `base`) gets the badge `from acme-base` instead of `pack text`, and
  the sentence adds "Compile copies it from the org's acme-base base pack
  and rewrites it on every compile; edit it there."
- Surface: such a row gets a `from acme-base` badge in place of `compiled`,
  sits under the Compiled filter as today, and its toggle is disabled with
  a tooltip "The org base pack decides. Verbs read it from attachments/, so
  it stays internal." No compile wording is shown for it.

## 6. Console: Health (F2)

`SkillsCheckResponse` gains `attachments` and `baseErrors` (optional).
Health counts an attachment row whose status is not `in-sync` into the
Source newer card and the drift state, and lists such rows and every
`baseErrors` entry in an "Org base" group with the base named. "All in sync"
shows only when verbs, attachments and base errors are all clean, matching
rt's `anyStale`. The Sync bar shows when rt would sync.

## 7. Console: history and the base (F9, F11)

- History (`/api/skills/history`) for a verb that binds a base fill adds the
  base fill's skill dir as a second pathspec to the same `git -C packDir
  log`, since the base and team pack share the org repo. A base commit then
  shows in the verb's list. When the base sits outside the pack's repo (git
  answers it is outside the repository), the route drops that pathspec
  rather than failing.
- Seam attribution maps a base seam to its path in the base pack, so the
  timeline can attribute a base edit; it stays unattributed when no path
  resolves, as today.
- The VersionTimeline note says "The step's own source lives in its engine
  plugin, and base fills in the org's base pack, outside this pack's
  folder."

## 8. Console: naming the base (F10)

The Wiring toolbar shows `extends acme-base` beside the pack picker when the
pack extends one. Its source is a new `extends` field on the composition
payload (rt reads it from the pack's `pack/skills.jsonc`, already parsed for
materialize); absent means no base. This is the one composition-level field;
everything else is per item.

## 9. Fixtures and tests (F12)

The design fixture gains an `acme-base` base with one fill bound into a
verb and one emitted attachment a verb links to, plus a scenario
`base-drift` where that attachment is stale and a base error is listed.
Tests:

- rt: `originOf`, the composition and anatomy fields, the surface `base`
  field, the refusal (human and `--json`), all in the existing
  `commands/__tests__/skills-*.test.ts` and `lib/skills/__tests__/` files.
- Console: `owner.ts` unit tests; model tests for each wording row in
  section 3; the source route admitting a base fill; Health counting base
  drift; Surface's locked row; history adding the base pathspec.

## Verification

`bun run console:test` (or the app's `test`, `typecheck`, `lint`), `bun run
check`, the targeted rt tests, and the console rendered in Fast Browser in
light and dark against both the live org and the fixture's `base-drift`
scenario, every changed view looked at and described.

## Out of scope

- Changing the `org` version token or anything compile emits.
- Showing a base pack as its own selectable pack.
- Editing a base from the console.
