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
  - Bash(rt sync:*)
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

Bring one worktree's branch current with the default branch: `rt sync`
first, the manual fetch-and-rebase only where rt sync did not run. This
never guesses -- it refuses on a dirty tree, refuses a stack member, and
hands conflicts back to a human.

## Preconditions

Check these before anything mutates, and report before touching history:

- **Clean tree.** `git -C <worktree> status --porcelain` must be empty.
  Dirty: one sentence listing the uncommitted paths, then, when
  `RT_RUN_DB` is set, `rt runs field set gate clarify --stage
  <run.current_stage>` and run gate-protocol's Runs integration with
  kind `clarify` and these questions: **I committed them, retry** /
  **Abort**; **Hold**, recorded after with `rt runs decision record
  --contract gate@1 --scope clarify --selection
  '{"tree":"retry|abort"}' --decided-by <the answer's by>`. With no run:
  a human invocation presents the same form in-pane only. A SPAWNED pane
  (the launch instruction said a surface spawned this pane -- the same
  signal `run-start --spawned-by` is taken from; a board wrapper
  invocation counts as spawned per se) never presents a form here:
  nobody is watching the pane and no gate row reaches any surface. End
  this path instead with one error line the spawning surface can read
  (its own status or report channel when it has one, stderr otherwise)
  and stop. Never `git stash` and proceed: moving someone's uncommitted
  work is not this skill's call. The STOP table under the push gate
  binds this form too.
- **Upstream set.** `git -C <worktree> status -sb` prints the branch line
  first; no `...origin/<branch>` tracking ref there means no upstream --
  stop and report, there's nothing to rebase onto.
- **Discover the default branch.** `git -C <worktree> symbolic-ref
  refs/remotes/origin/HEAD`; if that's unset, fall back to the forge
  CLI's repo view (`glab repo view` / `gh repo view`). Never hardcode a
  branch name.

## Fast path: rt sync

With the preconditions clean, one call does the fetch, the stack check,
the rebase, and the push, and says why when it will not. Note the head,
then run it with the worktree as the working directory:

```
git -C <worktree> log -1 --oneline
cd <worktree> && rt sync --json
```

`rt` not on PATH: go to **Manual path**. Otherwise the exit code decides,
and nothing else does:

| exit | stdout | next |
|---|---|---|
| 0 | nothing | Synced: rt sync rebased (or found the branch current) and pushed with force-with-lease. Report the move as in **After a clean rebase**; the push already happened, so no push gate. |
| 3 | a `rebase-conflict` bundle (`unresolvedFiles`, `backupBranch`, `state: mid-rebase`) | The rebase is paused in the worktree. Go to **On conflict** with `unresolvedFiles` as the files. |
| 4, `kind: stack-refusal` | `stack` or `mrs`, `tool`, `hint` | REFUSE: say the `hint`, name the `tool` to run. The run ends here; the restack belongs to the stack tool. |
| 4, `kind: stack-check-unavailable` | `hint` | The stack could not be verified either way. Run **Manual path** from its Stack guards; if those commands fail for the same reason, stop and report both failures. Never rebase an unverified branch. |
| other | one line on stderr | Report the line, then **Manual path**. |

| Thought | Reality |
|---|---|
| "Exit 4, but I can see the MR targets the default branch, so I'll rebase by hand" | `stack-refusal` is the guard's verdict, not a hint. Only `stack-check-unavailable` opens the manual path, and only through its own guards. |
| "Exit 0, so now the push gate" | rt sync already pushed; that is the fast path's contract. A push form for a push that happened is a false choice. Report it as pushed. |
| "The check could not run, so the safe move is to stop and ask" | The manual guards are the same check by other means. Run them; stop only when they fail too. |

## Manual path

For a machine without `rt`, an rt sync that ended with `stack-check-unavailable`,
or any other non-zero exit: both guards, then the rebase, then the gates
below.

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

If the rebase reports a conflict (rt sync exit 3, or `git rebase` on the
manual path), stop immediately. One sentence listing the conflicted files
(the bundle's `unresolvedFiles`, or `git -C <worktree> status --porcelain`,
the `UU` and similar rows). When a caller is composing this as a per-branch step, hand
back to it with that sentence; it owns the sweep's gates. Otherwise the
gate:

- When `RT_RUN_DB` is set: `rt runs field set gate conflict:rebase-worktree:<attempt> --stage <run.current_stage>`.
- When `RT_RUN_DB` is set, run gate-protocol's Runs integration with kind
  `conflict:rebase-worktree:<attempt>` and these questions: **Leave the
  rebase in progress for me** (recommended) / **Abort the rebase**
  (`git rebase --abort`); **Iterate here**; **Hold**. With no run: a
  human invocation presents the same form in-pane only. A SPAWNED pane
  (the launch instruction said a surface spawned this pane -- the same
  signal `run-start --spawned-by` is taken from; a board wrapper
  invocation counts as spawned per se) never presents a form here:
  nobody is watching the pane and no gate row reaches any surface. End
  this path instead with one error line the spawning surface can read
  (its own status or report channel when it has one, stderr otherwise)
  and stop.
- When `RT_RUN_DB` is set: `rt runs decision record --contract gate@1 --scope conflict:rebase-worktree:<attempt> --selection '{"next":"leave|abort|iterate|hold","note":"<their words or null>"}' --decided-by <the answer's by>`.

Never resolve the conflict yourself, `git add` the files, or run `git
rebase --continue` or `git rebase --skip`; `--abort` only on that answer.

## After a clean rebase

Report the move as old head -> new head: note the branch's
`git -C <worktree> log -1 --oneline` before the fetch, then run the same
command again once the rebase finishes, and show both.

On the fast path the line ends with "pushed by rt sync": the push is
done, and this section is finished. When a caller is composing this as a
per-branch step, hand that line back; it has nothing to gate for this
branch.

On the manual path pushing is a separate decision, gate `push`. When a
caller is composing this as a per-branch step, hand back the old head ->
new head line and let it gate the batch. Otherwise:

- When `RT_RUN_DB` is set: `rt runs field set gate push --stage <run.current_stage>`.
- The sentence is the old head -> new head line above; nothing else
  before the form.
- When `RT_RUN_DB` is set, run gate-protocol's Runs integration with kind
  `push` and these questions: **Push with force-with-lease now** / **Leave
  it unpushed** (recommended when the branch has an open MR others may
  have pulled); **Iterate here**; **Hold**. With no run: a human
  invocation presents the same form in-pane only. A SPAWNED pane (the
  launch instruction said a surface spawned this pane -- the same signal
  `run-start --spawned-by` is taken from; a board wrapper invocation
  counts as spawned per se) never presents a form here: nobody is
  watching the pane and no gate row reaches any surface. End this path
  instead with one error line the spawning surface can read (its own
  status or report channel when it has one, stderr otherwise) and stop.
- When `RT_RUN_DB` is set: `rt runs decision record --contract gate@1 --scope push --selection '{"push":true|false,"next":"proceed|iterate|hold","note":"<their words or null>"}' --decided-by <the answer's by>`.

Never push unasked.

**These thoughts mean you are skipping the gate -- STOP:**

| Thought | Reality |
|---------|---------|
| "Push with force-with-lease now is the natural next action, so I'll mark it Recommended" | Only **Leave it unpushed** carries a recommended label, and only conditionally (an open MR others may have pulled). Render that qualifier attached to that option exactly; never move it to the push option. |
| "Restating the finding and explaining each option makes the ask clearer" | A gate's form is one sentence of context, then the bare option labels the gate text names, nothing more -- no restated heading, no per-option description, no conditional aside on when Hold applies. |

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}
