---
node: gate_off_script
kind: gate
label: Off-script gate
---

# Off-script gate

Scope `off-script:<run.current_stage>:<n>`, `n` counting from 1 per
off-script round in this sweep. One gate for the whole batch: the context
sentence quotes each mechanical refusal with its branch. The questions,
each its own question:

- `action`: **Take the proposed move** (the value spells the move in full,
  one move per branch) / **Hand back**
- `next`: **Proceed** (recommended) / **Iterate here** / **Hold**

Selection `{"action":"take|handback","next":"proceed|iterate|hold","note":"<their words or null>"}`.
Read `next` first: **Hold** ends the turn with no move made; **Iterate
here** means the human fixed the cause and wants those pushes retried, and
it ignores `action`; only **Proceed** applies `action`, where **Hand back**
leaves them push failed. The proposed move is the same plain-git
force-with-lease push, once per listed branch; retrying the refused tool is
**Iterate here**, never **Take**.
