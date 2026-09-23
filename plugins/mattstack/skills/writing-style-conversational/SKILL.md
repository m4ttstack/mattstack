---
name: "writing-style-conversational"
description: "Use only when the mattstack writing-style lookup names mattstack:writing-style-conversational. The voice for review comments, replies, PR descriptions and commit messages posted under the operator's name: short, friendly sentences in sentence case, like talking to a teammate."
metadata:
  compiled: "mattstack@0.18.0"
---

<!-- compiled by rt skills compile from the sources below; slots pre-resolved; edits here are working-tree drift (rt skills promote) -->

<!-- part: step source=mattstack:writing-style-conversational version=0.18.0 path=attachments/writing-style/writing-style-conversational/SKILL.md lines=7-72 -->

# Conversational

Short, friendly, and plain, like talking to a teammate across a desk. Load
this before the first draft and write in it from the first word.

<!-- part: include:writing-style-floor source=mattstack:writing-style-floor version=0.18.0 path=attachments/writing-style-floor/SKILL.md lines=6-59 -->
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
- **Evidence as output.** Reproducing something for a review comment or
  reply: paste what it returned in a code block instead of a sentence
  describing it:

  ```
  base a1b2c3d -> 2 rows: "Item 1", "Item 2"
  head e4f5a6b -> 1 row:  "Item 1"
  ```

  A PR description's verification section reports test counts, not logs,
  per the preset's own instructions; this rule does not reach it.
- **Stay on the diff.** Comment on the code in front of you. Whether the
  change should exist at all is the author's and PM's call.
- **Code out of prose.** Code you suggest the author write, even a one-line
  expression, goes in a fenced block on its own line after the ask. Inline
  backticks are for names: ones that exist (`userId`, `cache.ts:42`) and a
  single proposed name or type (`pageCursor`).
- **Exact locations.** `file.ts:123`, never "around line 120".
- **One finding per comment**, anchored to the line it is about.
- **A one-line review summary.** A verdict plus a pointer to the inline
  notes. It never recaps a finding, lists strengths, or reports what you ran.
  A finding with no line to anchor to is its own top-level comment.

## Voice

- **Sentence case** everywhere, with contractions.
- **Short paragraphs** of one to three sentences. Plain words over jargon.
- **Warm, not effusive.** A short, specific credit is fine folded in after
  the concern, never as the opener ("One worry: nothing tests the fallback.
  The version's pinned now, nice catch."). A bare compliment is not.
- **Hedge honestly**, inside the sentence: "I think this drops the last page."
- **Light formatting.** The bold label and code are fine in comments; skip
  headings and lists there.

Compression target: would this read naturally if you said it out loud to the
author? Cut anything you would not say.

## Review findings

Open with a bolded Conventional Comments label, never a code span
(`**issue:**`, `**suggestion:**`, `**question:**`, `**nitpick:**`,
`**thought:**`, `(non-blocking)` when it helps), chosen by what you ask the
author to do.

Two to four sentences: what's wrong, why in one sentence (with
`file.ts:line`), and the fix as a friendly question, code in a fenced block.

````
**issue:** `pageCount` rounds down (`src/list/paginate.ts:31`), so the last partial page never renders. With 45 items at 20 per page you'd see two pages and lose the last five. Could we round up?

```ts
const pageCount = Math.ceil(total / pageSize);
```
````

A process ask is one line that leads with the approval if there is one:
`**suggestion:** Looks good! Could you add a test for the empty-list case?`

## Review summary

One line: `Looks good to me, no blockers. Left a few comments inline.` Only a
blocker joins it.

## Replies on your own PR

One to three short sentences. No sign-offs; thank someone only if they
thanked you. Agree plainly when they're right ("Good call, switched to
`Record<Status, string>`."). Disagree gently with the one reason that
matters.

- `Good call, switched to Record<Status, string>.`
- `I'd skip the lock for now. The job runs on one worker, and a lock adds a round trip per write.`

## PR descriptions

Read `${CLAUDE_SKILL_DIR}/pr-description.md` before drafting.

## Commit messages

- Subject: imperative, sentence case, under 72 characters, with the ticket
  key when the repo uses them (`ABC-123: Round page count up`).
- Body, optional: one or two sentences on why, wrapped at 72.
