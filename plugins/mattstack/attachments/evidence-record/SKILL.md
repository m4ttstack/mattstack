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
`run_budget` before it returns `spent` over `limit`.

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
    "Record held at evidence-waiver: the verb's hold path" [shape=doublecircle];
    "Record failed: the verb fails, naming the images or quoting the error" [shape=doublecircle];

    "Record the evidence (evidence-record)" -> "evidence_record {runDb, stage, tree: <worktree>, images, cases?, transcript?, url?}" -> "evidence_record result?";
    "evidence_record result?" -> "Recorded" [label="written"];
    "evidence_record result?" -> "run_budget {runDb, key: evidence:cover-rounds, limit: 3, stage}" [label="uncovered listed"];
    "evidence_record result?" -> "run_budget {runDb, key: evidence:record-retries, limit: 1, stage}" [label="the evidence field changed during this call"];
    "evidence_record result?" -> "Record failed: the verb fails, naming the images or quoting the error" [label="any other error"];
    "run_budget {runDb, key: evidence:cover-rounds, limit: 3, stage}" -> "cover-rounds spent?";
    "cover-rounds spent?" -> "Annotate or waive each image the record does not yet cover (evidence-record)" [label="no"];
    "Annotate or waive each image the record does not yet cover (evidence-record)" -> "Annotate or waive outcome?";
    "Annotate or waive outcome?" -> "evidence_record {runDb, stage, tree: <worktree>, images, cases?, transcript?, url?}" [label="ready: the same images by their value paths, with covers"];
    "Annotate or waive outcome?" -> "Record held at evidence-waiver: the verb's hold path" [label="held"];
    "Annotate or waive outcome?" -> "Record failed: the verb fails, naming the images or quoting the error" [label="waiver openings spent"];
    "run_budget {runDb, key: evidence:record-retries, limit: 1, stage}" -> "record-retries spent?";
    "record-retries spent?" -> "evidence_record {runDb, stage, tree: <worktree>, images, cases?, transcript?, url?}" [label="no: the same call again"];
    {"cover-rounds spent?" "record-retries spent?"} -> "Record failed: the verb fails, naming the images or quoting the error" [label="yes"];
}
```

The first call names each capture by the `path` it was written to, with
`case`, `slot` (and `theme`), plus `label` for a new case; a recapture is
a new `path`. Every later call names the same images by the paths in the
last returned `value`, each with its cover (`annotated` plus `caption`,
or `waiver`; a case waiver rides in `cases`). `tree` is the run's
worktree root.

## Annotate or waive each image the record does not yet cover

For each image `evidence_record` lists in `uncovered` (`{case, slot,
theme?, path, why}`); images that need the gate in one pass share one
opening.

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
    "Held at evidence-waiver: the verb's hold path" [shape=doublecircle];
    "Waiver openings spent: the verb fails, naming the images" [shape=doublecircle];
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
    "waiver-openings spent?" -> "Waiver openings spent: the verb fails, naming the images" [label="yes"];
    "Gate evidence-waiver (below)" -> "waiver answer?";
    "waiver answer?" -> "Ready" [label="proceed: a reason"];
    "waiver answer?" -> "Draw the marks beside the value copy" [label="proceed: Annotate it after all"];
    "waiver answer?" -> "run_budget {runDb, key: evidence:waiver-openings:<case>/<slot>[/<theme>], limit: 2, stage}" [label="proceed with neither"];
    "waiver answer?" -> "Held at evidence-waiver: the verb's hold path" [label="hold"];
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

Entered only after the verb's attach gate proceeds. `heading`, `before`
and `appendix` come from the domain. Unbound, `heading` is the repo MR
template's evidence heading, else `## Evidence`: always the full line,
`##` included. On GitHub nothing uploads; `<n>` is the PR number in
`mrUrl`.

