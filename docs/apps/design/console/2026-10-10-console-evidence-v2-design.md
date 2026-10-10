# Console evidence@2: every case, its waiver and its captions

RT-484. Builds on RT-483's `evidence@2` (spec:
`docs/superpowers/specs/2026-10-10-evidence-v2-design.md`, landing with
RT-483). The boards are in `runs.pen` (see "Boards" below).

## Problem

The run page assumes one before and one after per run. Under `evidence@2` a
run carries several cases, each image annotated with a caption or waived with
a reason, and a slot may hold a light and a dark capture. Today the console
reads through `parseEvidence`, which turns a v2 value into a legacy link list,
so a v2 run shows a pile of file names; and even for v1 it shows only one
case, never a caption or a waiver, and the record's thumbnails show the plain
capture although the compare modal defaults to the annotated one.

## What the console does today (audit)

Read from `run-page/EvidenceCard.tsx`, `EvidenceCompare.tsx`,
`EvidenceImage.tsx`, `evidenceImages.ts`, `RecordPage.tsx`, `StageRow.tsx`,
`derive/story.ts`, `server/runs.ts` and the design fixture.

| Surface | Features | States |
|---|---|---|
| Story row (evidence stage, ship stage) | the stage's phase (before on evidence, after on ship) as 240px thumbnails, plain then annotated, each with its file name in mono; the run's `url` once, on the first phase placed; "Open full size →"; a thumbnail opens compare on its phase and variant | no image for the phase (renders nothing); broken image (placeholder, never re-requested); legacy v0 (screenshots as thumbnails plus editor links and urls, own modal per image) |
| Story summary (`stageSummary`) | "2 screenshots, 1 link" counted per phase, after the decision count | legacy counts images and links |
| Record, Evidence tab | one card: `EVIDENCE · n` (n = images), "attached to !iid" when `attach` is `ship` and the MR exists, Before and After thumbnails (plain preferred) with phase and file name, the transcript; a separate `CASE USED` card | no images (no thumbnails, no count, transcript only); no transcript; no case; legacy card (`EVIDENCE · n`, n = links) |
| Record tab count | images (v1) or links (v0) | hidden at 0 |
| Compare modal | the kit Modal at `100vw - 48px`, titled "ticket · case"; one `SegmentedControl` Before / After / Side by side (only phases that exist); the variant the thumbnail showed (annotated by default); caption under each frame: the phase (side) or the file name | one phase (no control); focus starts on Close; `?compare=<mode>` opens it on the Evidence tab and is dropped on close or when there is nothing to compare |
| Server | `GET /evidence/:key` (v1 key or `transcript`) through `runs:evidence`; `GET /evidence-file?path=` for legacy images; the fixture answers both | 404 `no evidence` |

## Design

### Data: one reader, one view model

Every console caller moves from `parseEvidence` to `readEvidence` (RT-483).
It returns `version: 2` (cases, `source: 1 | 2`) or `version: 0` (legacy
links) or `version: null`; a v1 value is one case with id `case`.

`run-page/evidenceImages.ts` keeps the console's helpers over that record:

- `slotsOf(case)`: the slots present, before then after.
- `themesIn(case)`: the themes the case's slots carry (`[]` unthemed).
- `shotIn(case, slot, theme?)`: the shot for a theme, else the slot's first.
- `isWaived(shot)`: an image that goes out unmarked (no annotated copy, a
  waiver). `caseWaived(case)` and `phaseWaived(case, slot)`: **a case (or
  one of its slots) is waived when none of its images is annotated**. One
  waived image beside an annotated one (the dark twin of a marked light
  shot) is shown on its own line, never as a waived case.
- `evidenceUrl(repo, runId, {caseId, slot, theme?, annotated})` and
  `transcriptUrl(repo, runId)`.

`legacyImageUrl` and the legacy rendering stay as they are.

### Addressing

- New route `GET /api/runs/:repo/:runId/evidence/:case/:slot`, query
  `theme=light|dark` and `annotated=1`, calls `runsEvidence` with RT-483's
  `{runId, repo, case, slot, theme?, annotated?}` payload. The fixture
  answers it from the run's record the same way.
