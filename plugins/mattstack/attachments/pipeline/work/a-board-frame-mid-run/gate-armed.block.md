---
node: gate_armed
---

# A gate armed in this stage (waiting-gate set)?

Read `waiting-gate` with `run_field_get`. With a gate armed, failing the
stage would strand it: write the note instead and let the gate's answer
decide.
