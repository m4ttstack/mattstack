---
order: 2
---

# Reading a GitLab fact no read tool returns

At any step of this checkout, a GitLab fact the read tools do not return
is read with `gitlab_get {repoName, path, query}`: `repoName` = the
current checkout's absolute path, `path` relative to the API root with
`:id` for this project, `query` the filters, for example `path`
`projects/:id/repository/branches` with `query` `{search: <ticket id>}`
(a ticket with a branch but no MR). The read is part of the step that
needs it, not an off-script move, so it opens no gate. A GitLab error is
quoted as GitLab wrote it. Its refusal of a credential path is final.
