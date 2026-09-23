---
name: "writing-style-structured"
description: "Use only when the mattstack writing-style lookup names mattstack:writing-style-structured. The voice for review comments, replies, PR descriptions and commit messages posted under the operator's name: labelled lines and short bullets for teams that prefer formal write-ups."
metadata:
  compiled: "mattstack@0.18.0"
---

<!-- compiled by rt skills compile from the sources below; slots pre-resolved; edits here are working-tree drift (rt skills promote) -->

<!-- part: step source=mattstack:writing-style-structured version=0.18.0 path=attachments/writing-style/writing-style-structured/SKILL.md lines=7-67 -->

# Structured

Clear and scannable, for teams that like formal write-ups. Every point is
labelled so a reader can triage without reading the whole thing. Load this
before the first draft and write in it from the first word.

<!-- part: include:writing-style-floor source=mattstack:writing-style-floor version=0.18.0 path=attachments/writing-style-floor/SKILL.md lines=6-53 -->
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

## Voice

- **Sentence case**, complete but short sentences.
- **Labels over prose.** A finding is a few labelled lines, not paragraphs.
- **Neutral and precise.** No hedging filler; state confidence once
  ("Likely", "Confirmed") when it matters.
- **Short bullets allowed** in a comment with more than one point, three at
  most.

Compression target: every line earns its label. Cut any line a reader could
skip without missing the ask.

## Review findings

Open with a bolded Conventional Comments label, never a code span, then
labelled lines:

````
**issue:** The last partial page never renders.
Why: `pageCount` rounds down (`src/list/paginate.ts:31`).
Impact: 45 items at 20 per page show two pages; the last five are lost.
Suggestion: round up.

```ts
const pageCount = Math.ceil(total / pageSize);
```
````

Use only the lines that carry something: a `nitpick` is the label and one
line. A process ask is one line.

## Review summary

One line: `No blockers. Inline notes on paging and tests.` Only a blocker
joins it: `One blocker inline (page count).`

## Replies on your own PR

One or two sentences, plain and direct. No thanks opener. State the outcome
first.

- `Changed to Record<Status, string>.`
- `Skipping the lock: the job runs on one worker, and a lock adds a round trip per write.`

## PR descriptions

Read `${CLAUDE_SKILL_DIR}/pr-description.md` before drafting.

## Commit messages

- Subject: imperative, sentence case, under 72 characters, with the ticket
  key when the repo uses them (`ABC-123: Round page count up`).
- Body: a blank line, then one to three lines on why, wrapped at 72.
