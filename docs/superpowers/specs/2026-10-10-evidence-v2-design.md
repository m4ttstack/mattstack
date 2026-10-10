# evidence@2: every case in the record, annotated or waived

RT-483. This spec is the schema contract that RT-484 (console) and
SKILLS-97 (pipeline skills) build on.

## Problem

`evidence@1` holds one before and one after. A run that verifies several
cases has nowhere to record the rest, so later captures go around the
record. Nothing checks the field: `parseEvidence` is lenient, `run_field_set`
stores anything, and `mr_upload` cannot tell evidence from any other image,
so a raw screenshot reaches an MR with nothing in the way.

Filenames are not the fix. Real evidence folders (`~/.mattstack/evidence/`)
mix `-annotated`, `-light`/`-dark`, `r3-`/`r4-` round prefixes and no
convention at all, the caller picks every name, and folders keep earlier
rounds' files. The record, not the folder, says what may go out.

## The shape

The `evidence` run field holds this JSON:

```json
{
  "v": 2,
  "cases": [
    {
      "id": "shape2",
      "label": "Shape 2 plate on the claim page",
      "before": { "path": "/abs/before.png", "annotated": "/abs/before-annotated.png", "caption": "Red box: the plate renders blank" },
      "after": {
        "light": { "path": "/abs/after-light.png", "annotated": "/abs/after-light-annotated.png", "caption": "Arrow: plate number now shows" },
        "dark": { "path": "/abs/after-dark.png", "waiver": "Same marks as light; only the theme differs" }
      }
    },
    {
      "id": "empty-state",
      "label": "Empty state",
      "after": { "path": "/abs/empty.png" },
      "waiver": "Before and after are pixel-identical"
    }
  ],
  "transcript": "/abs/console.log",
  "url": "https://...",
  "attach": "..."
}
```

- **`v`**: `2`.
- **`cases`**: a non-empty array, in the order a reader shows them.
- **Case**
  - `id`: required, matches `^[a-z0-9][a-z0-9-]{0,63}$`, unique in the
    record. It addresses the case (`runs:evidence`, the console's
    `?compare=` link), so writers keep it stable when they rewrite the field.
  - `label`: required, non-empty, what a reader sees.
  - `before`, `after`: slots, each optional, at least one present.
  - `waiver`: optional non-empty reason. It covers every image in the case
    that has no annotated image and no waiver of its own.
- **Slot**: either one image, or a theme pair `{ "light"?: image, "dark"?: image }`
  with at least one theme. An object with a `path` key is an image; an
  object without one is a theme pair. A theme pair with only one theme is
  valid.
- **Image**
  - `path`: required absolute path, the base capture.
  - `annotated`: optional absolute path of the marked-up copy.
  - `caption`: required when `annotated` is set, non-empty: what the
    markers point at.
  - `waiver`: optional non-empty reason the base goes out unmarked.
  - An image may not carry both `annotated` and `waiver`.
- **Run-level keys**: `transcript` (absolute path), `url` and `attach`
  keep their v1 meaning. v1's `case` (a free-text description) has no v2
  key; a case's `label` replaces it.
- Unknown keys are ignored by the reader and the validator, so a later
  minor addition does not break an older rt.
- `{"plan": "none"}` stays the no-evidence value. `-` and empty stay unset.

### The rule every image follows

