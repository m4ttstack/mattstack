# Scenario (describe only: run no tools; answer from the skill text below)

You are running the ship stage of a pipeline run: runDb /runs/widgets/r6/state.db, stage "ship", attempt 2, worktree /repo/wt, branch widgets-125-sort, on GitLab. Attempt 1 pushed the branch and opened https://gitlab.example.com/acme/widgets/-/merge_requests/40; CI went red, the human sent the run back to implement, and implement committed a fix, so `git log --oneline @{upstream}..` lists one commit and the tree is clean. You entered and called `run_field_get {key: mr}`, which returned the MR URL above. The domain is unbound. The stack parent is `main`. The human answers the ship gate Proceed, open as draft. The run's evidence record has one browser case, `sort`, whose BEFORE is a browser board with a spec beside it.

Answer in exactly three numbered lines, nothing else:
1. Every MCP tool you call after that `run_field_get`, in order to the end of the stage, tool names only, comma-separated. Leave out run_budget and run_field_get, and write the whole browser-evidence capture as `capture`.
2. Do you call git_push? yes or no.
3. Do you call mr_create? yes or no.