- `GET /evidence/:key` stays, used only for `transcript`.
- `?compare=<mode>&case=<id>&theme=<light|dark>` on a record opens the
  modal on that case and theme; `case` defaults to the first case, `theme`
  to light. Closing drops all three.

### Count

`EVIDENCE · n` and the Evidence tab count **cases** for an evidence@2
record (a v1 record counts 1); legacy keeps counting links. A reviewer
reads a run by case; counting images double-counts every annotated copy.
The runs list draws no evidence count any more, so nothing else changes.

### Record column (board `runs-ev-record`)

One Evidence card (as today), its eyebrow `EVIDENCE · n` and "attached to
!iid". Inside, one group per case, separated by a rule:

- **Head**: the case label (500); when the case is waived (none of its
  images annotated), a quiet gray `waived` badge; when it carries both themes, a gray `light + dark` badge.
  A v1 record whose label is the reader's fallback (`Evidence`) draws no
  head, so a v1 run with no case text reads as one plain pair.
- **Thumbnails**: Before and After in the existing two-column grid, each the
  **annotated** image when there is one (else the base), the light theme
  when the slot is themed. A case with no before keeps After in the right
  column, with a dimmed `No before image` line in the left, so the columns
  line up down the card. Clicking a thumbnail opens compare on that case,
  phase and theme.
- **Under each thumbnail**: the phase (500), `light` after it in the dimmed
  tone when the slot is themed, then one line: the caption when
  the image is annotated, else `Waived: <reason>` in the dimmed tone. A
  waiver that is the case's own (not the image's) shows once, under the
  head, as `Waived: <reason>`, and the images it covers say only `Waived`.
- The `CASE USED` card goes: the case label replaces it.
- The transcript stays at the end of the card.

### Story rows (board `runs-ev-story`)

The evidence stage row shows every case's before images, the ship row every
case's after images (as today, a phase with no image in any case is left
off; v1 keeps its existing placement rules).

- **One case**: as today (plain then annotated thumbnails with file names,
  the url, "Open full size →"), plus the caption or waiver line under the
  thumbnail it belongs to.
- **Several cases** (option B, recommended): one 240px thumbnail per case
  in a wrapping strip: the annotated image, else the waived base, the light
  theme when the slot is themed. Under it the case label (500) with its
  `light + dark` badge and, when its images in that phase are all waived,
  `waived`, then the caption or `Waived: <reason>`.
  Clicking a thumbnail opens compare on that case and phase; the plain
  capture is there. Option A (every case's plain and annotated thumbnails,
  `renders/runs-ev-story-option-a.*.png`) was drawn and is not proposed: it
  runs three times as tall for the same information.
- The summary reads `3 cases, 1 waived` (waived = cases whose images in
  that phase are all waived), plus `, 1 link` where the url shows; a one-case
  record keeps today's `2 screenshots, 1 link`.

### Compare modal (board `runs-ev-compare`)

Same modal, controls in the header, left to right:

- **Case picker**: kit `Select` of case labels, shown when there is more than
  one case; the title is then the ticket alone (`WEB-421`). With one case
  there is no picker and the title reads `ticket · <case label>`, as today.
- **Theme**: kit `SegmentedControl` Light / Dark, shown only when the case
  has both themes; a slot with one theme shows that theme in both settings.
- **Mode**: Before / After / Side by side, as today, over the case's slots.

Under each frame: the phase (side by side) or the file name (one phase),
then the caption, or `Waived: <reason>`. Switching case keeps the mode when
the new case has it, else falls back to its last mode; switching keeps the
link in step (`case`, `theme`).

### Waivers read calm

A waiver is a decision, not a fault: kit `Badge` `light` in `gray`, the
reason in `c="dimmed"` text. Never `warn` or `bad`, no alert icon.

### Legacy and v1

- v0 evidence renders exactly as today (`LegacyEvidence`, `RecordLegacy`,
  `/evidence-file`).
- A v1 record is one case: the record shows its pair with the annotated
  thumbnail and the case label as the head (or none), the story and compare
  as today. Its images are served by case `case`.

## Components and files

