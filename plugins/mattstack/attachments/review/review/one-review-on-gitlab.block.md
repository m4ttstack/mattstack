---
order: 17
label: One review
---

# The one review

On both forges the one review is `mr_review_submit` (comments, summary,
outcome; `replies` on a re-review): `published: true` with `mrUrl`, the
close's link, or `published: false` with the reason and nothing posted.
The daemon places each comment, so never hand-build a position payload or
post a finding with `mr_comment_inline`.
