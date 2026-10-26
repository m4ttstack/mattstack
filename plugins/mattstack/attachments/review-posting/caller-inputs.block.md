---
order: 1
---

# Posting caller inputs

- A decided selection: `{findings: [ids], disposition: "comment" |
  "approve" | "request_changes"}`. `findings` names ids from the report
  json, and each selected entry's `file`, `line`, `title` and `fix` feed
  the inline-thread mechanics directly -- never re-parsed out of the
  draft's prose. A selected id with no matching json entry stops and says
  so, never mapped to a neighbouring finding. A selected entry with no
  `file` anchor (its `fileLabel` says why) posts into the summary comment
  instead of an inline thread. `disposition` names the one the caller
  already chose, in that lowercase vocabulary. Legacy `{levels: [...],
  disposition: ...}` stays accepted unchanged and posts whole tiers
  (whichever of Critical / Important / Minor the draft carries), for
  callers not yet migrated. Arriving with neither shape, or without a
  disposition, is a caller bug -- see the guard below.
- On a re-review, `replies`: one `{discussionId, body, resolve}` per
  earlier thread the human chose to act on, already decided. `body` is
  absent when the human held the reply and only resolves. They post in
  the same submitted review as the findings; never as separate replies.
- On a re-review, `restored`: one `{id, title, body, file, line,
  changed}` per finding the human brought back from an earlier round,
  each with its recorded title, body and anchor (`file` and `line` left
  out when it has none), and `changed` true when the code it pointed at
  moved since the round that skipped it. They post as selected findings,
  with their recorded text as written: never re-judged, re-worded or put
  into the writing style. One with `changed` true posts in the summary's
  issue list with its recorded `file:line` in its text, never inline: its
  recorded line may now hold other code. One with `changed` false posts
  inline at its recorded anchor.
- The draft, in the review flow's Strengths / Issues shape: Strengths /
  Issues (Critical / Important / Minor, each `file:line`) / Assessment
  (yes | no | with fixes), when it is in context -- take it as given, never
  re-derive or re-judge a finding here. When the draft is not in context
  (the parked-resume case), read the written report file AND its json
  sibling; the json's findings are what you execute from, ids and anchors
  alike, and the markdown carries the human-facing wording. With no json
  sibling (a report written before this contract), the report's fixed
  severity buckets are enough to execute the legacy form from.
- A postable target: an MR/PR whose posting mechanics -- anchoring an inline
  comment to a line, verifying it landed, composing the summary body -- the
  caller owns. This part decides how to execute, not what posts or where.
- **Callers:** the review verb's Deliver step, a domain adapter's
  teammate-review skill, or any session holding a review draft, a decided
  selection, and a postable target.
