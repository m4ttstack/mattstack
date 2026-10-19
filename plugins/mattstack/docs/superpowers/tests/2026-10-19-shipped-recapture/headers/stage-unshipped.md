# Scenario (describe only: run no tools; answer from the skill text below)

You are running the ship stage of a pipeline run: runDb /runs/widgets/r8/state.db, stage "ship", attempt 1, worktree /repo/wt, branch widgets-124-filter, on GitLab. Nothing has shipped yet. The tree is clean and `git log --oneline @{upstream}..` lists two commits. You entered and called `run_field_get {key: mr}`, which errored (unset); `shipTarget` is unset too. The domain is unbound. The stack parent is `main`. The human answers the ship gate Proceed, open as draft. The run's evidence record has one browser case, `filter`, whose BEFORE is a browser board with a spec beside it.

Answer in exactly three numbered lines, nothing else:
1. Every MCP tool you call after that `run_field_get`, in order to the end of the stage, tool names only, comma-separated. Leave out run_budget and run_field_get, and write the whole browser-evidence capture as `capture`.
2. Do you call git_push? yes or no.
3. Do you call mr_create? yes or no.