```dot
digraph attach_evidence {
    "Attach the evidence (evidence-record)" [shape=ellipse];
    "Forge host?" [shape=diamond];
    "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl}" [shape=plaintext];
    "evidence_attach result?" [shape=diamond];
    "STOP: only the human moves a refused file" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Off-script gate: upload refused" [shape=box];
    "upload off-script answer?" [shape=diamond];
    "Does this verb attach again later?" [shape=diamond];
    "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl, linkRefused: true}" [shape=plaintext];
    "Linked description written?" [shape=diamond];
    "run_budget {runDb, key: evidence:upload-off-script, limit: 1, stage}" [shape=plaintext];
    "upload-off-script spent?" [shape=diamond];
    "gh pr view <n> --json body" [shape=plaintext];
    "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl, description: <the body>}" [shape=plaintext];
    "description returned?" [shape=diamond];
    "gh pr edit <n> --body-file <file holding the returned description>" [shape=plaintext];
    "PR edited?" [shape=diamond];
    "Attached" [shape=doublecircle style=filled fillcolor=lightgreen];
    "Taken: nothing written, a later attach sends the refused files" [shape=doublecircle];
    "Attach held: the verb's hold path" [shape=doublecircle];
    "Attach failed: the verb fails, the reason quoted" [shape=doublecircle];

    "Attach the evidence (evidence-record)" -> "Forge host?";
    "Forge host?" -> "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl}" [label="GitLab"];
    "Forge host?" -> "gh pr view <n> --json body" [label="GitHub"];
    "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl}" -> "evidence_attach result?";
    "evidence_attach result?" -> "Attached" [label="descriptionWritten, or notWritten: unchanged"];
    "evidence_attach result?" -> "STOP: only the human moves a refused file" [label="any refused bucket, or timedOutTwice"];
    "evidence_attach result?" -> "STOP: only the human moves a refused file" [label="tempted to copy the file or upload another way"];
    "evidence_attach result?" -> "Attach failed: the verb fails, the reason quoted" [label="writeErrors, or the call errored"];
    "STOP: only the human moves a refused file" -> "Off-script gate: upload refused" -> "upload off-script answer?";
    "upload off-script answer?" -> "Does this verb attach again later?" [label="proceed + take"];
    "upload off-script answer?" -> "Attach failed: the verb fails, the reason quoted" [label="proceed + hand back"];
    "upload off-script answer?" -> "run_budget {runDb, key: evidence:upload-off-script, limit: 1, stage}" [label="iterate"];
    "upload off-script answer?" -> "Attach held: the verb's hold path" [label="hold"];
    "Does this verb attach again later?" -> "Taken: nothing written, a later attach sends the refused files" [label="yes"];
    "Does this verb attach again later?" -> "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl, linkRefused: true}" [label="no"];
    "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl, linkRefused: true}" -> "Linked description written?";
    "run_budget {runDb, key: evidence:upload-off-script, limit: 1, stage}" -> "upload-off-script spent?";
    "upload-off-script spent?" -> "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl}" [label="no"];
    "gh pr view <n> --json body" -> "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl, description: <the body>}" -> "description returned?";
    "description returned?" -> "gh pr edit <n> --body-file <file holding the returned description>" [label="yes"];
    "gh pr edit <n> --body-file <file holding the returned description>" -> "PR edited?";
    {"Linked description written?" "PR edited?"} -> "Attached" [label="yes"];
    {"Linked description written?" "description returned?" "PR edited?"} -> "Attach failed: the verb fails, the reason quoted" [label="no"];
    "upload-off-script spent?" -> "Attach failed: the verb fails, the reason quoted" [label="yes"];
}
```

### Off-script gate: upload refused

Scope `off-script:<stage>:<n>`, `n` shared with the verb's other
off-script gates; `context` quotes each refusal and its path. Iterate
means the human moved the file, widened `rt.mcp.uploadRoots` or
recaptured; only the human copies a file under an allowed root.

### Does this verb attach again later?

Yes when a later stage of this run attaches again (stage-evidence: ship
sends the refused files). No for ship and stage-ship, so Take lists them
as attached separately.

## Merge into the record

For a verb that still draws this node: run `Record the evidence` here,
and skip the verb's own annotate-or-waive pass and evidence write.

## Write before upload

`Record the evidence` wrote the record; never write `evidence` with
`run_field_set`.

## Upload only what the record allows

Run `Attach the evidence` at the verb's `Files to attach` decision,
whatever it answers (GitHub and no files included), and skip the verb's
`mr_upload` loop.

## The evidence section of the description

`Attach the evidence` wrote it: write the title and description around
it byte for byte as it stands on the MR (or the `section` the attach
returned), never a second evidence block.

## Domain precedence

A domain rule that keeps a base capture with no waiver, uploads outside
`evidence_attach`, or writes the record outside `evidence_record` is
overridden by this page.
