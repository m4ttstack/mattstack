---
node: gate_lease_unavailable
kind: gate
---

# watch-ci off-script gate: lease_unavailable

`ci_watch` could not claim or keep the lease after its own re-claims
(`error` says why). No one else holds it: not a stand-down.
Take: the human attends the MR.