Each image is **annotated** (`annotated` + `caption`) or **waived** (its
own `waiver`, or its case's). Nothing else is valid.

## Reading: one case-shaped reader

`packages/rt-client/src/evidence.ts` gains a new export, and the existing one
keeps its exact behavior until RT-484 moves the console over.

```ts
export type EvidenceTheme = "light" | "dark";
export type EvidenceSlotName = "before" | "after";

export interface EvidenceShot {
  theme?: EvidenceTheme;     // absent on an unthemed slot
  path: string;
  annotated?: string;
  caption?: string;
  waiver?: string;           // the effective waiver: the image's own, else its case's
}

export interface EvidenceCase {
  id: string;
  label: string;
  waiver?: string;
  before?: EvidenceShot[];   // 1 shot unthemed, or 1-2 themed (light first)
  after?: EvidenceShot[];
}

export type EvidenceRecord =
  | { version: 2; source: 1 | 2; cases: EvidenceCase[]; transcript?: string; url?: string; attach?: string }
  | { version: 0; links: string[] }
  | { version: null };

export function readEvidence(value: string | null | undefined): EvidenceRecord;
```

- A v2 value reads as itself (`source: 2`). The reader is lenient: it drops
  a case or an image it cannot read rather than throwing, and a v2 value
  with no readable case falls through to the legacy link scan. Stored
  values have passed the validator, so this only matters for rows written
  before it or by hand.
- A v1 value reads as one case (`source: 1`): id `case`, label = v1's
  `case` text or `Evidence`, `before` = `{path: before, annotated:
  beforeAnnotated}`, `after` likewise when present, no captions or
  waivers. `transcript`, `url` and `attach` carry over.
- v0 (links) and unset read exactly as `parseEvidence` reads them.
- Consumers handle `version: 2` (cases) and `version: 0` (legacy links)
  only.

`parseEvidence`, `ParsedEvidence`, `EVIDENCE_IMAGE_KEYS` and `EvidenceV1`
stay as they are. A v2 value given to `parseEvidence` falls to its existing
link scan (`version: 0`) and lists every path, which is how today's console
shows a v2 run until RT-484 lands. They are marked deprecated in favour of
`readEvidence`; RT-484 removes their console callers, and a later change
removes them.

Helpers exported beside the reader, used by the daemon and free for the
console:

- `evidenceShots(record)`: every `{caseId, slot, shot}` in order.
- `uploadablePaths(record)`: the paths that may go to an MR: every
  `annotated`, plus every waived image's `path`. A base path with an
  annotated counterpart is not in it.

## Writing: the validator

`validateEvidence(value: string): { ok: true } | { ok: false; error: string }`
in `evidence.ts`, pure (no filesystem). It applies only when the value is
JSON with `"v": 2`; any other value (v1, legacy text, `-`, `{plan: none}`)
passes, so today's skills keep writing v1 until SKILLS-97.

It refuses, with the first problem found:

- `cases` missing, not an array, or empty.
- A case id missing, malformed or repeated; a label missing or empty.
- A case with neither `before` nor `after`.
- A slot that is neither an image nor a theme pair with at least one theme.
- A `path`, `annotated` or `transcript` that is not an absolute path.
- An annotated image with no caption.
- An image with both `annotated` and `waiver`.
- An empty `waiver` or `caption`.
- An image with no `annotated` and no waiver (its own or its case's).

Each message names the case and slot, and the theme when there is one:
`evidence@2: case "shape2" after (dark) has no annotated image and no
waiver; annotate it or add a waiver with a reason`.

It runs in `fieldSet` (`lib/runs/write.ts`) when `key` is `evidence`, so
both `rt runs field set` and the `run_field_set` tool (which shells to it)
refuse. The refusal exits non-zero with the message as the error, and the
field keeps its previous value.

## Uploading: the record-driven check

`mr_upload` takes an optional `runId`, and so does the daemon's
`mr:upload` payload (`Commands["mr:upload"]`).

- **No `runId`**: today's behavior, unchanged.
- **With `runId`**: after the existing path guard admits the file, the
  daemon finds the run (`findRun`), reads its `evidence` with
  `readEvidence`, and admits the file only if its realpath equals the
  realpath of a path in `uploadablePaths`. Otherwise it refuses and names
  the file:
  - run not found: `run <id> not found`.
  - no v1 or v2 record: `run <id> has no evidence record; write evidence
    before uploading with runId`.
  - a raw base that has an annotated counterpart: `<file> is the raw
    capture for case "<id>" <slot>; upload its annotated image <name>
    instead`.
  - anything else: `<file> is not in run <id>'s evidence record as an
    annotated image or a waived capture; record it with run_field_set
    first`.
- A v1 record gives no waivers, so with `runId` only its annotated images
  pass. SKILLS-97 moves the writers to v2 before it starts passing `runId`.
- The check applies to every file type: with `runId`, a video must be in
  the record too.

## Serving: addressing by case

`runs:evidence` accepts either payload:

- `{runId, repo?, key}`: today's addressing, unchanged. It reads through
  `parseEvidence`, so it serves v1 images and the transcript exactly as now.
- `{runId, repo?, case, slot, theme?, annotated?}`: reads through
  `readEvidence`, so it works for v1 (case `case`) and v2. `slot` is
  `before` or `after`; `theme` is required when the slot is themed and
  refused when it is not; `annotated: true` serves the annotated image and
  fails `no evidence` when there is none. The path goes through the same
  guard and roots as today.

`Commands["runs:evidence"]["payload"]` becomes the union, and
`runsEvidence` in `client.ts` takes it, so the console's existing `{key}`
call still typechecks.

## Counting

`evidenceCounts` (`lib/runs/store.ts`) reads through `readEvidence`:

- `evidence_count`: images served, counting each base and each annotated
  path (for v1 this equals today's count).
- `evidence_cases`: new, the number of cases (v1 counts as 1), so RT-484
  can choose images or cases for `EVIDENCE · n`. Added as an optional field
  on the run summary type in `commands.ts`.
- `evidence_links`: unchanged (legacy only).

## Not in scope

- `apps/console` (RT-484) and the pipeline skills (SKILLS-97).
- Checking that recorded files exist when the field is written: the
  upload and serve paths already check the file they touch.
- Removing `parseEvidence` and the v1 keys.

## Testing

- `evidence.test.ts`: v1 normalizes to one case; v2 reads with themes,
  one-theme and unthemed slots; effective waiver from the case; lenient
  drop of a bad case; the validator's each refusal and its message;
  `uploadablePaths`; `parseEvidence` unchanged on v2 (falls to links).
- `write` tests: `fieldSet` refuses an unannotated, unwaived v2 image and
  keeps the old value; v1 and text still write.
- `mr-upload` handler tests: with `runId`, raw image refused naming the
  file, annotated accepted, waived base accepted, unknown run refused; no
  `runId` unchanged.
- `runs` handler tests: case/slot/theme addressing for v2 and v1, theme
  required or refused, `{key}` unchanged.
- `store` tests: counts for v2 and v1.
- MCP reference regenerated; plugin version bumped.
