# Scenario (describe only: run no tools; answer from the skill text below)

The operator invokes ship in a pane in the worktree /repo/wt (branch widgets-123-badge, GitLab, default branch main) with: "ship this". No caller handed a runDb. `run_enter` returns `mode: "started"`, runDb /runs/widgets/r7/state.db. The domain rules are the ones compiled into the skill below. `git status --porcelain` shows ` M src/badge/Badge.tsx`, ` M src/badge/Badge.test.tsx` and ` M src/generated/gizmo-index.ts`. The branch has no upstream yet; `git log --oneline -5` shows one earlier commit on it, `a1b2c3d widgets(badge): add badge states [WID-123]`. `branch_stack` returns the stack parent `main`. At the ship gate the human answers: commit the changes, push and open as draft, Proceed. Every check command you run exits 0. `git_push` returns ok with sha `d4e5f6a`; `mr_create` returns created, url https://gitlab.example.com/acme/widgets/-/merge_requests/42. The run has no evidence record (`run_field_get {key: evidence}` errors: unset) and no browser case. Write each gate you open, from asking it to the human's answer, as `gate(<scope>)`.

Answer in exactly six numbered lines, nothing else:
1. Every MCP tool you call, in order from the invocation to the end, tool names only, comma-separated, each gate as `gate(<scope>)`. Leave out run_budget, run_field_get and run_snapshot.
2. Every shell command you run after the ship gate's answer and before git_push, in order, exactly as you would type it, separated by ` ; `.
3. The files you stage, and the subject of the commit you make.
4. Do you run any full test suite? yes or no.
5. Every gate you open: its scope and the question ids on it.
6. The last run tool call that ends the run, with its arguments, or none.
