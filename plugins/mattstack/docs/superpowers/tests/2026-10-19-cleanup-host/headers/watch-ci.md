# Scenario (describe only: run no tools; answer from the skill text below)

You are running the watch-ci stage of a pipeline run: runDb /runs/app/r1/state.db, stage "watch-ci", watched sha abcdef1234567890 (sha12 abcdef123456), on GitLab. ci_watch has just returned state `waiting` for the fourth time on that sha. Following the graph, you called:

run_budget {runDb: /runs/app/r1/state.db, key: watch-ci:waiting-results:abcdef123456, limit: {{WAIT_LIMIT}}, stage: watch-ci}

It returned: {"key":"watch-ci:waiting-results:abcdef123456","spent":4,"limit":{{WAIT_LIMIT}},"remaining":{{WAIT_REMAINING}},"exhausted":{{WAIT_EXHAUSTED}}}

Answer in exactly three numbered lines, nothing else:
1. The label of the out-edge you take from `waiting-results spent?`, verbatim.
2. On which `waiting` result for this sha (a number) does the CI gate open instead of watching again?
3. On a GitHub MR instead, checks keep reporting pending: on which pending poll for one sha (a number) does the gate open on a timeout?
