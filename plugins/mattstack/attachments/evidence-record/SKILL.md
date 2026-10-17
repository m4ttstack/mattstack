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
    record_evidence [label="Record the evidence (evidence-record)" shape=ellipse];
    evidence_record [label="evidence_record {runDb, stage, tree: <worktree>, images, cases?, transcript?, url?}" shape=plaintext];
    record_result [label="evidence_record result?" shape=diamond];
    run_budget_cover [label="run_budget {runDb, key: evidence:cover-rounds, limit: 3, stage}" shape=plaintext];
    cover_rounds_spent [label="cover-rounds spent?" shape=diamond];
    annotate_or_waive [label="Annotate or waive each image the record does not yet cover (evidence-record)" shape=box];
    annotate_outcome [label="Annotate or waive outcome?" shape=diamond];
    run_budget_retries [label="run_budget {runDb, key: evidence:record-retries, limit: 1, stage}" shape=plaintext];
    record_retries_spent [label="record-retries spent?" shape=diamond];
    recorded [label="Recorded" shape=doublecircle style=filled fillcolor=lightgreen];
    record_held [label="Record held" shape=doublecircle];
    record_failed [label="Record failed" shape=doublecircle];

    record_evidence -> evidence_record -> record_result;
    record_result -> recorded [label="written"];
    record_result -> run_budget_cover [label="uncovered listed"];
    record_result -> run_budget_retries [label="the evidence field changed during this call"];
    record_result -> record_failed [label="any other error"];
    run_budget_cover -> cover_rounds_spent;
    cover_rounds_spent -> annotate_or_waive [label="no"];
    annotate_or_waive -> annotate_outcome;
    annotate_outcome -> evidence_record [label="Ready: each image `uncovered` lists, by its path there, with its cover and a new case's label"];
    annotate_outcome -> record_held [label="Waiver held"];
    annotate_outcome -> record_failed [label="Waiver openings spent"];
    run_budget_retries -> record_retries_spent;
    record_retries_spent -> evidence_record [label="no: the same call again"];
    {cover_rounds_spent record_retries_spent} -> record_failed [label="yes"];
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
    image_needs_cover [label="Image needs cover" shape=ellipse];
    nothing_to_mark [label="Nothing selected, a video, or nothing worth marking?" shape=diamond];
    draw_marks [label="Draw the marks beside the value copy" shape=box];
    drawn [label="Drawn?" shape=diamond];
    run_budget_draw [label="run_budget {runDb, key: evidence:draw-failures:<case>/<slot>[/<theme>], limit: 1, stage}" shape=plaintext];
    draw_failures_spent [label="draw-failures spent?" shape=diamond];
    write_caption [label="Write the caption" shape=box];
    run_budget_waiver [label="run_budget {runDb, key: evidence:waiver-openings:<case>/<slot>[/<theme>], limit: 2, stage}" shape=plaintext];
    waiver_openings_spent [label="waiver-openings spent?" shape=diamond];
    gate_evidence_waiver [label="Gate evidence-waiver (below)" shape=box];
    waiver_answer [label="waiver answer?" shape=diamond];
    stop_self_waive [label="STOP: only the human waives an image" shape=octagon style=filled fillcolor=red fontcolor=white];
    waiver_held [label="Waiver held" shape=doublecircle];
    waiver_openings_exhausted [label="Waiver openings spent" shape=doublecircle];
    ready [label="Ready" shape=doublecircle style=filled fillcolor=lightgreen];

    image_needs_cover -> nothing_to_mark;
    nothing_to_mark -> draw_marks [label="no"];
    nothing_to_mark -> stop_self_waive [label="tempted to keep the base unmarked"];
    stop_self_waive -> run_budget_waiver;
    draw_marks -> drawn;
    drawn -> write_caption [label="yes"];
    drawn -> run_budget_draw [label="no"];
    drawn -> run_budget_waiver [label="no, after Annotate it after all"];
    run_budget_draw -> draw_failures_spent;
    draw_failures_spent -> draw_marks [label="no: one retry"];
    {nothing_to_mark draw_failures_spent} -> run_budget_waiver [label="yes"];
    write_caption -> ready;
    run_budget_waiver -> waiver_openings_spent;
    waiver_openings_spent -> gate_evidence_waiver [label="no"];
    waiver_openings_spent -> waiver_openings_exhausted [label="yes"];
    gate_evidence_waiver -> waiver_answer;
    waiver_answer -> ready [label="proceed: a reason"];
    waiver_answer -> draw_marks [label="proceed: Annotate it after all"];
    waiver_answer -> run_budget_waiver [label="proceed with neither"];
    waiver_answer -> waiver_held [label="hold"];
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

