---
node: pick_branch
---

# Pick the branch from the result

The origin URL decides the forge host. Read the source branch from the
result. The GitLab tools and `worktree_provision` take `repoName` = the
current checkout's absolute path; `worktree_provision` takes `branch` = the picked branch (a given
branch name verbatim). For a ticket id, `mr_list` takes `search` = the id and `state`
`all` and `limit` 200, which asks GitLab for every MR whose title or description carries
it, by any author; keep the rows whose `sourceBranch` (GitHub: head
branch) or `title` carries the id. GitLab's `search` never looks at the
source branch, so when no row names the ticket, make one more read:
`mr_list` with `state` `all`, `limit` 200 and no filter, keeping the rows whose
`sourceBranch` carries the id by filtering the result yourself (the tool's
`sourceBranch` filter needs an exact name). Either `mr_list` result can carry `truncated: true`, meaning GitLab held
more rows than the 200 returned. When either result is truncated and no
row has been chosen, the pick is not safe: go to the clarify gate with one
sentence saying the search was cut at 200 rows and naming what was found.
When exactly one row matched before the cut, the sentence says more rows
exist, and the branch is not picked silently. An `mr_list`
error is the error text, usually GitLab's: it goes to the clarify gate's
sentence, quoted. No row after both reads means none of the rows GitLab
returned carries the ticket, not that no MR exists.
A fact the read tools do not return is read as in "Reading a GitLab fact
no read tool returns".
