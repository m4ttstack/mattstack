---
name: rebase-worktree
disable-model-invocation: true
description: "Use when one worktree's feature branch has fallen behind the default branch -- 'rebase this worktree', a stale MR branch -- or as the per-branch step of sync-open-mrs. Not for resolving conflicts on its own or moving uncommitted work."
allowed-tools:
  - Bash(git -C * fetch:*)
  - Bash(git -C * status:*)
  - Bash(git -C * log:*)
  - Bash(git -C * symbolic-ref:*)
  - Bash(git -C * remote set-head:*)
  - Bash(gh pr list:*)
  - Bash(gh pr view:*)
  - Bash(gh repo view:*)
type: pipeline-step
slots: {}
---

# rebase-worktree

Bring one worktree's branch current with the default branch: the
`branch_sync` tool first, the manual rebase only where `branch_sync` did
not run. This never guesses -- it refuses on a dirty tree, refuses a stack
member, and hands conflicts back to a human.

## Preconditions

Check these before anything mutates, and report before touching history:

- **Clean tree.** `git -C <worktree> status --porcelain` must be empty.
  Dirty: one sentence listing the uncommitted paths, then, when this
  conversation holds a run's `runDb`, the `run_field_set` tool with that
  `runDb`, `key` `gate`, `value` `clarify`, `stage`
  `<run.current_stage>`, and run gate-protocol's Runs integration with
  kind `clarify` and these questions: **I committed them, retry** /
  **Abort**; **Hold**, recorded after with the `run_decision` tool:
  `contract` `gate@1`, `scope` `clarify`, `selection`
  `{"tree":"retry|abort"}`, `decidedBy` `<the answer's by>`.

{{include:spawned-no-run-guard}}

Never `git stash` and proceed: moving someone's uncommitted work is not
this skill's call. The STOP table under the push gate binds this form
too.
- **Upstream set.** `git -C <worktree> status -sb` prints the branch line
  first; no `...origin/<branch>` tracking ref there means no upstream --
  stop and report, there's nothing to rebase onto.
