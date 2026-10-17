---
name: work
disable-model-invocation: true
description: "Use when running a unit of work end to end through a pack's compiled pipeline -- 'run the feature pipeline', 'do this ticket end to end', 'start a unit of work'."
allowed-tools:
  - Bash(git -C *:*)
  - Bash(*/scripts/ci-triage.sh:*)
  - Bash(*/scripts/ci-forge.sh:*)
type: pipeline-step
slots:
  tiering: { contract: model-tiering@1, required: false }
---

# work -- the pipeline orchestrator

You run one unit of work through the stages below. The graph is the run:
treat a move it does not show as a question for a gate, never a judgment
call. Reads are part of the step that needs them, not moves. Every call
after `run_enter` passes the `runDb` it returned.

## Stages

The run engine walks them in this order.

{{pipeline.table}}

`run_enter`'s `flags` is the `work` value below, verbatim; `skillDir` is
`${CLAUDE_SKILL_DIR}`, absolute:

{{run-start.flags:work}}

```dot
digraph work {
    "Trigger: run a unit of work" [shape=ellipse];
    "A running run's id in context this request continues?" [shape=diamond];
    "Existing work?" [shape=diamond];
    "run_list {repo, pipelines}" [shape=plaintext];
    "A running run listed?" [shape=diamond];
    "Gate clarify, AskUserQuestion only: Resume it / Start fresh / Hold" [shape=box];
    "clarify answer?" [shape=diamond];
    "run_enter {flags, skillDir, resume: <runId>, spawnedBy?}" [shape=plaintext];
    "run_enter {flags, skillDir, ticket?, spawnedBy?, fresh: true}" [shape=plaintext];
    "run_enter result?" [shape=diamond];
    "STOP: report the tool's message; no run_enter tool means rt needs an update" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Ticket named?" [shape=diamond];
    "Tracker: In Progress, assigned to the operator" [shape=box];
    "Account picked at spawn?" [shape=diamond];
    "run_decision {contract: account-pool@1, scope: run, selection, decidedBy}" [shape=plaintext];
    "run_field_get {key: waiting-gate}" [shape=plaintext];
    "waiting-gate set?" [shape=diamond];
    "gate_reconcile {id, runDb, stage}" [shape=plaintext];
    "run_field_set {key: waiting-gate, value: -, stage}" [shape=plaintext];
    "Armed gate's status?" [shape=diamond];
    "A failure or close gate?" [shape=diamond];
    "rt gate wait <id> as a background Bash task" [shape=plaintext];
    "Re-enter the stage at that gate's site" [shape=box];
    "at.status?" [shape=diamond];
    "Read the stage file at the position and follow it" [shape=box];
    "How did the stage file end?" [shape=diamond];
    "run_next {runDb, stage}" [shape=plaintext];
    "run_next ended?" [shape=diamond];
    "Gate <stage>-failed:<attempt>" [shape=box];
    "Gate close" [shape=box];
    "run_resolve {runDb, stage, next, to?, note?, attempt, decidedBy}" [shape=plaintext];
    "run_resolve {runDb, stage, next: redirect, to, note, attempt, decidedBy}" [shape=plaintext];
    "run_resolve result?" [shape=diamond];
    "run_hold {runDb, stage, reason: <the refusal>, decidedBy: pane}" [shape=plaintext];
    "run_hold result?" [shape=diamond];
    "STOP: report the run_hold refusal" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Held" [shape=doublecircle];
    "Ended at the gate" [shape=doublecircle];
    "Run closed" [shape=doublecircle];
    "Run abandoned" [shape=doublecircle];
    "Run done" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Trigger: run a unit of work" -> "A running run's id in context this request continues?";
    "A running run's id in context this request continues?" -> "run_enter {flags, skillDir, resume: <runId>, spawnedBy?}" [label="yes"];
    "A running run's id in context this request continues?" -> "Existing work?" [label="no"];
    "Existing work?" -> "run_list {repo, pipelines}" [label="yes"];
    "Existing work?" -> "run_enter {flags, skillDir, ticket?, spawnedBy?, fresh: true}" [label="no, or spawnedBy set"];
    "run_list {repo, pipelines}" -> "A running run listed?";
    "A running run listed?" -> "Gate clarify, AskUserQuestion only: Resume it / Start fresh / Hold" [label="yes"];
    "A running run listed?" -> "run_enter {flags, skillDir, ticket?, spawnedBy?, fresh: true}" [label="no"];
    "Gate clarify, AskUserQuestion only: Resume it / Start fresh / Hold" -> "clarify answer?";
    "clarify answer?" -> "run_enter {flags, skillDir, resume: <runId>, spawnedBy?}" [label="resume"];
    "clarify answer?" -> "run_enter {flags, skillDir, ticket?, spawnedBy?, fresh: true}" [label="start fresh"];
    "clarify answer?" -> "Held" [label="hold"];
    "run_enter {flags, skillDir, resume: <runId>, spawnedBy?}" -> "run_enter result?";
    "run_enter {flags, skillDir, ticket?, spawnedBy?, fresh: true}" -> "run_enter result?";
    "run_enter result?" -> "Ticket named?" [label="started, or resumed at the first stage's attempt 1"];
    "run_enter result?" -> "run_field_get {key: waiting-gate}" [label="resumed elsewhere"];
    "run_enter result?" -> "STOP: report the tool's message; no run_enter tool means rt needs an update" [label="refused or error"];
    "Ticket named?" -> "Tracker: In Progress, assigned to the operator" [label="yes"];
    "Ticket named?" -> "Account picked at spawn?" [label="no"];
    "Tracker: In Progress, assigned to the operator" -> "Account picked at spawn?";
    "Account picked at spawn?" -> "run_decision {contract: account-pool@1, scope: run, selection, decidedBy}" [label="yes"];
    "Account picked at spawn?" -> "run_field_get {key: waiting-gate}" [label="no"];
    "run_decision {contract: account-pool@1, scope: run, selection, decidedBy}" -> "run_field_get {key: waiting-gate}";
    "Read the stage file at the position and follow it" -> "How did the stage file end?";
    "run_field_get {key: waiting-gate}" -> "waiting-gate set?";
    "waiting-gate set?" -> "gate_reconcile {id, runDb, stage}" [label="yes"];
    "waiting-gate set?" -> "at.status?" [label="no: not set, or -"];
    "gate_reconcile {id, runDb, stage}" -> "Armed gate's status?";
    "Armed gate's status?" -> "A failure or close gate?" [label="answered or late"];
    "Armed gate's status?" -> "rt gate wait <id> as a background Bash task" [label="open"];
    "Armed gate's status?" -> "at.status?" [label="closed"];
    "Armed gate's status?" -> "run_field_set {key: waiting-gate, value: -, stage}" [label="not found"];
    "run_field_set {key: waiting-gate, value: -, stage}" -> "at.status?";
    "Armed gate's status?" -> "run_hold {runDb, stage, reason: <the refusal>, decidedBy: pane}" [label="refused"];
    "A failure or close gate?" -> "run_resolve {runDb, stage, next, to?, note?, attempt, decidedBy}" [label="yes"];
    "A failure or close gate?" -> "Re-enter the stage at that gate's site" [label="no"];
    "rt gate wait <id> as a background Bash task" -> "Ended at the gate";
    "Re-enter the stage at that gate's site" -> "How did the stage file end?";
    "at.status?" -> "Read the stage file at the position and follow it" [label="running"];
    "at.status?" -> "run_next {runDb, stage}" [label="failed or done"];
    "How did the stage file end?" -> "run_next {runDb, stage}" [label="returned, failed, held or abandoned (run_next routes them)"];
    "How did the stage file end?" -> "run_resolve {runDb, stage, next: redirect, to, note, attempt, decidedBy}" [label="handed back a Go back or a Fix (a redirect)"];
    "run_next {runDb, stage}" -> "run_next ended?";
    "run_next ended?" -> "Read the stage file at the position and follow it" [label="done, next"];
    "run_next ended?" -> "Gate close" [label="done, last"];
    "run_next ended?" -> "Gate <stage>-failed:<attempt>" [label="failed"];
    "run_next ended?" -> "Held" [label="held or waiting"];
    "run_next ended?" -> "Run closed" [label="closed"];
    "run_next ended?" -> "run_hold {runDb, stage, reason: <the refusal>, decidedBy: pane}" [label="refused"];
    "Gate <stage>-failed:<attempt>" -> "run_resolve {runDb, stage, next, to?, note?, attempt, decidedBy}";
    "Gate close" -> "run_resolve {runDb, stage, next, to?, note?, attempt, decidedBy}";
    "run_resolve {runDb, stage, next, to?, note?, attempt, decidedBy}" -> "run_resolve result?";
    "run_resolve {runDb, stage, next: redirect, to, note, attempt, decidedBy}" -> "run_resolve result?";
    "run_resolve result?" -> "Read the stage file at the position and follow it" [label="retry, redirect or iterate"];
    "run_resolve result?" -> "Held" [label="hold"];
    "run_resolve result?" -> "Run abandoned" [label="abandon"];
    "run_resolve result?" -> "Run done" [label="done"];
    "run_resolve result?" -> "run_hold {runDb, stage, reason: <the refusal>, decidedBy: pane}" [label="refused"];
    "run_hold {runDb, stage, reason: <the refusal>, decidedBy: pane}" -> "run_hold result?";
    "run_hold result?" -> "Held" [label="held"];
    "run_hold result?" -> "STOP: report the run_hold refusal" [label="refused"];
}
```

