---
node: domain_steps_before_gate
label: Domain steps
props:
  rules:
    merge: add
    default: ""
---

# Run the domain steps before the gate (none when unbound)

The domain's gathering steps: the running app's dev servers, its data
source, and any fact the gate's sentence or the `source` question needs.
Their result decides whether `source` fires. A role `dev_endpoints` lists
in `waiting` (claimed, never answered), or reports unclaimed or with an
`error`, goes in the evidence gate's sentence, so the gate opens with no
intake question.

{{props.rules}}
