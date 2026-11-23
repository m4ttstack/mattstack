# Compact before running a superpowers plan

Before executing a superpowers plan by any method (subagent-driven, Native
with reviews, or Native), compact yourself as the last step before execution
starts, to free the context spent on the spec and the plan.

Write a short ledger first: the plan and spec paths, the worktree and
branch, the execution method, and what the user approved. Then, as the
turn's last call:

`fresh_context {mode: "compact", ledger: "<the ledger>", then: "Continue: execute the plan <plan path> in <worktree> with <method>"}`

The compaction runs once the turn ends, and the `then` line arrives as your
next message.

Use the pane route below instead when a chat message started this turn (an
approval that arrived over rt chat): a reset asked for in such a turn waits
for the next event rather than running when the turn ends. Use it too when
`fresh_context` is not in your tool list, when it refuses, or when a
"fresh_context did not run" message arrives in place of the `then` line.

The pane route: in a herdr pane, queue it with the `rt:herdr-inject` skill,
`rt pane send self --text "/compact" --then "Continue: execute the plan ..."`,
and end the turn. Outside a pane, ask the user to type `/compact`.
