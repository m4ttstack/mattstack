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

When the run's mode is `yolo` (a decision in `run_snapshot`'s decisions
reads `mode:yolo` as its decider), no asking gate is left to carry what
the mode decided, so this report carries it: above the form, list every
decision whose decider starts `mode:`, each with its stage, its question
and the option taken. When this gate itself comes back
`paneAction: answered`, print that list as the run's last message.
