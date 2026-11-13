# GREEN M1: pass (one mr_map call; #12 paired, #15 NONE; no gh, no git worktree list)

Ordered calls

1. mr_map {repoName: "/work/acme", author: "me"}

Result handling: two rows, complete: true, no forge error. Map each row to the five-column table (ref, title, author, sourceBranch, worktree; null worktree = NONE). No truncation notice is needed. No other calls (no git, gh or worktree commands): the single mr_map call already joins worktrees.

Step 2 (Emit), then stop.

Final report

| MR or PR ref | title | author | source branch | worktree path or NONE |
|--------------|-------|--------|----------------|------------------------|
| #12 | Add feature A | me | feat-a | /work/acme-feat-a |
| #15 | Add feature B | me | feat-b | NONE |

#12 is paired with a local worktree; #15 has no local worktree (NONE).
