# Compact before running a superpowers plan

Before executing a superpowers plan by any method (subagent-driven, Native
with reviews, or Native), compact yourself as the last step before execution
starts, to free the context spent on the spec and the plan.

In a herdr pane, queue it with the `rt:herdr-inject` skill:
`rt pane send self --text "/compact" --then "Continue: execute the plan ..."`
and end the turn. Outside a pane, ask the user to type `/compact`.
