---
name: work-next-gate
description: "Use when a work-next stage or the work-next orchestrator reaches a gate and must publish the decision, carry it to an answer and record it. Not for direct invocation; every work-next stage includes this part."
disable-model-invocation: true
---

# Run gate

Every gate in the work-next pipeline runs this graph. The site names the
scope, the questions and the `run_decision` selection; this part publishes,
answers and records. Every `run_*` call passes `runDb`.

```dot
digraph run_gate {
    rankdir=TB;

    "A site reaches its gate" [shape=ellipse];
    "run_field_set {key: gate, value: <scope>, stage}" [shape=plaintext];
    "gate_ask {questions, kind: <scope>, context?}" [shape=plaintext];
    "gate_ask result?" [shape=diamond];
    "Fixed this call once already?" [shape=diamond];
    "Fix what the refusal names" [shape=box];
    "Daemon down: run spawned?" [shape=diamond];
    "AskUserQuestion, form only, no gate_answer" [shape=box];
    "Take this answer; decidedBy is pane" [shape=box];
    "presentation?" [shape=diamond];
    "Wait: run spawned?" [shape=diamond];
    "AskUserQuestion: one sentence of context, then the form" [shape=box];
    "gate_answer {id, answers}" [shape=plaintext];
    "conflict: true?" [shape=diamond];
    "Discard the form's answer; say which surface won" [shape=box];
    "run_field_set {key: waiting-gate, value: <id>, stage}" [shape=plaintext];
    "rt gate wait <id> as a background Bash task" [shape=plaintext];
    "End the turn: holding at gate <id>" [shape=box];
    "The wait finished and re-invoked this pane" [shape=ellipse];
    "run_field_set {key: waiting-gate, value: -, stage}" [shape=plaintext];
    "Wait status?" [shape=diamond];
    "A doorbell arrives while the form is open" [shape=ellipse];
    "rt gate wait <id> --timeout 2s" [shape=plaintext];
    "Take the winning answer and its by" [shape=box];
    "run_decision {contract: gate@1, scope, selection, decidedBy}" [shape=plaintext];
    "next answer?" [shape=diamond];
    "Record the hold decision and the hold field" [shape=box];
    "run_stage {action: fail, stage, reason}" [shape=plaintext];
    "STOP: never invent an answer or re-ask a closed gate" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Held: end the turn naming run and stage" [shape=doublecircle];
    "Hand the answer to the orchestrator for Redirect" [shape=doublecircle];
    "Stage failed" [shape=doublecircle];
    "Path ended" [shape=doublecircle];
    "Act on the answer at the site" [shape=doublecircle style=filled fillcolor=lightgreen];

    "A site reaches its gate" -> "run_field_set {key: gate, value: <scope>, stage}";
    "run_field_set {key: gate, value: <scope>, stage}" -> "gate_ask {questions, kind: <scope>, context?}";
    "gate_ask {questions, kind: <scope>, context?}" -> "gate_ask result?";
    "gate_ask result?" -> "presentation?" [label="ok: keep id and presentation"];
    "gate_ask result?" -> "Daemon down: run spawned?" [label="refused: daemon unreachable"];
    "gate_ask result?" -> "Fixed this call once already?" [label="refused: any other reason"];
    "Fixed this call once already?" -> "Fix what the refusal names" [label="no"];
    "Fixed this call once already?" -> "run_stage {action: fail, stage, reason}" [label="yes"];
    "Fix what the refusal names" -> "gate_ask {questions, kind: <scope>, context?}";
    "Daemon down: run spawned?" -> "AskUserQuestion, form only, no gate_answer" [label="no: attended"];
    "Daemon down: run spawned?" -> "run_stage {action: fail, stage, reason}" [label="yes"];
    "AskUserQuestion, form only, no gate_answer" -> "Take this answer; decidedBy is pane";
    "Take this answer; decidedBy is pane" -> "run_decision {contract: gate@1, scope, selection, decidedBy}";
    "presentation?" -> "AskUserQuestion: one sentence of context, then the form" [label="form"];
    "presentation?" -> "Wait: run spawned?" [label="wait"];
    "Wait: run spawned?" -> "AskUserQuestion: one sentence of context, then the form" [label="no: attended, take the form anyway"];
    "Wait: run spawned?" -> "run_field_set {key: waiting-gate, value: <id>, stage}" [label="yes"];
    "AskUserQuestion: one sentence of context, then the form" -> "gate_answer {id, answers}";
    "gate_answer {id, answers}" -> "conflict: true?";
    "conflict: true?" -> "Discard the form's answer; say which surface won" [label="yes: row carries the winner"];
    "conflict: true?" -> "Take the winning answer and its by" [label="no: this answer won"];
    "Discard the form's answer; say which surface won" -> "Take the winning answer and its by";
    "run_field_set {key: waiting-gate, value: <id>, stage}" -> "rt gate wait <id> as a background Bash task";
    "rt gate wait <id> as a background Bash task" -> "End the turn: holding at gate <id>";
    "End the turn: holding at gate <id>" -> "The wait finished and re-invoked this pane" [style=dashed];
    "The wait finished and re-invoked this pane" -> "run_field_set {key: waiting-gate, value: -, stage}";
    "run_field_set {key: waiting-gate, value: -, stage}" -> "Wait status?";
    "Wait status?" -> "Take the winning answer and its by" [label="answered: row.answer"];
    "Wait status?" -> "STOP: never invent an answer or re-ask a closed gate" [label="closed or not found"];
    "STOP: never invent an answer or re-ask a closed gate" -> "Path ended";
    "A doorbell arrives while the form is open" -> "rt gate wait <id> --timeout 2s";
    "rt gate wait <id> --timeout 2s" -> "Take the winning answer and its by";
    "Take the winning answer and its by" -> "run_decision {contract: gate@1, scope, selection, decidedBy}";
    "run_decision {contract: gate@1, scope, selection, decidedBy}" -> "next answer?";
    "next answer?" -> "Act on the answer at the site" [label="proceed, or a site answer"];
    "next answer?" -> "Act on the answer at the site" [label="iterate here: the site's iterate edge says what to redo"];
    "next answer?" -> "Hand the answer to the orchestrator for Redirect" [label="go back"];
    "next answer?" -> "Record the hold decision and the hold field" [label="hold"];
    "Record the hold decision and the hold field" -> "Held: end the turn naming run and stage";
    "run_stage {action: fail, stage, reason}" -> "Stage failed";
}
```

