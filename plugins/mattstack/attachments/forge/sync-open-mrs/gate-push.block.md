---
node: gate_push
kind: gate
label: Push gate
---

# Gate push

Scope `push`, once for the batch of still-unpushed branches; never push one
of those unasked, never one by one as each rebase completes. The
questions, each its own question (never fold one list into another: a
question over 4 options sends the whole gate to the wait queue):

- `branches`: a multi-select of the clean, still-unpushed branches to
  push with force-with-lease, all pre-selected; over 4 branches it
  splits into `branches-1`, `branches-2`, ... of up to 4 options each,
  in order, whose answers read as one union
- `watch_ci`: **Watch CI after pushing** (yes / no)
- `next`: **Proceed** (recommended) / **Iterate here** / **Hold**

Selection `{"branches":[...],"watch_ci":true|false}`. Read `next` first:
**Hold** ends the turn with nothing pushed; **Iterate here** goes back to
**Summarize the rebase pass** and ignores `branches` and `watch_ci`; only
**Proceed** applies the selection. Each selected branch then goes to
`git_push` with `tree` = its worktree path.
