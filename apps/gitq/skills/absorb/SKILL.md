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
the update. A file no branch's commits own is left alone, still uncommitted
in the worktree. gitq computes the attribution and does the commits; you
judge whether the attribution is right.

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
   - Read `result`: `attributed` maps each branch to the files it owns,
     `unattributed` lists the files absorb will leave in the worktree, and
     `unapplied` (a subset of `unattributed`) lists files whose edit does not
     replay onto the branch it was headed for. Absorb commits the attributed
     files and nothing else; the rest are left in the worktree, uncommitted,
     exactly as you found them.
   - Attribution goes by the lines the edit is on, not just by which branch
     touched the file, so a fix to an ancestor's lines lands on the ancestor
     even when a later branch edited elsewhere in the same file.
   - `unapplied` non-empty means the human overruled attribution with `--at`
     and the edit will not merge onto that branch. Name those files and stop:
     the fix is a different `--at` target, or splitting the edit. Do not
     re-run without `--at` hoping it lands somewhere.
   - Both empty: mark done with "nothing to absorb" and stop.
   - **Tell the human the unattributed files before you apply**, by name.
     Applying will not touch them, but this is the moment they can act on
     the fact. A file they expected to be absorbed showing up here usually
     means no branch's commits touch it yet (new file, or the wrong branch
     is doing that work). If any unattributed file looks like it should
     have been attributed, stop and ask rather than applying. Do not save
     this for the step 5 report.
   - `attributed` empty but `unattributed` not: applying would commit
     nothing (`nothing absorbed (nothing-attributable)`, exit 0). Say that
     instead of running it, mark done, and stop.
   - Sanity-check the mapping. Does each file land on the branch whose work
     it belongs to? If an attribution looks wrong (a file headed to a branch
     that has nothing to do with it), stop and ask the human instead of
     committing to the wrong branch. Trust the engine on clean, boring
     mappings; escalate on surprising ones.
   - When the human already knows where a fix belongs (usually because a
     branch's pipeline is red on exactly that line), `--at <branch>` sends
     everything there instead. Only pass it when they asked for that branch;
     never pick a target yourself to make an attribution look tidier.
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
   Then report to the human: what landed where (file to branch), which files
   are still dirty in the worktree, and any conflicts you resolved on the
   restack. The dirty set is the `unattributed` list you already read in step
   2 — the restack-conflict route in step 3 exits 1 before printing a result
   document, so there is no `result.unattributed` from the apply run to read
   on that path.

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
