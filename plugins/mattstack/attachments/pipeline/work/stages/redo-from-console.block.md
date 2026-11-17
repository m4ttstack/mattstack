---
node: redo_from_console
---

# Take the operator's Redo from the console

The operator sent the run back from the console to `next`. Read `note` as
their instruction for that stage. `headCommit` is where the redone gate's
step ended, so `git log <headCommit>..HEAD` is the work since.

Decide per change in that log whether to revert it (`git revert`), rework
it, or keep it, guided by `note`, and record each with normal commits on
top. Never reset, rebase away or force-push to rewrite those commits: the
history stays, and the new commits say what changed.

Then follow the stage file at `next`. The run already recorded the
redirect, so call no `run_resolve`.
