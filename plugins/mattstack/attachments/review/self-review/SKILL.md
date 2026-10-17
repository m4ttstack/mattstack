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

Review the change you just made, between tasks or right before shipping:
point the review flow below at the current branch, then act on the draft it
returns. Follow the graph's edges; a move it does not show is a question
for a gate, never a judgment call.

## Run

Outside a pipeline this verb is its own run, so the console shows it and
the Stop hook covers its pane. `run_enter` starts, resumes or inherits the
run, or returns the running candidates; never list, read or build run dbs
by hand. It takes `flags` (the block below, verbatim), `skillDir` (this
skill's directory) and `stage: self-review`, plus `runDb` only when a
caller handed you one, `resume` only when a caller handed you a
self-review run id, and `spawnedBy` only when a board or another surface
launched this pane.

{{run-start.flags:self-review}}

Pass the returned `runDb` to every `run_*` and gate call. Your stage is
`self-review`, except on an inherited run (`mode: inherited`): there it is
the result's `at.stage`, written `<run.current_stage>` in the graph, and
the caller closes the run. A handed `runDb` whose run is not running is
not inherited: `run_enter` goes on as if none was handed
(`handedRunDb: "not-running"`).

Every gate runs through gate-protocol with `runDb` and `stage`: the gate
tools write the gate fields and record the answers map keyed by question
id. This verb is on the tools, so gate-protocol's line on sites not yet on
the tools does not apply here: draw no `run_field_set {key: gate}`
bracket and no `run_decision` gate line.

Each loop counter is one `run_budget {runDb, key, limit, stage}` call on
the counted event, and its `<key> spent?` diamond reads `exhausted`:

| Key | Limit | Charged when |
|---|---|---|
| `fix:<finding id>:<round>` | 3 | a fix attempt fails; `<round>` is 1, then 2 after the finding's reopened gate |
| `reopen:<finding id>` | 2 | the finding's fix budget is spent: the first charge opens the reopened gate, the second leaves the finding open |

<HARD-GATE>
Do not form the code-quality judgment yourself, not even a careful first
pass for a fresh review to back up later: whoever wrote the code
re-derives the assumptions behind a bug and nods at them. The
fresh-context reviewer is the PRIMARY reviewer, and this skill dispatches
it through the review flow below rather than suggesting a review
elsewhere. Objective checks (tests, type checks, linters) are expected;
authorship does not bias a compiler. Reading the diff and deciding it is
"solid" is the reviewer's job.

A request to skip the dispatch ("don't burn tokens on subagents", a late
hour, a partner who wants a gut check) does not waive this gate. It is one
dispatch; skipping it moves the cost downstream to production. Diligence
inside the biased context is still the biased context, and a plausible
issue found inline says nothing about what a fresh read would catch.
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
    "STOP: no self-review run without run_enter; report why to the user" [shape=octagon style=filled fillcolor=red fontcolor=white];
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
    "fix:<finding id>:<round> spent?" [shape=diamond];
    "run_budget {runDb, key: reopen:<finding id>, limit: 2, stage}" [shape=plaintext];
    "reopen:<finding id> spent?" [shape=diamond];
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
    "The refused self-review run_enter carried resume?" -> "STOP: no self-review run without run_enter; report why to the user" [label="no: another refusal, or no run_enter tool"];
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
    "run_budget {runDb, key: fix:<finding id>:<round>, limit: 3, stage}" -> "fix:<finding id>:<round> spent?";
    "fix:<finding id>:<round> spent?" -> "Fix the finding and run the tests" [label="no"];
    "fix:<finding id>:<round> spent?" -> "run_budget {runDb, key: reopen:<finding id>, limit: 2, stage}" [label="yes: charge the stuck point"];
    "run_budget {runDb, key: reopen:<finding id>, limit: 2, stage}" -> "reopen:<finding id> spent?";
    "reopen:<finding id> spent?" -> "Gate self-review again: quote the failing output" [label="no: first time stuck"];
    "reopen:<finding id> spent?" -> "Record the finding as left open" [label="yes: stuck after its reopened gate"];
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

No run is yours yet, so this gate is the in-pane structured-question tool.
One sentence naming each `run_enter` candidate's `spawnedBy`, `startedAt`
and `currentStage`, then one **Resume** option per candidate this pane may
take (one this session started, `ownSession: true`, recommended; or one no
live pane owns), a candidate another live pane owns named unavailable,
then **Start fresh** and **Hold**. A surface-launched pane never reaches
this gate: given `spawnedBy`, `run_enter` starts fresh. Hold records
nothing and ends the turn.

### The refused self-review run_enter carried resume?

A refused resume means the run is gone or no longer running: say so in one
line, then start fresh with the first call's `spawnedBy`. Any other
refusal ends the self-review: quote it to the user verbatim and whole,
never a paraphrase or a guessed cause. Only when there is no `run_enter`
tool, say rt predates the run tools; update rt.

### Find the self-review merge-base

`git merge-base origin/HEAD HEAD`, or the default branch by name when
`origin/HEAD` is unset. The diff runs from that base through the working
tree, uncommitted changes included.

### Record the self-review branch and any ticket

`run_field_set {key: branch, value: <branch>, stage: self-review}`, and
`key: ticket` only when the branch names one.

### Gate self-review clarify: which requirements source?

Never review against nothing. Say in one sentence what is missing, then
run gate-protocol's Runs integration with `gate_ask {questions, kind:
clarify, context, runDb, stage}` and two questions: `source` (the task as
stated, a linked doc, or their text) and `next`: **Proceed** (recommended)
/ **Hold**. The answers map is `{source, next}`. `next: hold` is the hold
whatever `source` says, its reason the developer's words.

### Print the self-review depth block

The review flow's Commit to a review depth: the block, plus the triage
lines when Criteria is bound, printed before any check runs. You are in
the worktree, so `verify` and `repro` need no provisioning.

### Run the checks the self-review depth names

The review flow's Set up for the depth, in this worktree. Each command and
its result travel to the reviewer as setup observations.

### Dispatch the fresh reviewer on your own diff

The review flow's Dispatch the review, on the merge-base diff as it stands
now, with the requirements and a label (the branch or task name). One
dispatch, never skipped, however small the change.

### Open the self-review off-script gate: a fill asks for a move this graph forbids

A rule under Criteria or Reviewer asks for a move the graph marks STOP (an
inline verdict in place of the dispatch, say). Open gate-protocol's
`## Off-script gate` at site `self-review` (scope
`off-script:self-review:<n>`), `context` quoting the rule, under the run.
Route: `action: handback` is hand back whatever `next` says; otherwise
`next: iterate` is iterate here, `hold` is hold, `proceed` is take.

