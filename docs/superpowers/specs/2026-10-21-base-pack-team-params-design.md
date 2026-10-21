# Base-pack text with team params and sections

## Why

An org base pack (`mattstack/org/packs/acme-base/`) lets every team pack in
the org share fills: a team pack names it with `"extends": "acme-base"` and
binds `acme-base:<fill>` to a slot. But a slot takes exactly one fill, and a
base fill's text is the same for every team. When two teams run the same
flow with a handful of different facts (their Linear team, ticket prefix,
the project question, which gates fill ship applies, an extra block of CI
rules), each team ends up forking the whole fill into its own pack.

Forks drift. In the org that prompted this, the two teams' provision fills
are 81% identical, their ship fills 78%, and one team forked the base
watch-ci fill only to add its own job rules. Six commits in two days made
the same edit by hand in both packs, and one pack ended up with two
provision texts that disagreed on how to handle a `busy` refusal.

This feature lets base text carry markers that each team pack fills in at
compile time, so the flow lives once in the base and each team supplies
only its facts and blocks.

## Goals

- Base text can carry **value markers** `{{team.<key>}}`, resolved from the
  team pack's `pack/params.jsonc`.
- Base text can carry **section markers** `{{team.section:<name>}}`,
  resolved from the team pack's `pack/sections/<name>.md`, inserted where
  the marker sits.
- Markers are required by default; a trailing `?` makes one optional and
  renders it as nothing when the team has not supplied it.
- A missing required key or section stops compile with a refusal that
  names the base file, the marker and the team file to add.
- `rt skills check` reports a params or sections edit as drift, and
  `rt skills sync` carries it, with no extra mechanism.
- `rt skills init --extends <base>` writes `extends`, seeds the params file
  and section files the base requires, and stops with a needs-you refusal
  listing what to fill in.
- The authoring skills and docs say how to use all of it.

## Non-goals

- Markers in a team pack's own fills or in mattstack engines. Only base
  text (base fills and the reference attachments a base copies into team
  packs) resolves them.
- Reading values from the settings store. Params are pack files, versioned
  with the pack and read at compile time.
- An "addendum" fill appended to a base fill on the same slot. Sections
  cover that case at a chosen position.
- Migrating any org's existing fills. That is follow-up work per org,
  outside this repo.

## Anti-goals

- **Silent drops.** A typo in a marker or a missing file must never compile
  to text with a hole in it. Today copied attachments pass an unknown
  `{{...}}` through untouched; a `{{team.` marker must never do that.
- **Teams editing base text.** A team changes its params and sections, never
  the base fill, and never by forking it.
- **New runtime state.** Everything resolves at compile time into the
  compiled verbs; an agent reading a compiled skill never sees a marker.

## The format

### Markers

| Marker | Resolves to | Missing |
| --- | --- | --- |
| `{{team.<key>}}` | the string at `params.<key>` in `pack/params.jsonc` | refusal |
| `{{team.<key>?}}` | the same, or nothing | nothing |
| `{{team.section:<name>}}` | the contents of `pack/sections/<name>.md` | refusal |
| `{{team.section:<name>?}}` | the same, or nothing | nothing |

`<key>` and `<name>` match `^[a-z][a-z0-9-]*$`. `team.section` is reserved:
no param may be named `section`. The existing `PLACEHOLDER_RE` in
`lib/skills/placeholders.ts` matches `{{team.section:<name>?}}` (the
argument allows `?`) but not `{{team.<key>?}}` (the kind charset has no
`?`), so team markers get their own pass with their own pattern, run
before any other substitution.

Markers do not nest. A value is prose: `{{team.gates-fill}}` may sit inside
a plain path in text (`../../attachments/{{team.gates-fill}}/SKILL.md`)
but never inside another marker's argument (`{{pack.path:{{team.x}}...}}`
is a refusal). A param value or section may not contain `{{`, so expanded
text is never substituted again.

Markers resolve in a base file's body only. A `{{team.*}}` marker in a
fill's or attachment's frontmatter is a refusal (inlined fills only
substitute the body, so a frontmatter marker would otherwise ship as
written).

