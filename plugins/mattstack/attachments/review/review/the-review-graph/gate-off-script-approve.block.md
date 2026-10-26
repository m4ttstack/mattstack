---
node: gate_off_script_approve
kind: gate
label: Approve refused
---

# Open the review off-script gate: mr_approve refused

The review is posted; only the approval failed. Proposed move: the human
approves in the forge UI, recorded as theirs. Iterate retries `mr_approve`
alone, never the review. `context` quotes the submit's `approveError`, a
refused `mr_approve`'s error, or, from `This review already on the MR?`,
the hold reason naming the approval outstanding.
