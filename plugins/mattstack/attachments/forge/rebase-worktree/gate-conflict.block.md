---
node: gate_conflict
kind: gate
label: Rebase conflict
---

# Gate conflict:rebase-worktree:<attempt>

Scope `conflict:rebase-worktree:<attempt>`. One sentence listing the
conflicted files: the bundle's `unresolvedFiles`, or after an iterate the
unmerged (`both modified` and similar) entries of the
`git -C <tree> status` read.

`<attempt>` counts from 1. The questions, each its own question (never
fold one list into another: a question over 4 options sends the whole gate
to the wait queue):

- `conflict`: **Leave the rebase in progress for me** (recommended) /
  **Abort the rebase**
- `next`: **Proceed** (recommended) / **Iterate here** / **Hold**

Selection `{"conflict":"leave|abort","next":"proceed|iterate|hold","note":"<their words or null>"}`.
Read `next` first: **Hold** ends the turn with nothing aborted; **Iterate
here** re-reads the tree, ignoring `conflict`; only **Proceed** applies
the `conflict` choice (`leave` or `abort`). Never resolve the
conflict yourself, stage the files, or continue or skip the rebase.

{{include:spawned-no-run-guard}}
