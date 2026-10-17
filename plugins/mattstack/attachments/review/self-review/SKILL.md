---
name: self-review
disable-model-invocation: true
description: >-
  Use when reviewing, sanity-checking, or gut-checking work this session
  produced on the current branch, before shipping or between tasks --
  "review my work", "is this solid?", "gut-check my changes",
  "self-review this branch". For a teammate's MR/PR use the domain's
  review skill instead.
type: pipeline-step
slots:
  criteria: { contract: review-criteria@1, required: false }
  reviewer: { contract: reviewer-dispatch@1, required: false }
---

# Self-review (your own branch)

Reviewing the change you just made, at any checkpoint between tasks or right
before shipping. This is the self-facing caller of the review flow inlined
below: point the engine at the current branch, then act on the draft it
returns. The graph below is the run: follow its edges, and treat a move it
does not show as a question for a gate, never as a judgment call.

## Run

Outside a pipeline this verb is its own run, so the console shows it and
the Stop hook covers its pane. The graph's first call, `run_enter`, starts,
resumes or inherits the run, or returns the running candidates to choose
between. Never list, read or build run dbs by hand.

`run_enter` takes:

- `flags`: this verb's value in the block below, verbatim;
- `skillDir`: this skill's own directory;
- `stage: self-review`;
- `runDb`: only when a caller handed you one;
- `resume`: only when a caller handed you a self-review run id to resume;
- `spawnedBy`: only when a board or another surface launched this pane.

{{run-start.flags:self-review}}

Keep the `runDb` it returns and pass it to every `run_*` and gate call;
nothing is exported. Your stage is `self-review` on a run you started or
resumed. On a run you inherited (`mode: inherited`, a running run a caller
handed you), your stage is the result's `at.stage`, written
`<run.current_stage>` in the graph, and the caller closes the run. A handed
`runDb` whose run is no longer running is not inherited: `run_enter`
carries on as if none was handed, and its result says
`handedRunDb: "not-running"`.

Every gate after `run_enter` runs through gate-protocol with `runDb` and
`stage`, so the gate tools write the run's gate fields and record the
answers map keyed by question id. This verb writes no `gate` field and no
gate decision by hand.

Every loop counter is a `run_budget {runDb, key, limit, stage}` call: each
counted event charges `increment: 1` (the default), the counter diamond
reads the result's `exhausted`, and the count survives compaction and
resume. The keys:

| Key | Limit | Counts |
|---|---|---|
| `fix:<finding id>:<round>` | 3 | failed fix attempts on one finding; `<round>` is 1, then 2 after its one reopened gate |
| `reopen:<finding id>` | 1 | reopened gates on one finding |

Whoever wrote the code re-derives the same assumptions while reading it back
and nods at them; a bug on the page reads as the intent that produced it. The
judgment does not happen here -- it happens in the fresh context that
the review flow dispatches.

<HARD-GATE>
Do not form the code-quality judgment yourself -- not even a careful first
pass meant to be backed up by a fresh review later. The fresh-context
reviewer is the PRIMARY reviewer, not an optional escalation, and this skill
owns dispatching it (via the review flow below) rather than suggesting the
developer get a review elsewhere. Objective checks (tests, type checks,
linters) are fine and expected -- authorship does not bias a compiler.
Reading the diff and deciding whether it is "solid" is not; that is the
reviewer's job.

A request to skip the dispatch -- "don't burn tokens on subagents," a late
hour, a partner who just wants a gut check -- does not waive this gate; the
gate outranks it. The fresh review is one dispatch, not a proliferation of
subagents; skipping it does not save the partner's time, it moves the cost
downstream to production. Diligence performed inside the biased context is
still the biased context, so checking carefully before the inline verdict
does not launder it into independence. And a plausible issue turned up
inline is evidence of what surfaced, not of what a fresh, unbiased read would
catch that this one missed.
</HARD-GATE>

{{include:run-identity}}

