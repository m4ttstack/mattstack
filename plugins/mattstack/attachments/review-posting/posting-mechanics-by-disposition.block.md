---
order: 5
---

# Posting mechanics by disposition

Comment and Approve execute on both forges through `mr_review_submit`.
rt's MR tools have no Request changes on either forge: post a
blocking-framed Comment instead. The summary's Assessment names the
findings that block the merge and says approval is withheld until they are
fixed.

On either forge a review is ONE submitted review: the selected findings with a
`file` and `line`, and the restored ones with both and `changed` false,
as its comments, the summary as its summary note, the disposition as its
outcome, and on a re-review the decided `replies` as its replies, all in
a single call. Nothing posts on its own before or after that call. The
forge marks the reviewer as having reviewed, and approves when the
disposition is Approve.

A comment whose line is outside the diff cannot be placed. The call says
which ones and posts nothing: move each named finding into the summary's
issue list, exactly as a finding with no `file` anchor, and make the call
again, once. In a drafted review it is appended to the summary instead,
its `file:line` alone on a line and then its text word for word: the
human's edit, else its draft, the same text its comment would have
posted, never the finding's `body`.

A review that posted but whose approval was refused is posted. The
approval is then settled on its own, through the caller's approval gate;
the review is never submitted a second time.

On GitHub a submit that returns `published: true` with `replyErrors` is
a review that is up and complete: the listed replies are the only part
missing. Post each listed reply once with `mr_reply_thread`; its thread
stays unresolved unless that reply posts, and a `resolve` that was due
runs after it with `mr_resolve_thread`. The review is never submitted
again. A reply that still fails is reported in the close with its error,
apart from `resolveErrors`.