### Gate clarify, AskUserQuestion only: Resume it / Start fresh / Hold

No run exists yet: no `gate_*` or `run_*` call. Offer the newest
`run_list` row. `run_list`'s `pipelines` is {{run-list.pipelines}}; only those runs are offered to resume.
Never `run_enter`'s candidates, which ignore that filter. Starting fresh
leaves that run untouched.

### Tracker: In Progress, assigned to the operator

For Linear: `save_issue` with state In Progress and assignee `me`. Never
fabricate a ticket.

### Read the stage file at the position and follow it

The position is the last result's `at` or `next`; read its absolute `file`
from the top and follow it to its end.

### Re-enter the stage at that gate's site

Read the stage file, go to the site of that gate's scope, and continue at
gate-protocol's `A write-in to act on (actOnWriteIn)?` with the recorded
answers, never re-asking; then walk every node after that gate.

### Gate <stage>-failed:<attempt>

Scope from `run_next`, `stage` the failed stage. Above the form: the
stage, `reason` and `detailPath`.

### Gate close

`stage` is the last stage. Above the form: the MR link, its state and the
`ci` verdict.

## What the graph cannot show

- **Entry.** A running run's id goes to `resume`, never `runDb`: only
  resume writes a missing manifest. `spawnedBy` starts fresh, never clarify.
