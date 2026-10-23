---
node: gate_requirements_source
kind: gate
---

# Gate self-review clarify: which requirements source?

Never review against nothing. Say in one sentence what is missing, then
run gate-protocol's Runs integration with `gate_ask {questions, kind:
clarify, context, runDb, stage}` and two questions: `source` (the task as
stated, a linked doc, or their text) and `next`: **Proceed** (recommended)
/ **Hold**. The answers map is `{source, next}`. `next: hold` is the hold
whatever `source` says, its reason the developer's words.
