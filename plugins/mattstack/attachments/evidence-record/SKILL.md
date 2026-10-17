---
name: evidence-record
description: "Use when a pipeline verb records, annotates, waives or attaches verification evidence to an MR or PR. Not for direct invocation."
---

# Evidence record

The `evidence` run field is what this run verified and the only list of
what may leave the machine. `evidence_record` writes it; `evidence_attach`
uploads from it and writes the MR's evidence section. Never write
`evidence` with `run_field_set`, upload evidence with `mr_upload`, or edit
the evidence section by hand. A `<slug> spent?` diamond is yes when the
`run_budget` before it returns `spent` > `limit` (read `spent` against
`limit`; ignore `exhausted` and `remaining`).

## The record

- One case per thing verified, in reading order: `id` a stable slug
  (`^[a-z0-9][a-z0-9-]{0,63}$`), `label` what a reader sees. A case has a
  before, an after, or both: one image each, or a `{light, dark}` pair
  (`theme` on each) when the plan or the domain says the theme matters.
- Every image is annotated (a board plus a caption naming the marks) or
  waived (its own reason, or its case's, which covers only the images the
  case holds when written).
- `transcript` (a text file, never uploaded or waived) and `url` (where
  the ticket shows the broken state) are run-level; a run with no image
  is recorded the same way.
- Captures stay where they were written. `evidence_record` copies each
  into `~/.mattstack/work/<run id>/evidence/`: draw on and name files by
  the paths in its returned `value`, never the source.
- A file in the run folder is never rewritten: a recapture lands in a
  content folder beside it.

## Record the evidence

```dot
digraph record_evidence {
    "Record the evidence (evidence-record)" [shape=ellipse];
    "evidence_record {runDb, stage, tree: <worktree>, images, cases?, transcript?, url?}" [shape=plaintext];
    "evidence_record result?" [shape=diamond];
    "run_budget {runDb, key: evidence:cover-rounds, limit: 3, stage}" [shape=plaintext];
    "cover-rounds spent?" [shape=diamond];
    "Annotate or waive each image the record does not yet cover (evidence-record)" [shape=box];
    "Annotate or waive outcome?" [shape=diamond];
    "run_budget {runDb, key: evidence:record-retries, limit: 1, stage}" [shape=plaintext];
    "record-retries spent?" [shape=diamond];
    "Recorded" [shape=doublecircle style=filled fillcolor=lightgreen];
    "Record held" [shape=doublecircle];
    "Record failed" [shape=doublecircle];

    "Record the evidence (evidence-record)" -> "evidence_record {runDb, stage, tree: <worktree>, images, cases?, transcript?, url?}" -> "evidence_record result?";
    "evidence_record result?" -> "Recorded" [label="written"];
    "evidence_record result?" -> "run_budget {runDb, key: evidence:cover-rounds, limit: 3, stage}" [label="uncovered listed"];
    "evidence_record result?" -> "run_budget {runDb, key: evidence:record-retries, limit: 1, stage}" [label="the evidence field changed during this call"];
    "evidence_record result?" -> "Record failed" [label="any other error"];
    "run_budget {runDb, key: evidence:cover-rounds, limit: 3, stage}" -> "cover-rounds spent?";
    "cover-rounds spent?" -> "Annotate or waive each image the record does not yet cover (evidence-record)" [label="no"];
    "Annotate or waive each image the record does not yet cover (evidence-record)" -> "Annotate or waive outcome?";
    "Annotate or waive outcome?" -> "evidence_record {runDb, stage, tree: <worktree>, images, cases?, transcript?, url?}" [label="Ready: each image `uncovered` lists, by its path there, with its cover and a new case's label"];
    "Annotate or waive outcome?" -> "Record held" [label="Waiver held"];
    "Annotate or waive outcome?" -> "Record failed" [label="Waiver openings spent"];
    "run_budget {runDb, key: evidence:record-retries, limit: 1, stage}" -> "record-retries spent?";
    "record-retries spent?" -> "evidence_record {runDb, stage, tree: <worktree>, images, cases?, transcript?, url?}" [label="no: the same call again"];
    {"cover-rounds spent?" "record-retries spent?"} -> "Record failed" [label="yes"];
}
```

