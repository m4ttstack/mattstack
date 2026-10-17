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
