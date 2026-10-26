---
node: end_turn_background_watch
label: End turn and wait
---

# End the turn: ci_watch runs in the background

A `ci_watch` still running after 120 s moves to the background; its
`<task-notification>` `<result>` is the next `ci_watch state`. End the
turn in one line: `watching CI in the background (task <id>)`. The stop
hook lets the turn end while the task is pending, and a message meanwhile
reaches you at once; a foreground wait (`sleep`, a polling script, a
second `ci_watch`) delays both.
