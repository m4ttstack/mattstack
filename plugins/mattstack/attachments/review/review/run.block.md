---
order: 1
---

# Run

Outside a pipeline this verb is its own run, so the console shows it and
the Stop hook covers its pane. `run_enter` starts, resumes or inherits the
run, or returns the running candidates; never list, read or build run dbs
by hand. It takes `flags` (the block below, verbatim), `skillDir` (this
skill's directory), `stage: review`, and only when they apply: `runDb` a
caller handed you; `spawnedBy` when a surface launched this pane; `resume`,
a review run id the caller or developer names, or the one on a handed
`--report`'s `review-run: <run id>` line (even in a launched pane).

{{run-start.flags:review}}

Pass the returned `runDb` to every `run_*` and gate call. Your stage is
`review`, except on an inherited run (`mode: inherited`): there it is
`at.stage`, written `<run.current_stage>` in the graph, and the caller
closes the run. A handed `runDb` whose run is not running is not inherited
(`handedRunDb: "not-running"`).

Every gate runs through gate-protocol with `runDb` and `stage`; the gate
tools write the gate fields and record the clarify and off-script answers.
The posting gate records nothing until `gate_record`, after posting. Draw
no `run_field_set {key: gate}` bracket and no `run_decision` gate line.

Each loop counter is one `run_budget {runDb, key, limit, stage}` call on
the counted event; its `<key> spent?` diamond reads `exhausted`. After a
compaction or resume, read a counter you cannot remember with
`increment: 0`; never charge one event twice.

| Key | Limit | Charged when |
|---|---|---|
| `target-clarify` | 2 | the target clarify gate returns typed text |
| `verify-rounds:<depth>` | 2 | a verify round at that depth leaves a blocking finding unverified |
| `verdict-rounds:<depth>` | 2 | a verdict check at that depth leaves problems |
| `post-open-fix` | 2 | a posting-gate refusal names a field (the first charge fixes it) |
| `bad-anchors` | 2 | the submit answers bad-anchors (the first charge moves them) |

{{include:run-identity}}