### Make the recorded self-review move once

Exactly the recorded move, once; its result stands in for the fresh
reviewer's draft.

### Assemble the self-review draft

Per the review flow's Assemble the draft. Present it; the draft is the
sentence and the gate that follows is the close.

### Gate self-review: fix and next, after the draft

Run gate-protocol's Runs integration with `gate_ask {questions, kind:
self-review, context, runDb, stage}`, `context` quoting the draft's
Issues, and two questions, each its own:

- `fix` (write-in): **Fix the blocking findings now** (`blocking`: Critical
  and Important; recommended when any exists) / **Fix the minors too**
  (`all`) / **Ship as is** (`none`)
- `next`: **Proceed** (`proceed`, recommended) / **Iterate here**
  (`iterate`) / **Hold** (`hold`) / **Abandon** (`abandon`)

The answers map is `{fix, next}` at scope `self-review`. On a resume, a
recorded `self-review` decision whose `fix` is `blocking`, `all` or `none`
is reused with `next` as proceed, asking nothing. A `fix` write-in
(`{"writeIn": ...}`) resumes at gate-protocol's Act on a write-in: do what
it asks, then open a NEW self-review gate.

### Gate self-review again: quote the failing output

A new gate on its own scope, so the fix gate's decision stays: run
gate-protocol's Runs integration with `gate_ask {questions, kind:
self-review-retry:<finding id>, context, runDb, stage}`. The kind is the
scope, so the answers map `{finding, next}` records there. `context`
quotes the failing test output and names the finding. Questions, each its
own:

- `finding` (write-in): **Try this finding again** (`retry:<finding id>`)
  / **Leave it open and move on** (`leave:<finding id>`)
- `next`: **Proceed** (`proceed`, recommended) / **Hold** (`hold`) /
  **Abandon** (`abandon`)

`next: hold` or `abandon` wins whatever `finding` says, a write-in riding
as its note; otherwise `finding` decides, and a write-in goes through Act
on a write-in. `retry:<finding id>` starts round 2: later failures charge
`fix:<finding id>:2`. On a resume, a `retry:<finding id>` decision at this
scope means round 2.

### Next selected finding to fix?

One at a time, in draft order: the next finding the fix answer selected
that is not yet fixed, not reproduced or left open.

### Is the finding testable?

Behavior (a wrong value, a crash, a missing case) is testable. Naming,
docs and structure are not: fix them directly, and the suite plus a
re-read of the finding is their check.

### Write a failing test for the finding

The test states the finding's claim against the current code, before any
fix.

### Record the finding as not reproduced; no fix

The claim did not hold on this code. Make no fix; list the finding as not
reproduced, with the test that showed it, in what you hand back.

### Fix the finding and run the tests

Before the first attempt on a finding, save a patch of every file its
attempts will touch, in a new directory inside this session's scratchpad
(outside the repo), so they can be undone. Make the smallest fix, then run
the finding's test and the depth's checks.

Charge `fix:<finding id>:<round>` once, right after a failed attempt. Back
in this loop after a compaction or resume with no fresh failure in hand,
read the stored count with `increment: 0` and go on from it. Never charge
a failure twice or restart a count by hand.

### Record the finding as left open

No more attempts this run; keep its last failing output for the final
message and any hand-back. Undo only this finding's attempts, from its
saved patch; never restore a file from HEAD or the index, since the diff
under review includes uncommitted work. Mark its failing test skipped,
the finding id in its name or reason (or remove it), so the suite is green
before the next finding.

### Hand back with the Minor findings listed

Ship as is: hand back to the calling flow with the Minor findings listed
for the record, plus every finding left open or not reproduced; an
unfixed Critical or Important counts as left open.

## What the graph cannot show

- Where the domain defines ship-time gates, this self-review complements
  them and never checks their box.
- A hold is the one `run_hold` call: your stage, the developer's words as
  `reason` (a write-in riding on the hold included), the answer's by as
  `decidedBy`. Then the turn ends.
- `run_close` takes `outcome: done` once the selected fixes are verified,
  or `outcome: abandoned` with `reason: <their words>` on an abandon or a
  hand back. Then the calling flow continues (ship, or the next task).
- Before the close, the final message lists every selected finding as
  fixed, not reproduced (with its test), or left open.

## The review flow

The boxes from **Print the self-review depth block** through **Assemble the
self-review draft** follow this flow.

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
| "gate-protocol lists self-review among the sites not yet on the tools, so I add the gate bracket and a `run_decision` line" | Not for this verb: `gate_ask` and `gate_answer` with `runDb` and `stage` record the gate. A hand bracket or `run_decision` writes it twice. |
