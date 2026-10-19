# Scenario (describe only: run no tools; answer from the skill text below)

You are running the ship stage of a pipeline run: runDb /runs/widgets/r7/state.db, stage "ship", worktree /repo/wt, branch widgets-123-badge. This run already shipped: ship attempt 1 pushed the branch, opened https://gitlab.example.com/acme/widgets/-/merge_requests/42 and recorded `mr` and `pushed`, and the run went on to close done.

The operator then asked: "the AFTER for case badge shows the old state; re-capture it and re-attach the evidence". The orchestrator reopened the stage for that (`run_stage {action: start, stage: ship, reopen: true}` returned ok; ship attempt 2 is running) and handed you this stage file. Nothing changed in the code: `git status --porcelain` prints nothing and `git log --oneline @{upstream}..` lists nothing. You entered and called `run_field_get {key: mr}`, which returned the MR URL above. The domain is unbound. The case's BEFORE in the evidence record is a browser board with a spec beside it.

Answer in exactly three numbered lines, nothing else:
1. Every MCP tool you call after that `run_field_get`, in order to the end of the stage, tool names only, comma-separated. Leave out run_budget and run_field_get, and write the whole browser-evidence capture as `capture`.
2. Do you call git_push? yes or no.
3. Do you call mr_create? yes or no.
