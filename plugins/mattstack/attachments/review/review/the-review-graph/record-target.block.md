---
node: record_target
---

# Record the review target: mr, branch and any ticket

`run_field_set` with `stage: review`: `key: mr` (the MR or PR URL), `key:
branch` (its source branch), and `key: ticket` only when the MR or PR
itself names one.
