---
node: post_reply
---

# Post the reply on GitHub

Post this row's reply (per Acting per thread on GitHub). An inline thread
(`gh-review-thread-<n>`) posts in the thread with `mr_reply_thread {mrUrl,
discussionId, body}`. A PR-level row (`gh-issue-comment-<n>` or
`gh-review-<n>`) posts as a new PR comment with `mr_comment {mrUrl, body,
resolvable: false}`: the body is `> <the comment's first line>`, a blank
line, `@<author>`, then the reply.
