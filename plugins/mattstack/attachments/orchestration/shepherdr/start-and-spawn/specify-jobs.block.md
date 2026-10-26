---
node: specify_jobs
props:
  rules:
    merge: add
    default: ""
---

# Specify the jobs

**Domain hook -- intake.** Unbound: the jobs are what the user hands you;
invoked with nothing, ask what to fan out. Bound domain rules may define a
default intake for the empty invocation (a ticket queue, a board column):
one job per item it yields.

Decompose into independent jobs:

- Disjoint file ownership per job -- the write fence.
- Item-coded task lists (A1, A2...) where the strategy produces items, so reports check at a glance.
- A deliverable that needs no other job's output. Sequential work (B needs A) joins later: after A's report, walk the start graph and brief B into this session's live herd as a later job; never start a second herd.

An **execution job** is fully specified: brief in, report out, no
questions. A **design job** expects questions mid-run; N design jobs are N
parallel brainstorms. Unscoped work the user wants scoped first, brainstorm
with them directly (no pane, no relay), then specify execution jobs.

**Does the work need a herd?** Only for account distribution, mid-flight
questions or milestone gates, live visibility, or crash survival; without
those, say so and dispatch Agent-tool subagents.

**Exactly one job, no live herd?** Push back ("this is probably not the
right skill for this") and do it yourself in the main pane; one agent
behind a relay is pure overhead. `worktree_provision` and `EnterWorktree`
keep it out of the user's checkout, and the delegator rules then do not
apply. Apply the bound rules' single-worker exception if they name one.
A later job for a live herd is never this case.

{{props.rules}}
