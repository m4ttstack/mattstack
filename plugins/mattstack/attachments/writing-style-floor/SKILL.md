---
name: writing-style-floor
description: "The rules every mattstack writing-style preset shares, the tells that make posted prose read as machine-written. Not for direct invocation; each preset includes it."
---

## Rules every style shares

These bind anything posted under the operator's name: review findings, the
review summary, replies on their own PR, PR descriptions, commit messages.
The preset sets the voice; these set the floor.

### Never

- **Em or en dashes.** Rephrase, or use parentheses, a colon, or an ellipsis
  ("...").
- **Detective and agent phrasing.** "smoking gun", "load-bearing",
  "razor-sharp", "the money question", "nails it", "the plot thickens",
  "here's the kicker", "let's dive in". Say the plain thing: "the evidence",
  "the key question", "this confirms it".
- **Praise or thanks as an opener.** "Great catch", "Nice find", "You're
  right", "Thanks for flagging", "Absolutely". Open on what the code does or
  what changes.
- **Corporate filler.** "ensure", "facilitate", "leverage", "in order to",
  "please let me know if you have any questions", "happy to discuss".
- **Announcement openers and self-narration.** "Worth flagging:", "One thing I
  noticed:", "Took a look", "I just wanted to". Start with the claim.
- **Invented precision.** "most" beats "~96%" unless the number was measured.

### Always

- **Compress before posting.** The first draft is a rough cut. Before posting
  anything, run one revision pass whose only goal is the preset's length and
  tone target: cut to the fewest sentences that still land the ask, then cut
  one more clause. Posting a first draft means this pass was skipped.
- **One reason, one ask.** Once the ask lands, delete the second supporting
  argument ("bonus:", "also this would let us..."). Propose the fix you
  expect them to take; the author knows deferring is an option.
- **Evidence as output.** If you ran or reproduced something, paste what it
  returned in a code block instead of a sentence describing it:

  ```
  base a1b2c3d -> 2 rows: "Item 1", "Item 2"
  head e4f5a6b -> 1 row:  "Item 1"
  ```
- **Stay on the diff.** Comment on the code in front of you. Whether the
  change should exist at all is the author's and PM's call.
- **Code out of prose.** Code you suggest the author write, even a one-line
  expression, goes in a fenced block on its own line after the ask. Inline
  backticks are only for names that already exist: `userId`, `cache.ts:42`.
- **Exact locations.** `file.ts:123`, never "around line 120".
- **A one-line review summary.** A verdict plus a pointer to the inline
  notes. It never recaps a finding, lists strengths, or reports what you ran.
  A finding with no line to anchor to is its own top-level comment.