- **Discover the default branch.** `git -C <worktree> symbolic-ref
  refs/remotes/origin/HEAD`. If that's unset: GitHub: `gh repo view
  --json defaultBranchRef`; GitLab: `git -C <worktree> remote set-head
  origin --auto` (it sets the local ref and pushes nothing), then read the
  symbolic-ref again. An MR's `targetBranch` is where that MR merges, not
  the default branch: never take the default from it. Never hardcode a
  branch name.

## Fast path: branch_sync

With the preconditions clean, one tool call does the fetch, the stack
check, the rebase, and the push, and says why when it will not. Note the
head with `git -C <worktree> log -1 --oneline`, then call the
`branch_sync` tool with `tree` = the worktree's absolute path.

The result decides, and nothing else does:

| result | carries | next |
|---|---|---|
| `status: "synced"` | `divergedFromOrigin` (true when local and origin had diverged before the sync) | Synced: `branch_sync` rebased and pushed with force-with-lease, or found the branch current and pushed nothing. Report the move as in **After a clean rebase**; the push already happened, so no push gate. |
| `status: "conflict"` | rt sync's bundle (`unresolvedFiles`, `backupBranch`, `state: mid-rebase`) | The rebase is paused in the worktree. Go to **On conflict** with `unresolvedFiles` as the files. |
| error `rt sync refused (exit 4): could not determine the default branch ...` or `rt sync refused (exit 4): could not list open MRs to rule out a stack: ...` | error text only | The stack could not be verified either way. Run **Manual path** from its Stack guards; if those fail for the same reason, stop and report both failures. Never rebase an unverified branch. | <!-- mcp-lint: allow -->
| any other `rt sync refused (exit 4): ...` error: a stack refusal, whose text ends `Run: <tool>` (e.g. `<branch> is a member of stack <name> (parent <parent>); rebasing it alone onto <default> would break the stack. Run: <tool>`) | error text only | REFUSE: report the error text and name the tool after `Run:`. The run ends here; the restack belongs to the stack tool. | <!-- mcp-lint: allow -->
| error `rt sync timed out after ...`, `could not start rt sync`, or `rt sync refused (exit N): ...` with N other than 4 | error text only | rt sync itself failed. Report it, then **Manual path**. | <!-- mcp-lint: allow -->
| any other error: `branch_sync` refused before rt sync ran (`refusing to sync <branch>: ...`, `refusing to reset <branch> to origin: ...`, `origin/<branch> has commits this tree lacks; ...`, `a rebase is in progress; ...`, or a git read that failed) | error text only | Report the error text and stop. The manual path's force-with-lease push would not protect what the tool refused over. When the text ends `run git_pull first`, name the `git_pull` tool as the next step. |

| Thought | Reality |
|---|---|
| "The stack refusal came back, but I can see the MR targets the default branch, so I'll rebase by hand" | A stack refusal is the guard's verdict, not a hint. Only the two could-not-run texts open the manual path, and only through its own guards. |
| "`status: "synced"`, so now the push gate" | `branch_sync` already pushed; that is the fast path's contract. A push form for a push that happened is a false choice. Report it as pushed. |
| "The check could not run, so the safe move is to stop and ask" | The manual guards are the same check by other means. Run them; stop only when they fail too. |
| "It only said `refusing to sync`; the manual path will get it done" | A preflight refusal is a safety verdict on this tree. Report it and stop; the manual path is only for the rows that send there. |

## Manual path

For a `branch_sync` error saying the stack check could not run, or rt
sync's own failure (the two rows that send here): both guards, then the
rebase, then the gates below.

## Stack guards

Both checks run before any fetch or rebase; either one refusing ends the
run. A single-branch rebase is legal only when the branch is stack-free
in both directions. On GitLab both checks read one `mr_list` result:
`repoName` = the worktree's absolute path, `maxAgeMs` 5000 so the read is
live (`mr_for_branch` takes no `maxAgeMs`, so it is not used here).

- **Child check:** look up the branch's open MR or PR (GitLab: the row
  whose `sourceBranch` is this branch, then its `targetBranch`; GitHub:
  `gh pr view <branch>`). Targets anything other than the default branch:
  REFUSE, naming the target. A stacked branch rebases onto
  `origin/<target>` if it rebases at all; moving it onto the default
  branch destroys the stack.
- **Parent check:** list open MRs or PRs targeting this branch (GitLab:
  the rows whose `targetBranch` is this branch; GitHub: `gh pr list
  --base <branch>`). Any hit: REFUSE, naming the dependents. Rewriting a
  parent's history strands every child on commits that no longer exist.

A `mr_list` error, a `syncError`, or `syncedAt` 0 means the guards could
not run: stop and report it, never read it as stack-free. When the
result's `scope` limits the cache to certain authors or a time window,
say the verdict covers only that scope, and carry "stack check covered
<scope> only" on the old head -> new head line (**After a clean rebase**)
so it reaches whoever gates the push.

Either refusal is a restack signal: the chain moves together or not at
all. Say so and point at the stack tool (`gitq:sync` where available);
never improvise a multi-branch rebase here.

| Thought | Reality |
|---|---|
| "The pipeline needs the default branch's fix" | A stacked MR reaches the default branch through its stack root. Rebasing it there directly destroys the stack. |
| "Just this parent; the children catch up later" | The moment the parent rewrites, every child points at history that no longer exists. |
| "No open MR in either direction" | On a synced read (no `syncError`, `syncedAt` not 0), the branch is stack-free within the read's `scope`: proceed, naming any scope limit. |

## Rebase

Show what's about to replay, not just what replayed:

```
git -C <worktree> fetch origin
git -C <worktree> log --oneline origin/<default>..HEAD
```

Then call the `git_rebase` tool with `tree` = the worktree's absolute
path and `onto` = `origin/<default>`. A `status: "conflict"` result goes
to **On conflict**. Any other `git_rebase` error: report it and stop; the
tree may be mid-rebase, and aborting is not this path's call unasked.

## On conflict: gate `conflict`

If the rebase reports a conflict (`status: "conflict"` from `branch_sync`
or `git_rebase`), stop immediately. One sentence listing the conflicted
files (the bundle's `unresolvedFiles`, the files `git_rebase` returned,
or the `UU` and similar rows of `git -C <worktree> status --porcelain`).
When a caller is composing this as a per-branch step, hand back to it
with that sentence; it owns the sweep's gates. Otherwise the gate:

- When this conversation holds a run's `runDb`: the `run_field_set` tool with that `runDb`, `key` `gate`, `value` `conflict:rebase-worktree:<attempt>`, `stage` `<run.current_stage>`.
- When this conversation holds a run's `runDb`, run gate-protocol's Runs
  integration with kind `conflict:rebase-worktree:<attempt>` and these
  questions, each its own question (never fold one list into another --
  a question over 4 options sends the whole gate to the wait queue):
  - `conflict`: **Leave the rebase in progress for me** (recommended) /
    **Abort the rebase** (the `git_rebase` tool with `tree` = the
    worktree's absolute path and `abort: true`)
  - `next`: **Proceed** (recommended) / **Iterate here** / **Hold**

{{include:spawned-no-run-guard}}

- When this conversation holds a run's `runDb`: the `run_decision` tool with that `runDb`, `contract` `gate@1`, `scope` `conflict:rebase-worktree:<attempt>`, `selection` `{"next":"leave|abort|iterate|hold","note":"<their words or null>"}`, `decidedBy` `<the answer's by>`.

