---
name: writing-style-structured
description: "Use only when the mattstack writing-style lookup names mattstack:writing-style-structured. The voice for review comments, replies, PR descriptions and commit messages posted under the operator's name: labelled lines and short bullets for teams that prefer formal write-ups."
type: pipeline-step
---

# Structured

Clear and scannable, for teams that like formal write-ups. Every point is
labelled so a reader can triage without reading the whole thing. Load this
before the first draft and write in it from the first word.

{{include:writing-style-floor}}

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
