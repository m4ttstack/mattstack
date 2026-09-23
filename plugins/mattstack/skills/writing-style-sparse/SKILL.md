---
name: "writing-style-sparse"
description: "Use only when the mattstack writing-style lookup names mattstack:writing-style-sparse. The voice for review comments, replies, PR descriptions and commit messages posted under the operator's name: terse, lowercase technical prose, one tight paragraph per point."
metadata:
  compiled: "mattstack@0.18.0"
---

<!-- compiled by rt skills compile from the sources below; slots pre-resolved; edits here are working-tree drift (rt skills promote) -->

<!-- part: step source=mattstack:writing-style-sparse version=0.18.0 path=attachments/writing-style/writing-style-sparse/SKILL.md lines=7-108 -->

# Sparse

Terse and conversational. The reader is a colleague who can follow a chain
from one sentence. Load this before the first draft and write in it from the
first word; it is not a pass applied to a finished draft.

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

- **Lowercase for technical content**: findings, assertions, code talk.
  Proper nouns, code, and short social lines ("Looks good to me! Left a few
  comments.") keep normal case.
- **Casual and direct.** Contractions welcome: "could we just", "wonder if",
  "does this actually".
- **Hedge inside the claim, not in front of it.** "the cache is doing more
  than memoizing, i think", not "one concern: the cache is doing more".
- **No markdown furniture in comments.** No headings, lists, or bold except
  the Conventional Comments label. Code blocks and backticks are fine.
- **One claim per paragraph**, and never restate a fact's downstream
  consequence as a new paragraph.

Compression target: shorter and more conversational. Ask "would a busy
teammate send this as written, or trim it first?" If there is any doubt,
trim.

## Review findings

Open with a bolded Conventional Comments label, never a code span:
`**issue:**`, `**suggestion:**`, `**question:**`, `**nitpick:**`,
`**thought:**`, with `(non-blocking)` when it helps. Pick it by what you ask
the author to do: `question` when they need to check, `issue` when you know
it's broken, `suggestion` for design or style, `nitpick` for trivia,
`thought` when musing.

Most findings are 2 to 4 sentences: the problem, the one-line causal chain,
and the fix asked as a light question. The inline anchor already says where
you are, so don't re-walk the path. The beats a substantive finding may take,
in order (a superset; most use two or three):

1. **Claim, hedged.** `i think this drops the last partial page.`
2. **Mechanism**, cited as `file.ts:line`. When it is a condition or two,
   fold it into the claim instead of its own paragraph.
3. **Impact.** `any list with a remainder hits it, so it's reachable.`
   Often folds into the claim.
4. **Suggestion, as a question.** Code goes in a fenced block.
5. **Concession, only when real.** Never as a politeness move.

A non-blocking `thought` or `question` is two short paragraphs at most. A
process ask (a missing test, missing evidence) is one or two casual lines
that lead with the approval if there is one and ask as a favor:

```
**suggestion:** changes look good. would you mind adding a test for the empty-list case? 👌
```

Over-built:

```
**issue (non-blocking):** on the retry path this re-reads the stale price. `loadPrice` runs inside `fetchCart().then`, so when `fetchCart()` rejects the price is still the cached one and `total()` returns the old value. for a customer whose price changed, checkout shows the old total... the exact bug this change fixes, reintroduced on the failure path. `usePriceRefresh` can't rescue it since the cache never cleared. it's defensible as fail-closed, but should be a conscious decision.
```

Compressed, same finding and ask:

```
**issue (non-blocking):** if `fetchCart()` rejects here the price is still the cached one, so checkout shows the old total... the same bug this fixes. fine as fail-closed, but can we say that in a comment (or retry once)? right now it reads as harmless.
```

A brief, specific credit is fine folded into the worry, never as the
opener: `**thought (non-blocking):** the version's pinned now, nice catch.
only worry: nothing tests the fallback...`. A bare compliment is not.

## Review summary

One line, sentence case: `Looks solid to me, no blockers. Left a few inline
notes.` or `Left a few comments!` Only a blocker may join it: `Left one
blocker inline.`

## Replies on your own PR

Very short. No sign-offs, no thanks unless they thanked first. Soften even
confident claims ("probably", "i think", "seems ok to me") and concede the
limits of your reasoning. Once the point lands, cut the clause defending it.
Praise flows up, not down: `good call. changed to Record<Status, string>.`
is right when conceding a reviewer's catch. Stack single sentences; no
blank-line paragraphs.

- `good call. changed to Record<Status, string>.`
- `honestly not sure. good one to keep an eye on though.`
- `i don't think we need a lock here. the job runs on one worker, and a lock adds a round trip per write.`
- `👍`

## PR descriptions

Read `${CLAUDE_SKILL_DIR}/pr-description.md` before drafting. It carries the
length target, the structure, and the anti-patterns.

## Commit messages

- Subject: lowercase, imperative, under 72 characters, prefixed with the
  ticket key when the repo uses them (`ABC-123: round page count up`).
- Body, optional: one or two lowercase lines on why, wrapped at 72.
