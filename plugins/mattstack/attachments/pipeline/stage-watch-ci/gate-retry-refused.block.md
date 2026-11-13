---
node: gate_retry_refused
kind: gate
label: Retry refused
---

# Off-script gate: mr_retry refused

`mr_retry` errored (`lease_held` is the stand-down), or its GitHub retry
waits ran out; `context` quotes the error (the last refusal, when the waits
ran out) and job ids. Take: the human retried the job.
