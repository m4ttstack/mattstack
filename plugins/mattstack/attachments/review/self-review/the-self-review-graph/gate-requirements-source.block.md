---
node: gate_requirements_source
kind: gate
label: Requirements source
---

# Gate self-review clarify: which requirements source?

Never review against nothing. Say in one sentence what is missing, then
run gate-protocol's Runs integration with `gate_ask {questions, kind:
clarify, context, runDb, stage}` and one question: `source` (the task as
stated, a linked doc, or their text). The answers map is `{source}`. A
`next: hold` is the hold whatever `source` says, its reason the
developer's words.
