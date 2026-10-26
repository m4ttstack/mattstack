---
---

# Reading a GitLab fact no read tool returns

At any step, read it with `gitlab_get {mrUrl: <mr>, path}`, `path`
relative to the API root with `:id` for this project
(`projects/:id/jobs/<jobId>`), as part of the step, not off-script. Quote a GitLab error as written; its refusal of a
credential path is final.
