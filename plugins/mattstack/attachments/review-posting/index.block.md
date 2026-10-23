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