## What the graph cannot show

- **Questions.** At most 4 options each, or the daemon sends the whole gate
  to the wait queue. Navigation (Iterate here, Go back, Hold) is its own
  `next` question. A selection list over 4 splits into `<id>-1`, `<id>-2`,
  ... of up to 4 each, in order, read as one union.
- **Options** are `{value, label, description}`, the recommended one first
  with `(Recommended)` in its label. A label is at most 200 bytes:
  middle-truncate a long path, never alter the value.
- **Context** is a verbatim quote of the material under decision (the task
  text, the printed block, the failing output), or omitted. Never blank,
  never a fresh summary. It shares one 8192-byte UTF-8 budget with every
  question's own context; over it the daemon drops content and the result
  carries `contextOmitted: true`.
- **Answers** are option values, verbatim. Nuance rides
  `{"value": ..., "note": "..."}`; a question with no options takes the
  typed text. Several form chunks still send one `gate_answer`, after the
  last.
- **decidedBy** is the answer's `by` (`pane`, `board`, `console`,
  `shepherd`), never a verb name.
- **Attendance** comes from the run's `spawnedBy`, never from asking.
- **The form is the reply**: one sentence of context above it, no option
  list in prose, nothing after it.
- **Hold** records `run_decision {contract: gate@1, scope: hold:<stage>:<attempt>, selection: {reason}}`
  and `run_field_set {key: hold, value: <their words, or held>}`.
- **A re-ask after Iterate is a new gate**: a fresh `gate_ask` with its
  own id, never the old one reopened. Each pass is the human's call.
- `rt gate wait` is the one rt command this pipeline runs on Bash: no tool
  blocks on a gate.

## Off-script gate

Leaving a stage graph is legal when it is explicit. Every STOP node that
routes here opens this gate, scope `off-script:<stage>:<n>` (`n` counts
from 1 within the stage attempt), with `context` quoting the refusal or
the domain line that asks for the move:

| Question | Options |
|---|---|
| `action` | **Take the proposed move** (the value spells the move in full) / **Hand back** |
| `next` | **Proceed** (Recommended) / **Iterate here** / **Hold** |

Selection: `{"move":"<the move>","why":"<the refusal or line>","action":"take|handback","next":"proceed|iterate|hold","note":"<their words or null>"}`.
Take: make exactly that move, once, then continue from the node after it.
Hand back: `run_stage {action: fail}` with the why as the reason.
