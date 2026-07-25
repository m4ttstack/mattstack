---
name: gitq:absorb
description: >-
  Distribute uncommitted worktree changes across the gitq stack branches
  whose commits own those files, then restack. Launched by the gitq board
  as "/gitq:absorb <repoPath> <stackName> --state <path> --status-bin
  <path>", or invoked by hand without those flags. Previews and
  sanity-checks the attribution before committing anything.
---

# gitq absorb runner

Take the dirty worktree and fold each change into the stack branch whose
commits already touch that file, then rebase the stack so every branch sees
the update. gitq computes the attribution and does the commits; you judge
whether the attribution is right.

| flag | meaning |
|------|---------|
| `<repoPath>` (positional) | absolute path of the repo checkout |
| `<stackName>` (positional) | the tracked stack to absorb into |
| `--state <path>` | lifecycle status file the board polls (optional) |
| `--status-bin <path>` | absolute path to the board's status-writer CLI (optional) |

The `<repoPath>` positional may be ANY worktree of the repo, not just the
primary checkout: the board passes the dirty worktree you picked in its
absorb menu, and absorb sources the uncommitted changes from that
directory. Run every command below against the given `<repoPath>` as is.

**Status writes.** When `--state` and `--status-bin` were given, write status
only by running the injected bin:

```
bun run <status-bin> <state> <status> [detail]
```

with status one of `working | conflict | done | error` (the board writes
`starting` at spawn). When the flags are absent, skip every status write and
just talk to the human; everything else below is unchanged.

## Steps

1. **Mark working.** `bun run <status-bin> <state> working "absorbing into <stackName>"`
2. **Preview.** `gitq -C <repoPath> absorb --stack <stackName> --preview --json`
   - Nothing to absorb: mark done with "nothing to absorb" and stop.
   - Read the attribution: which file goes to which branch, and which files
     the engine could not attribute (those stay in the worktree; note them
     for the report).
   - Sanity-check it. Does each file land on the branch whose work it
     belongs to? If an attribution looks wrong (a file headed to a branch
     that has nothing to do with it), stop and ask the human instead of
     committing to the wrong branch. Trust the engine on clean, boring
     mappings; escalate on surprising ones.
3. **Apply.** `gitq -C <repoPath> absorb --stack <stackName> --json`
   - **exit 0**: go to step 5.
   - **exit 1 telling you to run `gitq sync`**: the changes were committed
     to their branches, but the restack hit a conflict and absorb backed the
     rebase out. Finish the job with the sync protocol in step 4.
   - **any other exit 1**: mark error with the reason (the `gitq:` stderr
     line, or the entries with `success: false` in the JSON) and report.
4. **Restack via sync (only if step 3 asked for it).**
   `gitq -C <repoPath> sync --stack <stackName> --json`
   - **exit 2**: paused on a conflict. Mark conflict with the `pauseInfo`
     detail ("<n> conflicts on <branch> (commit <i>/<total>)"), then resolve
     exactly as a rebase conflict should be. The paused rebase lives in the
     worktree named by `pauseInfo.worktreePath` (a gitq work slot), or
     `pauseInfo.treePath` for older pauses; fall back to `<repoPath>` only
     when both are absent. Call that directory `<rebaseDir>`. Read each file
     in `pauseInfo.conflictFiles`, understand both sides (`git -C
     <rebaseDir> log --oneline --merge` plus the surrounding code), edit to
     the content that preserves both intents, `git -C <rebaseDir> add` the
     results, and run `gitq -C <repoPath> continue --json`. Repeat while it
     exits 2. Never run `git rebase --continue` yourself; `gitq continue`
     also keeps the stack bookkeeping right. If a conflict needs judgment
     you cannot supply, `gitq -C <repoPath> abort`, mark error saying which
     file and why, and stop.
   - **exit 0**: restack finished; go to step 5.
   - **exit 1**: mark error with the reason and report.
5. **Mark done.**
   `bun run <status-bin> <state> done "absorbed <n> files into <m> branches"`
   Then report to the human: what landed where (file to branch), what stayed
   in the worktree unattributed, and any conflicts you resolved on the
   restack.

## Rules

- Never invent an attribution. gitq's preview is the mapping; your job is to
  veto surprising rows, not to redirect files by hand. Redirecting a change
  to a different branch is gitq:restructure territory (or a human decision).
- Never `git rebase --continue`, `--abort`, or `--skip` while gitq owns the
  cascade; only `gitq continue` / `gitq abort`.
- Always end with a terminal `done` or `error` status write (when the status
  flags were given).
- If `gitq` is not on PATH, stop and tell the human to run `bun link` in the
  gitq checkout.
