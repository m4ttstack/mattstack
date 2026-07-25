---
name: gitq:sync
description: >-
  Rebase a tracked gitq stack so every branch sits on its parent's latest
  head, resolving rebase conflicts with judgment as they come up. Launched
  by the gitq board in a herdr pane as "/gitq:sync <repoPath> <stackName>
  --state <path> --status-bin <path>", or invoked by hand without the
  --state/--status-bin flags. Uses the gitq CLI for the mechanics; owns
  conflict resolution.
---

# gitq sync runner

Rebase every branch of one tracked stack onto its parent's new head, and
resolve any conflicts along the way. The mechanical work belongs to the
`gitq` CLI; the judgment (what a conflicted file should look like after the
merge) belongs to you.

| flag | meaning |
|------|---------|
| `<repoPath>` (positional) | absolute path of the repo checkout |
| `<stackName>` (positional) | the tracked stack to sync |
| `--state <path>` | lifecycle status file the board polls (optional) |
| `--status-bin <path>` | absolute path to the board's status-writer CLI (optional) |

**Status writes.** When `--state` and `--status-bin` were given, write status
only by running the injected bin:

```
bun run <status-bin> <state> <status> [detail]
```

with status one of `working | conflict | done | error` (the board writes
`starting` when it spawns the pane). When the flags are absent (manual
invocation), skip every status write and just talk to the human; everything
else below is unchanged.

## Steps

1. **Mark working.** `bun run <status-bin> <state> working "syncing <stackName>"`
2. **Preflight.** `gitq -C <repoPath> preflight --json` (no `--stack` flag;
   it reports every tracked stack). Find your stack's entry by `stackName`
   in the JSON's `stacks` array.
   - A dirty worktree blocks sync. Stop here: mark error with
     "worktree has uncommitted changes" and tell the human to commit or
     stash first (or run gitq:absorb, which exists for exactly this). Do
     not stash or commit on your own.
   - Predicted conflicts are information, not blockers. Note how many and
     carry on.
3. **Sync.** `gitq -C <repoPath> sync --stack <stackName> --json`. Three
   outcomes:
   - **exit 0**: parse the per-branch results, then go to step 6.
   - **exit 2**: paused on a conflict; go to step 4.
   - **exit 1**: a hard failure prints a `gitq:` line on stderr with nothing
     on stdout; a per-branch failure emits the normal JSON first, and the
     failing entry's `success: false` says what broke. Either way mark error
     with the reason and report to the human.
4. **Resolve the conflict.** The repo is mid-rebase, exactly as if
   `git rebase` had stopped by hand. The JSON's `pauseInfo` tells you where
   you are: the branch, `commitIndex`/`commitTotal`, `conflictFiles`
   (always present), and `conflictTypes` (when present, per-file two-letter
   porcelain codes: `UU` both modified, `AA` both added, `DU`/`UD` deleted
   on one side).
   - Mark conflict:
     `bun run <status-bin> <state> conflict "<n> conflicts on <branch> (commit <i>/<total>)"`
   - Understand before editing. Read each conflicted file's markers, and get
     both sides' intent from `git -C <repoPath> log --oneline --merge` and
     the surrounding code. Then edit each file to the content that preserves
     both intents. Never resolve by wholesale picking ours or theirs without
     reading, and never strip conflict markers mechanically.
   - `DU`/`UD` files were deleted on one side. Decide deliberately, then
     `git -C <repoPath> add <file>` to keep it or
     `git -C <repoPath> rm <file>` to honor the deletion.
   - Stage everything you resolved, then confirm no unmerged paths remain:
     `git -C <repoPath> status --porcelain` must show no `UU`/`AA`/`DU`/`UD`
     lines.
5. **Continue.** `gitq -C <repoPath> continue --json`. Same three outcomes
   as step 3; on exit 2 go back to step 4 for the next conflict. Never run
   `git rebase --continue` yourself: `gitq continue` runs it AND keeps the
   stack bookkeeping right, and raw git leaves gitq's state stale.
6. **Mark done.**
   `bun run <status-bin> <state> done "rebased <n> branches, resolved <m> conflicts"`
   Then give the human a short report: branches rebased, each conflict and
   one line on how you resolved it, anything worth flagging.
7. **When you cannot resolve.** If a conflict needs a call you cannot make
   (both sides rewrote the same logic to different ends and the right merged
   behavior is not inferable from the code), do not guess. Run
   `gitq -C <repoPath> abort` (aborts the rebase and clears the pause), mark
   error with "conflict on <file> needs human judgment: <why>", and lay out
   the two sides for the human in the pane.

## Rules

- Never touch the trunk branch (the branch the stack root sits on). gitq
  never rebases it and neither do you.
- Never `git rebase --continue`, `--abort`, or `--skip` directly while gitq
  owns the cascade; only `gitq continue` / `gitq abort`.
- Always end with a terminal `done` or `error` status write (when the status
  flags were given) so the board badge never gets stuck.
- Sync never pushes. Publishing the rebased stack is gitq:publish's job.
- If `gitq` is not on PATH, stop and tell the human to run `bun link` in the
  gitq checkout.
