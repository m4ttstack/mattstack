---
name: evidence-record
description: "Use when a pipeline verb records, annotates, waives or attaches verification evidence to an MR or PR. Not for direct invocation."
---

# Evidence record

The `evidence` run field is what this run verified and the only list of
what may leave the machine. `evidence_record` writes it and
`evidence_attach` uploads from it and writes the MR's evidence section.
Never write `evidence` with `run_field_set`, upload evidence with
`mr_upload`, or edit the evidence section by hand.

## The record

- One case per thing verified, in reading order; `id` is a stable slug
  (`^[a-z0-9][a-z0-9-]{0,63}$`), `label` is what a reader sees.
- A case has a before, an after, or both. A slot is one image, or a
  `{light, dark}` pair only when the plan or the domain says the theme
  matters (`theme` on each image).
- Every image is annotated (a board plus a caption naming what the marks
  point at) or waived (its own reason, or its case's). A case waiver covers
  only the images the case holds when it is written.
- `transcript` (a text file, never uploaded, never waived) and `url` (where
  the ticket shows the broken state) are run-level. A run with no image is
  recorded the same way: the tool picks the encoding.
- Captures stay where the capture wrote them. `evidence_record` copies
  each into `~/.mattstack/work/<run id>/evidence/`: draw marks and name
  files by the paths in its returned `value`, never the source.
- A file in the run folder is never rewritten: a recapture lands in a
  content folder beside the old one, and the record moves when it is
  written.

## Record the evidence

```dot
digraph record_evidence {
    "Record the evidence (evidence-record)" [shape=ellipse];
    "evidence_record {runDb, stage, tree: <worktree>, images, cases?, transcript?, url?}" [shape=plaintext];
    "evidence_record result?" [shape=diamond];
    "run_budget {runDb, key: evidence:cover-rounds, limit: 3, stage}" [shape=plaintext];
    "cover-rounds past its limit?" [shape=diamond];
    "Annotate or waive each image the record does not yet cover (evidence-record)" [shape=box];
    "Annotate or waive outcome?" [shape=diamond];
    "evidence_record {runDb, stage, tree: <worktree>, images: <the same images by their value paths, with covers>}" [shape=plaintext];
    "run_budget {runDb, key: evidence:record-retries, limit: 1, stage}" [shape=plaintext];
    "record-retries past its limit?" [shape=diamond];
    "Recorded" [shape=doublecircle style=filled fillcolor=lightgreen];
    "Record held at evidence-waiver: the verb's hold path" [shape=doublecircle];
    "Record failed: the verb fails, naming the images or quoting the error" [shape=doublecircle];

    "Record the evidence (evidence-record)" -> "evidence_record {runDb, stage, tree: <worktree>, images, cases?, transcript?, url?}" -> "evidence_record result?";
    "evidence_record {runDb, stage, tree: <worktree>, images: <the same images by their value paths, with covers>}" -> "evidence_record result?";
    "evidence_record result?" -> "Recorded" [label="written"];
    "evidence_record result?" -> "run_budget {runDb, key: evidence:cover-rounds, limit: 3, stage}" [label="uncovered listed"];
    "evidence_record result?" -> "run_budget {runDb, key: evidence:record-retries, limit: 1, stage}" [label="error: the evidence field changed during this call"];
    "evidence_record result?" -> "Record failed: the verb fails, naming the images or quoting the error" [label="any other error"];
    "run_budget {runDb, key: evidence:cover-rounds, limit: 3, stage}" -> "cover-rounds past its limit?";
    "cover-rounds past its limit?" -> "Annotate or waive each image the record does not yet cover (evidence-record)" [label="no"];
    "cover-rounds past its limit?" -> "Record failed: the verb fails, naming the images or quoting the error" [label="yes"];
    "Annotate or waive each image the record does not yet cover (evidence-record)" -> "Annotate or waive outcome?";
    "Annotate or waive outcome?" -> "evidence_record {runDb, stage, tree: <worktree>, images: <the same images by their value paths, with covers>}" [label="ready"];
    "Annotate or waive outcome?" -> "Record held at evidence-waiver: the verb's hold path" [label="held at evidence-waiver"];
    "Annotate or waive outcome?" -> "Record failed: the verb fails, naming the images or quoting the error" [label="waiver openings spent"];
    "run_budget {runDb, key: evidence:record-retries, limit: 1, stage}" -> "record-retries past its limit?";
    "record-retries past its limit?" -> "evidence_record {runDb, stage, tree: <worktree>, images, cases?, transcript?, url?}" [label="no: the first call again"];
    "record-retries past its limit?" -> "evidence_record {runDb, stage, tree: <worktree>, images: <the same images by their value paths, with covers>}" [label="no: a later call again"];
    "record-retries past its limit?" -> "Record failed: the verb fails, naming the images or quoting the error" [label="yes"];
}
```

The first call names each capture by the `path` the capture wrote, with
`case`, `slot` (and `theme`), plus `label` for a new case; a recapture is
a new `path` for that slot. `tree` is always the run's worktree root. A
capture outside the allowed sources fails the verb, quoted.

Every later call, a re-record from `Attach the evidence` included, names
the same images by the paths the last returned `value` holds, each with
its cover (`annotated` plus `caption`, or `waiver`); a case waiver rides
in `cases`. Each `past its limit?` diamond
reads `run_budget`'s `spent` over `limit`.

## Annotate or waive each image the record does not yet cover

```dot
digraph annotate_or_waive {
    rankdir=TB;

    "Image needs cover" [shape=ellipse];
    "Nothing selected for it at an annotations question?" [shape=diamond];
    "Video, or nothing worth marking?" [shape=diamond];
    "Draw the marks to a sibling -annotated file" [shape=box];
    "Drawn?" [shape=diamond];
    "Drawn after an Annotate it after all answer?" [shape=diamond];
    "run_budget {runDb, key: evidence:draw-failures:<case>/<slot>[/<theme>], limit: 1, stage}" [shape=plaintext];
    "draw-failures past its limit?" [shape=diamond];
    "Write the caption" [shape=box];
    "run_budget {runDb, key: evidence:waiver-openings:<case>/<slot>[/<theme>], limit: 2, stage}" [shape=plaintext];
    "waiver-openings past its limit?" [shape=diamond];
    "Gate evidence-waiver (below)" [shape=box];
    "waiver answer?" [shape=diamond];
    "Record the waiver" [shape=box];
    "STOP: a waiver is the human's answer, never the agent's" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Held at evidence-waiver: the verb's hold path" [shape=doublecircle];
    "Waiver openings spent: the verb fails, naming the images" [shape=doublecircle];
    "Ready" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Image needs cover" -> "Nothing selected for it at an annotations question?";
    "Nothing selected for it at an annotations question?" -> "run_budget {runDb, key: evidence:waiver-openings:<case>/<slot>[/<theme>], limit: 2, stage}" [label="yes"];
    "Nothing selected for it at an annotations question?" -> "Video, or nothing worth marking?" [label="no, or no such question"];
    "Video, or nothing worth marking?" -> "run_budget {runDb, key: evidence:waiver-openings:<case>/<slot>[/<theme>], limit: 2, stage}" [label="yes"];
    "Video, or nothing worth marking?" -> "Draw the marks to a sibling -annotated file" [label="no"];
    "Video, or nothing worth marking?" -> "STOP: a waiver is the human's answer, never the agent's" [label="tempted to keep the base unmarked"];
    "STOP: a waiver is the human's answer, never the agent's" -> "run_budget {runDb, key: evidence:waiver-openings:<case>/<slot>[/<theme>], limit: 2, stage}";
    "Draw the marks to a sibling -annotated file" -> "Drawn?";
    "Drawn?" -> "Write the caption" [label="yes"];
    "Drawn?" -> "Drawn after an Annotate it after all answer?" [label="no"];
    "Drawn after an Annotate it after all answer?" -> "run_budget {runDb, key: evidence:waiver-openings:<case>/<slot>[/<theme>], limit: 2, stage}" [label="yes"];
    "Drawn after an Annotate it after all answer?" -> "run_budget {runDb, key: evidence:draw-failures:<case>/<slot>[/<theme>], limit: 1, stage}" [label="no"];
    "run_budget {runDb, key: evidence:draw-failures:<case>/<slot>[/<theme>], limit: 1, stage}" -> "draw-failures past its limit?";
    "draw-failures past its limit?" -> "Draw the marks to a sibling -annotated file" [label="no: one retry"];
    "draw-failures past its limit?" -> "run_budget {runDb, key: evidence:waiver-openings:<case>/<slot>[/<theme>], limit: 2, stage}" [label="yes"];
    "Write the caption" -> "Ready";
    "run_budget {runDb, key: evidence:waiver-openings:<case>/<slot>[/<theme>], limit: 2, stage}" -> "waiver-openings past its limit?";
    "waiver-openings past its limit?" -> "Gate evidence-waiver (below)" [label="no"];
    "waiver-openings past its limit?" -> "Waiver openings spent: the verb fails, naming the images" [label="yes"];
    "Gate evidence-waiver (below)" -> "waiver answer?";
    "waiver answer?" -> "Record the waiver" [label="proceed: a reason"];
    "waiver answer?" -> "Draw the marks to a sibling -annotated file" [label="proceed: Annotate it after all"];
    "waiver answer?" -> "run_budget {runDb, key: evidence:waiver-openings:<case>/<slot>[/<theme>], limit: 2, stage}" [label="proceed with neither for this image"];
    "waiver answer?" -> "Held at evidence-waiver: the verb's hold path" [label="hold"];
    "Record the waiver" -> "Ready";
}
```

Run it for each image `evidence_record` lists in `uncovered` (`{case,
slot, theme?, path, why}`). When several images need the gate in one
pass, they share one opening.

### Draw the marks to a sibling -annotated file

The domain's method, else the `annotating-screenshots` skill. Mark what a
reviewer must look at: the changed value, the control, the
missing element. Write the board beside the run-folder copy (the image's
path in the returned `value`) as `<name>-annotated.<ext>`. A gate that asks
which marks to draw (`evidence-attach`, a domain form) decides the marks;
otherwise draw the ones you would propose.

### Write the caption

One short line naming what each mark points at: "Red box: the badge reads
3; arrow: the retry button". It rides on the image as `caption`.

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

The reason rides on the image as `waiver`, or on the case in `cases` when
the answer was one reason for the whole case.

## Attach the evidence

Entered only after the verb's attach gate proceeds.

```dot
digraph attach_evidence {
    "Attach the evidence (evidence-record)" [shape=ellipse];
    "Forge host?" [shape=diamond];
    "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl}" [shape=plaintext];
    "evidence_attach result?" [shape=diamond];
    "run_budget {runDb, key: evidence:record-recalls, limit: 1, stage}" [shape=plaintext];
    "record-recalls past its limit?" [shape=diamond];
    "Record the evidence (evidence-record)" [shape=box];
    "Re-record outcome?" [shape=diamond];
    "STOP: a refused file moves only by the human's hand" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Off-script gate: upload refused (gate-protocol, scope off-script:<stage>:<n>)" [shape=box];
    "upload off-script answer?" [shape=diamond];
    "Does this verb attach again later?" [shape=diamond];
    "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl, linkRefused: true}" [shape=plaintext];
    "take result?" [shape=diamond];
    "run_budget {runDb, key: evidence:upload-off-script, limit: 1, stage}" [shape=plaintext];
    "upload-off-script past its limit?" [shape=diamond];
    "gh pr view <n> --json body" [shape=plaintext];
    "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl, description: <the body>}" [shape=plaintext];
    "GitHub attach result?" [shape=diamond];
    "gh pr edit <n> --body-file <a file holding the returned description>" [shape=plaintext];
    "gh pr edit result?" [shape=diamond];
    "Attached" [shape=doublecircle style=filled fillcolor=lightgreen];
    "Taken: nothing written, a later attach sends the refused files" [shape=doublecircle];
    "Attach held: the verb's hold path" [shape=doublecircle];
    "Attach failed: the verb fails, the reason quoted" [shape=doublecircle];

    "Attach the evidence (evidence-record)" -> "Forge host?";
    "Forge host?" -> "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl}" [label="GitLab"];
    "Forge host?" -> "gh pr view <n> --json body" [label="GitHub"];
    "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl}" -> "evidence_attach result?";
    "evidence_attach result?" -> "Attached" [label="descriptionWritten, or notWritten: unchanged"];
    "evidence_attach result?" -> "run_budget {runDb, key: evidence:record-recalls, limit: 1, stage}" [label="refused: record or raw-capture"];
    "evidence_attach result?" -> "STOP: a refused file moves only by the human's hand" [label="any other refused bucket, or timedOutTwice"];
    "evidence_attach result?" -> "STOP: a refused file moves only by the human's hand" [label="tempted to copy the file or upload another way"];
    "evidence_attach result?" -> "Attach failed: the verb fails, the reason quoted" [label="writeErrors, or the call itself errored"];
    "run_budget {runDb, key: evidence:record-recalls, limit: 1, stage}" -> "record-recalls past its limit?";
    "record-recalls past its limit?" -> "Record the evidence (evidence-record)" [label="no"];
    "record-recalls past its limit?" -> "STOP: a refused file moves only by the human's hand" [label="yes"];
    "Record the evidence (evidence-record)" -> "Re-record outcome?";
    "Re-record outcome?" -> "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl}" [label="recorded"];
    "Re-record outcome?" -> "Attach held: the verb's hold path" [label="held"];
    "Re-record outcome?" -> "Attach failed: the verb fails, the reason quoted" [label="failed"];
    "STOP: a refused file moves only by the human's hand" -> "Off-script gate: upload refused (gate-protocol, scope off-script:<stage>:<n>)" -> "upload off-script answer?";
    "upload off-script answer?" -> "Does this verb attach again later?" [label="proceed + take"];
    "upload off-script answer?" -> "Attach failed: the verb fails, the reason quoted" [label="proceed + hand back"];
    "upload off-script answer?" -> "run_budget {runDb, key: evidence:upload-off-script, limit: 1, stage}" [label="iterate: the human fixed the cause"];
    "upload off-script answer?" -> "Attach held: the verb's hold path" [label="hold"];
    "Does this verb attach again later?" -> "Taken: nothing written, a later attach sends the refused files" [label="yes"];
    "Does this verb attach again later?" -> "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl, linkRefused: true}" [label="no"];
    "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl, linkRefused: true}" -> "take result?";
    "take result?" -> "Attached" [label="descriptionWritten, or notWritten: unchanged"];
    "take result?" -> "Attach failed: the verb fails, the reason quoted" [label="writeErrors"];
    "run_budget {runDb, key: evidence:upload-off-script, limit: 1, stage}" -> "upload-off-script past its limit?";
    "upload-off-script past its limit?" -> "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl}" [label="no"];
    "upload-off-script past its limit?" -> "Attach failed: the verb fails, the reason quoted" [label="yes"];
    "gh pr view <n> --json body" -> "evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl, description: <the body>}" -> "GitHub attach result?";
    "GitHub attach result?" -> "gh pr edit <n> --body-file <a file holding the returned description>" [label="description returned"];
    "GitHub attach result?" -> "Attach failed: the verb fails, the reason quoted" [label="refused, or the call itself errored"];
    "gh pr edit <n> --body-file <a file holding the returned description>" -> "gh pr edit result?";
    "gh pr edit result?" -> "Attached" [label="edited"];
    "gh pr edit result?" -> "Attach failed: the verb fails, the reason quoted" [label="failed"];
}
```

`heading`, `before` and `appendix` come from the domain. Unbound,
`heading` is the evidence heading of the repo's MR template when it has
one, else `## Evidence`: always the full line, `##` included. On GitHub
nothing uploads: pass the PR body as `description`, write the returned
`description` to a file and edit the PR from it; `<n>` is the PR number
in `mrUrl`.

### Record the evidence (evidence-record)

Box 1 is `## Record the evidence`. A `record` or `raw-capture` refusal
means the guard read a record box 1 did not write. Run box 1 once more
with the images the verb last recorded, by their `value` paths, each with
its cover; the next such refusal goes to the gate.

### Off-script gate: upload refused (gate-protocol, scope off-script:<stage>:<n>)

Scope `off-script:<stage>:<n>`, sharing `n` with the verb's other
off-script gates, with `context` quoting each refusal and its path. Take
leaves the refused files for a later attach, or links them where this
verb is the last. Iterate means the human moved the file, widened
`rt.mcp.uploadRoots` or recaptured. Hold ends the turn with nothing
linked. Hand back fails the verb with the refusal quoted. Copying a file
under an allowed root is only ever the human's move.

### Does this verb attach again later?

Yes only when a later stage of this run attaches again (stage-evidence:
ship attaches and sends the refused files again). No for ship and
stage-ship, so Take links their local paths.

## Merge into the record

For a verb that still draws this node: run `Record the evidence` here. It
merges, covers and writes, so skip the verb's own annotate-or-waive pass
and evidence write that follow.

## Write before upload

`Record the evidence` wrote the record. Never write `evidence` with
`run_field_set`.

## Upload only what the record allows

Where the verb's own upload loop starts, run `Attach the evidence`
instead: it uploads, renders and writes the section, so skip the verb's
`mr_upload` loop.

## The evidence section of the description

`Attach the evidence` wrote it. Where the verb later writes the title and
description, write them around that section, taken byte for byte from the
description as it now stands on the MR (or the `section` the attach
returned). Never write a second evidence block.

## Domain precedence

A domain rule that keeps a base capture with no waiver, uploads outside
`evidence_attach`, or writes the record outside `evidence_record` is
overridden by this page.
