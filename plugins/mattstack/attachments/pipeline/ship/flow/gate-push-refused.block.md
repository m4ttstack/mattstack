---
node: gate_push_refused
kind: gate
label: Push refused
---

# ship off-script gate: git_push refused

The gate protocol's Off-script gate, scope `off-script:<stage>:<n>`,
`context` quoting the refusal. Take: only the human pushing. Read `next`
first: `hold` ends the turn with nothing pushed by this verb; `iterate` means
the human fixed the cause (a tree registration, the daemon) and ignores
`action`; only `proceed` applies `action`. Retrying `git_push` is `iterate`,
never Take. `iterate` counts nothing: each retry needs a new answer at this
gate; a refused retry reopens this gate with the `iterate` note in its context.

A `refusal: "check-red"` or `"check-error"` is the repo's own pre-push check
failing, and the refusal carries the answer: quote
`check.result.summary.failures` in `context`, or `check.result.reason` and
`check.result.outputTail` when that list is empty. To run it again, call the
`rt_verb` tool with `args: ["check"]` and `cwd` = the tree root. `iterate`
still means the human fixed the cause, or their note names the fix: make that
fix, commit it, and push again. `allowRed: true` and `skipCheck: true` push
anyway, so they are the human's answer at this gate, never the agent's own call to get
past a red.