## The self-review graph

```dot
digraph self_review {
    rankdir=TB;

    "Trigger: self-review the current branch" [shape=ellipse];
    "run_enter {flags, skillDir, stage: self-review, runDb?, resume?, spawnedBy?}" [shape=plaintext];
    "self-review run_enter mode?" [shape=diamond];
    "Gate self-review clarify: Resume / Start fresh / Hold" [shape=box];
    "Self-review resume answer?" [shape=diamond];
    "run_enter {flags, skillDir, stage: self-review, resume: <picked runId>}" [shape=plaintext];
    "run_enter {flags, skillDir, stage: self-review, fresh: true, spawnedBy?}" [shape=plaintext];
    "The refused self-review run_enter carried resume?" [shape=diamond];
    "STOP: rt predates the run tools; tell the user to update rt before a self-review" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "run_snapshot {runDb: <resumed self-review>}" [shape=plaintext];

    "Find the self-review merge-base" [shape=box];
    "Own self-review run: record the branch?" [shape=diamond];
    "Record the self-review branch and any ticket" [shape=box];
    "Requirements known: a ticket or the task text?" [shape=diamond];
    "Gate self-review clarify: which requirements source?" [shape=box];
    "Requirements source answer?" [shape=diamond];
    "Print the self-review depth block" [shape=box];
    "Run the checks the self-review depth names" [shape=box];
    "Who forms the self-review judgment?" [shape=diamond];
    "STOP: never judge your own diff inline; dispatch the fresh reviewer" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Dispatch the fresh reviewer on your own diff" [shape=box];
    "Open the self-review off-script gate: a fill asks for a move this graph forbids" [shape=box];
    "Self-review off-script answer?" [shape=diamond];
    "Make the recorded self-review move once" [shape=box];
    "Assemble the self-review draft" [shape=box];
    "Gate self-review: fix and next, after the draft" [shape=box];
    "Gate self-review again: quote the failing output" [shape=box];
    "Self-review next answer?" [shape=diamond];
    "Self-review fix answer?" [shape=diamond];
    "Next selected finding to fix?" [shape=diamond];
    "Is the finding testable?" [shape=diamond];
    "Write a failing test for the finding" [shape=box];
    "Does the new test fail on the current code?" [shape=diamond];
    "Record the finding as not reproduced; no fix" [shape=box];
    "Fix the finding and run the tests" [shape=box];
    "Tests green after the fix?" [shape=diamond];
    "run_budget {runDb, key: fix:<finding id>:<round>, limit: 3, stage}" [shape=plaintext];
    "Fix attempts on this finding = 3?" [shape=diamond];
    "run_budget {runDb, key: reopen:<finding id>, limit: 1, increment: 0, stage}" [shape=plaintext];
    "Reopened gates on this finding = 1?" [shape=diamond];
    "run_budget {runDb, key: reopen:<finding id>, limit: 1, stage}" [shape=plaintext];
    "Self-review stuck finding answer?" [shape=diamond];
    "Record the finding as left open" [shape=box];
    "Hand back with the Minor findings listed" [shape=box];
    "Own self-review run: close it?" [shape=diamond];
    "Own self-review run: close it as abandoned?" [shape=diamond];
    "run_close {runDb, workType: self-review, stage: self-review, outcome}" [shape=plaintext];
    "Self-review closed as?" [shape=diamond];
    "run_stage {action: fail, stage: <run.current_stage>, reason: <their words>} for self-review" [shape=plaintext];
    "run_hold {runDb, stage, reason, decidedBy} for self-review" [shape=plaintext];
    "Self-review held: end the turn" [shape=doublecircle];
    "Self-review abandoned" [shape=doublecircle];
    "Self-review done: the calling flow continues" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Trigger: self-review the current branch" -> "run_enter {flags, skillDir, stage: self-review, runDb?, resume?, spawnedBy?}";
    "run_enter {flags, skillDir, stage: self-review, runDb?, resume?, spawnedBy?}" -> "self-review run_enter mode?";
    "run_enter {flags, skillDir, stage: self-review, resume: <picked runId>}" -> "self-review run_enter mode?";
    "run_enter {flags, skillDir, stage: self-review, fresh: true, spawnedBy?}" -> "self-review run_enter mode?";
    "self-review run_enter mode?" -> "Find the self-review merge-base" [label="started, or inherited: stage is at.stage"];
    "self-review run_enter mode?" -> "run_snapshot {runDb: <resumed self-review>}" [label="resumed"];
    "self-review run_enter mode?" -> "Gate self-review clarify: Resume / Start fresh / Hold" [label="candidates"];
    "self-review run_enter mode?" -> "The refused self-review run_enter carried resume?" [label="refused, or the tool is missing"];
    "The refused self-review run_enter carried resume?" -> "run_enter {flags, skillDir, stage: self-review, fresh: true, spawnedBy?}" [label="yes: say the resume was refused, start fresh"];
    "The refused self-review run_enter carried resume?" -> "STOP: rt predates the run tools; tell the user to update rt before a self-review" [label="no"];
    "Gate self-review clarify: Resume / Start fresh / Hold" -> "Self-review resume answer?";
    "Self-review resume answer?" -> "run_enter {flags, skillDir, stage: self-review, resume: <picked runId>}" [label="resume"];
    "Self-review resume answer?" -> "run_enter {flags, skillDir, stage: self-review, fresh: true, spawnedBy?}" [label="start fresh"];
    "Self-review resume answer?" -> "Self-review held: end the turn" [label="hold: no run yet, record nothing"];
    "run_snapshot {runDb: <resumed self-review>}" -> "Find the self-review merge-base" [label="re-enter, reuse every recorded answer"];

    "Find the self-review merge-base" -> "Own self-review run: record the branch?";
    "Own self-review run: record the branch?" -> "Record the self-review branch and any ticket" [label="yes"];
    "Own self-review run: record the branch?" -> "Requirements known: a ticket or the task text?" [label="no: inherited"];
    "Record the self-review branch and any ticket" -> "Requirements known: a ticket or the task text?";
    "Requirements known: a ticket or the task text?" -> "Print the self-review depth block" [label="yes"];
    "Requirements known: a ticket or the task text?" -> "Gate self-review clarify: which requirements source?" [label="no"];
    "Gate self-review clarify: which requirements source?" -> "Requirements source answer?";
    "Requirements source answer?" -> "Print the self-review depth block" [label="a source picked"];
    "Requirements source answer?" -> "run_hold {runDb, stage, reason, decidedBy} for self-review" [label="hold"];
    "Print the self-review depth block" -> "Run the checks the self-review depth names";
    "Run the checks the self-review depth names" -> "Who forms the self-review judgment?";
    "Who forms the self-review judgment?" -> "Dispatch the fresh reviewer on your own diff" [label="a fresh reviewer, always"];
    "Who forms the self-review judgment?" -> "STOP: never judge your own diff inline; dispatch the fresh reviewer" [label="tempted to give your own read"];
    "STOP: never judge your own diff inline; dispatch the fresh reviewer" -> "Dispatch the fresh reviewer on your own diff";
    "Who forms the self-review judgment?" -> "Open the self-review off-script gate: a fill asks for a move this graph forbids" [label="a bound fill asks for another move"];
    "Open the self-review off-script gate: a fill asks for a move this graph forbids" -> "Self-review off-script answer?";
    "Self-review off-script answer?" -> "Make the recorded self-review move once" [label="take"];
    "Self-review off-script answer?" -> "Who forms the self-review judgment?" [label="iterate here: decide again with their note"];
    "Self-review off-script answer?" -> "run_hold {runDb, stage, reason, decidedBy} for self-review" [label="hold"];
    "Self-review off-script answer?" -> "Own self-review run: close it as abandoned?" [label="hand back"];
    "Make the recorded self-review move once" -> "Assemble the self-review draft";
    "Dispatch the fresh reviewer on your own diff" -> "Assemble the self-review draft";
    "Assemble the self-review draft" -> "Gate self-review: fix and next, after the draft";
    "Gate self-review: fix and next, after the draft" -> "Self-review next answer?";
    "Self-review next answer?" -> "Self-review fix answer?" [label="proceed"];
    "Self-review next answer?" -> "Print the self-review depth block" [label="iterate here: redo from the depth block with their note"];
    "Self-review next answer?" -> "run_hold {runDb, stage, reason, decidedBy} for self-review" [label="hold"];
    "Self-review next answer?" -> "Own self-review run: close it as abandoned?" [label="abandon"];
    "Self-review fix answer?" -> "Next selected finding to fix?" [label="blocking or all"];
    "Self-review fix answer?" -> "Hand back with the Minor findings listed" [label="none: ship as is"];
    "Next selected finding to fix?" -> "Is the finding testable?" [label="yes"];
    "Next selected finding to fix?" -> "Own self-review run: close it?" [label="none left"];
    "Is the finding testable?" -> "Write a failing test for the finding" [label="yes: it has behavior"];
    "Is the finding testable?" -> "Fix the finding and run the tests" [label="no: naming, docs, structure"];
    "Write a failing test for the finding" -> "Does the new test fail on the current code?";
    "Does the new test fail on the current code?" -> "Fix the finding and run the tests" [label="yes: reproduced"];
    "Does the new test fail on the current code?" -> "Record the finding as not reproduced; no fix" [label="no: it passes before any fix"];
    "Record the finding as not reproduced; no fix" -> "Next selected finding to fix?";
    "Fix the finding and run the tests" -> "Tests green after the fix?";
    "Tests green after the fix?" -> "Next selected finding to fix?" [label="yes"];
    "Tests green after the fix?" -> "run_budget {runDb, key: fix:<finding id>:<round>, limit: 3, stage}" [label="no: charge the failed attempt"];
    "run_budget {runDb, key: fix:<finding id>:<round>, limit: 3, stage}" -> "Fix attempts on this finding = 3?";
    "Fix attempts on this finding = 3?" -> "Fix the finding and run the tests" [label="no: not exhausted"];
    "Fix attempts on this finding = 3?" -> "run_budget {runDb, key: reopen:<finding id>, limit: 1, increment: 0, stage}" [label="yes: exhausted"];
    "run_budget {runDb, key: reopen:<finding id>, limit: 1, increment: 0, stage}" -> "Reopened gates on this finding = 1?";
    "Reopened gates on this finding = 1?" -> "run_budget {runDb, key: reopen:<finding id>, limit: 1, stage}" [label="no: reopen as a new gate"];
    "Reopened gates on this finding = 1?" -> "Record the finding as left open" [label="yes: budget spent"];
    "run_budget {runDb, key: reopen:<finding id>, limit: 1, stage}" -> "Gate self-review again: quote the failing output";
    "Gate self-review again: quote the failing output" -> "Self-review stuck finding answer?";
    "Self-review stuck finding answer?" -> "Fix the finding and run the tests" [label="retry:<finding id>: round 2"];
    "Self-review stuck finding answer?" -> "Record the finding as left open" [label="leave:<finding id>"];
    "Self-review stuck finding answer?" -> "run_hold {runDb, stage, reason, decidedBy} for self-review" [label="hold"];
    "Self-review stuck finding answer?" -> "Own self-review run: close it as abandoned?" [label="abandon"];
    "Record the finding as left open" -> "Next selected finding to fix?";
    "Hand back with the Minor findings listed" -> "Own self-review run: close it?";
    "Own self-review run: close it?" -> "run_close {runDb, workType: self-review, stage: self-review, outcome}" [label="yes: own run, outcome done"];
    "Own self-review run: close it?" -> "Self-review done: the calling flow continues" [label="no: inherited"];
    "Own self-review run: close it as abandoned?" -> "run_close {runDb, workType: self-review, stage: self-review, outcome}" [label="yes: own run, outcome abandoned with their words"];
    "Own self-review run: close it as abandoned?" -> "run_stage {action: fail, stage: <run.current_stage>, reason: <their words>} for self-review" [label="no: inherited, the caller decides"];
    "run_close {runDb, workType: self-review, stage: self-review, outcome}" -> "Self-review closed as?";
    "Self-review closed as?" -> "Self-review done: the calling flow continues" [label="done"];
    "Self-review closed as?" -> "Self-review abandoned" [label="abandoned"];
    "run_stage {action: fail, stage: <run.current_stage>, reason: <their words>} for self-review" -> "Self-review abandoned";
    "run_hold {runDb, stage, reason, decidedBy} for self-review" -> "Self-review held: end the turn";
}
```