- **Resumed.** The attempt is adopted, so an armed `waiting-gate` on any
  row is reconciled first, and a late (`alreadyReconciled`) answer is still
  acted on. On a failed or done row `run_next` writes nothing and returns
  that gate's inputs. Decided questions stay decided. A `gate_reconcile`
  error reading `no gate <id>` is `not found`; any other error is
  `refused`.
- **One owner for stage rows.** The run tools write them; a stage writes
  its fields and its own `run_stage fail`. Never write stage rows, produce
  clears, `shipTarget` or `pipeline-stages` here.
- **Hand-back.** A stage ending at a Go back hands `{to, note,
  decidedBy}`, and a Fix hands `{to: implement, note, decidedBy}` the same
  way; `attempt` is its running attempt.
- **`repeated: true`**: already applied; follow the result.
- **decidedBy** is the gate tool's returned `decidedBy`, or, for a
  hand-back, the handed `decidedBy` (`pane` when it was typed in the
  pane). The gate tools record each gate's answers; this file records none.
- **A finished run stays finished.** Only Close's Done or Abandon ends it;
  a green `ci` does not. Never carry a finished run's `runDb` into new work.
- **This file's gates** walk gate-protocol's Runs integration with `runDb`
  and `stage`, "Under a run: fail the stage at the gate?" answered no.
- **Account back-fill**: `selection` is the spawn-time pick as an object,
  `decidedBy` the spawning surface.

## Gate questions

Each question is its own; never fold one list into another.

| Gate | Question | Options (recommended first) |
|---|---|---|
| `clarify` | `resume` (write-in) | **Resume it (Recommended)** / **Start fresh** / **Hold** |
| `<stage>-failed:<attempt>` | `action` | **Retry the stage (Recommended)** (when the reason names something fixable) / **Abandon the run** |
| | `next` | **Proceed** / **Iterate here** / **Go back** / **Hold** |
| | `to` | on Go back, with more than one `earlier` stage: one per stage, split `to-1`, `to-2`, ... over 4 |
| `close` | `next` | **Done** (when `ci` is green and the MR ready) / **Iterate here** / **Go back** / **Hold** |
| | `to` | on Go back, with more than one stage: one per `stages` entry, split over 4 |

With one candidate stage, label the option **Go back to `<stage>`** and
skip `to`.

The answer maps to `run_resolve`'s `next`, with their words as `note`.
Read `next` first: Proceed applies `action`, Retry as `retry`, Abandon as
`abandon`. Iterate here is `iterate` (`to` = `implement` at close), Go
back is `redirect` with `to` from `to-*`, Hold is `hold`, Done is `done`.
`attempt` is the failure scope's `<n>`, or at close the last stage's.

## Sub-agent tiering

{{slot:tiering}}

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}
