---
node: gate_lease_unavailable
kind: gate
---

# Off-script gate: lease_unavailable

`ci_watch` could not claim or keep the lease after its own re-claims
(`error` says why); no one else holds it: no stand-down. Take:
the human attends the MR. No budget: another `lease_unavailable` reopens
this gate.
