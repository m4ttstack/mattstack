---
name: stage-evidence
description: "Pipeline stage: capture the before-state evidence the plan committed to, while the before still exists. Reached only through the work orchestrator; not for direct invocation."
disable-model-invocation: true
type: pipeline-step
slots:
  domain: { contract: evidence-domain@1, required: false }
metadata:
  stage: "evidence"
  stage-consumes: "evidence-plan worktree"
  stage-produces: "evidence"
---

# stage: evidence

{{stage.fields}}

Run state: the orchestrator opens and closes this stage, so never write
`run_stage` `start` or `done` here. Read consumes with `run_field_get`,
write `evidence` with `run_field_set` (`stage: "evidence"`) the moment it
exists, and on failure write `run_stage {action: fail, stage: "evidence",
reason, detailPath}` with `detailPath` = whatever was captured so far.

Capture the BEFORE now, before implementation changes the surface.

```dot
digraph evidence {
    rankdir=TB;

    "Evidence stage entered" [shape=ellipse];
    "run_field_get {key: evidence-plan}; run_field_get {key: worktree}" [shape=plaintext];
    "evidence-plan starts with none?" [shape=diamond];
    "run_field_set {key: evidence, value: {plan: none}, stage: evidence}" [shape=plaintext];
    "Run the domain steps before the gate (none when unbound)" [shape=box];
    "Domain needs an rt read (ports, endpoints)?" [shape=diamond];
    "rt_verb {args: [<verb>, ...]}" [shape=plaintext];
    "STOP: rt reads go through rt_verb, never rt on Bash" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Intake questions declared, or source not local?" [shape=diamond];
    "Gate evidence (table below)" [shape=box];
    "evidence answer?" [shape=diamond];
    "Ticket already shows the broken state?" [shape=diamond];
    "Record the ticket's location as the BEFORE" [shape=box];
    "Capture the BEFORE" [shape=box];
    "Captured?" [shape=diamond];
    "Attempts = 3?" [shape=diamond];
    "Pick the next source or view" [shape=box];
    "Same source the gate recorded?" [shape=diamond];
    "STOP: a new data source is an off-script move" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Off-script gate (gate-protocol, scope off-script:evidence:<n>)" [shape=box];
    "off-script answer?" [shape=diamond];
    "Off-script rounds = 2?" [shape=diamond];
    "Domain attaches evidence to an MR here?" [shape=diamond];
    "run_field_get {key: branch}" [shape=plaintext];
    "mr_for_branch {repoName: <worktree>, branches: [<branch>]}" [shape=plaintext];
    "Open MR on the branch?" [shape=diamond];
    "Gate evidence-attach (table below)" [shape=box];
    "attach answer?" [shape=diamond];
    "mr_upload {mrUrl, path} per file; keep each markdown" [shape=plaintext];
    "mr_upload result?" [shape=diamond];
    "Upload retried with a corrected path?" [shape=diamond];
    "mr_upload {mrUrl, path: <the corrected absolute path>}" [shape=plaintext];
    "STOP: upload only with mr_upload; another route is off-script" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Off-script gate: mr_upload refused (gate-protocol, scope off-script:evidence:<n>)" [shape=box];
    "upload off-script answer?" [shape=diamond];
    "Upload off-script rounds = 2?" [shape=diamond];
    "mr_view {mrUrl, maxAgeMs: 5000}" [shape=plaintext];
    "mr_update {mrUrl, description: <the body read back plus the evidence markdown>}" [shape=plaintext];
    "run_field_set {key: evidence, value: <labelled paths and URLs>, stage: evidence}" [shape=plaintext];
    "run_stage {action: fail, stage: evidence, reason, detailPath}" [shape=plaintext];
    "run_decision {contract: gate@1, scope: hold:evidence:<attempt>, selection: {reason}, decidedBy}" [shape=plaintext];
    "run_field_set {key: hold, value: <their words, or held>, stage: evidence}" [shape=plaintext];
    "Held: end the turn naming run and stage" [shape=doublecircle];
    "Stage failed" [shape=doublecircle];
    "Evidence done: return to the orchestrator" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Evidence stage entered" -> "run_field_get {key: evidence-plan}; run_field_get {key: worktree}";
    "run_field_get {key: evidence-plan}; run_field_get {key: worktree}" -> "evidence-plan starts with none?";
    "evidence-plan starts with none?" -> "run_field_set {key: evidence, value: {plan: none}, stage: evidence}" [label="yes"];
    "evidence-plan starts with none?" -> "Run the domain steps before the gate (none when unbound)" [label="no"];
    "run_field_set {key: evidence, value: {plan: none}, stage: evidence}" -> "Evidence done: return to the orchestrator";
    "Run the domain steps before the gate (none when unbound)" -> "Domain needs an rt read (ports, endpoints)?";
    "Domain needs an rt read (ports, endpoints)?" -> "rt_verb {args: [<verb>, ...]}" [label="yes"];
    "Domain needs an rt read (ports, endpoints)?" -> "STOP: rt reads go through rt_verb, never rt on Bash" [label="tempted to run it on Bash"];
    "Domain needs an rt read (ports, endpoints)?" -> "Intake questions declared, or source not local?" [label="no"];
    "STOP: rt reads go through rt_verb, never rt on Bash" -> "rt_verb {args: [<verb>, ...]}";
    "rt_verb {args: [<verb>, ...]}" -> "Intake questions declared, or source not local?";
    "Intake questions declared, or source not local?" -> "Gate evidence (table below)" [label="yes"];
    "Intake questions declared, or source not local?" -> "Ticket already shows the broken state?" [label="no"];
    "Gate evidence (table below)" -> "evidence answer?";
    "evidence answer?" -> "Ticket already shows the broken state?" [label="proceed: intake and source recorded"];
    "evidence answer?" -> "Gate evidence (table below)" [label="iterate: re-ask with their note"];
    "evidence answer?" -> "run_decision {contract: gate@1, scope: hold:evidence:<attempt>, selection: {reason}, decidedBy}" [label="hold"];
    "evidence answer?" -> "run_stage {action: fail, stage: evidence, reason, detailPath}" [label="hand back: detailPath holds what was captured"];
    "Ticket already shows the broken state?" -> "Record the ticket's location as the BEFORE" [label="yes"];
    "Ticket already shows the broken state?" -> "Capture the BEFORE" [label="no"];
    "Record the ticket's location as the BEFORE" -> "Domain attaches evidence to an MR here?";
    "Capture the BEFORE" -> "Captured?";
    "Captured?" -> "Domain attaches evidence to an MR here?" [label="yes"];
    "Captured?" -> "Attempts = 3?" [label="no"];
    "Attempts = 3?" -> "Pick the next source or view" [label="no"];
    "Attempts = 3?" -> "Gate evidence (table below)" [label="yes: reopen with what was tried"];
    "Pick the next source or view" -> "Same source the gate recorded?";
    "Same source the gate recorded?" -> "Capture the BEFORE" [label="yes"];
    "Same source the gate recorded?" -> "STOP: a new data source is an off-script move" [label="no"];
    "STOP: a new data source is an off-script move" -> "Off-script gate (gate-protocol, scope off-script:evidence:<n>)";
    "Off-script gate (gate-protocol, scope off-script:evidence:<n>)" -> "off-script answer?";
    "off-script answer?" -> "Capture the BEFORE" [label="proceed + take: the proposed source"];
    "off-script answer?" -> "run_stage {action: fail, stage: evidence, reason, detailPath}" [label="proceed + hand back"];
    "off-script answer?" -> "Off-script rounds = 2?" [label="iterate: the human fixed the evidence gate's source, retry it"];
    "off-script answer?" -> "run_decision {contract: gate@1, scope: hold:evidence:<attempt>, selection: {reason}, decidedBy}" [label="hold: no capture made"];
    "Off-script rounds = 2?" -> "Capture the BEFORE" [label="no: the evidence gate's source"];
    "Off-script rounds = 2?" -> "run_stage {action: fail, stage: evidence, reason, detailPath}" [label="yes: hand back"];
    "Domain attaches evidence to an MR here?" -> "run_field_get {key: branch}" [label="yes"];
    "run_field_get {key: branch}" -> "mr_for_branch {repoName: <worktree>, branches: [<branch>]}";
    "Domain attaches evidence to an MR here?" -> "run_field_set {key: evidence, value: <labelled paths and URLs>, stage: evidence}" [label="no: ship attaches"];
    "mr_for_branch {repoName: <worktree>, branches: [<branch>]}" -> "Open MR on the branch?";
    "Open MR on the branch?" -> "Gate evidence-attach (table below)" [label="yes: keep its url"];
    "Open MR on the branch?" -> "run_field_set {key: evidence, value: <labelled paths and URLs>, stage: evidence}" [label="no: ship attaches later"];
    "Gate evidence-attach (table below)" -> "attach answer?";
    "attach answer?" -> "mr_upload {mrUrl, path} per file; keep each markdown" [label="attach now"];
    "attach answer?" -> "run_field_set {key: evidence, value: <labelled paths and URLs>, stage: evidence}" [label="hand back the markdown"];
    "attach answer?" -> "run_decision {contract: gate@1, scope: hold:evidence:<attempt>, selection: {reason}, decidedBy}" [label="hold"];
    "run_decision {contract: gate@1, scope: hold:evidence:<attempt>, selection: {reason}, decidedBy}" -> "run_field_set {key: hold, value: <their words, or held>, stage: evidence}";
    "run_field_set {key: hold, value: <their words, or held>, stage: evidence}" -> "Held: end the turn naming run and stage";
    "attach answer?" -> "Gate evidence-attach (table below)" [label="iterate: re-ask with their note"];
    "mr_upload {mrUrl, path} per file; keep each markdown" -> "mr_upload result?";
    "mr_upload result?" -> "mr_view {mrUrl, maxAgeMs: 5000}" [label="ok: every file uploaded"];
    "mr_upload result?" -> "Upload retried with a corrected path?" [label="path must be absolute, or file not found"];
    "mr_upload result?" -> "STOP: upload only with mr_upload; another route is off-script" [label="any other refusal: outside the roots, bytes, size"];
    "mr_upload result?" -> "STOP: upload only with mr_upload; another route is off-script" [label="tempted to copy the file into an allowed root, or upload another way"];
    "Upload retried with a corrected path?" -> "mr_upload {mrUrl, path: <the corrected absolute path>}" [label="no: this file's one fix"];
    "Upload retried with a corrected path?" -> "STOP: upload only with mr_upload; another route is off-script" [label="yes"];
    "mr_upload {mrUrl, path: <the corrected absolute path>}" -> "mr_upload result?";
    "STOP: upload only with mr_upload; another route is off-script" -> "Off-script gate: mr_upload refused (gate-protocol, scope off-script:evidence:<n>)";
    "Off-script gate: mr_upload refused (gate-protocol, scope off-script:evidence:<n>)" -> "upload off-script answer?";
    "upload off-script answer?" -> "run_field_set {key: evidence, value: <labelled paths and URLs>, stage: evidence}" [label="proceed + take: link the local paths, ship attaches"];
    "upload off-script answer?" -> "run_stage {action: fail, stage: evidence, reason, detailPath}" [label="proceed + hand back"];
    "upload off-script answer?" -> "Upload off-script rounds = 2?" [label="iterate: the human fixed the cause, retry the upload"];
    "upload off-script answer?" -> "run_decision {contract: gate@1, scope: hold:evidence:<attempt>, selection: {reason}, decidedBy}" [label="hold: nothing linked"];
    "Upload off-script rounds = 2?" -> "mr_upload {mrUrl, path} per file; keep each markdown" [label="no: retry the refused files"];
    "Upload off-script rounds = 2?" -> "run_stage {action: fail, stage: evidence, reason, detailPath}" [label="yes: hand back, the refusal quoted"];
    "mr_view {mrUrl, maxAgeMs: 5000}" -> "mr_update {mrUrl, description: <the body read back plus the evidence markdown>}";
    "mr_update {mrUrl, description: <the body read back plus the evidence markdown>}" -> "run_field_set {key: evidence, value: <labelled paths and URLs>, stage: evidence}";
    "run_field_set {key: evidence, value: <labelled paths and URLs>, stage: evidence}" -> "Evidence done: return to the orchestrator";
    "run_stage {action: fail, stage: evidence, reason, detailPath}" -> "Stage failed";
}
```

