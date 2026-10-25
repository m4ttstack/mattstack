---
node: gate_off_script
kind: gate
label: Off-script gate
---

# Off-script gate

Scope `off-script:<run.current_stage>:<n>`, `n` counting from 1 per
off-script round in this run; with no run, the site is `checkout` (scope `off-script:checkout:<n>`). The
context sentence quotes the `worktree_provision` error. The
questions, each its own question:

- `action`: **Take the proposed move** (the value spells the move in full)
  / **Hand back**
- `next`: **Proceed** (recommended) / **Iterate here** / **Hold**

Selection `{"action":"take|handback","next":"proceed|iterate|hold","note":"<their words or null>"}`.
Read `next` first: **Hold** ends the turn with no move made; **Iterate
here** means the human fixed the cause (started the daemon, registered the
repo) and wants `worktree_provision` retried, and it ignores `action`; only
**Proceed** applies `action` (take or hand back). The proposed
move is one plain-git worktree for the branch at a path the value names;
retrying the refused tool is **Iterate here**, never **Take**. A plain-git
worktree is a move only the human's **Take** can authorize; never make one
on any other answer. **Provision refused: reported** quotes the
`worktree_provision` error.
