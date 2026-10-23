---
order: 3
label: Graph notes
---

# What the graph cannot show

**Acting on respond-post.** Never a top-level note, never approve the
change: that stays the developer's, however settled a thread looks.

**Push before any Fixed reply.** On GitHub, and only when the picks post
or resolve at least one `gate-1: fix` row; otherwise push nothing. Before
acting on those rows, `git branch --show-current` must print the MR's
source branch (the recorded `branch`, else the forge's) and `git
rev-parse --abbrev-ref @{push}` must print `origin/<source branch>`; any
other output, an error included, is a failed push, and never switch
branches to make it match. Then `git_push` with `tree` = this worktree
pushes only the current branch to its same-named upstream. The proceed is
the authorization: ask nothing more.

**Acting per thread on GitHub.** Walk the offered threads, then the
`gate-1: reply` rows; a held resume walks only the held threads, and a
thread held this pass acts on nothing. A `{value, note, text}` answer
unwraps to its `value` (the note never edits the reply); split each value
at the first `:`: `post:<threadId>` posts the answer's `text` when it
carries one, else the `reply@1` context's `text`; `resolve:<threadId>`
resolves, after the reply when both are picked; an empty array leaves the
thread untouched. A `gate-1: reply` row posts its row's reply, unresolved.
Nothing else posts, through any channel.
