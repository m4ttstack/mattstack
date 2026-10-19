# Scenario (describe only: run no tools; answer from the skill text below)

You are running the evidence stage of a pipeline run: runDb /runs/app/r1/state.db, stage "evidence", worktree /repo/wt. The BEFORE capture for case `badge` has just failed for the second time. Following the graph, you called:

run_budget {runDb: /runs/app/r1/state.db, key: evidence:capture-attempts:badge, limit: {{CAP_LIMIT}}, stage: evidence}

It returned: {"key":"evidence:capture-attempts:badge","spent":2,"limit":{{CAP_LIMIT}},"remaining":{{CAP_REMAINING}},"exhausted":{{CAP_EXHAUSTED}}}

Answer in exactly three numbered lines, nothing else:
1. The label of the out-edge you take from `capture-attempts spent?`, verbatim.
2. On which failed capture of this case (a number) does the evidence gate reopen with what was tried?
3. In the browser evidence pass, the confirm step refuses a board with crops: on which confirm refusal of that board (a number) is the case Not drawn instead of re-rendered?