### Run the domain steps before the gate (none when unbound)

The domain's gathering steps: resolving the running app's ports and its
data source, and any other fact the gate's own sentence or the `source`
question needs. Their result decides whether `source` fires below. Any rt
read among them goes through `rt_verb`, never Bash.

### Record the ticket's location as the BEFORE

When the ticket already embeds the broken state (a screenshot, a failing
output), that is the before: record where it sits instead of recapturing.

### Capture the BEFORE

Follow the domain's capture method for the plan's evidence type. Never
reconstruct a before by reverting code on a running dev server: it
produces stale, false befores. Unbound, capture what a generic toolchain
can (the failing test output, a CLI transcript, or a screenshot the user
provides) and store it under `~/.mattstack/work/<work-id>/evidence/`.

### Pick the next source or view

A capture that failed (a blank page, a missing record, a wrong route)
gets one different attempt per round: another view, another record, the
same source. The counter is attempts within this pass through the stage.

### Off-script gate: mr_upload refused (gate-protocol, scope off-script:evidence:<n>)

The upload guard refused a file past its one fix. Scope
`off-script:evidence:<n>`, sharing `n` with the stage's other off-script
gate, `context` quoting the refusal and the path. Take links the local
paths in the handed-back markdown, and ship calls `mr_upload` on the same
files, where its own upload gate asks again if the guard still refuses
(the human can widen the roots in between); Iterate means the human moved
the file, widened `rt.mcp.uploadRoots` or recaptured. Copying a file under
an allowed root is only ever the human's move: the roots are the boundary
on what leaves the machine.

