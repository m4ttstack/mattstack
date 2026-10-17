# Follow-ups 3: RED/GREEN records

Recipe: `run-reps.sh <system-dir> <out-dir> [ids]`, 5 reps per scenario,
each rep a fresh empty directory, `claude --model sonnet --tools ""
--strict-mcp-config --setting-sources local --settings
'{"disableAllHooks":true}' --disable-slash-commands --no-session-persistence`
with the compiled verb as the appended system prompt. System files come
from `build.sh <ref-or-tree> <out-dir> <verb>...`: RED compiles
`351aa4cd8` (main at the start of this lane), GREEN the working tree.

## C1: watch-ci's new attempt after a fix push

The scenes script `run_stage start` as refused on a running stage (the
behavior once `onRunning` flips back to refuse).

| scenario | RED pass | GREEN pass | notes |
|---|---|---|---|
| W1 own run, fix pushed with `git_push` | 0/5 | 5/5 | RED: 5/5 call `run_stage {action: start, stage: watch-ci}`, get the refusal and carry on in attempt 1 ("I treat the new attempt as already in place"); GREEN: 5/5 `run_resolve {stage: watch-ci, next: iterate, attempt: 1, note: "fix pushed: 9d8e7f6a5b4c", decidedBy: pane}`, then `ci_watch` with `priorPipelineId: 9001` |
| W2 own run, the human pushed (off-script Take) | 0/5 | 5/5 | RED: 5/5 `run_stage start` after confirming the push; GREEN: 5/5 the same `run_resolve` after the `git ls-remote` comparison |
| W3 inherited run, fix pushed | 5/5 | 5/5 | regression guard: no `run_stage`, `run_resolve` or `run_field_set` on ship's run, both sides |

## C3: sync-open-mrs gate steps on the gate tools

| scenario | RED pass | GREEN pass | notes |
|---|---|---|---|
| S1 own run, sweep gate answered in the pane | 0/5 | 5/5 | RED: 5/5 `run_field_set {key: gate, value: sweep}` before `gate_ask`, then `run_decision {contract: gate@1, scope: sweep}` after `gate_answer` had already recorded it (a second record moves `decided_at`); GREEN: 5/5 `gate_ask` and `gate_answer` with `runDb` and `stage: sync-open-mrs`, no `run_field_set` on `gate`, no `run_decision` |
| S2 resumed run already holds the sweep decision | 5/5 | 5/5 | regression guard: takes the recorded proceed answer, opens no gate and records nothing, both sides |

## C4: receive-review after a recorded revise, nothing handed

Keyed on stored data: the snapshot's `extra.gate-source.respond-plan`
field `at` against the revise decision's `decided_at`.

| scenario | RED pass | GREEN pass | notes |
|---|---|---|---|
| R10 fresh pane, nothing handed, round 2 stored after the revise (pending) | 0/5 | 5/5 | RED: 5/5 rebuild rows from the revise record, re-read threads and dispatch a third adjudication, then open a new respond-plan gate built from it; GREEN: 5/5 `run_field_get` the stored source, write it unchanged to `<dir>/respond-plan.source.json`, `gate_open` it in the pane; no dispatch, no record |
| R11 fresh pane, nothing handed, source stored before the revise (never acted on) | 5/5 | 5/5 | regression guard for the kept path: fresh dispatch carrying the revise's note ("T1 is a real flake, fix it"), both sides |
| R12 the pane that handed round 2 back gets the board's round 2 plan | 5/5 | 5/5 | regression guard: one `gate_record` of the handed plan from the hand-back box, no snapshot, no dispatch, rows walked to the respond-post hand-back |

Review round (gate-protocol now lists sync-open-mrs with the verbs that draw neither): S1 rerun 5/5, `gate_ask`, form, `gate_answer`, nothing hand-written.

## Fable review nits (RED = the branch at `7dea03656`, GREEN = the nit edits)

| scenario | RED pass | GREEN pass | notes |
|---|---|---|---|
| W4 own run, second fix push, the human pushed (off-script round 1, attempt 2) | 5/5 | 5/5 | guard for the attempt wording: `run_resolve {attempt: 2}`, never the off-script `<n>` |
| R13 fresh pane, pending round 2 already answered in the console | 0/5 on the graph | 5/5 | RED: 2 reps opened a new round 2 gate over the recorded answer, 3 reached `gate_reconcile` only by stepping off the graph; GREEN: `gate_reconcile {id: g-plan-2}` answered, `gate_record {gateId: g-plan-2}`, rows walked |
| R14 board pane, nothing decided handed, pending round stored by a hand-back (`gate: null`) | 5/5 | 5/5 | guard for the table sentence: hand-back from the stored source, table from the stored cards, no thread read or dispatch |
| W1, W2, W3, R11, R12 reruns | | 5/5 each | regression |
| R10 rerun | | 5/5 | scenario now scripts `gate_reconcile` as `open` (the stored gate is non-null, so the new diamond calls it): reconcile, then the stored source reopened |
