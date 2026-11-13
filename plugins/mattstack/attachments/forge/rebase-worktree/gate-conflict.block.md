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

`<attempt>` counts from 1. The question:

- `conflict` (write-in): **Leave the rebase in progress for me**
  (recommended) / **Abort the rebase**

Selection `{"conflict":"leave|abort","next":"proceed|iterate|hold","note":"<their words or null>"}`.
Read `next` first: `hold` ends the turn with nothing aborted; `iterate`,
or a write-in saying the human worked in their pane, re-reads the tree,
ignoring `conflict`; only `proceed` applies the `conflict` choice
(`leave` or `abort`). Never resolve the conflict yourself, stage the
files, or continue or skip the rebase.

{{include:spawned-no-run-guard}}