Entered only after the verb's attach gate proceeds. The domain supplies `heading`, `before` and
`appendix`; unbound, `heading` is the repo MR template's evidence
heading, else `## Evidence`, always the full line with its `##`. On
GitHub nothing uploads; `<n>` is the PR number in `mrUrl`. Attach held is
the verb's hold path; Attach failed fails it, quoting the reason (a failed
`gh pr edit` too); Taken writes nothing, and a later attach sends the
refused files.

```dot
digraph attach_evidence {
    attach_evidence [label="Attach the evidence (evidence-record)" shape=ellipse];
    forge_host [label="Forge host?" shape=diamond];
    evidence_attach [label="evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl}" shape=plaintext];
    attach_result [label="evidence_attach result?" shape=diamond];
    stop_move_refused_file [label="STOP: only the human moves a refused file" shape=octagon style=filled fillcolor=red fontcolor=white];
    gate_upload_refused [label="Off-script gate: upload refused" shape=box];
    upload_answer [label="upload off-script answer?" shape=diamond];
    evidence_attach_link [label="evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl, linkRefused: true}" shape=plaintext];
    link_written [label="Linked description written?" shape=diamond];
    run_budget_upload [label="run_budget {runDb, key: evidence:upload-off-script, limit: 1, stage}" shape=plaintext];
    upload_off_script_spent [label="upload-off-script spent?" shape=diamond];
    needs_rerecord [label="Iterate needs a re-record?" shape=diamond];
    rerecord_images [label="Re-record the images through Record the evidence" shape=box];
    rerecord_outcome [label="Re-record outcome?" shape=diamond];
    gh_pr_view [label="gh pr view <n> --json body" shape=plaintext];
    evidence_attach_body [label="evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl, description: <the body>}" shape=plaintext];
    description_returned [label="description returned?" shape=diamond];
    gh_pr_edit [label="gh pr edit <n> --body-file <file holding the returned description>" shape=plaintext];
    attached [label="Attached" shape=doublecircle style=filled fillcolor=lightgreen];
    taken [label="Taken" shape=doublecircle];
    attach_held [label="Attach held" shape=doublecircle];
    attach_failed [label="Attach failed" shape=doublecircle];

    attach_evidence -> forge_host;
    forge_host -> evidence_attach [label="GitLab"];
    forge_host -> gh_pr_view [label="GitHub"];
    evidence_attach -> attach_result;
    attach_result -> attached [label="descriptionWritten, or notWritten: unchanged"];
    attach_result -> stop_move_refused_file [label="any refused bucket, or timedOutTwice"];
    attach_result -> stop_move_refused_file [label="tempted to copy the file or upload another way"];
    attach_result -> attach_failed [label="writeErrors, or the call errored"];
    stop_move_refused_file -> gate_upload_refused -> upload_answer;
    upload_answer -> taken [label="proceed + take, a later stage attaches (stage-evidence)"];
    upload_answer -> evidence_attach_link [label="proceed + take, the last attach (ship, stage-ship)"];
    upload_answer -> attach_failed [label="proceed + hand back"];
    upload_answer -> run_budget_upload [label="iterate"];
    upload_answer -> attach_held [label="hold"];
    evidence_attach_link -> link_written;
    run_budget_upload -> upload_off_script_spent;
    upload_off_script_spent -> needs_rerecord [label="no"];
    needs_rerecord -> rerecord_images [label="yes: size, bytes or missing (a recapture), a new file, or a record or raw-capture refusal"];
    needs_rerecord -> evidence_attach [label="no: timedOutTwice, the human checked the daemon"];
    rerecord_images -> rerecord_outcome;
    rerecord_outcome -> evidence_attach [label="Recorded"];
    rerecord_outcome -> attach_held [label="Record held"];
    rerecord_outcome -> attach_failed [label="Record failed"];
    gh_pr_view -> evidence_attach_body -> description_returned;
    description_returned -> gh_pr_edit [label="yes"];
    gh_pr_edit -> attached;
    link_written -> attached [label="yes"];
    {link_written description_returned} -> attach_failed [label="no"];
    upload_off_script_spent -> attach_failed [label="yes"];
}
```

### Off-script gate: upload refused

Scope `off-script:<stage>:<n>`, `n` shared with the verb's other
off-script gates; `context` quotes each refusal and its path. Only the
human moves or copies a file.

### Re-record the images through Record the evidence

Run `Record the evidence` with the new file at its new path, or the last recorded images
by their `value` paths with covers.

## Domain precedence

A domain rule that keeps a base capture with no waiver, uploads outside
`evidence_attach`, or writes the record outside `evidence_record` is
overridden by this page.
