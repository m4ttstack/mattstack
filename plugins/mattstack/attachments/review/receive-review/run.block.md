---
order: 1
---

# Run

`run_enter` starts, resumes or inherits the run, or returns the running
candidates; never list, read or build run dbs by hand. It takes `flags`
(this verb's block below, verbatim), `skillDir`
(this skill's directory), `stage: receive-review`, `runDb` only when a
caller handed one, `resume` when the caller or the developer names a run
id or a handed `--report` carries a `receive-review-run: <run id>` line
(that id, even in a pane a surface launched), and `spawnedBy` only when a
board or another surface launched this pane.

{{run-start.flags:receive-review}}

Pass the returned `runDb` to every `run_*` and gate call; nothing is
exported. `run_enter` is the first call of a pane with no run in hand: a
caller re-entering this pane after its hand-back continues at the box that
handed back, on the run the pane already holds. `<stage>` is
`receive-review` on a run you started or resumed; on an inherited run
(`mode: inherited`) it is the result's `at.stage`, and the caller closes
the run. A handed `runDb` whose run is no longer running is not inherited:
the result says `handedRunDb: "not-running"` and the run starts as if none
was handed.

Every gate passes `runDb` and `stage`, so the gate tools write the run's
gate fields; `respond-plan` and `respond-post` record only through this
verb's `gate_record`.

Each loop counter is one `run_budget {runDb, key, limit, stage}` call on
the counted failure, and its `<key> spent?` diamond reads `exhausted`. The
count lives on the run: after a compaction or resume, read a counter you
cannot remember with `increment: 0`, never restart it.

| Key | Limit | Charged when |
|---|---|---|
| `respond-plan-open` | 3 | a respond-plan `gate_open` refusal names a source field |
| `respond-post-open` | 3 | a respond-post `gate_open` refusal names a source field |
| `fix:<threadId>` | 3 | that thread's fix fails its tests and checks |
| `post-execute-fix` | 2 | a `respond_post_execute` refusal names something to fix (fixed once; the second opens the off-script gate) |

`respond_post_execute` bounds its own reply, resolve and push retries.

A Hold that ends the turn, own or inherited run, is one `run_hold {runDb,
stage, reason, decidedBy}`: `reason` the human's words or the quoted
error, `decidedBy` the answer's by. The clarify Hold comes before any run
and records nothing.

A thread hold makes no `run_hold` call: the run stays open with `hold` at
`held` (on GitLab `respond_post_execute` sets it and re-records the held
ids; on GitHub this verb does both). A resume calls the post side again,
acting only on the held threads; `run_enter` clears the field.

The close runs only when this verb started or resumed the run, once
nothing is left to post: `run_close {runDb, workType: receive-review,
stage: receive-review, outcome: done}`; a failure (a forge read error)
closes `failed`, a hand back `abandoned`, with `reason` the quoted error
or the why. On an inherited run either is `run_stage {action: fail,
stage, reason}`, and the caller decides.

`respond_post_execute` reads the run's `mr` and `branch`, so this verb
records both on any run that lacks them, inherited included. Run identity
below governs `ticket`.

{{include:run-identity}}