### Gate self-review clarify: Resume / Start fresh / Hold

No run of yours exists yet, so this gate is the structured-question tool
in the pane. The candidates come from `run_enter`'s result, each with its
`runId`, `runDb` (absolute), `startedAt`, `spawnedBy`, `currentStage` and
`ownSession`. One sentence naming each candidate's `spawnedBy`, `startedAt`
and `currentStage`, then one **Resume** option per candidate this pane may
take, a run this session started earlier (`ownSession: true`,
recommended) or one no live pane owns; a run another live pane owns gets
no Resume option, named unavailable, then **Start fresh**, **Hold**. A
surface-launched pane never reaches this gate: `run_enter` starts a fresh
run when it gets `spawnedBy`, since another pane's live run is not yours to
resume.
Resume calls `run_enter` again with the picked candidate's `runId` as
`resume`; Start fresh calls it with `fresh: true`. Hold here records
nothing (no run has started or been resumed to record it against) and ends
the turn.

### The refused self-review run_enter carried resume?

A refused resume means the run is gone or no longer running: say so in one
line, then start fresh, keeping the first call's `spawnedBy`. Any other refusal, or no `run_enter` tool at all, is
an rt that predates the run tools.

### Find the self-review merge-base

Run `git merge-base origin/HEAD HEAD`; when `origin/HEAD` is unset, use the
default branch by name instead. The diff runs from that base through the
working tree, uncommitted changes included.

