---
order: 1
---

# Run

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
id, the whole of this verb's gate record.

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
