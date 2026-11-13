---
order: 2
---

# Reading a forge fact no read tool returns

At any step of this checkout, a forge fact the read tools do not return is
read with `gitlab_get {repoName, path, query}`: `repoName` = the current
checkout's absolute path, `path` relative to the API root, with `:id` for
this project on GitLab or under `:repo/` on GitHub, and `query` the
filters. On GitLab, for example, `path`
`projects/:id/repository/branches` with `query` `{search: <ticket id>}`
finds a ticket with a branch but no MR. The read is part of the step that
needs it, not an off-script move, so it opens no gate. An error is quoted
as the forge wrote it. Its refusal of a credential path is final.
