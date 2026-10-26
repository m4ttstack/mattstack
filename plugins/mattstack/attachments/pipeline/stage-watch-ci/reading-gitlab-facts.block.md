---
order: 3
---

# Reading a GitLab fact no read tool returns

At any step, read it with `gitlab_get {mrUrl: <mr>, path}` (`path` from the API root,
`:id` for this project: `projects/:id/jobs/<jobId>`), part of the step, not
off-script.
Quote a GitLab error as written; a refused credential path is final.
