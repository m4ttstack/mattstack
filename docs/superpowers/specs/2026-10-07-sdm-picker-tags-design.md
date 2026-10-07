# sdm picker: group by StrongDM tags, team `sdm.*` settings

## Problem

`rt sdm connect`'s picker files most resources under "Other". A tier and a
label only come from hand-written `rt.sdmEnrichment` entries, so every
resource nobody wrote an entry for lands there, including every new one
StrongDM adds. On a real catalog of about 200 postgres resources, about 180
are in "Other".

The catalog already says what each resource is. Every row carries `env`,
`access` and `domain` tags, and most carry `tenant` (the carrier).
`lib/sdm/scan.ts` parses them into `SdmResource.tags`, and
`buildSdmConnections` drops them.

The picker also drops each row's `tone` (`navOptionsToRows` in
`lib/pick-wrappers.ts` never passes it on), and its filter matches the
label only.

## Decisions (Matt, 2026-10-07)

- Layout A: environment first, one header per environment and carrier
  (`QA · ACME`), rows showing domain, access and resource. Boards drawn in
  Pen (kept out of the repo, since they use live resource names).
- Access colour: `write` peach, `admin` coral, `read` and `reader` plain.
- Untagged (older) resources: carrier taken from the name, row marked `old`,
  shown with its carrier.
- Carrier display names live in team config, never in rt source (this repo
  is public and carrier names are employer data).
- Settings shape: two team keys in an `sdm.*` namespace, `sdm.resources` and
  `sdm.carriers`, shown together under a StrongDM group in console settings.
- Migration moves `rt.sdmEnrichment` to `sdm.resources` in one step: write
  the new key, delete the old one.

## Settings

### `sdm.resources`

The enrichment map under a new name, with exactly `rt.sdmEnrichment`'s
schema: resource name to `{ label?, tier?, production?, reasonSuggestion?,
db? }`. Team scope (and org, which every team key allows), `merge:
"replace"`, no `default` (the ownership latch below depends on it). The
zod schema in `registry-schemas.ts` carries `labels: { key: "resource",
value: "override" }` so the console names its sections.

### `sdm.carriers`

Tenant tag to display name: `{ [tenant]: { label: string } }`. An object per
entry, not a bare string, because the console only draws a form for a map
of objects. Same scope, merge and no-default rules as `sdm.resources`.

A tenant with no entry is shown by its tag with the first letter capitalised
(`acme` reads `Acme`).

### Reading enrichment

`loadEnrichment` keeps its contract (never throws, never mutates) and reads
in this order, first present wins wholesale:

1. `sdm.resources`
2. `rt.sdmEnrichment` (a team whose owner has not run the migration yet)
3. the legacy `~/.mattstack/rt/sdm/enrichment.jsonc` file

`rt.sdmEnrichment` stays registered (a store that still holds it must not
warn) and its description names `sdm.resources` as the replacement. The
`rt sdm enrichment init` scaffold refusal checks both keys.

### Migration

A `MigrationDef` with a dated id (`2026-10-07-sdm-resources-key`). For each
team folder in this Mac's org clone: when the team store holds
`rt.sdmEnrichment` and not `sdm.resources`, write the value to
`sdm.resources` and unset `rt.sdmEnrichment`, both through
`setSetting`/`unsetSetting` with `{ team }`. A write the role check refuses
(this Mac does not own that team) leaves the team alone. The result is
`done` when any team moved, else `skipped`. The team sync engine pushes the
change, so it reaches members without a hand commit.

A member running an older rt reads neither new key, so its picker loses
labels until it updates. Matt chose this over keeping both keys for a
release.

### Console

A new `StrongDM` group in `apps/console/src/app/settings/groups.ts`
(tier `rt`) matching `sdm.*` and `rt.sdmEnrichment`; `rt.sdmEnrichment`
leaves the Daemon group's pattern. Both new keys draw as section forms
through the existing `objectMap` editor, with no editor change.
`groups.test.ts` keeps every key in exactly one group.

## Building connections (`lib/sdm/browse.ts`)

`SdmConnection` gains `carrier?: string` (display name), `carrierTag?:
string`, `domain?: string`, `access?: string` and `legacy?: boolean`.

- **tier**: enrichment `tier`, else the `env` tag mapped: `dev` to
  `development`, `prod` to `production`, `qa` and `staging` as they are;
  any other value (`labs`, `training`, `latest`) is its own tier.
- **carrier**: the `tenant` tag. With no tenant tag, the first `-`
  separated segment of the resource name that equals a tenant tag seen
  elsewhere in the same catalog, and the row is `legacy`. No match leaves
  the carrier unset. The display name comes from `sdm.carriers`, else the
  capitalised tag.
- **domain**, **access**: the tags as they are. `read` and `reader` stay
  distinct (they are different database users).
- **label**: enrichment `label` when set, else built from the tags.

`buildSdmConnections` takes the carrier map as a third argument; the
caller in `commands/sdm.ts` reads it with `getSetting("sdm.carriers")`.

## Picker layout (`lib/sdm/picker.ts`)

- Recent stays first (up to 3 rows), each led by carrier and environment
  (`Acme QA`), since no header carries them.
- Then one header per environment and carrier, `QA · ACME`, environments in
  the existing order (development, qa, staging, production, then the rest
  alphabetically), carriers alphabetically within each. Resources with no
  carrier sit under the bare environment header (`QA`) after its carriers.
  Resources with no tier at all keep the "Other" group.
- Rows: domain, access, resource name, then a dim `old` on legacy rows.
  Within a header, `core` first and other domains alphabetically, then
  access in the order read, reader, write, admin, then legacy rows after
  their current twin.
- A row with an enrichment label shows that label in the domain column.
- Columns are padded in TS (the picker has one shared label width), so the
  domain, access and resource columns line up across the whole list.
- Tones: the access cell is peach for `write` and coral for `admin`; a live
  tunnel keeps its blue gutter.

## Picker plumbing

`NavOption` (`lib/navigate.ts`) gains two optional fields:

- `cells?: { text: string; tone?: string; bold?: boolean }[]`, drawn after
  the label as extra segments.
- `match?: string`, the text the filter ranks, defaulting to the label.

`navOptionsToRows` passes `tone` to the label segment, appends `cells`, and
uses `match`. The sdm picker sets `match` to carrier, environment, domain,
access and resource name, so typing `acme qa write` finds a row even though
the header carries the carrier. Other pickers set neither field and render
as before.

## Testing

- `browse.test.ts`: tier from `env`, enrichment overrides, carrier from
  tenant, from the name (legacy), and unset; display name from the map and
  the capitalised fallback.
- `picker.test.ts`: header names and order, row order, recent rows, the
  bare-environment and Other groups, tones, `match`, no duplicate rows.
- `enrichment.test.ts`: the three-step read order and the latch.
- A migration test: moves on an owned team, leaves a refused team alone,
  skips when already moved.
- `registry.test.ts`: both rows team-only, no default; `schema.lock.json`
  and `schema-examples.ts` updated; `groups.test.ts` for the console group.
- Fixtures use invented names (`acme`, `globex`), never a real tenant.
- UI check: run `rt sdm connect` in a pane, screenshot the picker, and
  compare it with board A; open console settings and screenshot the
  StrongDM group in light and dark.

## Docs

`docs/strongdm.md` and `website/docs/rt/guides/strongdm.mdx` name the two
new keys and the migration; `rt docs` gen if a command description changes
(none planned).

## Out of scope

- Grouping or hiding legacy rows behind a key.
- Fixing missing `tenant` tags in StrongDM itself.
- Any change to the Go picker.
