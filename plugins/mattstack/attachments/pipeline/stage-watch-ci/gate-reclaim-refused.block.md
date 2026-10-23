---
node: gate_reclaim_refused
---

# Off-script gate: GitHub retry claim refused

The re-claim before `gh run rerun` errored. Take: the human reran the job.

## Reading a GitLab fact no read tool returns

Read it with `gitlab_get {repoName, path}` (`repoName` this worktree,
`path` from the API root, `:id` for this project:
`projects/:id/jobs/<jobId>`), part of the step, not off-script.
Quote a GitLab error as written; a refused credential path is final.