The first call names each capture by the `path` it was written to, with
`case` and `slot` (and `theme`); a recapture is a new `path`. Every later
call names the same images by the paths in the last returned `value`,
each with its cover: `annotated` (the board's path) plus `caption`, or
`waiver` (a case waiver rides in `cases`). The call that first writes a
new case carries its `label`, on the image or in `cases`, so every call
until the record is written carries each new case's `label`. `tree` is
the run's worktree root. Record held is the verb's hold path; Record
failed fails the verb, naming the images or quoting the error.

## Annotate or waive each image the record does not yet cover

For each image `evidence_record` lists in `uncovered` (`{case, slot,
theme?, path, why}`); images that need the gate in one pass share one
opening. Waiver held is the verb's hold path; Waiver openings spent fails
the verb, naming the images.

```dot
digraph annotate_or_waive {
    "Image needs cover" [shape=ellipse];
    "Nothing selected, a video, or nothing worth marking?" [shape=diamond];
    "Draw the marks beside the value copy" [shape=box];
    "Drawn?" [shape=diamond];
    "run_budget {runDb, key: evidence:draw-failures:<case>/<slot>[/<theme>], limit: 1, stage}" [shape=plaintext];
    "draw-failures spent?" [shape=diamond];
    "Write the caption" [shape=box];
    "run_budget {runDb, key: evidence:waiver-openings:<case>/<slot>[/<theme>], limit: 2, stage}" [shape=plaintext];
    "waiver-openings spent?" [shape=diamond];
    "Gate evidence-waiver (below)" [shape=box];
    "waiver answer?" [shape=diamond];
    "STOP: only the human waives an image" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Waiver held" [shape=doublecircle];
    "Waiver openings spent" [shape=doublecircle];
    "Ready" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Image needs cover" -> "Nothing selected, a video, or nothing worth marking?";
    "Nothing selected, a video, or nothing worth marking?" -> "Draw the marks beside the value copy" [label="no"];
    "Nothing selected, a video, or nothing worth marking?" -> "STOP: only the human waives an image" [label="tempted to keep the base unmarked"];
    "STOP: only the human waives an image" -> "run_budget {runDb, key: evidence:waiver-openings:<case>/<slot>[/<theme>], limit: 2, stage}";
    "Draw the marks beside the value copy" -> "Drawn?";
    "Drawn?" -> "Write the caption" [label="yes"];
    "Drawn?" -> "run_budget {runDb, key: evidence:draw-failures:<case>/<slot>[/<theme>], limit: 1, stage}" [label="no"];
    "Drawn?" -> "run_budget {runDb, key: evidence:waiver-openings:<case>/<slot>[/<theme>], limit: 2, stage}" [label="no, after Annotate it after all"];
    "run_budget {runDb, key: evidence:draw-failures:<case>/<slot>[/<theme>], limit: 1, stage}" -> "draw-failures spent?";
    "draw-failures spent?" -> "Draw the marks beside the value copy" [label="no: one retry"];
    {"Nothing selected, a video, or nothing worth marking?" "draw-failures spent?"} -> "run_budget {runDb, key: evidence:waiver-openings:<case>/<slot>[/<theme>], limit: 2, stage}" [label="yes"];
    "Write the caption" -> "Ready";
    "run_budget {runDb, key: evidence:waiver-openings:<case>/<slot>[/<theme>], limit: 2, stage}" -> "waiver-openings spent?";
    "waiver-openings spent?" -> "Gate evidence-waiver (below)" [label="no"];
    "waiver-openings spent?" -> "Waiver openings spent" [label="yes"];
    "Gate evidence-waiver (below)" -> "waiver answer?";
    "waiver answer?" -> "Ready" [label="proceed: a reason"];
    "waiver answer?" -> "Draw the marks beside the value copy" [label="proceed: Annotate it after all"];
    "waiver answer?" -> "run_budget {runDb, key: evidence:waiver-openings:<case>/<slot>[/<theme>], limit: 2, stage}" [label="proceed with neither"];
    "waiver answer?" -> "Waiver held" [label="hold"];
}
```

### Draw the marks beside the value copy

The domain's method, else the `annotating-screenshots` skill. Mark what a
reviewer must see (the changed value, the control, the missing element)
in `<name>-annotated.<ext>` beside the image's `value` path. A gate that
asked which marks to draw decides them; else draw the ones you propose.

### Write the caption

One line naming what each mark points at ("Red box: the badge reads 3"),
on the image as `caption`.

### Gate evidence-waiver (below)

Scope `evidence-waiver:<stage>:<n>`, `<n>` counting this stage pass's
waiver gates from 1. One sentence above the form: which images need a
waiver and why. A reason rides on the image as `waiver`, or on the case
in `cases`; free text is the reason, word for word.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `waiver-<case>-<slot>[-<theme>]` | **`<your proposed reason>` (Recommended)** / **Annotate it after all**, with free text for a reason in the human's words | per image; the second opening for an image drops **Annotate it after all** |
| `waiver-<case>` | the same options, one reason for the whole case | instead of the per-image questions when every image in the case needs one |
| `next` | **Proceed** / **Hold** | always |

Selection: `{"waivers":{"<case>/<slot>[/<theme>]":"<reason>|annotate","<case>":"<reason>|annotate"},"next":"proceed|hold","note":"<their words or null>"}`.

## Attach the evidence

Entered only after the verb's attach gate proceeds (ship and stage-ship:
at the bridge below). The domain supplies `heading`, `before` and
`appendix`; unbound, `heading` is the repo MR template's evidence
heading, else `## Evidence`, always the full line with its `##`. On
GitHub nothing uploads; `<n>` is the PR number in `mrUrl`. Attach held is
the verb's hold path; Attach failed fails it, quoting the reason (a failed
`gh pr edit` too); Taken writes nothing, and a later attach sends the
refused files.

