---
---

# Reading a GitLab fact no read tool returns

At any step, read it with `gitlab_get {repoName: <root>, path}`, `path`
relative to the API root with `:id` for this project
(`projects/:id/merge_requests/<iid>/approvals`). The read is part of the
step and opens no gate. Quote a GitLab error as written; its refusal of a
credential path is final.
