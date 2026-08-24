---
name: review-posting
description: >-
  Use when a finished review draft with severity-bucketed findings is
  about to be posted to an MR/PR -- deciding which findings land, which
  review disposition to leave, how the summary reads, and how to close
  out. Not for producing the review itself.
---

# Review posting (the two-gate protocol)

Turning a finished draft into what lands on the MR/PR: which findings get a
thread, what disposition closes it, how the summary reads, how the close
ends. This skill owns those decisions, not the judgment behind the draft.

## Caller inputs

- The draft, in the review-core flow's shape (`../review-core/SKILL.md`,
  the sibling attachment): Strengths / Issues
  (Critical / Important / Minor, each `file:line`) / Assessment (yes | no |
  with fixes). Its provenance is the review-core flow, dispatched via
  the review-dispatch flow -- take the draft as given, never re-derive or
  re-judge a finding here.
- A postable target: an MR/PR whose posting mechanics -- anchoring an inline
  comment to a line, verifying it landed, composing the summary body -- the
  caller owns. This skill decides what posts and where; it does not teach
  forge CLI mechanics.
- **Callers:** a domain adapter's teammate-review skill (the harvest
  `review` skill, after its thinning pass), or any session holding an
  engine draft and a postable target. Nothing in this repo binds it;
  callers reach it by reading this file.

## The two gates

Two decisions belong to the developer, and only the developer: which
findings get an inline thread (**Gate 1**) and what disposition closes the
review (**Gate 2**). Anchoring inline comments, verifying they landed on
the right lines, and composing the summary are posting MECHANICS -- the
ordering work this skill does once both gates are answered. Mechanics are
not a gate; relabeling them as "the two gates" mislabels ordering as
consent.

A go-ahead on the draft's CONTENT answers neither gate. "Get that posted,"
"looks good, ship it," a nod at the findings -- none of that is a severity
selection and none of it is a disposition. Treating content approval as
approval of scope and verdict is the failure this skill exists to prevent:
ask both gates explicitly, even when the partner sounds ready to ship.

## Order rule

Present the draft with each finding under its severity level, then clear
Gate 1 before Gate 2 -- severities first, so the developer sees exactly
what would land before choosing a verdict. Post nothing -- no inline
thread, no summary comment, no disposition -- until both gates have an
explicit answer.

## Gate 1: severity multi-select

Offer only the levels present in the draft, skipping any level with no
findings. Pre-select every level that
has findings, so nothing drops silently -- the developer deselects rather
than opts in. A common pick: Critical + Important selected, Minor
deselected.

Post inline threads only for selected findings. A deselected or unraised
finding drops entirely: not into the summary, not into a footnote, not
through any other channel. No side door.

## Summary comment

Posting mechanics are inline threads for the selected findings plus ONE
summary comment -- identical mechanics regardless of which disposition Gate
2 lands on. The summary carries Strengths and the Assessment, and its issue
list is scoped to the levels actually posted: a deselected Minor does not
resurface in the summary either.

Empty selection (every level deselected): no inline threads, post only the
summary. Under Approve with nothing selected: skip the issue list and just
approve with a brief note.

## Gate 2: disposition

Offer only the dispositions the target forge's CLI supports. Comment (the
default) and Approve are available everywhere; Request changes is available
where the CLI supports it -- `gh` does, `glab` does not. There, frame the
blocking findings as blocking inside a Comment rather than silently
downgrading the recommendation. Verify CLI support before offering a
disposition; don't assume from memory.

The draft's Assessment informs the recommendation, never decides it: yes
leans toward Approve; no or with fixes leans toward Comment or Request
changes. Regardless of Assessment, the pre-selected default is always
Comment, and the developer chooses from the offered set. Never choose the
disposition for the developer, and never approve on their behalf.

On Approve: post the findings first, then approve.

## Tacit-approval rule

When the chosen disposition carries no approval -- Comment, or a
blocking-framed Comment standing in for an unavailable Request changes --
strip "nothing blocking," "LGTM," and "good to merge" from the summary.
Either leave the merge decision to the author or say plainly that approval
is being withheld pending the noted items. Only an approving disposition
may carry an unqualified all-clear.

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
| "'Get that posted' covers it" | Answers neither gate. Ask severity selection and disposition, each explicitly, before posting anything. |
| "I'll fold the deselected Minors into the summary note" | No side door. A deselected finding drops entirely; it does not move to a different channel. |
| "Two Criticals -- that settles the disposition" | Never choose the disposition for the developer. Assessment informs the recommendation; it does not decide it. |
| "No approval landed, but I'll still say 'nothing blocking'" | Tacit approval. Strip the all-clear language unless the disposition actually approves. |
| "I'll close with !123" | Bare id. The close HARD-GATE needs a markdown link to the real URL, read from the forge CLI. |
| "Anchor, verify, summary -- that's my two gates" | Those are posting mechanics, not the gates. The gates are the developer's decisions: severity selection and disposition. |

## Quick reference

| Signal | Action |
|---|---|
| Draft + postable target in hand | Present findings by severity; post nothing yet. |
| Partner gives a content go-ahead | Still ask Gate 1 and Gate 2 separately -- content approval answers neither. |
| Gate 1 answered | Inline threads for selected findings only; deselected findings drop, no side door. |
| Gate 2 answered | Post per the chosen disposition, offered set forge-conditional; on Approve, findings first, then approve. |
| Disposition carries no approval | Strip all-clear language from the summary; state the decision is deferred or withheld. |
| About to close | Markdown link to the real URL, read from the forge CLI -- every time. |
