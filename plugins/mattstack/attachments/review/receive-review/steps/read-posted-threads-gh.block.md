---
node: read_posted_threads_gh
label: Read posted threads
---

# Posted already on GitHub: read every thread with mr_threads

Read every thread's full note chain with `mr_threads {mrUrl, refresh:
true}`, fresh, every time the graph reaches this box; the earlier thread
read never stands in for it. A thread that carries this run's reply (a
note whose text is the reply due, or any note by the account this run
posts as dated after the run's `started_at`) is posted: it never posts
again. A PR-level row (`gh-issue-comment-<n>` or `gh-review-<n>`) is
posted when a `gh-issue-comment` entry by this account dated after the
run's `started_at` carries the reply text. With no result (an error, or a
thread whose notes did not come back), nothing posts: set `hold` to
`held`, report the error verbatim, and leave the run open.
