---
node: gate_push_refused
kind: gate
---

# ship off-script gate: git_push refused

The gate protocol's Off-script gate, scope `off-script:<stage>:<n>`,
`context` quoting the refusal. Take: only the human pushing. Read `next`
first: Hold ends the turn with nothing pushed by this verb; Iterate means
the human fixed the cause (a tree registration, the daemon) and ignores
`action`; only Proceed applies `action`. Retrying `git_push` is Iterate,
never Take. Iterate counts nothing: each retry needs a new answer at this
gate; a refused retry reopens this gate with the Iterate note in its context.