### Record the self-review branch and any ticket

`run_field_set {key: branch, value: <branch>, stage: self-review}`, and
`run_field_set {key: ticket, value: <ticket>, stage: self-review}` only when
the branch names one; never guess a ticket.

### Gate self-review clarify: which requirements source?

The branch carries no ticket and the session holds no task text: never
review against nothing. Say in one sentence what is missing, then run
gate-protocol's Runs integration from `Trigger: a site reaches its gate`:

`gate_ask {questions, kind: clarify, context, runDb, stage}`

with two questions: `source`, the candidate sources (the task as stated, a
linked doc, or their text), and `next`: **Proceed** (recommended) /
**Hold**. The protocol's `gate_answer` or `gate_reconcile` records the
answers map `{source, next}` at scope `clarify`. A `next: hold` is the
hold, whatever `source` says; its reason is the developer's words.

### Print the self-review depth block

The review flow's "Commit to a review depth" below is this step: the
REVIEW DEPTH and EVIDENCE CHECK block, plus the provider triage lines when
Criteria is bound, printed before any check runs. You are already in the
worktree, so `verify` and `repro` need no provisioning.

### Run the checks the self-review depth names

The review flow's "Set up for the depth": the tests, type checks and
linters the depth names, in this worktree. Record each command and its
result; they travel to the reviewer as setup observations.

