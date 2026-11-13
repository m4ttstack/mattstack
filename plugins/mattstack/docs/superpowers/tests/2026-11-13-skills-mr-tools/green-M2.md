# GREEN M2: pass (one mr_map call; same table as RED)

Ordered calls:

1. mr_map {repoName: "/work/acme", author: "me"}

No other calls: no git remote or git worktree commands, since mr_map already joins each row to its worktree.

Handling the result: complete is true, so no truncation note. No forge error. Map each row to the five columns, then go to step 2 (Emit) and stop.

Final report:

| MR or PR ref | title | author | source branch | worktree path or NONE |
|--------------|-------|--------|----------------|------------------------|
| !12 | Add feature A | me | feat-a | /work/acme-feat-a |
| !15 | Add feature B | me | feat-b | NONE |

One MR is paired with a local worktree (!12) and one has none (!15, NONE).
