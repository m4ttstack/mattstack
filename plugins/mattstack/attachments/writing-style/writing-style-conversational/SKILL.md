---
name: writing-style-conversational
description: "Use only when the mattstack writing-style lookup names mattstack:writing-style-conversational. The voice for review comments, replies, PR descriptions and commit messages posted under the operator's name: short, friendly sentences in sentence case, like talking to a teammate."
type: pipeline-step
---

# Conversational

Short, friendly, and plain, like talking to a teammate across a desk. Load
this before the first draft and write in it from the first word.

{{include:writing-style-floor}}

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
