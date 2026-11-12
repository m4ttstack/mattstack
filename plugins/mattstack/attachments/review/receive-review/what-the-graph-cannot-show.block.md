---
order: 3
label: Graph notes
---

# What the graph cannot show

**Acting on respond-post.** Never a top-level note, never approve the
change: that stays the developer's, however settled a thread looks. The one
exception is a reply to a GitHub PR-level row (`gh-issue-comment-<n>`,
`gh-review-<n>`): it posts as a new PR comment through `mr_comment`.

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
thread untouched. An inline thread (`gh-review-thread-<n>`) posts with
`mr_reply_thread` and resolves with `mr_resolve_thread`; a PR-level row
(`gh-issue-comment-<n>`, `gh-review-<n>`) posts with `mr_comment`, offers
`post:` alone and is never resolved. A `gate-1: reply` row posts its row's
reply, unresolved. A reply or resolve that errors holds its thread this
pass: the error is quoted verbatim and the run stays open for a resume.
Nothing else posts, through any channel.
