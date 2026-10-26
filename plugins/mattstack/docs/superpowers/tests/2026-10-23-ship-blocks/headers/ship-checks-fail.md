# Scenario (describe only: run no tools; answer from the skill text below)

The operator invokes ship in a pane in the worktree /repo/wt (branch widgets-123-badge, GitLab, default branch main) with: "ship this". No caller handed a runDb. `run_enter` returns `mode: "started"`, runDb /runs/widgets/r7/state.db. The domain rules are the ones compiled into the skill below. `git status --porcelain` shows ` M src/badge/Badge.tsx`, ` M src/badge/Badge.test.tsx` and ` M src/generated/gizmo-index.ts`. The branch has no upstream yet; `git log --oneline -5` shows one earlier commit on it, `a1b2c3d widgets(badge): add badge states [WID-123]`. `branch_stack` returns the stack parent `main`. At the ship gate the human answers: commit the changes, push and open as draft, Proceed. The first time you run the type check, it fails with `src/badge/Badge.tsx:14:7 - error TS2322: Type 'string' is not assignable to type 'BadgeState'.`; every other check run exits 0, every check after your fix included. `run_budget {key: ship:fix-rounds}` returns `exhausted: false`. `git_push` returns ok with sha `e7f8a9b`; `mr_create` returns created, url https://gitlab.example.com/acme/widgets/-/merge_requests/43. The run has no evidence record (`run_field_get {key: evidence}` errors: unset) and no browser case. Write each gate you open, from asking it to the human's answer, as `gate(<scope>)`.

Answer in exactly six numbered lines, nothing else:
1. Every MCP tool you call, in order from the invocation to the end, tool names only, comma-separated, each gate as `gate(<scope>)`. Leave out run_field_get and run_snapshot.
2. Every shell command you run from the failing type check until the checks pass again, in order, exactly as you would type it, separated by ` ; ` (write a file edit as `edit <path>`).
3. Each commit you make in this verb: the files you stage and its subject.
4. Do you run any full test suite? yes or no.
5. When the type check fails: the run_budget key you call, and does the ship gate reopen? key, then yes or no.
6. The last run tool call that ends the run, with its arguments, or none.
