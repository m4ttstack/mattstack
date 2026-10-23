---
node: gate_off_script
kind: gate
label: Off-script gate
---

# Off-script gate

Its origin is the `git_push` refusal "not registered with rt". Scope
`off-script:<run.current_stage>:<n>`, `n` counting from 1 per
rebase-worktree invocation; with no run, the site is `rebase-worktree`
(scope `off-script:rebase-worktree:<n>`). The
context sentence quotes the `git_push` refusal. The questions, each its
own question:

- `action`: **Take the proposed move** (the value spells the move in full)
  / **Hand back**
- `next`: **Proceed** (recommended) / **Iterate here** / **Hold**

Selection `{"move":"<the move>","why":"<the refusal>","action":"take|handback","next":"proceed|iterate|hold","note":"<their words or null>"}`.
Read `next` first: **Hold** ends the turn with no move made; **Iterate
here** means the human fixed the cause and wants the push retried, and it
ignores `action`; only **Proceed** applies `action` (take or hand back).
The proposed move is one plain-git force-with-lease push of the
branch; retrying the refused tool is **Iterate here**, never **Take**.