### Dispatch the fresh reviewer on your own diff

Review the work as it stands now, on the diff the merge-base step found.
Hand the review flow's "Dispatch the review" the diff, the requirements,
and a label (the branch or task name). One dispatch, never skipped,
however small the change.

### Open the self-review off-script gate: a fill asks for a move this graph forbids

A rule under Criteria or Reviewer below asks for a move the graph marks
STOP (an inline verdict in place of the dispatch, say). Open gate-protocol's
`## Off-script gate` with site `self-review`: scope
`off-script:self-review:<n>`, `context` quoting the rule, and its `action`
and `next` questions, under the run with `runDb` and `stage`. The include
defines the questions and what the answers map records.

Route on the answers: `action: handback` is hand back whatever `next`
says; otherwise `next: iterate` is iterate here, `next: hold` is hold, and
`next: proceed` is take. A hand back closes an own run as abandoned and
fails the stage on an inherited one, per the graph.

### Make the recorded self-review move once

Exactly the move the gate recorded, once; its result stands in for the
fresh reviewer's draft.

### Assemble the self-review draft

Strengths / Issues (Critical / Important / Minor) / Assessment, per the
review flow's "Assemble the draft". Present it; the draft is the sentence
and the gate that follows is the close.

### Gate self-review: fix and next, after the draft

