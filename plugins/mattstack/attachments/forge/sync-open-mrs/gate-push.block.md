---
node: gate_push
kind: gate
label: Push gate
---

# Gate push

Scope `push`, once for the batch of still-unpushed branches; never push one
of those unasked, never one by one as each rebase completes. The
questions, each its own question (never fold one list into another):

- `branches`: a multi-select of the clean, still-unpushed branches to
  push with force-with-lease, each option
  `{value: "<branch>", label: "<branch> (Recommended)"}` so it starts
  ticked; one question when the
  kit form draws the gate (opened from the main session, not a subagent
  or a hand-back, with gate-form's `ask` tool (`mcp__gate-form__ask`) in
  your session); otherwise, over 4 branches it splits into `branches-1`, `branches-2`, ... of
  up to 4 options each, in order, whose answers read as one union (a
  question over 4 options sends the whole gate to the wait queue)
- `watch_ci`: **Watch CI after pushing** (yes / no)

Selection `{"branches":[...],"watch_ci":true|false}`. Read `next` first:
`hold` ends the turn with nothing pushed; `iterate` goes back to
**Summarize the rebase pass** and ignores `branches` and `watch_ci`; only
`proceed` applies the selection. Each selected branch then goes to
`git_push` with `tree` = its worktree path.
