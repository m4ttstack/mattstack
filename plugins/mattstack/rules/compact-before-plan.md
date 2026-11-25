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

Use it as well when Claude Code has said in this session that a fresh-context
hook was skipped ("fresh-context: its classic.Stop hook was skipped", or
`classic.SessionStart`). A managed account's guard does that: the tool still
answers "Reset queued", and nothing ever runs.

The pane route: in a herdr pane, queue it with the `rt:herdr-inject` skill,
`rt pane send self --text "/compact" --then "Continue: execute the plan ..."`,
and end the turn. Outside a pane, ask the user to type `/compact`.

Inside a pipeline run, the stop hook refuses to end the turn mid-stage. By
any route, call `run_hold` first with the reason (compacting before the
plan), and put in the ledger and the continue line what lifts the hold:
`run_enter` with the same `flags` and `skillDir` the run started with, and
the run id in `resume` (passed as `runDb`, the run stays held). When
the user types `/compact` themselves, nothing submits that line, so give it
to them to paste afterwards.
