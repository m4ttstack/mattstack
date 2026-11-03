---
node: gate_push_refused
kind: gate
label: Push refused
---

# ship off-script gate: git_push refused

The gate protocol's Off-script gate, scope `off-script:<stage>:<n>`,
`context` quoting the refusal. Take: only the human pushing. Read `next`
first: Hold ends the turn with nothing pushed by this verb; Iterate means
the human fixed the cause (a tree registration, the daemon) and ignores
`action`; only Proceed applies `action`. Retrying `git_push` is Iterate,
never Take. Iterate counts nothing: each retry needs a new answer at this
gate; a refused retry reopens this gate with the Iterate note in its context.

A `refusal: "check-red"` or `"check-error"` is the repo's own pre-push check
failing: call the `rt_verb` tool with `args: ["check"]`, read its failures, commit the fix, then answer
Iterate here. `allowRed: true` and `skipCheck: true` push anyway, so they are
the human's answer at this gate, never the agent's own call to get past a red.
