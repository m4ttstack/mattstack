---
node: keep_unresolved_human
label: Keep human threads
---

# Keep only unresolved human threads (GitHub)

On GitLab the `mr_threads` filter applies this rule: its result is the set to adjudicate, never filtered again, no
dropped thread added back. On GitHub apply it by hand: keep only
**unresolved** threads a **person** opened, dropping resolved threads,
system notes and bot authors (a username that starts `project_<n>_bot` or
`group_<n>_bot`, is `ghost`, or ends in `-bot`, `_bot` or `[bot]`).
Capture each thread's id, `file:line` and full note chain.

## Reading a GitLab fact no read tool returns

A GitLab fact the read tools do not return is read with `gitlab_get
{mrUrl, path}`: `mrUrl` = the MR's URL this verb recorded as `mr`, `path`
relative to the API root with `:id` for this project (for example
`projects/:id/merge_requests/<iid>/versions`). It opens no gate. Quote a
GitLab error as written; its refusal of a credential path is final.
