---
node: any_unresolved
---

# Any unresolved human threads?

Answer from the filtered read after one more drop. On GitHub, drop two
kinds of PR-level row (`gh-issue-comment-<n>` or `gh-review-<n>`): a row
whose note is by the account this run posts as is out of scope, never
adjudicated or replied to; and a row that a later PR-level comment by
this account answers is already answered: that comment's marker line
(per the PR-level reply shape) names the row's id. Look for that comment
in one more read, `mr_threads {mrUrl, refresh: true}` with no filter: the
filter drops a comment whose author reads as a bot, so a reply posted by
a bot-named account is missing from the filtered read. Only the filtered
rows are ever adjudicated. Rows dropped this way count
as no thread. With nothing left the answer is none: say so. Otherwise
the adjudicator gets the rows that remain.
