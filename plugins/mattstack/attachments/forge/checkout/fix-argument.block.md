---
node: fix_argument
---

# Fix the named argument

Fix only the form of the argument the error names (for example a
`repoName` that is not an absolute path: pass the current checkout's
absolute path; or a malformed branch string), then call
`worktree_provision` once more. Never pick a different branch or repo, and
never start, restart or replace the daemon. A branch the error says does
not exist is not an argument error: like any other error the graph does not
name, it ends at **Provision refused: reported**, quoting the error. A
daemon that is down or a repo rt does not know goes to the off-script gate,
not here.
