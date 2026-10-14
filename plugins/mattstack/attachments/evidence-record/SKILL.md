---
name: evidence-record
description: "Use when a pipeline verb captures, annotates, records or uploads verification evidence: writing the evidence run field, waiving an image, uploading evidence to an MR, or writing the MR's evidence section. Not for direct invocation."
---

# Evidence record

The `evidence` run field is the record of what this run verified, and the
only list of what may leave the machine as evidence. Every verb that
captures, records or uploads evidence follows this page.

## The record

`evidence` holds `evidence@2` JSON:

```json
{
  "v": 2,
  "cases": [
    {
      "id": "retry-badge",
      "label": "Retry badge on the job row",
      "before": { "path": "/abs/r1-retry-badge-before.c1.png", "annotated": "/abs/r1-retry-badge-before.png", "caption": "The retry badge reads 0 after a retry" },
      "after": {
        "light": { "path": "/abs/r1-retry-badge-after.c1.png", "annotated": "/abs/r1-retry-badge-after.png", "caption": "The retry badge counts every retry" },
        "dark": { "path": "/abs/r1-retry-badge-after-dark.png", "waiver": "Same board as light; only the theme differs" }
      }
    }
  ],
  "url": "https://..."
}
```

- One case per thing verified, in the order a reader should see them.
  `id` is a stable slug matching `^[a-z0-9][a-z0-9-]{0,63}$` that never changes once written; `label` is what a reader
  sees.
- A case has a `before`, an `after`, or both. A slot is one image, or a
  `{light, dark}` pair only when the plan or the domain says the run's
  theme matters.
