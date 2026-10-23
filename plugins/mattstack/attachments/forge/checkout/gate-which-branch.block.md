---
node: gate_which_branch
kind: gate
label: Which branch
---

# Gate clarify: which branch

Scope `clarify`. One sentence naming the candidates with each one's state
(opened, merged, closed), or quoting the GitLab error when a read failed,
or saying the search was cut at 200 rows when a read was truncated, then the questions, each its own question:

- `branch` (write-in): one option per candidate, or their text
- `next`: **Proceed** (recommended) / **Hold**

Selection `{"branch":"<picked>","next":"proceed|hold"}`. Their text goes back to "What was
given?" and resolves again; the second text answer ends at **Unresolved:
reported**, naming what was tried.

Hold: when this conversation holds a run's `runDb`, call
`run_hold {runDb, stage: <run.current_stage>, reason: <their words>,
decidedBy: <the answer's by>}` and end the turn. With no run, Hold ends the
turn and makes no `run_*` call.

{{include:spawned-no-run-guard}}

Never a guess.
