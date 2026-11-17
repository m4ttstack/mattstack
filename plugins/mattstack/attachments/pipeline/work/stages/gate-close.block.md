---
node: gate_close
kind: gate
label: Close gate
---

# Gate close

Reach `worktree`. `stage` is the last stage. Above the form: the MR
link, its state, the `ci` verdict and every `board-<iid>` run note (the
board frame map's notes): list every field whose key starts with `board-`
from `run_snapshot`'s fields. `run_field_get` needs the exact key, and at
close the iids are unknown.

When this gate comes back `paneAction: answered`, no form showed the
report, so print it as the run's last message: the MR link, its state,
the `ci` verdict and the `board-` notes, then every decision in
`run_snapshot`'s decisions whose decider starts `mode:`, each decision's
scope and the options taken (no gate is left to carry the
digest). A close that asks needs no such list: the gate tools prepend
the mode's decisions since the operator's last answer to the context of
every gate that asks.
