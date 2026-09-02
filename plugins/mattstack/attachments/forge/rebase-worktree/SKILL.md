---
name: rebase-worktree
disable-model-invocation: true
description: "Use when one worktree's feature branch has fallen behind the default branch -- 'rebase this worktree', a stale MR branch -- or as the per-branch step of sync-open-mrs. Not for resolving conflicts on its own or moving uncommitted work."
allowed-tools:
  - Bash(git -C * fetch:*)
  - Bash(git -C * status:*)
  - Bash(git -C * log:*)
  - Bash(git -C * rebase:*)
  - Bash(git -C * symbolic-ref:*)
  - Bash(glab mr list:*)
  - Bash(gh pr list:*)
  - Bash(glab mr view:*)
  - Bash(gh pr view:*)
  - Bash(glab repo view:*)
  - Bash(gh repo view:*)
type: pipeline-step
slots: {}
---

# rebase-worktree

Bring one worktree's branch current with the default branch: fetch, show
what will replay, then rebase. This never guesses -- it refuses on a dirty
tree, hands conflicts back to a human, and never pushes unasked.

## Preconditions

Check these before anything mutates, and report before touching history:

- **Clean tree.** `git -C <worktree> status --porcelain` must be empty.
  Dirty: one sentence listing the uncommitted paths, then the
  structured-question tool with **I committed them, retry** / **Abort**;
  **Hold** (under a run, scope `clarify`, recorded with `--selection
  '{"tree":"retry|abort"}' --decided-by rebase-worktree`). Never `git
  stash` and proceed: moving someone's uncommitted work is not this
  skill's call. The STOP table under the push gate binds this form too.
- **Upstream set.** `git -C <worktree> status -sb` prints the branch line
  first; no `...origin/<branch>` tracking ref there means no upstream --
  stop and report, there's nothing to rebase onto.
- **Discover the default branch.** `git -C <worktree> symbolic-ref
  refs/remotes/origin/HEAD`; if that's unset, fall back to the forge
  CLI's repo view (`glab repo view` / `gh repo view`). Never hardcode a
  branch name.

## Stack guards

Both checks run before any fetch or rebase; either one refusing ends the
run. A single-branch rebase is legal only when the branch is stack-free
in both directions.

- **Child check:** look up the branch's open MR or PR (`glab mr view
  <branch>` / `gh pr view <branch>`). Targets anything other than the
  default branch: REFUSE, naming the target. A stacked branch rebases
  onto `origin/<target>` if it rebases at all; moving it onto the
  default branch destroys the stack.
- **Parent check:** list open MRs or PRs targeting this branch
  (`glab mr list --target-branch <branch>` / `gh pr list --base
  <branch>`). Any hit: REFUSE, naming the dependents. Rewriting a
  parent's history strands every child on commits that no longer exist.

Either refusal is a restack signal: the chain moves together or not at
all. Say so and point at the stack tool (`gitq:sync` where available);
never improvise a multi-branch rebase here.

| Thought | Reality |
|---|---|
| "The pipeline needs the default branch's fix" | A stacked MR reaches the default branch through its stack root. Rebasing it there directly destroys the stack. |
| "Just this parent; the children catch up later" | The moment the parent rewrites, every child points at history that no longer exists. |
| "No open MR in either direction" | Then the branch is genuinely stack-free: proceed. |

## Rebase

```
git -C <worktree> fetch origin
git -C <worktree> log --oneline origin/<default>..HEAD
git -C <worktree> rebase origin/<default>
```

Run the `log` line before the `rebase` line -- show what's about to
replay, not just what replayed.

## On conflict: gate `conflict`

If `rebase` reports a conflict, stop immediately. One sentence listing the
conflicted files (`git -C <worktree> status --porcelain`, the `UU` and
similar rows). When a caller is composing this as a per-branch step, hand
back to it with that sentence; it owns the sweep's gates. Otherwise the
gate:

- When `RT_RUN_DB` is set: `rt runs field set gate conflict:rebase-worktree:<attempt> --stage <run.current_stage>`.
- The form: **Leave the rebase in progress for me** (recommended) /
  **Abort the rebase** (`git rebase --abort`); **Iterate here**; **Hold**.
- When `RT_RUN_DB` is set: `rt runs decision record --contract gate@1 --scope conflict:rebase-worktree:<attempt> --selection '{"next":"leave|abort|iterate|hold","note":"<their words or null>"}' --decided-by rebase-worktree`.

Never resolve the conflict yourself, `git add` the files, or run `git
rebase --continue` or `git rebase --skip`; `--abort` only on that answer.

## After a clean rebase

Report the move as old head -> new head: note the branch's
`git -C <worktree> log -1 --oneline` before the fetch, then run the same
command again once the rebase finishes, and show both.

Pushing is a separate decision, gate `push`. When a caller is composing
this as a per-branch step, hand back the old head -> new head line and let
it gate the batch. Otherwise:

- When `RT_RUN_DB` is set: `rt runs field set gate push --stage <run.current_stage>`.
- The sentence is the old head -> new head line above; nothing else
  before the form.
- The form: **Push with force-with-lease now** / **Leave it unpushed**
  (recommended when the branch has an open MR others may have pulled);
  **Iterate here**; **Hold**.
- When `RT_RUN_DB` is set: `rt runs decision record --contract gate@1 --scope push --selection '{"push":true|false,"next":"proceed|iterate|hold","note":"<their words or null>"}' --decided-by rebase-worktree`.

Never push unasked.

**These thoughts mean you are skipping the gate -- STOP:**

| Thought | Reality |
|---------|---------|
| "Push with force-with-lease now is the natural next action, so I'll mark it Recommended" | Only **Leave it unpushed** carries a recommended label, and only conditionally (an open MR others may have pulled). Render that qualifier attached to that option exactly; never move it to the push option. |
| "Restating the finding and explaining each option makes the ask clearer" | A gate's form is one sentence of context, then the bare option labels the gate text names, nothing more -- no restated heading, no per-option description, no conditional aside on when Hold applies. |

## Wrap-up form contract

{{include:wrap-up-form}}
