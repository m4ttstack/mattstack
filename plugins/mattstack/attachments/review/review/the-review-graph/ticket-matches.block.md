---
node: ticket_matches
---

# mr_list matches for the ticket?

Keep the returned rows whose `sourceBranch` or `title` carries the id.
`truncated` first, as for the branch. Exactly one kept row goes to
`mr_view`; none is the clarify gate with no options, saying no returned
row carries the ticket (not that no MR exists), their typed text the
answer; several is the clarify gate, one option per row (iid, title,
state). An error is quoted in the gate's sentence, never read as none.
Never a guess.

## Reading a GitLab fact no read tool returns

A GitLab fact no read tool returns (the MR's commits, a
referenced issue, another MR's state) is `gitlab_get {mrUrl, path}` once
the review target is an MR, else `gitlab_get {repoName, path}` with
`repoName` the checkout path; `path` is relative to the API root, `:id`
this project (`projects/:id/merge_requests/<iid>/commits`), and a filter
goes in `query` (`{search: <ticket id>}`), never in `path`. It opens no gate.
Quote a GitLab error as written; a refused credential path is final.
