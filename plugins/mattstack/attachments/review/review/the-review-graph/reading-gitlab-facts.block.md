---
---

# Reading a GitLab fact no read tool returns

A GitLab fact no read tool returns (the MR's commits, a
referenced issue, another MR's state) is `gitlab_get {mrUrl, path}` once
the review target is an MR, else `gitlab_get {repoName, path}` with
`repoName` the checkout path; `path` is relative to the API root, `:id`
this project (`projects/:id/merge_requests/<iid>/commits`), and a filter
goes in `query` (`{search: <ticket id>}`), never in `path`. It opens no gate.
Quote a GitLab error as written; a refused credential path is final.
