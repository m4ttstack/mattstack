---
node: ask_gate
kind: gate
props:
  tiering:
    merge: replace
    default: "mattstack:model-tiering"
    contract: "model-tiering@1"
---

# Ask the gate

Ask the human whether to continue, using the tiering rules.

{{props.tiering}}
