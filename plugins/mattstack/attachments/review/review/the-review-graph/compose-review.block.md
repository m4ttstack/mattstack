---
node: compose_review
---

# Compose the submitted review: comments, summary, outcome

One call carries the whole review. Selected findings: the union of the
`findings-<n>` answers (`{value, note, texts}` unwraps to its value), a
legacy `tiers` answer's whole tiers, or the caller's selection (each
finding as the report json it was decided on writes it). `outcome`: the
picked option's value, `comment` or `approve` (or `request_changes` on
GitHub).

**The json carries drafts** (its `summary` has `comments`): every text
below is taken as it stands, never written here. On GitHub the same texts
and the same summary build the `gh pr review` body (The one review on
GitLab and GitHub, below).

- A finding's text: the `texts` entry at its id (from any `findings-<n>`
  answer, or the caller's `texts`), else its `comment` in the report json
  the selection was decided on. That json holds what the gate showed on
  both paths: a board's fresh posting pane has only that json, and nothing
  rewrites it after the gate opens.
- The summary line: the `outcome` answer's `text` (the caller's
  `summaryText`), else `summary.comments[<the picked outcome value>]`,
  the line drafted for that verdict. Never another verdict's line, even
  when readiness or the recommendation points elsewhere: an `approve`
  line never posts under a Comment.
- `comments`: one `{body, path, line}` per selected finding with both
  `file` and `line`, `body` its text.
- `summary`: the board's `joinSummary` rule. It is the summary line, then
  the text of each selected finding without both `file` and `line`, in
  gate order (Critical, Important, Minor; json order within a tier), each
  preceded by one blank line. A folded finding's text is the `texts` entry
  at its id (a `findings-<n>` answer's `texts`, or the caller's `texts`),
  else its `comment` in the report json. A folded finding the human
  edited posts the edit, never the draft: copy it from `texts`, not from
  the json. Nothing else is added: no heading, label, anchor, bullet or
  issue list. So the summary posts exactly as the board's summary card
  showed it.
- At most 100 comments and replies in all. Past that, the lowest-tier
  anchored findings go into the summary after the joined part, each
  preceded by one blank line, their text word for word.
- No text is reworded, trimmed, restyled or put into the voice here, and
  an answer's `note` never changes posted text.

**The json carries no drafts** (an older report, or a pack not yet
recompiled): `body` is the finding's tier, title and what to change, and
`summary` is the review-posting summary, its issue list holding each
selected finding without both `file` and `line`. Past 100 comments and
replies, the lowest-tier anchored findings go to the issue list.

`replies`: one per `thread-<n>` answer that picked anything,
`discussionId` from the value after `post:` or `resolve:`, `resolve` true
for `resolve:<id>`, `body` only for `post:<id>`: the answer's `text` when
present (the human's edit), else the report json's `reply`. A caller's
decided `replies` go in unchanged.

A `restore:<id>` answer brings that skipped finding back, posting as
review-posting says for restored findings, its text the caller's record
verbatim, never rewritten: the caller's `restored` entry (`title`, then
`body`) when it decided the selection, else the handed skipped entry
(`title`, then `excerpt`). Its `changed` is the `restored` entry's, else
the report json's `skipped` entry's. When the json carries drafts, a
restored finding that posts in the summary is never one of the joined
findings: it follows the joined part, preceded by one blank line, with its
recorded `file:line` and text.
