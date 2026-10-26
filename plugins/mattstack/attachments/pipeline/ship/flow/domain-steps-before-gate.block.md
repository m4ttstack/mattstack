---
node: domain_steps_before_gate
label: Domain steps
props:
  rules:
    merge: add
    default: ""
---

# Run the domain steps before the gate (none when unbound)

The domain's gathering steps: the diff against the ticket, the branch and
ticket checks, an existing-MR lookup, any mandatory pre-ship review. Each
question they raise goes on the `ship` gate.

{{props.rules}}
