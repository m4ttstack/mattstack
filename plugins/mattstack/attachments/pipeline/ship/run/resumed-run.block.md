---
node: resumed_run
label: Resumed
---

# Resumed ship run: re-enter at run_snapshot's decisions

Before passing the ship gate again, call `branch_stack {tree: <root>}`,
then `run_field_get {key: shipTarget}`. An unset key (an error) or `-` is
no consent: the gate opens. A fresh target equal to the recorded one
continues on the earlier Proceed, its answers read from the ship gate
decision in `run_snapshot`. A fresh target that differs, or a store
unreadable now, reopens the gate naming both; Proceed records the fresh
one.