- Every image is **annotated** (`annotated` plus a `caption`, the claim
  its board proves) or **waived** (its own `waiver`, or its case's).
  Nothing else is valid. A case-level `waiver` covers only the images the
  case holds when it is written, never one added later.
- An `annotated` path is a composed board (browser-evidence). One board
  may be the `annotated` of several images: a pair board covers its
  case's before and after.
- Paths are absolute. Unbound, files live under
  `~/.mattstack/work/<run id>/evidence/`.
- `<run id>` is the path segment before `/state.db` in the `runDb` this
  verb carries.
- `transcript`, `url` and `attach` are run-level. `transcript` is the
  absolute path of a text file (test output, a CLI transcript) under the
  run's evidence folder; it is never uploaded and needs no caption or
  waiver. `{"plan": "none"}` stays the no-evidence value.
- A run with a text capture and no image at all is not `evidence@2`: its
  value is `{"plan": "text", "transcript": "<absolute path>"}`, plus
  `"url"` when a ticket location also exists. A run with images and a
  transcript carries `transcript` as a run-level key of the v2 record.

## Annotate or waive each image the record does not yet cover

```dot
digraph annotate_or_waive {
    rankdir=TB;

    "Image needs cover" [shape=ellipse];
    "Nothing selected for it at an annotations question?" [shape=diamond];
    "Video, nothing worth marking, or the domain says it goes up as shot?" [shape=diamond];
    "Compose the board (browser-evidence)" [shape=box];
    "Drawn?" [shape=diamond];
    "Drawn after an Annotate it after all answer?" [shape=diamond];
    "Draw failures for this image = 2?" [shape=diamond];
    "Write the caption" [shape=box];
    "Waiver openings for this image = 2?" [shape=diamond];
    "Gate evidence-waiver (below)" [shape=box];
    "waiver answer?" [shape=diamond];
    "Record the waiver" [shape=box];
    "STOP: a waiver is the human's answer, never the agent's" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Held at evidence-waiver: the verb's hold path" [shape=doublecircle];
    "Held at evidence-redaction: the verb's hold path" [shape=doublecircle];
    "Waiver openings spent: the verb fails, naming the images" [shape=doublecircle];
    "Ready" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Image needs cover" -> "Nothing selected for it at an annotations question?";
    "Nothing selected for it at an annotations question?" -> "Waiver openings for this image = 2?" [label="yes"];
    "Nothing selected for it at an annotations question?" -> "Video, nothing worth marking, or the domain says it goes up as shot?" [label="no, or no such question"];
    "Video, nothing worth marking, or the domain says it goes up as shot?" -> "Waiver openings for this image = 2?" [label="yes"];
    "Video, nothing worth marking, or the domain says it goes up as shot?" -> "Compose the board (browser-evidence)" [label="no"];
    "Video, nothing worth marking, or the domain says it goes up as shot?" -> "STOP: a waiver is the human's answer, never the agent's" [label="tempted to keep the base unmarked"];
    "STOP: a waiver is the human's answer, never the agent's" -> "Waiver openings for this image = 2?";
    "Compose the board (browser-evidence)" -> "Drawn?";
    "Compose the board (browser-evidence)" -> "Held at evidence-redaction: the verb's hold path" [label="held at evidence-redaction"];
    "Drawn?" -> "Write the caption" [label="yes: Board recorded"];
    "Drawn?" -> "Drawn after an Annotate it after all answer?" [label="no: Not drawn"];
    "Drawn after an Annotate it after all answer?" -> "Waiver openings for this image = 2?" [label="yes"];
    "Drawn after an Annotate it after all answer?" -> "Draw failures for this image = 2?" [label="no"];
    "Draw failures for this image = 2?" -> "Compose the board (browser-evidence)" [label="no: one retry"];
    "Draw failures for this image = 2?" -> "Waiver openings for this image = 2?" [label="yes"];
    "Write the caption" -> "Ready";
    "Waiver openings for this image = 2?" -> "Gate evidence-waiver (below)" [label="no"];
    "Waiver openings for this image = 2?" -> "Waiver openings spent: the verb fails, naming the images" [label="yes"];
    "Gate evidence-waiver (below)" -> "waiver answer?";
    "waiver answer?" -> "Record the waiver" [label="proceed: a reason"];
    "waiver answer?" -> "Compose the board (browser-evidence)" [label="proceed: Annotate it after all"];
    "waiver answer?" -> "Waiver openings for this image = 2?" [label="proceed with neither for this image"];
    "waiver answer?" -> "Held at evidence-waiver: the verb's hold path" [label="hold"];
    "Record the waiver" -> "Ready";
}
```

Run it for every image the record does not yet cover: a new capture, an
image a v1 record carried raw, an image the validator or the upload check
named. When several images need the gate in one pass, they share one
opening.

### Compose the board (browser-evidence)

Every board comes from the browser-evidence include, walked from its
`Draw the boards` graph: a browser capture's board from a `page:` brief,
any other image (a script capture, a screenshot the user provides) as an
`import:` brief through the same text. The exception is an image the
domain says goes up as shot: it takes the yes edge of `Video, nothing
worth marking, or the domain says it goes up as shot?` to the waiver
question, with the domain's reason as the recommended reason. A gate
that asks which marks to draw (`evidence-attach`, a domain form) decides
the brief's `point at` lines; otherwise browser-evidence's `Labels` rule
proposes them.

`Drawn?` is yes when browser-evidence ends at `Board recorded` for this
image, and no when it ends at `Not drawn` (a red doctor, no compose on
PATH, a failed driver, a missing `Agent` tool or driver type, a refused
sign-in, spent re-renders, redaction rounds spent, confirm refused twice).
`Drawn?`'s `no` edge is evidence-record's draw failure path: the image
goes to the Annotate it after all check, then the draw failure count,
then the waiver question. `Held at evidence-redaction` in browser-evidence is
`Held at evidence-redaction: the verb's hold path` here.

### Write the caption

The brief's `claim` is the caption of every image the board shows (see
browser-evidence's `Record the board`); no separate caption is written.

### Gate evidence-waiver (below)

Scope `evidence-waiver:<stage>:<n>`, where `<n>` is the count of
`evidence-waiver` gates this stage pass has opened, starting at 1. One
sentence above the form: which
images need a waiver and why (nothing selected, two failed draws, nothing
worth marking, a video).

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `waiver-<case>-<slot>[-<theme>]` | **`<your proposed reason>` (Recommended)** / **Annotate it after all**, with free text for a reason in the human's words | per image; the second opening for an image drops **Annotate it after all** |
| `waiver-<case>` | the same options, one reason for the whole case | instead of the per-image questions when every image in the case needs one |
| `next` | **Proceed** / **Hold** | always |

Selection: `{"waivers":{"<case>/<slot>[/<theme>]":"<reason>|annotate","<case>":"<reason>|annotate"},"next":"proceed|hold","note":"<their words or null>"}`.
A reason typed as free text is the reason, word for word.

### Record the waiver

The reason goes on the image as `waiver`, or on the case as `waiver` when
the answer was one reason for the whole case.

## Merge into the record

Read `evidence` with `run_field_get`, then:

| What it holds | Do |
|---|---|
| `evidence@2` | Add each new case; an AFTER for an existing case's `id` sets that case's `after`. If that case carries a case `waiver`, first move it onto each of the case's existing images with neither an `annotated` copy nor its own `waiver`, as an image `waiver`, delete the case's `waiver` key, then set `after`; the new image goes through "Annotate or waive" like any other. Keep every other case and key. A board ship composed that shows an image the record already holds (a pair built from a case's before) replaces that image's `annotated` and `caption`; every other key of that image stays. |
| `evidence@1` (`"v": 1`) | Convert it to one case: `id` `case`, `label` = its `case` text or `Evidence`, `before` = `{path: before}` plus `annotated: beforeAnnotated` only when that is set, and `after` likewise when present (never `"annotated": null`); keep `transcript`, `url` and `attach`. Each annotated image gets a caption (write it; no gate). Each raw image is not yet covered. |
| unset (the read errors), `-`, `{"plan": "none"}` | Start a new record. |
| other JSON with a `url` or a `transcript` (such as `{"plan": "ticket", "url": ...}` or `{"plan": "text", "transcript": ...}`) | Start a new record and keep its `url` and `transcript` as run-level keys. |
| any other text (legacy links) | Start a new record and carry the old text in `attach`, so the description still shows it. |

## Write before upload

Write the merged record with `run_field_set {key: evidence, value: <the
evidence@2 JSON>, stage}` before any of its images upload. `value` is a
string: the JSON serialized as one string, never an object. The write is
refused when an image is neither annotated nor waived, and the refusal names
it: send that image through "Annotate or waive" and write again. A second
refusal in one pass fails the verb with the message quoted.

## Upload only what the record allows

Upload each distinct `annotated` path and each waived image's `path` once,
even when several images list the same board, and nothing else: never
the base of an annotated image, never a file the record does not list.
Each upload is `mr_upload {mrUrl, path, runId: <run id>}`. A refusal
saying the file is not in the record, or is the raw capture of an
annotated image, means the record is wrong, not the roots. Fix the record
once ("Annotate or waive", then "Write before upload") and retry. A second
such refusal goes to the verb's upload off-script gate. Copying the file
somewhere else, or dropping `runId`, is never the fix.

## The evidence section of the description

The section replaces any evidence block an earlier stage wrote into the
description; it never keeps that block and appends a second one. Build it
from the record, one block per case. One entry per distinct file. A board
several images share prints once, at the first slot it covers, labelled
with every slot it covers (`- Before and after:`, `- After (light and
dark):`), with the caption once. The case above, once ship has composed its
pair board, prints:

```markdown
**Retry badge on the job row**

- Before and after (light): ![before and after](/uploads/.../r1-retry-badge-after.png)
  Caption: The retry badge counts every retry
- After (dark): ![after](/uploads/.../r1-retry-badge-after-dark.png)
  Waived: Same board as light; only the theme differs
```

A case waiver prints once, as `Waived: <reason>` under the label. Where
nothing uploaded (GitHub, a file the human chose to link at the off-script
gate), the line carries the local path instead. After the case blocks,
print `Transcript: <its local path>` when `transcript` is set (it is never
uploaded), `Ticket: <url>` when `url` is set, and the part of `attach`
that no case image covers (legacy links); `attach` markdown for a file a
case already shows never prints twice. The domain's template and heading rules decide where
the section sits and what it is called, never whether a caption or a
waiver reason appears.

## Domain precedence

A domain rule that keeps a base capture with no waiver, uploads a
capture the record does not list, or uploads without `runId`, is
overridden by this page, the way a
STOP node overrides a domain step. A domain rule that draws, annotates or
places marks itself is overridden the same way: browser-evidence delegates
every board.
