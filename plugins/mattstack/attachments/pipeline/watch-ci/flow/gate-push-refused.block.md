---
node: gate_push_refused
kind: gate
label: Push refused
---

# watch-ci off-script gate: git_push refused

Take: the value spells the move in full, such as the human pushing.
`iterate`: the human fixed the cause, push again. Selection:
`{"action":"take: <the move in full>|handback","next":"proceed|iterate|hold","note":"<their words or null>"}`.

A `refusal: "check-red"` or `"check-error"` is the repo's own pre-push check
failing, and the refusal carries the answer: quote
`check.result.summary.failures` in `context`, or `check.result.reason` and
`check.result.outputTail` when that list is empty. To run it again, call the
`rt_verb` tool with `args: ["check"]` and `cwd` = the tree root. `iterate`
still means the human fixed the cause, or their note names the fix: make that
fix, commit it, and push again. `allowRed: true` and `skipCheck: true` push
anyway, so they are the human's answer at this gate, never your own call to get
past a red.
