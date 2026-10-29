---
node: fix_rule_breaks
---

# Fix the rules the change breaks, then commit

Fix each rule the check showed the change breaking. A fix that changes
behavior is test-first, as in the rest of this stage. Commit the fixes on
the branch, inside the worktree. A rule you judge does not apply, or a
fix you cannot make without leaving the plan, stays as it is: name the
rule and the line in one line when the stage returns to the orchestrator.
Then record the commits; there is no second check.