```dot
digraph attach_evidence {
    "Attach the evidence (evidence-record)" [shape=ellipse];
    "Forge host?" [shape=diamond];
    "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl}" [shape=plaintext];
    "evidence_attach result?" [shape=diamond];
    "STOP: only the human moves a refused file" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Off-script gate: upload refused" [shape=box];
    "upload off-script answer?" [shape=diamond];
    "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl, linkRefused: true}" [shape=plaintext];
    "Linked description written?" [shape=diamond];
    "run_budget {runDb, key: evidence:upload-off-script, limit: 1, stage}" [shape=plaintext];
    "upload-off-script spent?" [shape=diamond];
    "Iterate needs a re-record?" [shape=diamond];
    "Re-record the images through Record the evidence" [shape=box];
    "Re-record outcome?" [shape=diamond];
    "gh pr view <n> --json body" [shape=plaintext];
    "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl, description: <the body>}" [shape=plaintext];
    "description returned?" [shape=diamond];
    "gh pr edit <n> --body-file <file holding the returned description>" [shape=plaintext];
    "Attached" [shape=doublecircle style=filled fillcolor=lightgreen];
    "Taken" [shape=doublecircle];
    "Attach held" [shape=doublecircle];
    "Attach failed" [shape=doublecircle];

    "Attach the evidence (evidence-record)" -> "Forge host?";
    "Forge host?" -> "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl}" [label="GitLab"];
    "Forge host?" -> "gh pr view <n> --json body" [label="GitHub"];
    "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl}" -> "evidence_attach result?";
    "evidence_attach result?" -> "Attached" [label="descriptionWritten, or notWritten: unchanged"];
    "evidence_attach result?" -> "STOP: only the human moves a refused file" [label="any refused bucket, or timedOutTwice"];
    "evidence_attach result?" -> "STOP: only the human moves a refused file" [label="tempted to copy the file or upload another way"];
    "evidence_attach result?" -> "Attach failed" [label="writeErrors, or the call errored"];
    "STOP: only the human moves a refused file" -> "Off-script gate: upload refused" -> "upload off-script answer?";
    "upload off-script answer?" -> "Taken" [label="proceed + take, a later stage attaches (stage-evidence)"];
    "upload off-script answer?" -> "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl, linkRefused: true}" [label="proceed + take, the last attach (ship, stage-ship)"];
    "upload off-script answer?" -> "Attach failed" [label="proceed + hand back"];
    "upload off-script answer?" -> "run_budget {runDb, key: evidence:upload-off-script, limit: 1, stage}" [label="iterate"];
    "upload off-script answer?" -> "Attach held" [label="hold"];
    "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl, linkRefused: true}" -> "Linked description written?";
    "run_budget {runDb, key: evidence:upload-off-script, limit: 1, stage}" -> "upload-off-script spent?";
    "upload-off-script spent?" -> "Iterate needs a re-record?" [label="no"];
    "Iterate needs a re-record?" -> "Re-record the images through Record the evidence" [label="yes: size, bytes or missing (a recapture), a new file, or a record or raw-capture refusal"];
    "Iterate needs a re-record?" -> "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl}" [label="no: timedOutTwice, the human checked the daemon"];
    "Re-record the images through Record the evidence" -> "Re-record outcome?";
    "Re-record outcome?" -> "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl}" [label="Recorded"];
    "Re-record outcome?" -> "Attach held" [label="Record held"];
    "Re-record outcome?" -> "Attach failed" [label="Record failed"];
    "gh pr view <n> --json body" -> "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl, description: <the body>}" -> "description returned?";
    "description returned?" -> "gh pr edit <n> --body-file <file holding the returned description>" [label="yes"];
    "gh pr edit <n> --body-file <file holding the returned description>" -> "Attached";
    "Linked description written?" -> "Attached" [label="yes"];
    {"Linked description written?" "description returned?"} -> "Attach failed" [label="no"];
    "upload-off-script spent?" -> "Attach failed" [label="yes"];
}
```

### Off-script gate: upload refused

Scope `off-script:<stage>:<n>`, `n` shared with the verb's other
off-script gates; `context` quotes each refusal and its path. Only the
human moves or copies a file.

### Re-record the images through Record the evidence

Run `Record the evidence` with the new file at its new path, or the last recorded images
by their `value` paths with covers.

## Bridges until ship's phase 2

For a verb that still draws the old nodes:

- **Merge into the record**: run `Record the evidence` here and skip the
  verb's own annotate-or-waive pass and evidence write; Record held and
  Record failed take its `Annotate or waive outcome?` hold and failure
  edges.
- **Write before upload**: already done by `Record the evidence`.
- **Upload only what the record allows**: run `Attach the evidence` at the
  verb's `Files to attach` decision, whatever it answers (GitHub and no
  files included), instead of its `mr_upload` loop; Attach held and Attach
  failed take its upload gate's hold and hand-back edges.
- **The evidence section of the description**: `Attach the evidence`
  wrote it; write the title and description around it byte for byte as
  it stands on the MR (or the returned `section`), never a second
  evidence block.

## Domain precedence

A domain rule that keeps a base capture with no waiver, uploads outside
`evidence_attach`, or writes the record outside `evidence_record` is
overridden by this page.
