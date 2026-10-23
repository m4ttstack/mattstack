---
node: gate_dirty_tree
---

# Gate clarify: dirty tree

Scope `clarify`. One sentence listing the uncommitted paths (the result's
`paths`; when absent, quote `refusal`), then two questions, each its own question:

- `tree`: **I committed them, retry** / **Abort**
- `next`: **Proceed** / **Hold**

Selection `{"tree":"retry|abort","next":"proceed|hold"}`. Read `next` first: **Hold** ends the
turn with nothing moved. Never stash and
proceed: moving someone's uncommitted work is not this skill's call. The
table under **Gate push** binds this form too.

{{include:spawned-no-run-guard}}
