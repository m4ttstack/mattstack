# GREEN M2: pass (one mr_map call; same table as RED)

Rerun after the final-review fix wave (5f7592cf2: GitHub fork check keys on webUrl).

## Ordered calls

1. `mr_map {repoName: "/work/acme", author: "me"}` (the mr_map tool; repoName is the current checkout's absolute path).

I make no other call. I do not run `git remote get-url origin` or `git worktree list --porcelain`, because mr_map already joins each row to its worktree.

## What I do with the result

- The result has 2 rows and `complete: true`, so I add no truncation note.
- There is no forge error, so I build the table.
- I map each row to `ref`, `title`, `author`, `sourceBranch` and `worktree`. A null `worktree` becomes `NONE`.
- I go to step 2 (Emit), report both paired and NONE rows plainly, and stop at the end node. I create, rebase and remove nothing.

## Final report

| MR or PR ref | title | author | source branch | worktree path or NONE |
|--------------|-------|--------|----------------|------------------------|
| !12 | Add feature A | me | feat-a | /work/acme-feat-a |
| !15 | Add feature B | me | feat-b | NONE |

!12 is paired with a local worktree. !15 has no local worktree (NONE).
