# RED M2: GitLab walk recorded (one mr_map call)

Ordered calls

1. mr_map tool (mcp__plugin_mattstack_mattstack__mr_map) with {repoName: "/work/acme", author: "me"}
   Result: 2 rows, complete: true. Step 1 (GitLab) handles it, so I skip steps 2 and 3 (no gh pr list, no rt_verb worktree list, no git worktree list). The scenario's origin URL is gitlab.com, so GitLab is the forge and I make no other call.
   Use of result: map each row to the five columns (ref, title, author, sourceBranch, worktree). A null worktree becomes NONE. complete is true, so I add no "cut at 200" note. Go to step 4.

2. Emit (step 4): no further calls, then stop.

Final report

| MR ref | title | author | source branch | worktree path or NONE |
|--------|-------|--------|----------------|------------------------|
| !12 | Add feature A | me | feat-a | /work/acme-feat-a |
| !15 | Add feature B | me | feat-b | NONE |

One paired row (!12) and one NONE row (!15, never checked out locally or already cleaned up). Nothing was created, rebased or removed.