Never resolve the conflict yourself, `git add` the files, or run `git
rebase --continue` or `git rebase --skip`; abort only on that answer.

## After a clean rebase

Report the move as old head -> new head: note the branch's
`git -C <worktree> log -1 --oneline` before the fetch, then run the same
command again once the rebase finishes, and show both.

When old head equals new head, the branch was already current: the line
ends "already current; nothing pushed", there is no push gate on either
path, and this section is finished.

Otherwise, on the fast path the line ends with "pushed by branch_sync":
the push is done, and this section is finished. When a caller is composing this as a
per-branch step, hand that line back; it has nothing to gate for this
branch.

On the manual path pushing is a separate decision, gate `push`. When a
caller is composing this as a per-branch step, hand back the old head ->
new head line (with any stack-check scope caveat) and let it gate the
batch. Otherwise:

- When this conversation holds a run's `runDb`: the `run_field_set` tool with that `runDb`, `key` `gate`, `value` `push`, `stage` `<run.current_stage>`.
- The sentence is the old head -> new head line above; nothing else
  before the form.
- When this conversation holds a run's `runDb`, run gate-protocol's Runs
  integration with kind `push` and these questions, each its own question
  (never fold one list into another -- a question over 4 options sends
  the whole gate to the wait queue):
  - `push`: **Push with force-with-lease now** / **Leave it unpushed**
    (recommended when the branch has an open MR others may have pulled)
  - `next`: **Proceed** / **Iterate here** / **Hold**

{{include:spawned-no-run-guard}}

- When this conversation holds a run's `runDb`: the `run_decision` tool with that `runDb`, `contract` `gate@1`, `scope` `push`, `selection` `{"push":true|false,"next":"proceed|iterate|hold","note":"<their words or null>"}`, `decidedBy` `<the answer's by>`.

On **Push with force-with-lease now**, call the `git_push` tool with
`tree` = the worktree's absolute path and `forceWithLease: true`. A
`git_push` error: report it; the rebase stands unpushed. Never push
unasked.

**These thoughts mean you are skipping the gate -- STOP:**

| Thought | Reality |
|---------|---------|
| "Push with force-with-lease now is the natural next action, so I'll mark it Recommended" | Only **Leave it unpushed** carries a recommended label, and only conditionally (an open MR others may have pulled). Render that qualifier attached to that option exactly; never move it to the push option. |
| "Restating the finding and explaining each option makes the ask clearer" | A gate's form is one sentence of context, then the bare option labels the gate text names, nothing more -- no restated heading, no per-option description, no conditional aside on when Hold applies. |

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}
