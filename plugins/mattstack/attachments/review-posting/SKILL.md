---
name: review-posting
description: >-
  Use when a decided review selection ({levels, disposition}) plus a review
  draft are ready to post to an MR/PR -- posting inline threads for the
  selected levels, composing the summary, executing the chosen disposition,
  and closing out. Not for producing the review, and not for deciding what
  posts -- the caller decides; this part only executes.
---

# Review posting (execution only)

Turning a decided review selection into what lands on the MR/PR: which
findings get a thread, what disposition closes it, how the summary reads,
how the close ends. This part owns execution. The decision -- which
severity levels post and what disposition closes the review -- belongs to
the caller.

## Caller inputs

- A decided selection: `{levels: [...], disposition: "comment" | "approve"
  | "request_changes"}`. `levels` names the severity buckets to post
  (whichever of Critical / Important / Minor the draft carries); `disposition`
  names the one the caller already chose. Arriving without both is a caller
  bug -- see the guard below.
- The draft, in the review flow's Strengths / Issues shape: Strengths /
  Issues (Critical / Important / Minor, each `file:line`) / Assessment
  (yes | no | with fixes), when it is in context -- take it as given, never
  re-derive or re-judge a finding here. When the draft is not in context
  (the parked-resume case), read it from the written report file instead;
  the report's fixed severity buckets are enough to execute from.
- A postable target: an MR/PR whose posting mechanics -- anchoring an inline
  comment to a line, verifying it landed, composing the summary body -- the
  caller owns. This part decides how to execute, not what posts or where.
- **Callers:** the review verb's Deliver step, a domain adapter's
  teammate-review skill (the harvest `review` skill, after its thinning
  pass), or any session holding an engine draft, a decided selection, and a
  postable target.

## Guard: never asks

This part never asks a question. Arriving without a decided `{levels,
disposition}` is a caller bug: stop and say so in one line, never improvise
a severity or disposition question to cover the gap. Deciding what posts is
one layer up, not here.

## No side door

Post inline threads only for the selected levels. A deselected or unraised
finding drops entirely: not into the summary, not into a footnote, not
through any other channel.

## Summary comment

Posting mechanics are inline threads for the selected levels plus ONE
summary comment -- identical mechanics regardless of which disposition was
chosen. The summary carries Strengths and the Assessment, and its issue
list is scoped to the levels actually posted: a deselected Minor does not
resurface in the summary either.

Empty selection (`levels` is empty): no inline threads, post only the
summary. Under Approve with nothing selected: skip the issue list and just
approve with a brief note.

## Posting mechanics by disposition

Comment and Approve execute everywhere. Request changes executes only where
the target forge's CLI supports it (`gh` does, `glab` does not); there,
frame the blocking findings as blocking inside a Comment instead of silently
downgrading the recommendation -- say the CLI can't carry Request changes,
don't just post a plain Comment as if nothing changed.

On Approve: post the findings first, then approve.

## Tacit-approval rule

When the chosen disposition carries no approval -- Comment, or a
blocking-framed Comment standing in for an unavailable Request changes --
strip "nothing blocking," "LGTM," and "good to merge" from the summary.
Either leave the merge decision to the author or say plainly that approval
is being withheld pending the noted items. Only an approving disposition may
carry an unqualified all-clear.

## Writing style

Composing comment text -- inline threads and the summary alike -- starts by
loading the operator's writing-style skill as step one of drafting. The
operator declares it in `~/.mattstack/user/skills/preferences.md` under
`## Writing style`, which names the skill to load. Every comment is composed
in that voice from the first word; a second-pass edit applied to an
already-drafted comment never lands as true. When that file declares no
writing-style skill, use a neutral, concise voice.

## Close HARD-GATE

<HARD-GATE>
The final message ends with the target's id formatted as a markdown link to
its real web URL, read from the forge CLI -- never hand-assembled, never
left as a bare id or number. Required every time, on every disposition.
</HARD-GATE>

## Red flags

| Thought | Reality |
|---|---|
| "No selection arrived, I'll ask which levels to post" | Never improvise a question here. Arriving without a decided selection is a caller bug: stop and say so. |
| "I'll fold the deselected Minors into the summary note" | No side door. A deselected finding drops entirely; it does not move to a different channel. |
| "No approval landed, but I'll still say 'nothing blocking'" | Tacit approval. Strip the all-clear language unless the disposition actually approves. |
| "I'll close with !123" | Bare id. The close HARD-GATE needs a markdown link to the real URL, read from the forge CLI. |
| "`glab` can't do Request changes, I'll just post a plain Comment" | Frame the blocking findings as blocking inside the Comment; don't silently downgrade the recommendation. |
| "The selection looked stale, I'll re-ask to be sure" | Not this part's call. A decided selection is trusted as handed; re-deciding belongs to the caller, not the executor. |

## Quick reference

| Signal | Action |
|---|---|
| Decided `{levels, disposition}` + draft (or report) + target in hand | Post per the sections above. |
| No decided selection arrived | Stop; name it a caller bug. Never ask a question here. |
| Posting inline threads | Selected levels only; deselected findings drop, no side door. |
| Posting the summary | One comment, scoped to the levels actually posted. |
| Disposition is Approve | Post the findings first, then approve. |
| Disposition is Request changes on a CLI that lacks it | Blocking-framed Comment, said explicitly. |
| Disposition carries no approval | Strip all-clear language from the summary; state the decision is deferred or withheld. |
| About to close | Markdown link to the real URL, read from the forge CLI -- every time. |
