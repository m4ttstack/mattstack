---
node: gate_push_refused
kind: gate
label: Push refused
---

# Off-script gate: git_push refused

The gate protocol's Off-script gate (scope `off-script:ship:<n>`, `n`
shared with the evidence include's upload gate, `context` quoting the
refusal): `action` Take (the push outside `git_push` the gate recorded) or
Hand back (a failure, the refusal its reason); `next` Proceed, Iterate
here (the human fixed the cause) or Hold (no move). Read `next` first:
only Proceed applies `action`; retrying `git_push` is Iterate, never Take.
Iterate counts nothing: each retry needs a new answer at this gate.

A `refusal: "check-red"` or `"check-error"` is the repo's own pre-push check
failing, and the refusal carries the answer: quote
`check.result.summary.failures` in `context`, or `check.result.reason` and
`check.result.outputTail` when that list is empty. To run it again, call the
`rt_verb` tool with `args: ["check"]` and `cwd` = the tree root. Iterate here
still means the human fixed the cause, or their note names the fix: make that
fix, commit it, and push again. `allowRed: true` and `skipCheck: true` push
anyway, so they are the human's answer at this gate, never your own call to get
past a red.
