---
name: mini
description: "A small pipeline step used to test block trees"
type: pipeline-step
props:
  rules:
    merge: add
    default: ""
---

# mini

Runs the step, then asks for a decision.

```mermaid
flowchart TB
  start([Trigger: the step opens])
  run_step
  ask_gate
  finish(((Finished))):::done
  start --> run_step --> ask_gate --> finish
```

{{props.rules}}