### `pack/params.jsonc`

```jsonc
// Values the org base pack's text asks for. One line each.
{
  "version": 1,
  "params": {
    "linear-team": "Widgets",
    "ticket-prefix": "WID",
    "gates-fill": "widgets-gates"
  }
}
```

- A value is a non-empty string with no newline. A multi-line block is a
  section, not a param. An empty string counts as missing.
- A key the base never asks for is a warning on compile (it may be left
  over from a removed marker), not a refusal.

### `pack/sections/<name>.md`

Plain markdown, inserted verbatim at the marker with its trailing newline
trimmed. It may not contain `{{`; the team pass checks that itself, since
copied attachments have no stray-brace check today. Inside an inlined fill
the internal-roster and reference lints then apply to it as to the text
around it. The mcp lint covers `pack/sections/*.md` the way it covers
fills.

A section that is present but empty (whitespace only) counts as missing.

## Where markers resolve

1. **Base fills inlined into compiled verbs and stages.** A fill whose
   plugin is an org base (a `folderOnly` root) has its `{{team.*}}` markers
   resolved against the team pack being compiled, before the existing
   include/`verb.path`/`pack.path` substitution. A `{{team.*}}` marker in a
   fill that is not from a base is a refusal ("team markers only resolve in
   base pack text").
2. **Reference attachments a base copies into team packs.** In `.md`
   files, `{{team.*}}` markers resolve next to the existing `{{pack.name}}`
   expansion. A `{{team.*}}` marker in a copied non-`.md` file is a refusal,
   since those are copied raw. Unknown non-team markers keep today's
   pass-through behavior.
3. **Resolution keys on the team pack being compiled**, not on which base
   its `extends` names: today any org base can bind fills, so the team pack
   is the only stable owner of the values.

## Which markers a pack must supply

A marker is required for a team pack when it sits in base text that pack's
compile actually emits: the base fills its effective bindings resolve to
(after the team's own bindings shadow any base fill), in the verbs and
stages its roster and pipelines compile, plus the `.md` attachments the
base copies into it. A marker in a base fill the team has overridden, or
in a stage it does not run, is not required. `rt skills compile --verb x`
checks only what x emits. "A key the base never asks for" means a key no
emitted marker names.

When a base edit adds a new required marker, every extending team's next
compile or sync refuses until that team adds the value. That is intended
(Matt, 2026-10-21): the refusal is loud and names the fix, so no base-side
check or optional-first rule is added.

## Refusals

Compile collects every missing required marker across the whole pack as
data, writes nothing when any is missing (so no file with a hole ever
reaches disk, and init's resume check still sees an uncompiled pack), and
refuses once, in the existing pack-level `{title, details}` shape (the
base-plan pattern in `commands/skills.ts`):

```
The widgets pack is missing values the acme-base pack asks for
  pack/params.jsonc: linear-team (acme-base:provision-flow), ticket-prefix (acme-base:provision-flow, acme-base:ship-flow)
  pack/sections/ci-extra-jobs.md (acme-base:watch-ci-rules)
  next: add them, then rt skills compile --pack widgets
```

The wording follows `.claude/rules/output-layer.md`; the `--json` envelope
carries the same list structurally (key or section, kind, and the base
files that ask for it) and exits 1.

Every other verb that compiles in memory refuses the same way rather than
showing or comparing text with a hole: `rt skills check` reports the list
as a compile error, and `compile --preview`, `anatomy` and `composition`
refuse with it. `rt skills sync` stops at its compile step with the same
list.

## Drift, sync and provenance

- `rt skills check` recompiles in memory and compares bytes, so a params
  or sections edit already shows as drift once compile reads those files.
- `rt skills sync` already scopes `pack/` into what it stages.
- A compiled verb's seam markers and `compiled:` metadata keep naming the
  base fill (`acme-base:<fill>@org`).
- An inserted section gets its own seam marker in the compiled file, in
  the existing five-token shape:
  `<!-- part: section:<name> source=<team pack>:pack/sections/<name>.md version=<team pack version> path=pack/sections/<name>.md lines=1-<n> -->`.
  So `drift.ts` `partExtents`, `partsOnDisk`, the anatomy and composition
  views and the console's `parseSeam` keep walking compiled files by seam
  `lines=` counts. Each would otherwise cut a slot short when a multi-line
  section makes it longer than its source span. Value markers are single
  line and need nothing.

## Init

`rt skills init` gains `--extends <base>`:

1. Init writes `"extends": "<base>"` into the new fragment.
2. After materialize (which writes the bindings that decide which base
   fills apply), it runs compile, which reports any missing required
   markers without writing anything. Init then writes
   `pack/params.jsonc` with each required key set to `""`, and an empty
   `pack/sections/<name>.md` for each required section. Files that already
   exist are left alone, as `renderPackFiles` does today.
3. When any required value is still missing, it stops before compile with
   a needs-you refusal (`params-missing`) listing the keys and sections,
   each with the base file that asks for it.
4. The author fills them in and runs the same `rt skills init` again. Init
   resumes: `pack-exists` only fires once a pack has compiled, existing
   files are not rewritten, and with nothing missing it carries on through
   compile, check, the engine-floor admit, install and publish as usual.
5. With no required markers, init runs as it does today.

Without `--extends`, init is unchanged. Adding `extends` to an existing
pack by hand is still allowed; its first compile then refuses with the
list above.

## Engine floor

A pack whose base text uses `{{team.*}}` needs an engine that resolves it.
On an older rt, an inlined base fill refuses compile on the unknown marker
(loud), but a copied attachment would pass the marker through (silent).

The floor is raised only where it is needed: when a team pack's emitted
base text uses any `{{team.*}}` marker, compile writes that pack's
`pack/requires.json` `minEngine` as the higher of the mattstack floor and
the release that ships this feature. Packs in orgs that never use markers
keep today's floor. The mattstack plugin's own floor is not raised. The
docs say an org adopts markers once every member's app has the release.

## Docs and skills to update

- `plugins/mattstack/plugin/skills/extending-a-pack/SKILL.md`, "The org
  base pack": markers, params, sections, a recipe for "give a base fill a
  team value or block", examples in `acme-base` / `widgets`.
- `plugins/mattstack/plugin/skills/creating-a-pack/SKILL.md`: `--extends`
  and the `params-missing` stop.
- `plugins/mattstack/plugin/skills/editing-skills/SKILL.md`: params and
  sections are pack sources that compile reads.
- `website/docs/skills/packs.mdx` and the `compile`, `check` and `init`
  reference partials; `lib/skills/README.md`.

All skill edits go through `superpowers:writing-skills` and certify;
examples stay purity-clean.

## Decided in brainstorming (Matt, 2026-10-21)

- Shape: value markers plus named section markers.
- Params live in a team pack file (`pack/params.jsonc`), not settings.
- One file per section under `pack/sections/`.
- Required by default; `?` makes a marker optional.
- Markers only in base pack text (base fills and copied attachments).
- `init` seeds the files and stops with the list.
- Tracked by this spec plus Linear tickets: one for the engine feature, one
  per org migration.

## My calls (not discussed; check them)

- `init` gets the base through a new `--extends <base>` flag; init has no
  way to learn a base today. Re-running init resumes after the stop.
- "Required" means emitted by this pack's compile (effective bindings,
  roster and pipelines), for both init and compile.
- An unused param key warns instead of refusing.
- Empty strings and whitespace-only sections count as missing.
- A `{{team.*}}` marker outside base text, in a copied non-`.md` file, in
  frontmatter, or nested in another marker is a refusal.
- An inserted section gets its own five-token seam marker.
- The engine floor rises only for packs whose base text uses markers.

## Left to the builder

- Exact function boundaries for resolution in `placeholders.ts` and
  `base-attachments.ts`, and how the team context reaches `slotText` and
  `substituteIncludesOnly`.
- How `--extends` validates the base name (reuse `resolveBase`).
- The `--json` field names for the refusal list, within the output-layer
  rules.
