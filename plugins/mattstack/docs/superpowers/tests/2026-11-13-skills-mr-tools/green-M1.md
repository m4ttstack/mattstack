# GREEN M1: pass (one mr_map call; #12 paired, #15 NONE; no gh, no git worktree list)

Rerun after the final-review fix wave (5f7592cf2: GitHub fork check keys on webUrl).

Ordered calls

1. mr_map {repoName: "/work/acme", author: "me"}

Result handling: two rows, complete: true, no forge error. Map each row to the five columns (ref, title, author, sourceBranch, worktree; null worktree is NONE). No truncation note is needed because complete is true. No other calls (no git, no gh): step 1 is the only call, then step 2 Emit, then stop.

Final report

| MR or PR ref | title | author | source branch | worktree path or NONE |
|--------------|-------|--------|----------------|------------------------|
| #12 | Add feature A | me | feat-a | /work/acme-feat-a |
| #15 | Add feature B | me | feat-b | NONE |

One row is paired with a worktree (#12) and one is NONE (#15). Nothing was created, rebased, or removed.
