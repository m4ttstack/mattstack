---
name: writing-style-sparse
description: "Use only when the mattstack writing-style lookup names mattstack:writing-style-sparse. The voice for review comments, replies, PR descriptions and commit messages posted under the operator's name: terse, lowercase technical prose, one tight paragraph per point."
type: pipeline-step
---

# Sparse

Terse and conversational. The reader is a colleague who can follow a chain
from one sentence. Load this before the first draft and write in it from the
first word; it is not a pass applied to a finished draft.

{{include:writing-style-floor}}

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

1. **Claim, hedged.** `i think this leaks across tenants.`
2. **Mechanism**, cited as `file.ts:line`. When it is a condition or two,
   fold it into the claim instead of its own paragraph.
3. **Impact.** `both t1 and t2 have a u7 in seed data, so it's reachable.`
   Often folds into the claim.
4. **Suggestion, as a question.** Code goes in a fenced block.
5. **Concession, only when real.** Never as a politeness move.

A non-blocking `thought` or `question` is two short paragraphs at most. A
process ask (a missing test, missing evidence) is one or two casual lines:

```
**suggestion:** changes look good. would you mind adding a test for the two-tenant case? 👌
```

Over-built:

```
**issue (non-blocking):** on the retry path this re-reads the stale price. `loadPrice` runs inside `fetchCart().then`, so when `fetchCart()` rejects the price is still the cached one and `total()` returns the old value. for a customer whose price changed, checkout shows the old total... the exact bug this change fixes, reintroduced on the failure path. `usePriceRefresh` can't rescue it since the cache never cleared. it's defensible as fail-closed, but should be a conscious decision.
```

Compressed, same finding and ask:

```
**issue (non-blocking):** if `fetchCart()` rejects here the price is still the cached one, so checkout shows the old total... the same bug this fixes. fine as fail-closed, but can we say that in a comment (or retry once)? right now it reads as harmless.
```

A brief, specific acknowledgment is fine inline when it immediately pivots
into the worry: `**thought (non-blocking):** nice job pinning the version.
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
- `i don't think async buys us anything yet. nothing loads labels from the api, and it'd ripple through six sync callers.`
- `👍`

## PR descriptions

Read `${CLAUDE_SKILL_DIR}/pr-description.md` before drafting. It carries the
length target, the structure, and the anti-patterns.

## Commit messages

- Subject: lowercase, imperative, under 72 characters, prefixed with the
  ticket key when the repo uses them (`ABC-123: key settings cache on tenant`).
- Body, optional: one or two lowercase lines on why, wrapped at 72.
