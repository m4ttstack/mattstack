---
name: spawned-no-run-guard
description: "Use when a gate would present its form in-pane with no run backing it -- deciding whether a SPAWNED pane may show that form or must error out instead. Not for direct invocation; a gated verb includes this part."
disable-model-invocation: true
---

# Spawned, no-run guard

With no run: a human invocation presents the same form in-pane only. A
SPAWNED pane (the launch instruction said a surface spawned this pane --
the same signal `run-start --spawned-by` is taken from; a board wrapper
invocation counts as spawned per se) never presents a form here: nobody is
watching the pane and no gate row reaches any surface. End this path
instead with one error line the spawning surface can read (its own status
or report channel when it has one, stderr otherwise) and stop.
