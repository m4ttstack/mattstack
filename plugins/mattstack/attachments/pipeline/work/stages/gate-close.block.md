---
node: gate_close
kind: gate
label: Close gate
---

# Gate close

`stage` is the last stage. Above the form: the MR link, its state, the
`ci` verdict and every `board-<iid>` run note (the board frame map's
notes): list every field whose key starts with `board-` from
`run_snapshot`'s fields. `run_field_get` needs the exact key, and at
close the iids are unknown.
