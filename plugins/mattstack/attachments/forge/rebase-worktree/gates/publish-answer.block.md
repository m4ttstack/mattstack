---
node: publish_answer
---

# Publish and answer per the gate protocol

Under the run, every gate tool call passes `runDb` and `stage: <run.current_stage>`, so the
tools bracket and record the gate: `gate_ask` writes the run's `gate`
field, and `gate_answer` or `gate_reconcile` records the answers map as the
scope's `gate@1` decision. Nothing here writes the `gate` field or the
gate's decision by hand: a second record moves the decision's time. The
recorded selection is that answers map, keyed by the question ids each gate
names, `next` included; each `Selection` line names those keys.

If a rule below asks for a move this skill's graph marks STOP, take the off-script edge instead.

{{include:gate-protocol}}
