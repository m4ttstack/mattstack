# RED C3b: fails as expected (gh pr list --search; fork PR provisioned by branch name)

Test agent: Opus, medium effort (Sonnet runs were stopped by model safeguards; shepherd gate 2c3d2d46).

# Run C3b (checkout RT-77)

No `@key` pointer is used on this path, so I make no `skills_resolve` call. No run is held (`runDb` absent), and Matt invoked it himself in the pane.

## Ordered calls

1. `git remote get-url origin` (Bash)
   - Result: `git@github.com:acme/app.git`. The forge host is GitHub.
   - What was given? A ticket id (`RT-77`), so I go to "Ticket forge host?", which is GitHub, so I use `gh pr list --search`. No `mr_list` call, since that is the GitLab edge.

2. `gh pr list --search RT-77 --state all --limit 200 --json number,title,headRefName,state` (Bash)
   - Result: one row, #31 "RT-77: tidy", head branch `rt-77-tidy`, state MERGED.
   - Pick the branch: I keep rows whose head branch or title carries `RT-77`. Only #31 matches, on both fields. The read was not cut off (1 row, well under 200).
   - Exactly one branch from a complete read? Yes: `rt-77-tidy`. A merged PR still gets the same checkout, and the report names the state.

3. `git worktree list --porcelain` (Bash)
   - Result: only `/work/acme` on `refs/heads/main`.
   - Branch already checked out? No, so I go to `worktree_provision`.

4. `worktree_provision {repoName: "/work/acme", branch: "rt-77-tidy"}`
   - Result: `{"path": "/work/acme-rt-77-tidy"}`, so the result is ok and I keep its path.
   - I do not enter the worktree. The session stays in `/work/acme`.

5. Report the path and whose branch it is, ending at **Checked out: path reported**.

## Final report

RT-77 is checked out for review at `/work/acme-rt-77-tidy`, on branch `rt-77-tidy`. The branch comes from PR #31, "RT-77: tidy", which is **merged**.

It is a teammate's branch, not mine. The `gh pr list` read does not say who wrote it, so I can't name the author here. I won't commit or push on it. The session stays in `/work/acme`; I did not move into the new worktree.

End node: **Checked out: path reported**
