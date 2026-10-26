---
node: resolve_target
---

# Resolve the review target

From the conversation (an MR/PR URL, `!iid` or `#number`, a ticket id, or
a branch name), or on a resume in a new session the snapshot's `mr`.
`mr_view` takes `mrUrl`, else `repoName` (the checkout path) plus `iid`,
and resolves any MR your token can see, by anyone, in any state. Quote a
read error, never paraphrase it (usually GitLab's 404 or 403; or rt's:
target not resolved, daemon unreachable, timeout), and hold with it
(`decidedBy: "pane"`). A null `mr_for_branch` entry means no open MR, not
none: `mr_list` by `sourceBranch` sees every state.
