---
name: review-posting
description: >-
  Use when a decided review selection ({findings, disposition}, or the
  legacy {levels, disposition}) plus a review draft are ready to post to an
  MR/PR -- posting inline threads for the selected findings, composing the
  summary, executing the chosen disposition, and closing out. Not for
  producing the review, and not for deciding what posts -- the caller
  decides; this part only executes.
---

# Review posting (execution only)

Turning a decided review selection into what lands on the MR/PR: which
findings get a thread, what disposition closes it, how the summary reads,
how the close ends. This part owns execution. The decision -- which
findings post and what disposition closes the review -- belongs to the
caller.

## Caller inputs

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
  teammate-review skill (the harvest `review` skill, after its thinning
  pass), or any session holding an engine draft, a decided selection, and a
  postable target.

## Guard: never asks

This part never asks a question. Arriving without a decided selection --
neither `{findings, disposition}` nor the legacy `{levels, disposition}`,
which a resumed board path may spell `{tiers, disposition}` and which is
accepted the same either way -- is a caller bug: stop and say so in one
line, never improvise a severity or disposition question to cover the
gap. A payload carrying finding ids is the contract, not a bug. Deciding
what posts is one layer up, not here.

## No side door

Post inline threads only for the selected findings -- on the legacy form,
every finding in the selected levels. A deselected or unraised finding
drops entirely: not into the summary, not into a footnote, not through any
other channel.

## Summary comment

Posting mechanics are inline threads for the selected findings plus ONE
summary comment -- identical mechanics regardless of which disposition was
chosen. The summary carries Strengths and the Assessment, and its issue
list is scoped to what was actually selected: a deselected Minor does not
resurface in the summary either. A selected finding with no `file` anchor
lives in that issue list, and only there.

Empty selection (`findings`, or legacy `levels`, is empty): no inline
threads, post only the summary. Under Approve with nothing selected: skip
the issue list and just approve with a brief note.

## Posting mechanics by disposition

Comment and Approve execute everywhere. Request changes executes only on
GitHub (`gh pr review --request-changes`); rt's GitLab MR tools have no
Request changes. Where it is unavailable, post a blocking-framed Comment:
the summary's Assessment names the findings that block the merge and says
approval is withheld until they are fixed.

On Approve: post the findings first, then approve.

## Tacit-approval rule

When the chosen disposition carries no approval -- Comment, or a
blocking-framed Comment standing in for an unavailable Request changes --
strip "nothing blocking," "LGTM," and "good to merge" from the summary.
Either leave the merge decision to the author or say plainly that approval
is being withheld pending the noted items. Only an approving disposition may
carry an unqualified all-clear.

## Close HARD-GATE

<HARD-GATE>
The final message ends with the target's id formatted as a markdown link to
its real web URL, read from the forge (the `mrUrl` a posting tool
returned; else on GitLab the `webUrl` of `mr_view` with `mrUrl`, or
`repoName` plus `iid`; on GitHub `gh pr view`) -- never hand-assembled, never
left as a bare id or number. Required every time, on every disposition.
</HARD-GATE>

## Red flags

| Thought | Reality |
|---|---|
| "No selection arrived, I'll ask which levels to post" | Never improvise a question here. Arriving without a decided selection is a caller bug: stop and say so. |
| "It handed me finding ids, but the contract says levels" | Both shapes are the contract. Ids post exactly those findings; levels post whole tiers. Only a payload carrying neither is a caller bug. |
| "This selected finding has no `file`, I'll anchor it to the nearest line" | Never invent an anchor. A selected entry with no `file` goes in the summary comment. |
| "I'll fold the deselected Minors into the summary note" | No side door. A deselected finding drops entirely; it does not move to a different channel. |
| "No approval landed, but I'll still say 'nothing blocking'" | Tacit approval. Strip the all-clear language unless the disposition actually approves. |
| "I'll close with !123" | Bare id. The close HARD-GATE needs a markdown link to the real URL, read from the forge (a posting tool's `mrUrl`; else `mr_view`'s `webUrl`, called with `mrUrl` or `repoName` plus `iid`, on GitLab, `gh pr view` on GitHub). |
| "GitLab has no Request changes here, I'll just post a plain Comment" | Post a blocking-framed Comment: its Assessment names what blocks the merge and says approval is withheld. |
| "The selection looked stale, I'll re-ask to be sure" | Not this part's call. A decided selection is trusted as handed; re-deciding belongs to the caller, not the executor. |

## Quick reference

| Signal | Action |
|---|---|
| Decided `{findings, disposition}`, or legacy `{levels, disposition}`, + draft (parked: the report file AND its json sibling) + target in hand | Post per the sections above. |
| No decided selection arrived | Stop; name it a caller bug. Never ask a question here. |
| Posting inline threads | Selected findings only (legacy: whole selected levels); deselected findings drop, no side door. |
| A selected finding carries no `file` anchor | It rides in the summary comment; never invent a line for it. |
| Posting the summary | One comment, scoped to what was selected; an unanchorable selected finding lives here. |
| Disposition is Approve | Post the findings first, then approve. |
| Disposition is Request changes on a forge without it (GitLab) | Blocking-framed Comment: the Assessment names what blocks the merge and says approval is withheld. |
| Disposition carries no approval | Strip all-clear language from the summary; state the decision is deferred or withheld. |
| About to close | Markdown link to the real URL, read from the forge (a posting tool's `mrUrl`; else `mr_view`'s `webUrl`, called with `mrUrl` or `repoName` plus `iid`, on GitLab, `gh pr view` on GitHub) -- every time. |
