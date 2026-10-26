---
node: inherit_run
---

# Inherit the run

`run_enter` returned `mode: inherited`: a caller handed a `runDb` whose run
is still running, and you were invoked from inside it. The result's
`at.stage` is your stage, and you close nothing at the end. A handed
`runDb` whose run is no longer running is not inherited: the result says
`handedRunDb: "not-running"` and the run starts or lists as if none was
handed.