| Unit | Change |
|---|---|
| `evidenceImages.ts` | helpers above; drops the v1 key tables |
| `EvidenceCard.tsx` | `RecordColumn` → per-case `CaseGroup`; `StoryEvidence` → per-case blocks; `V1Evidence` → `CaseEvidence`; legacy untouched |
| `EvidenceCompare.tsx` | case `Select`, theme control, caption line, `useCompareLink` reads `case`/`theme` |
| `RecordPage.tsx`, `StageRow.tsx`, `derive/story.ts` | `readEvidence`; counts and summaries by case |
| `server/runs.ts` | the `/evidence/:case/:slot` route |
| `fixtures/design/runsFixture.ts` | `readEvidence`, the new route, `evidence_cases` |
| fixture runs | WEB-421 (below) |

## Fixture

A new finished, merged work run, WEB-421 (`20261008-1210`, hidden from the
lists), recorded as evidence@2 with three cases:

1. `rush-window` "Rush order, same-day window": before and after, both
   annotated with captions.
2. `order-card-themes` "Order card in light and dark": before and after,
   both themed; both befores and the light after annotated with captions,
   the dark after waived on its own ("Same marks as light; only the theme
   differs").
3. `empty-state` "No delivery window yet": after only, case waiver ("Before
   and after are pixel-identical").

Images are copies of the existing fixture photos under new names. WEB-409
and WEB-412 stay v1, so the existing boards keep their data.

## Boards

New frames in `runs.pen`, light then dark (renders in `renders/`). Parity
exports (`parity/<slug>.<scheme>.html`) are taken once the boards are
approved, and the plan adds them to `boards.ts`.

| slug | frame (light) | light id | dark id | route | roots |
|---|---|---|---|---|---|
| `runs-ev-record` | `Evidence v2 · Record (3 cases)` | `fk63W` | `KawsQ` | `/runs/remote%3Aacme%2Fweb/20261008-1210`, Evidence tab | `Evidence` |
| `runs-ev-story` | `Evidence v2 · Story rows · B · one shot per case (3 cases)` | `u5oje` | `E7Qki` | `/runs/remote%3Aacme%2Fweb/20261008-1210`, evidence and ship rows open | `Story list` |
| `runs-ev-compare` | `Evidence v2 · Compare (case, theme)` | `Yhu2H` | `F0mno7` | `…/20261008-1210?compare=side&case=order-card-themes&theme=dark` | `Compare` |

Option A of the story (`KILKv` / `B22iH`) is kept for the record and never
compared.

`runs-p2-record`, `runs-p2-story-details` and `runs-p2-overlays` keep
passing for the v1 runs, with board-fix entries for what changes there: the
record thumbnail shows the annotated image, the `Case` card is gone (the case
label heads the pair), and an annotated story thumbnail carries no caption
line because v1 records none.

## Error handling

- An image that fails to load keeps the existing placeholder.
- A `?compare=` link naming an unknown case opens the first case; one
  naming an absent theme opens light; one on a run with nothing to compare
  is dropped, as today.
- The route answers 404 `no evidence` for an unknown case, slot or theme.

## Testing

- `evidenceImages.test.ts`: helpers over v2 (themes, one theme, unthemed,
  case and image waivers) and over a v1-sourced record.
- `EvidenceCard.test.tsx`: three cases render three groups; captions and
  waivers; annotated thumbnail default; theme badge; v1 pair; legacy
  untouched.
- `EvidenceCompare.test.tsx`: case picker present only for several cases;
  theme control only when both themes; caption and waiver lines; link
  `case`/`theme` in and out.
- `story.test.ts`: placement and `3 cases, 1 waived`; one case keeps its
  wording.
- `fixtureRoutes.test.ts` and route tests: case/slot/theme addressing, 404s.
- Parity: the three new boards plus the three existing ones, light and dark.
- Fast Browser screenshots of the record, story rows and compare modal for
  WEB-421 (multi-case, waived, light/dark) in both schemes.

## Not in scope

- MAT-429 (local-only evidence reads) is its own change; the new route is
  added beside the existing ones and takes the same gate when that lands.
- A Plain/Annotated control in the compare modal.
