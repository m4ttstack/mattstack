---
order: 1
label: Graph notes
---

# What the graph cannot show

- **A failure the approach cannot get past** (a test that cannot be made
  to run, a dependency that will not resolve, a question the plan left
  open) ends the stage with `run_stage {action: fail, stage: "implement",
  reason}` naming it. Switching approach inside this stage is not a way
  past it.
- **Go back to plan** is a Redirect, not a failure: end the stage handing
  back `{to: plan, note: <the triage mismatch: what made the trivial
  change need a test>, decidedBy: pane}`. Write nothing else: the
  orchestrator applies it with `run_resolve`.
- **A Fix redirected from watch-ci:** before the first edit, read the
  section its note names in `{{verb.path:stage-watch-ci}}` and follow it.