## What the graph cannot show

- **Off-script answers.** Read `next` first: at the data-source gate, Hold
  ends the turn with no capture made and Iterate means the human fixed the
  evidence gate's source; at the upload gate, Hold ends the turn with
  nothing linked and Iterate retries the upload after the human's fix.
  Iterate ignores `action`; only Proceed applies `action`. Retrying the
  evidence gate's source is Iterate; the proposed new source is only Take;
  retrying `mr_upload` is Iterate, never Take; rounds count per stage
  attempt.

## Gate `evidence` (before any capture)

One sentence above the form: what the plan asks for and what is unknown.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| the domain's intake | as the domain words them; an open-ended one is free text in the form | the domain declares them |
| `source` | **Proceed with `<source>`** / **Switch to local** | the data source is not local |
| `next` | **Proceed** / **Iterate here** / **Hold**, plus **Hand back** once three captures have failed | always |

Selection: `{"intake":{<answers>},"source":"<as confirmed>","next":"proceed|iterate|hold|handback","note":"<their words or null>"}`.
Hand back fails the stage with `detailPath` = what was captured so far.

## Gate `evidence-attach` (the domain attaches here and the lookup found an open MR)

One sentence above the form: what was captured and where it sits.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `annotations` | the proposed annotations, multi-select, all pre-selected; split `annotations-1`, ... over 4 | always |
| `attach` | **Hand back the markdown** (ship attaches) / **Attach to the MR now** | always |
| `next` | **Proceed** / **Iterate here** / **Hold** | always |

Selection: `{"annotations":[...],"attach":"now|handback"}`.

| Thought | Reality |
|---|---|
| "I have no concrete case ids to offer, so I'll explain the gap after the form" | An open-ended intake question needs no invented options: it is free text inside the form. Prose after the form is what the gate forbids. |

## Domain rules

The domain rules below supply the capture method, the intake questions
and the attach format. Where a domain step names a move the graph above
marks STOP (an rt command on Bash, a different data source), the STOP node
wins.

{{slot:domain}}

When nothing is inlined above, the graph and the Capture section are the
whole flow.

Finish with `evidence` as an object of labelled paths or URLs, at minimum
the before. Ship attaches the pair and captures any AFTER.

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}
