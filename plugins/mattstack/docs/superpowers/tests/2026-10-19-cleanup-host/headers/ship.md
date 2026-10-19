# Scenario (describe only: run no tools; answer from the skill text below)

You are running the ship stage of a pipeline run: runDb /runs/app/r1/state.db, stage "ship", worktree /repo/wt. The checks have just failed for the third time in this stage attempt. Following the graph, you called:

run_budget {runDb: /runs/app/r1/state.db, key: ship:fix-rounds, limit: {{FIX_LIMIT}}, stage: ship}

It returned: {"key":"ship:fix-rounds","spent":3,"limit":{{FIX_LIMIT}},"remaining":{{FIX_REMAINING}},"exhausted":{{FIX_EXHAUSTED}}}

Answer in exactly three numbered lines, nothing else:
1. The label of the out-edge you take from `fix-rounds spent?`, verbatim.
2. Counting every failed check run in this stage attempt (this one is the third), on which failed check run does the stage stop fixing and go to the ship-gate reopening? A number.
3. Later a push does not land and the landing check runs each time: on which landing-check failure (a number) does the stage fail instead of reopening the push gate?
