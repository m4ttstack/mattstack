---
name: gitq:restructure
description: >-
  Reshape a gitq stack from a plain-language instruction: split a branch,
  fold one into its parent, reparent a subtree, rename, or reset. Launched
  by the gitq board as "/gitq:restructure <repoPath> <stackName>
  [instruction] --state <path> --status-bin <path>", or invoked by hand.
  Maps the instruction to gitq surgery commands, gates on the plan, and
  resolves any rebase conflicts the surgery causes.
---

# gitq restructure runner

Turn "move the api branch onto main" or "split the ui work out of
feature-x" into concrete gitq surgery, get the human's yes, and execute.
gitq does the git surgery; you do the mapping from intent to operations and
any conflict resolution along the way.

| flag | meaning |
|------|---------|
| `<repoPath>` (positional) | absolute path of the repo checkout |
| `<stackName>` (positional) | the tracked stack to reshape |
| `[instruction]` (positional, optional) | what the human wants, in their words |
| `--state <path>` | lifecycle status file the board polls (optional) |
| `--status-bin <path>` | absolute path to the gitq executable, called as `<status-bin> job-status` (optional) |

**Status writes.** When `--state` and `--status-bin` were given, write status
only by running the injected bin:

```
<status-bin> job-status <state> <status> [detail]
```

with status one of `working | conflict | done | error` (the board writes
`starting` at spawn). When the flags are absent, skip every status write and
just talk to the human; everything else below is unchanged.

## Steps

1. **Get the intent.** Use the instruction positional. If it is missing or
   too vague to act on ("clean this up"), ask the human what they want
   before touching anything.
2. **Mark working.** `<status-bin> job-status <state> working "planning restructure"`
3. **Map intent to operations.** Learn the current shape from
   `gitq -C <repoPath> stacks --json` and `gitq -C <repoPath> diagnose
   --json` (no `--stack` flag on diagnose; find your stack by `stackName`),
   plus `git -C <repoPath> log --oneline <parent>..<branch>` on the branches
   involved. Surgery never moves the launch worktree's checkout: split, fold,
   and reparent do their git work in a gitq-owned work slot (or as pure ref
   surgery) and refuse cleanly when a branch sits dirty in some worktree.
   Then choose from the surgery set:
   - `gitq -C <repoPath> split <branch> --at <sha> --name <newBranch>`
     (tail split: everything from `<sha>` onward moves to a new child)
   - `gitq -C <repoPath> split <branch> --files <glob[,glob...]> --name <newBranch>`
     (file split: matching files move to a new branch)
   - `gitq -C <repoPath> fold <branch>` (fold into parent, delete, reparent
     its children onto the parent)
   - `gitq -C <repoPath> reparent <branch> --onto <newParent>`
   - `gitq -C <repoPath> rename <old> <new>`
   - `gitq -C <repoPath> reset <branch>` (match `origin/<branch>` again)
   A sequence of operations is fine; order it so each step sees the tree
   state it expects. Add `--stack <stackName>` to any of these when the repo
   tracks more than one stack.
4. **Gate.** Present the plan to the human: each operation in order, what it
   does to the tree, and the caveats that matter here: of these
   operations, only `reparent` can be undone by `gitq undo`; `split`,
   `fold`, and `rename` are one-way, and `reset` is not recorded in the
   operation log at all, so treat every approved operation as effectively
   irreversible. Wait for approval. If the human never answers, leave the
   pane holding: nothing executed, no `done` write.
5. **Execute.** Run the approved operations one at a time, each with
   `--json`, checking the result before the next.
   - `reparent` has two conflict shapes. If the branch itself cannot be
     replayed onto the new parent, gitq refuses upfront with exit 1 and
     nothing is moved: report that the stack needs a sync first. If a
     DESCENDANT hits a conflict during the follow-up cascade, gitq exits 2
     exactly like sync: mark conflict with the `pauseInfo` detail, resolve
     each file in `pauseInfo.worktreePath` (fall back to
     `pauseInfo.treePath`, then `<repoPath>`), `git -C <that dir> add` the
     results, then `gitq -C <repoPath> continue --json`, repeating while it
     exits 2. Never raw `git rebase --continue`; if a conflict needs
     judgment you cannot supply, `gitq -C <repoPath> abort`, mark error, and
     report which operations did and did not run.
   - Any exit 1: stop the sequence, mark error with the reason, and report
     what was applied and what was not (applied operations stay applied;
     only a `reparent` can be walked back with `gitq undo`).
6. **Verify and mark done.** `gitq -C <repoPath> diagnose --json` once more
   to confirm the stack is healthy, then
   `<status-bin> job-status <state> done "<summary>"` with a summary like
   "split feature-x at abc1234 into feature-x-ui, reparented api onto main".
   Report the new tree shape to the human.

## Rules

- No surgery before the human approves the plan at the gate, ever. This is
  the judgment-heaviest gitq skill; the gate is the point.
- Refuse to guess on ambiguity. Two plausible readings of the instruction
  means a question, not a coin flip.
- Never `git rebase --continue`, `--abort`, or `--skip` while gitq owns the
  cascade; only `gitq continue` / `gitq abort`.
- Always end with a terminal `done` or `error` status write (when the status
  flags were given), except when parked at the gate waiting on a human.
- If `gitq` is not on PATH, stop and tell the human to run `bun link` in the
  gitq checkout.
