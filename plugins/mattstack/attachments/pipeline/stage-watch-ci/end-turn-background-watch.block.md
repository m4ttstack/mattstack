---
node: end_turn_background_watch
---

# End the turn: ci_watch runs in the background

A `ci_watch` still running after 120 s moves to the background; its
`<task-notification>` `<result>` is the next `ci_watch state`. End the
turn in one line: `watching CI in the background (task <id>)`. The stop
hook lets the turn end while the task is pending, and a message meanwhile
reaches you at once; a foreground wait (`sleep`, a polling script, a
second `ci_watch`) delays both.

## The off-script gates

Each is the gate protocol's Off-script gate (scope
`off-script:watch-ci:<n>`, `context` quoting the refusal): `action`
**Take** (the move its section names) / **Hand back** (a failure, the
refusal its reason); `next` **Proceed** (Recommended) / **Iterate
here** (the human fixed it) / **Hold**. A spent Iterate budget fails,
quoting the refusals. An attending Take writes `ci` red,
the refusal as its triage line.