Run gate-protocol's Runs integration from `Trigger: a site reaches its
gate`:

`gate_ask {questions, kind: self-review, context, runDb, stage}`

with `context` quoting the draft's Issues and these questions, each its own
question (never fold one list into another: a question over 4 options sends
the whole gate to the wait queue):

- `fix` (write-in): **Fix the blocking findings now** (value `blocking`,
  recommended when any Critical or Important exists) / **Fix the minors
  too** (`all`) / **Ship as is** (`none`)
- `next`: **Proceed** (`proceed`, recommended) / **Iterate here**
  (`iterate`) / **Hold** (`hold`) / **Abandon** (`abandon`)

The protocol records the answers map `{fix, next}` at scope `self-review`;
a `fix` write-in arrives as `{"writeIn": "<their words>"}`. Blocking means
Critical and Important; `all` fixes every finding.

A resumed run whose snapshot records a `self-review` decision with `fix`
set to an option value (`blocking`, `all` or `none`) reuses that answer,
treats `next` as proceed, and asks nothing here. One whose `fix` is a
write-in (`{"writeIn": ...}`) instead resumes at gate-protocol's Act on a
write-in: finish the work the write-in asks for, then open a NEW
self-review gate.

### Gate self-review again: quote the failing output

A new gate, never the old one reopened, on its own scope so the fix gate's
decision stays as it was. Run gate-protocol's Runs integration with the
scope as the kind:

`gate_ask {questions, kind: self-review-retry:<finding id>, context, runDb, stage}`

`context` quotes the failing test output and names the finding. The kind
is the scope, so `gate_answer` and `gate_reconcile` record the answers map
`{finding, next}` at scope `self-review-retry:<finding id>` with no scope
argument. Questions, each its own:

- `finding` (write-in): **Try this finding again** (value
  `retry:<finding id>`) / **Leave it open and move on**
  (`leave:<finding id>`)
- `next`: **Proceed** (`proceed`, recommended) / **Hold** (`hold`) /
  **Abandon** (`abandon`)

`next: hold` is hold and `next: abandon` is abandon whatever `finding`
says, a `finding` write-in riding as that move's note (gate-protocol's
deliberate-pick rule); otherwise the `finding` answer decides, and a
`finding` write-in goes through gate-protocol's Act on a write-in.

`retry:<finding id>` starts round 2: the next failed attempts charge
`fix:<finding id>:2`, a fresh key. Each finding gets one reopened gate,
counted on `reopen:<finding id>`, after which it is left open. On a resume,
a finding whose `self-review-retry:<finding id>` decision is
`retry:<finding id>` is on round 2.

### Next selected finding to fix?

One finding at a time, in draft order: the next finding the fix answer
selected that is not yet fixed, recorded not reproduced, or left open.

### Is the finding testable?

A finding with behavior (a wrong value, a crash, a missing case) is
testable. Naming, docs and structure findings are not: fix them directly,
and the suite plus a re-read of the finding is their check.

### Write a failing test for the finding

The test states the finding's claim against the current code, before any
fix.

### Record the finding as not reproduced; no fix

A test that passes before any fix means the claim did not hold on this
code. Make no fix; list the finding as not reproduced, with the test that
showed it, in what you hand back.

### Fix the finding and run the tests

Before the first attempt on a finding, save a patch of every file the
attempts will touch: a copy in a new directory inside this session's
scratchpad, outside the repo, so its own attempts can be undone. The smallest fix, then the finding's test and the checks the
depth ran.

Each failed attempt charges `fix:<finding id>:<round>` once, right after it
fails, and `Fix attempts on this finding = 3?` reads that call's
`exhausted`. The stored count already holds every failure charged before a
compaction or resume: back in this loop with no fresh failure in hand, read
it with `increment: 0` and go on from what it says. Never charge a failure
twice and never restart the count by hand.

### Record the finding as left open

No more attempts on it in this run; keep its last failing output. It is
listed as left open, with that output, in the final message and any
hand-back. Undo only this finding's own fix attempts, from the patch
saved before the first attempt; never restore a file from HEAD or the
index, since the diff under review includes uncommitted work. Mark the
finding's failing test skipped, the finding id in its name or reason (or
remove it), so the suite is green before the next finding.

### Hand back with the Minor findings listed

Ship as is: hand back to the flow that called this verb with the Minor
findings listed for the record, plus any finding left open or not
reproduced. Every unfixed Critical or Important finding counts as left
open.

## What the graph cannot show

- Where the domain defines ship-time gates, this self-review complements
  them and never checks their box.
- A hold is the one `run_hold` call: `stage` is your stage, `reason` the
  developer's words (a write-in riding on the hold included), `decidedBy`
  the answer's by. It computes the attempt and writes the `hold` field; then
  the turn ends.
- `run_close` takes `outcome: done` after the fixes, or `outcome:
  abandoned` with `reason: <their words>` on an abandon or a hand back. It
  refuses an inherited run, which never reaches it.
- After fixes, the flow that called this verb continues (ship, or the
  next task); the close runs only after the fixes the gate selected are
  verified.
- Before the close, the final message lists every selected finding as
  fixed, not reproduced (with the test that showed it), or left open. On
  ship as is that list includes every Critical and Important finding,
  which stay open.

## The review flow

The boxes from **Print the self-review depth block** through **Assemble the
self-review draft** follow this flow, with the diff, the requirements and
the label above.

{{include:review-core-body}}

If a rule below asks for a move this graph marks STOP, take the off-script edge instead.

## Criteria

{{slot:criteria}}

{{include:review-core-body-after}}

{{include:review-dispatch-body}}

If a rule below asks for a move this graph marks STOP, take the off-script edge instead.

## Reviewer

{{slot:reviewer}}

{{include:review-dispatch-body-after}}

{{include:review-core-body-tail}}

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}

## Red flags

| Thought | Reality |
|---|---|
| "For a change this small I'll just give my own read" | Small, own-authored changes are peak author bias, not an exemption. Dispatch the fresh reviewer. |
| "I'll do a first-pass read myself and a fresh review can back it up" | The fresh reviewer IS the review, not a backup for one already formed. Don't pre-empt it with an inline verdict. |
| "I'll suggest the developer get a review elsewhere" | This skill owns the dispatch; don't outsource it back to whoever is waiting. |
| "Re-reading my own lines is low-value, I'll just eyeball and ship" | Right that re-reading is low-value -- which is why a fresh context, not this eyeball, does the reading. |
| "I know what this does, I just wrote it" | That is the bias stated as a qualification. Dispatch the reviewer. |
