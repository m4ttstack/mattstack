---
node: redo_from_console
---

# Take the operator's Redo from the console

The operator sent the run back from the console to `next`. Read `note` as
their instruction for that stage. `headCommit` is where the redone gate's
step ended, so `git log <headCommit>..HEAD` is the work since. When
`headCommit` is null, the gate recorded no commit: use `note` and the
branch's log to find the commits since the stage at `next` last ran, and
ask the operator when they are unclear.

Here, decide per change in that log only whether to revert it
(`git revert`) or keep it, guided by `note`, and record each revert as a
normal commit on top. The rework `note` asks for is not done here: the
stages from `next` do it when they reach that work. Never reset, rebase
away or force-push to rewrite those commits: the history stays, and the
new commits say what changed.

Then follow the stage file at `next`. The run already recorded the
redirect, so call no `run_resolve`.
