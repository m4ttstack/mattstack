---
order: 13
---

# On GitLab that one review is `mr_review_submit`

On GitLab that one review is `mr_review_submit` (comments, summary,
outcome; `replies` on a re-review): `published: true` with `mrUrl`, the
close's link, or `published: false` with the reason and nothing posted.
The daemon places each comment, so never hand-build a position payload or
post a finding with `mr_comment_inline`. GitHub has no inline mechanism:
every selected finding rides in the one `gh pr review` body with its
`file:line`. When the json carries drafts, that body is built from
Compose's texts (edit, else draft) and adds no wording: the joined summary
exactly as Compose builds it, then each selected finding with both `file`
and `line`, in gate order, preceded by one blank line, as its `file:line`
alone on a line and then its text word for word. A restored finding
follows them the same way, with its recorded anchor and text. The same
body is what `gh pr comment` posts on a take.
