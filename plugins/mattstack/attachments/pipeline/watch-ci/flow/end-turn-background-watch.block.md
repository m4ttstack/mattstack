---
node: end_turn_background_watch
---

# End the turn: ci_watch runs in the background (watch-ci)

Claude Code backgrounds a `ci_watch` still running after 120 s and
re-invokes this pane with a `<task-notification>` whose `<result>` is the
next `ci_watch state`. End the turn in one line: `watching CI in the
background (task <id>)`. The stop hook lets the turn end while the task is
pending, and a message meanwhile reaches you at once; a foreground wait
(`sleep`, a polling script, a second `ci_watch`) delays both.

## The off-script gates (watch-ci)

Each gate below is the gate protocol's Off-script gate (scope
`off-script:<stage>:<n>`, `context` quoting the refusal), with `action`
**Take** (the move its section names) / **Hand back**, and `next`
**Proceed** (Recommended) / **Iterate here** (the human fixed it) /
**Hold**. A spent Iterate budget fails, quoting the refusals.

The `lease_unavailable` and `git_push` gates have no budget: `ci_watch`
re-claims itself, a `git_push` retry needs a new answer, a refusal reopens
the gate. An attending Take closes an own run `done`, the report saying so;
an inherited run hands the answer back.
