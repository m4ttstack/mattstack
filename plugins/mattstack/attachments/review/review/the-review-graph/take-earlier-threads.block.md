---
node: take_earlier_threads
---

# Take the earlier threads the caller handed in

A re-review judges the earlier threads first, then what is new. The caller
hands in the threads (each with `discussionId`, anchor, `round`, the
reviewer's first note and the author's replies), the last reviewed commit
and the round number, or the rule that picks the threads and their
`round`: then read `mr_threads {mrUrl, refresh: true}` and keep exactly
what it picks (an error answers no at `Earlier threads in hand?`). With
none, it is a full review framed as a re-review, `threads` empty.

The skipped list comes too, each `{id, round, title, severity, file,
line, excerpt, snippet}` with the sha of the round that skipped it: every
one comes back under the json's `skipped`, never raised again, since an
issue a skipped finding already says is not new.

This step judges nothing. Each thread's call (one of the structured
findings file's four, with a one-line note and a reply in the writing
style) and the new issues form in the fresh reviewer, weighting `git diff
<last reviewed sha>..HEAD` over the whole change, `HEAD` the MR head
(`origin/mr-<iid>`, or `origin/pr-<n>`, with no MR-head checkout in hand).
A missing, `unknown` or unfetched last reviewed commit makes the whole
change what changed.
